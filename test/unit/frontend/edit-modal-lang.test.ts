import { describe, it, expect } from "vitest";
import { resolveLangExportName } from "@/frontend/edit-modal";

// B4 bug 修復回歸測試
// 根因：preloadLanguage 用 mod[lang] 取模組匯出，但 typescript/c 的匯出名稱不同
describe("resolveLangExportName", () => {
  it("typescript 映射到 javascript（lang-javascript 匯出 javascript 函數）", () => {
    expect(resolveLangExportName("typescript")).toBe("javascript");
  });

  it("c 映射到 cpp（lang-cpp 匯出 cpp 函數）", () => {
    expect(resolveLangExportName("c")).toBe("cpp");
  });

  it("javascript 映射到自身", () => {
    expect(resolveLangExportName("javascript")).toBe("javascript");
  });

  it("cpp 映射到自身", () => {
    expect(resolveLangExportName("cpp")).toBe("cpp");
  });

  it("python 映射到自身", () => {
    expect(resolveLangExportName("python")).toBe("python");
  });

  it("go 映射到自身", () => {
    expect(resolveLangExportName("go")).toBe("go");
  });

  it("rust 映射到自身", () => {
    expect(resolveLangExportName("rust")).toBe("rust");
  });

  it("java 映射到自身", () => {
    expect(resolveLangExportName("java")).toBe("java");
  });

  it("php 映射到自身", () => {
    expect(resolveLangExportName("php")).toBe("php");
  });

  it("sql 映射到自身", () => {
    expect(resolveLangExportName("sql")).toBe("sql");
  });

  it("未知語言映射到自身（fallback）", () => {
    expect(resolveLangExportName("unknown")).toBe("unknown");
  });

  it("空字串映射到自身", () => {
    expect(resolveLangExportName("")).toBe("");
  });
});
