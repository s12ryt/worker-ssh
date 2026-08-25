// 前後端共用型別契約
import type { AccessProxyConfig, SshOption } from "./ssh-options";

export type { AccessProxyConfig, SshOption };

/** SSH 認證方式 */
export type AuthType = "password" | "privateKey";

/** SSH 連線設定（KV 中以 AES-GCM 加密整體 JSON 儲存） */
export interface ConnectionConfig {
  /** UUID */
  id: string;
  /** 顯示名稱 */
  name: string;
  host: string;
  port: number;
  username: string;
  authType: AuthType;
  /** authType=password 時必填 */
  password?: string;
  /** authType=privateKey 時必填（PEM 或 OpenSSH 格式） */
  privateKey?: string;
  /** 私鑰密碼（可選） */
  passphrase?: string;
  /** TOFU 已信任的 SSH host key 類型（例如 ssh-ed25519） */
  hostKeyType?: string;
  /** TOFU 已信任的 OpenSSH SHA-256 指紋 */
  hostKeyFingerprint?: string;
  /** SSH -o 附加選項（白名單純量項；ProxyCommand 不在此，見 accessProxy） */
  sshOptions?: SshOption[];
  /** cloudflared Access WebSocket 代理通道；啟用時不直連 host */
  accessProxy?: AccessProxyConfig;
  createdAt: number;
  updatedAt: number;
  /** 最近一次連線成功時間（ms epoch）；D20 雲同步，舊資料可能 undefined */
  lastConnectedAt?: number;
  /** 最近一次斷線時間（ms epoch）；D20 雲同步，舊資料可能 undefined */
  lastDisconnectedAt?: number;
}

export type CredentialState = "ready" | "missing";

/** Access 代理的公開視圖：clientSecret 永不外流 */
export interface AccessProxyView {
  hostname: string;
  destination?: string;
  clientId?: string;
}

/** 一般 API 可回傳的連線 DTO；敏感憑證永不離開 Worker。 */
export interface ConnectionView
  extends Omit<
    ConnectionConfig,
    "password" | "privateKey" | "passphrase" | "accessProxy"
  > {
  folderId: string | null;
  credentialState: CredentialState;
  accessProxy?: AccessProxyView;
}

export interface FolderView {
  id: string;
  parentId: string | null;
  name: string;
  recursiveHostCount: number;
  sortOrder: number;
  createdAt: number;
  updatedAt: number;
}

export interface FolderScopeView {
  folder: FolderView | null;
  breadcrumb: FolderView[];
  folders: FolderView[];
  connections: ConnectionView[];
}

export interface BootstrapStatusView {
  status: "pending" | "running" | "failed" | "complete";
  phase: "kv_scan" | "kv_migrate" | "verify" | "kv_cleanup" | "complete";
  schemaVersion: number;
  percent: number;
  processed: number;
  total: number;
  errorCode?: string;
}

export type ThemeMode = "dark" | "high-contrast";
export type MonitorIntervalSeconds = 3 | 5 | 10 | 30;

export interface AppSettingsInput {
  theme: ThemeMode;
  terminalFontSize: number;
  monitorIntervalSeconds: MonitorIntervalSeconds;
  autoReconnectEnabled: boolean;
  autoReconnectAttempts: number;
}

export interface AppSettings extends AppSettingsInput {
  updatedAt: number;
}

export const APP_SETTINGS_DEFAULTS: Readonly<AppSettingsInput> = {
  theme: "dark",
  terminalFontSize: 14,
  monitorIntervalSeconds: 3,
  autoReconnectEnabled: true,
  autoReconnectAttempts: 3,
};

/** 作業系統偵測結果（KV 明文快取，非敏感） */
export interface OsInfo {
  /** 規範化 id：ubuntu/debian/centos/rockylinux/almalinux/fedora/archlinux/alpine/
   *  opensuse/gentoo/nixos/manjaro/kali/raspbian/macos/freebsd/openbsd/netbsd/
   *  windows/linux/unknown */
  os: string;
  /** 家族：linux/bsd/darwin/windows/unknown */
  family: string;
  /** 發行版顯示名稱 */
  distro?: string;
  /** 核心/版本字串 */
  version?: string;
  detectedAt: number;
}

/** 登入請求 */
export interface LoginRequest {
  password: string;
}

/** API 錯誤回應 */
export interface ApiError {
  error: string;
}
