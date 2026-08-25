import { connect } from "cloudflare:sockets";
import { DurableObject } from "cloudflare:workers";
// 由 scripts/build-go.mjs 產生；載入後會在 globalThis 註冊 Go runtime。
import "../../dist/worker/wasm_exec.js";
import sshWasm from "../../dist/worker/ssh.wasm";
import type { ConnectionConfig } from "../shared/types";
import { AccessWebSocketTransport } from "./access-ws-transport";
import { runBackendSshProbe } from "./backend-ssh-probe";
import { BackendSshSession } from "./backend-ssh-session";
import {
  BackendSshRuntime,
  type GoRuntimeLike,
} from "./backend-ssh-runtime";
import { normalizeSshHostname } from "./ssh-host";
import { decodeSessionConfigHeader } from "./ssh-session-init";
import { WorkerTcpTransport } from "./worker-tcp-transport";

export interface SshSessionEnv {
  BACKEND_SSH_PROBE_PASSWORD?: string;
  SSH_QUOTA: DurableObjectNamespace;
}

export interface SshQuotaLeaseRef {
  sessionKey: string;
  leaseId: string;
}

interface PendingSessionInit {
  config: ConnectionConfig;
  quota: SshQuotaLeaseRef;
}

interface ProbeRequest {
  host: string;
  port: number;
  username: string;
}

interface GoRuntimeRegistry {
  Go?: new () => GoRuntimeLike;
  sshEngine?: unknown;
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

interface SshOptionShape {
  key: string;
  value: string;
}

interface AccessProxyShape {
  hostname: string;
  destination?: string;
  clientId?: string;
  clientSecret?: string;
}

function isSshOptionShape(value: unknown): value is SshOptionShape {
  if (typeof value !== "object" || value === null) return false;
  const option = value as Record<string, unknown>;
  return nonEmptyString(option.key) && typeof option.value === "string";
}

function isAccessProxyShape(value: unknown): value is AccessProxyShape {
  if (typeof value !== "object" || value === null) return false;
  const proxy = value as Record<string, unknown>;
  if (!nonEmptyString(proxy.hostname)) return false;
  if (
    proxy.destination !== undefined &&
    !nonEmptyString(proxy.destination)
  ) {
    return false;
  }
  if (proxy.clientId !== undefined && !nonEmptyString(proxy.clientId)) {
    return false;
  }
  if (
    proxy.clientSecret !== undefined &&
    typeof proxy.clientSecret !== "string"
  ) {
    return false;
  }
  // DO 連線需要 clientSecret；clientId 已設定時 secret 不可為空字串
  if (proxy.clientId !== undefined && proxy.clientSecret === "") {
    return false;
  }
  return true;
}

export function isBackendConnectionConfig(
  value: unknown,
): value is ConnectionConfig {
  if (typeof value !== "object" || value === null) return false;
  const config = value as Record<string, unknown>;
  if (
    !nonEmptyString(config.id) ||
    !nonEmptyString(config.name) ||
    !nonEmptyString(config.host) ||
    !nonEmptyString(config.username) ||
    typeof config.port !== "number" ||
    !Number.isInteger(config.port) ||
    config.port < 1 ||
    config.port > 65535 ||
    typeof config.createdAt !== "number" ||
    typeof config.updatedAt !== "number"
  ) {
    return false;
  }
  if (config.authType === "password") {
    if (!nonEmptyString(config.password)) return false;
  } else if (config.authType === "privateKey") {
    if (!nonEmptyString(config.privateKey)) return false;
  } else {
    return false;
  }
  if (
    config.sshOptions !== undefined &&
    config.sshOptions !== null &&
    (!Array.isArray(config.sshOptions) ||
      !config.sshOptions.every(isSshOptionShape))
  ) {
    return false;
  }
  if (
    config.accessProxy !== undefined &&
    config.accessProxy !== null &&
    !isAccessProxyShape(config.accessProxy)
  ) {
    return false;
  }
  return true;
}

export function isBackendSessionInit(value: unknown): value is PendingSessionInit {
  if (typeof value !== "object" || value === null) return false;
  const input = value as Record<string, unknown>;
  const quota = input.quota;
  return (
    isBackendConnectionConfig(input.config) &&
    typeof quota === "object" &&
    quota !== null &&
    nonEmptyString((quota as Record<string, unknown>).sessionKey) &&
    nonEmptyString((quota as Record<string, unknown>).leaseId)
  );
}

/** 從 X-Session-Config header 解出 session init；缺失或非法回 null。 */
export function parseSessionConfigHeader(
  header: string | null,
): PendingSessionInit | null {
  if (!header) return null;
  const payload = decodeSessionConfigHeader<unknown>(header);
  return payload !== null && isBackendSessionInit(payload) ? payload : null;
}

const registry = globalThis as unknown as GoRuntimeRegistry;
const runtime = new BackendSshRuntime({
  module: sshWasm,
  registry,
  createGo: () => {
    if (!registry.Go) throw new Error("Go WASM runtime 未載入");
    return new registry.Go();
  },
  instantiate: (module, imports) => WebAssembly.instantiate(module, imports),
});

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

async function readProbeRequest(req: Request): Promise<ProbeRequest | null> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return null;
  }
  if (typeof body !== "object" || body === null) return null;
  const value = body as Record<string, unknown>;
  if (
    typeof value.host !== "string" ||
    typeof value.port !== "number" ||
    !Number.isInteger(value.port) ||
    typeof value.username !== "string"
  ) {
    return null;
  }
  return {
    host: value.host,
    port: value.port,
    username: value.username,
  };
}

export class SshSessionObject extends DurableObject<SshSessionEnv> {
  override async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname === "/connect") return this.connectSession(req);
    if (url.pathname !== "/probe") return json({ error: "not found" }, 404);
    if (req.method !== "POST") {
      return json({ error: "method not allowed" }, 405);
    }
    if (!this.env.BACKEND_SSH_PROBE_PASSWORD) {
      return json({ error: "backend SSH probe unavailable" }, 503);
    }

    const probe = await readProbeRequest(req);
    if (
      !probe ||
      probe.host !== "127.0.0.1" ||
      probe.port !== 2222 ||
      probe.username !== "tester"
    ) {
      return json({ error: "invalid probe target" }, 400);
    }

    const transport = new WorkerTcpTransport(
      connect(
        { hostname: normalizeSshHostname(probe.host), port: probe.port },
        { allowHalfOpen: false },
      ),
    );
    try {
      const engine = await runtime.load();
      const result = await runBackendSshProbe(engine, transport, {
        ...probe,
        password: this.env.BACKEND_SSH_PROBE_PASSWORD,
      });
      return json(result);
    } catch {
      transport.close();
      return json({ error: "backend SSH probe failed" }, 502);
    }
  }

  private connectSession(req: Request): Response {
    if (req.method !== "GET") {
      return json({ error: "method not allowed" }, 405);
    }
    if (req.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return json({ error: "websocket upgrade required" }, 426);
    }

    const pending = parseSessionConfigHeader(
      req.headers.get("X-Session-Config"),
    );
    if (!pending) return json({ error: "invalid session config" }, 400);
    const { config, quota } = pending;
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    server.accept();

    this.ctx.waitUntil(
      (async () => {
        let transport: WorkerTcpTransport | AccessWebSocketTransport | null =
          null;
        let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
        try {
          transport = config.accessProxy
            ? new AccessWebSocketTransport(config.accessProxy)
            : new WorkerTcpTransport(
                connect(
                  {
                    hostname: normalizeSshHostname(config.host),
                    port: config.port,
                  },
                  { allowHalfOpen: false },
                ),
              );
          const engine = await runtime.load();
          const session = new BackendSshSession({
            engine,
            socket: server as unknown as {
              send(data: string): void;
              close(): void;
              addEventListener(
                type: string,
                listener: (event: { data?: string }) => void,
              ): void;
            },
            transport,
            config,
          });
          await session.start();
          const quotaStub = this.env.SSH_QUOTA.getByName("global-ssh-quota");
          heartbeatTimer = setInterval(() => {
            void quotaStub
              .fetch("https://ssh-quota.internal/heartbeat", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(quota),
              })
              .then(async (response) => {
                const result = (await response.json()) as { ok?: boolean };
                if (!result.ok) session.terminate(1013, "SSH quota lease expired");
              })
              .catch(() => session.terminate(1013, "SSH quota unavailable"));
          }, 10_000);
          await session.waitUntilClosed();
        } catch {
          transport?.close();
          try {
            server.send(JSON.stringify({ type: "state", state: "error" }));
            server.close(1011, "backend SSH failed");
          } catch {
            // WebSocket 可能已由瀏覽器關閉。
          }
        } finally {
          if (heartbeatTimer) clearInterval(heartbeatTimer);
          const quotaStub = this.env.SSH_QUOTA.getByName("global-ssh-quota");
          await quotaStub
            .fetch("https://ssh-quota.internal/release", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(quota),
            })
            .catch(() => undefined);
        }
      })(),
    );
    return new Response(null, { status: 101, webSocket: client });
  }
}
