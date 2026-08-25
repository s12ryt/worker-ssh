import { describe, expect, it } from "vitest";
import {
  readDbReadyCache,
  resetDbReadyCache,
  writeDbReadyCache,
} from "../../../src/worker/db-ready-cache";

/**
 * db-ready-cache：isolate 級資料庫就緒快取
 *
 * 契約：
 * - 預設未就緒（read false）
 * - write(ok=true) 後於 TTL 內 read true
 * - TTL 過期後 read false（時間由呼叫端注入）
 * - write(ok=false) 永遠 read false
 * - reset 清除快取
 */
describe("db-ready-cache", () => {
  it("預設未就緒", () => {
    resetDbReadyCache();
    expect(readDbReadyCache(1_000)).toBe(false);
  });

  it("寫入 ok=true 後 TTL 內就緒", () => {
    resetDbReadyCache();
    writeDbReadyCache(true, 1_000, 60_000);
    expect(readDbReadyCache(1_000)).toBe(true);
    expect(readDbReadyCache(60_999)).toBe(true);
  });

  it("TTL 過期後回到未就緒", () => {
    resetDbReadyCache();
    writeDbReadyCache(true, 1_000, 60_000);
    expect(readDbReadyCache(61_000)).toBe(false);
  });

  it("寫入 ok=false 不快取就緒", () => {
    resetDbReadyCache();
    writeDbReadyCache(false, 1_000, 60_000);
    expect(readDbReadyCache(1_000)).toBe(false);
  });

  it("reset 清除就緒快取", () => {
    writeDbReadyCache(true, 1_000, 60_000);
    resetDbReadyCache();
    expect(readDbReadyCache(1_000)).toBe(false);
  });
});
