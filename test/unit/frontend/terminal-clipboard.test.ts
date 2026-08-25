import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTerminalClipboardKeyHandler } from "../../../src/frontend/terminal-clipboard";

class FakeClipboardTarget {
  private readonly listeners = new Map<string, Set<EventListener>>();

  addEventListener(type: string, listener: EventListener): void {
    const listeners = this.listeners.get(type) ?? new Set<EventListener>();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: EventListener): void {
    this.listeners.get(type)?.delete(listener);
  }

  dispatch(type: "copy" | "paste"): void {
    for (const listener of this.listeners.get(type) ?? []) {
      listener(new Event(type));
    }
  }
}

function keyEvent(
  key: string,
  modifiers: Partial<Pick<KeyboardEvent, "ctrlKey" | "shiftKey" | "metaKey">> = {},
): KeyboardEvent {
  return {
    type: "keydown",
    key,
    ctrlKey: false,
    shiftKey: false,
    metaKey: false,
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
    ...modifiers,
  } as unknown as KeyboardEvent;
}

describe("終端剪貼簿快捷鍵", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("Windows/Linux 有選取時 Ctrl+C 複製，無選取時保留遠端 SIGINT", () => {
    let selection = "selected output";
    const target = new FakeClipboardTarget();
    const handler = createTerminalClipboardKeyHandler({
      isMac: false,
      getSelection: () => selection,
      paste: vi.fn(),
      eventTarget: target,
      clipboard: { readText: vi.fn(), writeText: vi.fn() },
      onError: vi.fn(),
    });

    const copy = keyEvent("c", { ctrlKey: true });
    expect(handler(copy)).toBe(false);
    expect(copy.preventDefault).not.toHaveBeenCalled();
    target.dispatch("copy");

    selection = "";
    expect(handler(keyEvent("c", { ctrlKey: true }))).toBe(true);
  });

  it.each([
    ["Ctrl+Shift+C", false, keyEvent("c", { ctrlKey: true, shiftKey: true })],
    ["Cmd+C", true, keyEvent("c", { metaKey: true })],
  ])("%s 由瀏覽器原生 copy 優先處理", (_label, isMac, event) => {
    const target = new FakeClipboardTarget();
    const clipboard = { readText: vi.fn(), writeText: vi.fn() };
    const handler = createTerminalClipboardKeyHandler({
      isMac,
      getSelection: () => "copy me",
      paste: vi.fn(),
      eventTarget: target,
      clipboard,
      onError: vi.fn(),
    });

    expect(handler(event)).toBe(false);
    expect(event.preventDefault).not.toHaveBeenCalled();
    target.dispatch("copy");
    vi.runAllTimers();
    expect(clipboard.writeText).not.toHaveBeenCalled();
  });

  it.each([
    ["Ctrl+Shift+V", false, keyEvent("v", { ctrlKey: true, shiftKey: true })],
    ["Shift+Insert", false, keyEvent("Insert", { shiftKey: true })],
    ["Cmd+V", true, keyEvent("v", { metaKey: true })],
  ])("%s 由瀏覽器原生 paste 優先處理", (_label, isMac, event) => {
    const target = new FakeClipboardTarget();
    const paste = vi.fn();
    const clipboard = { readText: vi.fn(), writeText: vi.fn() };
    const handler = createTerminalClipboardKeyHandler({
      isMac,
      getSelection: () => "",
      paste,
      eventTarget: target,
      clipboard,
      onError: vi.fn(),
    });

    expect(handler(event)).toBe(false);
    expect(event.preventDefault).not.toHaveBeenCalled();
    target.dispatch("paste");
    vi.runAllTimers();
    expect(clipboard.readText).not.toHaveBeenCalled();
    expect(paste).not.toHaveBeenCalled();
  });

  it("原生 paste 未發生時才讀 Clipboard API 並交給 xterm paste", async () => {
    const target = new FakeClipboardTarget();
    const paste = vi.fn();
    const clipboard = {
      readText: vi.fn(async () => "fallback paste"),
      writeText: vi.fn(),
    };
    const handler = createTerminalClipboardKeyHandler({
      isMac: false,
      getSelection: () => "",
      paste,
      eventTarget: target,
      clipboard,
      onError: vi.fn(),
      nativeEventTimeoutMs: 50,
    });

    expect(handler(keyEvent("v", { ctrlKey: true, shiftKey: true }))).toBe(false);
    await vi.advanceTimersByTimeAsync(50);
    expect(clipboard.readText).toHaveBeenCalledOnce();
    expect(paste).toHaveBeenCalledWith("fallback paste");
  });

  it("Clipboard API 被拒絕時提示錯誤，且不阻止原生快捷鍵預設行為", async () => {
    const target = new FakeClipboardTarget();
    const onError = vi.fn();
    const event = keyEvent("v", { ctrlKey: true, shiftKey: true });
    const handler = createTerminalClipboardKeyHandler({
      isMac: false,
      getSelection: () => "",
      paste: vi.fn(),
      eventTarget: target,
      clipboard: {
        readText: vi.fn(async () => { throw new Error("denied"); }),
        writeText: vi.fn(),
      },
      onError,
      nativeEventTimeoutMs: 50,
    });

    expect(handler(event)).toBe(false);
    expect(event.preventDefault).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(50);
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining("剪貼簿") }));
  });
});
