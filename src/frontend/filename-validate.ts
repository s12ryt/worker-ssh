/**
 * 檔名驗證純函數（D41 另存新檔用）。
 *
 * 規則：
 * - 非字串或空字串 → false
 * - 全空白 → false
 * - 等於 "." 或 ".." → false
 * - 長度超過 255 → false
 * - 含 Windows 與 POSIX 共識禁用字元 / \ : * ? " < > | → false
 * - 其餘 → true
 */
export function validateFilename(name: unknown): name is string {
  if (typeof name !== "string") return false;
  if (name.length === 0) return false;
  if (name.length > 255) return false;
  if (name.trim().length === 0) return false;
  if (name === "." || name === "..") return false;
  // Windows + POSIX 共識禁用字元
  const ILLEGAL = /[\\/:*?"<>|]/;
  if (ILLEGAL.test(name)) return false;
  return true;
}
