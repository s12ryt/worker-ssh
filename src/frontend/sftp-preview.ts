// SFTP 預覽純函數：判斷檔案是否可線上預覽
// 純資料/邏輯，無副作用；TDD 見 test/unit/frontend/sftp-preview.test.ts
// 與 sftp-file-kind.ts 協作：binary/archive/image 一律拒絕；其餘副檔名允許嘗試 TextDecoder

import { fileKindOf } from "./sftp-file-kind";

/** 預覽檔案大小上限（1MB）；超過提示下載，避免 SftpReadFile 全檔讀取卡瀏覽器 */
export const PREVIEW_MAX_BYTES = 1024 * 1024;

/** 預覽判定所需的最小欄位（與 SftpEntry 部分重疊，便於測試與複用） */
export interface PreviewableEntry {
  name: string;
  isDir: boolean;
  size: number;
}

/**
 * 判斷檔案是否可線上預覽：
 * - 資料夾、二進位、壓縮檔、圖片 → false
 * - size 超過上限或非有限數 → false
 * - 其餘（含程式碼、文件、未知副檔名、無副檔名）→ true（由呼叫端 TextDecoder + highlightAuto 處理）
 */
export function isPreviewable(entry: PreviewableEntry): boolean {
  if (entry.isDir) return false;
  if (!Number.isFinite(entry.size) || entry.size < 0) return false;
  if (entry.size > PREVIEW_MAX_BYTES) return false;
  const kind = fileKindOf(entry.name, entry.isDir);
  if (kind === "binary" || kind === "archive" || kind === "image") return false;
  return true;
}

/**
 * 將檔案位元組解碼為預覽用文字。
 * - 使用 UTF-8（fatal: false，無效位元組以 U+FFFD 替換字元呈現）
 * - U+FFFD 替換字元比例 ≥ 10% 視為二進位，回 null（D32）
 * - 空資料回空字串（0 個替換字元，比例 0%，合法）
 * - 邊界值：剛好 10% 視為二進位（保守判定，回 null）
 */
export function decodePreviewText(bytes: Uint8Array): string | null {
  const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  let replacements = 0;
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 0xfffd) replacements++;
  }
  if (text.length === 0) return ""; // 空檔案，非二進位
  // 比例 ≥ 10% 視為二進位；用 > 嚴格小於 10% 才通過（剛好 10% 拒絕）
  if (replacements / text.length >= 0.1) return null;
  return text;
}
