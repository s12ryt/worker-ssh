import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  CloudflareApi,
  buildDeploymentConfig,
  buildWorkerSecrets,
  cleanupDeploymentFiles,
  ensureD1Database,
  ensureKvNamespace,
  prepareDeployment,
  validateDeploymentEnv,
} from "../../../scripts/cloudflare-deploy-lib.mjs";

const VALID_ENV = {
  CLOUDFLARE_ACCOUNT_ID: "account-123",
  CLOUDFLARE_API_TOKEN: "token-secret-value",
  PANEL_PASSWORD: "panel-secret-value",
  ENCRYPTION_KEY: "encryption-secret-value",
};

function fakeApi({ d1 = [], kv = [], createdD1, createdKv } = {}) {
  const calls = [];
  return {
    calls,
    async listAll(path) {
      calls.push({ method: "GET", path });
      if (path.includes("/d1/database")) return d1;
      if (path.includes("/storage/kv/namespaces")) return kv;
      throw new Error(`unexpected list path ${path}`);
    },
    async request(path, init) {
      calls.push({ method: init.method, path, body: init.body });
      if (path.includes("/d1/database")) return createdD1;
      if (path.includes("/storage/kv/namespaces")) return createdKv;
      throw new Error(`unexpected request path ${path}`);
    },
  };
}

test("缺少任何 deployment secret 時會列出名稱但不洩漏值", () => {
  assert.throws(
    () => validateDeploymentEnv({ CLOUDFLARE_API_TOKEN: "do-not-print" }),
    (error) => {
      assert.match(error.message, /CLOUDFLARE_ACCOUNT_ID/);
      assert.match(error.message, /PANEL_PASSWORD/);
      assert.match(error.message, /ENCRYPTION_KEY/);
      assert.doesNotMatch(error.message, /do-not-print/);
      return true;
    },
  );
});

test("同名 D1 已存在時直接重用，不發出建立請求", async () => {
  const api = fakeApi({
    d1: [{ name: "worker-ssh-db", uuid: "d1-existing" }],
  });

  const result = await ensureD1Database(api, "account-123", "worker-ssh-db");

  assert.deepEqual(result, { id: "d1-existing", action: "reused" });
  assert.deepEqual(api.calls, [
    { method: "GET", path: "/accounts/account-123/d1/database" },
  ]);
});

test("缺少 D1 時建立一次並回傳新 ID", async () => {
  const api = fakeApi({
    createdD1: { name: "worker-ssh-db", uuid: "d1-created" },
  });

  const result = await ensureD1Database(api, "account-123", "worker-ssh-db");

  assert.deepEqual(result, { id: "d1-created", action: "created" });
  assert.deepEqual(api.calls[1], {
    method: "POST",
    path: "/accounts/account-123/d1/database",
    body: { name: "worker-ssh-db" },
  });
});

test("同名 D1 出現多筆時安全中止，不猜測要使用哪一筆", async () => {
  const api = fakeApi({
    d1: [
      { name: "worker-ssh-db", uuid: "d1-a" },
      { name: "worker-ssh-db", uuid: "d1-b" },
    ],
  });

  await assert.rejects(
    ensureD1Database(api, "account-123", "worker-ssh-db"),
    /multiple D1 databases named worker-ssh-db/,
  );
  assert.equal(api.calls.length, 1);
});

test("KV namespace 可重用或建立，且只比對完整名稱", async () => {
  const existingApi = fakeApi({
    kv: [
      { title: "worker-ssh-kv-preview", id: "kv-preview" },
      { title: "worker-ssh-kv", id: "kv-existing" },
    ],
  });
  const createdApi = fakeApi({
    createdKv: { title: "worker-ssh-kv", id: "kv-created" },
  });

  assert.deepEqual(
    await ensureKvNamespace(existingApi, "account-123", "worker-ssh-kv"),
    { id: "kv-existing", action: "reused" },
  );
  assert.deepEqual(
    await ensureKvNamespace(createdApi, "account-123", "worker-ssh-kv"),
    { id: "kv-created", action: "created" },
  );
  assert.deepEqual(createdApi.calls[1], {
    method: "POST",
    path: "/accounts/account-123/storage/kv/namespaces",
    body: { title: "worker-ssh-kv" },
  });
});

test("deployment config 只注入指定 D1/KV 並保留 assets 與 DO migrations", () => {
  const config = buildDeploymentConfig({
    d1Id: "d1-production",
    kvId: "kv-production",
  });

  assert.equal(config.name, "worker-ssh");
  assert.equal(config.main, "../dist/worker/index.js");
  assert.deepEqual(config.assets, {
    directory: "../dist/client",
    binding: "ASSETS",
  });
  assert.deepEqual(config.kv_namespaces, [
    { binding: "KV", id: "kv-production" },
  ]);
  assert.deepEqual(config.d1_databases, [
    {
      binding: "DB",
      database_name: "worker-ssh-db",
      database_id: "d1-production",
    },
  ]);
  assert.deepEqual(config.durable_objects.bindings, [
    { name: "SSH_SESSIONS", class_name: "SshSessionObject" },
    { name: "SSH_QUOTA", class_name: "SshQuotaObject" },
  ]);
  assert.deepEqual(config.migrations, [
    { tag: "v1", new_sqlite_classes: ["SshSessionObject"] },
    { tag: "v2", new_sqlite_classes: ["SshQuotaObject"] },
  ]);
  assert.deepEqual(config.secrets.required, [
    "PANEL_PASSWORD",
    "ENCRYPTION_KEY",
  ]);
  assert.doesNotMatch(JSON.stringify(config), /REPLACE_WITH|00000000-0000/);
});

test("Worker secrets 檔只包含面板與資料加密金鑰", () => {
  assert.deepEqual(buildWorkerSecrets(VALID_ENV), {
    PANEL_PASSWORD: "panel-secret-value",
    ENCRYPTION_KEY: "encryption-secret-value",
  });
});

test("Cloudflare API 錯誤不包含 token 或遠端回應中的敏感文字", async () => {
  const api = new CloudflareApi({
    accountId: "account-123",
    apiToken: "token-secret-value",
    fetchImpl: async () =>
      new Response(
        JSON.stringify({
          success: false,
          errors: [{ code: 10000, message: "token-secret-value is invalid" }],
        }),
        { status: 403, headers: { "content-type": "application/json" } },
      ),
  });

  await assert.rejects(api.listAll("/accounts/account-123/d1/database"), (error) => {
    assert.match(error.message, /HTTP 403/);
    assert.match(error.message, /10000/);
    assert.doesNotMatch(error.message, /token-secret-value/);
    assert.doesNotMatch(error.message, /is invalid/);
    return true;
  });
});

test("prepare 會建立隔離的 config／secret 檔且不寫入 API token", async () => {
  const parent = await mkdtemp(join(tmpdir(), "worker-ssh-deploy-test-"));
  const outputDir = join(parent, ".cloudflare-deploy");
  const api = fakeApi({
    d1: [{ name: "worker-ssh-db", uuid: "d1-existing" }],
    createdKv: { title: "worker-ssh-kv", id: "kv-created" },
  });

  try {
    const result = await prepareDeployment({ env: VALID_ENV, outputDir, api });
    const config = JSON.parse(await readFile(result.configPath, "utf8"));
    const secrets = JSON.parse(await readFile(result.secretsPath, "utf8"));

    assert.equal(result.d1Action, "reused");
    assert.equal(result.kvAction, "created");
    assert.equal(config.d1_databases[0].database_id, "d1-existing");
    assert.equal(config.kv_namespaces[0].id, "kv-created");
    assert.deepEqual(secrets, {
      PANEL_PASSWORD: "panel-secret-value",
      ENCRYPTION_KEY: "encryption-secret-value",
    });
    assert.doesNotMatch(JSON.stringify(config), /token-secret-value/);
    assert.doesNotMatch(JSON.stringify(secrets), /token-secret-value/);
    assert.doesNotMatch(JSON.stringify(secrets), /account-123/);
  } finally {
    await cleanupDeploymentFiles(parent);
  }
});

test("cleanup 可冪等移除一次性部署目錄", async () => {
  const parent = await mkdtemp(join(tmpdir(), "worker-ssh-deploy-cleanup-"));
  const outputDir = join(parent, ".cloudflare-deploy");
  const api = fakeApi({
    d1: [{ name: "worker-ssh-db", uuid: "d1-existing" }],
    kv: [{ title: "worker-ssh-kv", id: "kv-existing" }],
  });

  await prepareDeployment({ env: VALID_ENV, outputDir, api });
  await cleanupDeploymentFiles(outputDir);
  await cleanupDeploymentFiles(outputDir);
  await assert.rejects(readFile(join(outputDir, "wrangler.json"), "utf8"), {
    code: "ENOENT",
  });
  await cleanupDeploymentFiles(parent);
});
