import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

/**
 * SSH -o 選項與 Access 代理的 API 契約（第二十三節）：
 * - 合法 sshOptions / accessProxy 隨連線加密儲存並可回讀
 * - 白名單外選項、accessProxy 缺 secret → 400 並指明原因
 * - clientSecret 永不出現在任何回應；PATCH 空白保留語意與密碼一致
 */

const PANEL_PASSWORD = "test-panel-pass";

function jsonInit(method: string, body?: unknown): RequestInit {
  return {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  };
}

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

async function loginCookie(): Promise<string> {
  const res = await SELF.fetch(
    "https://example.com/api/login",
    jsonInit("POST", { password: PANEL_PASSWORD }),
  );
  expect(res.status).toBe(200);
  const setCookie = res.headers.get("Set-Cookie");
  expect(setCookie).toBeTruthy();
  const cookie = setCookie!.split(";")[0]!;
  await completeBootstrap(cookie);
  return cookie;
}

function withCookie(init: RequestInit, cookie: string): RequestInit {
  const headers = { ...(init.headers as Record<string, string>), Cookie: cookie };
  return { ...init, headers };
}

const BASE_CONN = {
  name: "opts-host",
  host: "192.168.1.10",
  port: 22,
  username: "root",
  authType: "password",
  password: "s3cret",
};

describe("SSH 選項與 Access 代理 API", () => {
  it("合法 sshOptions 可建立並回顯正規化值", async () => {
    const cookie = await loginCookie();
    const res = await SELF.fetch(
      "https://example.com/api/connections",
      withCookie(
        jsonInit("POST", {
          ...BASE_CONN,
          sshOptions: [
            { key: "serveraliveinterval", value: "60" },
            { key: "Ciphers", value: "aes128-ctr" },
          ],
        }),
        cookie,
      ),
    );
    expect(res.status).toBe(201);
    const created = (await res.json()) as {
      sshOptions?: Array<{ key: string; value: string }>;
    };
    expect(created.sshOptions).toEqual([
      { key: "ServerAliveInterval", value: "60" },
      { key: "Ciphers", value: "aes128-ctr" },
    ]);
  });

  it("白名單外選項建立回 400 並列出選項名", async () => {
    const cookie = await loginCookie();
    const res = await SELF.fetch(
      "https://example.com/api/connections",
      withCookie(
        jsonInit("POST", {
          ...BASE_CONN,
          name: "bad-opts",
          sshOptions: [{ key: "StrictHostKeyChecking", value: "no" }],
        }),
        cookie,
      ),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("StrictHostKeyChecking");
  });

  it("accessProxy 建立成功；回應含 hostname/clientId 但永不含 clientSecret", async () => {
    const cookie = await loginCookie();
    const res = await SELF.fetch(
      "https://example.com/api/connections",
      withCookie(
        jsonInit("POST", {
          ...BASE_CONN,
          name: "access-host",
          host: "loc-ssh.czy-cf.eu.cc",
          accessProxy: {
            hostname: "loc-ssh.czy-cf.eu.cc",
            clientId: "cid-123",
            clientSecret: "should-never-appear",
          },
        }),
        cookie,
      ),
    );
    expect(res.status).toBe(201);
    const created = (await res.json()) as {
      id: string;
      accessProxy?: Record<string, unknown>;
    };
    expect(created.accessProxy).toMatchObject({
      hostname: "loc-ssh.czy-cf.eu.cc",
      clientId: "cid-123",
    });
    expect(created.accessProxy).not.toHaveProperty("clientSecret");
    expect(JSON.stringify(created)).not.toContain("should-never-appear");

    const list = await SELF.fetch(
      "https://example.com/api/connections",
      withCookie({}, cookie),
    );
    const items = (await list.json()) as Array<Record<string, unknown>>;
    const mine = items.find((item) => item.id === created.id);
    expect(mine).toBeDefined();
    expect(JSON.stringify(mine)).not.toContain("should-never-appear");
  });

  it("accessProxy 有 clientId 無 clientSecret → 400", async () => {
    const cookie = await loginCookie();
    const res = await SELF.fetch(
      "https://example.com/api/connections",
      withCookie(
        jsonInit("POST", {
          ...BASE_CONN,
          name: "missing-secret",
          accessProxy: { hostname: "h.example.com", clientId: "cid" },
        }),
        cookie,
      ),
    );
    expect(res.status).toBe(400);
  });

  it("PUT：sshOptions 替換、未提供保留；accessProxy null 清除", async () => {
    const cookie = await loginCookie();
    const create = await SELF.fetch(
      "https://example.com/api/connections",
      withCookie(
        jsonInit("POST", {
          ...BASE_CONN,
          name: "patch-host",
          sshOptions: [{ key: "ConnectTimeout", value: "10" }],
          accessProxy: { hostname: "t.example.com" },
        }),
        cookie,
      ),
    );
    expect(create.status).toBe(201);
    const created = (await create.json()) as { id: string };

    const patchOpts = await SELF.fetch(
      `https://example.com/api/connections/${created.id}`,
      withCookie(
        jsonInit("PUT", {
          sshOptions: [{ key: "ConnectTimeout", value: "30" }],
        }),
        cookie,
      ),
    );
    expect(patchOpts.status).toBe(200);
    const patched = (await patchOpts.json()) as {
      sshOptions?: Array<{ key: string; value: string }>;
      accessProxy?: { hostname: string } | null;
    };
    expect(patched.sshOptions).toEqual([
      { key: "ConnectTimeout", value: "30" },
    ]);
    expect(patched.accessProxy).toEqual({ hostname: "t.example.com" });

    const patchOther = await SELF.fetch(
      `https://example.com/api/connections/${created.id}`,
      withCookie(jsonInit("PUT", { name: "patch-host-2" }), cookie),
    );
    expect(patchOther.status).toBe(200);
    const untouched = (await patchOther.json()) as {
      sshOptions?: Array<{ key: string; value: string }>;
    };
    expect(untouched.sshOptions).toEqual([
      { key: "ConnectTimeout", value: "30" },
    ]);

    const patchClear = await SELF.fetch(
      `https://example.com/api/connections/${created.id}`,
      withCookie(jsonInit("PUT", { accessProxy: null }), cookie),
    );
    expect(patchClear.status).toBe(200);
    const cleared = (await patchClear.json()) as {
      accessProxy?: unknown;
    };
    expect(cleared.accessProxy).toBeUndefined();
  });

  it("PUT accessProxy 空白 clientSecret 保留既有值（不回顯）", async () => {
    const cookie = await loginCookie();
    const create = await SELF.fetch(
      "https://example.com/api/connections",
      withCookie(
        jsonInit("POST", {
          ...BASE_CONN,
          name: "keep-secret",
          accessProxy: {
            hostname: "h.example.com",
            clientId: "cid",
            clientSecret: "orig-secret",
          },
        }),
        cookie,
      ),
    );
    expect(create.status).toBe(201);
    const created = (await create.json()) as { id: string };

    const patch = await SELF.fetch(
      `https://example.com/api/connections/${created.id}`,
      withCookie(
        jsonInit("PUT", {
          accessProxy: { hostname: "h2.example.com", clientId: "cid" },
        }),
        cookie,
      ),
    );
    expect(patch.status).toBe(200);
    const body = (await patch.json()) as {
      accessProxy?: { hostname: string; clientId?: string };
    };
    expect(body.accessProxy).toMatchObject({
      hostname: "h2.example.com",
      clientId: "cid",
    });
    expect(JSON.stringify(body)).not.toContain("orig-secret");
  });
});
