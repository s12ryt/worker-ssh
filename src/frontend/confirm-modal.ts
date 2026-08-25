// 確認框 Modal（Liquid Glass 風格）
// 取代 window.confirm，提供與 .preview-modal/.edit-modal 一致的視覺與行為。
//
// 設計決策（question.md 第九節）：
//   D1 簽名：openConfirmModal({ message, title?, confirmText?, cancelText?, danger? }): Promise<boolean>
//   D2 關閉路徑：確認鈕=確認 / 取消鈕=取消 / Esc=取消 / backdrop 點擊不關閉
//   D3 危險動作：danger=true 時確認鈕加 .btn-danger
//   D4 疊加：原生 dialog showModal() 進入 top layer，可覆蓋其他 modal dialog
//   D6 不重構既有 modal，本模組獨立
//   D7 焦點：dialog（tabindex=-1）focus，不預設選中按鈕
//   D8 Esc 疊加：capture 階段攔截 + stopImmediatePropagation，外層 modal 收不到按鍵

export interface ConfirmModalOptions {
  /** 主要訊息內容（必填，亦作為 aria-label） */
  message: string;
  /** 標題（可選，未傳則不渲染標題列） */
  title?: string;
  /** 確認鈕文字，預設「確定」 */
  confirmText?: string;
  /** 取消鈕文字，預設「取消」 */
  cancelText?: string;
  /** 危險動作樣式，true 時確認鈕套用 .btn-danger */
  danger?: boolean;
}

/**
 * 開啟確認框 Modal，回傳使用者選擇結果的 Promise。
 *
 * - backdrop 點擊不關閉（與 edit-modal 不同，強制使用者明確選擇）
 * - Esc 視為「取消」
 * - 開啟期間以 capture 階段攔截所有 keydown 並 stopImmediatePropagation，
 *   避免外層已開啟的 modal（如 edit-modal）收到按鍵造成雙重關閉（D8）
 */
export async function openConfirmModal(opts: ConfirmModalOptions): Promise<boolean> {
  const {
    message,
    title,
    confirmText = "確定",
    cancelText = "取消",
    danger = false,
  } = opts;

  const backdrop = document.createElement("dialog");
  backdrop.className = "confirm-backdrop";

  const dialog = document.createElement("div");
  dialog.className = "confirm-modal";
  dialog.setAttribute("role", "alertdialog");
  dialog.setAttribute("aria-modal", "true");
  dialog.setAttribute("aria-label", message);
  dialog.setAttribute("tabindex", "-1");

  if (title) {
    const titleEl = document.createElement("div");
    titleEl.className = "confirm-title";
    titleEl.textContent = title;
    dialog.appendChild(titleEl);
  }

  const content = document.createElement("div");
  content.className = "confirm-content";
  content.textContent = message;
  dialog.appendChild(content);

  const footer = document.createElement("div");
  footer.className = "confirm-footer";
  const actions = document.createElement("div");
  actions.className = "confirm-actions";

  const confirmBtn = document.createElement("button");
  confirmBtn.type = "button";
  confirmBtn.className = danger
    ? "btn btn-primary btn-confirm btn-danger"
    : "btn btn-primary btn-confirm";
  confirmBtn.textContent = confirmText;

  const cancelBtn = document.createElement("button");
  cancelBtn.type = "button";
  cancelBtn.className = "btn btn-ghost btn-cancel";
  cancelBtn.textContent = cancelText;

  actions.append(confirmBtn, cancelBtn);
  footer.appendChild(actions);
  dialog.appendChild(footer);

  backdrop.appendChild(dialog);
  document.body.appendChild(backdrop);

  if (typeof backdrop.showModal === "function") {
    backdrop.showModal();
  } else {
    // jsdom 等不支援 dialog API 的環境仍可驗證其餘行為。
    backdrop.setAttribute("open", "");
  }

  // D7：焦點放 dialog（tabindex=-1 可聚焦），不預設選中任一按鈕
  dialog.focus();

  return new Promise<boolean>((resolve) => {
    let resolved = false;

    const finish = (value: boolean): void => {
      if (resolved) return; // 冪等保護
      resolved = true;
      document.removeEventListener("keydown", onKeydown, true);
      if (backdrop.open && typeof backdrop.close === "function") {
        backdrop.close();
      }
      backdrop.remove();
      resolve(value);
    };

    // D8：capture 階段註冊，攔截所有按鍵避免外層 modal 收到
    const onKeydown = (ev: KeyboardEvent): void => {
      // 阻止同 target（document）後續的 bubble listener 收到事件
      ev.stopImmediatePropagation();
      if (ev.key === "Escape") {
        ev.preventDefault();
        finish(false);
      }
    };

    confirmBtn.addEventListener("click", () => finish(true));
    cancelBtn.addEventListener("click", () => finish(false));
    backdrop.addEventListener("cancel", (ev) => {
      ev.preventDefault();
      finish(false);
    });
    document.addEventListener("keydown", onKeydown, true); // capture=true
  });
}
