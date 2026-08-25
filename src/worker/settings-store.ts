import {
  APP_SETTINGS_DEFAULTS,
  type AppSettings,
  type AppSettingsInput,
  type MonitorIntervalSeconds,
  type ThemeMode,
} from "../shared/types";

interface AppSettingsRow {
  theme: ThemeMode;
  terminal_font_size: number;
  monitor_interval_seconds: MonitorIntervalSeconds;
  auto_reconnect_enabled: number;
  auto_reconnect_attempts: number;
  updated_at: number;
}

function fromRow(row: AppSettingsRow): AppSettings {
  return {
    theme: row.theme,
    terminalFontSize: row.terminal_font_size,
    monitorIntervalSeconds: row.monitor_interval_seconds,
    autoReconnectEnabled: row.auto_reconnect_enabled === 1,
    autoReconnectAttempts: row.auto_reconnect_attempts,
    updatedAt: row.updated_at,
  };
}

export class AppSettingsStore {
  constructor(
    private readonly db: D1Database,
    private readonly now: () => number = Date.now,
  ) {}

  async get(): Promise<AppSettings> {
    const row = await this.db
      .prepare(
        `SELECT theme, terminal_font_size, monitor_interval_seconds,
                auto_reconnect_enabled, auto_reconnect_attempts, updated_at
         FROM app_settings WHERE id = 1`,
      )
      .first<AppSettingsRow>();
    return row
      ? fromRow(row)
      : { ...APP_SETTINGS_DEFAULTS, updatedAt: 0 };
  }

  async save(input: AppSettingsInput): Promise<AppSettings> {
    const updatedAt = this.now();
    await this.db
      .prepare(
        `INSERT INTO app_settings (
           id, theme, terminal_font_size, monitor_interval_seconds,
           auto_reconnect_enabled, auto_reconnect_attempts, updated_at
         ) VALUES (1, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           theme = excluded.theme,
           terminal_font_size = excluded.terminal_font_size,
           monitor_interval_seconds = excluded.monitor_interval_seconds,
           auto_reconnect_enabled = excluded.auto_reconnect_enabled,
           auto_reconnect_attempts = excluded.auto_reconnect_attempts,
           updated_at = excluded.updated_at`,
      )
      .bind(
        input.theme,
        input.terminalFontSize,
        input.monitorIntervalSeconds,
        input.autoReconnectEnabled ? 1 : 0,
        input.autoReconnectAttempts,
        updatedAt,
      )
      .run();
    return { ...input, updatedAt };
  }
}
