import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const stylesheet = readFileSync(
  resolve(process.cwd(), "src/frontend/styles/liquid-glass.css"),
  "utf8",
);

function ruleBody(selector: string): string {
  const selectorStart = stylesheet.indexOf(selector);
  if (selectorStart < 0) return "";
  const bodyStart = stylesheet.indexOf("{", selectorStart);
  const bodyEnd = stylesheet.indexOf("}", bodyStart);
  return stylesheet.slice(bodyStart + 1, bodyEnd);
}

describe("工作階段 viewport 版面", () => {
  it("以 flex 填滿動態 viewport，不用硬編碼 topbar 高度", () => {
    const sessionView = ruleBody("#view-session:not(.hidden)");
    expect(sessionView).toContain("height: 100dvh");
    expect(sessionView).toContain("display: flex");
    expect(sessionView).toContain("flex-direction: column");
    expect(sessionView).toContain("overflow: hidden");

    const sessionBody = ruleBody(".session-body");
    expect(sessionBody).toContain("flex: 1");
    expect(sessionBody).toContain("min-height: 0");

    const activePanel = ruleBody(".tab-panel.active");
    expect(activePanel).toContain("height: 100%");
    expect(stylesheet).not.toContain("calc(100vh - 110px)");
    expect(stylesheet).not.toContain("calc(100vh - 160px)");
  });
});
