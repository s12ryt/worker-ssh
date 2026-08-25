import { describe, expect, it } from "vitest";
import { decodePreviewText, isPreviewable } from "@/frontend/sftp-preview";

describe("isPreviewable", () => {
  it("資料夾一律不可預覽", () => {
    expect(isPreviewable({ name: "docs", isDir: true, size: 0 })).toBe(false);
    expect(isPreviewable({ name: "subfolder", isDir: true, size: 100 })).toBe(false);
  });

  it("二進位檔不可預覽", () => {
    expect(isPreviewable({ name: "app.exe", isDir: false, size: 1000 })).toBe(false);
    expect(isPreviewable({ name: "lib.so", isDir: false, size: 1000 })).toBe(false);
    expect(isPreviewable({ name: "win.dll", isDir: false, size: 1000 })).toBe(false);
    expect(isPreviewable({ name: "module.wasm", isDir: false, size: 1000 })).toBe(false);
  });

  it("壓縮檔不可預覽", () => {
    expect(isPreviewable({ name: "backup.zip", isDir: false, size: 1000 })).toBe(false);
    expect(isPreviewable({ name: "src.tar.gz", isDir: false, size: 1000 })).toBe(false);
    expect(isPreviewable({ name: "snap.tgz", isDir: false, size: 1000 })).toBe(false);
  });

  it("圖片檔不可預覽", () => {
    expect(isPreviewable({ name: "logo.png", isDir: false, size: 1000 })).toBe(false);
    expect(isPreviewable({ name: "photo.jpeg", isDir: false, size: 1000 })).toBe(false);
  });

  it("程式碼檔可預覽", () => {
    expect(isPreviewable({ name: "app.js", isDir: false, size: 100 })).toBe(true);
    expect(isPreviewable({ name: "main.go", isDir: false, size: 100 })).toBe(true);
    expect(isPreviewable({ name: "mod.ts", isDir: false, size: 100 })).toBe(true);
    expect(isPreviewable({ name: "script.sh", isDir: false, size: 100 })).toBe(true);
  });

  it("文件檔可預覽", () => {
    expect(isPreviewable({ name: "README.md", isDir: false, size: 100 })).toBe(true);
    expect(isPreviewable({ name: "notes.txt", isDir: false, size: 100 })).toBe(true);
    expect(isPreviewable({ name: "data.json", isDir: false, size: 100 })).toBe(true);
    expect(isPreviewable({ name: "config.yaml", isDir: false, size: 100 })).toBe(true);
  });

  it("未知副檔名仍可預覽（fallback TextDecoder + highlightAuto）", () => {
    expect(isPreviewable({ name: "data.xyz", isDir: false, size: 100 })).toBe(true);
    expect(isPreviewable({ name: "foo.unknown", isDir: false, size: 100 })).toBe(true);
  });

  it("無副檔名仍可預覽（嘗試 TextDecoder）", () => {
    expect(isPreviewable({ name: "README", isDir: false, size: 100 })).toBe(true);
    expect(isPreviewable({ name: "Makefile", isDir: false, size: 100 })).toBe(true);
  });

  it("剛好等於上限可預覽", () => {
    expect(
      isPreviewable({ name: "large.txt", isDir: false, size: 1024 * 1024 }),
    ).toBe(true);
  });

  it("超過上限不可預覽", () => {
    expect(
      isPreviewable({ name: "huge.txt", isDir: false, size: 1024 * 1024 + 1 }),
    ).toBe(false);
  });

  it("size 為 0 可預覽（空檔案）", () => {
    expect(isPreviewable({ name: "empty.txt", isDir: false, size: 0 })).toBe(true);
  });

  it("size 為負不可預覽（異常值防呆）", () => {
    expect(isPreviewable({ name: "bad.txt", isDir: false, size: -1 })).toBe(false);
  });

  it("size 非有限數不可預覽", () => {
    expect(
      isPreviewable({ name: "nan.txt", isDir: false, size: Number.NaN }),
    ).toBe(false);
    expect(
      isPreviewable({ name: "inf.txt", isDir: false, size: Number.POSITIVE_INFINITY }),
    ).toBe(false);
  });
});

describe("decodePreviewText", () => {
  it("空 Uint8Array 回空字串", () => {
    expect(decodePreviewText(new Uint8Array(0))).toBe("");
  });

  it("純 ASCII 文字正確解碼", () => {
    const bytes = new TextEncoder().encode("hello world\n");
    expect(decodePreviewText(bytes)).toBe("hello world\n");
  });

  it("UTF-8 多位元組文字（中文）正確解碼", () => {
    const bytes = new TextEncoder().encode("你好世界");
    expect(decodePreviewText(bytes)).toBe("你好世界");
  });

  it("少量 U+FFFD（< 10%）視為合法文字，回傳解碼結果", () => {
    // 19 個 ASCII + 1 個無效位元組 = 1/20 = 5%，應通過
    const bytes = new Uint8Array([
      0x68, 0x69, 0x2c, 0x20, 0x77, 0x6f, 0x72, 0x6c, 0x64, 0x21,
      0x68, 0x69, 0x2c, 0x20, 0x77, 0x6f, 0x72, 0x6c, 0x64, 0xff,
    ]);
    const result = decodePreviewText(bytes);
    expect(result).toContain("hi, world");
    expect(result).toContain("\uFFFD");
  });

  it("大量 U+FFFD（≥ 10%）視為二進位，回傳 null", () => {
    // 全部無效位元組：5 個 0xff = 5 個 U+FFFD，比例 100%
    const bytes = new Uint8Array([0xff, 0xff, 0xff, 0xff, 0xff]);
    expect(decodePreviewText(bytes)).toBe(null);
  });

  it("剛好 10% U+FFFD 視為二進位（邊界值，回傳 null）", () => {
    // 9 個 ASCII + 1 個 0xff = 1/10 = 10%，邊界值視為二進位
    const bytes = new Uint8Array([
      0x61, 0x62, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68, 0x69, 0xff,
    ]);
    expect(decodePreviewText(bytes)).toBe(null);
  });

  it("9.9% U+FFFD 視為合法文字（邊界值下方）", () => {
    // 91 個 ASCII + 9 個 0xff = 9/100 = 9%（保守測邊界下方）
    const arr = new Uint8Array(100);
    for (let i = 0; i < 91; i++) arr[i] = 0x61; // 'a'
    for (let i = 91; i < 100; i++) arr[i] = 0xff;
    const result = decodePreviewText(arr);
    expect(result).not.toBe(null);
    expect(result!.length).toBeGreaterThan(0);
  });

  it("空字串解碼不視為二進位（0 個 U+FFFD，比例 0%）", () => {
    // 已由空 Uint8Array 測試涵蓋；此處確保非空但無無效位元組
    const bytes = new TextEncoder().encode("a");
    expect(decodePreviewText(bytes)).toBe("a");
  });
});
