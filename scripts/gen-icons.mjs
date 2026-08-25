// 從 simple-icons（CC0 授權）擷取作業系統品牌圖示，產生 src/frontend/icons-data.ts
import * as si from "simple-icons";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

// key = 專案內部規範化 OS id；slug = simple-icons 套件匯出名稱
const wanted = [
  ["linux", "siLinux"],
  ["ubuntu", "siUbuntu"],
  ["debian", "siDebian"],
  ["centos", "siCentos"],
  ["rockylinux", "siRockylinux"],
  ["almalinux", "siAlmalinux"],
  ["fedora", "siFedora"],
  ["archlinux", "siArchlinux"],
  ["alpine", "siAlpinelinux"],
  ["opensuse", "siOpensuse"],
  ["gentoo", "siGentoo"],
  ["nixos", "siNixos"],
  ["manjaro", "siManjaro"],
  ["kali", "siKalilinux"],
  ["raspbian", "siRaspberrypi"],
  ["macos", "siApple"],
  ["freebsd", "siFreebsd"],
  ["openbsd", "siOpenbsd"],
  ["netbsd", "siNetbsd"],
  ["windows", "siWindows"],
  ["voidlinux", "siVoidlinux"],
  ["endeavouros", "siEndeavouros"],
];

const lines = [];
let ok = 0;
for (const [key, exportName] of wanted) {
  const icon = si[exportName];
  if (!icon) {
    console.warn(`[gen-icons] 找不到 ${exportName}，略過`);
    continue;
  }
  ok++;
  lines.push(
    `  "${key}": { path: ${JSON.stringify(icon.path)}, hex: "${icon.hex}", title: ${JSON.stringify(icon.title)} },`
  );
}

const out = `// 本檔由 scripts/gen-icons.mjs 自動產生（來源：simple-icons，CC0 授權）
// 圖示為官方商標的向量形狀（單色），以品牌色渲染。
export interface OsIconData {
  /** SVG path（24x24 viewBox） */
  path: string;
  /** 品牌色（hex，不含 #） */
  hex: string;
  /** 品牌名稱 */
  title: string;
}

export const OS_ICONS: Record<string, OsIconData> = {
${lines.join("\n")}
};
`;

const outDir = join(root, "src", "frontend");
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "icons-data.ts"), out);
console.log(`[gen-icons] 已寫入 ${ok}/${wanted.length} 個圖示 -> src/frontend/icons-data.ts`);
