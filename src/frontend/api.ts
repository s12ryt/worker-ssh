// Worker API 客戶端：統一錯誤語意（非 2xx → ApiError）
import type {
  AppSettings,
  AppSettingsInput,
  BootstrapStatusView,
  ConnectionConfig,
  ConnectionView,
  FolderScopeView,
  FolderView,
  OsInfo,
} from "@/shared/types";

export class ApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    credentials: "same-origin",
    ...init,
  });
  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      // 非 JSON 錯誤主體，保留 HTTP 狀態訊息
    }
    throw new ApiError(res.status, message);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

function jsonInit(method: string, body: unknown): RequestInit {
  return {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

// ---- 驗證 ----

export async function login(password: string): Promise<void> {
  await request("/api/login", jsonInit("POST", { password }));
}

export interface SessionInfo {
  authenticated: boolean;
}

export async function session(): Promise<SessionInfo> {
  return request<SessionInfo>("/api/session");
}

export async function logout(): Promise<void> {
  await request("/api/logout", { method: "POST" });
}

// ---- D1 初始化 ----

export async function getBootstrapStatus(): Promise<BootstrapStatusView> {
  return request<BootstrapStatusView>("/api/bootstrap");
}

export async function stepBootstrap(): Promise<BootstrapStatusView> {
  return request<BootstrapStatusView>("/api/bootstrap", { method: "POST" });
}

export async function retryBootstrap(): Promise<BootstrapStatusView> {
  return request<BootstrapStatusView>("/api/bootstrap/retry", { method: "POST" });
}

// ---- 全域設定 ----

export async function getSettings(): Promise<AppSettings> {
  return request<AppSettings>("/api/settings");
}

export async function saveSettings(settings: AppSettingsInput): Promise<AppSettings> {
  const input: AppSettingsInput = {
    theme: settings.theme,
    terminalFontSize: settings.terminalFontSize,
    monitorIntervalSeconds: settings.monitorIntervalSeconds,
    autoReconnectEnabled: settings.autoReconnectEnabled,
    autoReconnectAttempts: settings.autoReconnectAttempts,
  };
  return request<AppSettings>("/api/settings", jsonInit("PUT", input));
}

// ---- 連線與資料夾管理 ----

export async function listConnections(): Promise<ConnectionView[]> {
  return request<ConnectionView[]>("/api/connections");
}

export async function listScope(folderId: string | null): Promise<FolderScopeView> {
  const query = folderId === null ? "" : `?folderId=${encodeURIComponent(folderId)}`;
  return request<FolderScopeView>(`/api/scope${query}`);
}

export async function listFolders(): Promise<FolderView[]> {
  return request<FolderView[]>("/api/folders");
}

export async function createConnection(
  data: Omit<ConnectionConfig, "id" | "createdAt" | "updatedAt"> & {
    folderId?: string | null;
  },
): Promise<ConnectionView> {
  return request<ConnectionView>("/api/connections", jsonInit("POST", data));
}

export type ConnectionPatch = Partial<
  Omit<
    ConnectionConfig,
    | "id"
    | "createdAt"
    | "updatedAt"
    | "hostKeyType"
    | "hostKeyFingerprint"
    | "sshOptions"
    | "accessProxy"
  >
> & {
  hostKeyType?: string | null;
  hostKeyFingerprint?: string | null;
  /** null 代表清除（與後端 PUT 語意一致） */
  sshOptions?: ConnectionConfig["sshOptions"] | null;
  accessProxy?: ConnectionConfig["accessProxy"] | null;
};

export async function updateConnection(
  id: string,
  patch: ConnectionPatch,
): Promise<ConnectionView> {
  return request<ConnectionView>(
    `/api/connections/${encodeURIComponent(id)}`,
    jsonInit("PUT", patch),
  );
}

export async function deleteConnection(id: string): Promise<void> {
  await request(`/api/connections/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

export async function clearConnectionCredential(id: string): Promise<ConnectionView> {
  return request<ConnectionView>(
    `/api/connections/${encodeURIComponent(id)}/credential`,
    { method: "DELETE" },
  );
}

export async function moveConnections(
  ids: readonly string[],
  folderId: string | null,
): Promise<void> {
  await request("/api/connections/move", jsonInit("POST", { ids, folderId }));
}

export async function createFolder(
  name: string,
  parentId: string | null,
): Promise<FolderView> {
  return request<FolderView>(
    "/api/folders",
    jsonInit("POST", { name, parentId }),
  );
}

export async function renameFolder(id: string, name: string): Promise<FolderView> {
  return request<FolderView>(
    `/api/folders/${encodeURIComponent(id)}`,
    jsonInit("PUT", { name }),
  );
}

export async function moveFolder(
  id: string,
  parentId: string | null,
): Promise<FolderView> {
  return request<FolderView>(
    `/api/folders/${encodeURIComponent(id)}`,
    jsonInit("PUT", { parentId }),
  );
}

export async function deleteFolder(
  id: string,
  mode: "promote" | "recursive",
): Promise<void> {
  await request(
    `/api/folders/${encodeURIComponent(id)}?mode=${mode}`,
    { method: "DELETE" },
  );
}

// ---- OS 偵測快取 ----

export async function getOs(key: string): Promise<OsInfo | null> {
  const res = await fetch(`/api/os?key=${encodeURIComponent(key)}`, {
    credentials: "same-origin",
  });
  // 204 = 新 Worker 的快取未命中；404 = 滾動部署期的舊 Worker 未命中。兩者皆回 null。
  if (res.status === 204 || res.status === 404) return null;
  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      // 忽略
    }
    throw new ApiError(res.status, message);
  }
  return (await res.json()) as OsInfo;
}

export async function putOs(key: string, info: OsInfo): Promise<void> {
  // Worker 契約：PUT 主體為 { key, info } 巢狀結構
  await request(
    `/api/os?key=${encodeURIComponent(key)}`,
    jsonInit("PUT", { key, info }),
  );
}
