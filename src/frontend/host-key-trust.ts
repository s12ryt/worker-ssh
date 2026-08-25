import type { ConnectionView } from "@/shared/types";
import type { ConnectionPatch } from "./api";
import type { ConfirmModalOptions } from "./confirm-modal";
import type { BackendHostKeyInfo } from "./backend-ssh-client";

type ConfirmHostKey = (options: ConfirmModalOptions) => Promise<boolean>;
type UpdateConnection = (
  id: string,
  patch: ConnectionPatch,
) => Promise<ConnectionView>;

export interface HostKeyTrustDependencies {
  confirm: ConfirmHostKey;
  update: UpdateConnection;
}

export class HostKeyMismatchError extends Error {
  constructor(expected: string, actual: string) {
    super(
      `SSH 主機指紋不一致，已阻擋連線。已信任：${expected}；目前：${actual}`,
    );
    this.name = "HostKeyMismatchError";
  }
}

export class HostKeyRejectedError extends Error {
  constructor() {
    super("未信任 SSH 主機金鑰，連線已取消");
    this.name = "HostKeyRejectedError";
  }
}

export async function verifyHostKeyTrust(
  cfg: ConnectionView,
  info: BackendHostKeyInfo,
  deps: HostKeyTrustDependencies,
): Promise<boolean> {
  if (cfg.hostKeyFingerprint) {
    if (cfg.hostKeyFingerprint !== info.fingerprint) {
      throw new HostKeyMismatchError(
        cfg.hostKeyFingerprint,
        info.fingerprint,
      );
    }
    return true;
  }

  const accepted = await deps.confirm({
    title: "信任 SSH 主機金鑰",
    message:
      `首次連線至 ${cfg.host}:${cfg.port}。\n` +
      `金鑰類型：${info.keyType}\n` +
      `SHA-256 指紋：${info.fingerprint}\n\n` +
      "請確認此指紋與伺服器管理者提供的值一致。",
    confirmText: "信任並連線",
    cancelText: "取消",
  });
  if (!accepted) throw new HostKeyRejectedError();

  await deps.update(cfg.id, {
    hostKeyType: info.keyType,
    hostKeyFingerprint: info.fingerprint,
  });
  cfg.hostKeyType = info.keyType;
  cfg.hostKeyFingerprint = info.fingerprint;
  return true;
}

export async function resetHostKeyTrust(
  cfg: ConnectionView,
  deps: HostKeyTrustDependencies,
): Promise<boolean> {
  const accepted = await deps.confirm({
    title: "重設已信任主機金鑰",
    message:
      `確定重設 ${cfg.host}:${cfg.port} 的已信任 SSH 主機指紋？\n\n` +
      "下次連線時必須重新核對並確認伺服器指紋。",
    confirmText: "重設指紋",
    cancelText: "取消",
    danger: true,
  });
  if (!accepted) return false;

  await deps.update(cfg.id, {
    hostKeyType: null,
    hostKeyFingerprint: null,
  });
  delete cfg.hostKeyType;
  delete cfg.hostKeyFingerprint;
  return true;
}
