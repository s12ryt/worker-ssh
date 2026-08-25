// isolate 級「資料庫就緒」快取：避免每個請求都重跑 bootstrap status 的 3 條 D1 語句。
// 僅快取「已就緒（complete）」結論；未就緒一律不放行。D1 若在 TTL 內被外部重置，
// 後續連線查詢會以 404 兜底，下一次快取過期後恢復 423 鎖定。

const DEFAULT_TTL_MS = 60_000;

let entry: { ok: boolean; expiresAt: number } | null = null;

export function writeDbReadyCache(
  ok: boolean,
  now: number,
  ttlMs: number = DEFAULT_TTL_MS,
): void {
  entry = ok ? { ok: true, expiresAt: now + ttlMs } : null;
}

export function readDbReadyCache(now: number): boolean {
  return entry !== null && entry.ok && entry.expiresAt > now;
}

export function resetDbReadyCache(): void {
  entry = null;
}
