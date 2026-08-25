// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { activateSessionTab } from "@/frontend/session-tabs";

describe("activateSessionTab", () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <button class="tab active" data-tab="terminal"></button>
      <button class="tab" data-tab="sftp"></button>
      <div id="panel-terminal" class="tab-panel active"></div>
      <div id="panel-sftp" class="tab-panel hidden"></div>
    `;
  });

  it("只切換實際存在的終端機與 SFTP 面板", () => {
    expect(() => activateSessionTab("sftp", document)).not.toThrow();

    expect(document.querySelector('[data-tab="terminal"]')?.classList.contains("active")).toBe(false);
    expect(document.querySelector('[data-tab="sftp"]')?.classList.contains("active")).toBe(true);
    expect(document.querySelector("#panel-terminal")?.classList.contains("hidden")).toBe(true);
    expect(document.querySelector("#panel-terminal")?.classList.contains("active")).toBe(false);
    expect(document.querySelector("#panel-sftp")?.classList.contains("hidden")).toBe(false);
    expect(document.querySelector("#panel-sftp")?.classList.contains("active")).toBe(true);
  });
});
