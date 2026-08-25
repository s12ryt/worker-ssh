interface ClipboardAccess {
  readText(): Promise<string>;
  writeText(text: string): Promise<void>;
}

interface ClipboardEventTarget {
  addEventListener(type: string, listener: EventListener, options?: AddEventListenerOptions): void;
  removeEventListener(type: string, listener: EventListener, options?: EventListenerOptions): void;
}

export interface TerminalClipboardDependencies {
  isMac: boolean;
  getSelection(): string;
  paste(text: string): void;
  eventTarget: ClipboardEventTarget;
  clipboard?: ClipboardAccess;
  onError(error: Error): void;
  nativeEventTimeoutMs?: number;
}

type ClipboardAction = "copy" | "paste";

function clipboardError(action: ClipboardAction): Error {
  const label = action === "copy" ? "複製" : "貼上";
  return new Error(`無法存取系統剪貼簿，請改用瀏覽器原生${label}操作`);
}

/**
 * xterm 只需停止把剪貼簿快捷鍵轉成遠端輸入；瀏覽器的原生 copy/paste
 * 預設行為仍保留。若原生事件沒有發生，才以 Clipboard API 作後備。
 */
export function createTerminalClipboardKeyHandler(
  deps: TerminalClipboardDependencies,
): (event: KeyboardEvent) => boolean {
  const nativeEventTimeoutMs = deps.nativeEventTimeoutMs ?? 75;

  const awaitNativeEvent = (action: ClipboardAction, selection: string): void => {
    let completed = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const finish = (): void => {
      if (completed) return;
      completed = true;
      deps.eventTarget.removeEventListener(action, onNativeEvent, { capture: true });
      if (timer !== null) clearTimeout(timer);
    };
    const onNativeEvent: EventListener = () => finish();

    deps.eventTarget.addEventListener(action, onNativeEvent, { capture: true, once: true });
    timer = setTimeout(() => {
      finish();
      if (!deps.clipboard) {
        deps.onError(clipboardError(action));
        return;
      }

      const fallback = action === "copy"
        ? deps.clipboard.writeText(selection)
        : deps.clipboard.readText().then((text) => deps.paste(text));
      void fallback.catch(() => deps.onError(clipboardError(action)));
    }, nativeEventTimeoutMs);
  };

  return (event: KeyboardEvent): boolean => {
    if (event.type !== "keydown") return true;

    const key = event.key.toLowerCase();
    const selection = deps.getSelection();
    const copyShortcut = deps.isMac
      ? event.metaKey && !event.ctrlKey && key === "c"
      : event.ctrlKey && !event.metaKey && key === "c" && (event.shiftKey || selection.length > 0);
    if (copyShortcut) {
      if (selection.length > 0) awaitNativeEvent("copy", selection);
      return false;
    }

    const pasteShortcut = deps.isMac
      ? event.metaKey && !event.ctrlKey && key === "v"
      : (event.ctrlKey && event.shiftKey && !event.metaKey && key === "v")
        || (event.shiftKey && !event.ctrlKey && !event.metaKey && key === "insert");
    if (pasteShortcut) {
      awaitNativeEvent("paste", "");
      return false;
    }

    return true;
  };
}
