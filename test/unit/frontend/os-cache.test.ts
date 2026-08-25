import { describe, expect, it, vi } from "vitest";
import { OsCache } from "@/frontend/os-cache";
import type { OsInfo } from "@/shared/types";

const INFO: OsInfo = {
  os: "ubuntu",
  family: "linux",
  distro: "Ubuntu",
  version: "24.04",
  detectedAt: 1767225600000,
};

describe("OsCache", () => {
  it("miss 時呼叫 loader 並快取；第二次 fetch 不再呼叫 loader", async () => {
    const loader = vi.fn().mockResolvedValue(INFO);
    const cache = new OsCache();
    expect(await cache.fetch("h:22", loader)).toEqual(INFO);
    expect(await cache.fetch("h:22", loader)).toEqual(INFO);
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("loader 回 null（KV 未命中）不快取，下次仍會嘗試", async () => {
    const loader = vi.fn().mockResolvedValue(null);
    const cache = new OsCache();
    expect(await cache.fetch("h:22", loader)).toBeNull();
    await cache.fetch("h:22", loader);
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it("並發 fetch 同一 key 去重：只呼叫 loader 一次且各拿到同結果", async () => {
    let calls = 0;
    const cache = new OsCache();
    const [a, b] = await Promise.all([
      cache.fetch("h:22", async () => {
        calls++;
        return INFO;
      }),
      cache.fetch("h:22", async () => {
        calls++;
        return INFO;
      }),
    ]);
    expect(calls).toBe(1);
    expect(a).toEqual(INFO);
    expect(b).toEqual(INFO);
  });

  it("put 直接寫入記憶體快取（偵測後立即生效）", async () => {
    const cache = new OsCache();
    cache.put("h:22", INFO);
    const loader = vi.fn();
    expect(await cache.fetch("h:22", loader)).toEqual(INFO);
    expect(loader).not.toHaveBeenCalled();
  });

  it("loader 拋錯：不快取失敗結果，下次可重試", async () => {
    const loader = vi.fn().mockRejectedValue(new Error("網路錯誤"));
    const cache = new OsCache();
    await expect(cache.fetch("h:22", loader)).rejects.toThrow("網路錯誤");
    const ok = vi.fn().mockResolvedValue(INFO);
    expect(await cache.fetch("h:22", ok)).toEqual(INFO);
  });
});
