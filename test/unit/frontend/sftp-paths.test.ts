import { describe, expect, it } from "vitest";
import { joinPath, parentOf } from "@/frontend/sftp-paths";

describe("joinPath", () => {
  it("一般串接", () => {
    expect(joinPath("/var", "log")).toBe("/var/log");
  });

  it("根目錄不產生雙斜線", () => {
    expect(joinPath("/", "etc")).toBe("/etc");
  });

  it("名稱含空白保留原樣", () => {
    expect(joinPath("/home/u", "my file.txt")).toBe("/home/u/my file.txt");
  });
});

describe("parentOf", () => {
  it("深層路徑回上一層", () => {
    expect(parentOf("/var/log/app")).toBe("/var/log");
  });

  it("第一層回根目錄", () => {
    expect(parentOf("/etc")).toBe("/");
  });

  it("根目錄的父層仍是根目錄", () => {
    expect(parentOf("/")).toBe("/");
  });
});
