// SFTP 路徑工具（純函式）

/** 目錄與名稱串接為絕對路徑（根目錄不產生雙斜線） */
export function joinPath(dir: string, name: string): string {
  if (dir.endsWith("/")) return `${dir}${name}`;
  return `${dir}/${name}`;
}

/** 回上一層；根目錄的父層仍是根目錄 */
export function parentOf(path: string): string {
  if (path === "/" || path === "") return "/";
  const idx = path.lastIndexOf("/");
  if (idx <= 0) return "/";
  return path.slice(0, idx);
}
