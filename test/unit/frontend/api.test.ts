import { afterEach, describe, expect, it, vi } from "vitest";
import type { AppSettings } from "@/shared/types";
import {
  clearConnectionCredential,
  createFolder,
  deleteConnection,
  deleteFolder,
  getBootstrapStatus,
  getOs,
  getSettings,
  listConnections,
  listFolders,
  listScope,
  moveConnections,
  moveFolder,
  renameFolder,
  retryBootstrap,
  saveSettings,
  stepBootstrap,
} from "@/frontend/api";

describe("deleteConnection", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("接受 204 空回應並正常完成", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(deleteConnection("conn/1")).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledWith("/api/connections/conn%2F1", {
      credentials: "same-origin",
      method: "DELETE",
    });
  });
});

describe("listConnections", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("直接從 D1 完整列表 API 讀取，不再呼叫舊 KV migration", async () => {
    const connections = [{
      id: "conn-1",
      name: "測試",
      host: "127.0.0.1",
      port: 22,
      username: "tester",
      authType: "password",
      createdAt: 1,
      updatedAt: 1,
    }];
    const fetchMock = vi.fn().mockResolvedValueOnce(Response.json(connections));
    vi.stubGlobal("fetch", fetchMock);

    await expect(listConnections()).resolves.toEqual(connections);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledWith("/api/connections", {
      credentials: "same-origin",
    });
  });
});

describe("D1 bootstrap 與 scoped folder API", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("提供初始化狀態、短步驟與失敗重試", async () => {
    const statuses = [
      { status: "pending", phase: "kv_scan", percent: 0 },
      { status: "running", phase: "kv_migrate", percent: 40 },
      { status: "pending", phase: "kv_scan", percent: 0 },
    ];
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json(statuses[0]))
      .mockResolvedValueOnce(Response.json(statuses[1]))
      .mockResolvedValueOnce(Response.json(statuses[2]));
    vi.stubGlobal("fetch", fetchMock);

    await expect(getBootstrapStatus()).resolves.toEqual(statuses[0]);
    await expect(stepBootstrap()).resolves.toEqual(statuses[1]);
    await expect(retryBootstrap()).resolves.toEqual(statuses[2]);
    expect(fetchMock).toHaveBeenNthCalledWith(1, "/api/bootstrap", {
      credentials: "same-origin",
    });
    expect(fetchMock).toHaveBeenNthCalledWith(2, "/api/bootstrap", {
      credentials: "same-origin",
      method: "POST",
    });
    expect(fetchMock).toHaveBeenNthCalledWith(3, "/api/bootstrap/retry", {
      credentials: "same-origin",
      method: "POST",
    });
  });

  it("根層與資料夾範圍只呼叫 scoped API", async () => {
    const scope = { folder: null, breadcrumb: [], folders: [], connections: [] };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json(scope))
      .mockResolvedValueOnce(Response.json({ ...scope, folder: { id: "folder/1" } }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(listScope(null)).resolves.toEqual(scope);
    await listScope("folder/1");
    expect(fetchMock).toHaveBeenNthCalledWith(1, "/api/scope", {
      credentials: "same-origin",
    });
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/scope?folderId=folder%2F1",
      { credentials: "same-origin" },
    );
  });

  it("資料夾、批量移動與憑證清除使用明確操作端點", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json([{ id: "root", name: "Root" }]))
      .mockResolvedValueOnce(Response.json({ id: "root" }, { status: 201 }))
      .mockResolvedValueOnce(Response.json({ id: "root", name: "Renamed" }))
      .mockResolvedValueOnce(Response.json({ id: "root", parentId: "target" }))
      .mockResolvedValueOnce(Response.json({ ok: true }))
      .mockResolvedValueOnce(Response.json({ id: "conn", credentialState: "missing" }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    await listFolders();
    await createFolder("Root", null);
    await renameFolder("root", "Renamed");
    await moveFolder("root", "target");
    await moveConnections(["conn"], null);
    await clearConnectionCredential("conn");
    await deleteFolder("root", "recursive");

    expect(fetchMock).toHaveBeenNthCalledWith(1, "/api/folders", {
      credentials: "same-origin",
    });
    expect(fetchMock).toHaveBeenNthCalledWith(2, "/api/folders", expect.objectContaining({
      body: JSON.stringify({ name: "Root", parentId: null }),
    }));
    expect(fetchMock).toHaveBeenNthCalledWith(3, "/api/folders/root", expect.objectContaining({
      body: JSON.stringify({ name: "Renamed" }),
    }));
    expect(fetchMock).toHaveBeenNthCalledWith(4, "/api/folders/root", expect.objectContaining({
      body: JSON.stringify({ parentId: "target" }),
    }));
    expect(fetchMock).toHaveBeenNthCalledWith(5, "/api/connections/move", expect.objectContaining({
      body: JSON.stringify({ ids: ["conn"], folderId: null }),
    }));
    expect(fetchMock).toHaveBeenNthCalledWith(6, "/api/connections/conn/credential", expect.objectContaining({
      method: "DELETE",
    }));
    expect(fetchMock).toHaveBeenNthCalledWith(7, "/api/folders/root?mode=recursive", expect.objectContaining({
      method: "DELETE",
    }));
  });
});

describe("全域設定 API", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("使用 GET 讀取並以 PUT 完整儲存設定", async () => {
    const settings: AppSettings = {
      theme: "high-contrast" as const,
      terminalFontSize: 18,
      monitorIntervalSeconds: 10,
      autoReconnectEnabled: false,
      autoReconnectAttempts: 5,
      updatedAt: 123,
    };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json(settings))
      .mockResolvedValueOnce(Response.json(settings));
    vi.stubGlobal("fetch", fetchMock);

    await expect(getSettings()).resolves.toEqual(settings);
    await expect(saveSettings(settings)).resolves.toEqual(settings);
    expect(fetchMock).toHaveBeenNthCalledWith(1, "/api/settings", {
      credentials: "same-origin",
    });
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/settings",
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({
          theme: "high-contrast",
          terminalFontSize: 18,
          monitorIntervalSeconds: 10,
          autoReconnectEnabled: false,
          autoReconnectAttempts: 5,
        }),
      }),
    );
  });
});

describe("getOs（OS 快取探測）", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("204 No Content（新 Worker 未命中）回 null 不拋錯", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(getOs("host:22")).resolves.toBeNull();
  });

  it("404（滾動部署期的舊 Worker 未命中）同樣回 null", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({ error: "not found" }, { status: 404 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(getOs("host:22")).resolves.toBeNull();
  });

  it("真正伺服器錯誤仍拋 ApiError", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({ error: "boom" }, { status: 500 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(getOs("host:22")).rejects.toMatchObject({ status: 500 });
  });

  it("命中時回傳 OsInfo", async () => {
    const info = { os: "Ubuntu", version: "22.04", family: "linux" };
    const fetchMock = vi.fn().mockResolvedValue(Response.json(info));
    vi.stubGlobal("fetch", fetchMock);

    await expect(getOs("host:22")).resolves.toEqual(info);
  });
});
