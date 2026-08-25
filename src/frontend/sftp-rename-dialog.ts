export function openSftpRenameDialog(currentName: string): Promise<string | null> {
  return new Promise((resolve) => {
    const dialog = document.createElement("dialog");
    dialog.className = "sftp-rename-dialog glass-dialog";

    const form = document.createElement("form");
    form.method = "dialog";
    const title = document.createElement("h2");
    title.textContent = "重新命名";
    const label = document.createElement("label");
    label.className = "field";
    label.textContent = "新名稱";
    const input = document.createElement("input");
    input.name = "name";
    input.required = true;
    input.autocomplete = "off";
    input.value = currentName;
    label.appendChild(input);

    const actions = document.createElement("div");
    actions.className = "dialog-actions";
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "btn btn-ghost";
    cancel.textContent = "取消";
    const confirm = document.createElement("button");
    confirm.type = "submit";
    confirm.className = "btn btn-primary";
    confirm.textContent = "重新命名";
    actions.append(cancel, confirm);
    form.append(title, label, actions);
    dialog.appendChild(form);
    document.body.appendChild(dialog);

    let finished = false;
    const finish = (value: string | null) => {
      if (finished) return;
      finished = true;
      if (dialog.open) dialog.close();
      dialog.remove();
      resolve(value);
    };

    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const value = input.value.trim();
      if (!value) {
        input.setCustomValidity("名稱不可為空白");
        input.reportValidity();
        return;
      }
      input.setCustomValidity("");
      finish(value);
    });
    cancel.addEventListener("click", () => finish(null));
    dialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      finish(null);
    });

    dialog.showModal();
    input.focus();
    input.select();
  });
}
