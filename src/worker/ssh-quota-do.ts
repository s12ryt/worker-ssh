import { DurableObject } from "cloudflare:workers";
import { SshSessionQuota } from "./ssh-session-quota";

interface QuotaRequest {
  sessionKey: string;
  leaseId: string;
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

async function readQuotaRequest(req: Request): Promise<QuotaRequest | null> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return null;
  }
  if (typeof body !== "object" || body === null) return null;
  const value = body as Record<string, unknown>;
  if (
    typeof value.sessionKey !== "string" ||
    !value.sessionKey ||
    typeof value.leaseId !== "string" ||
    !value.leaseId
  ) {
    return null;
  }
  return { sessionKey: value.sessionKey, leaseId: value.leaseId };
}

export class SshQuotaObject extends DurableObject {
  override async fetch(req: Request): Promise<Response> {
    if (req.method !== "POST") {
      return json({ error: "method not allowed" }, 405);
    }
    const input = await readQuotaRequest(req);
    if (!input) return json({ error: "invalid quota request" }, 400);

    const quota = new SshSessionQuota(this.ctx.storage);
    const path = new URL(req.url).pathname;
    if (path === "/acquire") {
      const result = await quota.acquire(input.sessionKey, input.leaseId);
      return result.granted
        ? json(result)
        : json(result, 429);
    }
    if (path === "/heartbeat") {
      return json({ ok: await quota.heartbeat(input.sessionKey, input.leaseId) });
    }
    if (path === "/release") {
      return json({ ok: await quota.release(input.sessionKey, input.leaseId) });
    }
    return json({ error: "not found" }, 404);
  }
}
