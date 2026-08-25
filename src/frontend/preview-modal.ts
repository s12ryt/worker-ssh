// SFTP 文字檔線上預覽 Modal（D26–D33）
// DOM 膠水層：動態建立 backdrop + dialog，動態載入 highlight.js 並按需註冊語言
// 純邏輯見 sftp-preview.ts（isPreviewable / decodePreviewText）與 highlight-language.ts
// 關閉路徑：backdrop 點擊、Esc 鍵、關閉鈕點擊三路
import { decodePreviewText } from "./sftp-preview";
import { languageOfFilename } from "./highlight-language";
import { iconElement } from "./ui-icons";

/** highlight.js core 的最小介面形狀（避免直接依賴套件型別） */
interface HighlightCore {
  highlightElement(target: HTMLElement): void;
  registerLanguage(name: string, lang: unknown): void;
}

/** 語言註冊名稱 → 動態 import 路徑（highlight.js 子模組） */
const LANG_MODULES: Record<string, () => Promise<{ default: unknown }>> = {
  javascript: () => import("highlight.js/lib/languages/javascript"),
  typescript: () => import("highlight.js/lib/languages/typescript"),
  python: () => import("highlight.js/lib/languages/python"),
  go: () => import("highlight.js/lib/languages/go"),
  bash: () => import("highlight.js/lib/languages/bash"),
  json: () => import("highlight.js/lib/languages/json"),
  yaml: () => import("highlight.js/lib/languages/yaml"),
  xml: () => import("highlight.js/lib/languages/xml"),
  markdown: () => import("highlight.js/lib/languages/markdown"),
  css: () => import("highlight.js/lib/languages/css"),
  sql: () => import("highlight.js/lib/languages/sql"),
  c: () => import("highlight.js/lib/languages/c"),
  cpp: () => import("highlight.js/lib/languages/cpp"),
  java: () => import("highlight.js/lib/languages/java"),
  rust: () => import("highlight.js/lib/languages/rust"),
  php: () => import("highlight.js/lib/languages/php"),
  ruby: () => import("highlight.js/lib/languages/ruby"),
  lua: () => import("highlight.js/lib/languages/lua"),
  diff: () => import("highlight.js/lib/languages/diff"),
  ini: () => import("highlight.js/lib/languages/ini"),
};

let hljsPromise: Promise<HighlightCore> | null = null;

/** 動態載入 highlight.js core 並按需註冊 ~20 語言（冪等；重複呼叫共用同一 Promise） */
function loadHighlighter(): Promise<HighlightCore> {
  if (hljsPromise) return hljsPromise;
  hljsPromise = (async () => {
    const mod = await import("highlight.js/lib/core");
    const hljs = mod.default as HighlightCore;
    const entries = Object.entries(LANG_MODULES);
    await Promise.all(
      entries.map(async ([name, importer]) => {
        try {
          const langMod = await importer();
          hljs.registerLanguage(name, langMod.default);
        } catch {
          // 語言模組載入失敗不阻塞其他語言；fallback highlightAuto
        }
      }),
    );
    return hljs;
  })();
  return hljsPromise;
}

export interface PreviewModalOptions {
  /** 檔名（用於標題與副檔名推斷語言） */
  filename: string;
  /** 檔案原始位元組 */
  data: Uint8Array;
  /** 下載回呼（底部下載按鈕觸發） */
  onDownload?: () => void;
  /** 複製回呼（底部複製按鈕觸發）；不傳則隱藏按鈕 */
  onCopy?: (text: string) => Promise<void> | void;
}

/**
 * 開啟預覽 Modal 並掛載至 document.body。
 * 回傳關閉函數；Modal 關閉後從 DOM 移除。
 * 若解碼後判定為二進位（U+FFFD ≥ 10%），拋錯由呼叫端提示。
 */
export async function openPreviewModal(
  opts: PreviewModalOptions,
): Promise<() => void> {
  const text = decodePreviewText(opts.data);
  if (text === null) {
    throw new Error("檔案內容包含大量二進位資料，無法以文字預覽");
  }

  const backdrop = document.createElement("div");
  backdrop.className = "preview-backdrop";

  const dialog = document.createElement("div");
  dialog.className = "preview-modal";
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");
  dialog.setAttribute("aria-label", `預覽：${opts.filename}`);

  // 標題列：檔名 + 關閉鈕
  const titlebar = document.createElement("div");
  titlebar.className = "preview-titlebar";
  const title = document.createElement("strong");
  title.className = "preview-title";
  title.textContent = opts.filename;
  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "btn btn-ghost btn-sm btn-icon";
  closeBtn.setAttribute("aria-label", "關閉預覽");
  closeBtn.title = "關閉";
  closeBtn.replaceChildren(iconElement("close"));
  titlebar.append(title, closeBtn);

  // 內容區：pre > code
  const content = document.createElement("div");
  content.className = "preview-content";
  const pre = document.createElement("pre");
  const code = document.createElement("code");
  code.className = "preview-code";
  code.textContent = text;
  pre.appendChild(code);
  content.appendChild(pre);

  // 底部按鈕列
  const footer = document.createElement("div");
  footer.className = "preview-footer";
  const actions = document.createElement("div");
  actions.className = "preview-actions";
  if (opts.onCopy) {
    const copyBtn = document.createElement("button");
    copyBtn.type = "button";
    copyBtn.className = "btn btn-ghost btn-sm";
    copyBtn.replaceChildren(iconElement("copy"), document.createTextNode("複製"));
    copyBtn.addEventListener("click", () => {
      void opts.onCopy!(text);
    });
    actions.appendChild(copyBtn);
  }
  if (opts.onDownload) {
    const dlBtn = document.createElement("button");
    dlBtn.type = "button";
    dlBtn.className = "btn btn-ghost btn-sm";
    dlBtn.replaceChildren(iconElement("arrowDown"), document.createTextNode("下載"));
    dlBtn.addEventListener("click", () => opts.onDownload!());
    actions.appendChild(dlBtn);
  }
  footer.appendChild(actions);

  dialog.append(titlebar, content, footer);
  backdrop.appendChild(dialog);
  document.body.appendChild(backdrop);

  // 關閉邏輯
  let closed = false;
  const close = (): void => {
    if (closed) return;
    closed = true;
    document.removeEventListener("keydown", onKeydown);
    backdrop.remove();
  };
  const onKeydown = (ev: KeyboardEvent): void => {
    if (ev.key === "Escape") {
      ev.preventDefault();
      close();
    }
  };
  closeBtn.addEventListener("click", close);
  backdrop.addEventListener("click", (ev) => {
    if (ev.target === backdrop) close();
  });
  document.addEventListener("keydown", onKeydown);

  // 語法高亮（非阻塞；失敗則純文字顯示）
  void (async () => {
    try {
      const hljs = await loadHighlighter();
      const lang = languageOfFilename(opts.filename);
      if (lang) {
        code.classList.add(`language-${lang}`);
      }
      hljs.highlightElement(code);
    } catch {
      // highlight.js 載入或渲染失敗：保持純文字，不阻塞預覽
    }
  })();

  return close;
}
