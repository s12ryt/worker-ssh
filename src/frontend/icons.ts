// OS 圖示映射：os id → simple-icons 向量路徑＋品牌色
import { OS_ICONS, type OsIconData } from "./icons-data";

/** Windows 備援圖示（simple-icons 因商標政策移除，自繪四格窗格） */
export const WINDOWS_FALLBACK: OsIconData = {
  path: "M3 5.5 10.5 4.4V11H3V5.5ZM11.5 4.2 21 3v8h-9.5V4.2ZM3 12.5h7.5v6.6L3 18V12.5ZM11.5 12.5H21v8.1l-9.5-1.3v-6.8Z",
  hex: "0078D6",
  title: "Windows",
};

/** 別名 → 規範化 os id */
const ALIASES: Record<string, string> = {
  apple: "macos",
  mac: "macos",
  macintosh: "macos",
  osx: "macos",
  win: "windows",
  rocky: "rockylinux",
  alma: "almalinux",
  arch: "archlinux",
  archarm: "archlinux",
  void: "voidlinux",
  "endeavour-os": "endeavouros",
  suse: "opensuse",
  "opensuse-leap": "opensuse",
  "opensuse-tumbleweed": "opensuse",
  "raspberry-pi": "raspbian",
  "raspberry-pi-os": "raspbian",
  rpi: "raspbian",
};

/** 取得指定 OS 的圖示資料；未知 os 回退 linux 圖示 */
export function iconForOs(osId: string): OsIconData {
  const key = ALIASES[osId.trim().toLowerCase()] ?? osId.trim().toLowerCase();
  if (key === "windows") return WINDOWS_FALLBACK;
  return OS_ICONS[key] ?? OS_ICONS["linux"]!;
}
