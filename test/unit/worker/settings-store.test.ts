import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:test";
import {
  APP_SETTINGS_DEFAULTS,
  type AppSettingsInput,
} from "../../../src/shared/types";
import { DatabaseBootstrap } from "../../../src/worker/d1-bootstrap";
import { AppSettingsStore } from "../../../src/worker/settings-store";

const KEY = "test-encryption-key";

async function resetStorage(): Promise<void> {
  await env.DB.exec(`
    DROP TABLE IF EXISTS app_settings;
    DROP TABLE IF EXISTS connections;
    DROP TABLE IF EXISTS folders;
    DROP TABLE IF EXISTS bootstrap_state;
    DROP TABLE IF EXISTS schema_meta;
  `);
  await new DatabaseBootstrap(env.DB, env.KV, KEY).status();
}

beforeEach(resetStorage);

describe("AppSettingsStore", () => {
  it("沒有 singleton row 時回傳安全預設值", async () => {
    const settings = await new AppSettingsStore(env.DB).get();

    expect(settings).toEqual({ ...APP_SETTINGS_DEFAULTS, updatedAt: 0 });
  });

  it("以 singleton row 儲存並跨 store instance 讀回完整設定", async () => {
    const input: AppSettingsInput = {
      theme: "high-contrast",
      terminalFontSize: 18,
      monitorIntervalSeconds: 10,
      autoReconnectEnabled: false,
      autoReconnectAttempts: 5,
    };
    const saved = await new AppSettingsStore(env.DB, () => 123_456).save(input);

    expect(saved).toEqual({ ...input, updatedAt: 123_456 });
    await expect(new AppSettingsStore(env.DB).get()).resolves.toEqual(saved);

    const rows = await env.DB
      .prepare("SELECT COUNT(*) AS count FROM app_settings")
      .first<{ count: number }>();
    expect(rows?.count).toBe(1);
  });
});
