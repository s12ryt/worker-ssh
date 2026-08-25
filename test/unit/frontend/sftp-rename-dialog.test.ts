// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openSftpRenameDialog } from "../../../src/frontend/sftp-rename-dialog";

describe("openSftpRenameDialog", () => {
  beforeEach(() => {
    vi.stubGlobal("HTMLDialogElement", window.HTMLDialogElement);
    Object.defineProperty(window.HTMLDialogElement.prototype, "showModal", {
      configurable: true,
      value: vi.fn(function (this: HTMLDialogElement) {
        Object.defineProperty(this, "open", { configurable: true, value: true });
      }),
    });
    Object.defineProperty(window.HTMLDialogElement.prototype, "close", {
      configurable: true,
      value: vi.fn(function (this: HTMLDialogElement) {
        Object.defineProperty(this, "open", { configurable: true, value: false });
      }),
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.replaceChildren();
    delete (window.HTMLDialogElement.prototype as Partial<HTMLDialogElement>).showModal;
    delete (window.HTMLDialogElement.prototype as Partial<HTMLDialogElement>).close;
  });

  it("以原生 modal dialog 預填完整名稱並在顯示後全選", async () => {
    const promise = openSftpRenameDialog("notes.md");
    const dialog = document.querySelector("dialog.sftp-rename-dialog");
    const input = dialog?.querySelector("input");
    expect(dialog).toBeInstanceOf(window.HTMLDialogElement);
    expect(window.HTMLDialogElement.prototype.showModal).toHaveBeenCalledOnce();
    expect(input?.value).toBe("notes.md");
    expect(input?.selectionStart).toBe(0);
    expect(input?.selectionEnd).toBe("notes.md".length);

    input!.value = "renamed.md";
    (dialog!.querySelector("form") as HTMLFormElement).dispatchEvent(
      new SubmitEvent("submit", { bubbles: true, cancelable: true }),
    );
    await expect(promise).resolves.toBe("renamed.md");
  });

  it("空白名稱禁止提交，Escape 或取消回 null", async () => {
    const promise = openSftpRenameDialog("folder");
    const dialog = document.querySelector("dialog.sftp-rename-dialog")!;
    const input = dialog.querySelector("input")!;
    input.value = "   ";
    (dialog.querySelector("form") as HTMLFormElement).dispatchEvent(
      new SubmitEvent("submit", { bubbles: true, cancelable: true }),
    );
    expect(dialog.isConnected).toBe(true);

    dialog.dispatchEvent(new Event("cancel", { cancelable: true }));
    await expect(promise).resolves.toBeNull();
  });
});
