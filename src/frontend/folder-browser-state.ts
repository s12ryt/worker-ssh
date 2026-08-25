import type { FolderScopeView, FolderView } from "@/shared/types";

export interface BreadcrumbItem {
  id: string | null;
  name: string;
}

export interface FolderMoveTarget {
  id: string | null;
  name: string;
}

export function rootBreadcrumb(scope: FolderScopeView): BreadcrumbItem[] {
  return [
    { id: null, name: "未分類" },
    ...scope.breadcrumb.map((folder) => ({ id: folder.id, name: folder.name })),
  ];
}

function descendantIds(folders: readonly FolderView[], rootId: string): Set<string> {
  const descendants = new Set<string>([rootId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const folder of folders) {
      if (folder.parentId !== null && descendants.has(folder.parentId) && !descendants.has(folder.id)) {
        descendants.add(folder.id);
        changed = true;
      }
    }
  }
  return descendants;
}

export function folderMoveTargets(
  folders: readonly FolderView[],
  movingFolderId?: string,
): FolderMoveTarget[] {
  const excluded = movingFolderId ? descendantIds(folders, movingFolderId) : new Set<string>();
  const targets = folders
    .filter((folder) => !excluded.has(folder.id))
    .map((folder) => ({ id: folder.id, name: folder.name }))
    .sort((a, b) => a.name.localeCompare(b.name, "zh-Hant", { sensitivity: "base" }));
  return [{ id: null, name: "未分類" }, ...targets];
}

export class FolderBrowserState {
  currentFolderId: string | null = null;
  private selected = new Set<string>();

  replaceScope(scope: FolderScopeView): void {
    const nextFolderId = scope.folder?.id ?? null;
    if (nextFolderId !== this.currentFolderId) {
      this.selected.clear();
    } else {
      // 同資料夾重拉清單（例如其他分頁同步後）：修剪已不在清單內的選取，
      // 避免全選判定與計數把清單外的幽靈 id 算進去。
      const visible = new Set(scope.connections.map((conn) => conn.id));
      for (const id of this.selected) {
        if (!visible.has(id)) this.selected.delete(id);
      }
    }
    this.currentFolderId = nextFolderId;
  }

  toggleConnection(id: string, selected: boolean): void {
    if (selected) this.selected.add(id);
    else this.selected.delete(id);
  }

  clearSelection(): void {
    this.selected.clear();
  }

  /** 提供 visibleIds 時只回傳與當前清單的交集（顯示層雙保險）。 */
  selectedConnectionIds(visibleIds?: readonly string[]): string[] {
    if (!visibleIds) return [...this.selected];
    const visible = new Set(visibleIds);
    return [...this.selected].filter((id) => visible.has(id));
  }
}
