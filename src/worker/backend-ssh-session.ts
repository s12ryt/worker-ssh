import type { ConnectionConfig } from "../shared/types";
import type { BackendSshEngine } from "./backend-ssh-runtime";

interface SessionSocket {
  send(data: string): void;
  close(code?: number, reason?: string): void;
  addEventListener(
    type: string,
    listener: (event: { data?: string }) => void,
  ): void;
}

interface SessionTransport {
  close(): void;
}

interface HostKeyInfo {
  keyType: string;
  fingerprint: string;
}

interface BackendSshSessionOptions {
  engine: BackendSshEngine;
  socket: SessionSocket;
  transport: SessionTransport;
  config: ConnectionConfig;
  now?: () => number;
  challengeTimeoutMs?: number;
}

interface PendingChallenge {
  id: string;
  resolve: (accepted: boolean) => void;
  timer: ReturnType<typeof setTimeout>;
}

const MAX_RPC_FRAME_BYTES = 768 * 1024;
const MAX_IN_FLIGHT_REQUESTS = 4;
const REQUESTS_PER_SECOND = 20;
const REQUEST_BURST = 40;
const SFTP_CHUNK_BYTES = 512 * 1024;
const DEFAULT_CHALLENGE_TIMEOUT_MS = 60_000;

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export class BackendSshSession {
  private readonly engine: BackendSshEngine;
  private readonly socket: SessionSocket;
  private readonly transport: SessionTransport;
  private readonly config: ConnectionConfig;
  private readonly now: () => number;
  private readonly challengeTimeoutMs: number;
  private pendingChallenge: PendingChallenge | null = null;
  private connId: number | null = null;
  private shellHandle: number | null = null;
  private hostKeyBlocked = false;
  private closed = false;
  private requestTokens = REQUEST_BURST;
  private lastTokenRefillAt: number;
  private readonly inFlightRequests = new Set<string>();
  private readonly readHandles = new Set<number>();
  private readonly writeHandles = new Set<number>();
  private readonly closedPromise: Promise<void>;
  private resolveClosed!: () => void;

  constructor(options: BackendSshSessionOptions) {
    this.engine = options.engine;
    this.socket = options.socket;
    this.transport = options.transport;
    this.config = options.config;
    this.now = options.now ?? Date.now;
    this.challengeTimeoutMs =
      options.challengeTimeoutMs ?? DEFAULT_CHALLENGE_TIMEOUT_MS;
    this.closedPromise = new Promise<void>((resolve) => {
      this.resolveClosed = resolve;
    });
    this.lastTokenRefillAt = this.now();
    this.socket.addEventListener("message", (event) => {
      void this.handleMessage(event.data);
    });
    this.socket.addEventListener("close", () => this.dispose());
  }

  async start(): Promise<void> {
    this.send({ type: "state", state: "connecting" });
    try {
      this.connId = await this.engine.connect({
        ...this.config,
        transport: this.transport,
        verifyHostKey: (info: HostKeyInfo) => this.verifyHostKey(info),
      });
      this.send({ type: "state", state: "ready" });
    } catch {
      if (!this.hostKeyBlocked) {
        this.send({ type: "state", state: "error" });
      }
      this.close(true, 1011, "backend SSH failed");
    }
  }

  waitUntilClosed(): Promise<void> {
    return this.closedPromise;
  }

  terminate(code = 1011, reason = "session terminated"): void {
    this.close(true, code, reason);
  }

  private async verifyHostKey(info: HostKeyInfo): Promise<boolean> {
    const expected = this.config.hostKeyFingerprint;
    if (expected) {
      if (expected === info.fingerprint) return true;
      this.hostKeyBlocked = true;
      this.send({
        type: "host-key-mismatch",
        expected,
        actual: info.fingerprint,
        keyType: info.keyType,
      });
      this.send({ type: "state", state: "error" });
      return false;
    }

    const challengeId = crypto.randomUUID();
    return new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => {
        if (this.pendingChallenge?.id !== challengeId) return;
        this.pendingChallenge = null;
        resolve(false);
      }, this.challengeTimeoutMs);
      this.pendingChallenge = { id: challengeId, resolve, timer };
      this.send({
        type: "host-key",
        challengeId,
        keyType: info.keyType,
        fingerprint: info.fingerprint,
      });
    });
  }

  private async handleMessage(data: string | undefined): Promise<void> {
    if (this.closed || typeof data !== "string") return;
    if (new TextEncoder().encode(data).byteLength > MAX_RPC_FRAME_BYTES) {
      this.protocolClose(1009, "message too large");
      return;
    }
    let message: unknown;
    try {
      message = JSON.parse(data);
    } catch {
      return;
    }
    if (!isRecord(message) || typeof message.type !== "string") return;

    if (message.type === "host-key-response") {
      const challenge = this.pendingChallenge;
      if (
        challenge &&
        message.challengeId === challenge.id &&
        typeof message.accepted === "boolean"
      ) {
        this.pendingChallenge = null;
        clearTimeout(challenge.timer);
        challenge.resolve(message.accepted);
      }
      return;
    }

    if (message.type === "shell-write" && typeof message.text === "string") {
      if (this.shellHandle !== null) {
        this.engine.shellWrite(this.shellHandle, message.text);
      }
      return;
    }

    if (
      message.type === "shell-resize" &&
      typeof message.cols === "number" &&
      typeof message.rows === "number" &&
      this.shellHandle !== null
    ) {
      this.engine.shellResize(this.shellHandle, message.cols, message.rows);
      return;
    }

    if (message.type === "shell-close") {
      this.closeShell();
      return;
    }

    if (message.type === "disconnect") {
      this.close();
      return;
    }

    if (message.type === "request") {
      const id = message.id;
      if (typeof id !== "string") return;
      if (!this.consumeRequestToken()) {
        this.protocolClose(1008, "request rate exceeded");
        return;
      }
      if (
        this.inFlightRequests.size >= MAX_IN_FLIGHT_REQUESTS ||
        this.inFlightRequests.has(id)
      ) {
        this.send({
          type: "response",
          id,
          ok: false,
          error: "too many requests",
        });
        return;
      }
      this.inFlightRequests.add(id);
      try {
        await this.handleRequest(message);
      } finally {
        this.inFlightRequests.delete(id);
      }
    }
  }

  private consumeRequestToken(): boolean {
    const now = this.now();
    const elapsed = Math.max(0, now - this.lastTokenRefillAt);
    this.lastTokenRefillAt = now;
    this.requestTokens = Math.min(
      REQUEST_BURST,
      this.requestTokens + (elapsed * REQUESTS_PER_SECOND) / 1_000,
    );
    if (this.requestTokens < 1) return false;
    this.requestTokens -= 1;
    return true;
  }

  private async handleRequest(message: Record<string, unknown>): Promise<void> {
    const id = message.id;
    const method = message.method;
    const params = isRecord(message.params) ? message.params : {};
    if (typeof id !== "string" || typeof method !== "string" || this.connId === null) {
      return;
    }

    try {
      let result: unknown;
      if (method === "exec" && typeof params.command === "string") {
        result = await this.engine.exec(this.connId, params.command);
      } else if (
        method === "openShell" &&
        typeof params.cols === "number" &&
        typeof params.rows === "number"
      ) {
        this.closeShell();
        this.shellHandle = await this.engine.openShell(
          this.connId,
          params.cols,
          params.rows,
          (data) => this.send({ type: "shell-data", base64: bytesToBase64(data) }),
        );
        result = { shellId: this.shellHandle };
      } else if (method === "sftpList" && typeof params.path === "string") {
        result = await this.engine.sftpList(this.connId, params.path);
      } else if (method === "sftpStat" && typeof params.path === "string") {
        result = await this.engine.sftpStat(this.connId, params.path);
      } else if (method === "sftpOpenRead" && typeof params.path === "string") {
        const opened = await this.engine.sftpOpenRead(this.connId, params.path);
        this.readHandles.add(opened.handleId);
        result = opened;
      } else if (
        method === "sftpReadChunk" &&
        typeof params.handleId === "number" &&
        this.readHandles.has(params.handleId)
      ) {
        const chunk = await this.engine.sftpReadChunk(
          params.handleId,
          SFTP_CHUNK_BYTES,
        );
        if (chunk.data.byteLength > SFTP_CHUNK_BYTES) {
          throw new Error("SFTP chunk too large");
        }
        result = { base64: bytesToBase64(chunk.data), eof: chunk.eof };
      } else if (
        method === "sftpCloseRead" &&
        typeof params.handleId === "number" &&
        this.readHandles.has(params.handleId)
      ) {
        this.readHandles.delete(params.handleId);
        await this.engine.sftpCloseRead(params.handleId);
        result = null;
      } else if (method === "sftpOpenWrite" && typeof params.path === "string") {
        const handleId = await this.engine.sftpOpenWrite(this.connId, params.path);
        this.writeHandles.add(handleId);
        result = { handleId };
      } else if (
        method === "sftpWriteChunk" &&
        typeof params.handleId === "number" &&
        typeof params.base64 === "string" &&
        this.writeHandles.has(params.handleId)
      ) {
        const bytes = base64ToBytes(params.base64);
        if (bytes.byteLength > SFTP_CHUNK_BYTES) {
          throw new Error("SFTP chunk too large");
        }
        await this.engine.sftpWriteChunk(params.handleId, bytes);
        result = null;
      } else if (
        method === "sftpCloseWrite" &&
        typeof params.handleId === "number" &&
        this.writeHandles.has(params.handleId)
      ) {
        this.writeHandles.delete(params.handleId);
        await this.engine.sftpCloseWrite(params.handleId);
        result = null;
      } else if (method === "sftpMkdir" && typeof params.path === "string") {
        await this.engine.sftpMkdir(this.connId, params.path);
        result = null;
      } else if (method === "sftpRemove" && typeof params.path === "string") {
        await this.engine.sftpRemove(this.connId, params.path);
        result = null;
      } else if (
        method === "sftpRename" &&
        typeof params.from === "string" &&
        typeof params.to === "string"
      ) {
        await this.engine.sftpRename(this.connId, params.from, params.to);
        result = null;
      } else {
        throw new Error("unsupported request");
      }
      this.send({ type: "response", id, ok: true, result });
    } catch {
      this.send({ type: "response", id, ok: false, error: "request failed" });
    }
  }

  private send(message: unknown): void {
    if (this.closed) return;
    const frame = JSON.stringify(message);
    if (new TextEncoder().encode(frame).byteLength > MAX_RPC_FRAME_BYTES) {
      this.protocolClose(1009, "message too large");
      return;
    }
    this.socket.send(frame);
  }

  dispose(): void {
    this.close(false);
  }

  private closeShell(): void {
    if (this.shellHandle === null) return;
    try {
      this.engine.shellClose(this.shellHandle);
    } finally {
      this.shellHandle = null;
    }
  }

  private protocolClose(code: number, reason: string): void {
    this.close(true, code, reason);
  }

  private close(closeSocket = true, code = 1000, reason = "session closed"): void {
    if (this.closed) return;
    this.closed = true;
    const challenge = this.pendingChallenge;
    if (challenge) {
      this.pendingChallenge = null;
      clearTimeout(challenge.timer);
      challenge.resolve(false);
    }
    try {
      this.closeShell();
    } catch {
      // 後續資源仍必須釋放。
    }
    if (this.connId !== null) {
      try {
        this.engine.disconnect(this.connId);
      } catch {
        // transport 仍必須關閉。
      }
      this.connId = null;
    }
    for (const handleId of this.readHandles) {
      void this.engine.sftpCloseRead(handleId).catch(() => undefined);
    }
    this.readHandles.clear();
    for (const handleId of this.writeHandles) {
      void this.engine.sftpCloseWrite(handleId).catch(() => undefined);
    }
    this.writeHandles.clear();
    this.transport.close();
    if (closeSocket) {
      try {
        this.socket.close(code, reason);
      } catch {
        // WebSocket 可能已由另一端關閉。
      }
    }
    this.resolveClosed();
  }
}
