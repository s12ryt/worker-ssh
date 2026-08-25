export type FolderDeleteChoice = "recursive" | "promote" | "cancel";

export function openFolderDeleteModal(
  folderName: string,
  recursiveHostCount: number,
): Promise<FolderDeleteChoice> {
  return new Promise((resolve) => {
    const backdrop = document.createElement("dialog");
    backdrop.className = "folder-delete-backdrop";

    const panel = document.createElement("section");
    panel.className = "folder-delete-modal glass-card";
    panel.setAttribute("role", "alertdialog");
    panel.setAttribute("aria-modal", "true");
    panel.setAttribute("aria-labelledby", "folder-delete-title");

    const title = document.createElement("h2");
    title.id = "folder-delete-title";
    title.textContent = `刪除資料夾「${folderName}」`;
    const message = document.createElement("p");
    message.textContent =
      `此資料夾包含 ${recursiveHostCount} 台主機。請選擇要連同所有後代一起刪除，` +
      "或只刪除資料夾並將直接內容提升到上一層。";

    const actions = document.createElement("div");
    actions.className = "folder-delete-actions";

    const finish = (choice: FolderDeleteChoice): void => {
      if (backdrop.open && typeof backdrop.close === "function") backdrop.close();
      backdrop.remove();
      resolve(choice);
    };

    const button = (
      label: string,
      choice: FolderDeleteChoice,
      className: string,
    ): HTMLButtonElement => {
      const element = document.createElement("button");
      element.type = "button";
      element.className = `btn ${className}`;
      element.dataset.folderDelete = choice;
      element.textContent = label;
      element.addEventListener("click", () => finish(choice));
      return element;
    };

    actions.append(
      button("全部刪除", "recursive", "btn-danger"),
      button("只刪除資料夾", "promote", "btn-ghost"),
      button("取消", "cancel", "btn-ghost"),
    );
    panel.append(title, message, actions);
    backdrop.appendChild(panel);
    backdrop.addEventListener("cancel", (event) => {
      event.preventDefault();
      finish("cancel");
    });
    document.body.appendChild(backdrop);
    if (typeof backdrop.showModal === "function") backdrop.showModal();
    else backdrop.setAttribute("open", "");
    panel.focus();
  });
}
