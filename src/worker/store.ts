// KV 存儲層（單一 namespace）
// - conn:<id>  → AES-GCM 加密的 ConnectionConfig JSON
// - os:<hostKey> → OsInfo JSON 明文快取（非敏感）
import {
  decryptString,
  decryptStringDetailed,
  encryptString,
} from "./crypto";
import type { ConnectionConfig, OsInfo } from "../shared/types";

const CONN_PREFIX = "conn:";
const OS_PREFIX = "os:";
const CONNECTION_MIGRATION_MARKER = "migration:connections:v2";
const KV_BULK_GET_LIMIT = 100;
const LIST_DECRYPT_CONCURRENCY = 64;
const DEFAULT_MIGRATION_BATCH_SIZE = 4;

export type NewConnection = Omit<ConnectionConfig, "id" | "createdAt" | "updatedAt">;

export interface ConnectionMigrationBatch {
  done: boolean;
  cursor?: string;
  scanned: number;
  migrated: number;
  failed: number;
  conflicts: number;
}

interface MigrationCursorState {
  kvCursor: string;
  blockers: number;
}

export class InvalidMigrationCursorError extends Error {
  constructor() {
    super("invalid migration cursor");
    this.name = "InvalidMigrationCursorError";
  }
}

async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  task: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    async () => {
      while (true) {
        const index = nextIndex;
        nextIndex += 1;
        if (index >= items.length) return;
        results[index] = await task(items[index]!);
      }
    },
  );
  await Promise.all(workers);
  return results;
}

function encodeMigrationCursor(state: MigrationCursorState): string {
  return btoa(JSON.stringify(state));
}

function decodeMigrationCursor(cursor: string): MigrationCursorState {
  try {
    const parsed = JSON.parse(atob(cursor)) as Record<string, unknown>;
    if (
      typeof parsed.kvCursor !== "string" ||
      !parsed.kvCursor ||
      typeof parsed.blockers !== "number" ||
      !Number.isInteger(parsed.blockers) ||
      parsed.blockers < 0
    ) {
      throw new Error("invalid fields");
    }
    return {
      kvCursor: parsed.kvCursor,
      blockers: parsed.blockers,
    };
  } catch {
    throw new InvalidMigrationCursorError();
  }
}

/** 連線設定 CRUD（靜態加密 at-rest） */
export class ConnectionStore {
  constructor(
    private readonly kv: KVNamespace,
    private readonly encryptionKey: string,
  ) {}

  async list(): Promise<ConnectionConfig[]> {
    const keys: KVNamespaceListKey<unknown>[] = [];
    let cursor: string | undefined;
    do {
      const page = await this.kv.list(
        cursor ? { prefix: CONN_PREFIX, cursor } : { prefix: CONN_PREFIX },
      );
      keys.push(...page.keys);
      if (page.list_complete || !page.cursor) break;
      cursor = page.cursor;
    } while (cursor);

    const encryptedByKey = new Map<string, string | null>();
    for (let offset = 0; offset < keys.length; offset += KV_BULK_GET_LIMIT) {
      const batch = keys
        .slice(offset, offset + KV_BULK_GET_LIMIT)
        .map((key) => key.name);
      const encrypted = await this.kv.get(batch);
      for (const key of batch) {
        encryptedByKey.set(key, encrypted.get(key) ?? null);
      }
    }

    const items = await mapWithConcurrency(
      keys,
      LIST_DECRYPT_CONCURRENCY,
      (key) => this.decodeConnection(encryptedByKey.get(key.name)),
    );
    return items.filter((c): c is ConnectionConfig => c !== null);
  }

  async migrateLegacyBatch(
    cursor?: string,
    batchSize = DEFAULT_MIGRATION_BATCH_SIZE,
  ): Promise<ConnectionMigrationBatch> {
    if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 100) {
      throw new Error("invalid migration batch size");
    }

    let kvCursor: string | undefined;
    let blockers = 0;
    if (cursor) {
      const state = decodeMigrationCursor(cursor);
      kvCursor = state.kvCursor;
      blockers = state.blockers;
    } else if ((await this.kv.get(CONNECTION_MIGRATION_MARKER)) === "complete") {
      return {
        done: true,
        scanned: 0,
        migrated: 0,
        failed: 0,
        conflicts: 0,
      };
    }

    const page = await this.kv.list({
      prefix: CONN_PREFIX,
      limit: batchSize,
      ...(kvCursor ? { cursor: kvCursor } : {}),
    });
    let scanned = 0;
    let migrated = 0;
    let failed = 0;
    let conflicts = 0;

    // v1 每筆都需要獨立 PBKDF2；刻意循序處理，將單次請求成本限制在批次大小內。
    for (const key of page.keys) {
      scanned += 1;
      const raw = await this.kv.get(key.name);
      if (raw === null) continue;

      let decrypted: Awaited<ReturnType<typeof decryptStringDetailed>>;
      try {
        decrypted = await decryptStringDetailed(this.encryptionKey, raw);
      } catch {
        failed += 1;
        blockers += 1;
        continue;
      }
      if (decrypted.version === "v2") continue;

      const replacement = await encryptString(
        this.encryptionKey,
        decrypted.plaintext,
      );
      const current = await this.kv.get(key.name);
      if (current !== raw) {
        conflicts += 1;
        if (current !== null) {
          try {
            if (
              (await decryptStringDetailed(this.encryptionKey, current)).version ===
              "v1"
            ) {
              blockers += 1;
            }
          } catch {
            blockers += 1;
          }
        }
        continue;
      }
      await this.kv.put(key.name, replacement);
      migrated += 1;
    }

    const done = page.list_complete || !page.cursor;
    if (done) {
      if (blockers === 0) {
        await this.kv.put(CONNECTION_MIGRATION_MARKER, "complete");
      }
      return { done: true, scanned, migrated, failed, conflicts };
    }

    return {
      done: false,
      cursor: encodeMigrationCursor({
        kvCursor: page.cursor!,
        blockers,
      }),
      scanned,
      migrated,
      failed,
      conflicts,
    };
  }

  async get(id: string): Promise<ConnectionConfig | null> {
    const raw = await this.kv.get(CONN_PREFIX + id);
    return this.decodeConnection(raw);
  }

  private async decodeConnection(
    raw: string | null | undefined,
  ): Promise<ConnectionConfig | null> {
    if (raw == null) return null;
    try {
      return JSON.parse(await decryptString(this.encryptionKey, raw)) as ConnectionConfig;
    } catch {
      // 金鑰變更或資料損毀：視為不存在，避免洩漏部分明文
      return null;
    }
  }

  async create(input: NewConnection): Promise<ConnectionConfig> {
    const now = Date.now();
    const config: ConnectionConfig = {
      ...input,
      id: crypto.randomUUID(),
      createdAt: now,
      updatedAt: now,
    };
    await this.kv.put(CONN_PREFIX + config.id, await encryptString(this.encryptionKey, JSON.stringify(config)));
    return config;
  }

  async update(id: string, patch: Partial<NewConnection>): Promise<ConnectionConfig | null> {
    const existing = await this.get(id);
    if (!existing) return null;
    const updated: ConnectionConfig = {
      ...existing,
      ...patch,
      id: existing.id,
      createdAt: existing.createdAt,
      updatedAt: Date.now(),
    };
    await this.kv.put(CONN_PREFIX + id, await encryptString(this.encryptionKey, JSON.stringify(updated)));
    return updated;
  }

  async remove(id: string): Promise<boolean> {
    const existing = await this.get(id);
    if (!existing) return false;
    await this.kv.delete(CONN_PREFIX + id);
    return true;
  }
}

/** OS 偵測快取 */
export class OsCache {
  constructor(private readonly kv: KVNamespace) {}

  async get(hostKey: string): Promise<OsInfo | null> {
    const raw = await this.kv.get(OS_PREFIX + hostKey);
    if (raw === null) return null;
    try {
      return JSON.parse(raw) as OsInfo;
    } catch {
      return null;
    }
  }

  async put(hostKey: string, info: OsInfo): Promise<void> {
    await this.kv.put(OS_PREFIX + hostKey, JSON.stringify(info));
  }
}

/** 主機識別 key（不儲存原始主機名） */
export async function hostKeyOf(host: string, port: number, username: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${host}|${port}|${username}`));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
