const FAILURE_LIMIT = 5;
const WINDOW_MS = 15 * 60 * 1000;
const KEY_PREFIX = "auth:login-fail:";
const FALLBACK_SOURCE = "unknown-source";

interface FailureState {
  count: number;
  resetAt: number;
}

export interface RateLimitStatus {
  limited: boolean;
  retryAfterSeconds: number;
}

export function loginSourceOf(req: Request): string {
  return req.headers.get("CF-Connecting-IP")?.trim() || FALLBACK_SOURCE;
}

async function sourceKey(source: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(source),
  );
  const suffix = [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return KEY_PREFIX + suffix;
}

function parseState(raw: string | null): FailureState | null {
  if (raw === null) return null;
  try {
    const state = JSON.parse(raw) as Partial<FailureState>;
    if (
      typeof state.count !== "number" ||
      !Number.isInteger(state.count) ||
      state.count < 1 ||
      typeof state.resetAt !== "number" ||
      !Number.isFinite(state.resetAt)
    ) {
      return null;
    }
    return { count: state.count, resetAt: state.resetAt };
  } catch {
    return null;
  }
}

export class LoginRateLimiter {
  constructor(
    private readonly kv: KVNamespace,
    private readonly now: () => number = Date.now,
  ) {}

  async check(source: string): Promise<RateLimitStatus> {
    const key = await sourceKey(source);
    const state = parseState(await this.kv.get(key));
    const now = this.now();
    if (!state || state.resetAt <= now || state.count < FAILURE_LIMIT) {
      return { limited: false, retryAfterSeconds: 0 };
    }
    return {
      limited: true,
      retryAfterSeconds: Math.max(1, Math.ceil((state.resetAt - now) / 1000)),
    };
  }

  async recordFailure(source: string): Promise<void> {
    const key = await sourceKey(source);
    const now = this.now();
    const current = parseState(await this.kv.get(key));
    const state: FailureState =
      current && current.resetAt > now
        ? { count: current.count + 1, resetAt: current.resetAt }
        : { count: 1, resetAt: now + WINDOW_MS };
    await this.kv.put(key, JSON.stringify(state), {
      expirationTtl: Math.max(60, Math.ceil((state.resetAt - now) / 1000)),
    });
  }

  async clear(source: string): Promise<void> {
    await this.kv.delete(await sourceKey(source));
  }
}
