// 驗證 code splitting 產物：終端機模組必須在延遲 chunk 中，而非進入點 app.js
// 用法：node scripts/check-split.mjs（於 npm run build 後執行）
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const clientDir = join(root, "dist", "client");
const MARKER = "Cascadia Code"; // terminal.ts 內的字串常數，可作為終端機模組指紋

function fail(msg) {
  console.error(`[check-split] FAIL：${msg}`);
  process.exit(1);
}

let entry;
try {
  entry = readFileSync(join(clientDir, "app.js"), "utf8");
} catch {
  fail("找不到 dist/client/app.js，請先執行 npm run build:client");
}

if (entry.includes(MARKER)) {
  fail("app.js 含終端機模組指紋，xterm 未被分割出去");
}

for (const artifact of ["wasm/ssh.wasm", "wasm/wasm_exec.js"]) {
  if (existsSync(join(clientDir, artifact))) {
    fail(`前端產物仍含已停用的 Browser SSH runtime：${artifact}`);
  }
}

// 延遲 chunk：esbuild 以「模組名-hash」或「chunk-hash」命名；掃描進入點以外的所有 JS
const chunks = readdirSync(clientDir).filter(
  (f) => f.endsWith(".js") && f !== "app.js",
);
const hit = chunks.filter((f) =>
  readFileSync(join(clientDir, f), "utf8").includes(MARKER),
);
if (hit.length === 0) {
  fail(`未在任何 chunk-${"*"}.js 找到終端機模組指紋`);
}

const kb = (f) => Math.round(statSync(join(clientDir, f)).size / 102.4) / 10;
console.log(
  `[check-split] OK：app.js ${kb("app.js")}KB；終端機位於 ${hit.map((h) => `${h} ${kb(h)}KB`).join(", ")}`,
);
