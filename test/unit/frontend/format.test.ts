import { describe, expect, it } from "vitest";
import { formatLastConnected } from "@/frontend/format";

const NOW = new Date("2026-08-22T12:00:00Z").getTime();

describe("formatLastConnected", () => {
  it("undefined 回「尚未連線」", () => {
    expect(formatLastConnected(undefined, NOW)).toBe("尚未連線");
  });

  it("null 回「尚未連線」", () => {
    expect(formatLastConnected(null, NOW)).toBe("尚未連線");
  });

  it("未來時間視為無效，回「尚未連線」", () => {
    expect(formatLastConnected(NOW + 10_000, NOW)).toBe("尚未連線");
  });

  it("小於 1 分鐘回「剛剛連線」", () => {
    expect(formatLastConnected(NOW - 30_000, NOW)).toBe("剛剛連線");
    expect(formatLastConnected(NOW - 59_999, NOW)).toBe("剛剛連線");
  });

  it("1～59 分鐘回「X 分鐘前」", () => {
    expect(formatLastConnected(NOW - 60_000, NOW)).toBe("1 分鐘前");
    expect(formatLastConnected(NOW - 5 * 60_000, NOW)).toBe("5 分鐘前");
    expect(formatLastConnected(NOW - 59 * 60_000, NOW)).toBe("59 分鐘前");
  });

  it("1～23 小時回「X 小時前」", () => {
    expect(formatLastConnected(NOW - 60 * 60_000, NOW)).toBe("1 小時前");
    expect(formatLastConnected(NOW - 5 * 60 * 60_000, NOW)).toBe("5 小時前");
    expect(formatLastConnected(NOW - 23 * 60 * 60_000, NOW)).toBe("23 小時前");
  });

  it("1～6 天回「X 天前」", () => {
    expect(formatLastConnected(NOW - 24 * 60 * 60_000, NOW)).toBe("1 天前");
    expect(formatLastConnected(NOW - 3 * 24 * 60 * 60_000, NOW)).toBe("3 天前");
    expect(formatLastConnected(NOW - 6 * 24 * 60 * 60_000, NOW)).toBe("6 天前");
  });

  it("7 天以上回 YYYY-MM-DD 日期", () => {
    // 7 天前
    expect(formatLastConnected(NOW - 7 * 24 * 60 * 60_000, NOW)).toBe("2026-08-15");
    // 30 天前
    expect(formatLastConnected(NOW - 30 * 24 * 60 * 60_000, NOW)).toBe("2026-07-23");
  });

  it("未傳 now 預設使用 Date.now（不拋錯）", () => {
    const ts = Date.now() - 30_000;
    expect(formatLastConnected(ts)).toBe("剛剛連線");
  });
});
