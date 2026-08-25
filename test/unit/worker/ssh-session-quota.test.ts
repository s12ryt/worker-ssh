import { describe, expect, it } from "vitest";
import {
  SshSessionQuota,
  type QuotaStorage,
} from "../../../src/worker/ssh-session-quota";

class MemoryStorage implements QuotaStorage {
  private readonly values = new Map<string, unknown>();

  async get<T>(key: string): Promise<T | undefined> {
    return this.values.get(key) as T | undefined;
  }

  async put<T>(key: string, value: T): Promise<void> {
    this.values.set(key, value);
  }
}

describe("SshSessionQuota", () => {
  it("同登入 session 最多 3 條，全域最多 10 條 active SSH", async () => {
    const storage = new MemoryStorage();
    let now = 1_000;
    const quota = new SshSessionQuota(storage, { now: () => now });

    for (let index = 1; index <= 3; index += 1) {
      await expect(quota.acquire("session-a", `a-${index}`)).resolves.toMatchObject({
        granted: true,
      });
    }
    await expect(quota.acquire("session-a", "a-4")).resolves.toEqual({
      granted: false,
      reason: "session-limit",
    });

    for (let index = 1; index <= 7; index += 1) {
      await expect(quota.acquire(`session-${index}`, `other-${index}`)).resolves.toMatchObject({
        granted: true,
      });
    }
    await expect(quota.acquire("session-z", "global-11")).resolves.toEqual({
      granted: false,
      reason: "global-limit",
    });

    now += 1;
    expect(await quota.activeCount()).toBe(10);
  });

  it("heartbeat 延長租約，release 與過期清理會釋放名額", async () => {
    const storage = new MemoryStorage();
    let now = 5_000;
    const quota = new SshSessionQuota(storage, {
      now: () => now,
      leaseMs: 30_000,
    });

    const acquired = await quota.acquire("session-a", "lease-a");
    expect(acquired).toMatchObject({ granted: true, expiresAt: 35_000 });
    now = 20_000;
    await expect(quota.heartbeat("session-a", "lease-a")).resolves.toBe(true);
    now = 40_000;
    expect(await quota.activeCount()).toBe(1);
    await expect(quota.release("session-a", "lease-a")).resolves.toBe(true);
    expect(await quota.activeCount()).toBe(0);

    await quota.acquire("session-b", "lease-b");
    now = 80_001;
    expect(await quota.activeCount()).toBe(0);
    await expect(quota.heartbeat("session-b", "lease-b")).resolves.toBe(false);
  });

  it("相同 lease 重試 acquire 只續租，不重複占用名額", async () => {
    const storage = new MemoryStorage();
    let now = 10_000;
    const quota = new SshSessionQuota(storage, { now: () => now });

    await quota.acquire("session-a", "lease-a");
    now = 12_000;
    await expect(quota.acquire("session-a", "lease-a")).resolves.toMatchObject({
      granted: true,
    });
    expect(await quota.activeCount()).toBe(1);
  });
});
