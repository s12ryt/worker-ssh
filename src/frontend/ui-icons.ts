// UI 圖示：Material Icons 風格實心路徑（Apache 2.0），fill=currentColor
// 依 D15–D17：全站渲染輸出零表情符號／符號字元，一律使用本模組的 SVG
// 純資料部分（UI_ICON_PATHS）由 ui-icons.test.ts 驗證；iconElement 為 DOM 膠水

/** 圖示名稱 → SVG path d 屬性（24x24 viewBox） */
export const UI_ICON_PATHS = {
  /** 資料夾 */
  folder:
    "M10 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z",
  /** 檔案 */
  file: "M6 2c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6H6zm7 7V3.5L18.5 9H13z",
  /** 上傳 */
  upload: "M9 16h6v-6h4l-7-7-7 7h4v6zm-4 2h14v2H5v-2z",
  /** 新增資料夾 */
  folderPlus:
    "M20 6h-8l-2-2H4c-1.11 0-2 .89-2 2v12c0 1.11.89 2 2 2h16c1.11 0 2-.89 2-2V8c0-1.11-.89-2-2-2zm-2 8h-4v4h-2v-4H8v-2h4V8h2v4h4v2z",
  /** 重新整理 */
  refresh:
    "M17.65 6.35A7.958 7.958 0 0012 4c-4.42 0-7.99 3.58-8 8s3.57 8 8 8c3.73 0 6.84-2.55 7.73-6h-2.08A5.99 5.99 0 0112 18c-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z",
  /** 返回（左箭頭） */
  arrowLeft: "M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z",
  /** 下行（下箭頭） */
  arrowDown: "M20 12l-1.41-1.41L13 16.17V4h-2v12.17l-5.58-5.59L4 12l8 8 8-8z",
  /** 上行（上箭頭） */
  arrowUp: "M4 12l1.41 1.41L11 7.83V20h2V7.83l5.58 5.59L20 12l-8-8-8 8z",
  /** 預覽（眼睛） */
  eye: "M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z",
  /** 關閉（X） */
  close: "M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z",
  /** 複製 */
  copy: "M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z",
  /** 編輯（鉛筆） */
  pencil:
    "M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34a.9959.9959 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z",
} as const;

export type UiIconName = keyof typeof UI_ICON_PATHS;

export const UI_ICON_NAMES: readonly UiIconName[] = Object.keys(
  UI_ICON_PATHS,
) as UiIconName[];

const SVG_NS = "http://www.w3.org/2000/svg";

/** 建立 inline SVG 圖示元素（aria-hidden；語意文字由呼叫端以 aria-label 提供） */
export function iconElement(name: UiIconName): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "currentColor");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  svg.classList.add("icon");
  const path = document.createElementNS(SVG_NS, "path");
  path.setAttribute("d", UI_ICON_PATHS[name]);
  svg.appendChild(path);
  return svg;
}
