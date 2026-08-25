const LEASES_KEY = "active-ssh-leases";
const DEFAULT_LEASE_MS = 30_000;
const DEFAULT_SESSION_LIMIT = 3;
const DEFAULT_GLOBAL_LIMIT = 10;

export interface QuotaStorage {
  get<T>(key: string): Promise<T | undefined>;
  put<T>(key: string, value: T): Promise<void>;
}

interface QuotaLease {
  sessionKey: string;
  leaseId: string;
  expiresAt: number;
}

export type QuotaAcquireResult =
  | { granted: true; expiresAt: number }
  | { granted: false; reason: "session-limit" | "global-limit" };

export interface SshSessionQuotaOptions {
  now?: () => number;
  leaseMs?: number;
  sessionLimit?: number;
  globalLimit?: number;
}

export class SshSessionQuota {
  private readonly now: () => number;
  private readonly leaseMs: number;
  private readonly sessionLimit: number;
  private readonly globalLimit: number;

  constructor(
    private readonly storage: QuotaStorage,
    options: SshSessionQuotaOptions = {},
  ) {
    this.now = options.now ?? Date.now;
    this.leaseMs = options.leaseMs ?? DEFAULT_LEASE_MS;
    this.sessionLimit = options.sessionLimit ?? DEFAULT_SESSION_LIMIT;
    this.globalLimit = options.globalLimit ?? DEFAULT_GLOBAL_LIMIT;
  }

  async acquire(sessionKey: string, leaseId: string): Promise<QuotaAcquireResult> {
    const now = this.now();
    const leases = await this.activeLeases(now);
    const existing = leases.find(
      (lease) => lease.sessionKey === sessionKey && lease.leaseId === leaseId,
    );
    const expiresAt = now + this.leaseMs;
    if (existing) {
      existing.expiresAt = expiresAt;
      await this.storage.put(LEASES_KEY, leases);
      return { granted: true, expiresAt };
    }
    if (
      leases.filter((lease) => lease.sessionKey === sessionKey).length >=
      this.sessionLimit
    ) {
      await this.storage.put(LEASES_KEY, leases);
      return { granted: false, reason: "session-limit" };
    }
    if (leases.length >= this.globalLimit) {
      await this.storage.put(LEASES_KEY, leases);
      return { granted: false, reason: "global-limit" };
    }
    leases.push({ sessionKey, leaseId, expiresAt });
    await this.storage.put(LEASES_KEY, leases);
    return { granted: true, expiresAt };
  }

  async heartbeat(sessionKey: string, leaseId: string): Promise<boolean> {
    const now = this.now();
    const leases = await this.activeLeases(now);
    const lease = leases.find(
      (item) => item.sessionKey === sessionKey && item.leaseId === leaseId,
    );
    if (!lease) {
      await this.storage.put(LEASES_KEY, leases);
      return false;
    }
    lease.expiresAt = now + this.leaseMs;
    await this.storage.put(LEASES_KEY, leases);
    return true;
  }

  async release(sessionKey: string, leaseId: string): Promise<boolean> {
    const now = this.now();
    const leases = await this.activeLeases(now);
    const remaining = leases.filter(
      (lease) =>
        lease.sessionKey !== sessionKey || lease.leaseId !== leaseId,
    );
    await this.storage.put(LEASES_KEY, remaining);
    return remaining.length !== leases.length;
  }

  async activeCount(): Promise<number> {
    const leases = await this.activeLeases(this.now());
    await this.storage.put(LEASES_KEY, leases);
    return leases.length;
  }

  private async activeLeases(now: number): Promise<QuotaLease[]> {
    const stored = await this.storage.get<unknown>(LEASES_KEY);
    if (!Array.isArray(stored)) return [];
    return stored.filter(
      (value): value is QuotaLease =>
        typeof value === "object" &&
        value !== null &&
        typeof (value as QuotaLease).sessionKey === "string" &&
        typeof (value as QuotaLease).leaseId === "string" &&
        typeof (value as QuotaLease).expiresAt === "number" &&
        (value as QuotaLease).expiresAt > now,
    );
  }
}
