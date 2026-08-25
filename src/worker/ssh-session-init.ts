export interface SessionObjectStubLike {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
}

export class SshSessionInitializationError extends Error {
  constructor() {
    super("SSH session initialization failed");
    this.name = "SshSessionInitializationError";
  }
}

/** 將 session payload（UTF-8 JSON，可含非 ASCII）編為 base64 header 值。 */
export function encodeSessionConfigHeader(payload: unknown): string {
  const json = JSON.stringify(payload);
  const bytes = new TextEncoder().encode(json);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

/** 解碼 X-Session-Config header；格式錯誤回 null。 */
export function decodeSessionConfigHeader<T = unknown>(header: string): T | null {
  try {
    const bin = atob(header);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return JSON.parse(new TextDecoder().decode(bytes)) as T;
  } catch {
    return null;
  }
}

/**
 * 以 connectionId 衍生穩定的 SSH session DO 名稱。
 *
 * 同一連線重複連線時命中同一個 Durable Object instance：
 * 暖 isolate 免冷啟動、module 級 Go WASM runtime 單例免重新 instantiate。
 * DO 本身無跨請求狀態（config 逐次走 X-Session-Config header），重用安全；
 * DO 被平台淘汰後 getByName 會重建 instance，行為等同原本的逐次新名。
 */
export function sshSessionDoName(connectionId: string): string {
  return `ssh-${connectionId}`;
}

/**
 * 單一 subrequest 連線：payload 以 X-Session-Config header 隨 WS 升級請求送達，
 * 取代早期的 /init + /connect 兩段式（WS 升級請求不可帶 body，故走 header）。
 */
export async function connectInitializedSshSession(
  stub: SessionObjectStubLike,
  payload: unknown,
): Promise<Response> {
  let configHeader: string;
  try {
    configHeader = encodeSessionConfigHeader(payload);
  } catch {
    throw new SshSessionInitializationError();
  }
  return stub.fetch("https://ssh-session.internal/connect", {
    method: "GET",
    headers: {
      Upgrade: "websocket",
      "X-Session-Config": configHeader,
    },
  });
}
