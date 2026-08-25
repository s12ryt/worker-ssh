// ssh 指令匯入解析器：貼上完整 ssh 指令自動填入連線表單
// 寬鬆匯入策略——可解析的部分匯入，不支援的旗標/選項列入 warnings 由 UI 呈現；
// 真正的嚴格驗證（白名單外選項拒絕）仍由 Worker API 儲存層把關。

import {
  parseAccessProxyCommand,
  SSH_HOST_CHARSET,
  tokenizeCommand,
  validateSshOption,
  type AccessProxyConfig,
  type SshOption,
} from "../shared/ssh-options";

export interface SshCommandImport {
  host: string;
  port: number;
  username?: string;
  sshOptions: SshOption[];
  accessProxy?: AccessProxyConfig;
  /** 不支援或無法匯入的項目說明 */
  warnings: string[];
}

export type SshCommandImportResult =
  | { ok: true; value: SshCommandImport }
  | { ok: false; error: string };

/** 已知需要吃掉一個值的不支援旗標（避免其值被誤當主機位址） */
const VALUE_TAKING_FLAGS = new Set(["-i", "-F", "-W", "-J", "-D", "-L", "-R", "-b", "-E"]);

function stripPath(token: string): string {
  const normalized = token.replace(/\\/g, "/");
  return normalized.slice(normalized.lastIndexOf("/") + 1);
}

function parsePort(raw: string): number | null {
  if (!/^\d+$/.test(raw)) return null;
  const port = Number(raw);
  return port >= 1 && port <= 65535 ? port : null;
}

function splitOptionToken(token: string): { key: string; value: string } | null {
  const eq = token.indexOf("=");
  if (eq <= 0) return null;
  return { key: token.slice(0, eq), value: token.slice(eq + 1) };
}

export function parseSshCommand(command: string): SshCommandImportResult {
  let tokens: string[];
  try {
    tokens = tokenizeCommand(String(command ?? "").trim());
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "指令解析失敗" };
  }
  if (tokens.length === 0) return { ok: false, error: "空指令" };
  if (stripPath(tokens[0]!).toLowerCase() !== "ssh") {
    return { ok: false, error: "僅支援 ssh 指令" };
  }

  const warnings: string[] = [];
  const sshOptions: SshOption[] = [];
  let host: string | null = null;
  let username: string | undefined;
  let port: number | null = null;
  let accessProxy: AccessProxyConfig | undefined;

  const applyOption = (raw: string): { ok: false; error: string } | { ok: true } => {
    const option = splitOptionToken(raw);
    if (!option) return { ok: false, error: "-o 缺少 Key=Value 格式" };
    if (option.key.toLowerCase() === "proxycommand") {
      const proxy = parseAccessProxyCommand(option.value);
      if (proxy.ok) {
        accessProxy = proxy.proxy;
        return { ok: true };
      }
      warnings.push(`ProxyCommand 無法匯入：${proxy.error}`);
      return { ok: true };
    }
    const result = validateSshOption(option.key, option.value);
    if (result.ok) {
      sshOptions.push(result.option);
      return { ok: true };
    }
    warnings.push(result.error);
    return { ok: true };
  };

  let i = 1;
  for (; i < tokens.length; i += 1) {
    const token = tokens[i]!;

    if (token === "-o") {
      const next = tokens[i + 1];
      if (next === undefined) return { ok: false, error: "-o 缺少值" };
      const result = applyOption(next);
      if (!result.ok) return result;
      i += 1;
      continue;
    }
    if (token.startsWith("-o") && token.length > 2) {
      const result = applyOption(token.slice(2));
      if (!result.ok) return result;
      continue;
    }
    if (token === "-p") {
      const next = tokens[i + 1];
      if (next === undefined) return { ok: false, error: "-p 缺少值" };
      const parsed = parsePort(next);
      if (parsed === null) return { ok: false, error: "-p 的 port 值無效" };
      port = parsed;
      i += 1;
      continue;
    }
    if (token.startsWith("-p") && token.length > 2) {
      const parsed = parsePort(token.slice(2));
      if (parsed === null) return { ok: false, error: "-p 的 port 值無效" };
      port = parsed;
      continue;
    }
    if (token === "-l") {
      const next = tokens[i + 1];
      if (next === undefined) return { ok: false, error: "-l 缺少值" };
      username = next;
      i += 1;
      continue;
    }
    if (token.startsWith("-l") && token.length > 2) {
      username = token.slice(2);
      continue;
    }
    if (token.startsWith("-")) {
      warnings.push(`不支援的旗標：${token}，已略過`);
      if (VALUE_TAKING_FLAGS.has(token)) {
        if (tokens[i + 1] === undefined) {
          return { ok: false, error: `旗標 ${token} 缺少值` };
        }
        i += 1;
      }
      continue;
    }

    // 第一個位置參數 = [user@]host
    const at = token.lastIndexOf("@");
    if (at >= 0) {
      const user = token.slice(0, at);
      if (user) username = user;
      host = token.slice(at + 1);
    } else {
      host = token;
    }
    i += 1;
    break;
  }

  if (!host) return { ok: false, error: "找不到主機位址" };
  if (!SSH_HOST_CHARSET.test(host)) {
    return { ok: false, error: "主機位址含非法字元" };
  }

  // 剩餘 tokens 一律視為遠端指令
  if (i < tokens.length) {
    warnings.push(`已略過遠端指令：${tokens.slice(i).join(" ")}`);
  }

  return {
    ok: true,
    value: {
      host,
      port: port ?? 22,
      ...(username !== undefined ? { username } : {}),
      sshOptions,
      ...(accessProxy !== undefined ? { accessProxy } : {}),
      warnings,
    },
  };
}
