import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import test from "node:test";

const ROOT = resolve(import.meta.dirname, "../../..");

async function read(relativePath) {
  return readFile(resolve(ROOT, relativePath), "utf8");
}

async function sourceFiles(directory) {
  const entries = await readdir(resolve(ROOT, directory), { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const relative = `${directory}/${entry.name}`;
    if (entry.isDirectory()) files.push(...(await sourceFiles(relative)));
    else files.push(relative);
  }
  return files;
}

test("deployment CLI 提供 prepare、cleanup 與 help", () => {
  const result = spawnSync(
    process.execPath,
    [resolve(ROOT, "scripts/cloudflare-deploy.mjs"), "--help"],
    { cwd: ROOT, encoding: "utf8", timeout: 10_000 },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /prepare/);
  assert.match(result.stdout, /cleanup/);
  assert.doesNotMatch(`${result.stdout}${result.stderr}`, /PANEL_PASSWORD=.*|ENCRYPTION_KEY=.*/);
});

test("GitHub Actions 僅允許手動部署並以最小權限執行完整驗證", async () => {
  const workflow = await read(".github/workflows/deploy-cloudflare.yml");

  assert.match(workflow, /^name: Deploy to Cloudflare$/m);
  assert.match(workflow, /^on:\s*\n\s+workflow_dispatch:\s*$/m);
  assert.doesNotMatch(workflow, /^\s+(push|pull_request|schedule):/m);
  assert.match(workflow, /^permissions:\s*\n\s+contents: read\s*$/m);
  assert.match(workflow, /concurrency:/);
  assert.match(workflow, /timeout-minutes:/);
  assert.match(workflow, /npm ci/);
  assert.match(workflow, /npm test/);
  assert.match(workflow, /npm run typecheck/);
  assert.match(workflow, /npm run build/);
  assert.match(workflow, /npm run check:split/);
});

test("專案與 workflow 在 npm ci 前固定使用 npm 11.7.0", async () => {
  const [packageJsonText, workflow] = await Promise.all([
    read("package.json"),
    read(".github/workflows/deploy-cloudflare.yml"),
  ]);
  const packageJson = JSON.parse(packageJsonText);

  assert.equal(packageJson.packageManager, "npm@11.7.0");

  const installIndex = workflow.indexOf("npm install --global npm@11.7.0");
  const verifyIndex = workflow.indexOf('test "$(npm --version)" = "11.7.0"');
  const ciIndex = workflow.indexOf("npm ci");

  assert.ok(installIndex >= 0, "workflow 必須安裝 npm 11.7.0");
  assert.ok(verifyIndex >= 0, "workflow 必須驗證 npm 11.7.0");
  assert.ok(ciIndex >= 0, "workflow 必須執行 npm ci");
  assert.ok(installIndex < verifyIndex, "必須先安裝再驗證 npm 版本");
  assert.ok(verifyIndex < ciIndex, "必須在 npm ci 前驗證 npm 版本");
});

test("workflow 先建立 Go WASM 與前端產物再執行完整測試", async () => {
  const workflow = await read(".github/workflows/deploy-cloudflare.yml");
  const ciIndex = workflow.indexOf("npm ci");
  const buildIndex = workflow.indexOf("npm run build");
  const splitIndex = workflow.indexOf("npm run check:split");
  const testIndex = workflow.indexOf("npm test");

  assert.ok(ciIndex >= 0, "workflow 必須執行 npm ci");
  assert.ok(buildIndex >= 0, "workflow 必須執行完整 build");
  assert.ok(splitIndex >= 0, "workflow 必須執行拆包檢查");
  assert.ok(testIndex >= 0, "workflow 必須執行完整測試");
  assert.ok(ciIndex < buildIndex, "必須先安裝依賴再建置");
  assert.ok(buildIndex < splitIndex, "拆包檢查必須在建置之後");
  assert.ok(splitIndex < testIndex, "必須先產生 Go WASM 與建置產物，再啟動 Worker 測試");
});

test("Worker 測試使用已提交的最小 assets fixture", async () => {
  const [wranglerTest, fixture] = await Promise.all([
    read("wrangler.test.jsonc"),
    read("test/fixtures/assets/index.html"),
  ]);

  assert.match(wranglerTest, /"directory": "test\/fixtures\/assets"/);
  assert.match(fixture, /data-worker-ssh-test-assets/);
  assert.doesNotMatch(wranglerTest, /"directory": "dist\/client"/);
});

test("workflow 以 repository secrets 準備資源、部署並無條件清理暫存檔", async () => {
  const workflow = await read(".github/workflows/deploy-cloudflare.yml");

  for (const name of [
    "CLOUDFLARE_API_TOKEN",
    "CLOUDFLARE_ACCOUNT_ID",
    "PANEL_PASSWORD",
    "ENCRYPTION_KEY",
  ]) {
    const expression = `${name}: \\$\\{\\{ secrets\\.${name} \\}\\}`;
    assert.match(workflow, new RegExp(expression));
  }
  assert.match(workflow, /node scripts\/cloudflare-deploy\.mjs prepare/);
  assert.match(
    workflow,
    /wrangler deploy --config \.cloudflare-deploy\/wrangler\.json --secrets-file \.cloudflare-deploy\/secrets\.json/,
  );
  assert.match(workflow, /if: \$\{\{ always\(\) \}\}/);
  assert.match(workflow, /node scripts\/cloudflare-deploy\.mjs cleanup/);
  assert.doesNotMatch(workflow, /\.dev\.vars/);
});

test("README 完整說明一鍵部署、四個 secrets 與不遷移本機資料", async () => {
  const readme = await read("README.md");

  assert.match(readme, /GitHub Actions/);
  assert.match(readme, /Deploy to Cloudflare/);
  assert.match(readme, /workflow_dispatch/);
  assert.match(readme, /worker-ssh-db/);
  assert.match(readme, /worker-ssh-kv/);
  for (const name of [
    "CLOUDFLARE_API_TOKEN",
    "CLOUDFLARE_ACCOUNT_ID",
    "PANEL_PASSWORD",
    "ENCRYPTION_KEY",
  ]) {
    assert.match(readme, new RegExp(name));
  }
  assert.match(readme, /不會.*本機.*資料/);
  assert.match(readme, /Workers Scripts.*Edit/);
  assert.match(readme, /D1.*Edit/);
  assert.match(readme, /Workers KV Storage.*Edit/);
});

test("公開庫採 MIT License 且忽略本機 secrets、state、驗證產物與部署暫存", async () => {
  const [license, gitignore] = await Promise.all([read("LICENSE"), read(".gitignore")]);

  assert.match(license, /^MIT License/m);
  assert.match(license, /Copyright \(c\) 2026 s12ryt/);
  for (const entry of [
    ".dev.vars",
    ".wrangler/",
    ".playwright-mcp/",
    ".cloudflare-deploy/",
    "dist/",
    "node_modules/",
    "*.log",
    "swap-monitor-network.txt",
  ]) {
    assert.match(gitignore, new RegExp(entry.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});

test("公開來源不內嵌任何 private-key PEM block", async () => {
  const marker = ["-----BEGIN OPENSSH ", "PRIVATE KEY-----"].join("");
  const files = (
    await Promise.all(
      ["src", "test", "go-ssh", "scripts", "agent", ".github"].map(sourceFiles),
    )
  ).flat();
  const matches = [];
  for (const file of files) {
    if (!/\.(?:go|ts|mjs|js|json|jsonc|md|yml|yaml|txt)$/.test(file)) continue;
    if ((await read(file)).includes(marker)) matches.push(file);
  }
  assert.deepEqual(matches, []);
});

test("npm test 會包含 deployment contract", async () => {
  const packageJson = JSON.parse(await read("package.json"));
  assert.equal(
    packageJson.scripts["test:deployment"],
    "node --test test/unit/deployment/*.test.mjs",
  );
  assert.match(packageJson.scripts.test, /test:deployment/);
});
