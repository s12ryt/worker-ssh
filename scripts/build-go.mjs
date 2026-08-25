// 編譯後端 SSH 引擎為 Worker WebAssembly（GOOS=js GOARCH=wasm）
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url)) + "/..";
const workerOutDir = join(root, "dist", "worker");
mkdirSync(workerOutDir, { recursive: true });

const env = { ...process.env, GOOS: "js", GOARCH: "wasm" };
execFileSync("go", ["build", "-trimpath", "-ldflags", "-s -w", "-o", join(workerOutDir, "ssh.wasm"), "./..."], {
  cwd: join(root, "go-ssh"),
  env,
  stdio: "inherit",
});

// wasm_exec.js 由 GOROOT 提供（Go 執行環境膠水層）
const goroot = execFileSync("go", ["env", "GOROOT"], { encoding: "utf8" }).trim();
copyFileSync(join(goroot, "lib", "wasm", "wasm_exec.js"), join(workerOutDir, "wasm_exec.js"));
console.log("[build-go] ssh.wasm + wasm_exec.js -> dist/worker/");
