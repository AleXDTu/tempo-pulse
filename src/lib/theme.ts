/** 主题应用：gruvbox 双主题，写入 html[data-theme]（三个窗口共用） */
export function applyTheme(theme: string | undefined | null) {
  document.documentElement.dataset.theme = theme === "light" ? "light" : "dark";
}
