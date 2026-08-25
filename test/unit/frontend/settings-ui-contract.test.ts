import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import html from "../../../src/frontend/index.html?raw";

const css = readFileSync(
  resolve(process.cwd(), "src/frontend/styles/liquid-glass.css"),
  "utf8",
);

describe("設定入口與自訂選取控制項", () => {
  it("主畫面提供可存取的純 SVG 齒輪與完整原生設定 dialog", () => {
    expect(html).toMatch(/id="settings-btn"[^>]*aria-label="設定"[^>]*title="設定"/);
    expect(html).toMatch(/id="settings-btn"[\s\S]*?<svg[\s\S]*?<\/button>/);
    expect(html).toContain('<dialog id="settings-dialog"');
    for (const id of [
      "settings-theme",
      "settings-font-size",
      "settings-monitor-interval",
      "settings-reconnect-enabled",
      "settings-reconnect-attempts",
      "settings-defaults",
      "settings-cancel",
      "settings-save",
    ]) {
      expect(html).toContain(`id="${id}"`);
    }
  });

  it("目前 SSH 工作階段也能開啟同一份設定以即時預覽", () => {
    expect(html).toMatch(
      /id="session-settings-btn"[^>]*aria-label="設定"[^>]*title="設定"/,
    );
    expect(html).toMatch(/id="session-settings-btn"[\s\S]*?<svg[\s\S]*?<\/button>/);
  });

  it("設定 dialog 不隸屬任何會被隱藏的應用程式視圖", () => {
    const connectionsIndex = html.indexOf('id="view-connections"');
    const sessionIndex = html.indexOf('id="view-session"');
    const dialogIndex = html.indexOf('id="settings-dialog"');
    const bootstrapIndex = html.indexOf('id="bootstrap-overlay"');

    expect(connectionsIndex).toBeGreaterThanOrEqual(0);
    expect(sessionIndex).toBeGreaterThan(connectionsIndex);
    expect(dialogIndex).toBeGreaterThan(sessionIndex);
    expect(bootstrapIndex).toBeGreaterThan(dialogIndex);
    expect(html).toMatch(/<\/section>\s*<dialog id="settings-dialog"/);
  });

  it("主機卡片與全選保留 checkbox 語意並套用自訂深色外觀", () => {
    expect(html).toMatch(/id="selection-all"[^>]*type="checkbox"[^>]*class="conn-select"/);
    expect(css).toMatch(/\.conn-select\s*\{[^}]*appearance:\s*none/s);
    expect(css).toContain(".conn-select:checked::after");
    expect(css).toContain('html[data-theme="high-contrast"]');
  });

  it("設定 dialog 在低高度視窗內限制高度並允許內容捲動", () => {
    expect(css).toMatch(
      /\.settings-dialog\s*\{[^}]*max-height:\s*calc\(100dvh\s*-\s*32px\)[^}]*overflow-y:\s*auto/s,
    );
  });

  it("主畫面齒輪固定尺寸並雙軸置中，不被手機工具列拉伸", () => {
    expect(css).toMatch(
      /#settings-btn\.settings-button\s*\{[^}]*display:\s*flex[^}]*align-items:\s*center[^}]*justify-content:\s*center[^}]*width:\s*40px[^}]*height:\s*40px[^}]*flex:\s*0\s+0\s+40px/s,
    );
    expect(css).toMatch(
      /#settings-btn\.settings-button\s+\.icon\s*\{[^}]*width:\s*20px[^}]*height:\s*20px/s,
    );
    expect(css).toMatch(
      /@media\s*\(max-width:\s*700px\)[\s\S]*?#settings-btn\.settings-button\s*\{[^}]*width:\s*40px[^}]*justify-self:\s*center/s,
    );
  });

  it("終端狀態列在實體記憶體後提供獨立虛擬記憶體欄位", () => {
    const memIndex = html.indexOf('id="m-mem-used"');
    const swapUsedIndex = html.indexOf('id="m-swap-used"');
    const swapPercentIndex = html.indexOf('id="m-swap-percent"');
    const diskIndex = html.indexOf('id="m-disk-used"');

    expect(memIndex).toBeGreaterThanOrEqual(0);
    expect(swapUsedIndex).toBeGreaterThan(memIndex);
    expect(swapPercentIndex).toBeGreaterThan(swapUsedIndex);
    expect(diskIndex).toBeGreaterThan(swapPercentIndex);
    expect(html.slice(memIndex, diskIndex)).toContain("虛擬記憶體");
  });
});

describe("選取 bar 顯示規則", () => {
  it("全選控制位於主機區塊標題列，不住在選取 bar 內", () => {
    const barStart = html.indexOf('id="selection-bar"');
    const barEnd = html.indexOf("</section>", barStart);
    const headingIndex = html.indexOf('id="connection-section-count"');
    const selectAllIndex = html.indexOf('id="selection-all"');

    expect(barStart).toBeGreaterThanOrEqual(0);
    expect(barEnd).toBeGreaterThan(barStart);
    expect(selectAllIndex).toBeGreaterThan(headingIndex);
    // 全選控制不得落在 selection-bar 區段內。
    expect(selectAllIndex).toBeGreaterThan(barEnd);
  });

  it("選取 bar 只含計數與動作按鈕，作為選取後的批次操作列", () => {
    const barStart = html.indexOf('id="selection-bar"');
    const barEnd = html.indexOf("</section>", barStart);
    const bar = html.slice(barStart, barEnd);

    expect(bar).toContain('id="selection-count"');
    expect(bar).toContain('id="selection-move"');
    expect(bar).toContain('id="selection-clear"');
    expect(bar).not.toContain('id="selection-all"');
    expect(bar).toContain("hidden");
  });
});
