// SFTP 預覽用：副檔名 → highlight.js 語言名稱映射純資料表
// 純資料，無副作用；TDD 見 test/unit/frontend/highlight-language.test.ts
// 未匹配的副檔名回 null，由呼叫端 fallback highlightAuto
// 設計：壓縮檔/二進位/圖片等副檔名不在表中即自然回 null，無需負面清單

/** 副檔名（小寫）→ highlight.js 語言註冊名稱 */
const EXT_TO_LANG: Record<string, string> = {
  // JavaScript 家族
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  jsx: "javascript",
  // TypeScript 家族
  ts: "typescript",
  tsx: "typescript",
  // Python
  py: "python",
  // Go
  go: "go",
  // Shell 家族（fish 語法不同但 highlight.js 無 fish 語言，fallback bash）
  sh: "bash",
  bash: "bash",
  zsh: "bash",
  fish: "bash",
  // 資料格式
  json: "json",
  yaml: "yaml",
  yml: "yaml",
  xml: "xml",
  html: "xml",
  htm: "xml",
  xhtml: "xml",
  // 文件
  md: "markdown",
  markdown: "markdown",
  // 樣式
  css: "css",
  // 資料庫
  sql: "sql",
  // C / C++
  c: "c",
  h: "c",
  cpp: "cpp",
  cc: "cpp",
  cxx: "cpp",
  hpp: "cpp",
  // JVM
  java: "java",
  // 系統
  rs: "rust",
  php: "php",
  rb: "ruby",
  lua: "lua",
  // 補丁
  diff: "diff",
  patch: "diff",
  // 設定
  ini: "ini",
  cfg: "ini",
};

/**
 * 依檔名副檔名回傳 highlight.js 語言名稱；未匹配回 null。
 * 大小寫不敏感；無副檔名或隱藏檔（開頭為點）回 null。
 * 壓縮檔/二進位/圖片等不在此表即回 null，由呼叫端決定是否拒絕預覽。
 */
export function languageOfFilename(name: string): string | null {
  const lower = name.toLowerCase();
  const dot = lower.lastIndexOf(".");
  if (dot <= 0) return null; // 無點（無副檔名）或開頭為點（隱藏檔）
  const ext = lower.substring(dot + 1);
  return EXT_TO_LANG[ext] ?? null;
}
