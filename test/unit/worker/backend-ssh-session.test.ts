import { describe, expect, it, vi } from "vitest";
import { BackendSshSession } from "../../../src/worker/backend-ssh-session";
import type { BackendSshEngine } from "../../../src/worker/backend-ssh-runtime";

class FakeSocket {
  readonly sent: string[] = [];
  readonly closes: Array<{ code?: number; reason?: string }> = [];
  private listeners = new Map<string, Array<(event: { data?: string }) => void>>();

  send(data: string): void {
    this.sent.push(data);
  }

  close(code?: number, reason?: string): void {
    this.closes.push({ code, reason });
  }

  addEventListener(type: string, listener: (event: { data?: string }) => void): void {
    const values = this.listeners.get(type) ?? [];
    values.push(listener);
    this.listeners.set(type, values);
  }

  receive(message: unknown): void {
    for (const listener of this.listeners.get("message") ?? []) {
      listener({ data: JSON.stringify(message) });
    }
  }
}

function engineWithHostKey(fingerprint = "SHA256:actual"): BackendSshEngine {
  return {
    connect: vi.fn(async (config: Record<string, unknown>) => {
      const verify = config.verifyHostKey as (info: {
        keyType: string;
        fingerprint: string;
      }) => Promise<boolean>;
      if (!await verify({ keyType: "ssh-ed25519", fingerprint })) {
        throw new Error("host key rejected");
      }
      return 7;
    }),
    disconnect: vi.fn(),
    exec: vi.fn(async () => ({ stdout: "ok", stderr: "", exitCode: 0 })),
    openShell: vi.fn(async () => 8),
    shellWrite: vi.fn(),
    shellResize: vi.fn(),
    shellClose: vi.fn(),
    sftpList: vi.fn(async () => [{ name: "file.txt", size: 2, isDir: false }]),
    sftpStat: vi.fn(async () => ({ name: "file.txt", size: 2, isDir: false })),
    sftpReadFile: vi.fn(async () => new TextEncoder().encode("ok")),
    sftpWriteFile: vi.fn(async () => undefined),
    sftpOpenRead: vi.fn(async () => ({ handleId: 21, size: 2 })),
    sftpReadChunk: vi.fn(async () => ({ data: new TextEncoder().encode("ok"), eof: true })),
    sftpCloseRead: vi.fn(async () => undefined),
    sftpOpenWrite: vi.fn(async () => 22),
    sftpWriteChunk: vi.fn(async () => undefined),
    sftpCloseWrite: vi.fn(async () => undefined),
    sftpMkdir: vi.fn(async () => undefined),
    sftpRemove: vi.fn(async () => undefined),
    sftpRename: vi.fn(async () => undefined),
  };
}

const CONFIG = {
  id: "conn-1",
  name: "Fixture",
  host: "127.0.0.1",
  port: 2222,
  username: "tester",
  authType: "password" as const,
  password: "secret-pass",
  createdAt: 1,
  updatedAt: 1,
};

async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("BackendSshSession", () => {
  it("首次主機金鑰只送非敏感 challenge，確認後完成連線", async () => {
    const socket = new FakeSocket();
    const session = new BackendSshSession({
      engine: engineWithHostKey(),
      socket,
      transport: { close: vi.fn() },
      config: CONFIG,
    });

    const started = session.start();
    await settle();
    const challenge = JSON.parse(socket.sent.at(-1)!) as Record<string, unknown>;
    expect(challenge).toMatchObject({
      type: "host-key",
      keyType: "ssh-ed25519",
      fingerprint: "SHA256:actual",
    });
    expect(JSON.stringify(socket.sent)).not.toContain(CONFIG.password);

    socket.receive({ type: "host-key-response", challengeId: challenge.challengeId, accepted: true });
    await started;
    expect(socket.sent.map((item) => JSON.parse(item))).toContainEqual(
      expect.objectContaining({ type: "state", state: "ready" }),
    );
  });

  it("已信任指紋一致免 challenge，不一致由後端直接阻擋", async () => {
    const trustedSocket = new FakeSocket();
    await new BackendSshSession({
      engine: engineWithHostKey("SHA256:trusted"),
      socket: trustedSocket,
      transport: { close: vi.fn() },
      config: { ...CONFIG, hostKeyFingerprint: "SHA256:trusted" },
    }).start();
    expect(trustedSocket.sent.some((item) => JSON.parse(item).type === "host-key")).toBe(false);

    const mismatchSocket = new FakeSocket();
    await new BackendSshSession({
      engine: engineWithHostKey("SHA256:changed"),
      socket: mismatchSocket,
      transport: { close: vi.fn() },
      config: { ...CONFIG, hostKeyFingerprint: "SHA256:trusted" },
    }).start();
    expect(mismatchSocket.sent.map((item) => JSON.parse(item))).toContainEqual(
      expect.objectContaining({
        type: "host-key-mismatch",
        expected: "SHA256:trusted",
        actual: "SHA256:changed",
      }),
    );
    expect(mismatchSocket.sent.map((item) => JSON.parse(item))).toContainEqual(
      expect.objectContaining({ type: "state", state: "error" }),
    );
  });

  it("exec 與 SFTP RPC 回應依 request id 對應", async () => {
    const socket = new FakeSocket();
    const engine = engineWithHostKey("SHA256:trusted");
    const session = new BackendSshSession({
      engine,
      socket,
      transport: { close: vi.fn() },
      config: { ...CONFIG, hostKeyFingerprint: "SHA256:trusted" },
    });
    await session.start();

    socket.receive({ type: "request", id: "r1", method: "exec", params: { command: "whoami" } });
    socket.receive({ type: "request", id: "r2", method: "sftpList", params: { path: "/tmp" } });
    await settle();

    expect(socket.sent.map((item) => JSON.parse(item))).toContainEqual({
      type: "response",
      id: "r1",
      ok: true,
      result: { stdout: "ok", stderr: "", exitCode: 0 },
    });
    expect(socket.sent.map((item) => JSON.parse(item))).toContainEqual({
      type: "response",
      id: "r2",
      ok: true,
      result: [{ name: "file.txt", size: 2, isDir: false }],
    });
  });

  it("完整轉送 shell 與 SFTP 操作，斷線時釋放後端資源", async () => {
    const socket = new FakeSocket();
    const transport = { close: vi.fn() };
    const engine = engineWithHostKey("SHA256:trusted");
    const session = new BackendSshSession({
      engine,
      socket,
      transport,
      config: { ...CONFIG, hostKeyFingerprint: "SHA256:trusted" },
    });
    await session.start();

    socket.receive({ type: "request", id: "open", method: "openShell", params: { cols: 80, rows: 24 } });
    await settle();
    expect(engine.openShell).toHaveBeenCalledOnce();
    const shellOnData = vi.mocked(engine.openShell).mock.calls[0]![3];
    shellOnData(new TextEncoder().encode("shell"));
    socket.receive({ type: "shell-write", text: "pwd\n" });
    socket.receive({ type: "shell-resize", cols: 120, rows: 40 });
    socket.receive({ type: "shell-close" });

    socket.receive({ type: "request", id: "list", method: "sftpList", params: { path: "/tmp" } });
    await settle();
    socket.receive({ type: "request", id: "stat", method: "sftpStat", params: { path: "/tmp/a" } });
    await settle();
    socket.receive({ type: "request", id: "mkdir", method: "sftpMkdir", params: { path: "/tmp/d" } });
    await settle();
    socket.receive({ type: "request", id: "remove", method: "sftpRemove", params: { path: "/tmp/a" } });
    await settle();
    socket.receive({ type: "request", id: "rename", method: "sftpRename", params: { from: "/tmp/a", to: "/tmp/b" } });
    await settle();
    socket.receive({ type: "disconnect" });
    await settle();

    expect(engine.shellWrite).toHaveBeenCalledWith(8, "pwd\n");
    expect(engine.shellResize).toHaveBeenCalledWith(8, 120, 40);
    expect(engine.shellClose).toHaveBeenCalledWith(8);
    expect(engine.sftpList).toHaveBeenCalledWith(7, "/tmp");
    expect(engine.sftpStat).toHaveBeenCalledWith(7, "/tmp/a");
    expect(engine.sftpMkdir).toHaveBeenCalledWith(7, "/tmp/d");
    expect(engine.sftpRemove).toHaveBeenCalledWith(7, "/tmp/a");
    expect(engine.sftpRename).toHaveBeenCalledWith(7, "/tmp/a", "/tmp/b");
    expect(engine.disconnect).toHaveBeenCalledWith(7);
    expect(transport.close).toHaveBeenCalled();
    await expect(session.waitUntilClosed()).resolves.toBeUndefined();
    expect(socket.sent.map((item) => JSON.parse(item))).toContainEqual({
      type: "shell-data",
      base64: "c2hlbGw=",
    });
  });

  it("拒絕超過 768 KiB 的 JSON frame", async () => {
    const socket = new FakeSocket();
    const transport = { close: vi.fn() };
    const session = new BackendSshSession({
      engine: engineWithHostKey("SHA256:trusted"),
      socket,
      transport,
      config: { ...CONFIG, hostKeyFingerprint: "SHA256:trusted" },
    });
    await session.start();

    socket.receive({ type: "shell-write", text: "x".repeat(768 * 1024) });
    await settle();

    expect(socket.closes).toContainEqual(
      expect.objectContaining({ code: 1009 }),
    );
    expect(transport.close).toHaveBeenCalled();
  });

  it("每個工作階段最多同時執行 4 個 request", async () => {
    const socket = new FakeSocket();
    const resolvers: Array<() => void> = [];
    const engine = engineWithHostKey("SHA256:trusted");
    vi.mocked(engine.exec).mockImplementation(
      () => new Promise((resolve) => {
        resolvers.push(() => resolve({ stdout: "ok", stderr: "", exitCode: 0 }));
      }),
    );
    const session = new BackendSshSession({
      engine,
      socket,
      transport: { close: vi.fn() },
      config: { ...CONFIG, hostKeyFingerprint: "SHA256:trusted" },
    });
    await session.start();

    for (let index = 1; index <= 5; index += 1) {
      socket.receive({
        type: "request",
        id: `r${index}`,
        method: "exec",
        params: { command: "whoami" },
      });
    }
    await settle();

    expect(engine.exec).toHaveBeenCalledTimes(4);
    expect(socket.sent.map((item) => JSON.parse(item))).toContainEqual({
      type: "response",
      id: "r5",
      ok: false,
      error: "too many requests",
    });
    for (const resolve of resolvers) resolve();
    await settle();
  });

  it("每秒 request 超過 burst 40 時關閉工作階段", async () => {
    const socket = new FakeSocket();
    const transport = { close: vi.fn() };
    const session = new BackendSshSession({
      engine: engineWithHostKey("SHA256:trusted"),
      socket,
      transport,
      config: { ...CONFIG, hostKeyFingerprint: "SHA256:trusted" },
      now: () => 1_000,
    });
    await session.start();

    for (let index = 0; index < 41; index += 1) {
      socket.receive({
        type: "request",
        id: `rate-${index}`,
        method: "sftpMkdir",
        params: { path: `/tmp/${index}` },
      });
    }
    await settle();

    expect(socket.closes).toContainEqual(
      expect.objectContaining({ code: 1008 }),
    );
    expect(transport.close).toHaveBeenCalled();
  });

  it("首次 TOFU challenge 60 秒未回覆時拒絕並釋放 transport", async () => {
    vi.useFakeTimers();
    try {
      const socket = new FakeSocket();
      const transport = { close: vi.fn() };
      const session = new BackendSshSession({
        engine: engineWithHostKey(),
        socket,
        transport,
        config: CONFIG,
        challengeTimeoutMs: 60_000,
      });

      const started = session.start();
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(60_000);
      await started;

      expect(socket.sent.map((item) => JSON.parse(item))).toContainEqual(
        expect.objectContaining({ type: "state", state: "error" }),
      );
      expect(transport.close).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("SFTP 檔案資料只以 512 KiB 以下分塊 RPC 傳輸", async () => {
    const socket = new FakeSocket();
    const engine = engineWithHostKey("SHA256:trusted");
    const session = new BackendSshSession({
      engine,
      socket,
      transport: { close: vi.fn() },
      config: { ...CONFIG, hostKeyFingerprint: "SHA256:trusted" },
    });
    await session.start();

    socket.receive({ type: "request", id: "ro", method: "sftpOpenRead", params: { path: "/tmp/a" } });
    await settle();
    socket.receive({ type: "request", id: "rc", method: "sftpReadChunk", params: { handleId: 21 } });
    await settle();
    socket.receive({ type: "request", id: "rr", method: "sftpCloseRead", params: { handleId: 21 } });
    await settle();
    socket.receive({ type: "request", id: "wo", method: "sftpOpenWrite", params: { path: "/tmp/a" } });
    await settle();
    socket.receive({ type: "request", id: "wc", method: "sftpWriteChunk", params: { handleId: 22, base64: "b2s=" } });
    await settle();
    socket.receive({ type: "request", id: "wr", method: "sftpCloseWrite", params: { handleId: 22 } });
    await settle();

    expect(engine.sftpOpenRead).toHaveBeenCalledWith(7, "/tmp/a");
    expect(engine.sftpReadChunk).toHaveBeenCalledWith(21, 512 * 1024);
    expect(engine.sftpCloseRead).toHaveBeenCalledWith(21);
    expect(engine.sftpOpenWrite).toHaveBeenCalledWith(7, "/tmp/a");
    expect(engine.sftpWriteChunk).toHaveBeenCalledWith(22, expect.any(Uint8Array));
    expect(engine.sftpCloseWrite).toHaveBeenCalledWith(22);
    expect(socket.sent.map((item) => JSON.parse(item))).toContainEqual({
      type: "response",
      id: "rc",
      ok: true,
      result: { base64: "b2s=", eof: true },
    });
  });
});
