import type { AuthType, ConnectionView } from "../shared/types";
import {
  validateAccessProxyShape,
  validateSshOption,
  type AccessProxyConfig,
  type SshOption,
} from "../shared/ssh-options";

export interface ConnectionFormValues {
  name: string;
  host: string;
  port: string;
  username: string;
  authType: AuthType;
  password: string;
  privateKey: string;
  passphrase: string;
  /** SSH 選項：逐行 Key=Value（與 API 的 sshOptions[] 對應） */
  sshOptionsText: string;
  accessHostname: string;
  accessDestination: string;
  accessClientId: string;
  /** 編輯時空白代表沿用已儲存 secret（API View 不回傳 secret，表單不重現） */
  accessClientSecret: string;
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
  sshOptions?: SshOption[] | null;
  accessProxy?: AccessProxyConfig | null;
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
    sshOptionsText: (cfg?.sshOptions ?? [])
      .map((option) => `${option.key}=${option.value}`)
      .join("\n"),
    accessHostname: cfg?.accessProxy?.hostname ?? "",
    accessDestination: cfg?.accessProxy?.destination ?? "",
    accessClientId: cfg?.accessProxy?.clientId ?? "",
    accessClientSecret: "",
  };
}

/** 解析逐行 Key=Value 文字；錯誤訊息附上行號（1-based） */
function parseSshOptionsText(text: string): SshOption[] {
  const options: SshOption[] = [];
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!.trim();
    if (!line) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) {
      throw new Error(`SSH 選項第 ${i + 1} 行缺少 Key=Value 格式`);
    }
    const result = validateSshOption(line.slice(0, eq), line.slice(eq + 1));
    if (!result.ok) {
      throw new Error(`${result.error}（第 ${i + 1} 行）`);
    }
    options.push(result.option);
  }
  return options;
}

function buildAccessProxySubmission(
  existing: ConnectionView | undefined,
  values: ConnectionFormValues,
): AccessProxyConfig | null | undefined {
  const hostname = values.accessHostname.trim();
  if (!hostname) {
    // 清空 hostname：編輯且原有代理 → 明確清除；否則不送欄位
    return existing?.accessProxy ? null : undefined;
  }
  const trimmed: Record<string, string> = {
    hostname,
    ...(values.accessDestination.trim() ? { destination: values.accessDestination.trim() } : {}),
    ...(values.accessClientId.trim() ? { clientId: values.accessClientId.trim() } : {}),
    ...(values.accessClientSecret ? { clientSecret: values.accessClientSecret } : {}),
  };
  const shape = validateAccessProxyShape(trimmed);
  if (!shape.ok) throw new Error(shape.error);
  // 新建時 secret 無舊值可沿用，提前在前端擋下（編輯時空白 = 沿用後端已存值）
  if (existing === undefined && shape.proxy.clientId && !shape.proxy.clientSecret) {
    throw new Error("Access clientId 已設定時 clientSecret 必填");
  }
  return shape.proxy;
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

  const sshOptions = parseSshOptionsText(values.sshOptionsText);
  if (sshOptions.length > 0) {
    submission.sshOptions = sshOptions;
  } else if (existing !== undefined) {
    submission.sshOptions = null; // 全空 = 清除（新建時不送欄位）
  }

  const accessProxy = buildAccessProxySubmission(existing, values);
  if (accessProxy !== undefined) submission.accessProxy = accessProxy;

  return submission;
}

export function assertConnectionReady(cfg: ConnectionView): void {
  if (cfg.credentialState === "missing") {
    throw new Error("此連線缺少認證憑證，請先編輯連線並設定憑證");
  }
}
