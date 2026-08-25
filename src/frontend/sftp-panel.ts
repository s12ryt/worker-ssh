// SFTP 檔案管理面板：目錄瀏覽、上傳/下載、重新命名、刪除、新增資料夾
// DOM 膠水層（編譯驗證）；路徑運算見 sftp-paths.ts（TDD）
import type { SftpEntryLike, SshClientLike } from "./ssh-client-contract";
import { fileKindOf } from "./sftp-file-kind";
import { joinPath, parentOf } from "./sftp-paths";
import { formatBytes } from "./monitor";
import { iconElement, type UiIconName } from "./ui-icons";
import { openEditModal } from "./edit-modal";
import { isPreviewable, PREVIEW_MAX_BYTES, decodePreviewText } from "./sftp-preview";
import { openSftpRenameDialog } from "./sftp-rename-dialog";

/** 圖示＋文字標籤（取代表情符號前綴；文字以 textNode 注入避免遠端檔名注入 HTML） */
function iconLabel(name: UiIconName, text: string): HTMLElement {
  const span = document.createElement("span");
  span.className = "icon-label";
  span.replaceChildren(iconElement(name), document.createTextNode(text));
  return span;
}

/** 數值 mode → rwx 權限字串 */
export function modeToString(mode: number): string {
  const bit = (n: number, chars: [string, string]) =>
    (mode & n ? chars[0] : chars[1]);
  return (
    bit(0o400, ["r", "-"]) +
    bit(0o200, ["w", "-"]) +
    bit(0o100, ["x", "-"]) +
    bit(0o040, ["r", "-"]) +
    bit(0o020, ["w", "-"]) +
    bit(0o010, ["x", "-"]) +
    bit(0o004, ["r", "-"]) +
    bit(0o002, ["w", "-"]) +
    bit(0o001, ["x", "-"])
  );
}

export interface SftpPanelOptions {
  /** 操作失敗時的提示（toast/alert 由呼叫端決定） */
  onError(err: unknown): void;
  /** 確認對話框（D5：改為非同步以利 Liquid Glass confirm-modal 注入；fallback 保留 window.confirm 作安全網） */
  confirm?(message: string): Promise<boolean>;
  /** 輸入對話框（預設 window.prompt；D5 不在範圍） */
  prompt?(message: string, initial?: string): string | null;
  /** 重新命名對話框（檔案與資料夾共用） */
  renamePrompt?(currentName: string): Promise<string | null>;
}

export class SftpPanel {
  private currentPath = "/";
  private readonly confirm: (m: string) => Promise<boolean>;
  private readonly prompt: (m: string, i?: string) => string | null;
  private readonly renamePrompt: (currentName: string) => Promise<string | null>;

  constructor(
    private readonly container: HTMLElement,
    private readonly client: SshClientLike,
    private readonly connId: number,
    private readonly opts: SftpPanelOptions,
  ) {
    // D5 fallback 保留 window.confirm 作安全網（包 Promise.resolve 符合非同步介面）
    this.confirm = opts.confirm ?? ((m) => Promise.resolve(window.confirm(m)));
    this.prompt = opts.prompt ?? ((m, i) => window.prompt(m, i));
    this.renamePrompt = opts.renamePrompt ?? openSftpRenameDialog;
  }

  getCurrentPath(): string {
    return this.currentPath;
  }

  /** 開啟指定目錄並渲染 */
  async open(path: string = this.currentPath): Promise<void> {
    this.renderSkeleton(); // D18-(4) SFTP 骨架屏：載入中即時反饋
    try {
      const entries = await this.client.list(this.connId, path);
      this.currentPath = path;
      this.render(entries);
    } catch (err) {
      this.container.replaceChildren(); // 失敗清掉骨架，由 onError 提示
      this.opts.onError(err);
    }
  }

  /** 載入中骨架屏：toolbar（無路徑標籤）+ 4 列閃光條 */
  private renderSkeleton(): void {
    const toolbar = document.createElement("div");
    toolbar.className = "sftp-toolbar";
    const placeholder = document.createElement("span");
    placeholder.className = "sftp-path skeleton skeleton-line";
    placeholder.style.width = "120px";
    toolbar.append(
      this.iconButton("upload", "上傳檔案", () => void this.upload()),
      this.iconButton("folderPlus", "新增資料夾", () => void this.mkdir()),
      this.iconButton("refresh", "重新整理", () => void this.open()),
      placeholder,
    );
    const list = document.createElement("div");
    list.className = "sftp-skeleton-list";
    list.setAttribute("aria-hidden", "true");
    for (let i = 0; i < 4; i++) {
      const row = document.createElement("div");
      row.className = "skeleton sftp-skeleton-row";
      list.appendChild(row);
    }
    this.container.replaceChildren(toolbar, list);
  }

  private render(entries: SftpEntryLike[]): void {
    const table = document.createElement("table");
    table.className = "sftp-table";

    // 固定欄寬（對應 CSS .sftp-table col:nth-child()）
    const colgroup = document.createElement("colgroup");
    for (let i = 0; i < 5; i++) colgroup.appendChild(document.createElement("col"));
    table.appendChild(colgroup);

    // 麵包屑列（.. 回上層）
    const upRow = table.insertRow();
    upRow.className = "sftp-row sftp-up";
    if (this.currentPath === "/") {
      upRow.insertCell().textContent = "（根目錄）";
      upRow.insertCell();
      upRow.insertCell();
      upRow.insertCell();
    } else {
      const upCell = upRow.insertCell();
      upCell.replaceChildren(iconLabel("folder", ".."));
      upCell.className = "sftp-name";
      const upIcon = upCell.querySelector(".icon, svg");
      if (upIcon) {
        upIcon.classList.add("sftp-type-icon");
        upIcon.setAttribute("data-kind", "folder");
      }
      for (let i = 0; i < 3; i++) upRow.insertCell();
      upRow.addEventListener("click", () => void this.open(parentOf(this.currentPath)));
    }

    for (const e of entries) {
      const row = table.insertRow();
      row.className = "sftp-row";

      const nameCell = row.insertCell();
      nameCell.replaceChildren(iconLabel(e.isDir ? "folder" : "file", e.name));
      nameCell.className = "sftp-name";
      // D18-(4) 檔案類型分色：data-kind 供 CSS .sftp-type-icon[data-kind=...] 著色
      const icon = nameCell.querySelector(".icon, svg");
      if (icon) {
        icon.classList.add("sftp-type-icon");
        icon.setAttribute("data-kind", fileKindOf(e.name, e.isDir));
      }
      if (e.isDir) {
        nameCell.addEventListener("click", () =>
          void this.open(joinPath(this.currentPath, e.name)),
        );
      } else {
        // D45 點擊非資料夾檔名開編輯
        nameCell.addEventListener("click", () => void this.edit(e));
        nameCell.classList.add("is-clickable");
      }

      row.insertCell().textContent = e.isDir ? "--" : formatBytes(e.size);
      row.insertCell().textContent = modeToString(e.mode);
      row.insertCell().textContent = new Date(Number(e.modTime) * 1000).toLocaleString();

      const actions = row.insertCell();
      actions.className = "sftp-actions";
      actions.append(
        this.actionButton("重新命名", () => void this.rename(e)),
        this.actionButton("刪除", () => void this.remove(e)),
      );
      if (!e.isDir) {
        // D45 跨輯按鈕（純文字）+ 下載按鈕
        actions.append(
          this.actionButton("編輯", () => void this.edit(e)),
          this.actionButton("下載", () => void this.download(e)),
        );
      }
    }

    const toolbar = document.createElement("div");
    toolbar.className = "sftp-toolbar";
    toolbar.append(
      this.iconButton("upload", "上傳檔案", () => void this.upload()),
      this.iconButton("folderPlus", "新增資料夾", () => void this.mkdir()),
      this.iconButton("refresh", "重新整理", () => void this.open()),
    );
    const pathLabel = document.createElement("span");
    pathLabel.className = "sftp-path";
    pathLabel.textContent = this.currentPath;
    toolbar.prepend(pathLabel);

    this.container.replaceChildren(toolbar, table);
  }

  private actionButton(label: string, onClick: () => void): HTMLButtonElement {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = label;
    btn.className = "btn btn-ghost btn-sm";
    btn.addEventListener("click", onClick);
    return btn;
  }

  /** 僅圖示按鈕（D16）：以 aria-label＋title 提供無障礙提示 */
  private iconButton(
    name: UiIconName,
    label: string,
    onClick: () => void,
  ): HTMLButtonElement {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn btn-ghost btn-sm btn-icon";
    btn.setAttribute("aria-label", label);
    btn.title = label;
    btn.replaceChildren(iconElement(name));
    btn.addEventListener("click", onClick);
    return btn;
  }

  private async rename(entry: SftpEntryLike): Promise<void> {
    const newName = await this.renamePrompt(entry.name);
    if (!newName || newName === entry.name) return;
    try {
      await this.client.rename(
        this.connId,
        joinPath(this.currentPath, entry.name),
        joinPath(this.currentPath, newName),
      );
      await this.open();
    } catch (err) {
      this.opts.onError(err);
    }
  }

  private async remove(entry: SftpEntryLike): Promise<void> {
    const kind = entry.isDir ? "資料夾" : "檔案";
    // D5 confirm 已改為非同步（呼叫端可注入 openConfirmModal 達成 Liquid Glass 體驗）
    if (!await this.confirm(`確定刪除${kind}「${entry.name}」？此操作不可復原。`)) return;
    try {
      await this.client.remove(this.connId, joinPath(this.currentPath, entry.name));
      await this.open();
    } catch (err) {
      this.opts.onError(err);
    }
  }

  private async download(entry: SftpEntryLike): Promise<void> {
    try {
      const data = await this.client.readFile(
        this.connId,
        joinPath(this.currentPath, entry.name),
      );
      const url = URL.createObjectURL(new Blob([data as BlobPart]));
      const a = document.createElement("a");
      a.href = url;
      a.download = entry.name;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      this.opts.onError(err);
    }
  }

  /**
   * D34–D46 文字檔線上編輯。
   * - isPreviewable 守門（D36 與預覽相同條件）：資料夾／二進位／壓縮檔／圖片／超過 1MB 上限 → 拒絕並提示改用下載
   * - 通過後讀檔 → decodePreviewText 再判二進位 → openEditModal（CodeMirror 6 語法高亮、唯讀切換、存檔/另存/未儲存提示）
   * - onSave 覆蓋原檔（D42 二次確認由 edit-modal 內部處理）；onSaveAs 同目錄另存新檔（D41 檔名驗證由 edit-modal 內部處理）
   */
  private async edit(entry: SftpEntryLike): Promise<void> {
    if (!isPreviewable({ name: entry.name, isDir: entry.isDir, size: entry.size })) {
      if (entry.size > PREVIEW_MAX_BYTES) {
        this.opts.onError(
          new Error(
            `檔案過大（${formatBytes(entry.size)}），超過編輯上限 ${formatBytes(PREVIEW_MAX_BYTES)}，請改用下載。`,
          ),
        );
      } else {
        this.opts.onError(
          new Error("此檔案類型不支援線上編輯（二進位／壓縮檔／圖片），請改用下載。"),
        );
      }
      return;
    }
    try {
      const data = await this.client.readFile(
        this.connId,
        joinPath(this.currentPath, entry.name),
      );
      const text = decodePreviewText(data);
      if (text === null) {
        this.opts.onError(
          new Error("此檔案包含大量二進位資料，不支援線上編輯，請改用下載。"),
        );
        return;
      }
      await openEditModal({
        filename: entry.name,
        initialText: text,
        onSave: async (newText) => {
          await this.client.writeFile(
            this.connId,
            joinPath(this.currentPath, entry.name),
            new TextEncoder().encode(newText),
          );
        },
        onSaveAs: async (newName, newText) => {
          await this.client.writeFile(
            this.connId,
            joinPath(this.currentPath, newName),
            new TextEncoder().encode(newText),
          );
        },
        onDownload: () => void this.download(entry),
      });
    } catch (err) {
      this.opts.onError(err);
    }
  }

  private async upload(): Promise<void> {
    const input = document.createElement("input");
    input.type = "file";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        await this.client.writeFile(
          this.connId,
          joinPath(this.currentPath, file.name),
          new Uint8Array(await file.arrayBuffer()),
        );
        await this.open();
      } catch (err) {
        this.opts.onError(err);
      }
    };
    input.click();
  }

  private async mkdir(): Promise<void> {
    const name = this.prompt("新資料夾名稱：");
    if (!name) return;
    try {
      await this.client.mkdir(this.connId, joinPath(this.currentPath, name));
      await this.open();
    } catch (err) {
      this.opts.onError(err);
    }
  }
}
