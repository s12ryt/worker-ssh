import type { ConnectionView } from "../shared/types";
import type { SshClientLike } from "./ssh-client-contract";

export interface BackendHostKeyInfo {
  keyType: string;
  fingerprint: string;
}

export type BackendHostKeyVerifier = (
  info: BackendHostKeyInfo,
) => Promise<boolean> | boolean;

export class BackendHostKeyMismatchError extends Error {
  constructor(
    readonly expected: string,
    readonly actual: string,
  ) {
    super(`SSH 主機指紋不一致，已阻擋連線。已信任：${expected}；目前：${actual}`);
    this.name = "BackendHostKeyMismatchError";
  }
}

export interface BackendExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface BackendSftpEntry {
  name: string;
  size: number;
  isDir: boolean;
  mode: number;
  modTime: string;
}

export type BackendReconnectState =
  | { state: "reconnecting"; attempt: number; delayMs: number }
  | { state: "ready"; attempt: number }
  | { state: "failed"; attempt: number };

interface BackendSshClientOptions {
  webSocketFactory?: (url: string) => WebSocket;
  reconnectDelaysMs?: readonly number[];
  delay?: (ms: number) => Promise<void>;
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

function defaultWebSocketFactory(path: string): WebSocket {
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  return new WebSocket(`${protocol}//${location.host}${path}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

const SFTP_CHUNK_BYTES = 512 * 1024;

function concatBytes(chunks: readonly Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

export class BackendSshClient implements SshClientLike {
  private readonly webSocketFactory: (url: string) => WebSocket;
  private reconnectDelaysMs: readonly number[];
  private reconnectEnabled = true;
  private readonly delay: (ms: number) => Promise<void>;
  private socket: WebSocket | null = null;
  private config: ConnectionView | null = null;
  private verifier: BackendHostKeyVerifier | undefined;
  private readyResolve: (() => void) | null = null;
  private readyReject: ((error: Error) => void) | null = null;
  private shellData: ((data: Uint8Array) => void) | null = null;
  private requestSequence = 0;
  private readonly pendingRequests = new Map<string, PendingRequest>();
  private readonly closedHandlers = new Set<() => void>();
  private securityError: Error | null = null;
  private closedNotified = false;
  private sessionReady = false;
  private explicitClose = false;
  private reconnecting = false;
  private readonly reconnectHandlers = new Set<(state: BackendReconnectState) => void>();

  constructor(options: BackendSshClientOptions = {}) {
    this.webSocketFactory = options.webSocketFactory ?? defaultWebSocketFactory;
    this.reconnectDelaysMs = options.reconnectDelaysMs ?? [1_000, 2_000, 4_000];
    this.delay = options.delay ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  connect(
    config: ConnectionView,
    _transport?: unknown,
    verifier?: BackendHostKeyVerifier,
  ): Promise<number> {
    this.config = config;
    this.verifier = verifier;
    this.securityError = null;
    this.closedNotified = false;
    this.explicitClose = false;
    this.sessionReady = false;
    return this.openSocket().then(() => 1);
  }

  private openSocket(): Promise<void> {
    const config = this.config;
    if (!config) return Promise.reject(new Error("缺少 SSH 連線設定"));
    const path = `/api/ssh?connectionId=${encodeURIComponent(config.id)}`;
    const socket = this.webSocketFactory(path);
    this.socket = socket;
    this.sessionReady = false;
    socket.onmessage = (event) => {
      if (this.socket !== socket) return;
      void this.handleMessage(event.data);
    };
    socket.onclose = (event) => {
      if (this.socket !== socket) return;
      const wasReady = this.sessionReady;
      this.socket = null;
      this.sessionReady = false;
      this.rejectReady(new Error("SSH WebSocket 已關閉"));
      this.rejectPending(new Error("SSH WebSocket 已關閉"));
      if (!this.explicitClose && this.reconnectEnabled && wasReady && event.code !== 1000) {
        void this.reconnect();
      } else if (!this.reconnecting) {
        this.notifyClosed();
      }
    };
    socket.onerror = () => this.rejectReady(new Error("SSH WebSocket 連線失敗"));

    return new Promise<void>((resolve, reject) => {
      this.readyResolve = resolve;
      this.readyReject = reject;
    });
  }

  exec(
    _connId: number,
    command: string,
  ): Promise<BackendExecResult> {
    return this.request("exec", { command }) as Promise<BackendExecResult>;
  }

  async openShell(
    _connId: number,
    cols: number,
    rows: number,
    onData: (data: Uint8Array) => void,
  ): Promise<number> {
    this.shellData = onData;
    const result = await this.request("openShell", { cols, rows });
    if (!isRecord(result) || typeof result.shellId !== "number") {
      throw new Error("後端 SSH shell 回應無效");
    }
    return result.shellId;
  }

  shellWrite(_connId: number, text: string): void {
    this.sendEvent({ type: "shell-write", text });
  }

  shellResize(_connId: number, cols: number, rows: number): void {
    this.sendEvent({ type: "shell-resize", cols, rows });
  }

  shellClose(_connId: number): void {
    this.sendEvent({ type: "shell-close" });
    this.shellData = null;
  }

  async list(_connId: number, path: string): Promise<BackendSftpEntry[]> {
    return this.request("sftpList", { path }) as Promise<BackendSftpEntry[]>;
  }

  async stat(_connId: number, path: string): Promise<BackendSftpEntry> {
    return this.request("sftpStat", { path }) as Promise<BackendSftpEntry>;
  }

  async readFile(_connId: number, path: string): Promise<Uint8Array> {
    const opened = await this.request("sftpOpenRead", { path });
    if (!isRecord(opened) || typeof opened.handleId !== "number") {
      throw new Error("後端 SSH 讀取控制代碼無效");
    }
    const chunks: Uint8Array[] = [];
    let failure: unknown;
    try {
      for (;;) {
        const result = await this.request("sftpReadChunk", {
          handleId: opened.handleId,
        });
        if (
          !isRecord(result) ||
          typeof result.base64 !== "string" ||
          typeof result.eof !== "boolean"
        ) {
          throw new Error("後端 SSH 檔案分塊回應無效");
        }
        const chunk = base64ToBytes(result.base64);
        if (chunk.byteLength > SFTP_CHUNK_BYTES) {
          throw new Error("後端 SSH 檔案分塊過大");
        }
        chunks.push(chunk);
        if (result.eof) break;
        if (chunk.byteLength === 0) {
          throw new Error("後端 SSH 檔案分塊沒有進度");
        }
      }
    } catch (error) {
      failure = error;
    }
    try {
      await this.request("sftpCloseRead", { handleId: opened.handleId });
    } catch (error) {
      if (failure === undefined) failure = error;
    }
    if (failure !== undefined) throw failure;
    return concatBytes(chunks);
  }

  async writeFile(
    _connId: number,
    path: string,
    data: Uint8Array,
  ): Promise<void> {
    const opened = await this.request("sftpOpenWrite", { path });
    if (!isRecord(opened) || typeof opened.handleId !== "number") {
      throw new Error("後端 SSH 寫入控制代碼無效");
    }
    let failure: unknown;
    try {
      for (let offset = 0; offset < data.byteLength; offset += SFTP_CHUNK_BYTES) {
        await this.request("sftpWriteChunk", {
          handleId: opened.handleId,
          base64: bytesToBase64(
            data.subarray(offset, offset + SFTP_CHUNK_BYTES),
          ),
        });
      }
    } catch (error) {
      failure = error;
    }
    try {
      await this.request("sftpCloseWrite", { handleId: opened.handleId });
    } catch (error) {
      if (failure === undefined) failure = error;
    }
    if (failure !== undefined) throw failure;
  }

  async mkdir(_connId: number, path: string): Promise<void> {
    await this.request("sftpMkdir", { path });
  }

  async remove(_connId: number, path: string): Promise<void> {
    await this.request("sftpRemove", { path });
  }

  async rename(
    _connId: number,
    from: string,
    to: string,
  ): Promise<void> {
    await this.request("sftpRename", { from, to });
  }

  disconnect(_connId: number): void {
    this.explicitClose = true;
    this.sendEvent({ type: "disconnect" });
    this.socket?.close();
    this.socket = null;
    this.shellData = null;
  }

  close(): void {
    this.explicitClose = true;
    this.rejectReady(new Error("SSH WebSocket 已關閉"));
    this.rejectPending(new Error("SSH WebSocket 已關閉"));
    this.socket?.close();
    this.socket = null;
    this.shellData = null;
  }

  onClosed(handler: () => void): () => void {
    this.closedHandlers.add(handler);
    return () => this.closedHandlers.delete(handler);
  }

  onReconnectState(handler: (state: BackendReconnectState) => void): () => void {
    this.reconnectHandlers.add(handler);
    return () => this.reconnectHandlers.delete(handler);
  }

  setReconnectPolicy(enabled: boolean, attempts: number): void {
    if (!Number.isInteger(attempts) || attempts < 1 || attempts > 5) {
      throw new Error("自動重連次數必須介於 1 到 5");
    }
    this.reconnectEnabled = enabled;
    this.reconnectDelaysMs = [1_000, 2_000, 4_000, 8_000, 16_000].slice(0, attempts);
  }

  private request(method: string, params: Record<string, unknown>): Promise<unknown> {
    const socket = this.socket;
    if (!socket || socket.readyState !== 1 || !this.sessionReady) {
      return Promise.reject(new Error("SSH WebSocket 尚未就緒"));
    }
    const id = `r${++this.requestSequence}`;
    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject });
      socket.send(JSON.stringify({ type: "request", id, method, params }));
    });
  }

  private sendEvent(message: Record<string, unknown>): void {
    const socket = this.socket;
    if (!socket || socket.readyState !== 1 || !this.sessionReady) return;
    socket.send(JSON.stringify(message));
  }

  private async handleMessage(data: unknown): Promise<void> {
    if (typeof data !== "string") return;
    let message: unknown;
    try {
      message = JSON.parse(data);
    } catch {
      return;
    }
    if (!isRecord(message) || typeof message.type !== "string") return;

    if (
      message.type === "host-key" &&
      typeof message.challengeId === "string" &&
      typeof message.keyType === "string" &&
      typeof message.fingerprint === "string"
    ) {
      let accepted = false;
      try {
        accepted = this.verifier
          ? await this.verifier({
              keyType: message.keyType,
              fingerprint: message.fingerprint,
            })
          : false;
      } catch (error) {
        this.securityError = error instanceof Error ? error : new Error(String(error));
        accepted = false;
      }
      this.socket?.send(
        JSON.stringify({
          type: "host-key-response",
          challengeId: message.challengeId,
          accepted,
        }),
      );
      return;
    }

    if (message.type === "state") {
      if (message.state === "ready") {
        this.sessionReady = true;
        this.readyResolve?.();
        this.readyResolve = null;
        this.readyReject = null;
      } else if (message.state === "error") {
        const error = this.securityError ?? new Error("後端 SSH 連線失敗");
        this.rejectReady(error);
        this.rejectPending(error);
      }
      return;
    }

    if (
      message.type === "host-key-mismatch" &&
      typeof message.expected === "string" &&
      typeof message.actual === "string"
    ) {
      this.securityError = new BackendHostKeyMismatchError(
        message.expected,
        message.actual,
      );
      return;
    }

    if (
      message.type === "response" &&
      typeof message.id === "string"
    ) {
      const pending = this.pendingRequests.get(message.id);
      if (!pending) return;
      this.pendingRequests.delete(message.id);
      if (message.ok === true) pending.resolve(message.result);
      else pending.reject(new Error("後端 SSH 請求失敗"));
      return;
    }

    if (message.type === "shell-data" && typeof message.base64 === "string") {
      this.shellData?.(base64ToBytes(message.base64));
    }
  }

  private rejectReady(error: Error): void {
    this.readyReject?.(error);
    this.readyResolve = null;
    this.readyReject = null;
  }

  private rejectPending(error: Error): void {
    for (const pending of this.pendingRequests.values()) pending.reject(error);
    this.pendingRequests.clear();
  }

  private emitReconnectState(state: BackendReconnectState): void {
    for (const handler of this.reconnectHandlers) handler(state);
  }

  private async reconnect(): Promise<void> {
    if (this.reconnecting || this.explicitClose || !this.reconnectEnabled) return;
    this.reconnecting = true;
    this.shellData = null;
    let lastAttempt = 0;
    try {
      for (const [index, delayMs] of this.reconnectDelaysMs.entries()) {
        const attempt = index + 1;
        lastAttempt = attempt;
        this.emitReconnectState({ state: "reconnecting", attempt, delayMs });
        await this.delay(delayMs);
        if (this.explicitClose) return;
        this.securityError = null;
        try {
          await this.openSocket();
          this.emitReconnectState({ state: "ready", attempt });
          return;
        } catch (error) {
          if (error === this.securityError || error instanceof BackendHostKeyMismatchError) break;
        }
      }
      this.emitReconnectState({ state: "failed", attempt: lastAttempt });
      this.notifyClosed();
    } finally {
      this.reconnecting = false;
    }
  }

  private notifyClosed(): void {
    if (this.closedNotified) return;
    this.closedNotified = true;
    for (const handler of this.closedHandlers) handler();
  }
}
