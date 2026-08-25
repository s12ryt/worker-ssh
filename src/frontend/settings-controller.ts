import {
  APP_SETTINGS_DEFAULTS,
  type AppSettings,
  type AppSettingsInput,
} from "../shared/types";

interface SettingsDraftDependencies {
  preview(settings: AppSettingsInput): void;
  save(settings: AppSettingsInput): Promise<AppSettings>;
}

function writableSettings(settings: AppSettingsInput): AppSettingsInput {
  return {
    theme: settings.theme,
    terminalFontSize: settings.terminalFontSize,
    monitorIntervalSeconds: settings.monitorIntervalSeconds,
    autoReconnectEnabled: settings.autoReconnectEnabled,
    autoReconnectAttempts: settings.autoReconnectAttempts,
  };
}

export class SettingsDraftController {
  private snapshot: AppSettings;
  private draft: AppSettings;

  constructor(
    initial: AppSettings,
    private readonly deps: SettingsDraftDependencies,
  ) {
    this.snapshot = { ...initial };
    this.draft = { ...initial };
  }

  get value(): AppSettings {
    return { ...this.draft };
  }

  update(patch: Partial<AppSettingsInput>): void {
    this.draft = { ...this.draft, ...patch };
    this.deps.preview(writableSettings(this.draft));
  }

  restoreDefaults(): void {
    this.draft = { ...this.draft, ...APP_SETTINGS_DEFAULTS };
    this.deps.preview(APP_SETTINGS_DEFAULTS);
  }

  cancel(): void {
    this.draft = { ...this.snapshot };
    this.deps.preview(this.snapshot);
  }

  async save(): Promise<AppSettings> {
    const saved = await this.deps.save(writableSettings(this.draft));
    this.snapshot = { ...saved };
    this.draft = { ...saved };
    this.deps.preview(saved);
    return { ...saved };
  }
}
