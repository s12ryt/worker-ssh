export interface BackendSshEngine {
  connect(config: Record<string, unknown>): Promise<number>;
  disconnect(connId: number): void;
  exec(
    connId: number,
    command: string,
  ): Promise<{ stdout: string; stderr: string; exitCode: number }>;
  openShell(
    connId: number,
    cols: number,
    rows: number,
    onData: (data: Uint8Array) => void,
  ): Promise<number>;
  shellWrite(handleId: number, text: string): unknown;
  shellResize(handleId: number, cols: number, rows: number): unknown;
  shellClose(handleId: number): unknown;
  sftpList(
    connId: number,
    path: string,
  ): Promise<Array<{ name: string; size: number; isDir: boolean }>>;
  sftpStat(connId: number, path: string): Promise<unknown>;
  sftpReadFile(connId: number, path: string): Promise<Uint8Array>;
  sftpWriteFile(
    connId: number,
    path: string,
    data: Uint8Array,
  ): Promise<unknown>;
  sftpOpenRead(
    connId: number,
    path: string,
  ): Promise<{ handleId: number; size: number }>;
  sftpReadChunk(
    handleId: number,
    maxBytes: number,
  ): Promise<{ data: Uint8Array; eof: boolean }>;
  sftpCloseRead(handleId: number): Promise<unknown>;
  sftpOpenWrite(connId: number, path: string): Promise<number>;
  sftpWriteChunk(handleId: number, data: Uint8Array): Promise<unknown>;
  sftpCloseWrite(handleId: number): Promise<unknown>;
  sftpMkdir(connId: number, path: string): Promise<unknown>;
  sftpRemove(connId: number, path: string): Promise<unknown>;
  sftpRename(connId: number, from: string, to: string): Promise<unknown>;
}

export interface GoRuntimeLike {
  importObject: WebAssembly.Imports;
  run(instance: WebAssembly.Instance): Promise<void> | void;
}

export interface BackendSshRuntimeOptions {
  module: WebAssembly.Module;
  registry: { sshEngine?: unknown };
  createGo: () => GoRuntimeLike;
  instantiate: (
    module: WebAssembly.Module,
    imports: WebAssembly.Imports,
  ) => Promise<
    WebAssembly.Instance | { instance: WebAssembly.Instance }
  >;
  pollIntervalMs?: number;
  timeoutMs?: number;
}

const DEFAULT_POLL_INTERVAL_MS = 10;
const DEFAULT_TIMEOUT_MS = 10_000;

function isBackendSshEngine(value: unknown): value is BackendSshEngine {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { connect?: unknown }).connect === "function"
  );
}

export class BackendSshRuntime {
  private readonly options: BackendSshRuntimeOptions;
  private loadPromise: Promise<BackendSshEngine> | null = null;

  constructor(options: BackendSshRuntimeOptions) {
    this.options = options;
  }

  load(): Promise<BackendSshEngine> {
    const registered = this.options.registry.sshEngine;
    if (isBackendSshEngine(registered)) return Promise.resolve(registered);
    if (this.loadPromise) return this.loadPromise;

    const attempt = this.start();
    this.loadPromise = attempt.catch((error: unknown) => {
      this.loadPromise = null;
      throw error;
    });
    return this.loadPromise;
  }

  private async start(): Promise<BackendSshEngine> {
    const go = this.options.createGo();
    const instantiated = await this.options.instantiate(
      this.options.module,
      go.importObject,
    );
    const instance =
      typeof instantiated === "object" &&
      instantiated !== null &&
      "instance" in instantiated
        ? instantiated.instance
        : instantiated;
    const runPromise = Promise.resolve().then(() => go.run(instance));
    void runPromise.catch(() => undefined);
    return this.waitForEngine(runPromise);
  }

  private async waitForEngine(
    runPromise: Promise<void>,
  ): Promise<BackendSshEngine> {
    const pollIntervalMs =
      this.options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    const timeoutMs = this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const deadline = Date.now() + timeoutMs;

    while (Date.now() <= deadline) {
      const registered = this.options.registry.sshEngine;
      if (isBackendSshEngine(registered)) return registered;

      const runState = await Promise.race([
        runPromise.then(
          () => ({ state: "stopped" as const }),
          (error: unknown) => ({ state: "failed" as const, error }),
        ),
        new Promise<{ state: "waiting" }>((resolve) => {
          setTimeout(() => resolve({ state: "waiting" }), pollIntervalMs);
        }),
      ]);
      if (runState.state === "failed") throw runState.error;
      if (runState.state === "stopped") {
        throw new Error("Go WASM 已停止，SSH 引擎未完成註冊");
      }
    }

    throw new Error("後端 SSH 引擎初始化逾時");
  }
}
