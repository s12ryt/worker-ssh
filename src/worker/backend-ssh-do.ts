import { connect } from "cloudflare:sockets";
import { DurableObject } from "cloudflare:workers";
// 由 scripts/build-go.mjs 產生；載入後會在 globalThis 註冊 Go runtime。
import "../../dist/worker/wasm_exec.js";
import sshWasm from "../../dist/worker/ssh.wasm";
import type { ConnectionConfig } from "../shared/types";
import { runBackendSshProbe } from "./backend-ssh-probe";
import { BackendSshSession } from "./backend-ssh-session";
import {
  BackendSshRuntime,
  type GoRuntimeLike,
} from "./backend-ssh-runtime";
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

export const SESSION_INIT_TTL_MS = 10_000;

export class OneTimeSessionInit<T> {
  private value: { nonce: string; data: T } | null = null;
  private expiryTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly nonceFactory: () => string;

  constructor(options: { nonceFactory?: () => string } = {}) {
    this.nonceFactory = options.nonceFactory ?? (() => crypto.randomUUID());
  }

  initialize(data: T): string {
    this.clear();
    const nonce = this.nonceFactory();
    this.value = { nonce, data };
    this.expiryTimer = setTimeout(() => {
      if (this.value?.nonce === nonce) this.clear();
    }, SESSION_INIT_TTL_MS);
    return nonce;
  }

  consume(nonce: string): T | null {
    if (!this.value || this.value.nonce !== nonce) return null;
    const data = this.value.data;
    this.clear();
    return data;
  }

  private clear(): void {
    if (this.expiryTimer) clearTimeout(this.expiryTimer);
    this.expiryTimer = null;
    this.value = null;
  }
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
  if (config.authType === "password") return nonEmptyString(config.password);
  if (config.authType === "privateKey") return nonEmptyString(config.privateKey);
  return false;
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
  private readonly pendingInit = new OneTimeSessionInit<PendingSessionInit>();

  override async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname === "/init") return this.initialize(req);
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
        { hostname: probe.host, port: probe.port },
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

  private async initialize(req: Request): Promise<Response> {
    if (req.method !== "POST") {
      return json({ error: "method not allowed" }, 405);
    }
    let input: unknown;
    try {
      input = await req.json();
    } catch {
      return json({ error: "invalid session config" }, 400);
    }
    if (!isBackendSessionInit(input)) {
      return json({ error: "invalid session config" }, 400);
    }
    return json({ nonce: this.pendingInit.initialize(input) });
  }

  private connectSession(req: Request): Response {
    if (req.method !== "GET") {
      return json({ error: "method not allowed" }, 405);
    }
    if (req.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return json({ error: "websocket upgrade required" }, 426);
    }

    const nonce = new URL(req.url).searchParams.get("nonce") ?? "";
    const pending = this.pendingInit.consume(nonce);
    if (!pending) return json({ error: "session not initialized" }, 409);
    const { config, quota } = pending;
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    server.accept();

    this.ctx.waitUntil(
      (async () => {
        let transport: WorkerTcpTransport | null = null;
        let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
        try {
          transport = new WorkerTcpTransport(
            connect(
              { hostname: config.host, port: config.port },
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
