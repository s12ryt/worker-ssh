import type { MonitorChartsHandle, MetricsPoller } from "./monitor";
import type { SshClientLike } from "./ssh-client-contract";
import type { TerminalHandle } from "./terminal";

export interface SessionResources {
  connId?: number;
  client?: SshClientLike;
  terminal?: TerminalHandle;
  poller?: MetricsPoller;
  charts?: MonitorChartsHandle | null;
  subscriptions?: Array<() => void>;
  cleaned?: boolean;
}

function ignoreCleanupError(cleanup: (() => void) | undefined): void {
  try {
    cleanup?.();
  } catch {
    // 清理必須 best-effort 跑完所有資源，不讓單一步驟阻斷後續釋放。
  }
}

/** 釋放完整或部分建立的 SSH 工作階段；可安全重複呼叫。 */
export function cleanupSessionResources(resources: SessionResources): void {
  if (resources.cleaned) return;
  resources.cleaned = true;

  for (const unsubscribe of resources.subscriptions ?? []) {
    ignoreCleanupError(unsubscribe);
  }
  ignoreCleanupError(() => resources.poller?.stop());
  ignoreCleanupError(() => resources.charts?.destroy());

  const canDisconnect = resources.client !== undefined && resources.connId !== undefined;
  if (canDisconnect) {
    ignoreCleanupError(() => resources.client!.shellClose(resources.connId!));
    let disconnected = false;
    try {
      resources.client!.disconnect(resources.connId!);
      disconnected = true;
    } catch {
      // disconnect 失敗時仍須直接關閉 transport。
    }
    if (!disconnected) ignoreCleanupError(() => resources.client?.close?.());
  } else {
    ignoreCleanupError(() => resources.client?.close?.());
  }

  ignoreCleanupError(() => resources.terminal?.dispose());
}
