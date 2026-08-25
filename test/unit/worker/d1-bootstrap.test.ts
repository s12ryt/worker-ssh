import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:test";
import { encryptString } from "../../../src/worker/crypto";
import {
  DatabaseBootstrap,
  BOOTSTRAP_LEASE_MS,
  LATEST_SCHEMA_VERSION,
} from "../../../src/worker/d1-bootstrap";
import { encryptLegacyV1, encryptLegacyV2 } from "./crypto-fixtures";

const KEY = "test-encryption-key";

const connection = (id: string, name: string) => ({
  id,
  name,
  host: `${id}.example.test`,
  port: 22,
  username: "tester",
  authType: "password" as const,
  password: `secret-${id}`,
  createdAt: 1,
  updatedAt: 1,
});

async function resetStorage(): Promise<void> {
  const { keys } = await env.KV.list({ prefix: "" });
  await Promise.all(keys.map((key) => env.KV.delete(key.name)));
  await env.DB.exec(`
    DROP TABLE IF EXISTS app_settings;
    DROP TABLE IF EXISTS connections;
    DROP TABLE IF EXISTS folders;
    DROP TABLE IF EXISTS bootstrap_state;
    DROP TABLE IF EXISTS schema_meta;
  `);
}

async function runToTerminal(
  bootstrap: DatabaseBootstrap,
  limit = 50,
) {
  for (let attempt = 0; attempt < limit; attempt += 1) {
    const status = await bootstrap.step();
    if (status.status === "complete" || status.status === "failed") {
      return status;
    }
  }
  throw new Error("bootstrap did not reach a terminal state");
}

beforeEach(resetStorage);

describe("DatabaseBootstrap", () => {
  it("使用 60 秒租約並在長批次內持續 heartbeat", async () => {
    expect(BOOTSTRAP_LEASE_MS).toBe(60_000);
    for (let index = 0; index < 2; index += 1) {
      const item = connection(`heartbeat-${index}`, `Heartbeat ${index}`);
      await env.KV.put(
        `conn:${item.id}`,
        await encryptString(KEY, JSON.stringify(item)),
      );
    }

    let heartbeatQueries = 0;
    const db = new Proxy(env.DB, {
      get(target, property) {
        if (property === "prepare") {
          return (query: string) => {
            if (/SET lease_expires_at = \?, updated_at = \?/i.test(query)) {
              heartbeatQueries += 1;
            }
            return target.prepare(query);
          };
        }
        const value = Reflect.get(target, property, target) as unknown;
        return typeof value === "function" ? value.bind(target) : value;
      },
    }) as D1Database;
    const bootstrap = new DatabaseBootstrap(db, env.KV, KEY, {
      kvBatchSize: 2,
    });
    await bootstrap.status();
    await bootstrap.step();
    await bootstrap.step();

    expect(heartbeatQueries).toBeGreaterThanOrEqual(4);
  });

  it("第一次讀取狀態會建立版本化 schema 與可續傳進度", async () => {
    const status = await new DatabaseBootstrap(env.DB, env.KV, KEY).status();

    expect(status).toMatchObject({
      status: "pending",
      phase: "kv_scan",
      schemaVersion: LATEST_SCHEMA_VERSION,
      processed: 0,
      total: 0,
    });
    expect(status.percent).toBeGreaterThanOrEqual(0);
    expect(status.percent).toBeLessThan(100);

    const tables = await env.DB
      .prepare("SELECT name FROM sqlite_schema WHERE type = 'table'")
      .all<{ name: string }>();
    expect(tables.results.map((row) => row.name)).toEqual(
      expect.arrayContaining([
        "schema_meta",
        "bootstrap_state",
        "folders",
        "connections",
        "app_settings",
      ]),
    );
    expect(LATEST_SCHEMA_VERSION).toBe(2);
  });

  it("既有 v1 schema 可無損升級到 v2 設定表", async () => {
    await new DatabaseBootstrap(env.DB, env.KV, KEY).status();
    await env.DB.prepare("DROP TABLE app_settings").run();
    await env.DB
      .prepare("UPDATE schema_meta SET value = '1' WHERE key = 'schema_version'")
      .run();
    await env.DB
      .prepare("UPDATE bootstrap_state SET schema_version = 1 WHERE id = 1")
      .run();
    await env.DB
      .prepare(
        `INSERT INTO connections (
          id, folder_id, payload_envelope, sort_order, created_at, updated_at
        ) VALUES ('keep-me', NULL, 'v2:placeholder', 0, 1, 1)`,
      )
      .run();

    const status = await new DatabaseBootstrap(env.DB, env.KV, KEY).status();

    expect(status.schemaVersion).toBe(2);
    const settingsTable = await env.DB
      .prepare(
        "SELECT name FROM sqlite_schema WHERE type = 'table' AND name = 'app_settings'",
      )
      .first<string>("name");
    expect(settingsTable).toBe("app_settings");
    const preserved = await env.DB
      .prepare("SELECT id FROM connections WHERE id = 'keep-me'")
      .first<string>("id");
    expect(preserved).toBe("keep-me");
  });

  it("分批遷移 v1/v2 KV 連線為 v3，驗證成功後才清除 conn:*", async () => {
    const legacy = connection("legacy-one", "舊格式");
    const current = connection("current-two", "新格式");
    await env.KV.put(
      `conn:${legacy.id}`,
      await encryptLegacyV1(KEY, JSON.stringify(legacy)),
    );
    await env.KV.put(
      `conn:${current.id}`,
      await encryptLegacyV2(KEY, JSON.stringify(current)),
    );
    await env.KV.put("os:keep-me", JSON.stringify({ os: "linux" }));

    const bootstrap = new DatabaseBootstrap(env.DB, env.KV, KEY, {
      kvBatchSize: 1,
      verifyBatchSize: 1,
      cleanupBatchSize: 1,
    });
    const terminal = await runToTerminal(bootstrap);

    expect(terminal).toMatchObject({
      status: "complete",
      phase: "complete",
      processed: 2,
      total: 2,
      percent: 100,
    });
    const rows = await env.DB
      .prepare(
        "SELECT id, folder_id, payload_envelope FROM connections ORDER BY id",
      )
      .all<{
        id: string;
        folder_id: string | null;
        payload_envelope: string;
      }>();
    expect(rows.results).toHaveLength(2);
    expect(rows.results.every((row) => row.folder_id === null)).toBe(true);
    expect(rows.results.every((row) => row.payload_envelope.startsWith("v3:"))).toBe(
      true,
    );
    expect(JSON.stringify(rows.results)).not.toContain("secret-");
    expect((await env.KV.list({ prefix: "conn:" })).keys).toHaveLength(0);
    expect(await env.KV.get("os:keep-me")).not.toBeNull();
  });

  it("Worker 重啟後由 D1 狀態續跑，不重複計數或遺失資料", async () => {
    for (let index = 0; index < 3; index += 1) {
      const item = connection(`resume-${index}`, `續跑 ${index}`);
      await env.KV.put(
        `conn:${item.id}`,
        await encryptString(KEY, JSON.stringify(item)),
      );
    }

    const options = { kvBatchSize: 1, verifyBatchSize: 1, cleanupBatchSize: 1 };
    const firstRunner = new DatabaseBootstrap(env.DB, env.KV, KEY, options);
    await firstRunner.step();
    await firstRunner.step();

    const terminal = await runToTerminal(
      new DatabaseBootstrap(env.DB, env.KV, KEY, options),
    );

    expect(terminal.status).toBe("complete");
    expect(terminal.total).toBe(3);
    const count = await env.DB
      .prepare("SELECT COUNT(*) AS count FROM connections")
      .first<{ count: number }>();
    expect(count?.count).toBe(3);
  });

  it("損毀資料使驗證失敗時保留全部舊 KV 並提供安全錯誤碼", async () => {
    const valid = connection("valid-one", "正常");
    await env.KV.put(
      `conn:${valid.id}`,
      await encryptString(KEY, JSON.stringify(valid)),
    );
    await env.KV.put("conn:broken-two", "not-an-envelope");

    const terminal = await runToTerminal(
      new DatabaseBootstrap(env.DB, env.KV, KEY, {
        kvBatchSize: 2,
        verifyBatchSize: 2,
        cleanupBatchSize: 2,
      }),
    );

    expect(terminal).toMatchObject({
      status: "failed",
      errorCode: "KV_CONNECTION_INVALID",
    });
    expect((await env.KV.list({ prefix: "conn:" })).keys).toHaveLength(2);
    expect(JSON.stringify(terminal)).not.toContain("not-an-envelope");
    expect(JSON.stringify(terminal)).not.toContain("secret-valid-one");
  });
});
