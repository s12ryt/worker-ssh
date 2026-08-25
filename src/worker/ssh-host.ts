/**
 * 正規化使用者輸入的 SSH 主機位址。
 *
 * 接受裸 IPv6（`2001:db8::1`）與帶方括號（`[2001:db8::1]`）兩種寫法。
 * workerd `cloudflare:sockets` connect() 實測：IPv6 字面位址必須以方括號
 * 形式傳入（裸 `::1` 會得到 `proxy request failed`），故輸出一律正規化為
 * 單層方括號形式。IPv4 與域名原樣保留。
 */
export function normalizeSshHostname(host: string): string {
  const trimmed = host.trim();
  // 含冒號視為 IPv6 字面位址：移除混亂的括號字元後包成單層方括號。
  if (trimmed.includes(":")) {
    const inner = trimmed.replaceAll("[", "").replaceAll("]", "");
    if (inner.length > 0) return `[${inner}]`;
  }
  return trimmed;
}
