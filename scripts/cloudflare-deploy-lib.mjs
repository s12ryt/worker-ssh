import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

export const REQUIRED_DEPLOYMENT_SECRETS = Object.freeze([
  "CLOUDFLARE_API_TOKEN",
  "CLOUDFLARE_ACCOUNT_ID",
  "PANEL_PASSWORD",
  "ENCRYPTION_KEY",
]);

export const DEPLOYMENT_NAMES = Object.freeze({
  worker: "worker-ssh",
  d1: "worker-ssh-db",
  kv: "worker-ssh-kv",
});

export class MissingDeploymentSecretsError extends Error {
  constructor(names) {
    super(`Missing required deployment secrets: ${names.join(", ")}`);
    this.name = "MissingDeploymentSecretsError";
  }
}

export class CloudflareApiError extends Error {
  constructor(message) {
    super(message);
    this.name = "CloudflareApiError";
  }
}

export function validateDeploymentEnv(env) {
  const missing = REQUIRED_DEPLOYMENT_SECRETS.filter((name) => {
    const value = env[name];
    return typeof value !== "string" || value.length === 0;
  });
  if (missing.length > 0) throw new MissingDeploymentSecretsError(missing);

  return {
    accountId: env.CLOUDFLARE_ACCOUNT_ID,
    apiToken: env.CLOUDFLARE_API_TOKEN,
    panelPassword: env.PANEL_PASSWORD,
    encryptionKey: env.ENCRYPTION_KEY,
  };
}

export class CloudflareApi {
  constructor({ accountId, apiToken, fetchImpl = fetch }) {
    this.accountId = accountId;
    this.apiToken = apiToken;
    this.fetchImpl = fetchImpl;
  }

  async #call(path, init = {}) {
    const method = init.method ?? "GET";
    let response;
    try {
      response = await this.fetchImpl(`https://api.cloudflare.com/client/v4${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${this.apiToken}`,
          ...(init.body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
      });
    } catch {
      throw new CloudflareApiError(
        `Cloudflare API request failed for ${method} ${path}`,
      );
    }

    let payload;
    try {
      payload = await response.json();
    } catch {
      throw new CloudflareApiError(
        `Cloudflare API returned invalid JSON for ${method} ${path}: HTTP ${response.status}`,
      );
    }

    if (!response.ok || payload?.success !== true) {
      const codes = Array.isArray(payload?.errors)
        ? payload.errors
            .map((error) => error?.code)
            .filter((code) => code !== undefined)
            .join(",")
        : "unknown";
      throw new CloudflareApiError(
        `Cloudflare API request failed for ${method} ${path}: HTTP ${response.status}; codes=${codes || "unknown"}`,
      );
    }

    return payload;
  }

  async request(path, init = {}) {
    const payload = await this.#call(path, init);
    return payload.result;
  }

  async listAll(path) {
    const results = [];
    for (let page = 1; page <= 100; page += 1) {
      const separator = path.includes("?") ? "&" : "?";
      const payload = await this.#call(`${path}${separator}page=${page}&per_page=100`);
      if (!Array.isArray(payload.result)) {
        throw new CloudflareApiError(`Cloudflare API list response was not an array for ${path}`);
      }
      results.push(...payload.result);

      const totalPages = Number(payload.result_info?.total_pages ?? 1);
      if (!Number.isFinite(totalPages) || page >= totalPages) return results;
    }
    throw new CloudflareApiError(`Cloudflare API pagination exceeded 100 pages for ${path}`);
  }
}

function selectUnique(items, name, { label, nameOf, idOf }) {
  const matches = items.filter((item) => nameOf(item) === name);
  if (matches.length > 1) {
    throw new CloudflareApiError(`Found multiple ${label} named ${name}`);
  }
  if (matches.length === 0) return null;

  const id = idOf(matches[0]);
  if (typeof id !== "string" || id.length === 0) {
    throw new CloudflareApiError(`${label} named ${name} did not include an ID`);
  }
  return id;
}

export async function ensureD1Database(api, accountId, name) {
  const path = `/accounts/${encodeURIComponent(accountId)}/d1/database`;
  const existing = selectUnique(await api.listAll(path), name, {
    label: "D1 databases",
    nameOf: (item) => item?.name,
    idOf: (item) => item?.uuid,
  });
  if (existing !== null) return { id: existing, action: "reused" };

  const created = await api.request(path, { method: "POST", body: { name } });
  if (typeof created?.uuid !== "string" || created.uuid.length === 0) {
    throw new CloudflareApiError(`Created D1 database ${name} did not include an ID`);
  }
  return { id: created.uuid, action: "created" };
}

export async function ensureKvNamespace(api, accountId, title) {
  const path = `/accounts/${encodeURIComponent(accountId)}/storage/kv/namespaces`;
  const existing = selectUnique(await api.listAll(path), title, {
    label: "KV namespaces",
    nameOf: (item) => item?.title,
    idOf: (item) => item?.id,
  });
  if (existing !== null) return { id: existing, action: "reused" };

  const created = await api.request(path, { method: "POST", body: { title } });
  if (typeof created?.id !== "string" || created.id.length === 0) {
    throw new CloudflareApiError(`Created KV namespace ${title} did not include an ID`);
  }
  return { id: created.id, action: "created" };
}

export function buildDeploymentConfig({ d1Id, kvId }) {
  return {
    $schema: "../node_modules/wrangler/config-schema.json",
    name: DEPLOYMENT_NAMES.worker,
    main: "../dist/worker/index.js",
    compatibility_date: "2026-08-01",
    assets: {
      directory: "../dist/client",
      binding: "ASSETS",
    },
    kv_namespaces: [{ binding: "KV", id: kvId }],
    d1_databases: [
      {
        binding: "DB",
        database_name: DEPLOYMENT_NAMES.d1,
        database_id: d1Id,
      },
    ],
    durable_objects: {
      bindings: [
        { name: "SSH_SESSIONS", class_name: "SshSessionObject" },
        { name: "SSH_QUOTA", class_name: "SshQuotaObject" },
      ],
    },
    migrations: [
      { tag: "v1", new_sqlite_classes: ["SshSessionObject"] },
      { tag: "v2", new_sqlite_classes: ["SshQuotaObject"] },
    ],
    observability: { enabled: true },
    secrets: { required: ["PANEL_PASSWORD", "ENCRYPTION_KEY"] },
  };
}

export function buildWorkerSecrets(env) {
  return {
    PANEL_PASSWORD: env.PANEL_PASSWORD,
    ENCRYPTION_KEY: env.ENCRYPTION_KEY,
  };
}

export async function writeDeploymentFiles({ env, d1Id, kvId, outputDir }) {
  await mkdir(outputDir, { recursive: true });
  const configPath = join(outputDir, "wrangler.json");
  const secretsPath = join(outputDir, "secrets.json");
  await writeFile(
    configPath,
    `${JSON.stringify(buildDeploymentConfig({ d1Id, kvId }), null, 2)}\n`,
    { encoding: "utf8", mode: 0o600 },
  );
  await writeFile(
    secretsPath,
    `${JSON.stringify(buildWorkerSecrets(env), null, 2)}\n`,
    { encoding: "utf8", mode: 0o600 },
  );
  return { configPath, secretsPath };
}

export async function prepareDeployment({ env, outputDir, api }) {
  const validated = validateDeploymentEnv(env);
  const cloudflareApi =
    api ??
    new CloudflareApi({
      accountId: validated.accountId,
      apiToken: validated.apiToken,
    });

  const [d1, kv] = await Promise.all([
    ensureD1Database(cloudflareApi, validated.accountId, DEPLOYMENT_NAMES.d1),
    ensureKvNamespace(cloudflareApi, validated.accountId, DEPLOYMENT_NAMES.kv),
  ]);
  const files = await writeDeploymentFiles({
    env,
    d1Id: d1.id,
    kvId: kv.id,
    outputDir,
  });

  return {
    ...files,
    d1Action: d1.action,
    kvAction: kv.action,
  };
}

export async function cleanupDeploymentFiles(path) {
  await rm(path, { recursive: true, force: true });
}
