import { describe, expect, it, vi } from "vitest";
import {
  connectInitializedSshSession,
  SshSessionInitializationError,
} from "../../../src/worker/ssh-session-init";

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("connectInitializedSshSession", () => {
  it("connect 首次 409 時只重新 init 一次並使用新 nonce", async () => {
    const calls: Array<{ url: string; body?: string }> = [];
    let initCount = 0;
    let connectCount = 0;
    const stub = {
      fetch: vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        calls.push({ url, body: typeof init?.body === "string" ? init.body : undefined });
        if (url.endsWith("/init")) {
          initCount += 1;
          return jsonResponse({ nonce: `nonce-${initCount}` });
        }
        connectCount += 1;
        return connectCount === 1
          ? jsonResponse({ error: "session not initialized" }, 409)
          : ({ status: 101 } as Response);
      }),
    };

    const response = await connectInitializedSshSession(
      stub,
      { config: { id: "conn-1" }, quota: { leaseId: "lease-1" } },
    );

    expect(response.status).toBe(101);
    expect(initCount).toBe(2);
    expect(connectCount).toBe(2);
    expect(calls.map((call) => call.url)).toEqual([
      "https://ssh-session.internal/init",
      "https://ssh-session.internal/connect?nonce=nonce-1",
      "https://ssh-session.internal/init",
      "https://ssh-session.internal/connect?nonce=nonce-2",
    ]);
  });

  it("非 409 connect 失敗不重試，初始化回應無 nonce 時安全失敗", async () => {
    const connectFailure = {
      fetch: vi
        .fn()
        .mockResolvedValueOnce(jsonResponse({ nonce: "nonce-1" }))
        .mockResolvedValueOnce(jsonResponse({ error: "failed" }, 502)),
    };
    const failed = await connectInitializedSshSession(connectFailure, { value: 1 });
    expect(failed.status).toBe(502);
    expect(connectFailure.fetch).toHaveBeenCalledTimes(2);

    const invalidInit = {
      fetch: vi.fn().mockResolvedValue(jsonResponse({ ok: true })),
    };
    await expect(connectInitializedSshSession(invalidInit, { value: 1 })).rejects.toBeInstanceOf(
      SshSessionInitializationError,
    );
    expect(invalidInit.fetch).toHaveBeenCalledTimes(1);
  });
});
