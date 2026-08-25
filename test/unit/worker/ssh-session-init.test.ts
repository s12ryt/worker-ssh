import { describe, expect, it, vi } from "vitest";
import {
  connectInitializedSshSession,
  decodeSessionConfigHeader,
  encodeSessionConfigHeader,
  sshSessionDoName,
  SshSessionInitializationError,
} from "../../../src/worker/ssh-session-init";

/**
 * connectInitializedSshSession：單一 subrequest 契約
 *
 * - 只打一次 /connect（GET + Upgrade + X-Session-Config header）
 * - 任何非 101 回應直接透傳（不重試）
 * - payload 含非 ASCII 字元時 header round-trip 不失真
 * - 不可序列化 payload → SshSessionInitializationError
 */
describe("connectInitializedSshSession", () => {
  const payload = {
    config: { id: "conn-1", name: "我的伺服器", password: "秘密" },
    quota: { sessionKey: "key-1", leaseId: "lease-1" },
  };

  it("單次 GET /connect，Upgrade 與 X-Session-Config header 可往返解回原 payload", async () => {
    const stub = {
      fetch: vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        const headers = init?.headers as Record<string, string>;
        const config = headers?.["X-Session-Config"];
        expect(typeof config).toBe("string");
        expect(decodeSessionConfigHeader(config as string)).toEqual(payload);
        return { status: 101 } as Response;
      }),
    };

    const response = await connectInitializedSshSession(stub, payload);

    expect(response.status).toBe(101);
    expect(stub.fetch).toHaveBeenCalledTimes(1);
    const call = stub.fetch.mock.calls[0]!;
    expect(String(call[0])).toBe("https://ssh-session.internal/connect");
    const init = call[1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers.Upgrade).toBe("websocket");
    expect(typeof headers["X-Session-Config"]).toBe("string");
  });

  it("非 101 回應直接透傳，不重試", async () => {
    const stub = {
      fetch: vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: "invalid session config" }), {
          status: 400,
        }),
      ),
    };
    const failed = await connectInitializedSshSession(stub, payload);
    expect(failed.status).toBe(400);
    expect(stub.fetch).toHaveBeenCalledTimes(1);
  });

  it("不可序列化 payload 拋 SshSessionInitializationError 且不發起請求", async () => {
    const circular: Record<string, unknown> = { self: null };
    circular.self = circular;
    const stub = { fetch: vi.fn() };
    await expect(
      connectInitializedSshSession(stub, circular),
    ).rejects.toBeInstanceOf(SshSessionInitializationError);
    expect(stub.fetch).not.toHaveBeenCalled();
  });
});

describe("session config header 編解碼", () => {
  it("非 ASCII 內容 round-trip 不失真", () => {
    const value = { name: "連線「測試」", password: "p@ssλ" };
    const header = encodeSessionConfigHeader(value);
    expect(typeof header).toBe("string");
    expect(decodeSessionConfigHeader(header)).toEqual(value);
  });
});

/**
 * sshSessionDoName：以 connectionId 衍生穩定的 DO 名稱
 *
 * 同一連線重複連線時命中同一個 Durable Object instance：
 * 暖 isolate 免冷啟動、Go WASM runtime（module 單例）免重新 instantiate。
 * DO 本身無跨請求狀態（config 走 X-Session-Config header），重用安全。
 */
describe("sshSessionDoName", () => {
  it("同一 connectionId 衍生相同 DO 名（決定性，無隨機後綴）", () => {
    const first = sshSessionDoName("conn-123");
    const second = sshSessionDoName("conn-123");
    expect(first).toBe(second);
    expect(first).toBe("ssh-conn-123");
  });

  it("不同 connectionId 衍生不同 DO 名", () => {
    expect(sshSessionDoName("conn-a")).not.toBe(sshSessionDoName("conn-b"));
  });
});
