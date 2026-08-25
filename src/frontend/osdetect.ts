// OS 偵測：組合偵測指令與解析輸出（純函式，可測）
import type { OsInfo } from "../shared/types";

/** 產生一次性 OS 偵測指令（在目標主機 shell 執行） */
export function buildDetectCommand(): string {
  return [
    "echo ===UNAME===",
    "uname -s",
    "uname -r",
    "echo ===OSREL===",
    "cat /etc/os-release 2>/dev/null | head -20",
  ].join("; ");
}

/** Linux 發行版 ID → 規範化 os id（對應 icons-data 鍵） */
const LINUX_ID_MAP: Record<string, string> = {
  ubuntu: "ubuntu",
  debian: "debian",
  centos: "centos",
  rocky: "rockylinux",
  rockylinux: "rockylinux",
  alma: "almalinux",
  almalinux: "almalinux",
  fedora: "fedora",
  arch: "archlinux",
  archlinux: "archlinux",
  archarm: "archlinux",
  alpine: "alpine",
  opensuse: "opensuse",
  "opensuse-leap": "opensuse",
  "opensuse-tumbleweed": "opensuse",
  suse: "opensuse",
  gentoo: "gentoo",
  nixos: "nixos",
  manjaro: "manjaro",
  kali: "kali",
  raspbian: "raspbian",
  void: "voidlinux",
  voidlinux: "voidlinux",
  endeavouros: "endeavouros",
};

/** 解析 os-release 內容為 key→value（去引號） */
function parseOsRelease(block: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of block.split("\n")) {
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
    if (key) out[key] = value;
  }
  return out;
}

/**
 * 解析 buildDetectCommand 的輸出。
 * 無法辨識（缺 ===UNAME=== 標記或空輸出）回 null。
 */
export function parseDetectOutput(output: string, now?: Date): OsInfo | null {
  const unameIdx = output.indexOf("===UNAME===");
  if (unameIdx < 0) return null;

  const afterUname = output.slice(unameIdx + "===UNAME===".length);
  const osrelIdx = afterUname.indexOf("===OSREL===");
  const unameBlock = osrelIdx >= 0 ? afterUname.slice(0, osrelIdx) : afterUname;
  const osrelBlock = osrelIdx >= 0 ? afterUname.slice(osrelIdx + "===OSREL===".length) : "";

  const lines = unameBlock
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  const kernel = lines[0] ?? "";
  const release = lines[1] ?? "";
  if (!kernel) return null;

  const detectedAt = (now ?? new Date()).getTime();
  const version = release || undefined;

  if (kernel === "Darwin") {
    return { os: "macos", family: "darwin", version, detectedAt };
  }
  if (kernel === "FreeBSD" || kernel === "OpenBSD" || kernel === "NetBSD") {
    return { os: kernel.toLowerCase(), family: "bsd", version, detectedAt };
  }
  if (kernel === "Linux") {
    const rel = parseOsRelease(osrelBlock);
    const id = (rel["ID"] ?? "").toLowerCase();
    const canonical = LINUX_ID_MAP[id];
    const distro =
      rel["PRETTY_NAME"] || rel["NAME"] || rel["ID"] || rel["ID_LIKE"]?.split(/\s+/)[0] || undefined;
    return {
      os: canonical ?? "linux",
      family: "linux",
      distro,
      version: rel["VERSION_ID"] || undefined,
      detectedAt,
    };
  }
  return { os: "unknown", family: "unknown", version, detectedAt };
}
