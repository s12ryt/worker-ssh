import type { BackendReconnectState } from "./backend-ssh-client";

interface ReconnectTerminal {
  term: {
    cols: number;
    rows: number;
    options: { disableStdin?: boolean };
    write(data: string | Uint8Array): void;
    focus(): void;
  };
}

interface ReconnectClient {
  openShell(
    connId: number,
    cols: number,
    rows: number,
    onData: (data: Uint8Array) => void,
  ): Promise<number>;
  shellResize(connId: number, cols: number, rows: number): void;
}

interface ReconnectPoller {
  start(): void;
  stop(): void;
}

interface ReconnectSftpPanel {
  getCurrentPath(): string;
  open(path?: string): Promise<void>;
}

interface SessionReconnectDependencies {
  connId: number;
  client: ReconnectClient;
  terminal: ReconnectTerminal;
  poller: ReconnectPoller;
  sftp: ReconnectSftpPanel;
  setStatus(state: "connecting" | "open" | "closed" | "error"): void;
  onError(error: unknown): void;
}

function writeNotice(terminal: ReconnectTerminal, message: string): void {
  terminal.term.write(`\r\n\x1b[33m--- ${message} ---\x1b[0m\r\n`);
}

export async function handleSessionReconnect(
  state: BackendReconnectState,
  dependencies: SessionReconnectDependencies,
): Promise<void> {
  const { client, connId, onError, poller, setStatus, sftp, terminal } = dependencies;

  if (state.state === "reconnecting") {
    poller.stop();
    terminal.term.options.disableStdin = true;
    setStatus("connecting");
    writeNotice(
      terminal,
      `連線中斷，${state.delayMs / 1_000} 秒後進行第 ${state.attempt} 次重新連線；期間輸入不會送出`,
    );
    return;
  }

  if (state.state === "failed") {
    poller.stop();
    terminal.term.options.disableStdin = true;
    setStatus("error");
    writeNotice(terminal, "自動重新連線失敗，請返回連線列表後手動重試");
    return;
  }

  try {
    const path = sftp.getCurrentPath();
    await client.openShell(connId, terminal.term.cols, terminal.term.rows, (data) =>
      terminal.term.write(data),
    );
    client.shellResize(connId, terminal.term.cols, terminal.term.rows);
    await sftp.open(path);
    terminal.term.options.disableStdin = false;
    writeNotice(terminal, `第 ${state.attempt} 次重新連線成功，已建立新的 SSH shell`);
    poller.start();
    setStatus("open");
    terminal.term.focus();
  } catch (error) {
    terminal.term.options.disableStdin = true;
    poller.stop();
    setStatus("error");
    onError(error);
  }
}
