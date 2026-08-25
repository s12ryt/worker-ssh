import { decryptStringDetailed, encryptString } from "./crypto";
import type { ConnectionConfig } from "../shared/types";

export const LATEST_SCHEMA_VERSION = 2;

const DEFAULT_KV_BATCH_SIZE = 8;
const DEFAULT_VERIFY_BATCH_SIZE = 16;
const DEFAULT_CLEANUP_BATCH_SIZE = 32;
export const BOOTSTRAP_LEASE_MS = 60_000;

export type BootstrapPhase =
  | "kv_scan"
  | "kv_migrate"
  | "verify"
  | "kv_cleanup"
  | "complete";

export type BootstrapRunStatus =
  | "pending"
  | "running"
  | "failed"
  | "complete";

export interface BootstrapStatus {
  status: BootstrapRunStatus;
  phase: BootstrapPhase;
  schemaVersion: number;
  processed: number;
  total: number;
  percent: number;
  errorCode?: string;
}

export interface DatabaseBootstrapOptions {
  kvBatchSize?: number;
  verifyBatchSize?: number;
  cleanupBatchSize?: number;
  now?: () => number;
}

interface BootstrapStateRow {
  status: BootstrapRunStatus;
  phase: BootstrapPhase;
  schema_version: number;
  processed: number;
  total: number;
  cursor: string | null;
  error_code: string | null;
  lease_owner: string | null;
  lease_expires_at: number | null;
}

interface ConnectionRow {
  id: string;
  payload_envelope: string;
}

class BootstrapFailure extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "BootstrapFailure";
  }
}

const MIGRATION_V1 = [
  `CREATE TABLE IF NOT EXISTS bootstrap_state (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    status TEXT NOT NULL,
    phase TEXT NOT NULL,
    schema_version INTEGER NOT NULL,
    processed INTEGER NOT NULL DEFAULT 0,
    total INTEGER NOT NULL DEFAULT 0,
    cursor TEXT,
    error_code TEXT,
    lease_owner TEXT,
    lease_expires_at INTEGER,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS folders (
    id TEXT PRIMARY KEY,
    parent_id TEXT REFERENCES folders(id) ON DELETE RESTRICT,
    parent_scope TEXT NOT NULL,
    name_envelope TEXT NOT NULL,
    name_token TEXT NOT NULL,
    recursive_host_count INTEGER NOT NULL DEFAULT 0,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS folders_sibling_name
    ON folders(parent_scope, name_token)`,
  `CREATE INDEX IF NOT EXISTS folders_parent_sort
    ON folders(parent_id, sort_order, created_at)`,
  `CREATE TABLE IF NOT EXISTS connections (
    id TEXT PRIMARY KEY,
    folder_id TEXT REFERENCES folders(id) ON DELETE RESTRICT,
    payload_envelope TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS connections_folder_sort
    ON connections(folder_id, sort_order, created_at)`,
];

const MIGRATION_V2 = [
  `CREATE TABLE IF NOT EXISTS app_settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    theme TEXT NOT NULL,
    terminal_font_size INTEGER NOT NULL,
    monitor_interval_seconds INTEGER NOT NULL,
    auto_reconnect_enabled INTEGER NOT NULL,
    auto_reconnect_attempts INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
];

function positiveBatchSize(value: number | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || value < 1 || value > 100) {
    throw new Error("invalid bootstrap batch size");
  }
  return value;
}

function parseConnection(raw: string, expectedId: string): ConnectionConfig {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new BootstrapFailure("KV_CONNECTION_INVALID");
  }
  if (typeof parsed !== "object" || parsed === null) {
    throw new BootstrapFailure("KV_CONNECTION_INVALID");
  }
  const config = parsed as Record<string, unknown>;
  if (
    config.id !== expectedId ||
    typeof config.name !== "string" ||
    typeof config.host !== "string" ||
    typeof config.port !== "number" ||
    typeof config.username !== "string" ||
    (config.authType !== "password" && config.authType !== "privateKey") ||
    typeof config.createdAt !== "number" ||
    typeof config.updatedAt !== "number"
  ) {
    throw new BootstrapFailure("KV_CONNECTION_INVALID");
  }
  return parsed as ConnectionConfig;
}

function percentOf(row: BootstrapStateRow): number {
  if (row.status === "complete" || row.phase === "complete") return 100;
  const ratio = row.total > 0 ? Math.min(1, row.processed / row.total) : 0;
  switch (row.phase) {
    case "kv_scan":
      return 5;
    case "kv_migrate":
      return Math.round(10 + ratio * 50);
    case "verify":
      return Math.round(60 + ratio * 25);
    case "kv_cleanup":
      return Math.round(85 + ratio * 14);
  }
}

function toStatus(row: BootstrapStateRow): BootstrapStatus {
  return {
    status: row.status,
    phase: row.phase,
    schemaVersion: row.schema_version,
    processed: row.processed,
    total: row.total,
    percent: percentOf(row),
    ...(row.error_code ? { errorCode: row.error_code } : {}),
  };
}

export class DatabaseBootstrap {
  private readonly kvBatchSize: number;
  private readonly verifyBatchSize: number;
  private readonly cleanupBatchSize: number;
  private readonly now: () => number;

  constructor(
    private readonly db: D1Database,
    private readonly kv: KVNamespace,
    private readonly encryptionKey: string,
    options: DatabaseBootstrapOptions = {},
  ) {
    this.kvBatchSize = positiveBatchSize(
      options.kvBatchSize,
      DEFAULT_KV_BATCH_SIZE,
    );
    this.verifyBatchSize = positiveBatchSize(
      options.verifyBatchSize,
      DEFAULT_VERIFY_BATCH_SIZE,
    );
    this.cleanupBatchSize = positiveBatchSize(
      options.cleanupBatchSize,
      DEFAULT_CLEANUP_BATCH_SIZE,
    );
    this.now = options.now ?? Date.now;
  }

  async status(): Promise<BootstrapStatus> {
    await this.ensureSchema();
    return toStatus(await this.readState());
  }

  async retry(): Promise<BootstrapStatus> {
    await this.ensureSchema();
    const now = this.now();
    await this.db
      .prepare(
        `UPDATE bootstrap_state
         SET status = 'pending', error_code = NULL,
             lease_owner = NULL, lease_expires_at = NULL, updated_at = ?
         WHERE id = 1 AND status = 'failed'`,
      )
      .bind(now)
      .run();
    return this.status();
  }

  async step(): Promise<BootstrapStatus> {
    await this.ensureSchema();
    const owner = crypto.randomUUID();
    const now = this.now();
    const state = await this.db
      .prepare(
        `UPDATE bootstrap_state
         SET status = 'running', lease_owner = ?, lease_expires_at = ?,
             updated_at = ?
         WHERE id = 1
           AND status NOT IN ('complete', 'failed')
           AND (lease_expires_at IS NULL OR lease_expires_at < ?)
         RETURNING status, phase, schema_version, processed, total, cursor,
                   error_code, lease_owner, lease_expires_at`,
      )
      .bind(owner, now + BOOTSTRAP_LEASE_MS, now, now)
      .first<BootstrapStateRow>();

    if (!state) return this.status();

    try {
      switch (state.phase) {
        case "kv_scan":
          await this.scanKv(state, owner);
          break;
        case "kv_migrate":
          await this.migrateKv(state, owner);
          break;
        case "verify":
          await this.verifyD1(state, owner);
          break;
        case "kv_cleanup":
          await this.cleanupKv(state, owner);
          break;
        case "complete":
          break;
      }
    } catch (error) {
      const code =
        error instanceof BootstrapFailure
          ? error.code
          : "BOOTSTRAP_INTERNAL_ERROR";
      await this.db
        .prepare(
          `UPDATE bootstrap_state
           SET status = 'failed', error_code = ?, lease_owner = NULL,
               lease_expires_at = NULL, updated_at = ?
           WHERE id = 1 AND lease_owner = ?`,
        )
        .bind(code, this.now(), owner)
        .run();
    }

    return this.status();
  }

  private async ensureSchema(): Promise<void> {
    await this.db
      .prepare(
        `CREATE TABLE IF NOT EXISTS schema_meta (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL,
          updated_at INTEGER NOT NULL
        )`,
      )
      .run();
    const currentText = await this.db
      .prepare("SELECT value FROM schema_meta WHERE key = 'schema_version'")
      .first<string>("value");
    const current = currentText === null ? 0 : Number(currentText);
    if (!Number.isInteger(current) || current < 0 || current > LATEST_SCHEMA_VERSION) {
      throw new Error("unsupported schema version");
    }
    if (current === LATEST_SCHEMA_VERSION) return;

    const now = this.now();
    const statements: D1PreparedStatement[] = [];
    if (current < 1) {
      statements.push(...MIGRATION_V1.map((sql) => this.db.prepare(sql)));
      statements.push(
        this.db
          .prepare(
            `INSERT OR IGNORE INTO bootstrap_state (
               id, status, phase, schema_version, processed, total, updated_at
             ) VALUES (1, 'pending', 'kv_scan', ?, 0, 0, ?)`,
          )
          .bind(LATEST_SCHEMA_VERSION, now),
      );
    }
    if (current < 2) {
      statements.push(...MIGRATION_V2.map((sql) => this.db.prepare(sql)));
    }
    statements.push(
      this.db
        .prepare(
          `UPDATE bootstrap_state
           SET schema_version = ?, updated_at = ?
           WHERE id = 1`,
        )
        .bind(LATEST_SCHEMA_VERSION, now),
      this.db
        .prepare(
          `INSERT INTO schema_meta (key, value, updated_at)
           VALUES ('schema_version', ?, ?)
           ON CONFLICT(key) DO UPDATE SET value = excluded.value,
             updated_at = excluded.updated_at`,
        )
        .bind(String(LATEST_SCHEMA_VERSION), now),
    );
    await this.db.batch(statements);
  }

  private async readState(): Promise<BootstrapStateRow> {
    const row = await this.db
      .prepare(
        `SELECT status, phase, schema_version, processed, total, cursor,
                error_code, lease_owner, lease_expires_at
         FROM bootstrap_state WHERE id = 1`,
      )
      .first<BootstrapStateRow>();
    if (!row) throw new Error("bootstrap state missing");
    return row;
  }

  private async scanKv(
    state: BootstrapStateRow,
    owner: string,
  ): Promise<void> {
    await this.renewLease(owner);
    const page = await this.kv.list({
      prefix: "conn:",
      limit: this.kvBatchSize,
      ...(state.cursor ? { cursor: state.cursor } : {}),
    });
    const total = state.total + page.keys.length;
    const done = page.list_complete || !page.cursor;
    await this.renewLease(owner);
    await this.db
      .prepare(
        `UPDATE bootstrap_state
         SET status = 'pending', phase = ?, processed = 0, total = ?, cursor = ?,
             lease_owner = NULL, lease_expires_at = NULL, updated_at = ?
         WHERE id = 1 AND lease_owner = ?`,
      )
      .bind(
        done ? "kv_migrate" : "kv_scan",
        total,
        done ? null : page.cursor!,
        this.now(),
        owner,
      )
      .run();
  }

  private async migrateKv(
    state: BootstrapStateRow,
    owner: string,
  ): Promise<void> {
    await this.renewLease(owner);
    const page = await this.kv.list({
      prefix: "conn:",
      limit: this.kvBatchSize,
      ...(state.cursor ? { cursor: state.cursor } : {}),
    });
    const names = page.keys.map((key) => key.name);
    const values = names.length > 0 ? await this.kv.get(names) : new Map();
    const writes: D1PreparedStatement[] = [];

    for (const name of names) {
      await this.renewLease(owner);
      const envelope = values.get(name);
      if (envelope === null || envelope === undefined) continue;
      const expectedId = name.slice("conn:".length);
      let decrypted: Awaited<ReturnType<typeof decryptStringDetailed>>;
      try {
        decrypted = await decryptStringDetailed(this.encryptionKey, envelope);
      } catch {
        throw new BootstrapFailure("KV_CONNECTION_INVALID");
      }
      const config = parseConnection(decrypted.plaintext, expectedId);
      const existing = await this.db
        .prepare("SELECT payload_envelope FROM connections WHERE id = ?")
        .bind(config.id)
        .first<string>("payload_envelope");
      if (existing !== null) {
        try {
          const current = parseConnection(
            (await decryptStringDetailed(this.encryptionKey, existing)).plaintext,
            config.id,
          );
          if (current.id !== config.id) {
            throw new BootstrapFailure("D1_CONNECTION_CONFLICT");
          }
        } catch (error) {
          if (error instanceof BootstrapFailure) throw error;
          throw new BootstrapFailure("D1_CONNECTION_CONFLICT");
        }
        continue;
      }
      const payload =
        decrypted.version === "v2"
          ? envelope
          : await encryptString(this.encryptionKey, decrypted.plaintext);
      writes.push(
        this.db
          .prepare(
            `INSERT INTO connections (
               id, folder_id, payload_envelope, sort_order, created_at, updated_at
             ) VALUES (?, NULL, ?, ?, ?, ?)`,
          )
          .bind(
            config.id,
            payload,
            config.createdAt,
            config.createdAt,
            config.updatedAt,
          ),
      );
    }

    const done = page.list_complete || !page.cursor;
    const processed = Math.min(state.total, state.processed + names.length);
    await this.renewLease(owner);
    writes.push(
      this.db
        .prepare(
          `UPDATE bootstrap_state
           SET status = 'pending', phase = ?, processed = ?, cursor = ?,
               lease_owner = NULL, lease_expires_at = NULL, updated_at = ?
           WHERE id = 1 AND lease_owner = ?`,
        )
        .bind(
          done ? "verify" : "kv_migrate",
          done ? 0 : processed,
          done ? null : page.cursor!,
          this.now(),
          owner,
        ),
    );
    await this.db.batch(writes);
  }

  private async verifyD1(
    state: BootstrapStateRow,
    owner: string,
  ): Promise<void> {
    await this.renewLease(owner);
    const rows = await this.db
      .prepare(
        `SELECT id, payload_envelope FROM connections
         ORDER BY id LIMIT ? OFFSET ?`,
      )
      .bind(this.verifyBatchSize, state.processed)
      .all<ConnectionRow>();

    for (const row of rows.results) {
      await this.renewLease(owner);
      try {
        parseConnection(
          (await decryptStringDetailed(this.encryptionKey, row.payload_envelope))
            .plaintext,
          row.id,
        );
      } catch {
        throw new BootstrapFailure("D1_VERIFICATION_FAILED");
      }
    }

    const processed = state.processed + rows.results.length;
    const done = rows.results.length < this.verifyBatchSize || processed >= state.total;
    if (done) {
      await this.renewLease(owner);
      const count = await this.db
        .prepare("SELECT COUNT(*) AS count FROM connections")
        .first<number>("count");
      if (count !== state.total || processed !== state.total) {
        throw new BootstrapFailure("D1_VERIFICATION_FAILED");
      }
    }
    await this.renewLease(owner);
    await this.db
      .prepare(
        `UPDATE bootstrap_state
         SET status = 'pending', phase = ?, processed = ?, cursor = NULL,
             lease_owner = NULL, lease_expires_at = NULL, updated_at = ?
         WHERE id = 1 AND lease_owner = ?`,
      )
      .bind(
        done ? "kv_cleanup" : "verify",
        done ? 0 : processed,
        this.now(),
        owner,
      )
      .run();
  }

  private async cleanupKv(
    state: BootstrapStateRow,
    owner: string,
  ): Promise<void> {
    await this.renewLease(owner);
    const page = await this.kv.list({
      prefix: "conn:",
      limit: this.cleanupBatchSize,
    });
    await Promise.all(page.keys.map((key) => this.kv.delete(key.name)));
    await this.renewLease(owner);
    const processed = Math.min(state.total, state.processed + page.keys.length);
    const done = page.keys.length === 0;
    await this.db
      .prepare(
        `UPDATE bootstrap_state
         SET status = ?, phase = ?, processed = ?, cursor = NULL,
             error_code = NULL, lease_owner = NULL, lease_expires_at = NULL,
             updated_at = ?
         WHERE id = 1 AND lease_owner = ?`,
      )
      .bind(
        done ? "complete" : "pending",
        done ? "complete" : "kv_cleanup",
        done ? state.total : processed,
        this.now(),
        owner,
      )
      .run();
  }

  private async renewLease(owner: string): Promise<void> {
    const now = this.now();
    const result = await this.db
      .prepare(
        `UPDATE bootstrap_state
         SET lease_expires_at = ?, updated_at = ?
         WHERE id = 1 AND lease_owner = ? AND status = 'running'`,
      )
      .bind(now + BOOTSTRAP_LEASE_MS, now, owner)
      .run();
    if ((result.meta.changes ?? 0) !== 1) {
      throw new BootstrapFailure("BOOTSTRAP_LEASE_LOST");
    }
  }
}
