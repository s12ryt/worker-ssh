// SFTP 文字檔線上編輯 Modal（D34–D46）
// DOM 膠水層：動態建立 backdrop + dialog，動態載入 CodeMirror 6 並依副檔名註冊語言
// 純邏輯見 filename-validate.ts（validateFilename）與 highlight-language.ts（languageOfFilename）
// 關閉路徑：backdrop 點擊、Esc 鍵、關閉鈕點擊三路；未儲存提示 confirm
import { iconElement } from "./ui-icons";
import { languageOfFilename } from "./highlight-language";
import { validateFilename } from "./filename-validate";
import { renderKindOf, type RenderKind } from "./render-kind";
import { openConfirmModal } from "./confirm-modal";
type MarkdownIt = InstanceType<typeof import("markdown-it").default>;

/** CodeMirror 套件束型別 */
type CmBundle = {
  EditorView: typeof import("@codemirror/view").EditorView;
  EditorState: typeof import("@codemirror/state").EditorState;
  history: typeof import("@codemirror/commands").history;
  lineNumbers: typeof import("@codemirror/view").lineNumbers;
  highlightActiveLine: typeof import("@codemirror/view").highlightActiveLine;
  defaultKeymap: typeof import("@codemirror/commands").defaultKeymap;
  historyKeymap: typeof import("@codemirror/commands").historyKeymap;
  indentWithTab: typeof import("@codemirror/commands").indentWithTab;
  searchKeymap: typeof import("@codemirror/search").searchKeymap;
  indentUnit: typeof import("@codemirror/language").indentUnit;
  keymap: typeof import("@codemirror/view").keymap;
  language: typeof import("@codemirror/language").language;
  /** Bug 4 修復：語法高亮需要 syntaxHighlighting + 自訂 HighlightStyle（用 .tok-* class） */
  syntaxHighlighting: typeof import("@codemirror/language").syntaxHighlighting;
  HighlightStyle: typeof import("@codemirror/language").HighlightStyle;
  tags: typeof import("@lezer/highlight").tags;
  Compartment: typeof import("@codemirror/state").Compartment;
};

/**
 * Bug 4 修復：自訂 HighlightStyle，用 .tok-* 語意化 class（非 defaultHighlightStyle 的 opaque ͼN class）。
 * CSS 中 .tok-keyword/.tok-string 等規則才能匹配並套用色彩。
 */
function buildCustomHighlightStyle(cm: CmBundle): import("@codemirror/language").HighlightStyle {
  const t = cm.tags;
  return cm.HighlightStyle.define([
    { tag: t.keyword, class: "tok-keyword" },
    { tag: t.controlKeyword, class: "tok-keyword" },
    { tag: t.operatorKeyword, class: "tok-keyword" },
    { tag: t.modifier, class: "tok-keyword" },
    { tag: t.string, class: "tok-string" },
    { tag: t.special(t.string), class: "tok-string2" },
    { tag: t.number, class: "tok-number" },
    { tag: t.integer, class: "tok-number" },
    { tag: t.bool, class: "tok-bool" },
    { tag: t.atom, class: "tok-atom" },
    { tag: t.null, class: "tok-atom" },
    { tag: t.self, class: "tok-atom" },
    { tag: t.comment, class: "tok-comment" },
    { tag: t.variableName, class: "tok-variableName" },
    { tag: t.local(t.variableName), class: "tok-variableName" },
    { tag: t.function(t.variableName), class: "tok-function" },
    { tag: t.function(t.propertyName), class: "tok-function" },
    { tag: t.typeName, class: "tok-typeName" },
    { tag: t.namespace, class: "tok-namespace" },
    { tag: t.propertyName, class: "tok-propertyName" },
    { tag: t.punctuation, class: "tok-punctuation" },
    { tag: t.separator, class: "tok-punctuation" },
    { tag: t.operator, class: "tok-operator" },
    { tag: t.derefOperator, class: "tok-operator" },
    { tag: t.arithmeticOperator, class: "tok-operator" },
    { tag: t.logicOperator, class: "tok-operator" },
    { tag: t.bitwiseOperator, class: "tok-operator" },
    { tag: t.compareOperator, class: "tok-operator" },
    { tag: t.updateOperator, class: "tok-operator" },
    { tag: t.definitionOperator, class: "tok-operator" },
    { tag: t.typeOperator, class: "tok-operator" },
    { tag: t.meta, class: "tok-meta" },
    { tag: t.tagName, class: "tok-tagName" },
    { tag: t.attributeName, class: "tok-attributeName" },
    { tag: t.attributeValue, class: "tok-attributeValue" },
    { tag: t.heading, class: "tok-heading" },
    { tag: t.heading1, class: "tok-heading" },
    { tag: t.heading2, class: "tok-heading" },
    { tag: t.heading3, class: "tok-heading" },
    { tag: t.heading4, class: "tok-heading" },
    { tag: t.heading5, class: "tok-heading" },
    { tag: t.heading6, class: "tok-heading" },
    { tag: t.link, class: "tok-link" },
    { tag: t.url, class: "tok-url" },
    { tag: t.invalid, class: "tok-invalid" },
    { tag: t.processingInstruction, class: "tok-meta" },
    { tag: t.contentSeparator, class: "tok-punctuation" },
    { tag: t.labelName, class: "tok-propertyName" },
    { tag: t.inserted, class: "tok-string" },
    { tag: t.deleted, class: "tok-invalid" },
  ]);
}

let cmPromise: Promise<CmBundle> | null = null;

/** 動態載入 CodeMirror 6 核心套件（冪等；重複呼叫共用同一 Promise） */
function loadCodeMirror(): Promise<CmBundle> {
  if (cmPromise) return cmPromise;
  cmPromise = (async () => {
    const [viewMod, stateMod, commandsMod, searchMod, languageMod, lezerMod] = await Promise.all([
      import("@codemirror/view"),
      import("@codemirror/state"),
      import("@codemirror/commands"),
      import("@codemirror/search"),
      import("@codemirror/language"),
      import("@lezer/highlight"),
    ]);
    return {
      EditorView: viewMod.EditorView,
      EditorState: stateMod.EditorState,
      history: commandsMod.history,
      lineNumbers: viewMod.lineNumbers,
      highlightActiveLine: viewMod.highlightActiveLine,
      defaultKeymap: commandsMod.defaultKeymap,
      historyKeymap: commandsMod.historyKeymap,
      indentWithTab: commandsMod.indentWithTab,
      searchKeymap: searchMod.searchKeymap,
      indentUnit: languageMod.indentUnit,
      keymap: viewMod.keymap,
      language: languageMod.language,
      syntaxHighlighting: languageMod.syntaxHighlighting,
      HighlightStyle: languageMod.HighlightStyle,
      tags: lezerMod.tags,
      Compartment: stateMod.Compartment,
    };
  })();
  return cmPromise;
}

/** 副檔名→語言模組動態載入器 */
const LANG_LOADERS: Record<string, () => Promise<unknown>> = {
  javascript: () => import("@codemirror/lang-javascript"),
  typescript: () => import("@codemirror/lang-javascript"),
  python: () => import("@codemirror/lang-python"),
  go: () => import("@codemirror/lang-go"),
  json: () => import("@codemirror/lang-json"),
  yaml: () => import("@codemirror/lang-yaml"),
  xml: () => import("@codemirror/lang-xml"),
  markdown: () => import("@codemirror/lang-markdown"),
  css: () => import("@codemirror/lang-css"),
  sql: () => import("@codemirror/lang-sql"),
  cpp: () => import("@codemirror/lang-cpp"),
  c: () => import("@codemirror/lang-cpp"),
  java: () => import("@codemirror/lang-java"),
  rust: () => import("@codemirror/lang-rust"),
  php: () => import("@codemirror/lang-php"),
};

/**
 * 語言名稱→CodeMirror 模組匯出名稱映射。
 * typescript 由 lang-javascript 以 javascript({ typescript: true }) 支援；
 * c 由 lang-cpp 以 cpp() 支援（C/C++ 語法高度重疊）。
 */
const LANG_EXPORT_NAME: Record<string, string> = {
  typescript: "javascript",
  c: "cpp",
};

/** 純函數：依語言名稱解析對應的 CodeMirror 模組匯出名稱 */
export function resolveLangExportName(lang: string): string {
  return LANG_EXPORT_NAME[lang] ?? lang;
}

/** 依檔名預載語言擴充；回傳 null 代表純文字（無高亮） */
async function preloadLanguage(filename: string): Promise<unknown | null> {
  const lang = languageOfFilename(filename);
  if (!lang) return null;
  const loader = LANG_LOADERS[lang];
  if (!loader) return null;
  try {
    const mod = (await loader()) as Record<string, unknown> & { default?: unknown };
    const exportName = resolveLangExportName(lang);
    const factory = mod[exportName as keyof typeof mod];
    if (typeof factory !== "function") return null;
    if (lang === "javascript" || lang === "typescript") {
      const isTs = lang === "typescript" || filename.toLowerCase().endsWith(".tsx");
      return (factory as (opts?: { typescript?: boolean }) => unknown)({ typescript: isTs });
    }
    return (factory as () => unknown)();
  } catch {
    return null;
  }
}

export interface EditModalOptions {
  filename: string;
  initialText: string;
  onSave: (text: string) => Promise<void> | void;
  onSaveAs: (filename: string, text: string) => Promise<void> | void;
  onDownload?: () => void;
}

/**
 * 開啟編輯 Modal 並掛載至 document.body。
 * 回傳關閉函數；Modal 關閉後從 DOM 移除並銷毀 CodeMirror。
 * 未儲存離開時以瀏覽器 confirm 提示（D38）。
 */
export async function openEditModal(opts: EditModalOptions): Promise<() => void> {
  const cm = await loadCodeMirror();
  let isReadonly = false;
  let originalText = opts.initialText;

  const backdrop = document.createElement("div");
  backdrop.className = "edit-backdrop";

  const dialog = document.createElement("div");
  dialog.className = "edit-modal";
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");
  dialog.setAttribute("aria-label", `編輯：${opts.filename}`);

  // 標題列：檔名+狀態徽章 / 唯讀切換 / 另存 / 存檔 / [下載] / 關閉
  const titlebar = document.createElement("div");
  titlebar.className = "edit-titlebar";
  const titleWrap = document.createElement("div");
  titleWrap.className = "edit-title-wrap";
  const title = document.createElement("strong");
  title.className = "edit-title";
  title.textContent = opts.filename;
  const statusBadge = document.createElement("span");
  statusBadge.className = "edit-status-badge";
  statusBadge.setAttribute("data-state", "clean");
  statusBadge.textContent = "";
  titleWrap.append(title, statusBadge);

  const toggleReadonlyBtn = document.createElement("button");
  toggleReadonlyBtn.type = "button";
  toggleReadonlyBtn.className = "btn btn-ghost btn-sm";
  toggleReadonlyBtn.title = "切換唯讀/編輯";
  toggleReadonlyBtn.textContent = "編輯中";

  // D6/D15：渲染預覽按鈕（純文字，在「原始碼」與「渲染預覽」之間切換）
  const renderKind = renderKindOf(opts.filename);
  const togglePreviewBtn = document.createElement("button");
  togglePreviewBtn.type = "button";
  togglePreviewBtn.className = "btn btn-ghost btn-sm";
  togglePreviewBtn.title = "切換原始碼/瀏覽器渲染預覽";
  togglePreviewBtn.textContent = "原始碼";
  // D2：只有 markdown/html/svg/csv 才顯示渲染預覽按鈕
  if (renderKind === "none") togglePreviewBtn.style.display = "none";

  const saveAsBtn = document.createElement("button");
  saveAsBtn.type = "button";
  saveAsBtn.className = "btn btn-ghost btn-sm";
  saveAsBtn.setAttribute("aria-label", "另存新檔");
  saveAsBtn.title = "另存新檔（Ctrl+Shift+S）";
  saveAsBtn.replaceChildren(iconElement("copy"), document.createTextNode("另存"));

  const saveBtn = document.createElement("button");
  saveBtn.type = "button";
  saveBtn.className = "btn btn-primary btn-sm";
  saveBtn.setAttribute("aria-label", "儲存變更");
  saveBtn.title = "儲存變更（Ctrl+S）";
  saveBtn.replaceChildren(iconElement("arrowDown"), document.createTextNode("存檔"));

  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "btn btn-ghost btn-sm btn-icon";
  closeBtn.setAttribute("aria-label", "關閉編輯器");
  closeBtn.title = "關閉";
  closeBtn.replaceChildren(iconElement("close"));

  titlebar.append(titleWrap, toggleReadonlyBtn, togglePreviewBtn, saveAsBtn, saveBtn);
  if (opts.onDownload) {
    const dlBtn = document.createElement("button");
    dlBtn.type = "button";
    dlBtn.className = "btn btn-ghost btn-sm btn-icon";
    dlBtn.setAttribute("aria-label", "下載原檔");
    dlBtn.title = "下載原檔";
    dlBtn.replaceChildren(iconElement("arrowDown"));
    dlBtn.addEventListener("click", () => opts.onDownload!());
    titlebar.appendChild(dlBtn);
  }
  titlebar.appendChild(closeBtn);

  // 內容區：CodeMirror 掛載點
  const content = document.createElement("div");
  content.className = "edit-content";

  // D1/D16：渲染預覽區（獨立滾動，預設隱藏）
  const previewDiv = document.createElement("div");
  previewDiv.className = "edit-preview";
  previewDiv.style.display = "none";

  // 預載語言擴充
  const langExt = await preloadLanguage(opts.filename).catch(() => null);
  // LanguageSupport 本身就是 Extension（CodeMirror 6 標準用法）；
  // 不能用 language.of()（那是 StateEffect 用於 dispatch，非 Extension），
  // 也不能將 LanguageSupport cast 為 Language（會導致 startParse 呼叫在錯誤物件上）
  const languageExt = langExt
    ? [langExt as import("@codemirror/state").Extension]
    : [];

  const languageCompartment = new cm.Compartment();
  const readOnlyCompartment = new cm.Compartment();

  const state = cm.EditorState.create({
    doc: opts.initialText,
    extensions: [
      cm.lineNumbers(),
      cm.history(),
      cm.highlightActiveLine(),
      cm.indentUnit.of("  "),
      cm.EditorView.lineWrapping,
      languageCompartment.of(languageExt),
      // Bug 4 修復：自訂 HighlightStyle（用 .tok-* 語意化 class，非 opaque ͼN）
      cm.syntaxHighlighting(buildCustomHighlightStyle(cm)),
      readOnlyCompartment.of(cm.EditorState.readOnly.of(false)),
      cm.keymap.of([
        ...cm.defaultKeymap,
        ...cm.historyKeymap,
        cm.indentWithTab,
        ...cm.searchKeymap,
        {
          key: "Ctrl-s",
          run: () => {
            void doSave();
            return true;
          },
        },
        {
          key: "Ctrl-Shift-s",
          run: () => {
            void doSaveAs();
            return true;
          },
        },
      ]),
    ],
  });

  const editor = new cm.EditorView({
    state,
    parent: content,
  });
  editor.focus();

  function refreshBadge(): void {
    const dirty = editor.state.doc.toString() !== originalText;
    statusBadge.setAttribute("data-state", dirty ? "dirty" : "clean");
    statusBadge.textContent = dirty ? "未儲存" : "";
  }
  refreshBadge();

  function setReadonly(value: boolean): void {
    isReadonly = value;
    editor.dispatch({
      effects: readOnlyCompartment.reconfigure(cm.EditorState.readOnly.of(value)),
    });
    toggleReadonlyBtn.textContent = value ? "唯讀中" : "編輯中";
    if (!value) editor.focus();
  }

  function showStatus(message: string, state: "saved" | "error"): void {
    statusBadge.setAttribute("data-state", state);
    statusBadge.textContent = message;
    setTimeout(() => refreshBadge(), 2000);
  }

  // D8/D12：切換即渲染（含未儲存變更），不提示
  let isPreviewMode = false;
  function togglePreview(): void {
    if (renderKind === "none") return;
    isPreviewMode = !isPreviewMode;
    if (isPreviewMode) {
      content.style.display = "none";
      previewDiv.style.display = "";
      void renderPreview();
      togglePreviewBtn.textContent = "預覽";
    } else {
      previewDiv.style.display = "none";
      content.style.display = "";
      editor.focus();
      togglePreviewBtn.textContent = "原始碼";
    }
  }

  // D3/D4/D9/D11：渲染函數（依 renderKind 分派）
  async function renderPreview(): Promise<void> {
    const text = editor.state.doc.toString();
    if (renderKind === "markdown") await renderMarkdown(text);
    else if (renderKind === "html") renderHtml(text);
    else if (renderKind === "svg") renderSvg(text);
    else if (renderKind === "csv") await renderCsv(text);
  }

  // D3/D10/D14：markdown-it + 6 外掛 + DOMPurify + highlight.js highlight option
  let mdRenderer: MarkdownIt | null = null;
  async function renderMarkdown(text: string): Promise<void> {
    if (!mdRenderer) {
      // Bug 5 修復：dompurify 不在 Promise.all 中（不是 markdown-it 外掛，會被 .use() 誤用）
      const [markdownItMod, ...plugins] = (await Promise.all([
        import("markdown-it"),
        import("markdown-it-anchor") as Promise<any>,
        import("markdown-it-footnote") as Promise<any>,
        import("markdown-it-task-lists") as Promise<any>,
        import("markdown-it-emoji") as Promise<any>,
        import("markdown-it-sub") as Promise<any>,
        import("markdown-it-sup") as Promise<any>,
        import("markdown-it-deflist") as Promise<any>,
      ]) as [typeof import("markdown-it"), ...any[]]);
      const MarkdownIt = markdownItMod.default;
      mdRenderer = new MarkdownIt({
        html: true,
        linkify: true,
        typographer: true,
        highlight: (str: string, lang: string): string => {
          // D10：整合 highlight.js
          try {
            const hljs = (window as any).hljs ?? null;
            if (hljs && lang && hljs.getLanguage(lang)) {
              return `<pre class="hljs"><code>${hljs.highlight(str, { language: lang }).value}</code></pre>`;
            }
            return `<pre class="hljs"><code>${mdRenderer!.utils.escapeHtml(str)}</code></pre>`;
          } catch {
            return "";
          }
        },
      });
      // Bug 5 修復：外掛 ESM/CJS interop，mod.default 可能是物件或 undefined
      // 用 typeof 檢查確保 use() 收到的是函數
      for (const mod of plugins) {
        if (!mod) continue;
        const candidate = mod.default?.default ?? mod.default ?? mod;
        if (typeof candidate === "function") mdRenderer.use(candidate);
      }
      (window as any).__mdRenderer = mdRenderer;
      // Bug 5 修復：dompurify 需用 .default 取得實例（不是整個模組物件）
      const dompurifyMod = (await import("dompurify")) as any;
      const dompurifyCtor = dompurifyMod?.default?.default ?? dompurifyMod?.default ?? dompurifyMod;
      (window as any).__dompurify = typeof dompurifyCtor === "function" ? dompurifyCtor() : dompurifyCtor;
    }
    const dompurify: { sanitize: (s: string) => string } = ((window as any).__dompurify ?? (await import("dompurify"))) as any;
    const dirty = mdRenderer.render(text);
    previewDiv.innerHTML = dompurify.sanitize(dirty);
  }

  // D4：HTML 用 sandbox iframe（完全隔離 JS 執行與 DOM 存取）
  function renderHtml(text: string): void {
    previewDiv.replaceChildren();
    const iframe = document.createElement("iframe");
    iframe.sandbox = "allow-same-origin";
    iframe.style.width = "100%";
    iframe.style.height = "100%";
    iframe.style.border = "none";
    iframe.srcdoc = text;
    previewDiv.appendChild(iframe);
  }

  // D11：SVG 直接 innerHTML + DOMPurify
  async function renderSvg(text: string): Promise<void> {
    const dompurify = (await import("dompurify")).default;
    previewDiv.innerHTML = dompurify.sanitize(text, { USE_PROFILES: { svg: true } });
  }

  // D9：CSV 用 PapaParse + table
  async function renderCsv(text: string): Promise<void> {
    const Papa = (await import("papaparse") as any).default;
    const result = Papa.parse(text, { skipEmptyLines: true });
    const table = document.createElement("table");
    table.className = "csv-table";
    for (let i = 0; i < result.data.length; i++) {
      const row = result.data[i] as string[];
      const tr = document.createElement("tr");
      if (i === 0) tr.className = "csv-header";
      for (const cell of row) {
        const td = document.createElement(i === 0 ? "th" : "td");
        td.textContent = String(cell ?? "");
        tr.appendChild(td);
      }
      table.appendChild(tr);
    }
    previewDiv.replaceChildren(table);
  }

  async function doSave(): Promise<void> {
    if (isReadonly) return;
    const text = editor.state.doc.toString();
    if (text === originalText) {
      showStatus("無變更", "saved");
      return;
    }
    // D42：覆蓋前二次確認（改為 Liquid Glass confirm-modal）
    if (!await openConfirmModal({
      message: `確定覆蓋原檔「${opts.filename}」？`,
      title: "覆蓋原檔",
      danger: true,
      confirmText: "覆蓋",
    })) return;
    saveBtn.disabled = true;
    try {
      await opts.onSave(text);
      originalText = text;
      showStatus("已儲存", "saved");
      refreshBadge();
    } catch (err) {
      showStatus("儲存失敗", "error");
      console.error("edit-modal save failed", err);
    } finally {
      saveBtn.disabled = false;
    }
  }

  async function doSaveAs(): Promise<void> {
    const dot = opts.filename.lastIndexOf(".");
    const defaultName =
      dot > 0
        ? `${opts.filename.slice(0, dot)}.copy${opts.filename.slice(dot)}`
        : `${opts.filename}.copy`;
    const newName = window.prompt("另存新檔名：", defaultName);
    if (newName === null) return;
    if (!validateFilename(newName)) {
      window.alert("檔名不合法：不能含 / \\ : * ? \" < > |，不得為空或 . ..，長度 ≤ 255");
      return;
    }
    const text = editor.state.doc.toString();
    saveAsBtn.disabled = true;
    try {
      await opts.onSaveAs(newName, text);
      originalText = text;
      showStatus(`已另存為 ${newName}`, "saved");
      refreshBadge();
    } catch (err) {
      showStatus("另存失敗", "error");
      console.error("edit-modal saveAs failed", err);
    } finally {
      saveAsBtn.disabled = false;
    }
  }

  toggleReadonlyBtn.addEventListener("click", () => setReadonly(!isReadonly));
  togglePreviewBtn.addEventListener("click", () => togglePreview());
  saveBtn.addEventListener("click", () => void doSave());
  saveAsBtn.addEventListener("click", () => void doSaveAs());

  let closed = false;
  // confirm-modal 開啟期間防重入（fire-and-forget close 內部並行）
  let confirming = false;
  const finishClose = (): void => {
    if (closed) return;
    closed = true;
    document.removeEventListener("keydown", onKeydown);
    editor.destroy();
    backdrop.remove();
  };
  // close 保持 sync void：事件 handler 友善，回傳型別 Promise<() => void> 不變
  // 有未儲存變更時 fire-and-forget 開 confirm-modal；期間 confirming=true 阻擋後續 close()
  // D8：confirm-modal 以 capture 階段攔截 Esc，本模組 onKeydown 在 confirming 期間收不到
  const close = (): void => {
    if (closed || confirming) return;
    const dirty = editor.state.doc.toString() !== originalText;
    if (!dirty) {
      finishClose();
      return;
    }
    confirming = true;
    void openConfirmModal({
      message: "有未儲存的變更，確定要關閉嗎？",
      title: "未儲存離開",
    }).then((ok) => {
      confirming = false;
      if (ok) finishClose();
    });
  };
  const onKeydown = (ev: KeyboardEvent): void => {
    if (ev.key === "Escape") {
      ev.preventDefault();
      close();
    } else if ((ev.ctrlKey || ev.metaKey) && (ev.key === "s" || ev.key === "S")) {
      ev.preventDefault();
      if (ev.shiftKey) void doSaveAs();
      else void doSave();
    }
  };
  closeBtn.addEventListener("click", close);
  backdrop.addEventListener("click", (ev) => {
    if (ev.target === backdrop) close();
  });
  document.addEventListener("keydown", onKeydown);

  dialog.append(titlebar, content, previewDiv);
  backdrop.appendChild(dialog);
  document.body.appendChild(backdrop);

  return close;
}
