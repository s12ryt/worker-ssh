import type {
  AccessProxyConfig,
  AccessProxyView,
  AuthType,
  ConnectionConfig,
  SshOption,
} from "../shared/types";
import { decryptString, encryptString } from "./crypto";

const ROOT_SCOPE = "__root__";
const MAX_FOLDER_DEPTH = 8;
const MAX_CONNECTION_MOVE_BATCH = 50;
const FOLDER_TOKEN_SALT = new TextEncoder().encode(
  "worker-ssh:folder-name:v1:kdf",
);
const FOLDER_TOKEN_INFO = new TextEncoder().encode(
  "worker-ssh:folder-name:v1:hmac",
);

let tokenKeyCache = new Map<string, Promise<CryptoKey>>();

export type CredentialState = "ready" | "missing";

export interface ConnectionView {
  id: string;
  folderId: string | null;
  name: string;
  host: string;
  port: number;
  username: string;
  authType: AuthType;
  credentialState: CredentialState;
  hostKeyType?: string;
  hostKeyFingerprint?: string;
  sshOptions?: SshOption[];
  accessProxy?: AccessProxyView;
  createdAt: number;
  updatedAt: number;
  lastConnectedAt?: number;
  lastDisconnectedAt?: number;
}

export interface FolderView {
  id: string;
  parentId: string | null;
  name: string;
  recursiveHostCount: number;
  sortOrder: number;
  createdAt: number;
  updatedAt: number;
}

export interface FolderScopeView {
  folder: FolderView | null;
  breadcrumb: FolderView[];
  folders: FolderView[];
  connections: ConnectionView[];
}

export type NewD1Connection = Omit<
  ConnectionConfig,
  "id" | "createdAt" | "updatedAt"
>;

export type D1ConnectionPatch = Partial<
  Omit<
    ConnectionConfig,
    | "id"
    | "createdAt"
    | "updatedAt"
    | "hostKeyType"
    | "hostKeyFingerprint"
    | "lastConnectedAt"
    | "lastDisconnectedAt"
    | "sshOptions"
    | "accessProxy"
  >
> & {
  hostKeyType?: string | null;
  hostKeyFingerprint?: string | null;
  lastConnectedAt?: number | null;
  lastDisconnectedAt?: number | null;
  sshOptions?: SshOption[] | null;
  accessProxy?: AccessProxyConfig | null;
};

interface ConnectionRow {
  id: string;
  folder_id: string | null;
  payload_envelope: string;
  created_at: number;
  updated_at: number;
}

interface FolderRow {
  id: string;
  parent_id: string | null;
  name_envelope: string;
  name_token: string;
  recursive_host_count: number;
  sort_order: number;
  created_at: number;
  updated_at: number;
}

interface DescendantRow {
  id: string;
  depth: number;
}

export class CredentialRequiredError extends Error {
  constructor() {
    super("credential required");
    this.name = "CredentialRequiredError";
  }
}

/** PUT accessProxy 帶 clientId 但 clientSecret 未提供且無既有值可沿用 */
export class AccessSecretRequiredError extends Error {
  constructor() {
    super("access proxy client secret required");
    this.name = "AccessSecretRequiredError";
  }
}

export class DuplicateFolderNameError extends Error {
  constructor() {
    super("duplicate folder name");
    this.name = "DuplicateFolderNameError";
  }
}

export class FolderDepthError extends Error {
  constructor() {
    super("folder depth limit exceeded");
    this.name = "FolderDepthError";
  }
}

export class FolderCycleError extends Error {
  constructor() {
    super("folder cycle detected");
    this.name = "FolderCycleError";
  }
}

export class RecordNotFoundError extends Error {
  constructor() {
    super("record not found");
    this.name = "RecordNotFoundError";
  }
}

export class TooManyConnectionsToMoveError extends Error {
  constructor() {
    super("too many connections to move");
    this.name = "TooManyConnectionsToMoveError";
  }
}

function normalizeFolderName(name: string): string {
  return name.trim().normalize("NFKC").toLocaleLowerCase("en-US");
}

async function folderTokenKey(keyMaterial: string): Promise<CryptoKey> {
  let promise = tokenKeyCache.get(keyMaterial);
  if (!promise) {
    promise = (async () => {
      const base = await crypto.subtle.importKey(
        "raw",
        new TextEncoder().encode(keyMaterial),
        "HKDF",
        false,
        ["deriveKey"],
      );
      return crypto.subtle.deriveKey(
        {
          name: "HKDF",
          hash: "SHA-256",
          salt: FOLDER_TOKEN_SALT,
          info: FOLDER_TOKEN_INFO,
        },
        base,
        { name: "HMAC", hash: "SHA-256", length: 256 },
        false,
        ["sign"],
      );
    })();
    tokenKeyCache.set(keyMaterial, promise);
    promise.catch(() => tokenKeyCache.delete(keyMaterial));
  }
  return promise;
}

async function folderNameToken(
  encryptionKey: string,
  name: string,
): Promise<string> {
  const normalized = normalizeFolderName(name);
  if (!normalized) throw new Error("folder name required");
  const signature = await crypto.subtle.sign(
    "HMAC",
    await folderTokenKey(encryptionKey),
    new TextEncoder().encode(normalized),
  );
  return [...new Uint8Array(signature)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function isUniqueConstraint(error: unknown): boolean {
  return error instanceof Error && /UNIQUE constraint failed/i.test(error.message);
}

function credentialState(config: ConnectionConfig): CredentialState {
  if (config.authType === "password") {
    return config.password ? "ready" : "missing";
  }
  return config.privateKey ? "ready" : "missing";
}

function publicConnection(
  config: ConnectionConfig,
  folderId: string | null,
): ConnectionView {
  return {
    id: config.id,
    folderId,
    name: config.name,
    host: config.host,
    port: config.port,
    username: config.username,
    authType: config.authType,
    credentialState: credentialState(config),
    ...(config.hostKeyType ? { hostKeyType: config.hostKeyType } : {}),
    ...(config.hostKeyFingerprint
      ? { hostKeyFingerprint: config.hostKeyFingerprint }
      : {}),
    ...(config.sshOptions ? { sshOptions: config.sshOptions } : {}),
    ...(config.accessProxy
      ? {
          accessProxy: {
            hostname: config.accessProxy.hostname,
            ...(config.accessProxy.destination
              ? { destination: config.accessProxy.destination }
              : {}),
            ...(config.accessProxy.clientId
              ? { clientId: config.accessProxy.clientId }
              : {}),
          },
        }
      : {}),
    createdAt: config.createdAt,
    updatedAt: config.updatedAt,
    ...(config.lastConnectedAt !== undefined
      ? { lastConnectedAt: config.lastConnectedAt }
      : {}),
    ...(config.lastDisconnectedAt !== undefined
      ? { lastDisconnectedAt: config.lastDisconnectedAt }
      : {}),
  };
}

function parentScope(parentId: string | null): string {
  return parentId ?? ROOT_SCOPE;
}

function assertCredential(config: Pick<ConnectionConfig, "authType" | "password" | "privateKey">): void {
  if (config.authType === "password" ? !config.password : !config.privateKey) {
    throw new CredentialRequiredError();
  }
}

function compareNames<T extends { name: string }>(left: T, right: T): number {
  return left.name.localeCompare(right.name, "zh-Hant", {
    sensitivity: "base",
    numeric: true,
  });
}

export class D1ConnectionStore {
  constructor(
    private readonly db: D1Database,
    private readonly encryptionKey: string,
  ) {}

  async createConnection(
    input: NewD1Connection,
    folderId: string | null = null,
  ): Promise<ConnectionView> {
    assertCredential(input);
    if (folderId !== null) await this.requireFolderRow(folderId);
    const now = Date.now();
    const config: ConnectionConfig = {
      ...input,
      id: crypto.randomUUID(),
      createdAt: now,
      updatedAt: now,
    };
    const statements = [
      this.db
        .prepare(
          `INSERT INTO connections (
             id, folder_id, payload_envelope, sort_order, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          config.id,
          folderId,
          await encryptString(this.encryptionKey, JSON.stringify(config)),
          now,
          now,
          now,
        ),
      ...(await this.countStatements(folderId, 1, now)),
    ];
    await this.db.batch(statements);
    return publicConnection(config, folderId);
  }

  async getConnection(id: string): Promise<ConnectionView | null> {
    const row = await this.connectionRow(id);
    if (!row) return null;
    return publicConnection(await this.decodeConnection(row), row.folder_id);
  }

  async getConnectionInternal(id: string): Promise<ConnectionConfig | null> {
    const row = await this.connectionRow(id);
    return row ? this.decodeConnection(row) : null;
  }

  /** 單次 D1 查詢＋單次解密，同時导出公開視圖與內部設定（SSH 連線路徑專用）。 */
  async getConnectionWithInternal(
    id: string,
  ): Promise<{ view: ConnectionView; config: ConnectionConfig } | null> {
    const row = await this.connectionRow(id);
    if (!row) return null;
    const config = await this.decodeConnection(row);
    return { view: publicConnection(config, row.folder_id), config };
  }

  async updateConnection(
    id: string,
    patch: D1ConnectionPatch,
  ): Promise<ConnectionView | null> {
    const row = await this.connectionRow(id);
    if (!row) return null;
    const existing = await this.decodeConnection(row);
    const authType = patch.authType ?? existing.authType;
    const {
      hostKeyType,
      hostKeyFingerprint,
      lastConnectedAt,
      lastDisconnectedAt,
      sshOptions,
      accessProxy,
      ...plainPatch
    } = patch;
    const updated: ConnectionConfig = {
      ...existing,
      ...plainPatch,
      ...(typeof hostKeyType === "string" ? { hostKeyType } : {}),
      ...(typeof hostKeyFingerprint === "string" ? { hostKeyFingerprint } : {}),
      ...(typeof lastConnectedAt === "number" ? { lastConnectedAt } : {}),
      ...(typeof lastDisconnectedAt === "number" ? { lastDisconnectedAt } : {}),
      authType,
      id: existing.id,
      createdAt: existing.createdAt,
      updatedAt: Date.now(),
    };

    if (patch.password === "" || patch.password === undefined) {
      updated.password = existing.password;
    }
    if (patch.privateKey === "" || patch.privateKey === undefined) {
      updated.privateKey = existing.privateKey;
    }
    if (patch.passphrase === "" || patch.passphrase === undefined) {
      updated.passphrase = existing.passphrase;
    }
    if (hostKeyType === null) delete updated.hostKeyType;
    if (hostKeyFingerprint === null) delete updated.hostKeyFingerprint;
    if (lastConnectedAt === null) delete updated.lastConnectedAt;
    if (lastDisconnectedAt === null) delete updated.lastDisconnectedAt;

    // SSH 選項：undefined=保留、null=清除、陣列=替換
    if (sshOptions !== undefined) {
      if (sshOptions === null || sshOptions.length === 0) {
        delete updated.sshOptions;
      } else {
        updated.sshOptions = sshOptions;
      }
    }

    // Access 代理：undefined=保留、null=清除、物件=替換（clientSecret 空白沿用既有值）
    if (accessProxy !== undefined) {
      if (accessProxy === null) {
        delete updated.accessProxy;
      } else {
        const secret =
          accessProxy.clientSecret?.trim() ||
          existing.accessProxy?.clientSecret;
        if (accessProxy.clientId && !secret) {
          throw new AccessSecretRequiredError();
        }
        const merged: AccessProxyConfig = { ...accessProxy };
        if (secret) {
          merged.clientSecret = secret;
        } else {
          delete merged.clientSecret;
        }
        updated.accessProxy = merged;
      }
    }

    if (authType === "password") {
      delete updated.privateKey;
      delete updated.passphrase;
    } else {
      delete updated.password;
    }
    assertCredential(updated);

    await this.db
      .prepare(
        `UPDATE connections
         SET payload_envelope = ?, updated_at = ?
         WHERE id = ?`,
      )
      .bind(
        await encryptString(this.encryptionKey, JSON.stringify(updated)),
        updated.updatedAt,
        id,
      )
      .run();
    return publicConnection(updated, row.folder_id);
  }

  async clearCredential(id: string): Promise<ConnectionView | null> {
    const row = await this.connectionRow(id);
    if (!row) return null;
    const config = await this.decodeConnection(row);
    if (config.authType === "password") {
      delete config.password;
    } else {
      delete config.privateKey;
      delete config.passphrase;
    }
    config.updatedAt = Date.now();
    await this.db
      .prepare(
        `UPDATE connections
         SET payload_envelope = ?, updated_at = ?
         WHERE id = ?`,
      )
      .bind(
        await encryptString(this.encryptionKey, JSON.stringify(config)),
        config.updatedAt,
        id,
      )
      .run();
    return publicConnection(config, row.folder_id);
  }

  async deleteConnection(id: string): Promise<boolean> {
    const row = await this.connectionRow(id);
    if (!row) return false;
    const now = Date.now();
    await this.db.batch([
      this.db.prepare("DELETE FROM connections WHERE id = ?").bind(id),
      ...(await this.countStatements(row.folder_id, -1, now)),
    ]);
    return true;
  }

  async listConnections(): Promise<ConnectionView[]> {
    const rows = await this.db
      .prepare(
        `SELECT id, folder_id, payload_envelope, created_at, updated_at
         FROM connections ORDER BY sort_order, created_at, id`,
      )
      .all<ConnectionRow>();
    const values = await Promise.all(
      rows.results.map(async (row) =>
        publicConnection(await this.decodeConnection(row), row.folder_id),
      ),
    );
    return values.sort(compareNames);
  }

  async moveConnections(
    ids: readonly string[],
    folderId: string | null,
  ): Promise<void> {
    const uniqueIds = [...new Set(ids)];
    if (uniqueIds.length === 0) return;
    if (uniqueIds.length > MAX_CONNECTION_MOVE_BATCH) {
      throw new TooManyConnectionsToMoveError();
    }
    if (folderId !== null) await this.requireFolderRow(folderId);

    const rows: ConnectionRow[] = [];
    for (const id of uniqueIds) {
      const row = await this.connectionRow(id);
      if (!row) throw new RecordNotFoundError();
      rows.push(row);
    }

    const deltas = new Map<string, number>();
    for (const row of rows) {
      if (row.folder_id === folderId) continue;
      for (const ancestor of await this.ancestorIds(row.folder_id)) {
        deltas.set(ancestor, (deltas.get(ancestor) ?? 0) - 1);
      }
      for (const ancestor of await this.ancestorIds(folderId)) {
        deltas.set(ancestor, (deltas.get(ancestor) ?? 0) + 1);
      }
    }

    const now = Date.now();
    const statements = rows
      .filter((row) => row.folder_id !== folderId)
      .map((row) =>
        this.db
          .prepare("UPDATE connections SET folder_id = ?, updated_at = ? WHERE id = ?")
          .bind(folderId, now, row.id),
      );
    for (const [folder, delta] of deltas) {
      if (delta === 0) continue;
      statements.push(
        this.db
          .prepare(
            `UPDATE folders SET recursive_host_count = recursive_host_count + ?,
             updated_at = ? WHERE id = ?`,
          )
          .bind(delta, now, folder),
      );
    }
    if (statements.length > 0) await this.db.batch(statements);
  }

  async createFolder(
    name: string,
    parentId: string | null = null,
  ): Promise<FolderView> {
    const cleanName = name.trim();
    if (!cleanName) throw new Error("folder name required");
    if (parentId !== null) {
      await this.requireFolderRow(parentId);
      if ((await this.folderDepth(parentId)) >= MAX_FOLDER_DEPTH) {
        throw new FolderDepthError();
      }
    }
    const now = Date.now();
    const id = crypto.randomUUID();
    try {
      await this.db
        .prepare(
          `INSERT INTO folders (
             id, parent_id, parent_scope, name_envelope, name_token,
             recursive_host_count, sort_order, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?)`,
        )
        .bind(
          id,
          parentId,
          parentScope(parentId),
          await encryptString(this.encryptionKey, cleanName),
          await folderNameToken(this.encryptionKey, cleanName),
          now,
          now,
          now,
        )
        .run();
    } catch (error) {
      if (isUniqueConstraint(error)) throw new DuplicateFolderNameError();
      throw error;
    }
    return {
      id,
      parentId,
      name: cleanName,
      recursiveHostCount: 0,
      sortOrder: now,
      createdAt: now,
      updatedAt: now,
    };
  }

  async getFolder(id: string): Promise<FolderView | null> {
    const row = await this.folderRow(id);
    return row ? this.decodeFolder(row) : null;
  }

  /** 移動選單使用的全資料夾摘要；不查詢或解密連線 payload。 */
  async listFolders(): Promise<FolderView[]> {
    const result = await this.db
      .prepare(
        `SELECT id, parent_id, name_envelope, name_token,
                recursive_host_count, sort_order, created_at, updated_at
         FROM folders`,
      )
      .all<FolderRow>();
    const folders = await Promise.all(result.results.map((row) => this.decodeFolder(row)));
    return folders.sort(compareNames);
  }

  async renameFolder(id: string, name: string): Promise<FolderView | null> {
    const row = await this.folderRow(id);
    if (!row) return null;
    const cleanName = name.trim();
    if (!cleanName) throw new Error("folder name required");
    const now = Date.now();
    try {
      await this.db
        .prepare(
          `UPDATE folders
           SET name_envelope = ?, name_token = ?, updated_at = ?
           WHERE id = ?`,
        )
        .bind(
          await encryptString(this.encryptionKey, cleanName),
          await folderNameToken(this.encryptionKey, cleanName),
          now,
          id,
        )
        .run();
    } catch (error) {
      if (isUniqueConstraint(error)) throw new DuplicateFolderNameError();
      throw error;
    }
    return {
      ...(await this.decodeFolder(row)),
      name: cleanName,
      updatedAt: now,
    };
  }

  async moveFolder(id: string, targetParentId: string | null): Promise<void> {
    const source = await this.requireFolderRow(id);
    if (source.parent_id === targetParentId) return;
    if (targetParentId !== null) await this.requireFolderRow(targetParentId);
    if (targetParentId === id || (await this.isDescendant(targetParentId, id))) {
      throw new FolderCycleError();
    }
    const targetDepth = targetParentId ? await this.folderDepth(targetParentId) : 0;
    const subtreeHeight = await this.folderSubtreeHeight(id);
    if (targetDepth + subtreeHeight > MAX_FOLDER_DEPTH) {
      throw new FolderDepthError();
    }

    const now = Date.now();
    const statements = [
      this.db
        .prepare(
          `UPDATE folders
           SET parent_id = ?, parent_scope = ?, updated_at = ?
           WHERE id = ?`,
        )
        .bind(targetParentId, parentScope(targetParentId), now, id),
      ...(await this.countStatements(
        source.parent_id,
        -source.recursive_host_count,
        now,
      )),
      ...(await this.countStatements(
        targetParentId,
        source.recursive_host_count,
        now,
      )),
    ];
    try {
      await this.db.batch(statements);
    } catch (error) {
      if (isUniqueConstraint(error)) throw new DuplicateFolderNameError();
      throw error;
    }
  }

  async deleteFolder(
    id: string,
    mode: "recursive" | "promote",
  ): Promise<void> {
    const source = await this.requireFolderRow(id);
    const now = Date.now();
    if (mode === "promote") {
      const statements = [
        this.db
          .prepare("UPDATE connections SET folder_id = ?, updated_at = ? WHERE folder_id = ?")
          .bind(source.parent_id, now, id),
        this.db
          .prepare(
            `UPDATE folders SET parent_id = ?, parent_scope = ?, updated_at = ?
             WHERE parent_id = ?`,
          )
          .bind(source.parent_id, parentScope(source.parent_id), now, id),
        this.db.prepare("DELETE FROM folders WHERE id = ?").bind(id),
      ];
      try {
        await this.db.batch(statements);
      } catch (error) {
        if (isUniqueConstraint(error)) throw new DuplicateFolderNameError();
        throw error;
      }
      return;
    }

    const descendants = await this.descendantRows(id);
    const statements: D1PreparedStatement[] = [];
    for (const row of descendants) {
      statements.push(
        this.db.prepare("DELETE FROM connections WHERE folder_id = ?").bind(row.id),
      );
    }
    for (const row of [...descendants].sort((a, b) => b.depth - a.depth)) {
      statements.push(this.db.prepare("DELETE FROM folders WHERE id = ?").bind(row.id));
    }
    statements.push(
      ...(await this.countStatements(
        source.parent_id,
        -source.recursive_host_count,
        now,
      )),
    );
    await this.db.batch(statements);
  }

  async listScope(folderId: string | null): Promise<FolderScopeView> {
    const folder = folderId === null ? null : await this.getFolder(folderId);
    if (folderId !== null && !folder) throw new RecordNotFoundError();
    const folderRows = await this.db
      .prepare(
        folderId === null
          ? `SELECT * FROM folders WHERE parent_id IS NULL
             ORDER BY sort_order, created_at, id`
          : `SELECT * FROM folders WHERE parent_id = ?
             ORDER BY sort_order, created_at, id`,
      )
      .bind(...(folderId === null ? [] : [folderId]))
      .all<FolderRow>();
    const connectionRows = await this.db
      .prepare(
        folderId === null
          ? `SELECT id, folder_id, payload_envelope, created_at, updated_at
             FROM connections WHERE folder_id IS NULL
             ORDER BY sort_order, created_at, id`
          : `SELECT id, folder_id, payload_envelope, created_at, updated_at
             FROM connections WHERE folder_id = ?
             ORDER BY sort_order, created_at, id`,
      )
      .bind(...(folderId === null ? [] : [folderId]))
      .all<ConnectionRow>();

    const folders = await Promise.all(
      folderRows.results.map((row) => this.decodeFolder(row)),
    );
    const connections = await Promise.all(
      connectionRows.results.map(async (row) =>
        publicConnection(await this.decodeConnection(row), row.folder_id),
      ),
    );
    return {
      folder,
      breadcrumb: folderId === null ? [] : await this.breadcrumb(folderId),
      folders: folders.sort(compareNames),
      connections: connections.sort(compareNames),
    };
  }

  private async connectionRow(id: string): Promise<ConnectionRow | null> {
    return this.db
      .prepare(
        `SELECT id, folder_id, payload_envelope, created_at, updated_at
         FROM connections WHERE id = ?`,
      )
      .bind(id)
      .first<ConnectionRow>();
  }

  private async decodeConnection(row: ConnectionRow): Promise<ConnectionConfig> {
    const parsed = JSON.parse(
      await decryptString(this.encryptionKey, row.payload_envelope),
    ) as ConnectionConfig;
    if (parsed.id !== row.id) throw new Error("connection id mismatch");
    return parsed;
  }

  private async folderRow(id: string): Promise<FolderRow | null> {
    return this.db.prepare("SELECT * FROM folders WHERE id = ?").bind(id).first<FolderRow>();
  }

  private async requireFolderRow(id: string): Promise<FolderRow> {
    const row = await this.folderRow(id);
    if (!row) throw new RecordNotFoundError();
    return row;
  }

  private async decodeFolder(row: FolderRow): Promise<FolderView> {
    return {
      id: row.id,
      parentId: row.parent_id,
      name: await decryptString(this.encryptionKey, row.name_envelope),
      recursiveHostCount: row.recursive_host_count,
      sortOrder: row.sort_order,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private async ancestorIds(folderId: string | null): Promise<string[]> {
    if (folderId === null) return [];
    const rows = await this.db
      .prepare(
        `WITH RECURSIVE ancestors(id, parent_id) AS (
           SELECT id, parent_id FROM folders WHERE id = ?
           UNION ALL
           SELECT f.id, f.parent_id FROM folders f
           JOIN ancestors a ON f.id = a.parent_id
         )
         SELECT id FROM ancestors`,
      )
      .bind(folderId)
      .all<{ id: string }>();
    return rows.results.map((row) => row.id);
  }

  private async countStatements(
    folderId: string | null,
    delta: number,
    now: number,
  ): Promise<D1PreparedStatement[]> {
    if (delta === 0) return [];
    return (await this.ancestorIds(folderId)).map((id) =>
      this.db
        .prepare(
          `UPDATE folders
           SET recursive_host_count = recursive_host_count + ?, updated_at = ?
           WHERE id = ?`,
        )
        .bind(delta, now, id),
    );
  }

  private async folderDepth(id: string): Promise<number> {
    return (await this.ancestorIds(id)).length;
  }

  private async descendantRows(id: string): Promise<DescendantRow[]> {
    const rows = await this.db
      .prepare(
        `WITH RECURSIVE descendants(id, depth) AS (
           SELECT id, 1 FROM folders WHERE id = ?
           UNION ALL
           SELECT f.id, d.depth + 1 FROM folders f
           JOIN descendants d ON f.parent_id = d.id
         )
         SELECT id, depth FROM descendants`,
      )
      .bind(id)
      .all<DescendantRow>();
    return rows.results;
  }

  private async folderSubtreeHeight(id: string): Promise<number> {
    const descendants = await this.descendantRows(id);
    return Math.max(...descendants.map((row) => row.depth));
  }

  private async isDescendant(
    candidateId: string | null,
    ancestorId: string,
  ): Promise<boolean> {
    if (candidateId === null) return false;
    return (await this.descendantRows(ancestorId)).some(
      (row) => row.id === candidateId,
    );
  }

  private async breadcrumb(id: string): Promise<FolderView[]> {
    const rows = await this.db
      .prepare(
        `WITH RECURSIVE ancestors(
           id, parent_id, name_envelope, name_token, recursive_host_count,
           sort_order, created_at, updated_at, depth
         ) AS (
           SELECT id, parent_id, name_envelope, name_token,
                  recursive_host_count, sort_order, created_at, updated_at, 0
           FROM folders WHERE id = ?
           UNION ALL
           SELECT f.id, f.parent_id, f.name_envelope, f.name_token,
                  f.recursive_host_count, f.sort_order, f.created_at,
                  f.updated_at, a.depth + 1
           FROM folders f JOIN ancestors a ON f.id = a.parent_id
         )
         SELECT id, parent_id, name_envelope, name_token,
                recursive_host_count, sort_order, created_at, updated_at
         FROM ancestors ORDER BY depth DESC`,
      )
      .bind(id)
      .all<FolderRow>();
    return Promise.all(rows.results.map((row) => this.decodeFolder(row)));
  }
}

export function _resetFolderTokenCache(): void {
  tokenKeyCache = new Map();
}
