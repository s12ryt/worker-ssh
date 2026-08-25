/**
 * render-kind.ts — 副檔名→渲染類型純函數（D1-D16 渲染預覽功能）
 *
 * 依副檔名判斷檔案可用的瀏覽器渲染類型：
 * - markdown：.md/.markdown/.mdown/.mkd
 * - html：.html/.htm/.xhtml
 * - svg：.svg
 * - csv：.csv/.tsv
 * - none：其餘（不支援渲染預覽）
 */

export type RenderKind = "markdown" | "html" | "svg" | "csv" | "none";

const MARKDOWN_EXTS = new Set(["md", "markdown", "mdown", "mkd"]);
const HTML_EXTS = new Set(["html", "htm", "xhtml"]);
const SVG_EXTS = new Set(["svg"]);
const CSV_EXTS = new Set(["csv", "tsv"]);

/**
 * 依副檔名判斷檔案的渲染類型。
 * @param filename 檔名（含副檔名）；非字串/空/無副檔名/隱藏檔回 "none"
 * @returns RenderKind
 */
export function renderKindOf(filename: unknown): RenderKind {
  if (typeof filename !== "string") return "none";
  const dot = filename.lastIndexOf(".");
  if (dot <= 0) return "none"; // 無副檔名或隱藏檔（.bashrc 等）
  const ext = filename.slice(dot + 1).toLowerCase();
  if (MARKDOWN_EXTS.has(ext)) return "markdown";
  if (HTML_EXTS.has(ext)) return "html";
  if (SVG_EXTS.has(ext)) return "svg";
  if (CSV_EXTS.has(ext)) return "csv";
  return "none";
}
