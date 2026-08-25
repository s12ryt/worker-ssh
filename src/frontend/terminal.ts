// xterm.js 終端機包裝：僅負責終端 UI 與視窗尺寸；
// 資料流由 main.ts 接線：term.onData → 引擎 shellWrite；引擎 onData → term.write
import { Terminal, type ITheme } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { createTerminalClipboardKeyHandler } from "./terminal-clipboard";

/** Liquid Glass 暗色主題（與 styles/liquid-glass.css 色板一致） */
const GLASS_THEME: ITheme = {
  background: "#0d1024",
  foreground: "#e6e9f5",
  cursor: "#8ab4ff",
  selectionBackground: "rgba(138, 180, 255, 0.30)",
  black: "#1a1d33",
  red: "#ff6b81",
  green: "#7ee8a2",
  yellow: "#ffd479",
  blue: "#8ab4ff",
  magenta: "#c39bff",
  cyan: "#79d6f2",
  white: "#e6e9f5",
};

export interface TerminalHandle {
  term: Terminal;
  fit(): void;
  setFontSize(size: number): void;
  dispose(): void;
}

export interface TerminalOptions {
  onClipboardError?(error: Error): void;
}

/** 在容器內建立終端機並自動隨容器尺寸調整欄列數 */
export function createTerminal(container: HTMLElement, options: TerminalOptions = {}): TerminalHandle {
  const term = new Terminal({
    fontFamily: '"Cascadia Code", "JetBrains Mono", Consolas, monospace',
    fontSize: 14,
    cursorBlink: true,
    theme: GLASS_THEME,
    scrollback: 5000,
  });
  const fitAddon = new FitAddon();
  term.loadAddon(fitAddon);
  term.open(container);
  fitAddon.fit();

  if (term.element) {
    term.attachCustomKeyEventHandler(createTerminalClipboardKeyHandler({
      isMac: /Mac|iPhone|iPad|iPod/.test(navigator.platform),
      getSelection: () => term.getSelection(),
      paste: (text) => term.paste(text),
      eventTarget: term.element,
      clipboard: navigator.clipboard,
      onError: options.onClipboardError ?? (() => undefined),
    }));
  }

  const observer = new ResizeObserver(() => fitAddon.fit());
  observer.observe(container);

  return {
    term,
    fit: () => fitAddon.fit(),
    setFontSize: (size) => {
      term.options.fontSize = size;
      fitAddon.fit();
    },
    dispose: () => {
      observer.disconnect();
      term.dispose();
    },
  };
}
