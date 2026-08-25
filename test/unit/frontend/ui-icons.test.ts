import { describe, expect, it } from "vitest";
import { UI_ICON_PATHS, UI_ICON_NAMES } from "@/frontend/ui-icons";

// 渲染輸出禁止表情符號／符號字元（D15–D17）：路徑資料本身也不得夾帶
const SYMBOL_RE = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{2190}-\u{21FF}]/u;

describe("UI_ICON_PATHS", () => {
  it("涵蓋全部十二個必要圖示名稱", () => {
    expect([...UI_ICON_NAMES].sort()).toEqual(
      [
        "arrowDown",
        "arrowLeft",
        "arrowUp",
        "close",
        "copy",
        "eye",
        "file",
        "folder",
        "folderPlus",
        "pencil",
        "refresh",
        "upload",
      ].sort(),
    );
  });

  it("每個路徑皆為非空且以指令字母開頭的 SVG path 資料", () => {
    for (const [name, d] of Object.entries(UI_ICON_PATHS)) {
      expect(d.length, `圖示 ${name} 路徑不應為空`).toBeGreaterThan(10);
      expect(d[0], `圖示 ${name} 路徑應以指令開頭`).toMatch(/^[Mm]$/);
    }
  });

  it("路徑資料不含任何表情符號或箭頭字元", () => {
    for (const [name, d] of Object.entries(UI_ICON_PATHS)) {
      expect(d, `圖示 ${name}`).not.toMatch(SYMBOL_RE);
    }
  });
  // 註：不做座標範圍驗證——SVG 弧線旗標緊湊記法（如 0112）無法以 regex 可靠
  // 切分數值，路徑來源為 Material Icons 官方資料，正確性由視覺呈現把關
});
