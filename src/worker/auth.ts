// 面板認證：密碼驗證 + HMAC 無狀態 session token
// token 格式：base64url(payload).base64url(HMAC-SHA256)
// 簽章金鑰衍生自面板密碼 → 修改密碼即令所有舊 session 失效

const SESSION_COOKIE = "worker_ssh_session";

function b64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(text: string): Uint8Array {
  const pad = text.length % 4 === 0 ? "" : "=".repeat(4 - (text.length % 4));
  const bin = atob(text.replace(/-/g, "+").replace(/_/g, "/") + pad);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/** 常數時間比較（先雜湊以固定長度） */
async function timingSafeEqual(a: string, b: string): Promise<boolean> {
  const enc = new TextEncoder();
  const [ha, hb] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(a)),
    crypto.subtle.digest("SHA-256", enc.encode(b)),
  ]);
  const va = new Uint8Array(ha);
  const vb = new Uint8Array(hb);
  let diff = 0;
  for (let i = 0; i < va.length; i++) diff |= va[i]! ^ vb[i]!;
  return diff === 0;
}

/** 驗證面板登入密碼 */
export async function verifyPanelPassword(input: string, expected: string): Promise<boolean> {
  if (input.length === 0 || expected.length === 0) return false;
  return timingSafeEqual(input, expected);
}

async function signingKey(password: string): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "HKDF",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: new TextEncoder().encode("worker-ssh-session-v1"), info: new Uint8Array(0) },
    base,
    { name: "HMAC", hash: "SHA-256", length: 256 },
    false,
    ["sign", "verify"],
  );
}

/** 建立 session token */
export async function createSessionToken(
  password: string,
  ttlMs: number,
): Promise<{ token: string; expiresAt: number }> {
  const expiresAt = Date.now() + ttlMs;
  const payload = b64url(new TextEncoder().encode(JSON.stringify({ exp: expiresAt })));
  const key = await signingKey(password);
  const sigBytes = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return { token: `${payload}.${b64url(new Uint8Array(sigBytes))}`, expiresAt };
}

/** 驗證 session token；無效、竄改或過期回傳 false */
export async function verifySessionToken(token: string, password: string): Promise<boolean> {
  const parts = token.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return false;
  const [payload, sig] = parts;
  try {
    const key = await signingKey(password);
    const valid = await crypto.subtle.verify(
      "HMAC",
      key,
      b64urlDecode(sig) as BufferSource,
      new TextEncoder().encode(payload),
    );
    if (!valid) return false;
    const data = JSON.parse(new TextDecoder().decode(b64urlDecode(payload))) as { exp?: number };
    return typeof data.exp === "number" && data.exp > Date.now();
  } catch {
    return false;
  }
}

/** 從 Cookie header 取出 session token 值 */
export function parseSessionCookie(cookieHeader: string | null): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    if (part.slice(0, idx).trim() === SESSION_COOKIE) {
      return part.slice(idx + 1).trim() || null;
    }
  }
  return null;
}

export const SESSION_COOKIE_NAME = SESSION_COOKIE;
