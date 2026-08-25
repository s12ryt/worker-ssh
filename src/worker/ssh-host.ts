/**
 * 正規化使用者輸入的 SSH 主機位址。
 *
 * 接受裸 IPv6（`2001:db8::1`）與帶方括號（`[2001:db8::1]`）兩種寫法，
 * 回傳 cloudflare:sockets `connect()` 與 Go `net.JoinHostPort` 可直接使用的
 * hostname 形式（IPv6 字面位址一律不帶方括號）。IPv4 與域名原樣保留。
 */
export function normalizeSshHostname(host: string): string {
  const trimmed = host.trim();
  if (
    trimmed.length >= 2 &&
    trimmed.startsWith("[") &&
    trimmed.endsWith("]")
  ) {
    const inner = trimmed.slice(1, -1);
    if (inner.length > 0 && !inner.includes("[") && !inner.includes("]")) {
      return inner;
    }
  }
  return trimmed;
}
