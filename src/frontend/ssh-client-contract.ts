export interface SftpEntryLike {
  name: string;
  size: number;
  isDir: boolean;
  mode: number;
  modTime: string;
}

export interface ExecResultLike {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/** 終端、監控與 SFTP 共用的 SSH client 能力，不綁定瀏覽器或後端傳輸。 */
export interface SshClientLike {
  exec(connId: number, command: string): Promise<ExecResultLike>;
  openShell(
    connId: number,
    cols: number,
    rows: number,
    onData: (data: Uint8Array) => void,
  ): Promise<number>;
  shellWrite(connId: number, text: string): void;
  shellResize(connId: number, cols: number, rows: number): void;
  shellClose(connId: number): void;
  list(connId: number, path: string): Promise<SftpEntryLike[]>;
  stat(connId: number, path: string): Promise<SftpEntryLike>;
  readFile(connId: number, path: string): Promise<Uint8Array>;
  writeFile(connId: number, path: string, data: Uint8Array): Promise<void>;
  mkdir(connId: number, path: string): Promise<void>;
  remove(connId: number, path: string): Promise<void>;
  rename(connId: number, from: string, to: string): Promise<void>;
  disconnect(connId: number): void;
  setReconnectPolicy?(enabled: boolean, attempts: number): void;
  close?(): void;
}
