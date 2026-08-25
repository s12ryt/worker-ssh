import { describe, expect, it, vi } from "vitest";
import { cleanupSessionResources, type SessionResources } from "@/frontend/session-lifecycle";

function resources(overrides: Partial<SessionResources> = {}): SessionResources {
  return {
    ...overrides,
  };
}

describe("cleanupSessionResources", () => {
  it("初始化中只建立 transport 時仍會關閉它", () => {
    const close = vi.fn();
    cleanupSessionResources(resources({ client: { close } as never }));
    expect(close).toHaveBeenCalledOnce();
  });

  it("完整工作階段會停止輪詢、圖表、shell、連線、transport 與 terminal", () => {
    const stop = vi.fn();
    const destroy = vi.fn();
    const shellClose = vi.fn();
    const disconnect = vi.fn();
    const close = vi.fn();
    const dispose = vi.fn();
    const state = resources({
      connId: 7,
      client: { shellClose, disconnect, close } as never,
      terminal: { dispose } as never,
      poller: { stop } as never,
      charts: { destroy } as never,
    });

    cleanupSessionResources(state);

    expect(stop).toHaveBeenCalledOnce();
    expect(destroy).toHaveBeenCalledOnce();
    expect(shellClose).toHaveBeenCalledWith(7);
    expect(disconnect).toHaveBeenCalledWith(7);
    expect(close).not.toHaveBeenCalled();
    expect(dispose).toHaveBeenCalledOnce();
  });

  it("某個清理步驟拋錯時仍執行其餘步驟，且重複呼叫不再清理", () => {
    const stop = vi.fn(() => { throw new Error("stop failed"); });
    const close = vi.fn();
    const dispose = vi.fn();
    const state = resources({
      poller: { stop } as never,
      client: { close } as never,
      terminal: { dispose } as never,
    });

    cleanupSessionResources(state);
    cleanupSessionResources(state);

    expect(stop).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
    expect(dispose).toHaveBeenCalledOnce();
  });
});
