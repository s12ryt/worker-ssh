// SFTP 檔案類型分色純函數：依檔名（副檔名）與 isDir 回傳類別鍵
// 與 styles/liquid-glass.css 中 .sftp-type-icon[data-kind=...] 的色彩分支對應
// 純資料表，無副作用；TDD 見 test/unit/frontend/sftp-file-kind.test.ts

export type SftpFileKind =
  | "folder"
  | "archive"
  | "code"
  | "image"
  | "doc"
  | "binary"
  | "file";

/** 雙副檔名壓縮檔（取最後一段判斷前的特例） */
const ARCHIVE_DOUBLE = /\.(?:tar\.(?:gz|bz2|xz)|tgz|tbz2|txz)$/;

const ARCHIVE_EXTS = new Set([
  "zip",
  "rar",
  "7z",
  "gz",
  "bz2",
  "xz",
]);

const CODE_EXTS = new Set([
  "js",
  "mjs",
  "cjs",
  "ts",
  "tsx",
  "jsx",
  "py",
  "go",
  "rs",
  "java",
  "kt",
  "swift",
  "c",
  "cpp",
  "cc",
  "cxx",
  "h",
  "hpp",
  "rb",
  "php",
  "sh",
  "bash",
  "zsh",
  "fish",
  "ps1",
  "bat",
  "cmd",
  "lua",
  "pl",
  "sql",
  "vue",
  "svelte",
]);

const IMAGE_EXTS = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "svg",
  "webp",
  "ico",
  "bmp",
  "tiff",
  "tif",
  "heic",
  "avif",
]);

const DOC_EXTS = new Set([
  "md",
  "markdown",
  "txt",
  "pdf",
  "doc",
  "docx",
  "rtf",
  "odt",
  "html",
  "htm",
  "csv",
  "tsv",
  "json",
  "yaml",
  "yml",
  "toml",
  "ini",
  "xml",
  "log",
]);

const BINARY_EXTS = new Set([
  "exe",
  "bin",
  "so",
  "dll",
  "dylib",
  "o",
  "obj",
  "a",
  "lib",
  "class",
  "jar",
  "wasm",
  "pyc",
]);

/**
 * 依檔名與是否為資料夾，判斷檔案類別（與 CSS 分色對應）。
 * 大小寫不敏感；雙副檔名（.tar.gz/.tgz 等）視為壓縮檔。
 * 無副檔名或隱藏檔（開頭為點）一律回 "file"。
 */
export function fileKindOf(name: string, isDir: boolean): SftpFileKind {
  if (isDir) return "folder";
  const lower = name.toLowerCase();
  if (ARCHIVE_DOUBLE.test(lower)) return "archive";
  const dot = lower.lastIndexOf(".");
  if (dot <= 0) return "file"; // 無點（無副檔名）或開頭為點（隱藏檔）
  const ext = lower.substring(dot + 1);
  if (ARCHIVE_EXTS.has(ext)) return "archive";
  if (CODE_EXTS.has(ext)) return "code";
  if (IMAGE_EXTS.has(ext)) return "image";
  if (DOC_EXTS.has(ext)) return "doc";
  if (BINARY_EXTS.has(ext)) return "binary";
  return "file";
}
