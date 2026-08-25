import type { AppSettingsInput } from "../shared/types";

export interface SettingsRuntimeTargets {
  root?: Pick<HTMLElement, "dataset"> | null;
  terminal?: { setFontSize(size: number): void } | null;
  poller?: { setIntervalMs(intervalMs: number): void } | null;
  client?: { setReconnectPolicy?(enabled: boolean, attempts: number): void } | null;
}

export function applyRuntimeSettings(
  settings: AppSettingsInput,
  targets: SettingsRuntimeTargets,
): void {
  if (targets.root) targets.root.dataset.theme = settings.theme;
  targets.terminal?.setFontSize(settings.terminalFontSize);
  targets.poller?.setIntervalMs(settings.monitorIntervalSeconds * 1_000);
  targets.client?.setReconnectPolicy?.(
    settings.autoReconnectEnabled,
    settings.autoReconnectAttempts,
  );
}
