import { describe, expect, it, vi } from "vitest";
import { runBackendSshProbe } from "../../../src/worker/backend-ssh-probe";
import type { BackendSshEngine } from "../../../src/worker/backend-ssh-runtime";

describe("runBackendSshProbe", () => {
  it("驗證 host key、password auth、exec、shell 與 SFTP，結果不含憑證", async () => {
    let verifyHostKey: ((info: unknown) => Promise<boolean>) | undefined;
    let onShellData: ((data: Uint8Array) => void) | undefined;
    const transport = { close: vi.fn() };
    const engine: BackendSshEngine = {
      connect: vi.fn(async (config: Record<string, unknown>) => {
        verifyHostKey = config.verifyHostKey as typeof verifyHostKey;
        await verifyHostKey?.({
          hostname: "127.0.0.1:2222",
          keyType: "ssh-ed25519",
          fingerprint: "SHA256:fixture",
        });
        return 11;
      }),
      disconnect: vi.fn(),
      exec: vi.fn(async () => ({
        stdout: "Ubuntu 24.04 LTS\n",
        stderr: "",
        exitCode: 0,
      })),
      openShell: vi.fn(async (_connId, _cols, _rows, callback) => {
        onShellData = callback as (data: Uint8Array) => void;
        return 22;
      }),
      shellWrite: vi.fn((_handleId, text: string) => {
        onShellData?.(new TextEncoder().encode(text));
      }),
      shellResize: vi.fn(),
      shellClose: vi.fn(),
      sftpList: vi.fn(async () => [
        { name: "probe-renamed.txt", size: 8, isDir: false },
      ]),
      sftpStat: vi.fn(),
    sftpReadFile: vi.fn(async () => new TextEncoder().encode("probe-ok")),
    sftpWriteFile: vi.fn(async () => undefined),
    sftpOpenRead: vi.fn(async () => ({ handleId: 21, size: 8 })),
    sftpReadChunk: vi.fn(async () => ({ data: new Uint8Array(), eof: true })),
    sftpCloseRead: vi.fn(async () => undefined),
    sftpOpenWrite: vi.fn(async () => 22),
    sftpWriteChunk: vi.fn(async () => undefined),
    sftpCloseWrite: vi.fn(async () => undefined),
      sftpMkdir: vi.fn(async () => undefined),
      sftpRemove: vi.fn(async () => undefined),
      sftpRename: vi.fn(async () => undefined),
    };

    const result = await runBackendSshProbe(
      engine,
      transport,
      {
        host: "127.0.0.1",
        port: 2222,
        username: "tester",
        password: "secret-pass",
      },
      { timeoutMs: 100, probeId: "unit" },
    );

    expect(engine.connect).toHaveBeenCalledWith(
      expect.objectContaining({
        authType: "password",
        password: "secret-pass",
        transport,
      }),
    );
    expect(result.hostKey).toEqual({
      keyType: "ssh-ed25519",
      fingerprint: "SHA256:fixture",
    });
    expect(result.exec).toEqual({ exitCode: 0, stdoutIncludesUbuntu: true });
    expect(result.shellEcho).toBe(true);
    expect(result.sftp).toEqual({
      listed: true,
      readBack: true,
      cleaned: true,
    });
    expect(engine.sftpMkdir).toHaveBeenCalledWith(11, "/tmp/worker-ssh-probe-unit");
    expect(engine.sftpRename).toHaveBeenCalled();
    expect(engine.sftpRemove).toHaveBeenCalledTimes(2);
    expect(engine.shellClose).toHaveBeenCalledWith(22);
    expect(engine.disconnect).toHaveBeenCalledWith(11);
    expect(JSON.stringify(result)).not.toContain("secret-pass");
  });
});
