import { desktopPlatform, type DesktopPlatform } from "./platform";

function desktopShortcutModifierKey(platform: DesktopPlatform = desktopPlatform()): string {
  return platform === "darwin" ? "Command" : "Ctrl";
}

function desktopShortcutKeyLabel(key: string, platform: DesktopPlatform = desktopPlatform()): string {
  if (platform !== "darwin") return key;
  if (key === "Command") return "⌘";
  if (key === "Option") return "⌥";
  if (key === "Shift") return "⇧";
  if (key === "Arrow left") return "←";
  if (key === "Arrow right") return "→";
  return key;
}

export { desktopShortcutKeyLabel, desktopShortcutModifierKey };
