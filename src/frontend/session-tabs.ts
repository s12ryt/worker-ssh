export type SessionTab = "terminal" | "sftp";

export function activateSessionTab(tabName: SessionTab, root: Document = document): void {
  root.querySelectorAll<HTMLElement>(".tab[data-tab]").forEach((tab) => {
    tab.classList.toggle("active", tab.dataset.tab === tabName);
  });

  for (const panelName of ["terminal", "sftp"] as const) {
    const panel = root.getElementById(`panel-${panelName}`);
    if (!panel) continue;
    const active = panelName === tabName;
    panel.classList.toggle("hidden", !active);
    panel.classList.toggle("active", active);
  }
}
