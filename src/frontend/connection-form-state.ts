import type { AuthType, ConnectionView } from "../shared/types";

export interface ConnectionFormValues {
  name: string;
  host: string;
  port: string;
  username: string;
  authType: AuthType;
  password: string;
  privateKey: string;
  passphrase: string;
}

export interface ConnectionSubmission {
  name: string;
  host: string;
  port: number;
  username: string;
  authType: AuthType;
  password?: string;
  privateKey?: string;
  passphrase?: string;
}

/** API DTO 不含秘密；編輯表單也不應重現已保存憑證。 */
export function connectionFormValues(cfg?: ConnectionView): ConnectionFormValues {
  return {
    name: cfg?.name ?? "",
    host: cfg?.host ?? "",
    port: String(cfg?.port ?? 22),
    username: cfg?.username ?? "",
    authType: cfg?.authType ?? "password",
    password: "",
    privateKey: "",
    passphrase: "",
  };
}

export function buildConnectionSubmission(
  existing: ConnectionView | undefined,
  values: ConnectionFormValues,
): ConnectionSubmission {
  const submission: ConnectionSubmission = {
    name: values.name.trim(),
    host: values.host.trim(),
    port: Number(values.port),
    username: values.username.trim(),
    authType: values.authType,
  };
  const authChanged = existing !== undefined && existing.authType !== values.authType;
  const requiresCredential = existing === undefined || authChanged;

  if (values.authType === "password") {
    if (requiresCredential && values.password.length === 0) {
      throw new Error("請輸入 SSH 密碼");
    }
    if (values.password.length > 0) submission.password = values.password;
  } else {
    if (requiresCredential && values.privateKey.trim().length === 0) {
      throw new Error("請輸入 SSH 私鑰");
    }
    if (values.privateKey.length > 0) submission.privateKey = values.privateKey;
    if (values.passphrase.length > 0) submission.passphrase = values.passphrase;
  }

  return submission;
}

export function assertConnectionReady(cfg: ConnectionView): void {
  if (cfg.credentialState === "missing") {
    throw new Error("此連線缺少認證憑證，請先編輯連線並設定憑證");
  }
}
