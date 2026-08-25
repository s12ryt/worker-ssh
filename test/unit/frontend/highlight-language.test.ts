import { describe, expect, it } from "vitest";
import { languageOfFilename } from "@/frontend/highlight-language";

describe("languageOfFilename", () => {
  it("JavaScript 家族 → javascript", () => {
    expect(languageOfFilename("app.js")).toBe("javascript");
    expect(languageOfFilename("node.mjs")).toBe("javascript");
    expect(languageOfFilename("legacy.cjs")).toBe("javascript");
    expect(languageOfFilename("Component.jsx")).toBe("javascript");
  });

  it("TypeScript 家族 → typescript", () => {
    expect(languageOfFilename("mod.ts")).toBe("typescript");
    expect(languageOfFilename("App.tsx")).toBe("typescript");
  });

  it("Python → python", () => {
    expect(languageOfFilename("main.py")).toBe("python");
  });

  it("Go → go", () => {
    expect(languageOfFilename("main.go")).toBe("go");
  });

  it("Shell 家族 → bash", () => {
    expect(languageOfFilename("setup.sh")).toBe("bash");
    expect(languageOfFilename("deploy.bash")).toBe("bash");
    expect(languageOfFilename("config.zsh")).toBe("bash");
  });

  it("JSON → json", () => {
    expect(languageOfFilename("package.json")).toBe("json");
  });

  it("YAML → yaml", () => {
    expect(languageOfFilename("config.yaml")).toBe("yaml");
    expect(languageOfFilename("config.yml")).toBe("yaml");
  });

  it("XML 與 HTML → xml", () => {
    expect(languageOfFilename("data.xml")).toBe("xml");
    expect(languageOfFilename("index.html")).toBe("xml");
    expect(languageOfFilename("page.htm")).toBe("xml");
  });

  it("Markdown → markdown", () => {
    expect(languageOfFilename("README.md")).toBe("markdown");
    expect(languageOfFilename("guide.markdown")).toBe("markdown");
  });

  it("CSS → css", () => {
    expect(languageOfFilename("style.css")).toBe("css");
  });

  it("SQL → sql", () => {
    expect(languageOfFilename("schema.sql")).toBe("sql");
  });

  it("C → c", () => {
    expect(languageOfFilename("main.c")).toBe("c");
    expect(languageOfFilename("header.h")).toBe("c");
  });

  it("C++ → cpp", () => {
    expect(languageOfFilename("src.cpp")).toBe("cpp");
    expect(languageOfFilename("src.cc")).toBe("cpp");
    expect(languageOfFilename("src.cxx")).toBe("cpp");
    expect(languageOfFilename("hdr.hpp")).toBe("cpp");
  });

  it("Java → java", () => {
    expect(languageOfFilename("App.java")).toBe("java");
  });

  it("Rust → rust", () => {
    expect(languageOfFilename("lib.rs")).toBe("rust");
  });

  it("PHP → php", () => {
    expect(languageOfFilename("index.php")).toBe("php");
  });

  it("Ruby → ruby", () => {
    expect(languageOfFilename("app.rb")).toBe("ruby");
  });

  it("Lua → lua", () => {
    expect(languageOfFilename("init.lua")).toBe("lua");
  });

  it("Diff/Patch → diff", () => {
    expect(languageOfFilename("fix.diff")).toBe("diff");
    expect(languageOfFilename("fix.patch")).toBe("diff");
  });

  it("INI → ini", () => {
    expect(languageOfFilename("config.ini")).toBe("ini");
  });

  it("大小寫不敏感", () => {
    expect(languageOfFilename("APP.JS")).toBe("javascript");
    expect(languageOfFilename("README.MD")).toBe("markdown");
  });

  it("壓縮檔 → null（不預覽）", () => {
    expect(languageOfFilename("backup.zip")).toBeNull();
    expect(languageOfFilename("src.tar.gz")).toBeNull();
    expect(languageOfFilename("snap.tgz")).toBeNull();
  });

  it("二進位檔 → null", () => {
    expect(languageOfFilename("app.exe")).toBeNull();
    expect(languageOfFilename("lib.so")).toBeNull();
    expect(languageOfFilename("app.jar")).toBeNull();
    expect(languageOfFilename("module.wasm")).toBeNull();
  });

  it("圖片檔 → null", () => {
    expect(languageOfFilename("logo.png")).toBeNull();
    expect(languageOfFilename("photo.jpeg")).toBeNull();
  });

  it("無副檔名 → null", () => {
    expect(languageOfFilename("README")).toBeNull();
    expect(languageOfFilename("Makefile")).toBeNull();
  });

  it("隱藏檔 → null", () => {
    expect(languageOfFilename(".bashrc")).toBeNull();
    expect(languageOfFilename(".gitignore")).toBeNull();
  });

  it("未知副檔名 → null（fallback highlightAuto）", () => {
    expect(languageOfFilename("data.xyz")).toBeNull();
    expect(languageOfFilename("foo.unknown")).toBeNull();
  });
});
