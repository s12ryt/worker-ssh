import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:test";
import { DatabaseBootstrap } from "../../../src/worker/d1-bootstrap";
import {
  CredentialRequiredError,
  D1ConnectionStore,
  DuplicateFolderNameError,
  FolderCycleError,
  FolderDepthError,
  TooManyConnectionsToMoveError,
} from "../../../src/worker/d1-store";

const KEY = "test-encryption-key";

const passwordConnection = (name: string) => ({
  name,
  host: `${name.toLowerCase()}.example.test`,
  port: 22,
  username: "tester",
  authType: "password" as const,
  password: `secret-${name}`,
});

async function resetStorage(): Promise<void> {
  const { keys } = await env.KV.list({ prefix: "" });
  await Promise.all(keys.map((key) => env.KV.delete(key.name)));
  await env.DB.exec(`
    DROP TABLE IF EXISTS connections;
    DROP TABLE IF EXISTS folders;
    DROP TABLE IF EXISTS bootstrap_state;
    DROP TABLE IF EXISTS schema_meta;
  `);
  const bootstrap = new DatabaseBootstrap(env.DB, env.KV, KEY);
  await bootstrap.status();
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const status = await bootstrap.step();
    if (status.status === "complete") return;
    if (status.status === "failed") throw new Error(status.errorCode);
  }
  throw new Error("bootstrap did not complete");
}

beforeEach(resetStorage);

describe("D1ConnectionStore 憑證生命週期", () => {
  it("公開 DTO 永不回傳秘密，內部讀取仍可供後端 SSH 使用", async () => {
    const store = new D1ConnectionStore(env.DB, KEY);
    const created = await store.createConnection(passwordConnection("Alpha"));

    expect(created).toMatchObject({
      name: "Alpha",
      credentialState: "ready",
      folderId: null,
    });
    expect(created).not.toHaveProperty("password");
    expect(created).not.toHaveProperty("privateKey");
    expect(created).not.toHaveProperty("passphrase");

    const internal = await store.getConnectionInternal(created.id);
    expect(internal?.password).toBe("secret-Alpha");
    const raw = await env.DB
      .prepare("SELECT payload_envelope FROM connections WHERE id = ?")
      .bind(created.id)
      .first<string>("payload_envelope");
    expect(raw).toMatch(/^v3:/);
    expect(raw).not.toContain("secret-Alpha");
    expect(raw).not.toContain("alpha.example.test");
  });

  it("編輯時空白秘密保留原值，切換認證需新憑證，明確清除後禁止連線", async () => {
    const store = new D1ConnectionStore(env.DB, KEY);
    const created = await store.createConnection(passwordConnection("Beta"));

    const renamed = await store.updateConnection(created.id, {
      name: "Beta renamed",
      password: "",
    });
    expect(renamed?.credentialState).toBe("ready");
    expect((await store.getConnectionInternal(created.id))?.password).toBe(
      "secret-Beta",
    );

    await expect(
      store.updateConnection(created.id, {
        authType: "privateKey",
        privateKey: "",
      }),
    ).rejects.toBeInstanceOf(CredentialRequiredError);

    const cleared = await store.clearCredential(created.id);
    expect(cleared?.credentialState).toBe("missing");
    expect((await store.getConnectionInternal(created.id))?.password).toBeUndefined();
  });
});

describe("D1ConnectionStore 資料夾結構與計數", () => {
  it("資料夾名稱加密，同層名稱忽略大小寫不可重複", async () => {
    const store = new D1ConnectionStore(env.DB, KEY);
    const folder = await store.createFolder("Production");

    expect(folder).toMatchObject({
      name: "Production",
      parentId: null,
      recursiveHostCount: 0,
    });
    const raw = await env.DB
      .prepare("SELECT name_envelope, name_token FROM folders WHERE id = ?")
      .bind(folder.id)
      .first<{ name_envelope: string; name_token: string }>();
    expect(raw?.name_envelope).toMatch(/^v3:/);
    expect(JSON.stringify(raw)).not.toContain("Production");

    await expect(store.createFolder(" production ")).rejects.toBeInstanceOf(
      DuplicateFolderNameError,
    );
  });

  it("移動目的地列表只解密資料夾摘要，不讀取任何連線 payload", async () => {
    const store = new D1ConnectionStore(env.DB, KEY);
    const root = await store.createFolder("Root");
    const child = await store.createFolder("Child", root.id);
    await store.createConnection(passwordConnection("HiddenHost"), child.id);

    const originalPrepare = env.DB.prepare.bind(env.DB);
    const payloadQueries: string[] = [];
    const db = {
      ...env.DB,
      prepare(query: string) {
        if (/payload_envelope/i.test(query)) payloadQueries.push(query);
        return originalPrepare(query);
      },
    } as D1Database;

    const folders = await new D1ConnectionStore(db, KEY).listFolders();
    expect(folders.map((item) => item.name)).toEqual(["Child", "Root"]);
    expect(payloadQueries).toEqual([]);
  });

  it("scoped read 只回直接子資料夾與直接連線，祖先快取遞迴主機數", async () => {
    const store = new D1ConnectionStore(env.DB, KEY);
    const root = await store.createFolder("Root");
    const child = await store.createFolder("Child", root.id);
    const grandchild = await store.createFolder("Grandchild", child.id);
    const rootConn = await store.createConnection(
      passwordConnection("RootHost"),
      root.id,
    );
    const deepConn = await store.createConnection(
      passwordConnection("DeepHost"),
      grandchild.id,
    );

    const rootScope = await store.listScope(root.id);
    expect(rootScope.folder?.recursiveHostCount).toBe(2);
    expect(rootScope.folders.map((item) => item.id)).toEqual([child.id]);
    expect(rootScope.connections.map((item) => item.id)).toEqual([rootConn.id]);
    expect(JSON.stringify(rootScope)).not.toContain(deepConn.host);

    const childScope = await store.listScope(child.id);
    expect(childScope.breadcrumb.map((item) => item.name)).toEqual([
      "Root",
      "Child",
    ]);
    expect(childScope.folder?.recursiveHostCount).toBe(1);
  });

  it("移動連線會原子更新來源與目標全部祖先計數，批量移動亦同", async () => {
    const store = new D1ConnectionStore(env.DB, KEY);
    const left = await store.createFolder("Left");
    const leftChild = await store.createFolder("Left child", left.id);
    const right = await store.createFolder("Right");
    const first = await store.createConnection(passwordConnection("One"), leftChild.id);
    const second = await store.createConnection(passwordConnection("Two"), leftChild.id);

    await store.moveConnections([first.id], right.id);
    expect((await store.getFolder(left.id))?.recursiveHostCount).toBe(1);
    expect((await store.getFolder(right.id))?.recursiveHostCount).toBe(1);

    await store.moveConnections([first.id, second.id], null);
    expect((await store.getFolder(left.id))?.recursiveHostCount).toBe(0);
    expect((await store.getFolder(right.id))?.recursiveHostCount).toBe(0);
    expect((await store.listScope(null)).connections).toHaveLength(2);
  });

  it("批量移動超過 50 個唯一連線時在查詢 D1 前拒絕", async () => {
    const prepare = env.DB.prepare.bind(env.DB);
    let queryCount = 0;
    const guardedDb = {
      ...env.DB,
      prepare(query: string) {
        queryCount += 1;
        return prepare(query);
      },
    } as D1Database;
    const store = new D1ConnectionStore(guardedDb, KEY);

    await expect(
      store.moveConnections(
        Array.from({ length: 51 }, (_, index) => `conn-${index}`),
        null,
      ),
    ).rejects.toBeInstanceOf(TooManyConnectionsToMoveError);
    expect(queryCount).toBe(0);
  });

  it("資料夾移動阻擋循環與第九層，合法移動會轉移整棵子樹計數", async () => {
    const store = new D1ConnectionStore(env.DB, KEY);
    const chain = [];
    let parentId: string | null = null;
    for (let depth = 1; depth <= 8; depth += 1) {
      const folder = await store.createFolder(`Level ${depth}`, parentId);
      chain.push(folder);
      parentId = folder.id;
    }
    await expect(store.createFolder("Level 9", parentId)).rejects.toBeInstanceOf(
      FolderDepthError,
    );
    await expect(store.moveFolder(chain[0]!.id, chain[7]!.id)).rejects.toBeInstanceOf(
      FolderCycleError,
    );

    const source = await store.createFolder("Source");
    const sourceChild = await store.createFolder("Source child", source.id);
    await store.createConnection(passwordConnection("Nested"), sourceChild.id);
    const target = await store.createFolder("Target");
    await store.moveFolder(source.id, target.id);
    expect((await store.getFolder(target.id))?.recursiveHostCount).toBe(1);
    expect((await store.listScope(null)).folders.map((item) => item.id)).not.toContain(
      source.id,
    );
  });

  it("只刪資料夾提升直接內容；全部刪除遞迴移除子樹並扣除祖先計數", async () => {
    const store = new D1ConnectionStore(env.DB, KEY);
    const root = await store.createFolder("Delete root");
    const middle = await store.createFolder("Middle", root.id);
    const leaf = await store.createFolder("Leaf", middle.id);
    const direct = await store.createConnection(passwordConnection("Direct"), middle.id);
    await store.createConnection(passwordConnection("Deep"), leaf.id);

    await store.deleteFolder(middle.id, "promote");
    expect((await store.getConnection(direct.id))?.folderId).toBe(root.id);
    expect((await store.getFolder(leaf.id))?.parentId).toBe(root.id);
    expect((await store.getFolder(root.id))?.recursiveHostCount).toBe(2);

    await store.deleteFolder(leaf.id, "recursive");
    expect(await store.getFolder(leaf.id)).toBeNull();
    expect((await store.getFolder(root.id))?.recursiveHostCount).toBe(1);
  });
});
