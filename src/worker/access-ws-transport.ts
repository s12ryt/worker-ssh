import type { AccessProxyConfig } from "../shared/types";

/**
 * Cloudflare Access WebSocket transport：
 * 以 fetch WebSocket 升級連到 https://<hostname>/，
 * 重現 cloudflared access ssh 的通道（原始 SSH TCP bytes 走 WS binary frame）。
 * 實作 Go NewWsConn 所需 transport 介面：
 * onOpen / onData / onClosed / send / closeError / disposeCallbacks / close。
 */

export interface AccessWebSocketTransportOptions {
  fetcher?: typeof fetch;
  maxBufferedReadBytes?: number;
}

const DEFAULT_MAX_BUFFERED_READ_BYTES = 4 * 1024 * 1024;

/** 正常關閉碼：1000（正常）與 1005（無狀態碼）視為乾淨 EOF */
function isCleanCloseCode(code: number): boolean {
  return code === 1000 || code === 1005;
}

export class AccessWebSocketTransport {
  private ws: WebSocket | null = null;
  private readonly fetcher: typeof fetch;
  private readonly maxBufferedReadBytes: number;
  private readonly bufferedReads: Uint8Array[] = [];
  private bufferedReadBytes = 0;
  private openedFlag = false;
  private closedFlag = false;
  private disposed = false;
  private closeNotified = false;
  private errorMessage: string | null = null;
  private openCallback: (() => void) | null = null;
  private dataCallback: ((data: Uint8Array) => void) | null = null;
  private closedCallback: (() => void) | null = null;

  constructor(
    private readonly proxy: AccessProxyConfig,
    options: AccessWebSocketTransportOptions = {},
  ) {
    this.fetcher = options.fetcher ?? fetch;
    this.maxBufferedReadBytes =
      options.maxBufferedReadBytes ?? DEFAULT_MAX_BUFFERED_READ_BYTES;
    void this.open();
  }

  onData(callback: (data: Uint8Array) => void): void {
    if (this.disposed) return;
    this.dataCallback = callback;
    for (const data of this.bufferedReads.splice(0)) callback(data);
    this.bufferedReadBytes = 0;
  }

  onOpen(callback: () => void): void {
    if (this.disposed) return;
    this.openCallback = callback;
    if (this.openedFlag) callback();
  }

  onClosed(callback: () => void): void {
    if (this.disposed) return;
    this.closedCallback = callback;
    if (this.closedFlag) callback();
  }

  disposeCallbacks(): void {
    this.disposed = true;
    this.openCallback = null;
    this.dataCallback = null;
    this.closedCallback = null;
    this.bufferedReads.length = 0;
    this.bufferedReadBytes = 0;
  }

  closeError(): string | null {
    return this.errorMessage;
  }

  send(data: Uint8Array): void {
    if (this.closedFlag || !this.ws) return;
    try {
      this.ws.send(new Uint8Array(data));
    } catch (error) {
      this.fail(this.messageOf(error, "Access WebSocket 寫入失敗"));
    }
  }

  close(): void {
    if (this.closedFlag) return;
    this.closedFlag = true;
    this.bufferedReads.length = 0;
    this.bufferedReadBytes = 0;
    this.closeWebSocket();
    this.notifyClosed();
  }

  private async open(): Promise<void> {
    const headers: Record<string, string> = { Upgrade: "websocket" };
    if (this.proxy.clientId) {
      headers["CF-Access-Client-Id"] = this.proxy.clientId;
    }
    if (this.proxy.clientSecret) {
      headers["CF-Access-Client-Secret"] = this.proxy.clientSecret;
    }
    if (this.proxy.destination) {
      headers["Cf-Access-Jump-Destination"] = this.proxy.destination;
    }

    let response: Response;
    try {
      response = await this.fetcher(`https://${this.proxy.hostname}/`, {
        headers,
      });
    } catch (error) {
      this.fail(this.messageOf(error, "Access WebSocket 連線失敗"));
      return;
    }

    const ws = response.webSocket;
    if (!ws) {
      this.fail(`Access WebSocket 連線失敗：HTTP ${response.status}`);
      return;
    }

    this.ws = ws;
    ws.binaryType = "arraybuffer";
    ws.accept();
    ws.addEventListener("message", (event: MessageEvent) => {
      this.handleMessage(event.data);
    });
    ws.addEventListener("close", (event: CloseEvent) => {
      this.handleClose(event.code, event.reason);
    });
    ws.addEventListener("error", () => {
      this.fail("Access WebSocket 連線錯誤");
    });

    if (this.closedFlag) {
      this.closeWebSocket();
      return;
    }
    this.openedFlag = true;
    if (!this.disposed) this.openCallback?.();
  }

  private handleMessage(data: unknown): void {
    if (this.closedFlag || this.disposed) return;
    const bytes = new Uint8Array(data as ArrayBuffer);
    if (this.dataCallback) {
      this.dataCallback(bytes);
      return;
    }
    if (this.bufferedReadBytes + bytes.byteLength > this.maxBufferedReadBytes) {
      this.fail(
        `Access WebSocket 讀取緩衝上限為 ${this.maxBufferedReadBytes} 位元組`,
      );
      return;
    }
    this.bufferedReads.push(bytes);
    this.bufferedReadBytes += bytes.byteLength;
  }

  private handleClose(code: number, reason: string): void {
    if (this.closedFlag) return;
    this.closedFlag = true;
    if (!isCleanCloseCode(code)) {
      this.errorMessage = `Access WebSocket 關閉（code ${code}${reason ? `：${reason}` : ""}）`;
    }
    this.notifyClosed();
  }

  private fail(message: string): void {
    if (this.errorMessage === null) this.errorMessage = message;
    if (!this.closedFlag) {
      this.closedFlag = true;
      this.bufferedReads.length = 0;
      this.bufferedReadBytes = 0;
      this.closeWebSocket();
    }
    this.notifyClosed();
  }

  private closeWebSocket(): void {
    const ws = this.ws;
    this.ws = null;
    try {
      ws?.close();
    } catch {
      // WS 可能已關閉。
    }
  }

  private notifyClosed(): void {
    if (this.closeNotified) return;
    this.closeNotified = true;
    if (!this.disposed) this.closedCallback?.();
  }

  private messageOf(error: unknown, fallback: string): string {
    return error instanceof Error && error.message
      ? `${fallback}：${error.message}`
      : fallback;
  }
}
