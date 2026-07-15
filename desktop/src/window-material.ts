export const minimumWindowsMicaBuild = 22621;

export type DesktopWindowMaterial = "mica" | "vibrancy" | "none";

export function shouldUseWindowsMica(
  platform: NodeJS.Platform,
  systemVersion: string,
  prefersReducedTransparency: boolean,
): boolean {
  if (platform !== "win32" || prefersReducedTransparency) return false;
  const build = Number(systemVersion.split(".")[2]);
  return Number.isInteger(build) && build >= minimumWindowsMicaBuild;
}

export function shouldUseMacVibrancy(
  platform: NodeJS.Platform,
  prefersReducedTransparency: boolean,
  enabled = true,
): boolean {
  return enabled && platform === "darwin" && !prefersReducedTransparency;
}

export function desktopWindowMaterial(
  platform: NodeJS.Platform,
  options: {
    windowsMica: boolean;
    macVibrancy: boolean;
  },
): DesktopWindowMaterial {
  if (platform === "win32" && options.windowsMica) return "mica";
  if (platform === "darwin" && options.macVibrancy) return "vibrancy";
  return "none";
}
