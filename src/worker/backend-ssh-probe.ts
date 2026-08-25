import type { BackendSshEngine } from "./backend-ssh-runtime";

export interface BackendSshProbeTransport {
  close(): void;
}

export interface BackendSshProbeConfig {
  host: string;
  port: number;
  username: string;
  password: string;
}

export interface BackendSshProbeOptions {
  timeoutMs?: number;
  probeId?: string;
}

export interface BackendSshProbeResult {
  hostKey: { keyType: string; fingerprint: string };
  exec: { exitCode: number; stdoutIncludesUbuntu: boolean };
  shellEcho: boolean;
  sftp: { listed: boolean; readBack: boolean; cleaned: boolean };
}

const DEFAULT_TIMEOUT_MS = 5_000;

async function waitFor(
  predicate: () => boolean,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("後端 SSH shell 回顯逾時");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

export async function runBackendSshProbe(
  engine: BackendSshEngine,
  transport: BackendSshProbeTransport,
  config: BackendSshProbeConfig,
  options: BackendSshProbeOptions = {},
): Promise<BackendSshProbeResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const probeId = options.probeId ?? crypto.randomUUID();
  const directory = `/tmp/worker-ssh-probe-${probeId}`;
  const sourcePath = `${directory}/probe.txt`;
  const renamedPath = `${directory}/probe-renamed.txt`;
  const payload = new TextEncoder().encode("probe-ok");
  const shellToken = `worker-ssh-shell-${probeId}`;
  let hostKey: BackendSshProbeResult["hostKey"] | undefined;
  let connId: number | undefined;
  let shellId: number | undefined;
  let shellOutput = "";
  let createdDirectory = false;
  let createdFile = false;
  let cleaned = false;

  try {
    connId = await engine.connect({
      host: config.host,
      port: config.port,
      username: config.username,
      authType: "password",
      password: config.password,
      privateKey: "",
      passphrase: "",
      transport,
      verifyHostKey: async (info: {
        keyType: string;
        fingerprint: string;
      }) => {
        hostKey = {
          keyType: info.keyType,
          fingerprint: info.fingerprint,
        };
        return true;
      },
    });
    if (!hostKey) throw new Error("後端 SSH 未執行 host key 驗證");

    const execResult = await engine.exec(connId, "cat /etc/os-release");
    shellId = await engine.openShell(connId, 80, 24, (data) => {
      shellOutput += new TextDecoder().decode(data, { stream: true });
    });
    engine.shellWrite(shellId, `${shellToken}\n`);
    await waitFor(() => shellOutput.includes(shellToken), timeoutMs);

    await engine.sftpMkdir(connId, directory);
    createdDirectory = true;
    await engine.sftpWriteFile(connId, sourcePath, payload);
    createdFile = true;
    const readBack = await engine.sftpReadFile(connId, sourcePath);
    await engine.sftpRename(connId, sourcePath, renamedPath);
    const entries = await engine.sftpList(connId, directory);

    await engine.sftpRemove(connId, renamedPath);
    createdFile = false;
    await engine.sftpRemove(connId, directory);
    createdDirectory = false;
    cleaned = true;

    return {
      hostKey,
      exec: {
        exitCode: execResult.exitCode,
        stdoutIncludesUbuntu: execResult.stdout.includes("Ubuntu"),
      },
      shellEcho: shellOutput.includes(shellToken),
      sftp: {
        listed: entries.some((entry) => entry.name === "probe-renamed.txt"),
        readBack: new TextDecoder().decode(readBack) === "probe-ok",
        cleaned,
      },
    };
  } finally {
    if (shellId !== undefined) engine.shellClose(shellId);
    if (connId !== undefined) {
      if (createdFile) {
        await engine.sftpRemove(connId, renamedPath).catch(() =>
          engine.sftpRemove(connId!, sourcePath).catch(() => undefined),
        );
      }
      if (createdDirectory) {
        await engine.sftpRemove(connId, directory).catch(() => undefined);
      }
      engine.disconnect(connId);
    } else {
      transport.close();
    }
  }
}
