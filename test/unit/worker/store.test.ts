import { beforeEach, describe, expect, it, vi } from "vitest";
import { env } from "cloudflare:test";
import { ConnectionStore, OsCache, hostKeyOf } from "../../../src/worker/store";
import { decryptStringDetailed, encryptString } from "../../../src/worker/crypto";
import { encryptLegacyV1 } from "./crypto-fixtures";

const KEY = "test-encryption-key";

const baseInput = {
  name: "我的伺服器",
  host: "192.168.1.10",
  port: 22,
  username: "root",
  authType: "password" as const,
  password: "s3cr3t-密碼",
};

beforeEach(async () => {
  // 清空 KV（miniflare 每次測試重置，此處防禦性清理）
  const { keys } = await env.KV.list({ prefix: "" });
  await Promise.all(keys.map((k) => env.KV.delete(k.name)));
});

describe("ConnectionStore", () => {
  it("create 後可由 get 取回完整設定", async () => {
    const store = new ConnectionStore(env.KV, KEY);
    const created = await store.create(baseInput);
    expect(created.id).toBeTruthy();
    expect(created.createdAt).toBeGreaterThan(0);
    const fetched = await store.get(created.id);
    expect(fetched).toMatchObject(baseInput);
  });

  it("KV 原始儲存值不含明文敏感資料", async () => {
    const store = new ConnectionStore(env.KV, KEY);
    const created = await store.create(baseInput);
    const raw = await env.KV.get(`conn:${created.id}`);
    expect(raw).toBeTruthy();
    expect(raw).not.toContain("s3cr3t-密碼");
    expect(raw).not.toContain("192.168.1.10");
    expect(raw?.startsWith("v2:")).toBe(true);
  });

  it("list 回傳所有連線（解密後）", async () => {
    const store = new ConnectionStore(env.KV, KEY);
    await store.create(baseInput);
    await store.create({ ...baseInput, name: "第二台", host: "10.0.0.2" });
    const all = await store.list();
    expect(all.length).toBe(2);
    expect(all.map((c) => c.name).sort()).toEqual(["我的伺服器", "第二台"]);
  });

  it("list 依 cursor 讀取所有 KV 分頁", async () => {
    const first = {
      ...baseInput,
      id: "first",
      createdAt: 1,
      updatedAt: 1,
    };
    const second = {
      ...baseInput,
      id: "second",
      name: "第二頁",
      createdAt: 2,
      updatedAt: 2,
    };
    const values = new Map([
      ["conn:first", await encryptString(KEY, JSON.stringify(first))],
      ["conn:second", await encryptString(KEY, JSON.stringify(second))],
    ]);
    const list = vi
      .fn()
      .mockResolvedValueOnce({
        keys: [{ name: "conn:first" }],
        list_complete: false,
        cursor: "page-2",
      })
      .mockResolvedValueOnce({
        keys: [{ name: "conn:second" }],
        list_complete: true,
      });
    const kv = {
      list,
      get: vi.fn(async (key: string | string[]) =>
        Array.isArray(key)
          ? new Map(key.map((name) => [name, values.get(name) ?? null]))
          : (values.get(key) ?? null),
      ),
    } as unknown as KVNamespace;

    const all = await new ConnectionStore(kv, KEY).list();

    expect(all.map((item) => item.id)).toEqual(["first", "second"]);
    expect(list).toHaveBeenNthCalledWith(1, { prefix: "conn:" });
    expect(list).toHaveBeenNthCalledWith(2, {
      prefix: "conn:",
      cursor: "page-2",
    });
  });

  it("list 以每批最多 100 個 key 的 KV bulk get 讀取大量連線", async () => {
    const count = 250;
    const values = new Map<string, string>();
    for (let index = 0; index < count; index += 1) {
      const config = {
        ...baseInput,
        id: `bounded-${index}`,
        name: `bounded-${index}`,
        createdAt: index,
        updatedAt: index,
      };
      values.set(
        `conn:${config.id}`,
        await encryptString(KEY, JSON.stringify(config)),
      );
    }
    const batchSizes: number[] = [];
    const kv = {
      list: vi.fn().mockResolvedValue({
        keys: [...values.keys()].map((name) => ({ name })),
        list_complete: true,
      }),
      get: vi.fn(async (keys: string | string[]) => {
        if (!Array.isArray(keys)) {
          throw new Error("list 必須使用 KV bulk get");
        }
        batchSizes.push(keys.length);
        return new Map(keys.map((key) => [key, values.get(key) ?? null]));
      }),
    } as unknown as KVNamespace;

    const all = await new ConnectionStore(kv, KEY).list();

    expect(all).toHaveLength(count);
    expect(batchSizes).toEqual([100, 100, 50]);
  });

  it("分批遷移只改寫 v1，完成後留下 marker 且重複呼叫不重寫", async () => {
    const legacy = {
      ...baseInput,
      id: "legacy-migrate",
      createdAt: 1,
      updatedAt: 1,
    };
    const current = {
      ...baseInput,
      id: "already-v2",
      name: "already-v2",
      createdAt: 2,
      updatedAt: 2,
    };
    const legacyRaw = await encryptLegacyV1(KEY, JSON.stringify(legacy));
    const currentRaw = await encryptString(KEY, JSON.stringify(current));
    await env.KV.put("conn:legacy-migrate", legacyRaw);
    await env.KV.put("conn:already-v2", currentRaw);

    const store = new ConnectionStore(env.KV, KEY);
    const result = await store.migrateLegacyBatch(undefined, 10);

    expect(result).toMatchObject({
      done: true,
      scanned: 2,
      migrated: 1,
      failed: 0,
      conflicts: 0,
    });
    const migratedRaw = await env.KV.get("conn:legacy-migrate");
    expect(migratedRaw?.startsWith("v2:")).toBe(true);
    await expect(decryptStringDetailed(KEY, migratedRaw!)).resolves.toMatchObject({
      version: "v2",
      plaintext: JSON.stringify(legacy),
    });
    expect(await env.KV.get("conn:already-v2")).toBe(currentRaw);

    await expect(store.migrateLegacyBatch(undefined, 10)).resolves.toMatchObject({
      done: true,
      scanned: 0,
      migrated: 0,
    });
  });

  it("分批遷移回傳可續傳 cursor，下一批從 KV cursor 繼續", async () => {
    const firstRaw = await encryptLegacyV1(KEY, JSON.stringify({
      ...baseInput,
      id: "first-page",
      createdAt: 1,
      updatedAt: 1,
    }));
    const secondRaw = await encryptLegacyV1(KEY, JSON.stringify({
      ...baseInput,
      id: "second-page",
      createdAt: 2,
      updatedAt: 2,
    }));
    const values = new Map([
      ["conn:first-page", firstRaw],
      ["conn:second-page", secondRaw],
    ]);
    const list = vi
      .fn()
      .mockResolvedValueOnce({
        keys: [{ name: "conn:first-page" }],
        list_complete: false,
        cursor: "kv-page-2",
      })
      .mockResolvedValueOnce({
        keys: [{ name: "conn:second-page" }],
        list_complete: true,
      });
    const kv = {
      list,
      get: vi.fn(async (key: string) => values.get(key) ?? null),
      put: vi.fn(async (key: string, value: string) => {
        values.set(key, value);
      }),
    } as unknown as KVNamespace;
    const store = new ConnectionStore(kv, KEY);

    const first = await store.migrateLegacyBatch(undefined, 1);
    expect(first.done).toBe(false);
    expect(first.cursor).toEqual(expect.any(String));
    const second = await store.migrateLegacyBatch(first.cursor, 1);

    expect(second.done).toBe(true);
    expect(list).toHaveBeenNthCalledWith(1, { prefix: "conn:", limit: 1 });
    expect(list).toHaveBeenNthCalledWith(2, {
      prefix: "conn:",
      limit: 1,
      cursor: "kv-page-2",
    });
  });

  it("分批遷移偵測同時更新，不覆寫已變更的原始值", async () => {
    const legacyRaw = await encryptLegacyV1(KEY, JSON.stringify({
      ...baseInput,
      id: "racing",
      createdAt: 1,
      updatedAt: 1,
    }));
    const newerRaw = await encryptString(KEY, JSON.stringify({
      ...baseInput,
      id: "racing",
      name: "同時更新後",
      createdAt: 1,
      updatedAt: 2,
    }));
    const get = vi
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(legacyRaw)
      .mockResolvedValueOnce(newerRaw);
    const put = vi.fn();
    const kv = {
      list: vi.fn().mockResolvedValue({
        keys: [{ name: "conn:racing" }],
        list_complete: true,
      }),
      get,
      put,
    } as unknown as KVNamespace;

    const result = await new ConnectionStore(kv, KEY).migrateLegacyBatch(
      undefined,
      10,
    );

    expect(result).toMatchObject({ migrated: 0, conflicts: 1, failed: 0 });
    expect(put).not.toHaveBeenCalledWith("conn:racing", expect.any(String));
  });

  it("update 修改部分欄位並更新 updatedAt", async () => {
    const store = new ConnectionStore(env.KV, KEY);
    const created = await store.create(baseInput);
    await new Promise((r) => setTimeout(r, 5));
    const updated = await store.update(created.id, { name: "改名", port: 2222 });
    expect(updated?.name).toBe("改名");
    expect(updated?.port).toBe(2222);
    expect(updated?.username).toBe("root"); // 未動欄位保留
    expect(updated!.updatedAt).toBeGreaterThanOrEqual(created.updatedAt);
  });

  it("host key 信任資料可保存並以 undefined 清除", async () => {
    const store = new ConnectionStore(env.KV, KEY);
    const created = await store.create(baseInput);
    const trusted = await store.update(created.id, {
      hostKeyType: "ssh-ed25519",
      hostKeyFingerprint: "SHA256:trusted-key",
    });
    expect(trusted?.hostKeyType).toBe("ssh-ed25519");
    expect(trusted?.hostKeyFingerprint).toBe("SHA256:trusted-key");

    const reset = await store.update(created.id, {
      hostKeyType: undefined,
      hostKeyFingerprint: undefined,
    });
    expect(reset?.hostKeyType).toBeUndefined();
    expect(reset?.hostKeyFingerprint).toBeUndefined();
    await expect(store.get(created.id)).resolves.toMatchObject({
      id: created.id,
    });
    expect((await store.get(created.id))?.hostKeyFingerprint).toBeUndefined();
  });

  it("update 不存在的 id 回傳 null", async () => {
    const store = new ConnectionStore(env.KV, KEY);
    await expect(store.update("no-such-id", { name: "x" })).resolves.toBeNull();
  });

  it("remove 刪除成功回 true，再查為 null；刪除不存在回 false", async () => {
    const store = new ConnectionStore(env.KV, KEY);
    const created = await store.create(baseInput);
    await expect(store.remove(created.id)).resolves.toBe(true);
    await expect(store.get(created.id)).resolves.toBeNull();
    await expect(store.remove(created.id)).resolves.toBe(false);
  });

  it("私鑰型別連線完整保存 privateKey 與 passphrase", async () => {
    const store = new ConnectionStore(env.KV, KEY);
    const created = await store.create({
      name: "key-host",
      host: "example.com",
      port: 22,
      username: "deploy",
      authType: "privateKey",
      privateKey: "layout-only-private-key-fixture",
      passphrase: "key-pass",
    });
    const fetched = await store.get(created.id);
    expect(fetched?.authType).toBe("privateKey");
    expect(fetched?.privateKey).toBe("layout-only-private-key-fixture");
    expect(fetched?.passphrase).toBe("key-pass");
  });

  // ── D20：連線時間雲同步（lastConnectedAt / lastDisconnectedAt） ──

  it("create 後 lastConnectedAt 與 lastDisconnectedAt 為 undefined（尚未連線）", async () => {
    const store = new ConnectionStore(env.KV, KEY);
    const created = await store.create(baseInput);
    expect(created.lastConnectedAt).toBeUndefined();
    expect(created.lastDisconnectedAt).toBeUndefined();
    const fetched = await store.get(created.id);
    expect(fetched?.lastConnectedAt).toBeUndefined();
    expect(fetched?.lastDisconnectedAt).toBeUndefined();
  });

  it("update 帶 lastConnectedAt 數字後可取回且updatedAt前進", async () => {
    const store = new ConnectionStore(env.KV, KEY);
    const created = await store.create(baseInput);
    const ts = 1710000000000;
    const updated = await store.update(created.id, { lastConnectedAt: ts });
    expect(updated?.lastConnectedAt).toBe(ts);
    expect(updated?.lastDisconnectedAt).toBeUndefined();
    expect(updated!.updatedAt).toBeGreaterThanOrEqual(created.updatedAt);
    const fetched = await store.get(created.id);
    expect(fetched?.lastConnectedAt).toBe(ts);
  });

  it("update 帶 lastDisconnectedAt 數字後可取回，不覆蓋 lastConnectedAt", async () => {
    const store = new ConnectionStore(env.KV, KEY);
    const created = await store.create(baseInput);
    const connectTs = 1710000000000;
    const disconnectTs = 1710000005000;
    await store.update(created.id, { lastConnectedAt: connectTs });
    const updated = await store.update(created.id, { lastDisconnectedAt: disconnectTs });
    expect(updated?.lastConnectedAt).toBe(connectTs);
    expect(updated?.lastDisconnectedAt).toBe(disconnectTs);
  });

  it("容錯讀取：KV 中舊資料無此欄位時 get 不拋錯且欄位為 undefined", async () => {
    // 模擬 D20 變更前寫入的舊資料（JSON 不含時間欄位）
    const legacy: Record<string, unknown> = {
      id: "legacy-id",
      name: "舊主機",
      host: "1.2.3.4",
      port: 22,
      username: "root",
      authType: "password",
      password: "old-pass",
      createdAt: 1700000000000,
      updatedAt: 1700000000000,
    };
    await env.KV.put(
      "conn:legacy-id",
      await encryptLegacyV1(KEY, JSON.stringify(legacy)),
    );
    const store = new ConnectionStore(env.KV, KEY);
    const fetched = await store.get("legacy-id");
    expect(fetched).not.toBeNull();
    expect(fetched?.lastConnectedAt).toBeUndefined();
    expect(fetched?.lastDisconnectedAt).toBeUndefined();
    expect(fetched?.name).toBe("舊主機");
  });
});

describe("OsCache", () => {
  it("put 後 get 取回快取", async () => {
    const cache = new OsCache(env.KV);
    const info = { os: "ubuntu", family: "linux", distro: "Ubuntu", version: "24.04", detectedAt: Date.now() };
    await cache.put(await hostKeyOf("h1", 22, "u"), info);
    await expect(cache.get(await hostKeyOf("h1", 22, "u"))).resolves.toMatchObject(info);
  });

  it("未快取回傳 null", async () => {
    const cache = new OsCache(env.KV);
    await expect(cache.get(await hostKeyOf("never", 22, "u"))).resolves.toBeNull();
  });
});

describe("hostKeyOf", () => {
  it("決定性：同輸入同輸出", async () => {
    expect(await hostKeyOf("a", 22, "u")).toBe(await hostKeyOf("a", 22, "u"));
  });
  it("不同輸入產生不同 key", async () => {
    const a = await hostKeyOf("a", 22, "u");
    const b = await hostKeyOf("b", 22, "u");
    const c = await hostKeyOf("a", 2222, "u");
    expect(a).not.toBe(b);
    expect(a).not.toBe(c);
  });
});
