// SSH -o 選項白名單（第二十三節）
// 僅接受可映射到 x/crypto/ssh 的選項；ProxyCommand 僅接受 cloudflared
// access ssh 形態並轉為 Access 代理設定。前後端共用；Go 端維護同語意映射。

export interface SshOption {
  key: string;
  value: string;
}

/** Cloudflare Access WebSocket 代理（cloudflared access ssh 的等價複刻） */
export interface AccessProxyConfig {
  /** Access/tunnel 應用主機名（edge hostname） */
  hostname: string;
  /** bastion 場景的最終目的地（Cf-Access-Jump-Destination）；host[:port] */
  destination?: string;
  /** CF-Access-Client-Id；無 Access 政策的公開 tunnel 可留空 */
  clientId?: string;
  /** CF-Access-Client-Secret；clientId 存在時必填 */
  clientSecret?: string;
}

export const SSH_OPTION_KEYS = [
  "ServerAliveInterval",
  "ServerAliveCountMax",
  "ConnectTimeout",
  "Ciphers",
  "MACs",
  "KexAlgorithms",
  "HostKeyAlgorithms",
  "ProxyCommand",
] as const;

export type SshOptionKey = (typeof SSH_OPTION_KEYS)[number];

const CANONICAL_KEYS: ReadonlyMap<string, SshOptionKey> = new Map(
  SSH_OPTION_KEYS.map((key) => [key.toLowerCase(), key]),
);

const INT_RANGES: Partial<Record<SshOptionKey, [min: number, max: number]>> = {
  ServerAliveInterval: [0, 600],
  ServerAliveCountMax: [1, 100],
  ConnectTimeout: [1, 120],
};

const LIST_KEYS: ReadonlySet<SshOptionKey> = new Set([
  "Ciphers",
  "MACs",
  "KexAlgorithms",
  "HostKeyAlgorithms",
] as const satisfies readonly SshOptionKey[]);

export const SSH_HOST_CHARSET = /^[A-Za-z0-9._:[\]-]+$/;

export type SshOptionValidation =
  | { ok: true; option: SshOption }
  | { ok: false; key: string; error: string };

export type SshOptionsValidation =
  | { ok: true; options: SshOption[] }
  | { ok: false; error: string; unsupported?: string[] };

export type AccessProxyParse =
  | { ok: true; proxy: AccessProxyConfig }
  | { ok: false; error: string };

export type AccessProxyValidation =
  | { ok: true; proxy: AccessProxyConfig }
  | { ok: false; error: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** 去除成對包覆的引號（OpenSSH -o 值常見 `"..."` 形態） */
function unquote(value: string): string {
  const trimmed = value.trim();
  if (
    trimmed.length >= 2 &&
    ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'")))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

/** 殼層式 token 化：支援單/雙引號與反斜線跳脫 */
export function tokenizeCommand(command: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let hasToken = false;
  let quote: '"' | "'" | null = null;
  for (let i = 0; i < command.length; i += 1) {
    const ch = command[i]!;
    if (quote !== null) {
      if (ch === "\\" && quote === '"' && i + 1 < command.length) {
        current += command[i + 1]!;
        i += 1;
        continue;
      }
      if (ch === quote) {
        quote = null;
        continue;
      }
      current += ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      hasToken = true;
      continue;
    }
    if (ch === "\\" && i + 1 < command.length) {
      current += command[i + 1]!;
      i += 1;
      hasToken = true;
      continue;
    }
    if (/\s/.test(ch)) {
      if (hasToken || current.length > 0) {
        tokens.push(current);
        current = "";
        hasToken = false;
      }
      continue;
    }
    current += ch;
    hasToken = true;
  }
  if (quote !== null) throw new Error("未閉合的引號");
  if (hasToken || current.length > 0) tokens.push(current);
  return tokens;
}

export function validateSshOption(
  key: string,
  value: string,
): SshOptionValidation {
  const rawKey = typeof key === "string" ? key.trim() : "";
  const canonical = CANONICAL_KEYS.get(rawKey.toLowerCase());
  if (!canonical) {
    return { ok: false, key: rawKey, error: `不支援的 SSH 選項：${rawKey}` };
  }
  if (canonical === "ProxyCommand") {
    return {
      ok: false,
      key: rawKey,
      error: "ProxyCommand 必須透過 Access 代理設定，不得作為純量選項",
    };
  }
  const normalized = unquote(String(value ?? ""));
  if (!normalized) {
    return { ok: false, key: canonical, error: `${canonical} 不得為空` };
  }

  const range = INT_RANGES[canonical];
  if (range) {
    if (!/^\d+$/.test(normalized)) {
      return {
        ok: false,
        key: canonical,
        error: `${canonical} 必須是非負整數`,
      };
    }
    const parsed = Number(normalized);
    if (parsed < range[0] || parsed > range[1]) {
      return {
        ok: false,
        key: canonical,
        error: `${canonical} 允許範圍 ${range[0]}–${range[1]}`,
      };
    }
  }

  if (LIST_KEYS.has(canonical)) {
    const tokens = normalized.split(",");
    for (const token of tokens) {
      if (!token || !/^[A-Za-z0-9@._+-]+$/.test(token)) {
        return {
          ok: false,
          key: canonical,
          error: `${canonical} 包含空白或非法字元的演算法名稱`,
        };
      }
    }
  }

  return { ok: true, option: { key: canonical, value: normalized } };
}

export function validateSshOptions(
  options: unknown,
): SshOptionsValidation {
  if (!Array.isArray(options)) {
    return { ok: false, error: "SSH 選項必須是陣列" };
  }
  const unsupported: string[] = [];
  const validated: SshOption[] = [];
  for (const entry of options) {
    if (!isRecord(entry)) {
      return { ok: false, error: "SSH 選項格式不正確" };
    }
    const key = typeof entry.key === "string" ? entry.key : "";
    const value = typeof entry.value === "string" ? entry.value : "";
    const result = validateSshOption(key, value);
    if (!result.ok) {
      if (
        result.key &&
        !CANONICAL_KEYS.has(result.key.toLowerCase()) &&
        !unsupported.includes(result.key)
      ) {
        unsupported.push(result.key);
        continue;
      }
      return { ok: false, error: result.error };
    }
    validated.push(result.option);
  }
  if (unsupported.length > 0) {
    return {
      ok: false,
      error: `不支援的 SSH 選項：${unsupported.join("、")}`,
      unsupported,
    };
  }
  return { ok: true, options: validated };
}

/** 解析 `cloudflared access ssh --hostname <H> [--destination <D>]` 為 Access 代理設定 */
export function parseAccessProxyCommand(command: string): AccessProxyParse {
  let tokens: string[];
  try {
    tokens = tokenizeCommand(String(command ?? "").trim());
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "ProxyCommand 解析失敗" };
  }
  if (tokens.length < 3) {
    return { ok: false, error: "ProxyCommand 不是 cloudflared access ssh 形態" };
  }
  const binary = tokens[0]!.toLowerCase();
  const base = binary.slice(binary.lastIndexOf("/") + 1).replace(/\\/g, "/");
  const name = base.slice(base.lastIndexOf("/") + 1);
  if (name !== "cloudflared" && name !== "cloudflared.exe") {
    return { ok: false, error: "僅支援 cloudflared access ssh 形態的 ProxyCommand" };
  }
  if (tokens[1]!.toLowerCase() !== "access" || tokens[2]!.toLowerCase() !== "ssh") {
    return { ok: false, error: "僅支援 cloudflared access ssh 形態的 ProxyCommand" };
  }

  const allowed: ReadonlySet<string> = new Set([
    "--hostname",
    "--destination",
    "--service-token-id",
    "--service-token-secret",
  ]);
  const flags = new Map<string, string>();
  for (let i = 3; i < tokens.length; i += 1) {
    const token = tokens[i]!;
    const eq = token.indexOf("=");
    const flag = eq === -1 ? token : token.slice(0, eq);
    let value = eq === -1 ? tokens[i + 1] : token.slice(eq + 1);
    if (!allowed.has(flag)) {
      return { ok: false, error: `ProxyCommand 包含不支援的旗標：${flag}` };
    }
    if (eq === -1) {
      if (value === undefined) {
        return { ok: false, error: `ProxyCommand 旗標 ${flag} 缺少值` };
      }
      i += 1;
    }
    value = String(value);
    if (!value) {
      return { ok: false, error: `ProxyCommand 旗標 ${flag} 不得為空` };
    }
    flags.set(flag, value);
  }

  const hostname = flags.get("--hostname");
  if (!hostname) {
    return { ok: false, error: "ProxyCommand 缺少 --hostname" };
  }
  if (!SSH_HOST_CHARSET.test(hostname)) {
    return { ok: false, error: "ProxyCommand hostname 含非法字元" };
  }
  const destination = flags.get("--destination");
  if (destination !== undefined && !SSH_HOST_CHARSET.test(destination)) {
    return { ok: false, error: "ProxyCommand destination 含非法字元" };
  }
  const proxy: AccessProxyConfig = { hostname };
  if (destination) proxy.destination = destination;
  const clientId = flags.get("--service-token-id");
  if (clientId) proxy.clientId = clientId;
  const clientSecret = flags.get("--service-token-secret");
  if (clientSecret) proxy.clientSecret = clientSecret;
  return { ok: true, proxy };
}

/**
 * 寬鬆形狀驗證（PUT 更新用）：
 * 驗證各欄位格式，但不要求 clientId 綁定 clientSecret——
 * secret 可由 store 合併時沿用既有值；secret 明確提供時不得為空字串。
 */
export function validateAccessProxyShape(value: unknown): AccessProxyValidation {
  if (!isRecord(value)) {
    return { ok: false, error: "Access 代理設定格式不正確" };
  }
  const hostname = typeof value.hostname === "string" ? value.hostname.trim() : "";
  if (!hostname || !SSH_HOST_CHARSET.test(hostname)) {
    return { ok: false, error: "Access 代理 hostname 無效" };
  }
  const proxy: AccessProxyConfig = { hostname };

  if (value.destination !== undefined) {
    const destination =
      typeof value.destination === "string" ? value.destination.trim() : "";
    if (!destination || !SSH_HOST_CHARSET.test(destination)) {
      return { ok: false, error: "Access 代理 destination 無效" };
    }
    proxy.destination = destination;
  }

  if (value.clientId !== undefined && value.clientId !== null) {
    const clientId =
      typeof value.clientId === "string" ? value.clientId.trim() : "";
    if (!clientId) {
      return { ok: false, error: "Access clientId 不得為空字串" };
    }
    proxy.clientId = clientId;
  }

  if (value.clientSecret !== undefined && value.clientSecret !== null) {
    const secret =
      typeof value.clientSecret === "string" ? value.clientSecret : "";
    if (!secret) {
      return { ok: false, error: "Access clientSecret 不得為空字串" };
    }
    proxy.clientSecret = secret;
  }

  return { ok: true, proxy };
}

/** 嚴格驗證（建立用）：形狀檢查 + clientId 已設定時 clientSecret 必填 */
export function validateAccessProxy(value: unknown): AccessProxyValidation {
  const shape = validateAccessProxyShape(value);
  if (!shape.ok) return shape;
  if (shape.proxy.clientId && !shape.proxy.clientSecret) {
    return { ok: false, error: "Access clientId 已設定時 clientSecret 必填" };
  }
  return shape;
}
