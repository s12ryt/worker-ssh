import { describe, it, expect } from "vitest";
import { renderKindOf } from "@/frontend/render-kind";

describe("renderKindOf", () => {
  // Markdown 渲染
  it("md 副檔名→markdown", () => {
    expect(renderKindOf("readme.md")).toBe("markdown");
  });
  it("markdown 副檔名→markdown", () => {
    expect(renderKindOf("guide.markdown")).toBe("markdown");
  });
  it("MD 大小寫不敏感", () => {
    expect(renderKindOf("README.MD")).toBe("markdown");
  });
  it("mdown 副檔名→markdown", () => {
    expect(renderKindOf("notes.mdown")).toBe("markdown");
  });
  it("mkd 副檔名→markdown", () => {
    expect(renderKindOf("draft.mkd")).toBe("markdown");
  });

  // HTML 渲染
  it("html 副檔名→html", () => {
    expect(renderKindOf("index.html")).toBe("html");
  });
  it("htm 副檔名→html", () => {
    expect(renderKindOf("page.htm")).toBe("html");
  });
  it("xhtml 副檔名→html", () => {
    expect(renderKindOf("doc.xhtml")).toBe("html");
  });
  it("HTML 大小寫不敏感", () => {
    expect(renderKindOf("INDEX.HTML")).toBe("html");
  });

  // SVG 渲染
  it("svg 副檔名→svg", () => {
    expect(renderKindOf("logo.svg")).toBe("svg");
  });
  it("SVG 大小寫不敏感", () => {
    expect(renderKindOf("ICON.SVG")).toBe("svg");
  });

  // CSV 渲染
  it("csv 副檔名→csv", () => {
    expect(renderKindOf("data.csv")).toBe("csv");
  });
  it("tsv 副檔名→csv", () => {
    expect(renderKindOf("data.tsv")).toBe("csv");
  });
  it("CSV 大小寫不敏感", () => {
    expect(renderKindOf("DATA.CSV")).toBe("csv");
  });

  // 無渲染
  it("txt 副檔名→none", () => {
    expect(renderKindOf("notes.txt")).toBe("none");
  });
  it("js 副檔名→none", () => {
    expect(renderKindOf("app.js")).toBe("none");
  });
  it("json 副檔名→none", () => {
    expect(renderKindOf("config.json")).toBe("none");
  });
  it("yaml 副檔名→none", () => {
    expect(renderKindOf("config.yaml")).toBe("none");
  });
  it("無副檔名→none", () => {
    expect(renderKindOf("Makefile")).toBe("none");
  });
  it("隱藏檔→none", () => {
    expect(renderKindOf(".bashrc")).toBe("none");
  });
  it("空字串→none", () => {
    expect(renderKindOf("")).toBe("none");
  });
  it("null→none", () => {
    expect(renderKindOf(null as unknown as string)).toBe("none");
  });
  it("undefined→none", () => {
    expect(renderKindOf(undefined as unknown as string)).toBe("none");
  });
  it("非字串→none", () => {
    expect(renderKindOf(123 as unknown as string)).toBe("none");
  });

  // 雙副檔名邊界
  it("tar.md 不誤判為 markdown", () => {
    expect(renderKindOf("archive.tar.md")).toBe("markdown");
  });
});
