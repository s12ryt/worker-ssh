import { env, SELF } from "cloudflare:test";
import { describe, expect, it, vi } from "vitest";
import { encryptLegacyV1 } from "./crypto-fixtures";
import { decryptString, resetKeyCache } from "../../../src/worker/crypto";
import { resetDbReadyCache } from "../../../src/worker/db-ready-cache";

/**
 * index.ts HTTP 路由整合測試
 *
 * 契約：
 * - POST /api/login   {password} → 200 {ok:true} + Set-Cookie | 400 格式錯 | 401 密碼錯
 * - GET  /api/session → 200 {authenticated:boolean}（無需登入）
 * - POST /api/logout  → 200 + 清除 Cookie
 * - CRUD /api/connections（需登入）→ 200/201/204 | 400 | 401 | 404
 * - GET/PUT /api/os（需登入）→ OS 快取讀寫
 * - /proxy 守衛順序：未登入 401 → 參數無效 400 → 非 WS 升級 426
 * - 其餘路徑 → ASSETS fallback；未知 /api/* → 404
 */

const PANEL_PASSWORD = "test-panel-pass";

function jsonInit(method: string, body?: unknown): RequestInit {
  return {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  };
}

/** 以正確密碼登入並回傳 Cookie 值（worker_ssh_session=<token>） */
async function completeBootstrap(cookie: string): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const res = await SELF.fetch(
      "https://example.com/api/bootstrap",
      withCookie({ method: "POST" }, cookie),
    );
    expect(res.status).toBe(200);
    const status = (await res.json()) as { status: string; errorCode?: string };
    if (status.status === "complete") return;
    if (status.status === "failed") throw new Error(status.errorCode);
  }
  throw new Error("bootstrap did not complete");
}

async function loginCookie(runBootstrap = true): Promise<string> {
  const res = await SELF.fetch(
    "https://example.com/api/login",
    jsonInit("POST", { password: PANEL_PASSWORD }),
  );
  expect(res.status).toBe(200);
  const setCookie = res.headers.get("Set-Cookie");
  expect(setCookie).toBeTruthy();
  const cookie = setCookie!.split(";")[0]!;
  if (runBootstrap) await completeBootstrap(cookie);
  return cookie;
}

function withCookie(init: RequestInit, cookie: string): RequestInit {
  const headers = { ...(init.headers as Record<string, string>), Cookie: cookie };
  return { ...init, headers };
}

const VALID_CONN = {
  name: "我的伺服器",
  host: "192.168.1.10",
  port: 22,
  username: "root",
  authType: "password",
  password: "s3cret",
};

describe("認證 API", () => {
  it("POST /api/login 正確密碼 → 200、Set-Cookie 含 session 與 HttpOnly", async () => {
    const res = await SELF.fetch(
      "https://example.com/api/login",
      jsonInit("POST", { password: PANEL_PASSWORD }),
    );
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true });
    const setCookie = res.headers.get("Set-Cookie") ?? "";
    expect(setCookie).toContain("worker_ssh_session=");
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("SameSite=Strict");
    expect(setCookie).toContain("Max-Age=");
  });

  it("POST /api/login 錯誤密碼 → 401", async () => {
    const res = await SELF.fetch(
      "https://example.com/api/login",
      jsonInit("POST", { password: "wrong" }),
    );
    expect(res.status).toBe(401);
  });

  it("同來源 5 次密碼失敗後，第 6 次回 429 與 Retry-After", async () => {
    const headers = {
      "Content-Type": "application/json",
      "CF-Connecting-IP": "203.0.113.10",
    };
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      const res = await SELF.fetch("https://example.com/api/login", {
        method: "POST",
        headers,
        body: JSON.stringify({ password: `wrong-${attempt}` }),
      });
      expect(res.status).toBe(401);
    }

    const blocked = await SELF.fetch("https://example.com/api/login", {
      method: "POST",
      headers,
      body: JSON.stringify({ password: PANEL_PASSWORD }),
    });
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get("Retry-After"))).toBeGreaterThan(0);
    await expect(blocked.json()).resolves.toEqual({ error: "too many attempts" });
  });

  it("成功登入會清除同來源的失敗計數", async () => {
    const headers = {
      "Content-Type": "application/json",
      "CF-Connecting-IP": "203.0.113.11",
    };
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const failed = await SELF.fetch("https://example.com/api/login", {
        method: "POST",
        headers,
        body: JSON.stringify({ password: "wrong" }),
      });
      expect(failed.status).toBe(401);
    }
    const success = await SELF.fetch("https://example.com/api/login", {
      method: "POST",
      headers,
      body: JSON.stringify({ password: PANEL_PASSWORD }),
    });
    expect(success.status).toBe(200);

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const failed = await SELF.fetch("https://example.com/api/login", {
        method: "POST",
        headers,
        body: JSON.stringify({ password: "wrong-again" }),
      });
      expect(failed.status).toBe(401);
    }
  });

  it("POST /api/login 缺 password 欄位 → 400", async () => {
    const res = await SELF.fetch(
      "https://example.com/api/login",
      jsonInit("POST", {}),
    );
    expect(res.status).toBe(400);
  });

  it("POST /api/login 非 JSON body → 400", async () => {
    const res = await SELF.fetch("https://example.com/api/login", {
      method: "POST",
      body: "not-json",
    });
    expect(res.status).toBe(400);
  });

  it("GET /api/session 未登入 → authenticated:false", async () => {
    const res = await SELF.fetch("https://example.com/api/session");
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ authenticated: false });
  });

  it("GET /api/session 帶有效 cookie → authenticated:true", async () => {
    const cookie = await loginCookie();
    const res = await SELF.fetch(
      "https://example.com/api/session",
      withCookie({}, cookie),
    );
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ authenticated: true });
  });

  it("POST /api/logout → 200 且 Set-Cookie 清除（Max-Age=0）", async () => {
    const res = await SELF.fetch("https://example.com/api/logout", {
      method: "POST",
    });
    expect(res.status).toBe(200);
    const setCookie = res.headers.get("Set-Cookie") ?? "";
    expect(setCookie).toContain("Max-Age=0");
  });
});

describe("後端 SSH 可行性 probe", () => {
  it("未登入不得存取", async () => {
    const res = await SELF.fetch("https://example.com/api/backend-ssh/probe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ host: "127.0.0.1", port: 2222, username: "tester" }),
    });
    expect(res.status).toBe(401);
  });

  it("已登入但非 POST 方法回 405", async () => {
    const cookie = await loginCookie();
    const res = await SELF.fetch(
      "https://example.com/api/backend-ssh/probe",
      withCookie({ method: "GET" }, cookie),
    );
    expect(res.status).toBe(405);
  });
});

describe("後端 SSH WebSocket 路由", () => {
  it("未登入不得建立工作階段", async () => {
    const res = await SELF.fetch(
      "https://example.com/api/ssh?connectionId=missing",
      { headers: { Upgrade: "websocket" } },
    );
    expect(res.status).toBe(401);
  });

  it("已登入時先驗證連線與 WebSocket upgrade", async () => {
    const cookie = await loginCookie();
    const missing = await SELF.fetch(
      "https://example.com/api/ssh?connectionId=missing",
      withCookie({ headers: { Upgrade: "websocket" } }, cookie),
    );
    expect(missing.status).toBe(404);

    const created = await SELF.fetch(
      "https://example.com/api/connections",
      withCookie(jsonInit("POST", VALID_CONN), cookie),
    );
    const connection = (await created.json()) as { id: string };
    const notUpgrade = await SELF.fetch(
      `https://example.com/api/ssh?connectionId=${encodeURIComponent(connection.id)}`,
      withCookie({}, cookie),
    );
    expect(notUpgrade.status).toBe(426);
  });

  it("已清除憑證的連線不得建立工作階段", async () => {
    const cookie = await loginCookie();
    const created = await SELF.fetch(
      "https://example.com/api/connections",
      withCookie(jsonInit("POST", VALID_CONN), cookie),
    );
    const connection = (await created.json()) as { id: string };
    await SELF.fetch(
      `https://example.com/api/connections/${encodeURIComponent(connection.id)}/credential`,
      withCookie({ method: "DELETE" }, cookie),
    );

    const res = await SELF.fetch(
      `https://example.com/api/ssh?connectionId=${encodeURIComponent(connection.id)}`,
      withCookie({ headers: { Upgrade: "websocket" } }, cookie),
    );
    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toEqual({ error: "credential missing" });
  });
});

describe("D1 初始化 API", () => {
  it("未登入不得讀取初始化狀態", async () => {
    const res = await SELF.fetch("https://example.com/api/bootstrap");
    expect(res.status).toBe(401);
  });

  it("登入後可短步驟推進並持久化到 complete", async () => {
    const cookie = await loginCookie(false);
    const initial = await SELF.fetch(
      "https://example.com/api/bootstrap",
      withCookie({}, cookie),
    );
    expect(initial.status).toBe(200);
    await expect(initial.json()).resolves.toMatchObject({
      status: "pending",
      phase: "kv_scan",
    });

    let final: Record<string, unknown> | undefined;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const step = await SELF.fetch(
        "https://example.com/api/bootstrap",
        withCookie({ method: "POST" }, cookie),
      );
      expect(step.status).toBe(200);
      final = (await step.json()) as Record<string, unknown>;
      if (final.status === "complete") break;
    }
    expect(final).toMatchObject({
      status: "complete",
      phase: "complete",
      percent: 100,
    });
  });

  it("初始化完成前拒絕連線與資料夾 CRUD", async () => {
    // isolatedStorage 會回滾 D1，但 isolate 內的 module 記憶體不回滾；
    // 此測試模擬「未 bootstrap」狀態，需同步重置就緒快取以還原語意。
    resetDbReadyCache();
    const cookie = await loginCookie(false);
    const connections = await SELF.fetch(
      "https://example.com/api/connections",
      withCookie({}, cookie),
    );
    const folders = await SELF.fetch(
      "https://example.com/api/folders",
      withCookie(jsonInit("POST", { name: "Blocked" }), cookie),
    );

    expect(connections.status).toBe(423);
    expect(folders.status).toBe(423);
    await expect(connections.json()).resolves.toMatchObject({
      error: "database initialization required",
      status: "pending",
    });
  });
});

describe("全域設定 API", () => {
  const VALID_SETTINGS = {
    theme: "high-contrast",
    terminalFontSize: 18,
    monitorIntervalSeconds: 10,
    autoReconnectEnabled: false,
    autoReconnectAttempts: 5,
  };

  it("未登入不得讀取設定", async () => {
    const res = await SELF.fetch("https://example.com/api/settings");
    expect(res.status).toBe(401);
  });

  it("初始化完成前拒絕讀寫設定", async () => {
    // 同上：重置就緒快取以模擬未 bootstrap 的隔離環境。
    resetDbReadyCache();
    const cookie = await loginCookie(false);
    const res = await SELF.fetch(
      "https://example.com/api/settings",
      withCookie({}, cookie),
    );
    expect(res.status).toBe(423);
  });

  it("沒有資料時回預設值，PUT 後所有裝置可讀回同一 singleton", async () => {
    const cookie = await loginCookie();
    const defaults = await SELF.fetch(
      "https://example.com/api/settings",
      withCookie({}, cookie),
    );
    expect(defaults.status).toBe(200);
    await expect(defaults.json()).resolves.toMatchObject({
      theme: "dark",
      terminalFontSize: 14,
      monitorIntervalSeconds: 3,
      autoReconnectEnabled: true,
      autoReconnectAttempts: 3,
    });

    const saved = await SELF.fetch(
      "https://example.com/api/settings",
      withCookie(jsonInit("PUT", VALID_SETTINGS), cookie),
    );
    expect(saved.status).toBe(200);
    await expect(saved.json()).resolves.toMatchObject(VALID_SETTINGS);

    const readBack = await SELF.fetch(
      "https://example.com/api/settings",
      withCookie({}, cookie),
    );
    await expect(readBack.json()).resolves.toMatchObject(VALID_SETTINGS);
  });

  it("拒絕非法設定且不覆蓋已保存值", async () => {
    const cookie = await loginCookie();
    const initial = await SELF.fetch(
      "https://example.com/api/settings",
      withCookie(jsonInit("PUT", VALID_SETTINGS), cookie),
    );
    expect(initial.status).toBe(200);

    const invalidValues = [
      { ...VALID_SETTINGS, theme: "light" },
      { ...VALID_SETTINGS, terminalFontSize: 11 },
      { ...VALID_SETTINGS, terminalFontSize: 21 },
      { ...VALID_SETTINGS, monitorIntervalSeconds: 4 },
      { ...VALID_SETTINGS, autoReconnectEnabled: "yes" },
      { ...VALID_SETTINGS, autoReconnectAttempts: 0 },
      { ...VALID_SETTINGS, autoReconnectAttempts: 6 },
    ];
    for (const value of invalidValues) {
      const res = await SELF.fetch(
        "https://example.com/api/settings",
        withCookie(jsonInit("PUT", value), cookie),
      );
      expect(res.status).toBe(400);
    }

    const readBack = await SELF.fetch(
      "https://example.com/api/settings",
      withCookie({}, cookie),
    );
    await expect(readBack.json()).resolves.toMatchObject(VALID_SETTINGS);
  });
});

describe("連線 CRUD（需登入）", () => {
  it("GET /api/connections 未帶 cookie → 401", async () => {
    const res = await SELF.fetch("https://example.com/api/connections");
    expect(res.status).toBe(401);
  });

  it("GET /api/connections 竄改的 cookie → 401", async () => {
    const cookie = await loginCookie();
    const forged = `${cookie}x`;
    const res = await SELF.fetch(
      "https://example.com/api/connections",
      withCookie({}, forged),
    );
    expect(res.status).toBe(401);
  });

  it("POST 合法連線 → 201 含 id，所有回應脫敏且標示憑證可用", async () => {
    const cookie = await loginCookie();

    const created = await SELF.fetch(
      "https://example.com/api/connections",
      withCookie(jsonInit("POST", VALID_CONN), cookie),
    );
    expect(created.status).toBe(201);
    const config = (await created.json()) as Record<string, unknown>;
    expect(typeof config.id).toBe("string");
    expect(config.name).toBe(VALID_CONN.name);
    expect(config.credentialState).toBe("ready");
    expect(config).not.toHaveProperty("password");
    expect(config).not.toHaveProperty("privateKey");
    expect(config).not.toHaveProperty("passphrase");

    const list = await SELF.fetch(
      "https://example.com/api/connections",
      withCookie({}, cookie),
    );
    expect(list.status).toBe(200);
    const items = (await list.json()) as Array<Record<string, unknown>>;
    expect(items).toHaveLength(1);
    expect(items[0]!.id).toBe(config.id);
    expect(JSON.stringify(items)).not.toContain(VALID_CONN.password);
  });

  it("POST 缺 host → 400", async () => {
    const cookie = await loginCookie();
    const bad = { ...VALID_CONN, host: undefined };
    const res = await SELF.fetch(
      "https://example.com/api/connections",
      withCookie(jsonInit("POST", bad), cookie),
    );
    expect(res.status).toBe(400);
  });

  it("POST port 超出範圍 → 400", async () => {
    const cookie = await loginCookie();
    for (const port of [0, 65536, 22.5]) {
      const res = await SELF.fetch(
        "https://example.com/api/connections",
        withCookie(jsonInit("POST", { ...VALID_CONN, port }), cookie),
      );
      expect(res.status).toBe(400);
    }
  });

  it("POST authType=privateKey 但缺私鑰 → 400", async () => {
    const cookie = await loginCookie();
    const bad = { ...VALID_CONN, authType: "privateKey" };
    delete (bad as Record<string, unknown>).password;
    const res = await SELF.fetch(
      "https://example.com/api/connections",
      withCookie(jsonInit("POST", bad), cookie),
    );
    expect(res.status).toBe(400);
  });

  it("GET 單一連線：存在 → 200，不存在 → 404", async () => {
    const cookie = await loginCookie();
    const created = await SELF.fetch(
      "https://example.com/api/connections",
      withCookie(jsonInit("POST", VALID_CONN), cookie),
    );
    const config = (await created.json()) as { id: string };

    const found = await SELF.fetch(
      `https://example.com/api/connections/${config.id}`,
      withCookie({}, cookie),
    );
    expect(found.status).toBe(200);

    const missing = await SELF.fetch(
      "https://example.com/api/connections/no-such-id",
      withCookie({}, cookie),
    );
    expect(missing.status).toBe(404);
  });

  it("PUT 更新名稱 → 200 且 updatedAt 不早於 createdAt", async () => {
    const cookie = await loginCookie();
    const created = await SELF.fetch(
      "https://example.com/api/connections",
      withCookie(jsonInit("POST", VALID_CONN), cookie),
    );
    const config = (await created.json()) as {
      id: string;
      createdAt: string;
      updatedAt: string;
    };

    const updated = await SELF.fetch(
      `https://example.com/api/connections/${config.id}`,
      withCookie(jsonInit("PUT", { name: "改名後" }), cookie),
    );
    expect(updated.status).toBe(200);
    const after = (await updated.json()) as {
      name: string;
      createdAt: string;
      updatedAt: string;
    };
    expect(after.name).toBe("改名後");
    expect(new Date(after.updatedAt).getTime()).toBeGreaterThanOrEqual(
      new Date(config.createdAt).getTime(),
    );
  });

  it("PUT 空白密碼保留既有憑證，明確清除後標示 missing", async () => {
    const cookie = await loginCookie();
    const created = await SELF.fetch(
      "https://example.com/api/connections",
      withCookie(jsonInit("POST", VALID_CONN), cookie),
    );
    const config = (await created.json()) as { id: string };

    const kept = await SELF.fetch(
      `https://example.com/api/connections/${config.id}`,
      withCookie(jsonInit("PUT", { name: "保留密碼", password: "" }), cookie),
    );
    expect(kept.status).toBe(200);
    await expect(kept.json()).resolves.toMatchObject({ credentialState: "ready" });
    const row = await env.DB
      .prepare("SELECT payload_envelope FROM connections WHERE id = ?")
      .bind(config.id)
      .first<string>("payload_envelope");
    expect(row).toBeTruthy();
    expect(JSON.parse(await decryptString("test-enc-key", row!))).toMatchObject({
      password: VALID_CONN.password,
    });

    const cleared = await SELF.fetch(
      `https://example.com/api/connections/${config.id}/credential`,
      withCookie({ method: "DELETE" }, cookie),
    );
    expect(cleared.status).toBe(200);
    await expect(cleared.json()).resolves.toMatchObject({
      credentialState: "missing",
    });
  });

  it("PUT 可保存 host key 信任資料，null 可重設且不影響其他欄位", async () => {
    const cookie = await loginCookie();
    const created = await SELF.fetch(
      "https://example.com/api/connections",
      withCookie(jsonInit("POST", VALID_CONN), cookie),
    );
    const config = (await created.json()) as { id: string; name: string };

    const trusted = await SELF.fetch(
      `https://example.com/api/connections/${config.id}`,
      withCookie(
        jsonInit("PUT", {
          hostKeyType: "ssh-ed25519",
          hostKeyFingerprint: "SHA256:trusted-key",
        }),
        cookie,
      ),
    );
    expect(trusted.status).toBe(200);
    await expect(trusted.json()).resolves.toMatchObject({
      name: VALID_CONN.name,
      hostKeyType: "ssh-ed25519",
      hostKeyFingerprint: "SHA256:trusted-key",
    });

    const reset = await SELF.fetch(
      `https://example.com/api/connections/${config.id}`,
      withCookie(
        jsonInit("PUT", {
          hostKeyType: null,
          hostKeyFingerprint: null,
        }),
        cookie,
      ),
    );
    expect(reset.status).toBe(200);
    const after = (await reset.json()) as Record<string, unknown>;
    expect(after.name).toBe(VALID_CONN.name);
    expect(after).not.toHaveProperty("hostKeyType");
    expect(after).not.toHaveProperty("hostKeyFingerprint");
  });

  // ── D20：連線時間雲同步（lastConnectedAt / lastDisconnectedAt） ──

  it("PUT 更新 lastConnectedAt → 200 且可取回（D20 雲同步）", async () => {
    const cookie = await loginCookie();
    const created = await SELF.fetch(
      "https://example.com/api/connections",
      withCookie(jsonInit("POST", VALID_CONN), cookie),
    );
    const config = (await created.json()) as { id: string };
    const ts = 1710000000000;

    const res = await SELF.fetch(
      `https://example.com/api/connections/${config.id}`,
      withCookie(jsonInit("PUT", { lastConnectedAt: ts }), cookie),
    );
    expect(res.status).toBe(200);
    const after = (await res.json()) as { lastConnectedAt: number };
    expect(after.lastConnectedAt).toBe(ts);

    const fetched = await SELF.fetch(
      `https://example.com/api/connections/${config.id}`,
      withCookie({}, cookie),
    );
    const got = (await fetched.json()) as { lastConnectedAt: number };
    expect(got.lastConnectedAt).toBe(ts);
  });

  it("PUT 更新 lastDisconnectedAt 不覆蓋 lastConnectedAt", async () => {
    const cookie = await loginCookie();
    const created = await SELF.fetch(
      "https://example.com/api/connections",
      withCookie(jsonInit("POST", VALID_CONN), cookie),
    );
    const config = (await created.json()) as { id: string };
    const connectTs = 1710000000000;
    const disconnectTs = 1710000005000;

    await SELF.fetch(
      `https://example.com/api/connections/${config.id}`,
      withCookie(jsonInit("PUT", { lastConnectedAt: connectTs }), cookie),
    );
    const res = await SELF.fetch(
      `https://example.com/api/connections/${config.id}`,
      withCookie(jsonInit("PUT", { lastDisconnectedAt: disconnectTs }), cookie),
    );
    expect(res.status).toBe(200);
    const after = (await res.json()) as {
      lastConnectedAt: number;
      lastDisconnectedAt: number;
    };
    expect(after.lastConnectedAt).toBe(connectTs);
    expect(after.lastDisconnectedAt).toBe(disconnectTs);
  });

  it("PUT lastConnectedAt 非數字 → 400（型別守門）", async () => {
    const cookie = await loginCookie();
    const created = await SELF.fetch(
      "https://example.com/api/connections",
      withCookie(jsonInit("POST", VALID_CONN), cookie),
    );
    const config = (await created.json()) as { id: string };
    const res = await SELF.fetch(
      `https://example.com/api/connections/${config.id}`,
      withCookie(jsonInit("PUT", { lastConnectedAt: "not-a-number" }), cookie),
    );
    expect(res.status).toBe(400);
  });

  it("PUT 不存在的 id → 404", async () => {
    const cookie = await loginCookie();
    const res = await SELF.fetch(
      "https://example.com/api/connections/no-such-id",
      withCookie(jsonInit("PUT", { name: "x" }), cookie),
    );
    expect(res.status).toBe(404);
  });

  it("DELETE → 204，之後 GET → 404", async () => {
    const cookie = await loginCookie();
    const created = await SELF.fetch(
      "https://example.com/api/connections",
      withCookie(jsonInit("POST", VALID_CONN), cookie),
    );
    const config = (await created.json()) as { id: string };

    const del = await SELF.fetch(
      `https://example.com/api/connections/${config.id}`,
      withCookie({ method: "DELETE" }, cookie),
    );
    expect(del.status).toBe(204);

    const gone = await SELF.fetch(
      `https://example.com/api/connections/${config.id}`,
      withCookie({}, cookie),
    );
    expect(gone.status).toBe(404);
  });
});

describe("資料夾與 scoped API（需登入且初始化完成）", () => {
  it("加密provider失敗時回安全錯誤分類且不洩漏底層訊息", async () => {
    const cookie = await loginCookie();
    resetKeyCache();
    const originalDeriveKey = crypto.subtle.deriveKey.bind(crypto.subtle) as (
      ...args: Parameters<SubtleCrypto["deriveKey"]>
    ) => ReturnType<SubtleCrypto["deriveKey"]>;
    const derive = vi
      .spyOn(crypto.subtle, "deriveKey")
      .mockImplementation((...args: Parameters<SubtleCrypto["deriveKey"]>) => {
        const derivedKeyType = args[2];
        if (
          typeof derivedKeyType !== "string" &&
          derivedKeyType.name === "AES-GCM"
        ) {
          return Promise.reject(new Error("sensitive provider detail"));
        }
        return originalDeriveKey(...args);
      });

    try {
      const response = await SELF.fetch(
        "https://example.com/api/folders",
        withCookie(jsonInit("POST", { name: "Encryption failure" }), cookie),
      );
      expect(response.status).toBe(500);
      const body = await response.json();
      expect(body).toEqual({
        error: "encryption operation failed",
        code: "ENCRYPTION_UNAVAILABLE",
      });
      expect(JSON.stringify(body)).not.toContain("sensitive provider detail");
    } finally {
      derive.mockRestore();
      resetKeyCache();
    }
  });

  it("GET /api/folders 只回資料夾摘要供移動目的地選擇", async () => {
    const cookie = await loginCookie();
    await SELF.fetch(
      "https://example.com/api/folders",
      withCookie(jsonInit("POST", { name: "Root", parentId: null }), cookie),
    );

    const response = await SELF.fetch(
      "https://example.com/api/folders",
      withCookie({}, cookie),
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual([
      expect.objectContaining({ name: "Root", recursiveHostCount: 0 }),
    ]);
  });

  it("建立巢狀資料夾、scoped read 與批量移動只回直接內容", async () => {
    const cookie = await loginCookie();
    const rootRes = await SELF.fetch(
      "https://example.com/api/folders",
      withCookie(jsonInit("POST", { name: "Root" }), cookie),
    );
    expect(rootRes.status).toBe(201);
    const root = (await rootRes.json()) as { id: string };
    const childRes = await SELF.fetch(
      "https://example.com/api/folders",
      withCookie(jsonInit("POST", { name: "Child", parentId: root.id }), cookie),
    );
    const child = (await childRes.json()) as { id: string };
    const deepRes = await SELF.fetch(
      "https://example.com/api/connections",
      withCookie(jsonInit("POST", { ...VALID_CONN, name: "Deep", folderId: child.id }), cookie),
    );
    const deep = (await deepRes.json()) as { id: string };

    const rootScope = await SELF.fetch(
      `https://example.com/api/scope?folderId=${encodeURIComponent(root.id)}`,
      withCookie({}, cookie),
    );
    expect(rootScope.status).toBe(200);
    await expect(rootScope.json()).resolves.toMatchObject({
      folder: { id: root.id, recursiveHostCount: 1 },
      folders: [{ id: child.id, recursiveHostCount: 1 }],
      connections: [],
    });

    const moved = await SELF.fetch(
      "https://example.com/api/connections/move",
      withCookie(jsonInit("POST", { ids: [deep.id], folderId: root.id }), cookie),
    );
    expect(moved.status).toBe(200);
    const after = await SELF.fetch(
      `https://example.com/api/scope?folderId=${encodeURIComponent(root.id)}`,
      withCookie({}, cookie),
    );
    await expect(after.json()).resolves.toMatchObject({
      connections: [expect.objectContaining({ id: deep.id, folderId: root.id })],
    });
  });

  it("批量移動超過 50 個唯一連線時直接回 400", async () => {
    const cookie = await loginCookie();
    const response = await SELF.fetch(
      "https://example.com/api/connections/move",
      withCookie(
        jsonInit("POST", {
          ids: Array.from({ length: 51 }, (_, index) => `conn-${index}`),
          folderId: null,
        }),
        cookie,
      ),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "too many connections to move",
    });
  });

  it("同層重名、循環與第九層皆回可辨識的 409/400", async () => {
    const cookie = await loginCookie();
    const first = await SELF.fetch(
      "https://example.com/api/folders",
      withCookie(jsonInit("POST", { name: "Same" }), cookie),
    );
    const firstFolder = (await first.json()) as { id: string };
    const duplicate = await SELF.fetch(
      "https://example.com/api/folders",
      withCookie(jsonInit("POST", { name: " same " }), cookie),
    );
    expect(duplicate.status).toBe(409);

    let parentId = firstFolder.id;
    const chain = [firstFolder.id];
    for (let depth = 2; depth <= 8; depth += 1) {
      const response = await SELF.fetch(
        "https://example.com/api/folders",
        withCookie(jsonInit("POST", { name: `Level ${depth}`, parentId }), cookie),
      );
      expect(response.status).toBe(201);
      parentId = ((await response.json()) as { id: string }).id;
      chain.push(parentId);
    }
    const tooDeep = await SELF.fetch(
      "https://example.com/api/folders",
      withCookie(jsonInit("POST", { name: "Level 9", parentId }), cookie),
    );
    expect(tooDeep.status).toBe(400);

    const cycle = await SELF.fetch(
      `https://example.com/api/folders/${chain[0]}`,
      withCookie(jsonInit("PUT", { parentId: chain.at(-1) }), cookie),
    );
    expect(cycle.status).toBe(400);
  });

  it("非空資料夾支援 promote 與 recursive 刪除語意", async () => {
    const cookie = await loginCookie();
    const root = await SELF.fetch(
      "https://example.com/api/folders",
      withCookie(jsonInit("POST", { name: "Delete root" }), cookie),
    ).then((res) => res.json() as Promise<{ id: string }>);
    const middle = await SELF.fetch(
      "https://example.com/api/folders",
      withCookie(jsonInit("POST", { name: "Middle", parentId: root.id }), cookie),
    ).then((res) => res.json() as Promise<{ id: string }>);
    const child = await SELF.fetch(
      "https://example.com/api/folders",
      withCookie(jsonInit("POST", { name: "Child", parentId: middle.id }), cookie),
    ).then((res) => res.json() as Promise<{ id: string }>);
    const conn = await SELF.fetch(
      "https://example.com/api/connections",
      withCookie(jsonInit("POST", { ...VALID_CONN, folderId: middle.id }), cookie),
    ).then((res) => res.json() as Promise<{ id: string }>);

    const promoted = await SELF.fetch(
      `https://example.com/api/folders/${middle.id}?mode=promote`,
      withCookie({ method: "DELETE" }, cookie),
    );
    expect(promoted.status).toBe(204);
    await expect(
      SELF.fetch(`https://example.com/api/connections/${conn.id}`, withCookie({}, cookie))
        .then((res) => res.json()),
    ).resolves.toMatchObject({ folderId: root.id });

    const removed = await SELF.fetch(
      `https://example.com/api/folders/${child.id}?mode=recursive`,
      withCookie({ method: "DELETE" }, cookie),
    );
    expect(removed.status).toBe(204);
  });
});

describe("連線加密遷移 API（需登入）", () => {
  it("未登入不得觸發遷移", async () => {
    const res = await SELF.fetch(
      "https://example.com/api/migrations/connections",
      jsonInit("POST", {}),
    );
    expect(res.status).toBe(401);
  });

  it("無法解析的 cursor 回 400", async () => {
    const cookie = await loginCookie();
    const res = await SELF.fetch(
      "https://example.com/api/migrations/connections",
      withCookie(jsonInit("POST", { cursor: "not-base64" }), cookie),
    );

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({
      error: "invalid migration cursor",
    });
  });

  it("舊相容端點只轉換 KV 信封，不繞過 D1 bootstrap 注入主儲存", async () => {
    const cookie = await loginCookie();
    const legacy = {
      ...VALID_CONN,
      id: "legacy-http",
      createdAt: 1,
      updatedAt: 1,
    };
    await env.KV.put(
      "conn:legacy-http",
      await encryptLegacyV1("test-enc-key", JSON.stringify(legacy)),
    );

    const migrated = await SELF.fetch(
      "https://example.com/api/migrations/connections",
      withCookie(jsonInit("POST", {}), cookie),
    );

    expect(migrated.status).toBe(200);
    await expect(migrated.json()).resolves.toMatchObject({
      done: true,
      migrated: 1,
      failed: 0,
    });
    expect((await env.KV.get("conn:legacy-http"))?.startsWith("v3:")).toBe(true);

    const list = await SELF.fetch(
      "https://example.com/api/connections",
      withCookie({}, cookie),
    );
    expect(list.status).toBe(200);
    await expect(list.json()).resolves.toEqual([]);
  });

  it("KV 故障回 500 且不誤報為 cursor 無效", async () => {
    const cookie = await loginCookie();
    const getSpy = vi
      .spyOn(env.KV, "get")
      .mockRejectedValueOnce(new Error("sensitive kv failure"));

    try {
      const res = await SELF.fetch(
        "https://example.com/api/migrations/connections",
        withCookie(jsonInit("POST", {}), cookie),
      );

      expect(res.status).toBe(500);
      await expect(res.json()).resolves.toEqual({ error: "migration failed" });
    } finally {
      getSpy.mockRestore();
    }
  });
});

describe("OS 快取 API（需登入）", () => {
  const KEY = "abc123hostkey";
  const INFO = {
    os: "ubuntu",
    family: "linux",
    distro: "Ubuntu",
    version: "24.04",
    detectedAt: "2026-08-22T00:00:00.000Z",
  };

  it("PUT 後 GET 可取回 OsInfo", async () => {
    const cookie = await loginCookie();

    const put = await SELF.fetch(
      "https://example.com/api/os",
      withCookie(jsonInit("PUT", { key: KEY, info: INFO }), cookie),
    );
    expect(put.status).toBe(200);

    const get = await SELF.fetch(
      `https://example.com/api/os?key=${encodeURIComponent(KEY)}`,
      withCookie({}, cookie),
    );
    expect(get.status).toBe(200);
    await expect(get.json()).resolves.toEqual(INFO);
  });

  it("GET 不存在的 key → 204 No Content（快取未命中非錯誤，避免 console 404 噪音）", async () => {
    const cookie = await loginCookie();
    const res = await SELF.fetch(
      "https://example.com/api/os?key=nothing",
      withCookie({}, cookie),
    );
    expect(res.status).toBe(204);
    expect(await res.text()).toBe("");
  });

  it("PUT 缺 key 或缺 info → 400", async () => {
    const cookie = await loginCookie();
    const noKey = await SELF.fetch(
      "https://example.com/api/os",
      withCookie(jsonInit("PUT", { info: INFO }), cookie),
    );
    expect(noKey.status).toBe(400);

    const noInfo = await SELF.fetch(
      "https://example.com/api/os",
      withCookie(jsonInit("PUT", { key: KEY }), cookie),
    );
    expect(noInfo.status).toBe(400);
  });

  it("GET /api/os 未登入 → 401", async () => {
    const res = await SELF.fetch(`https://example.com/api/os?key=${KEY}`);
    expect(res.status).toBe(401);
  });
});

describe("舊瀏覽器 TCP proxy 已停用", () => {
  it("未登入或已登入都不再暴露 /proxy", async () => {
    const anonymous = await SELF.fetch(
      "https://example.com/proxy?host=example.com&port=22",
    );
    expect(anonymous.status).toBe(404);

    const cookie = await loginCookie();
    const authenticated = await SELF.fetch(
      "https://example.com/proxy?host=example.com&port=22",
      withCookie({ headers: { Upgrade: "websocket" } }, cookie),
    );
    expect(authenticated.status).toBe(404);
  });
});

describe("路由 fallback", () => {
  it("未知 /api/* 路徑 → 404", async () => {
    const res = await SELF.fetch(
      "https://example.com/api/definitely-not-a-route",
    );
    expect(res.status).toBe(404);
  });

  it("非 API 路徑由已提交的測試 assets fixture 提供", async () => {
    const res = await SELF.fetch("https://example.com/");
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("data-worker-ssh-test-assets");
  });
});
