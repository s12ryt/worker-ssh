import { describe, expect, it } from "vitest";
import { OS_ICONS } from "@/frontend/icons-data";
import { WINDOWS_FALLBACK, iconForOs } from "@/frontend/icons";

describe("iconForOs", () => {
  it("直接命中：ubuntu 回 Ubuntu 品牌資料", () => {
    const icon = iconForOs("ubuntu");
    expect(icon.title).toBe("Ubuntu");
    expect(icon.hex).toBe("E95420");
    expect(icon.path.length).toBeGreaterThan(10);
  });

  it("大小寫與空白正規化", () => {
    expect(iconForOs(" Ubuntu ").title).toBe("Ubuntu");
  });

  it("別名：apple → macos", () => {
    expect(iconForOs("apple").title).toBe("Apple");
  });

  it("別名：rocky → rockylinux", () => {
    expect(iconForOs("rocky").title).toBe("Rocky Linux");
  });

  it("windows：回自繪備援圖示（非空 path、品牌藍）", () => {
    const icon = iconForOs("windows");
    expect(icon.title).toBe("Windows");
    expect(icon.hex).toBe("0078D6");
    expect(icon.path.length).toBeGreaterThan(10);
  });

  it("未知 os：回退 linux 圖示", () => {
    expect(iconForOs("templeos")).toEqual(OS_ICONS["linux"]);
  });
});

describe("WINDOWS_FALLBACK", () => {
  it("為獨立定義且形狀完整", () => {
    expect(WINDOWS_FALLBACK.hex).toBe("0078D6");
    expect(WINDOWS_FALLBACK.path).toMatch(/M/);
  });
});

describe("OS_ICONS 資料完整性", () => {
  it("每個條目都有非空 path/hex/title", () => {
    for (const [key, icon] of Object.entries(OS_ICONS)) {
      expect(icon.path.length, `${key}.path`).toBeGreaterThan(10);
      expect(/^[0-9A-Fa-f]{6}$/.test(icon.hex), `${key}.hex=${icon.hex}`).toBe(true);
      expect(icon.title.length, `${key}.title`).toBeGreaterThan(0);
    }
  });
});
