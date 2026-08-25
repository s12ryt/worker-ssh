import { describe, expect, it, vi } from "vitest";
import {
  APP_SETTINGS_DEFAULTS,
  type AppSettings,
  type AppSettingsInput,
} from "../../../src/shared/types";
import { SettingsDraftController } from "../../../src/frontend/settings-controller";

const STORED: AppSettings = {
  theme: "high-contrast",
  terminalFontSize: 16,
  monitorIntervalSeconds: 10,
  autoReconnectEnabled: true,
  autoReconnectAttempts: 4,
  updatedAt: 100,
};

describe("SettingsDraftController", () => {
  it("每次修改與恢復預設都立即預覽，取消完整還原且不寫入", async () => {
    const preview = vi.fn();
    const save = vi.fn<(value: AppSettingsInput) => Promise<AppSettings>>();
    const controller = new SettingsDraftController(STORED, { preview, save });

    controller.update({ terminalFontSize: 20 });
    expect(controller.value.terminalFontSize).toBe(20);
    expect(preview).toHaveBeenLastCalledWith(expect.objectContaining({ terminalFontSize: 20 }));

    controller.restoreDefaults();
    expect(controller.value).toMatchObject(APP_SETTINGS_DEFAULTS);
    expect(preview).toHaveBeenLastCalledWith(APP_SETTINGS_DEFAULTS);

    controller.cancel();
    expect(controller.value).toEqual(STORED);
    expect(preview).toHaveBeenLastCalledWith(STORED);
    expect(save).not.toHaveBeenCalled();
  });

  it("儲存只送可寫欄位並將伺服器結果設為新的還原基準", async () => {
    const saved: AppSettings = { ...STORED, terminalFontSize: 18, updatedAt: 200 };
    const preview = vi.fn();
    const save = vi.fn(async () => saved);
    const controller = new SettingsDraftController(STORED, { preview, save });

    controller.update({ terminalFontSize: 18 });
    await expect(controller.save()).resolves.toEqual(saved);
    expect(save).toHaveBeenCalledWith({
      theme: "high-contrast",
      terminalFontSize: 18,
      monitorIntervalSeconds: 10,
      autoReconnectEnabled: true,
      autoReconnectAttempts: 4,
    });

    controller.update({ terminalFontSize: 12 });
    controller.cancel();
    expect(controller.value).toEqual(saved);
  });
});
