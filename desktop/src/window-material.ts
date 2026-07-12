export const minimumWindowsMicaBuild = 22621;

export function shouldUseWindowsMica(
  platform: NodeJS.Platform,
  systemVersion: string,
  prefersReducedTransparency: boolean,
): boolean {
  if (platform !== "win32" || prefersReducedTransparency) return false;
  const build = Number(systemVersion.split(".")[2]);
  return Number.isInteger(build) && build >= minimumWindowsMicaBuild;
}
