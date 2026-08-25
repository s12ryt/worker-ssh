// 連線時間格式化（純函式，可測）
// D20：連線時間雲同步 + D18-(3)：連線卡片顯示最近連線時間

/**
 * 將 lastConnectedAt 時間戳格式化為人類可讀的相對時間。
 *
 * - undefined / null / 未來時間 → "尚未連線"
 * - < 1 分鐘 → "剛剛連線"
 * - < 1 小時 → "X 分鐘前"
 * - < 1 天 → "X 小時前"
 * - < 7 天 → "X 天前"
 * - ≥ 7 天 → "YYYY-MM-DD"（UTC 日期，避免時區歧義）
 *
 * @param timestamp ms epoch；undefined/null 視為從未連線
 * @param now 對照時間，預設 Date.now()（測試注入固定值）
 */
export function formatLastConnected(
  timestamp: number | undefined | null,
  now: number = Date.now(),
): string {
  if (timestamp == null) return "尚未連線";
  const diff = now - timestamp;
  if (diff < 0) return "尚未連線";
  if (diff < 60_000) return "剛剛連線";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分鐘前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小時前`;
  if (diff < 604_800_000) return `${Math.floor(diff / 86_400_000)} 天前`;
  const d = new Date(timestamp);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
