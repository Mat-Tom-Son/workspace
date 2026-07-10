

function desktopShortcutModifierLabel(): string {
  return window.workspaceDesktop?.app.platform === "darwin" ? "Cmd" : "Ctrl";
}

export { desktopShortcutModifierLabel };
