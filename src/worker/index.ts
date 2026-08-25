// worker-ssh 主入口：面板 API + 後端 SSH 工作階段 + 靜態資源 fallback
import type {
  AppSettingsInput,
  MonitorIntervalSeconds,
  OsInfo,
  ThemeMode,
} from "../shared/types";
import {
  SESSION_COOKIE_NAME,
  createSessionToken,
  parseSessionCookie,
  verifyPanelPassword,
  verifySessionToken,
} from "./auth";
import {
  ConnectionStore,
  InvalidMigrationCursorError,
  OsCache,
} from "./store";
import { LoginRateLimiter, loginSourceOf } from "./login-rate-limit";
import { DatabaseBootstrap, type BootstrapStatus } from "./d1-bootstrap";
import {
  CredentialRequiredError,
  D1ConnectionStore,
  DuplicateFolderNameError,
  FolderCycleError,
  FolderDepthError,
  RecordNotFoundError,
  TooManyConnectionsToMoveError,
  type D1ConnectionPatch,
  type NewD1Connection,
} from "./d1-store";
import { AppSettingsStore } from "./settings-store";
import {
  connectInitializedSshSession,
  SshSessionInitializationError,
} from "./ssh-session-init";

export { SshSessionObject } from "./backend-ssh-do";
export { SshQuotaObject } from "./ssh-quota-do";

export interface Env {
  KV: KVNamespace;
  DB: D1Database;
  SSH_SESSIONS: DurableObjectNamespace;
  SSH_QUOTA: DurableObjectNamespace;
  ASSETS: Fetcher;
  /** 面板登入密碼（wrangler secret put PANEL_PASSWORD） */
  PANEL_PASSWORD?: string;
  /** KV 敏感資料加密金鑰（wrangler secret put ENCRYPTION_KEY） */
  ENCRYPTION_KEY?: string;
  /** 僅限本機 Go WASM 後端 SSH 可行性閘門。 */
  BACKEND_SSH_PROBE?: string;
  BACKEND_SSH_PROBE_PASSWORD?: string;
}

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function json(
  data: unknown,
  status = 200,
  headers?: Record<string, string>,
): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...headers },
  });
}

function sessionCookie(token: string, maxAgeSec: number): string {
  return `${SESSION_COOKIE_NAME}=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${maxAgeSec}`;
}

async function readJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    return undefined;
  }
}

async function isAuthed(req: Request, env: Env): Promise<boolean> {
  return (await authenticatedSessionToken(req, env)) !== null;
}

async function authenticatedSessionToken(
  req: Request,
  env: Env,
): Promise<string | null> {
  const token = parseSessionCookie(req.headers.get("Cookie"));
  if (!token || !env.PANEL_PASSWORD) return null;
  return (await verifySessionToken(token, env.PANEL_PASSWORD)) ? token : null;
}

async function sessionQuotaKey(token: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(token),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function databaseBootstrap(env: Env): DatabaseBootstrap {
  if (!env.ENCRYPTION_KEY) throw new Error("ENCRYPTION_KEY 未設定");
  return new DatabaseBootstrap(env.DB, env.KV, env.ENCRYPTION_KEY);
}

function bootstrapLocked(status: BootstrapStatus): Response {
  return json(
    {
      error: "database initialization required",
      status: status.status,
      phase: status.phase,
      percent: status.percent,
    },
    423,
  );
}

async function requireDatabaseReady(env: Env): Promise<Response | null> {
  const status = await databaseBootstrap(env).status();
  return status.status === "complete" ? null : bootstrapLocked(status);
}

/** 驗證並擷取新建連線欄位；非法回 null */
function parseConnection(body: unknown): NewD1Connection | null {
  if (typeof body !== "object" || body === null) return null;
  const b = body as Record<string, unknown>;
  if (typeof b.name !== "string" || !b.name.trim()) return null;
  if (typeof b.host !== "string" || !b.host.trim()) return null;
  if (typeof b.username !== "string" || !b.username.trim()) return null;
  if (
    typeof b.port !== "number" ||
    !Number.isInteger(b.port) ||
    b.port < 1 ||
    b.port > 65535
  ) {
    return null;
  }
  if (b.authType !== "password" && b.authType !== "privateKey") return null;

  const out: NewD1Connection = {
    name: b.name,
    host: b.host,
    port: b.port,
    username: b.username,
    authType: b.authType,
  };
  for (const key of [
    "password",
    "privateKey",
    "passphrase",
    "hostKeyType",
    "hostKeyFingerprint",
  ] as const) {
    const v = b[key];
    if (v === undefined || v === null) continue;
    if (typeof v !== "string") return null;
    out[key] = v;
  }
  if (out.authType === "privateKey" && !out.privateKey) return null;
  return out;
}

/** 驗證並過濾更新欄位（白名單，防止覆蓋 id/createdAt）；非法回 null；null 值代表清除 */
function sanitizePatch(body: unknown): D1ConnectionPatch | null {
  if (typeof body !== "object" || body === null) return null;
  const b = body as Record<string, unknown>;
  const patch: D1ConnectionPatch = {};

  for (const field of ["name", "host", "username"] as const) {
    const v = b[field];
    if (v === undefined) continue;
    if (typeof v !== "string" || !v.trim()) return null;
    patch[field] = v;
  }

  if (b.port !== undefined) {
    if (
      typeof b.port !== "number" ||
      !Number.isInteger(b.port) ||
      b.port < 1 ||
      b.port > 65535
    ) {
      return null;
    }
    patch.port = b.port;
  }

  if (b.authType !== undefined) {
    if (b.authType !== "password" && b.authType !== "privateKey") return null;
    patch.authType = b.authType;
  }

  for (const field of ["password", "privateKey", "passphrase"] as const) {
    const v = b[field];
    if (v === undefined) continue;
    if (typeof v !== "string") return null;
    patch[field] = v;
  }

  for (const field of ["hostKeyType", "hostKeyFingerprint"] as const) {
    const v = b[field];
    if (v === undefined) continue;
    if (v === null) {
      patch[field] = null;
      continue;
    }
    if (typeof v !== "string" || !v.trim()) return null;
    patch[field] = v;
  }

  // D20：連線時間雲同步欄位（數字時間戳，null 代表清除）
  for (const field of ["lastConnectedAt", "lastDisconnectedAt"] as const) {
    const v = b[field];
    if (v === undefined) continue;
    if (v === null) {
      patch[field] = null;
      continue;
    }
    if (typeof v !== "number" || !Number.isFinite(v)) return null;
    patch[field] = v;
  }
  return patch;
}

function parseFolderId(value: unknown): string | null | undefined {
  if (value === null) return null;
  if (typeof value !== "string") return undefined;
  const id = value.trim();
  return id || undefined;
}

function d1Store(env: Env): D1ConnectionStore {
  if (!env.ENCRYPTION_KEY) throw new Error("ENCRYPTION_KEY 未設定");
  return new D1ConnectionStore(env.DB, env.ENCRYPTION_KEY);
}

function d1Error(error: unknown): Response {
  if (error instanceof RecordNotFoundError) {
    return json({ error: "not found" }, 404);
  }
  if (error instanceof DuplicateFolderNameError) {
    return json({ error: "duplicate folder name" }, 409);
  }
  if (
    error instanceof FolderCycleError ||
    error instanceof FolderDepthError ||
    error instanceof CredentialRequiredError
  ) {
    return json({ error: error.message }, 400);
  }
  return json({ error: "database operation failed" }, 500);
}

async function handleLogin(req: Request, env: Env): Promise<Response> {
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);
  if (!env.PANEL_PASSWORD) {
    return json({ error: "PANEL_PASSWORD 未設定" }, 500);
  }
  const body = await readJson(req);
  const password =
    typeof body === "object" && body !== null
      ? (body as Record<string, unknown>).password
      : undefined;
  if (typeof password !== "string" || !password) {
    return json({ error: "password required" }, 400);
  }
  const source = loginSourceOf(req);
  const limiter = new LoginRateLimiter(env.KV);
  const status = await limiter.check(source);
  if (status.limited) {
    return json({ error: "too many attempts" }, 429, {
      "Retry-After": String(status.retryAfterSeconds),
    });
  }
  if (!(await verifyPanelPassword(password, env.PANEL_PASSWORD))) {
    await limiter.recordFailure(source);
    return json({ error: "invalid password" }, 401);
  }
  await limiter.clear(source);
  const { token } = await createSessionToken(env.PANEL_PASSWORD, SESSION_TTL_MS);
  return json({ ok: true }, 200, {
    "Set-Cookie": sessionCookie(token, Math.floor(SESSION_TTL_MS / 1000)),
  });
}

async function handleConnections(
  req: Request,
  env: Env,
  id: string | null,
): Promise<Response> {
  if (!(await isAuthed(req, env))) return json({ error: "unauthorized" }, 401);
  if (!env.ENCRYPTION_KEY) return json({ error: "ENCRYPTION_KEY 未設定" }, 500);
  const locked = await requireDatabaseReady(env);
  if (locked) return locked;
  const store = d1Store(env);

  try {
    if (id === null) {
      if (req.method === "GET") return json(await store.listConnections());
      if (req.method === "POST") {
        const body = await readJson(req);
        const parsed = parseConnection(body);
        if (!parsed) return json({ error: "invalid connection" }, 400);
        const values = body as Record<string, unknown>;
        const hasFolderId = Object.hasOwn(values, "folderId");
        const folderId = parseFolderId(values.folderId);
        if (hasFolderId && folderId === undefined) {
          return json({ error: "invalid folder id" }, 400);
        }
        return json(await store.createConnection(parsed, folderId ?? null), 201);
      }
      return json({ error: "method not allowed" }, 405);
    }

    const connId = decodeURIComponent(id);
    if (req.method === "GET") {
      const config = await store.getConnection(connId);
      return config ? json(config) : json({ error: "not found" }, 404);
    }
    if (req.method === "PUT") {
      const patch = sanitizePatch(await readJson(req));
      if (!patch) return json({ error: "invalid patch" }, 400);
      const updated = await store.updateConnection(connId, patch);
      return updated ? json(updated) : json({ error: "not found" }, 404);
    }
    if (req.method === "DELETE") {
      return (await store.deleteConnection(connId))
        ? new Response(null, { status: 204 })
        : json({ error: "not found" }, 404);
    }
    return json({ error: "method not allowed" }, 405);
  } catch (error) {
    return d1Error(error);
  }
}

async function handleCredential(
  req: Request,
  env: Env,
  id: string,
): Promise<Response> {
  if (!(await isAuthed(req, env))) return json({ error: "unauthorized" }, 401);
  if (!env.ENCRYPTION_KEY) return json({ error: "ENCRYPTION_KEY 未設定" }, 500);
  const locked = await requireDatabaseReady(env);
  if (locked) return locked;
  if (req.method !== "DELETE") return json({ error: "method not allowed" }, 405);
  try {
    const updated = await d1Store(env).clearCredential(decodeURIComponent(id));
    return updated ? json(updated) : json({ error: "not found" }, 404);
  } catch (error) {
    return d1Error(error);
  }
}

async function handleConnectionMove(req: Request, env: Env): Promise<Response> {
  if (!(await isAuthed(req, env))) return json({ error: "unauthorized" }, 401);
  if (!env.ENCRYPTION_KEY) return json({ error: "ENCRYPTION_KEY 未設定" }, 500);
  const locked = await requireDatabaseReady(env);
  if (locked) return locked;
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);
  const body = await readJson(req);
  const values =
    typeof body === "object" && body !== null
      ? (body as Record<string, unknown>)
      : undefined;
  const ids = values?.ids;
  const folderId = parseFolderId(values?.folderId);
  if (
    !Array.isArray(ids) ||
    ids.length === 0 ||
    ids.some((id) => typeof id !== "string" || !id.trim()) ||
    folderId === undefined
  ) {
    return json({ error: "invalid move" }, 400);
  }
  if (new Set(ids).size > 50) {
    return json({ error: "too many connections to move" }, 400);
  }
  try {
    await d1Store(env).moveConnections(ids, folderId);
    return json({ ok: true });
  } catch (error) {
    if (error instanceof TooManyConnectionsToMoveError) {
      return json({ error: error.message }, 400);
    }
    return d1Error(error);
  }
}

async function handleBootstrap(req: Request, env: Env): Promise<Response> {
  if (!(await isAuthed(req, env))) return json({ error: "unauthorized" }, 401);
  if (!env.ENCRYPTION_KEY) return json({ error: "ENCRYPTION_KEY 未設定" }, 500);
  const bootstrap = databaseBootstrap(env);
  if (req.method === "GET") return json(await bootstrap.status());
  if (req.method === "POST") return json(await bootstrap.step());
  return json({ error: "method not allowed" }, 405);
}

async function handleBootstrapRetry(req: Request, env: Env): Promise<Response> {
  if (!(await isAuthed(req, env))) return json({ error: "unauthorized" }, 401);
  if (!env.ENCRYPTION_KEY) return json({ error: "ENCRYPTION_KEY 未設定" }, 500);
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);
  return json(await databaseBootstrap(env).retry());
}

function parseAppSettings(body: unknown): AppSettingsInput | null {
  if (typeof body !== "object" || body === null) return null;
  const values = body as Record<string, unknown>;
  const theme = values.theme;
  const terminalFontSize = values.terminalFontSize;
  const monitorIntervalSeconds = values.monitorIntervalSeconds;
  const autoReconnectEnabled = values.autoReconnectEnabled;
  const autoReconnectAttempts = values.autoReconnectAttempts;
  if (theme !== "dark" && theme !== "high-contrast") return null;
  if (
    typeof terminalFontSize !== "number" ||
    !Number.isInteger(terminalFontSize) ||
    terminalFontSize < 12 ||
    terminalFontSize > 20
  ) {
    return null;
  }
  if (![3, 5, 10, 30].includes(Number(monitorIntervalSeconds))) return null;
  if (typeof autoReconnectEnabled !== "boolean") return null;
  if (
    typeof autoReconnectAttempts !== "number" ||
    !Number.isInteger(autoReconnectAttempts) ||
    autoReconnectAttempts < 1 ||
    autoReconnectAttempts > 5
  ) {
    return null;
  }
  return {
    theme: theme as ThemeMode,
    terminalFontSize,
    monitorIntervalSeconds: monitorIntervalSeconds as MonitorIntervalSeconds,
    autoReconnectEnabled,
    autoReconnectAttempts,
  };
}

async function handleSettings(req: Request, env: Env): Promise<Response> {
  if (!(await isAuthed(req, env))) return json({ error: "unauthorized" }, 401);
  if (!env.ENCRYPTION_KEY) return json({ error: "ENCRYPTION_KEY 未設定" }, 500);
  const locked = await requireDatabaseReady(env);
  if (locked) return locked;
  const store = new AppSettingsStore(env.DB);
  if (req.method === "GET") return json(await store.get());
  if (req.method !== "PUT") return json({ error: "method not allowed" }, 405);
  const input = parseAppSettings(await readJson(req));
  return input
    ? json(await store.save(input))
    : json({ error: "invalid settings" }, 400);
}

async function handleFolders(
  req: Request,
  env: Env,
  id: string | null,
  url: URL,
): Promise<Response> {
  if (!(await isAuthed(req, env))) return json({ error: "unauthorized" }, 401);
  if (!env.ENCRYPTION_KEY) return json({ error: "ENCRYPTION_KEY 未設定" }, 500);
  const locked = await requireDatabaseReady(env);
  if (locked) return locked;
  const store = d1Store(env);

  try {
    if (id === null) {
      if (req.method === "GET") return json(await store.listFolders());
      if (req.method !== "POST") return json({ error: "method not allowed" }, 405);
      const body = await readJson(req);
      const values =
        typeof body === "object" && body !== null
          ? (body as Record<string, unknown>)
          : undefined;
      const name = values?.name;
      const hasParentId = values ? Object.hasOwn(values, "parentId") : false;
      const parentId = parseFolderId(values?.parentId);
      if (
        typeof name !== "string" ||
        !name.trim() ||
        (hasParentId && parentId === undefined)
      ) {
        return json({ error: "invalid folder" }, 400);
      }
      return json(await store.createFolder(name, parentId ?? null), 201);
    }

    const folderId = decodeURIComponent(id);
    if (req.method === "GET") {
      const folder = await store.getFolder(folderId);
      return folder ? json(folder) : json({ error: "not found" }, 404);
    }
    if (req.method === "PUT") {
      const body = await readJson(req);
      const values =
        typeof body === "object" && body !== null
          ? (body as Record<string, unknown>)
          : undefined;
      const hasName = values ? Object.hasOwn(values, "name") : false;
      const hasParentId = values ? Object.hasOwn(values, "parentId") : false;
      if (hasName === hasParentId) {
        return json({ error: "rename or move required" }, 400);
      }
      if (hasName) {
        if (typeof values?.name !== "string" || !values.name.trim()) {
          return json({ error: "invalid folder name" }, 400);
        }
        const folder = await store.renameFolder(folderId, values.name);
        return folder ? json(folder) : json({ error: "not found" }, 404);
      }
      const parentId = parseFolderId(values?.parentId);
      if (parentId === undefined) return json({ error: "invalid parent" }, 400);
      await store.moveFolder(folderId, parentId);
      return json(await store.getFolder(folderId));
    }
    if (req.method === "DELETE") {
      const mode = url.searchParams.get("mode");
      if (mode !== "promote" && mode !== "recursive") {
        return json({ error: "invalid delete mode" }, 400);
      }
      await store.deleteFolder(folderId, mode);
      return new Response(null, { status: 204 });
    }
    return json({ error: "method not allowed" }, 405);
  } catch (error) {
    return d1Error(error);
  }
}

async function handleScope(req: Request, env: Env, url: URL): Promise<Response> {
  if (!(await isAuthed(req, env))) return json({ error: "unauthorized" }, 401);
  if (!env.ENCRYPTION_KEY) return json({ error: "ENCRYPTION_KEY 未設定" }, 500);
  const locked = await requireDatabaseReady(env);
  if (locked) return locked;
  if (req.method !== "GET") return json({ error: "method not allowed" }, 405);
  const rawFolderId = url.searchParams.get("folderId");
  const folderId = rawFolderId === null || rawFolderId === "" ? null : rawFolderId;
  try {
    return json(await d1Store(env).listScope(folderId));
  } catch (error) {
    return d1Error(error);
  }
}

async function handleConnectionMigration(
  req: Request,
  env: Env,
): Promise<Response> {
  if (!(await isAuthed(req, env))) return json({ error: "unauthorized" }, 401);
  if (!env.ENCRYPTION_KEY) {
    return json({ error: "ENCRYPTION_KEY 未設定" }, 500);
  }
  if (req.method !== "POST") {
    return json({ error: "method not allowed" }, 405);
  }

  const body = await readJson(req);
  const cursor =
    typeof body === "object" && body !== null
      ? (body as Record<string, unknown>).cursor
      : undefined;
  if (cursor !== undefined && typeof cursor !== "string") {
    return json({ error: "invalid migration cursor" }, 400);
  }

  try {
    const store = new ConnectionStore(env.KV, env.ENCRYPTION_KEY);
    return json(await store.migrateLegacyBatch(cursor));
  } catch (error) {
    return error instanceof InvalidMigrationCursorError
      ? json({ error: "invalid migration cursor" }, 400)
      : json({ error: "migration failed" }, 500);
  }
}

async function handleBackendSshProbe(
  req: Request,
  env: Env,
): Promise<Response> {
  if (env.BACKEND_SSH_PROBE !== "1") {
    return json({ error: "not found" }, 404);
  }
  if (!(await isAuthed(req, env))) return json({ error: "unauthorized" }, 401);
  if (req.method !== "POST") {
    return json({ error: "method not allowed" }, 405);
  }

  const body = await readJson(req);
  const value =
    typeof body === "object" && body !== null
      ? (body as Record<string, unknown>)
      : undefined;
  if (
    value?.host !== "127.0.0.1" ||
    value.port !== 2222 ||
    value.username !== "tester"
  ) {
    return json({ error: "invalid probe target" }, 400);
  }

  const stub = env.SSH_SESSIONS.getByName("backend-ssh-feasibility-probe");
  return stub.fetch("https://ssh-session.internal/probe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      host: value.host,
      port: value.port,
      username: value.username,
    }),
  });
}

async function handleSsh(req: Request, env: Env, url: URL): Promise<Response> {
  const token = await authenticatedSessionToken(req, env);
  if (!token) return json({ error: "unauthorized" }, 401);
  if (!env.ENCRYPTION_KEY) return json({ error: "ENCRYPTION_KEY 未設定" }, 500);
  const locked = await requireDatabaseReady(env);
  if (locked) return locked;
  if (req.method !== "GET") return json({ error: "method not allowed" }, 405);

  const connectionId = url.searchParams.get("connectionId")?.trim();
  if (!connectionId) return json({ error: "connection id required" }, 400);
  const store = d1Store(env);
  const view = await store.getConnection(connectionId);
  if (!view) return json({ error: "not found" }, 404);
  if (view.credentialState !== "ready") {
    return json({ error: "credential missing" }, 409);
  }
  if (req.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
    return json({ error: "websocket upgrade required" }, 426);
  }

  const config = await store.getConnectionInternal(connectionId);
  if (!config) return json({ error: "not found" }, 404);
  const quota = {
    sessionKey: await sessionQuotaKey(token),
    leaseId: crypto.randomUUID(),
  };
  const quotaStub = env.SSH_QUOTA.getByName("global-ssh-quota");
  const acquired = await quotaStub.fetch("https://ssh-quota.internal/acquire", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(quota),
  });
  if (!acquired.ok) {
    return json({ error: "SSH session limit reached" }, 429);
  }
  const releaseQuota = () =>
    quotaStub
      .fetch("https://ssh-quota.internal/release", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(quota),
      })
      .catch(() => undefined);
  const stub = env.SSH_SESSIONS.getByName(
    `ssh-${connectionId}-${crypto.randomUUID()}`,
  );
  let connected: Response;
  try {
    connected = await connectInitializedSshSession(stub, { config, quota });
  } catch (error) {
    await releaseQuota();
    return error instanceof SshSessionInitializationError
      ? json({ error: "SSH session initialization failed" }, 502)
      : json({ error: "SSH session connection failed" }, 502);
  }
  if (connected.status !== 101) await releaseQuota();
  return connected;
}

async function handleOs(req: Request, env: Env, url: URL): Promise<Response> {
  if (!(await isAuthed(req, env))) return json({ error: "unauthorized" }, 401);
  const cache = new OsCache(env.KV);

  if (req.method === "GET") {
    const key = url.searchParams.get("key");
    if (!key) return json({ error: "key required" }, 400);
    const info = await cache.get(key);
    return info ? json(info) : json({ error: "not found" }, 404);
  }
  if (req.method === "PUT") {
    const body = await readJson(req);
    const b =
      typeof body === "object" && body !== null
        ? (body as Record<string, unknown>)
        : undefined;
    const key = typeof b?.key === "string" ? b.key : "";
    const info = b?.info;
    if (!key || typeof info !== "object" || info === null) {
      return json({ error: "key and info required" }, 400);
    }
    await cache.put(key, info as OsInfo);
    return json({ ok: true });
  }
  return json({ error: "method not allowed" }, 405);
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname;

    // 舊瀏覽器 TCP bridge 已停用，避免繞過後端憑證生命週期。
    if (path === "/proxy") return json({ error: "not found" }, 404);

    // 非 API 路徑 → 靜態資源
    if (!path.startsWith("/api/")) {
      return env.ASSETS.fetch(req);
    }

    if (path === "/api/login") return handleLogin(req, env);

    if (path === "/api/session") {
      return json({ authenticated: await isAuthed(req, env) });
    }

    if (path === "/api/logout") {
      return json({ ok: true }, 200, {
        "Set-Cookie": `${SESSION_COOKIE_NAME}=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0`,
      });
    }

    if (path === "/api/bootstrap") return handleBootstrap(req, env);
    if (path === "/api/bootstrap/retry") return handleBootstrapRetry(req, env);
    if (path === "/api/settings") return handleSettings(req, env);

    if (path === "/api/migrations/connections") {
      return handleConnectionMigration(req, env);
    }

    if (path === "/api/backend-ssh/probe") {
      return handleBackendSshProbe(req, env);
    }

    if (path === "/api/ssh") return handleSsh(req, env, url);

    if (path === "/api/scope") return handleScope(req, env, url);

    if (path === "/api/connections/move") {
      return handleConnectionMove(req, env);
    }

    const credentialMatch = path.match(
      /^\/api\/connections\/([^/]+)\/credential$/,
    );
    if (credentialMatch) {
      return handleCredential(req, env, credentialMatch[1]!);
    }

    if (path === "/api/folders" || path.startsWith("/api/folders/")) {
      const rest = path.slice("/api/folders".length);
      return handleFolders(req, env, rest ? rest.slice(1) : null, url);
    }

    if (path === "/api/connections" || path.startsWith("/api/connections/")) {
      const rest = path.slice("/api/connections".length);
      return handleConnections(req, env, rest ? rest.slice(1) : null);
    }

    if (path === "/api/os") return handleOs(req, env, url);

    return json({ error: "not found" }, 404);
  },
} satisfies ExportedHandler<Env>;
