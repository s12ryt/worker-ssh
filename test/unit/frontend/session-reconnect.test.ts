import { describe, expect, it, vi } from "vitest";
import type { BackendReconnectState } from "../../../src/frontend/backend-ssh-client";
import { handleSessionReconnect } from "../../../src/frontend/session-reconnect";

function fixture() {
  const writes: string[] = [];
  const terminal = {
    term: {
      cols: 120,
      rows: 40,
      options: { disableStdin: false },
      write: (value: string | Uint8Array) => writes.push(
        typeof value === "string" ? value : new TextDecoder().decode(value),
      ),
      focus: vi.fn(),
    },
  };
  const client = {
    openShell: vi.fn(async (_connId, _cols, _rows, onData) => {
      onData(new TextEncoder().encode("restored"));
      return 2;
    }),
    shellResize: vi.fn(),
  };
  const poller = { start: vi.fn(), stop: vi.fn() };
  const sftp = {
    getCurrentPath: vi.fn(() => "/tmp/work"),
    open: vi.fn(async () => undefined),
  };
  return { terminal, client, poller, sftp, writes };
}

describe("工作階段自動重連恢復", () => {
  it("重連期間停止監控、鎖住終端輸入且不緩衝輸入", async () => {
    const deps = fixture();
    const setStatus = vi.fn();

    await handleSessionReconnect(
      { state: "reconnecting", attempt: 1, delayMs: 1_000 },
      { ...deps, connId: 1, setStatus, onError: vi.fn() },
    );

    expect(deps.poller.stop).toHaveBeenCalledOnce();
    expect(deps.terminal.term.options.disableStdin).toBe(true);
    expect(deps.client.openShell).not.toHaveBeenCalled();
    expect(deps.writes.join("")).toContain("第 1 次重新連線");
    expect(setStatus).toHaveBeenCalledWith("connecting");
  });

  it("重連成功後建立新 shell、恢復 SFTP 路徑與監控", async () => {
    const deps = fixture();
    const setStatus = vi.fn();

    await handleSessionReconnect(
      { state: "ready", attempt: 2 },
      { ...deps, connId: 1, setStatus, onError: vi.fn() },
    );

    expect(deps.client.openShell).toHaveBeenCalledWith(
      1,
      120,
      40,
      expect.any(Function),
    );
    expect(deps.client.shellResize).toHaveBeenCalledWith(1, 120, 40);
    expect(deps.sftp.open).toHaveBeenCalledWith("/tmp/work");
    expect(deps.poller.start).toHaveBeenCalledOnce();
    expect(deps.terminal.term.options.disableStdin).toBe(false);
    expect(deps.terminal.term.focus).toHaveBeenCalledOnce();
    expect(deps.writes.join("")).toContain("restored");
    expect(setStatus).toHaveBeenLastCalledWith("open");
  });

  it("重連耗盡後維持鎖定並顯示需手動處理", async () => {
    const deps = fixture();
    const setStatus = vi.fn();
    const state: BackendReconnectState = { state: "failed", attempt: 3 };

    await handleSessionReconnect(state, {
      ...deps,
      connId: 1,
      setStatus,
      onError: vi.fn(),
    });

    expect(deps.terminal.term.options.disableStdin).toBe(true);
    expect(deps.poller.start).not.toHaveBeenCalled();
    expect(deps.writes.join("")).toContain("自動重新連線失敗");
    expect(setStatus).toHaveBeenLastCalledWith("error");
  });
});
