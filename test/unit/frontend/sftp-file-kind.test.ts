import { describe, expect, it } from "vitest";
import { fileKindOf } from "@/frontend/sftp-file-kind";

describe("fileKindOf", () => {
  it("資料夾不論名稱回 folder", () => {
    expect(fileKindOf("anything", true)).toBe("folder");
    expect(fileKindOf("no-extension", true)).toBe("folder");
  });

  it("壓縮檔 → archive", () => {
    expect(fileKindOf("backup.zip", false)).toBe("archive");
    expect(fileKindOf("data.7z", false)).toBe("archive");
    expect(fileKindOf("arc.rar", false)).toBe("archive");
  });

  it("壓縮檔大小寫不敏感", () => {
    expect(fileKindOf("BACKUP.ZIP", false)).toBe("archive");
    expect(fileKindOf("Index.HTML", false)).toBe("doc");
  });

  it("雙副檔名 .tar.gz 視為 archive", () => {
    expect(fileKindOf("src.tar.gz", false)).toBe("archive");
    expect(fileKindOf("backup.tar.bz2", false)).toBe("archive");
  });

  it("tgz/tbz2 簡寫視為 archive", () => {
    expect(fileKindOf("snap.tgz", false)).toBe("archive");
    expect(fileKindOf("snap.tbz2", false)).toBe("archive");
  });

  it("程式碼 → code", () => {
    expect(fileKindOf("app.js", false)).toBe("code");
    expect(fileKindOf("main.go", false)).toBe("code");
    expect(fileKindOf("mod.ts", false)).toBe("code");
    expect(fileKindOf("script.sh", false)).toBe("code");
  });

  it("圖片 → image", () => {
    expect(fileKindOf("logo.png", false)).toBe("image");
    expect(fileKindOf("photo.jpeg", false)).toBe("image");
    expect(fileKindOf("icon.svg", false)).toBe("image");
  });

  it("文件 → doc", () => {
    expect(fileKindOf("README.md", false)).toBe("doc");
    expect(fileKindOf("guide.pdf", false)).toBe("doc");
    expect(fileKindOf("notes.txt", false)).toBe("doc");
    expect(fileKindOf("data.json", false)).toBe("doc");
  });

  it("二進位 → binary", () => {
    expect(fileKindOf("app.exe", false)).toBe("binary");
    expect(fileKindOf("lib.so", false)).toBe("binary");
    expect(fileKindOf("win.dll", false)).toBe("binary");
    expect(fileKindOf("app.jar", false)).toBe("binary");
  });

  it("無副檔名回 file", () => {
    expect(fileKindOf("README", false)).toBe("file");
    expect(fileKindOf("Makefile", false)).toBe("file");
  });

  it("隱藏檔（開頭為點）回 file", () => {
    expect(fileKindOf(".bashrc", false)).toBe("file");
    expect(fileKindOf(".gitignore", false)).toBe("file");
  });

  it("未知副檔名回 file", () => {
    expect(fileKindOf("data.xyz", false)).toBe("file");
    expect(fileKindOf("foo.unknown", false)).toBe("file");
  });
});
