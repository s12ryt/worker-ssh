import { describe, expect, it, vi } from "vitest";
import type { AppSettings } from "../../../src/shared/types";
import { applyRuntimeSettings } from "../../../src/frontend/settings-runtime";

const SETTINGS: AppSettings = {
  theme: "high-contrast",
  terminalFontSize: 18,
  monitorIntervalSeconds: 10,
  autoReconnectEnabled: false,
  autoReconnectAttempts: 5,
  updatedAt: 1,
};

describe("applyRuntimeSettings", () => {
  it("同步套用主題、終端字級、監控頻率與下一次斷線的重連策略", () => {
    const root = { dataset: {} } as Pick<HTMLElement, "dataset">;
    const terminal = { setFontSize: vi.fn() };
    const poller = { setIntervalMs: vi.fn() };
    const client = { setReconnectPolicy: vi.fn() };

    applyRuntimeSettings(SETTINGS, { root, terminal, poller, client });

    expect(root.dataset.theme).toBe("high-contrast");
    expect(terminal.setFontSize).toHaveBeenCalledWith(18);
    expect(poller.setIntervalMs).toHaveBeenCalledWith(10_000);
    expect(client.setReconnectPolicy).toHaveBeenCalledWith(false, 5);
  });
});
