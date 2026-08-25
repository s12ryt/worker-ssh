import { describe, it, expect } from "vitest";
import { validateFilename } from "@/frontend/filename-validate";

describe("validateFilename", () => {
  // 合法檔名
  it("合法簡單檔名回 true", () => {
    expect(validateFilename("file.txt")).toBe(true);
  });
  it("合法多副檔名回 true", () => {
    expect(validateFilename("archive.tar.gz")).toBe(true);
  });
  it("合法含空白檔名回 true（非全空白）", () => {
    expect(validateFilename("my file.txt")).toBe(true);
  });
  it("合法含連字號檔名回 true", () => {
    expect(validateFilename("my-file.txt")).toBe(true);
  });
  it("合法中文檔名回 true", () => {
    expect(validateFilename("設定檔.conf")).toBe(true);
  });
  it("合法無副檔名回 true", () => {
    expect(validateFilename("README")).toBe(true);
  });
  it("合法隱藏檔回 true（前導點）", () => {
    expect(validateFilename(".bashrc")).toBe(true);
  });
  it("合法 255 字元長度回 true", () => {
    expect(validateFilename("a".repeat(255))).toBe(true);
  });

  // 非法檔名
  it("空字串回 false", () => {
    expect(validateFilename("")).toBe(false);
  });
  it("全空白回 false", () => {
    expect(validateFilename("   ")).toBe(false);
  });
  it("僅點號 . 回 false", () => {
    expect(validateFilename(".")).toBe(false);
  });
  it("僅雙點 .. 回 false", () => {
    expect(validateFilename("..")).toBe(false);
  });
  it("超過 255 字元回 false", () => {
    expect(validateFilename("a".repeat(256))).toBe(false);
  });

  // 非法字元（Windows 與 POSIX 共識禁用）
  it("含斜線 / 回 false", () => {
    expect(validateFilename("path/to/file.txt")).toBe(false);
  });
  it("含反斜線 \\ 回 false", () => {
    expect(validateFilename("path\\to\\file.txt")).toBe(false);
  });
  it("含冒號 : 回 false", () => {
    expect(validateFilename("file:stream.txt")).toBe(false);
  });
  it("含星號 * 回 false", () => {
    expect(validateFilename("*.txt")).toBe(false);
  });
  it("含問號 ? 回 false", () => {
    expect(validateFilename("?.txt")).toBe(false);
  });
  it("含雙引號 \" 回 false", () => {
    expect(validateFilename('file".txt')).toBe(false);
  });
  it("含小於 < 回 false", () => {
    expect(validateFilename("file<.txt")).toBe(false);
  });
  it("含大於 > 回 false", () => {
    expect(validateFilename("file>.txt")).toBe(false);
  });
  it("含直線 | 回 false", () => {
    expect(validateFilename("file|.txt")).toBe(false);
  });

  // 無效型別
  it("null 回 false", () => {
    expect(validateFilename(null as unknown as string)).toBe(false);
  });
  it("undefined 回 false", () => {
    expect(validateFilename(undefined as unknown as string)).toBe(false);
  });
  it("非字串數字回 false", () => {
    expect(validateFilename(123 as unknown as string)).toBe(false);
  });
});
