export interface WorkerSocketLike {
  opened: Promise<unknown>;
  readable: ReadableStream<Uint8Array>;
  writable: WritableStream<Uint8Array>;
  close(): Promise<void> | void;
}

export interface WorkerTcpTransportOptions {
  maxQueuedBytes?: number;
  maxBufferedReadBytes?: number;
}

const DEFAULT_MAX_QUEUED_BYTES = 4 * 1024 * 1024;
const DEFAULT_MAX_BUFFERED_READ_BYTES = 4 * 1024 * 1024;

export class WorkerTcpTransport {
  private readonly socket: WorkerSocketLike;
  private readonly writer: WritableStreamDefaultWriter<Uint8Array>;
  private readonly maxQueuedBytes: number;
  private readonly maxBufferedReadBytes: number;
  private readonly writeQueue: Uint8Array[] = [];
  private readonly bufferedReads: Uint8Array[] = [];
  private queuedBytes = 0;
  private bufferedReadBytes = 0;
  private openedFlag = false;
  private closedFlag = false;
  private disposed = false;
  private writing = false;
  private closeNotified = false;
  private errorMessage: string | null = null;
  private openCallback: (() => void) | null = null;
  private dataCallback: ((data: Uint8Array) => void) | null = null;
  private closedCallback: (() => void) | null = null;
  private readonly openedTask: Promise<void>;
  private readonly readTask: Promise<void>;
  private writeTask: Promise<void> = Promise.resolve();

  constructor(
    socket: WorkerSocketLike,
    options: WorkerTcpTransportOptions = {},
  ) {
    this.socket = socket;
    this.writer = socket.writable.getWriter();
    this.maxQueuedBytes =
      options.maxQueuedBytes ?? DEFAULT_MAX_QUEUED_BYTES;
    this.maxBufferedReadBytes =
      options.maxBufferedReadBytes ?? DEFAULT_MAX_BUFFERED_READ_BYTES;
    this.openedTask = this.watchOpened();
    this.readTask = this.readAll();
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
    if (this.closedFlag) return;
    const copy = new Uint8Array(data);
    if (this.queuedBytes + copy.byteLength > this.maxQueuedBytes) {
      this.fail(`TCP 寫入佇列上限為 ${this.maxQueuedBytes} 位元組`);
      return;
    }
    this.writeQueue.push(copy);
    this.queuedBytes += copy.byteLength;
    this.scheduleWrites();
  }

  close(): void {
    if (this.closedFlag) return;
    this.closedFlag = true;
    this.writeQueue.length = 0;
    this.queuedBytes = 0;
    this.bufferedReads.length = 0;
    this.bufferedReadBytes = 0;
    void Promise.resolve(this.socket.close()).catch(() => undefined);
    this.notifyClosed();
  }

  async settled(): Promise<void> {
    await Promise.all([
      this.openedTask.catch(() => undefined),
      this.readTask.catch(() => undefined),
      this.writeTask.catch(() => undefined),
    ]);
  }

  private async watchOpened(): Promise<void> {
    try {
      await this.socket.opened;
      if (this.closedFlag) return;
      this.openedFlag = true;
      if (!this.disposed) this.openCallback?.();
      this.scheduleWrites();
    } catch (error) {
      this.fail(this.messageOf(error, "TCP 連線失敗"));
    }
  }

  private async readAll(): Promise<void> {
    const reader = this.socket.readable.getReader();
    try {
      while (!this.closedFlag) {
        const { done, value } = await reader.read();
        if (done) break;
        const copy = new Uint8Array(value);
        if (this.disposed) continue;
        if (this.dataCallback) this.dataCallback(copy);
        else {
          if (
            this.bufferedReadBytes + copy.byteLength >
            this.maxBufferedReadBytes
          ) {
            this.fail(
              `TCP 讀取緩衝上限為 ${this.maxBufferedReadBytes} 位元組`,
            );
            break;
          }
          this.bufferedReads.push(copy);
          this.bufferedReadBytes += copy.byteLength;
        }
      }
      if (!this.closedFlag) {
        this.closedFlag = true;
        this.notifyClosed();
      }
    } catch (error) {
      this.fail(this.messageOf(error, "TCP 讀取失敗"));
    } finally {
      reader.releaseLock();
    }
  }

  private scheduleWrites(): void {
    if (this.writing || !this.openedFlag || this.closedFlag) return;
    this.writing = true;
    this.writeTask = this.flushWrites().finally(() => {
      this.writing = false;
      if (this.writeQueue.length > 0 && !this.closedFlag) {
        this.scheduleWrites();
      }
    });
    void this.writeTask.catch(() => undefined);
  }

  private async flushWrites(): Promise<void> {
    try {
      while (this.writeQueue.length > 0 && !this.closedFlag) {
        const chunk = this.writeQueue.shift();
        if (!chunk) continue;
        await this.writer.write(chunk);
        this.queuedBytes -= chunk.byteLength;
      }
    } catch (error) {
      this.fail(this.messageOf(error, "TCP 寫入失敗"));
    }
  }

  private fail(message: string): void {
    if (this.errorMessage === null) this.errorMessage = message;
    if (!this.closedFlag) {
      this.closedFlag = true;
      this.writeQueue.length = 0;
      this.queuedBytes = 0;
      this.bufferedReads.length = 0;
      this.bufferedReadBytes = 0;
      void Promise.resolve(this.socket.close()).catch(() => undefined);
    }
    this.notifyClosed();
  }

  private notifyClosed(): void {
    if (this.closeNotified) return;
    this.closeNotified = true;
    if (!this.disposed) this.closedCallback?.();
  }

  private messageOf(error: unknown, fallback: string): string {
    return error instanceof Error && error.message ? error.message : fallback;
  }
}
