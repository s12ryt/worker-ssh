// 應用進入點：視圖切換與各模組接線
import "@xterm/xterm/css/xterm.css";
import {
  APP_SETTINGS_DEFAULTS,
  type AppSettings,
  type AppSettingsInput,
  type ConnectionView,
  type FolderScopeView,
  type FolderView,
  type MonitorIntervalSeconds,
  type ThemeMode,
} from "../shared/types";
import {
  ApiError,
  clearConnectionCredential,
  createConnection,
  createFolder,
  deleteConnection,
  deleteFolder,
  getOs,
  getBootstrapStatus,
  getSettings,
  listFolders,
  listScope,
  login,
  logout,
  moveConnections,
  moveFolder,
  putOs,
  renameFolder,
  retryBootstrap,
  saveSettings,
  session,
  stepBootstrap,
  updateConnection,
} from "./api";
import { iconForOs } from "./icons";
import { createMonitorCharts, type MonitorChartsHandle, MetricsPoller } from "./monitor";
import { OsCache } from "./os-cache";
import { SftpPanel } from "./sftp-panel";
import { formatLastConnected } from "./format";
import { buildDetectCommand, parseDetectOutput } from "./osdetect";
import { openConfirmModal } from "./confirm-modal";
import { resetHostKeyTrust, verifyHostKeyTrust } from "./host-key-trust";
import { BackendSshClient } from "./backend-ssh-client";
import {
  assertConnectionReady,
  buildConnectionSubmission,
  connectionFormValues,
} from "./connection-form-state";
import type { SshClientLike } from "./ssh-client-contract";
import { cleanupSessionResources, type SessionResources } from "./session-lifecycle";
import { handleSessionReconnect } from "./session-reconnect";
import { activateSessionTab, type SessionTab } from "./session-tabs";
import { BootstrapFailedError, runBootstrap } from "./bootstrap-runner";
import {
  FolderBrowserState,
  folderMoveTargets,
  rootBreadcrumb,
} from "./folder-browser-state";
import { openFolderDeleteModal } from "./folder-delete-modal";
import { SettingsDraftController } from "./settings-controller";
import { applyRuntimeSettings } from "./settings-runtime";

/** OS 資訊客戶端快取（工作階段生命週期） */
const osCache = new OsCache();

// ---- DOM 捷徑 ----

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`缺少元素 #${id}`);
  return el as T;
};

/** 取輸入欄位目前值（input/select/textarea） */
const $val = (id: string): string =>
  ($(id) as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement).value;

function show(view: "login" | "connections" | "session"): void {
  for (const id of ["view-login", "view-connections", "view-session"]) {
    $(id).classList.toggle("hidden", id !== `view-${view}`);
  }
  // 終端機/SFTP 模式：禁止主頁面滾動，由內容區自行滾動
  document.body.classList.toggle("no-scroll", view === "session");
}

let toastTimer: ReturnType<typeof setTimeout> | null = null;
function toast(message: string): void {
  const el = $("toast");
  el.textContent = message;
  el.classList.remove("hidden");
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add("hidden"), 4000);
}

function onError(err: unknown): void {
  toast(err instanceof Error ? err.message : String(err));
}

// ---- 工作階段狀態 ----

interface ActiveSession {
  cfg: ConnectionView;
  resources: SessionResources;
  osFamily: string;
}

let active: ActiveSession | null = null;
let appSettings: AppSettings = { ...APP_SETTINGS_DEFAULTS, updatedAt: 0 };
const folderBrowser = new FolderBrowserState();
let currentScope: FolderScopeView = {
  folder: null,
  breadcrumb: [],
  folders: [],
  connections: [],
};

function applyAppSettings(settings: AppSettingsInput): void {
  applyRuntimeSettings(settings, {
    root: document.documentElement,
    terminal: active?.resources.terminal,
    poller: active?.resources.poller,
    client: active?.resources.client,
  });
}

async function loadApplicationSettings(): Promise<void> {
  try {
    appSettings = await getSettings();
  } catch {
    appSettings = { ...APP_SETTINGS_DEFAULTS, updatedAt: 0 };
    toast("設定載入失敗，已套用安全預設值");
  }
  applyAppSettings(appSettings);
}

// ---- 登入／登出 ----

async function refreshSession(): Promise<void> {
  try {
    const info = await session();
    if (info.authenticated) {
      await initializeDatabase();
      await loadApplicationSettings();
      await showConnections();
    } else {
      show("login");
    }
  } catch {
    show("login");
  }
}

$("login-form").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const errEl = $("login-error");
  errEl.classList.add("hidden");
  try {
    await login($val("login-password"));
    ($("login-password") as HTMLInputElement).value = "";
    await initializeDatabase();
    await loadApplicationSettings();
    await showConnections();
  } catch (err) {
    errEl.textContent =
      err instanceof ApiError ? err.message : "登入失敗，請稍後再試";
    errEl.classList.remove("hidden");
  }
});

$("logout-btn").addEventListener("click", () => {
  void logout().finally(() => show("login"));
});

let settingsController: SettingsDraftController | null = null;

function renderSettingsForm(settings: AppSettingsInput): void {
  ($("settings-theme") as HTMLSelectElement).value = settings.theme;
  const fontSize = $("settings-font-size") as HTMLInputElement;
  fontSize.value = String(settings.terminalFontSize);
  $("settings-font-value").textContent = `${settings.terminalFontSize} px`;
  ($("settings-monitor-interval") as HTMLSelectElement).value =
    String(settings.monitorIntervalSeconds);
  const reconnect = $("settings-reconnect-enabled") as HTMLInputElement;
  reconnect.checked = settings.autoReconnectEnabled;
  const attempts = $("settings-reconnect-attempts") as HTMLInputElement;
  attempts.value = String(settings.autoReconnectAttempts);
  attempts.disabled = !settings.autoReconnectEnabled;
}

function updateSettingsDraft(patch: Partial<AppSettingsInput>): void {
  settingsController?.update(patch);
  if (settingsController) renderSettingsForm(settingsController.value);
}

function cancelSettingsDialog(): void {
  settingsController?.cancel();
  settingsController = null;
  ($("settings-dialog") as HTMLDialogElement).close();
}

function openSettingsDialog(): void {
  settingsController = new SettingsDraftController(appSettings, {
    preview: applyAppSettings,
    save: saveSettings,
  });
  renderSettingsForm(settingsController.value);
  $("settings-error").classList.add("hidden");
  ($("settings-dialog") as HTMLDialogElement).showModal();
  ($("settings-theme") as HTMLSelectElement).focus();
}

$("settings-btn").addEventListener("click", openSettingsDialog);
$("session-settings-btn").addEventListener("click", openSettingsDialog);

$("settings-theme").addEventListener("change", () =>
  updateSettingsDraft({ theme: $val("settings-theme") as ThemeMode }),
);
$("settings-font-size").addEventListener("input", () =>
  updateSettingsDraft({ terminalFontSize: Number($val("settings-font-size")) }),
);
$("settings-monitor-interval").addEventListener("change", () =>
  updateSettingsDraft({
    monitorIntervalSeconds: Number($val("settings-monitor-interval")) as MonitorIntervalSeconds,
  }),
);
$("settings-reconnect-enabled").addEventListener("change", () =>
  updateSettingsDraft({
    autoReconnectEnabled: ($("settings-reconnect-enabled") as HTMLInputElement).checked,
  }),
);
$("settings-reconnect-attempts").addEventListener("input", () =>
  updateSettingsDraft({ autoReconnectAttempts: Number($val("settings-reconnect-attempts")) }),
);

$("settings-defaults").addEventListener("click", () => {
  settingsController?.restoreDefaults();
  if (settingsController) renderSettingsForm(settingsController.value);
});
$("settings-cancel").addEventListener("click", cancelSettingsDialog);
$("settings-dialog").addEventListener("cancel", (event) => {
  event.preventDefault();
  cancelSettingsDialog();
});
$("settings-save").addEventListener("click", async () => {
  if (!settingsController) return;
  const error = $("settings-error");
  error.classList.add("hidden");
  const button = $("settings-save") as HTMLButtonElement;
  button.disabled = true;
  try {
    appSettings = await settingsController.save();
    settingsController = null;
    ($("settings-dialog") as HTMLDialogElement).close();
    toast("設定已儲存");
  } catch (err) {
    error.textContent = err instanceof Error ? err.message : String(err);
    error.classList.remove("hidden");
  } finally {
    button.disabled = false;
  }
});

// ---- 連線管理 ----

const bootstrapPhaseLabels = {
  kv_scan: "掃描既有連線",
  kv_migrate: "搬移加密連線資料",
  verify: "驗證資料完整性",
  kv_cleanup: "清理舊儲存資料",
  complete: "初始化完成",
} as const;

let bootstrapPromise: Promise<void> | null = null;

function renderBootstrapStatus(status: import("@/shared/types").BootstrapStatusView): void {
  $("bootstrap-phase").textContent = bootstrapPhaseLabels[status.phase];
  $("bootstrap-count").textContent = `${status.processed} / ${status.total}`;
  $("bootstrap-percent").textContent = `${status.percent}%`;
  const progress = $("bootstrap-progress") as HTMLProgressElement;
  progress.value = status.percent;
  $("bootstrap-error").classList.add("hidden");
  $("bootstrap-retry").classList.add("hidden");
}

async function initializeDatabase(): Promise<void> {
  if (bootstrapPromise) return bootstrapPromise;
  bootstrapPromise = (async () => {
    show("connections");
    $("bootstrap-overlay").classList.remove("hidden");
    try {
      await runBootstrap({
        getStatus: getBootstrapStatus,
        step: stepBootstrap,
        onStatus: renderBootstrapStatus,
      });
      $("bootstrap-overlay").classList.add("hidden");
    } catch (err) {
      const errorCode = err instanceof BootstrapFailedError
        ? err.bootstrapStatus.errorCode ?? "DATABASE_BOOTSTRAP_FAILED"
        : "DATABASE_BOOTSTRAP_UNAVAILABLE";
      $("bootstrap-error").textContent = `初始化失敗：${errorCode}`;
      $("bootstrap-error").classList.remove("hidden");
      $("bootstrap-retry").classList.remove("hidden");
      throw err;
    }
  })().finally(() => {
    bootstrapPromise = null;
  });
  return bootstrapPromise;
}

$("bootstrap-retry").addEventListener("click", async () => {
  const button = $("bootstrap-retry") as HTMLButtonElement;
  button.disabled = true;
  try {
    const status = await retryBootstrap();
    renderBootstrapStatus(status);
    await initializeDatabase();
    await loadApplicationSettings();
    await showConnections();
  } catch {
    // initializeDatabase 已將安全錯誤顯示在遮罩中。
  } finally {
    button.disabled = false;
  }
});

async function showConnections(folderId: string | null = folderBrowser.currentFolderId): Promise<void> {
  show("connections");
  // D18-(1) 骨架屏：載入中顯示
  $("conn-list").replaceChildren();
  $("conn-empty").classList.add("hidden");
  $("conn-skeleton").classList.remove("hidden");
  try {
    const scope = await listScope(folderId);
    folderBrowser.replaceScope(scope);
    currentScope = scope;
    renderFolderScope(scope);
  } catch (err) {
    $("conn-skeleton").classList.add("hidden");
    onError(err);
  }
}

function osIconSvg(osId: string): SVGSVGElement {
  const data = iconForOs(osId);
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", "28");
  svg.setAttribute("height", "28");
  svg.setAttribute("aria-label", data.title);
  svg.classList.add("os-icon");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", data.path);
  path.setAttribute("fill", data.hex);
  svg.appendChild(path);
  return svg;
}

const CONNECTION_DRAG_TYPE = "application/x-worker-ssh-connections";
const FOLDER_DRAG_TYPE = "application/x-worker-ssh-folder";

function actionButton(label: string, className = "btn btn-ghost btn-sm"): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  button.textContent = label;
  return button;
}

function itemMenu(items: Array<{ label: string; danger?: boolean; run: () => void }>): HTMLElement {
  const details = document.createElement("details");
  details.className = "item-menu";
  const summary = document.createElement("summary");
  summary.className = "btn btn-ghost btn-icon";
  summary.setAttribute("aria-label", "更多操作");
  summary.title = "更多操作";
  summary.textContent = "⋯";
  const panel = document.createElement("div");
  panel.className = "item-menu-panel";
  for (const item of items) {
    const button = actionButton(
      item.label,
      item.danger ? "btn btn-danger btn-sm" : "btn btn-ghost btn-sm",
    );
    button.addEventListener("click", () => {
      details.removeAttribute("open");
      item.run();
    });
    panel.appendChild(button);
  }
  details.append(summary, panel);
  return details;
}

function renderBreadcrumb(scope: FolderScopeView): void {
  const nav = $("folder-breadcrumb");
  nav.replaceChildren();
  for (const [index, item] of rootBreadcrumb(scope).entries()) {
    if (index > 0) {
      const separator = document.createElement("span");
      separator.className = "breadcrumb-separator";
      separator.textContent = "/";
      separator.setAttribute("aria-hidden", "true");
      nav.appendChild(separator);
    }
    const button = actionButton(item.name, "breadcrumb-button");
    button.dataset.folderId = item.id ?? "";
    button.disabled = item.id === folderBrowser.currentFolderId;
    button.addEventListener("click", () => void showConnections(item.id));
    button.addEventListener("dragover", (event) => event.preventDefault());
    button.addEventListener("drop", (event) => void handleDrop(event, item.id));
    nav.appendChild(button);
  }
}

function renderSelectionBar(): void {
  const count = folderBrowser.selectedConnectionIds().length;
  $("selection-bar").classList.toggle("hidden", currentScope.connections.length === 0);
  $("selection-count").textContent = `已選取 ${count} 筆`;
  const selectAll = $("selection-all") as HTMLInputElement;
  selectAll.checked = currentScope.connections.length > 0 && count === currentScope.connections.length;
  selectAll.indeterminate = count > 0 && count < currentScope.connections.length;
  ($("selection-move") as HTMLButtonElement).disabled = count === 0;
  ($("selection-clear") as HTMLButtonElement).disabled = count === 0;
}

function renderFolderScope(scope: FolderScopeView): void {
  renderBreadcrumb(scope);
  renderFolderList(scope.folders);
  renderConnList(scope.connections);
  $("folder-current-actions").classList.toggle("hidden", scope.folder === null);
  $("folder-section").classList.toggle("hidden", scope.folders.length === 0);
  $("folder-section-count").textContent = `${scope.folders.length} 個`;
  $("connection-section-count").textContent = `${scope.connections.length} 台`;
  $("conn-empty").classList.toggle(
    "hidden",
    scope.folders.length > 0 || scope.connections.length > 0,
  );
  renderSelectionBar();
}

function renderFolderList(folders: FolderView[]): void {
  const list = $("folder-list");
  list.replaceChildren();
  for (const folder of folders) {
    const li = document.createElement("li");
    li.className = "folder-card";
    li.draggable = true;
    li.dataset.folderId = folder.id;
    li.addEventListener("dragstart", (event) => {
      if ((event.target as Element).closest("button, summary")) {
        event.preventDefault();
        return;
      }
      event.dataTransfer?.setData(FOLDER_DRAG_TYPE, folder.id);
      event.dataTransfer?.setDragImage(li, 24, 24);
    });
    li.addEventListener("dragover", (event) => {
      event.preventDefault();
      li.classList.add("is-drop-target");
    });
    li.addEventListener("dragleave", () => li.classList.remove("is-drop-target"));
    li.addEventListener("drop", (event) => {
      li.classList.remove("is-drop-target");
      void handleDrop(event, folder.id);
    });

    const open = actionButton(folder.name, "folder-open");
    open.addEventListener("click", () => void showConnections(folder.id));
    const icon = document.createElement("span");
    icon.className = "folder-icon";
    icon.setAttribute("aria-hidden", "true");
    icon.textContent = "▰";
    const text = document.createElement("span");
    text.className = "folder-card-text";
    const name = document.createElement("strong");
    name.textContent = folder.name;
    const count = document.createElement("small");
    count.textContent = `${folder.recursiveHostCount} 台主機`;
    text.append(name, count);
    open.replaceChildren(icon, text);

    const menu = itemMenu([
      { label: "重新命名", run: () => openFolderForm("rename", folder) },
      { label: "移動", run: () => void openMoveDialog({ kind: "folder", folder }) },
      { label: "刪除", danger: true, run: () => void deleteFolderFromUi(folder) },
    ]);
    li.append(open, menu);
    list.appendChild(li);
  }
}

async function handleDrop(event: DragEvent, targetFolderId: string | null): Promise<void> {
  event.preventDefault();
  const draggedFolderId = event.dataTransfer?.getData(FOLDER_DRAG_TYPE);
  const draggedConnections = event.dataTransfer?.getData(CONNECTION_DRAG_TYPE);
  try {
    if (draggedFolderId) {
      if (draggedFolderId === targetFolderId) return;
      await moveFolder(draggedFolderId, targetFolderId);
    } else if (draggedConnections) {
      const ids = JSON.parse(draggedConnections) as unknown;
      if (!Array.isArray(ids) || !ids.every((id) => typeof id === "string")) return;
      await moveConnections(ids, targetFolderId);
      folderBrowser.clearSelection();
    } else {
      return;
    }
    await showConnections();
  } catch (err) {
    onError(err);
  }
}

function renderConnList(conns: ConnectionView[]): void {
  const list = $("conn-list");
  $("conn-skeleton").classList.add("hidden");
  list.replaceChildren();
  for (const cfg of conns) {
    const li = document.createElement("li");
    li.className = "glass-card conn-card is-hoverable";
    li.draggable = true;
    li.dataset.connectionId = cfg.id;
    li.addEventListener("dragstart", (event) => {
      if ((event.target as Element).closest("button, summary, input")) {
        event.preventDefault();
        return;
      }
      const selected = folderBrowser.selectedConnectionIds();
      const ids = selected.includes(cfg.id) ? selected : [cfg.id];
      event.dataTransfer?.setData(CONNECTION_DRAG_TYPE, JSON.stringify(ids));
      event.dataTransfer?.setDragImage(li, 24, 24);
    });

    const head = document.createElement("div");
    head.className = "conn-head";
    const select = document.createElement("input");
    select.type = "checkbox";
    select.className = "conn-select";
    select.checked = folderBrowser.selectedConnectionIds().includes(cfg.id);
    select.setAttribute("aria-label", `選取 ${cfg.name}`);
    select.addEventListener("change", () => {
      folderBrowser.toggleConnection(cfg.id, select.checked);
      renderSelectionBar();
    });
    head.appendChild(select);
    const iconBox = document.createElement("span");
    iconBox.dataset.oskey = `${cfg.host}:${cfg.port}`;
    iconBox.appendChild(osIconSvg("linux")); // 先用預設，偵測後替換
    head.appendChild(iconBox);

    const meta = document.createElement("div");
    meta.innerHTML = "";
    const name = document.createElement("strong");
    name.textContent = cfg.name;
    const sub = document.createElement("small");
    sub.textContent = `${cfg.username}@${cfg.host}:${cfg.port}`;
    meta.append(name, sub);
    head.appendChild(meta);
    li.appendChild(head);

    // D18-(3) / D20：最近連線時間 + 連線狀態指示（active session 比對 cfg.id）
    const metaRow = document.createElement("div");
    metaRow.className = "conn-meta-row";
    const status = document.createElement("span");
    const isActive = active?.cfg.id === cfg.id;
    status.className = "conn-status-indicator";
    status.dataset.state = isActive ? "active" : "inactive";
    status.textContent = isActive ? "連線中" : "已斷線";
    const lastConn = document.createElement("small");
    lastConn.className = "conn-last-time";
    lastConn.textContent = `最近連線：${formatLastConnected(cfg.lastConnectedAt)}`;
    metaRow.append(status, lastConn);
    li.appendChild(metaRow);

    const actions = document.createElement("div");
    actions.className = "conn-actions";
    const connectBtn = document.createElement("button");
    connectBtn.type = "button";
    connectBtn.className = "btn btn-primary btn-sm";
    connectBtn.textContent = "連線";
    connectBtn.disabled = cfg.credentialState === "missing";
    if (connectBtn.disabled) connectBtn.title = "請先編輯連線並設定憑證";
    connectBtn.addEventListener("click", () => void connectTo(cfg));
    const menu = itemMenu([
      { label: "編輯", run: () => openConnForm(cfg) },
      {
        label: "移動",
        run: () => void openMoveDialog({ kind: "connections", ids: [cfg.id] }),
      },
      {
        label: "刪除",
        danger: true,
        run: () => void deleteConnectionFromUi(cfg),
      },
    ]);
    actions.append(connectBtn, menu);
    li.appendChild(actions);
    list.appendChild(li);

    // 帶入快取的 OS 圖示（客戶端快取去重，避免重複 KV 讀）
    void osCache
      .fetch(`${cfg.host}:${cfg.port}`, getOs)
      .then((info) => {
        if (info) iconBox.replaceChildren(osIconSvg(info.os));
      })
      .catch(() => undefined);
  }
}

async function deleteConnectionFromUi(cfg: ConnectionView): Promise<void> {
  if (!await openConfirmModal({
    message: `確定刪除連線「${cfg.name}」？`,
    title: "刪除連線",
    danger: true,
    confirmText: "刪除",
  })) return;
  try {
    await deleteConnection(cfg.id);
    folderBrowser.toggleConnection(cfg.id, false);
    await showConnections();
  } catch (err) {
    onError(err);
  }
}

type FolderFormMode = "create" | "rename";
let folderFormMode: FolderFormMode = "create";
let folderFormTarget: FolderView | null = null;

function openFolderForm(mode: FolderFormMode, folder?: FolderView): void {
  folderFormMode = mode;
  folderFormTarget = folder ?? null;
  $("folder-form-title").textContent = mode === "create" ? "新增資料夾" : "重新命名資料夾";
  ($("folder-name") as HTMLInputElement).value = folder?.name ?? "";
  $("folder-form-error").classList.add("hidden");
  ($("folder-form") as HTMLDialogElement).showModal();
  ($("folder-name") as HTMLInputElement).focus();
}

$("folder-new-btn").addEventListener("click", () => openFolderForm("create"));
$("folder-form-cancel").addEventListener("click", () =>
  ($("folder-form") as HTMLDialogElement).close(),
);
$("folder-form-save").addEventListener("click", async () => {
  const error = $("folder-form-error");
  error.classList.add("hidden");
  const name = $val("folder-name").trim();
  if (!name) {
    error.textContent = "請輸入資料夾名稱";
    error.classList.remove("hidden");
    return;
  }
  const button = $("folder-form-save") as HTMLButtonElement;
  button.disabled = true;
  try {
    if (folderFormMode === "rename" && folderFormTarget) {
      await renameFolder(folderFormTarget.id, name);
    } else {
      await createFolder(name, folderBrowser.currentFolderId);
    }
    ($("folder-form") as HTMLDialogElement).close();
    await showConnections();
  } catch (err) {
    error.textContent = err instanceof Error ? err.message : String(err);
    error.classList.remove("hidden");
  } finally {
    button.disabled = false;
  }
});

type MoveIntent =
  | { kind: "connections"; ids: string[] }
  | { kind: "folder"; folder: FolderView };
let moveIntent: MoveIntent | null = null;

function folderPath(folder: FolderView, allFolders: readonly FolderView[]): string {
  const byId = new Map(allFolders.map((item) => [item.id, item]));
  const names: string[] = [folder.name];
  let parentId = folder.parentId;
  const visited = new Set<string>([folder.id]);
  while (parentId && !visited.has(parentId)) {
    visited.add(parentId);
    const parent = byId.get(parentId);
    if (!parent) break;
    names.unshift(parent.name);
    parentId = parent.parentId;
  }
  return names.join(" / ");
}

async function openMoveDialog(intent: MoveIntent): Promise<void> {
  moveIntent = intent;
  $("move-dialog-error").classList.add("hidden");
  try {
    const folders = await listFolders();
    const targets = folderMoveTargets(
      folders,
      intent.kind === "folder" ? intent.folder.id : undefined,
    );
    const byId = new Map(folders.map((folder) => [folder.id, folder]));
    const select = $("move-target") as HTMLSelectElement;
    select.replaceChildren();
    for (const target of targets) {
      const option = document.createElement("option");
      option.value = target.id ?? "";
      const folder = target.id === null ? undefined : byId.get(target.id);
      option.textContent = target.id === null
        ? "未分類"
        : folder ? folderPath(folder, folders) : target.name;
      select.appendChild(option);
    }
    $("move-dialog-title").textContent = intent.kind === "folder"
      ? `移動資料夾「${intent.folder.name}」`
      : `移動 ${intent.ids.length} 台主機`;
    ($("move-dialog") as HTMLDialogElement).showModal();
  } catch (err) {
    moveIntent = null;
    onError(err);
  }
}

$("move-dialog-cancel").addEventListener("click", () => {
  moveIntent = null;
  ($("move-dialog") as HTMLDialogElement).close();
});
$("move-dialog-confirm").addEventListener("click", async () => {
  if (!moveIntent) return;
  const error = $("move-dialog-error");
  error.classList.add("hidden");
  const button = $("move-dialog-confirm") as HTMLButtonElement;
  button.disabled = true;
  try {
    const targetId = $val("move-target") || null;
    if (moveIntent.kind === "folder") await moveFolder(moveIntent.folder.id, targetId);
    else await moveConnections(moveIntent.ids, targetId);
    moveIntent = null;
    folderBrowser.clearSelection();
    ($("move-dialog") as HTMLDialogElement).close();
    await showConnections();
  } catch (err) {
    error.textContent = err instanceof Error ? err.message : String(err);
    error.classList.remove("hidden");
  } finally {
    button.disabled = false;
  }
});

async function deleteFolderFromUi(folder: FolderView): Promise<void> {
  const choice = await openFolderDeleteModal(folder.name, folder.recursiveHostCount);
  if (choice === "cancel") return;
  try {
    const deletingCurrent = folderBrowser.currentFolderId === folder.id;
    await deleteFolder(folder.id, choice);
    await showConnections(deletingCurrent ? folder.parentId : folderBrowser.currentFolderId);
  } catch (err) {
    onError(err);
  }
}

$("folder-current-rename").addEventListener("click", () => {
  if (currentScope.folder) openFolderForm("rename", currentScope.folder);
});
$("folder-current-move").addEventListener("click", () => {
  if (currentScope.folder) void openMoveDialog({ kind: "folder", folder: currentScope.folder });
});
$("folder-current-delete").addEventListener("click", () => {
  if (currentScope.folder) void deleteFolderFromUi(currentScope.folder);
});

$("selection-all").addEventListener("change", () => {
  const checked = ($("selection-all") as HTMLInputElement).checked;
  if (!checked) folderBrowser.clearSelection();
  else for (const connection of currentScope.connections) {
    folderBrowser.toggleConnection(connection.id, true);
  }
  renderConnList(currentScope.connections);
  renderSelectionBar();
});
$("selection-clear").addEventListener("click", () => {
  folderBrowser.clearSelection();
  renderConnList(currentScope.connections);
  renderSelectionBar();
});
$("selection-move").addEventListener("click", () => {
  const ids = folderBrowser.selectedConnectionIds();
  if (ids.length > 0) void openMoveDialog({ kind: "connections", ids });
});

// ---- 新增／編輯表單 ----

let editingId: string | null = null;
let editingConnection: ConnectionView | null = null;

function setAuthFields(authType: string): void {
  document.querySelectorAll<HTMLElement>(".auth-password").forEach((el) =>
    el.classList.toggle("hidden", authType !== "password"),
  );
  document.querySelectorAll<HTMLElement>(".auth-key").forEach((el) =>
    el.classList.toggle("hidden", authType !== "privateKey"),
  );
}

function renderHostKeyTrust(cfg?: ConnectionView): void {
  const section = $("conn-host-key-trust");
  const hasTrust = Boolean(cfg?.hostKeyFingerprint);
  section.classList.toggle("hidden", !hasTrust);
  $("conn-host-key-type").textContent = cfg?.hostKeyType ?? "未知類型";
  $("conn-host-key-fingerprint").textContent = cfg?.hostKeyFingerprint ?? "";
}

function renderCredentialState(cfg?: ConnectionView): void {
  const section = $("conn-credential-state");
  section.classList.toggle("hidden", cfg === undefined);
  if (!cfg) return;
  $("conn-credential-label").textContent =
    cfg.credentialState === "ready" ? "已儲存認證憑證" : "缺少認證憑證";
  $("conn-credential-clear").classList.toggle(
    "hidden",
    cfg.credentialState !== "ready",
  );
}

function openConnForm(cfg?: ConnectionView): void {
  editingId = cfg?.id ?? null;
  editingConnection = cfg ?? null;
  $("conn-form-title").textContent = cfg ? "編輯連線" : "新增連線";
  const set = (id: string, value: string) => {
    ($(id) as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement).value = value;
  };
  const values = connectionFormValues(cfg);
  set("f-name", values.name);
  set("f-host", values.host);
  set("f-port", values.port);
  set("f-username", values.username);
  set("f-auth-type", values.authType);
  set("f-password", values.password);
  set("f-privatekey", values.privateKey);
  set("f-passphrase", values.passphrase);
  setAuthFields($val("f-auth-type"));
  renderHostKeyTrust(cfg);
  renderCredentialState(cfg);
  $("conn-form-error").classList.add("hidden");
  ($("conn-form") as HTMLDialogElement).showModal();
}

$("conn-new-btn").addEventListener("click", () => openConnForm());
$("conn-form-cancel").addEventListener("click", () =>
  ($("conn-form") as HTMLDialogElement).close(),
);
$("f-auth-type").addEventListener("change", () => setAuthFields($val("f-auth-type")));

$("conn-host-key-reset").addEventListener("click", async () => {
  if (!editingConnection?.hostKeyFingerprint) return;
  const button = $("conn-host-key-reset") as HTMLButtonElement;
  const errEl = $("conn-form-error");
  errEl.classList.add("hidden");
  button.disabled = true;
  try {
    const reset = await resetHostKeyTrust(editingConnection, {
      confirm: openConfirmModal,
      update: updateConnection,
    });
    if (reset) renderHostKeyTrust(editingConnection);
  } catch (err) {
    errEl.textContent = err instanceof Error ? err.message : String(err);
    errEl.classList.remove("hidden");
  } finally {
    button.disabled = false;
  }
});

$("conn-credential-clear").addEventListener("click", async () => {
  if (!editingConnection || editingConnection.credentialState !== "ready") return;
  if (!await openConfirmModal({
    title: "清除認證憑證",
    message:
      `確定清除「${editingConnection.name}」已儲存的 SSH 認證憑證？\n\n` +
      "清除後將無法連線，直到重新輸入密碼或私鑰。",
    confirmText: "清除憑證",
    cancelText: "取消",
    danger: true,
  })) return;
  const button = $("conn-credential-clear") as HTMLButtonElement;
  button.disabled = true;
  try {
    editingConnection = await clearConnectionCredential(editingConnection.id);
    renderCredentialState(editingConnection);
  } catch (err) {
    onError(err);
  } finally {
    button.disabled = false;
  }
});

$("conn-form-save").addEventListener("click", () => {
  const errEl = $("conn-form-error");
  errEl.classList.add("hidden");
  let data;
  try {
    data = buildConnectionSubmission(editingConnection ?? undefined, {
      name: $val("f-name"),
      host: $val("f-host"),
      port: $val("f-port"),
      username: $val("f-username"),
      authType: $val("f-auth-type") as ConnectionView["authType"],
      password: $val("f-password"),
      privateKey: $val("f-privatekey"),
      passphrase: $val("f-passphrase"),
    });
  } catch (err) {
    errEl.textContent = err instanceof Error ? err.message : String(err);
    errEl.classList.remove("hidden");
    return;
  }
  const save = editingId
    ? updateConnection(editingId, data)
    : createConnection({ ...data, folderId: folderBrowser.currentFolderId });
  save
    .then(() => {
      ($("conn-form") as HTMLDialogElement).close();
      void showConnections();
    })
    .catch((err: unknown) => {
      errEl.textContent = err instanceof Error ? err.message : String(err);
      errEl.classList.remove("hidden");
    });
});

// ---- 分頁切換 ----

document.querySelectorAll<HTMLButtonElement>(".tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    activateSessionTab(tab.dataset.tab as SessionTab);
    active?.resources.terminal?.fit();
  });
});

// ---- 連線流程 ----

function setStatus(state: "connecting" | "open" | "closed" | "error"): void {
  const label = { connecting: "連線中", open: "已連線", closed: "已關閉", error: "錯誤" }[state];
  const dot = $("sess-status");
  dot.className = `status-dot status-${state}`;
  dot.title = label;
  // D18-(4) 同步終端機標題列的狀態點
  const termDot = $("term-status");
  termDot.className = `status-dot status-${state}`;
  termDot.title = label;
}

async function detectOs(client: SshClientLike, connId: number, key: string): Promise<string> {
  try {
    const cached = await osCache.fetch(key, getOs);
    if (cached) return cached.family;
  } catch {
    // 快取讀取失敗不阻斷
  }
  const res = await client.exec(connId, buildDetectCommand());
  const info = parseDetectOutput(res.stdout);
  if (!info) throw new Error("無法辨識遠端作業系統（偵測指令無輸出）");
  void putOs(key, info)
    .then(() => osCache.put(key, info)) // 寫入 KV 成功後同步客戶端快取
    .catch(() => undefined); // 快取寫入失敗可忽略
  return info.family;
}

async function connectTo(cfg: ConnectionView): Promise<void> {
  const resources: SessionResources = {};
  try {
    assertConnectionReady(cfg);
    setStatus("connecting");
    const client = new BackendSshClient();
    client.setReconnectPolicy(
      appSettings.autoReconnectEnabled,
      appSettings.autoReconnectAttempts,
    );
    resources.client = client;
    client.onClosed(() => {
      cleanupSessionResources(resources);
      if (active?.resources === resources) {
        const cfgId = active.cfg.id;
        active = null;
        void updateConnection(cfgId, { lastDisconnectedAt: Date.now() }).catch(() => undefined);
      }
      ($("term-metrics") as HTMLElement).style.display = "none";
      setStatus("closed");
    });
    const connId = await client.connect(cfg, undefined, (info) =>
      verifyHostKeyTrust(cfg, info, {
        confirm: openConfirmModal,
        update: updateConnection,
      }),
    );
    resources.connId = connId;
    if (resources.cleaned) throw new Error("SSH 連線已在建立過程中關閉");

    // OS 偵測（帶快取）→ 更新標籤列
    const family = await detectOs(client, connId, `${cfg.host}:${cfg.port}`);
    const label = $("sess-os-label");
    label.textContent = family;
    void osCache.fetch(`${cfg.host}:${cfg.port}`, getOs).then((info) => {
      if (info) {
        const icon = $("sess-os-icon");
        icon.querySelector("path")?.setAttribute("d", iconForOs(info.os).path);
        label.textContent = `${info.os}${info.version ? ` ${info.version}` : ""}`;
      }
    }).catch(() => undefined);

    // 終端機（xterm 體積大，僅在進入工作階段時延遲載入）
    const termContainer = $("term-container");
    termContainer.replaceChildren(); // 清掉上一次的終端
    // D18-(4) 終端機標題列顯示連線名稱
    $("term-conn-name").textContent = cfg.name;
    const { createTerminal } = await import("./terminal");
    const terminal = createTerminal(termContainer, { onClipboardError: onError });
    terminal.setFontSize(appSettings.terminalFontSize);
    resources.terminal = terminal;
    terminal.term.onData((text) => client.shellWrite(connId, text));
    // 終端機 resize → 同步通知後端 PTY (Go/WASM)
    terminal.term.onResize(({ cols, rows }) => client.shellResize(connId, cols, rows));
    await client.openShell(connId, terminal.term.cols, terminal.term.rows, (data) =>
      terminal.term.write(data),
    );
    // 監控輪詢（3 秒）
    // chart.js 預載：建立三條 sparkline（失敗不阻斷連線）
    let charts: MonitorChartsHandle | null = null;
    try {
      charts = await createMonitorCharts(
        $("m-cpu-canvas") as HTMLCanvasElement,
        $("m-mem-canvas") as HTMLCanvasElement,
        $("m-disk-canvas") as HTMLCanvasElement,
      );
    } catch (err) {
      // chart.js 載入失敗仍可監控，僅提示
      onError(err);
    }
    resources.charts = charts;
    const poller = new MetricsPoller({
      family,
      sample: (cmd) => client.exec(connId, cmd).then((r) => r.stdout),
      onSample: (display) => {
        $("m-cpu").textContent = display.cpu;
        $("m-mem-used").textContent = display.memUsed;
        $("m-mem-percent").textContent = display.memPercent;
        $("m-swap-used").textContent = display.swapUsed;
        $("m-swap-percent").textContent = display.swapPercent;
        $("m-disk-used").textContent = display.diskUsed;
        $("m-disk-percent").textContent = display.diskPercent;
        $("m-load").textContent = display.load;
        $("m-net-rx").textContent = display.netRx;
        $("m-net-tx").textContent = display.netTx;
      },
      onSnapshot: (snapshot) => charts?.push(snapshot.metrics),
      onError: () => setStatus("error"),
      intervalMs: appSettings.monitorIntervalSeconds * 1_000,
    });
    resources.poller = poller;

    // SFTP 面板（D5：confirm 注入 Liquid Glass confirm-modal；fallback window.confirm 保留作安全網）
    const sftpPanel = new SftpPanel($("sftp-container"), client, connId, {
      onError,
      confirm: (message) => openConfirmModal({ message, title: "刪除檔案", danger: true, confirmText: "刪除" }),
    });
    void sftpPanel.open("/");

    resources.subscriptions = [
      client.onReconnectState((state) => {
        void handleSessionReconnect(state, {
          client,
          connId,
          terminal,
          poller,
          sftp: sftpPanel,
          setStatus,
          onError,
        });
      }),
    ];

    $("sess-name").textContent = cfg.name;
    // D20：連線成功 → 雲同步 lastConnectedAt（同步更新本地副本，便於返回列表時顯示）
    const now = Date.now();
    cfg.lastConnectedAt = now;
    void updateConnection(cfg.id, { lastConnectedAt: now }).catch(() => undefined);
    active = { cfg, resources, osFamily: family };
    show("session");
    setStatus("open");
    // 顯示終端機底部監控列
    ($("term-metrics") as HTMLElement).style.display = "flex";
    poller.start();
    terminal.term.focus();
  } catch (err) {
    cleanupSessionResources(resources);
    ($("term-metrics") as HTMLElement).style.display = "none";
    setStatus("error");
    onError(err);
  }
}

function teardown(): void {
  if (!active) return;
  // D20：斷線 → 雲同步 lastDisconnectedAt（不阻斷 teardown）
  const cfgId = active.cfg.id;
  const ts = Date.now();
  const resources = active.resources;
  active = null;
  cleanupSessionResources(resources);
  // 隱藏終端機底部監控列
  ($("term-metrics") as HTMLElement).style.display = "none";
  setStatus("closed");
  void updateConnection(cfgId, { lastDisconnectedAt: ts }).catch(() => undefined);
}

$("sess-back-btn").addEventListener("click", async () => {
  if (!await openConfirmModal({
    message: "確定要斷開 SSH 連線並返回連線管理？",
    title: "斷開連線",
  })) return;
  teardown();
  void showConnections();
});

window.addEventListener("beforeunload", teardown);

// ---- 啟動 ----

void refreshSession();
