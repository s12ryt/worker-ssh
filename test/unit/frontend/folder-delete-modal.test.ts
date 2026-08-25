// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openFolderDeleteModal } from "../../../src/frontend/folder-delete-modal";

describe("folder delete modal", () => {
  const showModalDescriptor = Object.getOwnPropertyDescriptor(
    HTMLDialogElement.prototype,
    "showModal",
  );
  const closeDescriptor = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, "close");

  beforeEach(() => {
    document.body.innerHTML = "";
    Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
      configurable: true,
      value: vi.fn(function (this: HTMLDialogElement) {
        this.setAttribute("open", "");
      }),
    });
    Object.defineProperty(HTMLDialogElement.prototype, "close", {
      configurable: true,
      value: vi.fn(function (this: HTMLDialogElement) {
        this.removeAttribute("open");
      }),
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (showModalDescriptor) {
      Object.defineProperty(HTMLDialogElement.prototype, "showModal", showModalDescriptor);
    } else {
      delete (HTMLDialogElement.prototype as Partial<HTMLDialogElement>).showModal;
    }
    if (closeDescriptor) {
      Object.defineProperty(HTMLDialogElement.prototype, "close", closeDescriptor);
    } else {
      delete (HTMLDialogElement.prototype as Partial<HTMLDialogElement>).close;
    }
    document.body.innerHTML = "";
  });

  it("以原生 dialog 顯示全部刪除、只刪資料夾與取消三個結果", async () => {
    const recursive = openFolderDeleteModal("Production", 12);
    expect(document.querySelector("dialog.folder-delete-backdrop")).toBeInstanceOf(
      HTMLDialogElement,
    );
    expect(document.body.textContent).toContain("Production");
    expect(document.body.textContent).toContain("12 台主機");
    (document.querySelector('[data-folder-delete="recursive"]') as HTMLButtonElement).click();
    await expect(recursive).resolves.toBe("recursive");

    const promote = openFolderDeleteModal("Production", 12);
    (document.querySelector('[data-folder-delete="promote"]') as HTMLButtonElement).click();
    await expect(promote).resolves.toBe("promote");

    const cancel = openFolderDeleteModal("Production", 12);
    (document.querySelector('[data-folder-delete="cancel"]') as HTMLButtonElement).click();
    await expect(cancel).resolves.toBe("cancel");
  });

  it("Esc 與 native cancel 都只會取消，不執行刪除", async () => {
    const promise = openFolderDeleteModal("Ops", 2);
    const dialog = document.querySelector("dialog.folder-delete-backdrop") as HTMLDialogElement;
    const event = new Event("cancel", { cancelable: true });
    dialog.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    await expect(promise).resolves.toBe("cancel");
  });
});
