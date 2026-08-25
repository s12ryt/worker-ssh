// @vitest-environment jsdom
// 確認框 Modal（D1–D8）行為契約測試
// 環境：jsdom（per-file 切換；其他 14 檔維持 node 環境）
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { openConfirmModal, type ConfirmModalOptions } from "@/frontend/confirm-modal";

describe("openConfirmModal — 匯出與簽名（D1）", () => {
  beforeEach(() => { document.body.innerHTML = ""; });
  afterEach(() => { document.body.innerHTML = ""; });

  it("匯出為函式", () => {
    expect(typeof openConfirmModal).toBe("function");
  });

  it("回傳 Promise<boolean>", async () => {
    const p = openConfirmModal({ message: "簽名測試" });
    expect(p).toBeInstanceOf(Promise);
    // 清理：取消
    (document.querySelector(".btn-cancel") as HTMLButtonElement).click();
    const result = await p;
    expect(typeof result).toBe("boolean");
  });

  it("接受完整 opts 物件（message/title/confirmText/cancelText/danger）", () => {
    const opts: ConfirmModalOptions = {
      message: "完整選項",
      title: "標題",
      confirmText: "確認",
      cancelText: "取消",
      danger: true,
    };
    expect(() => openConfirmModal(opts)).not.toThrow();
    (document.querySelector(".btn-cancel") as HTMLButtonElement).click();
  });

  it("title / confirmText / cancelText / danger 皆為可選", () => {
    expect(() => openConfirmModal({ message: "最小選項" })).not.toThrow();
    (document.querySelector(".btn-cancel") as HTMLButtonElement).click();
  });
});

describe("openConfirmModal — 關閉路徑（D2）", () => {
  beforeEach(() => { document.body.innerHTML = ""; });
  afterEach(() => { document.body.innerHTML = ""; });

  it("確認鈕點擊回 true 並移除 DOM", async () => {
    const p = openConfirmModal({ message: "確認嗎？" });
    const confirmBtn = document.querySelector(".btn-confirm") as HTMLButtonElement;
    expect(confirmBtn).toBeTruthy();
    confirmBtn.click();
    const result = await p;
    expect(result).toBe(true);
    expect(document.querySelector(".confirm-backdrop")).toBeNull();
  });

  it("取消鈕點擊回 false 並移除 DOM", async () => {
    const p = openConfirmModal({ message: "取消嗎？" });
    const cancelBtn = document.querySelector(".btn-cancel") as HTMLButtonElement;
    expect(cancelBtn).toBeTruthy();
    cancelBtn.click();
    const result = await p;
    expect(result).toBe(false);
    expect(document.querySelector(".confirm-backdrop")).toBeNull();
  });

  it("backdrop 點擊不關閉、Promise 不 resolve", async () => {
    let resolved = false;
    const p = openConfirmModal({ message: "backdrop 不關閉" });
    p.then(() => { resolved = true; });
    const backdrop = document.querySelector(".confirm-backdrop") as HTMLElement;
    expect(backdrop).toBeTruthy();
    // 模擬點擊 backdrop 本身（ev.target === backdrop）
    backdrop.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    // 讓微任務跑完
    await Promise.resolve();
    await Promise.resolve();
    expect(resolved).toBe(false);
    expect(document.querySelector(".confirm-backdrop")).not.toBeNull();
    // 清理
    (document.querySelector(".btn-cancel") as HTMLButtonElement).click();
    await p;
  });

  it("Esc 鍵回 false 並移除 DOM", async () => {
    const p = openConfirmModal({ message: "Esc 測試" });
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    const result = await p;
    expect(result).toBe(false);
    expect(document.querySelector(".confirm-backdrop")).toBeNull();
  });

  it("Esc 鍵呼叫 preventDefault（不觸發瀏覽器預設）", async () => {
    const p = openConfirmModal({ message: "Esc preventDefault" });
    const ev = new KeyboardEvent("keydown", { key: "Escape", cancelable: true });
    const spy = vi.spyOn(ev, "preventDefault");
    document.dispatchEvent(ev);
    await p;
    expect(spy).toHaveBeenCalled();
  });
});

describe("openConfirmModal — 按鈕文字（慣例）", () => {
  beforeEach(() => { document.body.innerHTML = ""; });
  afterEach(() => { document.body.innerHTML = ""; });

  it("預設按鈕文字為「確定」「取消」", () => {
    openConfirmModal({ message: "預設文字" });
    const confirmBtn = document.querySelector(".btn-confirm") as HTMLButtonElement;
    const cancelBtn = document.querySelector(".btn-cancel") as HTMLButtonElement;
    expect(confirmBtn.textContent).toBe("確定");
    expect(cancelBtn.textContent).toBe("取消");
    cancelBtn.click();
  });

  it("自訂 confirmText 生效", () => {
    openConfirmModal({ message: "自訂確認", confirmText: "刪除" });
    const confirmBtn = document.querySelector(".btn-confirm") as HTMLButtonElement;
    expect(confirmBtn.textContent).toBe("刪除");
    (document.querySelector(".btn-cancel") as HTMLButtonElement).click();
  });

  it("自訂 cancelText 生效", () => {
    openConfirmModal({ message: "自訂取消", cancelText: "保留" });
    const cancelBtn = document.querySelector(".btn-cancel") as HTMLButtonElement;
    expect(cancelBtn.textContent).toBe("保留");
    cancelBtn.click();
  });
});

describe("openConfirmModal — 危險動作樣式（D3）", () => {
  beforeEach(() => { document.body.innerHTML = ""; });
  afterEach(() => { document.body.innerHTML = ""; });

  it("danger=true 時確認鈕有 btn-danger class", () => {
    openConfirmModal({ message: "危險", danger: true });
    const confirmBtn = document.querySelector(".btn-confirm") as HTMLButtonElement;
    expect(confirmBtn.classList.contains("btn-danger")).toBe(true);
    (document.querySelector(".btn-cancel") as HTMLButtonElement).click();
  });

  it("danger 預設 false，確認鈕無 btn-danger", () => {
    openConfirmModal({ message: "安全" });
    const confirmBtn = document.querySelector(".btn-confirm") as HTMLButtonElement;
    expect(confirmBtn.classList.contains("btn-danger")).toBe(false);
    (document.querySelector(".btn-cancel") as HTMLButtonElement).click();
  });

  it("danger=true 不影響取消鈕樣式", () => {
    openConfirmModal({ message: "危險取消", danger: true });
    const cancelBtn = document.querySelector(".btn-cancel") as HTMLButtonElement;
    expect(cancelBtn.classList.contains("btn-danger")).toBe(false);
    cancelBtn.click();
  });
});

describe("openConfirmModal — 無障礙屬性（慣例）", () => {
  beforeEach(() => { document.body.innerHTML = ""; });
  afterEach(() => { document.body.innerHTML = ""; });

  it("role=alertdialog", () => {
    openConfirmModal({ message: "role" });
    const dialog = document.querySelector(".confirm-modal") as HTMLElement;
    expect(dialog.getAttribute("role")).toBe("alertdialog");
    (document.querySelector(".btn-cancel") as HTMLButtonElement).click();
  });

  it("aria-modal=true", () => {
    openConfirmModal({ message: "aria" });
    const dialog = document.querySelector(".confirm-modal") as HTMLElement;
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    (document.querySelector(".btn-cancel") as HTMLButtonElement).click();
  });

  it("aria-label 為 message", () => {
    openConfirmModal({ message: "專屬訊息內容" });
    const dialog = document.querySelector(".confirm-modal") as HTMLElement;
    expect(dialog.getAttribute("aria-label")).toBe("專屬訊息內容");
    (document.querySelector(".btn-cancel") as HTMLButtonElement).click();
  });
});

describe("openConfirmModal — 焦點（D7）", () => {
  beforeEach(() => { document.body.innerHTML = ""; });
  afterEach(() => { document.body.innerHTML = ""; });

  it("開啟時焦點不預設選中確認鈕", () => {
    openConfirmModal({ message: "焦點1" });
    const confirmBtn = document.querySelector(".btn-confirm") as HTMLButtonElement;
    expect(document.activeElement).not.toBe(confirmBtn);
    (document.querySelector(".btn-cancel") as HTMLButtonElement).click();
  });

  it("開啟時焦點不預設選中取消鈕", () => {
    openConfirmModal({ message: "焦點2" });
    const cancelBtn = document.querySelector(".btn-cancel") as HTMLButtonElement;
    expect(document.activeElement).not.toBe(cancelBtn);
    cancelBtn.click();
  });
});

describe("openConfirmModal — DOM 結構", () => {
  beforeEach(() => { document.body.innerHTML = ""; });
  afterEach(() => { document.body.innerHTML = ""; });

  it("backdrop > dialog(confirm-modal) > content 三層", () => {
    openConfirmModal({ message: "結構" });
    const backdrop = document.querySelector(".confirm-backdrop");
    const dialog = document.querySelector(".confirm-modal");
    const content = document.querySelector(".confirm-content");
    expect(backdrop).toBeTruthy();
    expect(dialog).toBeTruthy();
    expect(content).toBeTruthy();
    expect(dialog!.parentElement).toBe(backdrop);
    expect(content!.parentElement).toBe(dialog);
    (document.querySelector(".btn-cancel") as HTMLButtonElement).click();
  });

  it("訊息顯示在 .confirm-content 內", () => {
    openConfirmModal({ message: "顯示這段文字" });
    const content = document.querySelector(".confirm-content") as HTMLElement;
    expect(content.textContent).toContain("顯示這段文字");
    (document.querySelector(".btn-cancel") as HTMLButtonElement).click();
  });

  it("title 傳入時顯示標題列", () => {
    openConfirmModal({ message: "內容", title: "我的標題" });
    const titleEl = document.querySelector(".confirm-title");
    expect(titleEl).toBeTruthy();
    expect(titleEl!.textContent).toBe("我的標題");
    (document.querySelector(".btn-cancel") as HTMLButtonElement).click();
  });

  it("不傳 title 時不顯示標題列", () => {
    openConfirmModal({ message: "無標題" });
    const titleEl = document.querySelector(".confirm-title");
    expect(titleEl).toBeNull();
    (document.querySelector(".btn-cancel") as HTMLButtonElement).click();
  });

  it("掛載至 document.body", () => {
    openConfirmModal({ message: "掛載" });
    const backdrop = document.querySelector(".confirm-backdrop") as HTMLElement;
    expect(backdrop.parentElement).toBe(document.body);
    (document.querySelector(".btn-cancel") as HTMLButtonElement).click();
  });
});

describe("openConfirmModal — 原生 dialog top layer", () => {
  beforeEach(() => { document.body.innerHTML = ""; });
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("以 showModal 進入 top layer，能疊加在既有原生 dialog 上", async () => {
    const showModal = vi.fn(function (this: HTMLDialogElement) {
      this.setAttribute("open", "");
    });
    const close = vi.fn(function (this: HTMLDialogElement) {
      this.removeAttribute("open");
    });
    Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
      configurable: true,
      value: showModal,
    });
    Object.defineProperty(HTMLDialogElement.prototype, "close", {
      configurable: true,
      value: close,
    });

    const outerDialog = document.createElement("dialog");
    outerDialog.setAttribute("open", "");
    document.body.appendChild(outerDialog);

    const result = openConfirmModal({ message: "疊加確認" });
    const backdrop = document.querySelector(".confirm-backdrop");
    const usesNativeDialog = backdrop instanceof HTMLDialogElement;
    const showModalCalls = showModal.mock.calls.length;

    (document.querySelector(".btn-cancel") as HTMLButtonElement).click();
    await expect(result).resolves.toBe(false);

    expect(usesNativeDialog).toBe(true);
    expect(showModalCalls).toBe(1);
    expect(close).toHaveBeenCalledTimes(1);
  });
});

describe("openConfirmModal — 多執行個體（慣例：不強制單例）", () => {
  beforeEach(() => { document.body.innerHTML = ""; });
  afterEach(() => { document.body.innerHTML = ""; });

  it("同時開啟兩個 confirm 不衝突", async () => {
    const p1 = openConfirmModal({ message: "第一個" });
    const p2 = openConfirmModal({ message: "第二個" });
    const backdrops = document.querySelectorAll(".confirm-backdrop");
    expect(backdrops.length).toBe(2);
    // 關閉第一個（確認）
    (document.querySelector(".btn-confirm") as HTMLButtonElement).click();
    const r1 = await p1;
    expect(r1).toBe(true);
    // 第一個移除後，querySelector 找到第二個的取消鈕
    expect(document.querySelectorAll(".confirm-backdrop").length).toBe(1);
    (document.querySelector(".btn-cancel") as HTMLButtonElement).click();
    const r2 = await p2;
    expect(r2).toBe(false);
    expect(document.querySelectorAll(".confirm-backdrop").length).toBe(0);
  });
});

describe("openConfirmModal — Esc 疊加攔截（D8）", () => {
  beforeEach(() => { document.body.innerHTML = ""; });
  afterEach(() => { document.body.innerHTML = ""; });

  it("confirm-modal 開啟時外部 keydown listener 收不到 Escape", async () => {
    const spy = vi.fn();
    document.addEventListener("keydown", spy);
    const p = openConfirmModal({ message: "攔截 Esc" });
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    const result = await p;
    expect(result).toBe(false);
    expect(spy).not.toHaveBeenCalled();
    document.removeEventListener("keydown", spy);
  });

  it("confirm-modal 開啟時外部 keydown listener 收不到任意鍵", async () => {
    const spy = vi.fn();
    document.addEventListener("keydown", spy);
    const p = openConfirmModal({ message: "攔截任意鍵" });
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "a" }));
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab" }));
    await Promise.resolve();
    await Promise.resolve();
    expect(spy).not.toHaveBeenCalled();
    // 清理
    (document.querySelector(".btn-cancel") as HTMLButtonElement).click();
    await p;
    document.removeEventListener("keydown", spy);
  });

  it("confirm-modal 關閉後外部 listener 恢復接收", async () => {
    const spy = vi.fn();
    document.addEventListener("keydown", spy);
    const p = openConfirmModal({ message: "恢復測試" });
    (document.querySelector(".btn-cancel") as HTMLButtonElement).click();
    await p;
    // 關閉後 dispatch，外部 listener 應收到
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "a" }));
    expect(spy).toHaveBeenCalled();
    document.removeEventListener("keydown", spy);
  });
});

describe("openConfirmModal — 冪等與清理", () => {
  beforeEach(() => { document.body.innerHTML = ""; });
  afterEach(() => { document.body.innerHTML = ""; });

  it("確認後 DOM 完全移除（無殘留 listener）", async () => {
    const p = openConfirmModal({ message: "清理" });
    (document.querySelector(".btn-confirm") as HTMLButtonElement).click();
    await p;
    expect(document.querySelector(".confirm-backdrop")).toBeNull();
    // 確認後按 Esc 不應拋錯（listener 已移除）
    expect(() =>
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })),
    ).not.toThrow();
  });

  it("取消後 DOM 完全移除", async () => {
    const p = openConfirmModal({ message: "清理2" });
    (document.querySelector(".btn-cancel") as HTMLButtonElement).click();
    await p;
    expect(document.querySelector(".confirm-backdrop")).toBeNull();
  });
});
