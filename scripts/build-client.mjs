// 前端打包：esbuild bundle main.ts -> dist/client/app.js，並複製靜態資源
import { build } from "esbuild";
import { copyFileSync, cpSync, mkdirSync, readdirSync, rmSync, unlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "dist", "client");
mkdirSync(outDir, { recursive: true });
rmSync(join(outDir, "wasm"), { recursive: true, force: true });
// 清除前次建置的 JS 產物（含舊 hash chunk），避免殘留檔混淆
for (const f of readdirSync(outDir)) {
  if (f.endsWith(".js")) unlinkSync(join(outDir, f));
}

await build({
  entryPoints: [join(root, "src/frontend/main.ts")],
  bundle: true,
  format: "esm",
  target: "es2022",
  outdir: outDir,
  entryNames: "app", // index.html 以 ./app.js 引用進入點
  // code splitting：xterm 等僅在進入工作階段時載入（動態 import 產生獨立 chunk）
  splitting: true,
  metafile: true,
  minify: true,
  sourcemap: false,
  legalComments: "none",
  define: { "process.env.NODE_ENV": '"production"' },
});

copyFileSync(join(root, "src/frontend/index.html"), join(outDir, "index.html"));
cpSync(join(root, "src/frontend/styles"), join(outDir, "styles"), { recursive: true });

// 字型自托管（D21）：從 @fontsource 套件複製精簡字重 woff2 至 dist/client/fonts/
// Inter latin 400/600/700（~23KB/字重）；Noto Sans TC 全字符 400/600（~974KB/字重）
// font-display: swap 確保下載前以系統字型 fallback，下載後無重複請求
const fontsDir = join(outDir, "fonts");
mkdirSync(fontsDir, { recursive: true });
const fontFiles = [
  ["node_modules/@fontsource/inter/files/inter-latin-400-normal.woff2", "inter-latin-400-normal.woff2"],
  ["node_modules/@fontsource/inter/files/inter-latin-600-normal.woff2", "inter-latin-600-normal.woff2"],
  ["node_modules/@fontsource/inter/files/inter-latin-700-normal.woff2", "inter-latin-700-normal.woff2"],
  ["node_modules/@fontsource/noto-sans-tc/files/noto-sans-tc-chinese-traditional-400-normal.woff2", "noto-sans-tc-400-normal.woff2"],
  ["node_modules/@fontsource/noto-sans-tc/files/noto-sans-tc-chinese-traditional-600-normal.woff2", "noto-sans-tc-600-normal.woff2"],
];
const missingFonts = [];
for (const [src, dest] of fontFiles) {
  try {
    copyFileSync(join(root, src), join(fontsDir, dest));
  } catch {
    missingFonts.push(src);
  }
}
if (missingFonts.length) {
  console.warn(`[build-client] 警告：字型檔缺失，請執行 npm install：\n  ${missingFonts.join("\n  ")}`);
}
console.log("[build-client] dist/client/ 已產出");
