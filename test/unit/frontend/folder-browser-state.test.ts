import { describe, expect, it } from "vitest";
import type { ConnectionView, FolderScopeView, FolderView } from "../../../src/shared/types";
import {
  FolderBrowserState,
  folderMoveTargets,
  rootBreadcrumb,
} from "../../../src/frontend/folder-browser-state";

const ROOT: FolderView = {
  id: "root",
  parentId: null,
  name: "Root",
  recursiveHostCount: 4,
  sortOrder: 0,
  createdAt: 1,
  updatedAt: 1,
};

const CHILD: FolderView = {
  ...ROOT,
  id: "child",
  parentId: "root",
  name: "Child",
  recursiveHostCount: 2,
};

const GRANDCHILD: FolderView = {
  ...ROOT,
  id: "grandchild",
  parentId: "child",
  name: "Grandchild",
  recursiveHostCount: 1,
};

const OTHER: FolderView = {
  ...ROOT,
  id: "other",
  name: "Other",
  recursiveHostCount: 0,
};

const ROOT_SCOPE: FolderScopeView = {
  folder: null,
  breadcrumb: [],
  folders: [ROOT, OTHER],
  connections: [],
};

function connView(id: string): ConnectionView {
  return {
    id,
    folderId: null,
    name: id,
    host: "127.0.0.1",
    port: 22,
    username: "u",
    authType: "password",
    credentialState: "ready",
    createdAt: 1,
    updatedAt: 1,
  };
}

describe("folder browser state", () => {
  it("根目錄 breadcrumb 固定顯示未分類，子資料夾沿 API breadcrumb 延伸", () => {
    expect(rootBreadcrumb(ROOT_SCOPE)).toEqual([{ id: null, name: "未分類" }]);
    expect(rootBreadcrumb({
      ...ROOT_SCOPE,
      folder: CHILD,
      breadcrumb: [ROOT, CHILD],
    })).toEqual([
      { id: null, name: "未分類" },
      { id: "root", name: "Root" },
      { id: "child", name: "Child" },
    ]);
  });

  it("切換資料夾時清空跨範圍選取，批量選取只保留目前可見連線", () => {
    const state = new FolderBrowserState();
    state.replaceScope(ROOT_SCOPE);
    state.toggleConnection("conn-a", true);
    state.toggleConnection("conn-b", true);
    expect(state.selectedConnectionIds()).toEqual(["conn-a", "conn-b"]);

    state.replaceScope({ ...ROOT_SCOPE, folder: ROOT, breadcrumb: [ROOT] });
    expect(state.currentFolderId).toBe("root");
    expect(state.selectedConnectionIds()).toEqual([]);
  });

  it("移動資料夾時排除自身與所有後代，連線移動仍可選任意資料夾或未分類", () => {
    const folders = [ROOT, CHILD, GRANDCHILD, OTHER];
    expect(folderMoveTargets(folders, "root").map((item) => item.id)).toEqual([
      null,
      "other",
    ]);
    expect(folderMoveTargets(folders).map((item) => item.id)).toEqual([
      null,
      "child",
      "grandchild",
      "other",
      "root",
    ]);
  });

  it("同資料夾重拉清單時，修剪已不在清單內的選取（跨分頁同步場景）", () => {
    const state = new FolderBrowserState();
    state.replaceScope({
      ...ROOT_SCOPE,
      connections: [connView("conn-a"), connView("conn-b")],
    });
    state.toggleConnection("conn-a", true);
    state.toggleConnection("conn-b", true);

    // 另一分頁把 conn-a 移走 → 本分頁重拉清單（folderId 不變）
    state.replaceScope({
      ...ROOT_SCOPE,
      connections: [connView("conn-b")],
    });

    expect(state.selectedConnectionIds()).toEqual(["conn-b"]);
  });

  it("selectedConnectionIds 傳入可見清單時回傳交集（顯示層雙保險）", () => {
    const state = new FolderBrowserState();
    state.replaceScope({
      ...ROOT_SCOPE,
      connections: [connView("conn-a"), connView("conn-b")],
    });
    state.toggleConnection("conn-a", true);
    state.toggleConnection("conn-b", true);

    expect(
      state.selectedConnectionIds(["conn-b", "conn-ghost"]),
    ).toEqual(["conn-b"]);
    expect(state.selectedConnectionIds()).toEqual(["conn-a", "conn-b"]);
  });
});
