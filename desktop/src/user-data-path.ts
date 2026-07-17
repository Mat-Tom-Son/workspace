import { posix, win32 } from "node:path";

const developmentUserDataName = "Workspace Development";

export interface WorkspaceDesktopUserDataPathOptions {
  appDataPath: string;
  productName: string;
  useInstalledProductData: boolean;
  override?: string;
  platform?: NodeJS.Platform;
  currentDirectory?: string;
}

export interface WorkspaceDesktopInstalledDataOptions {
  executablePath: string;
  productName: string;
  isPackaged: boolean;
  fileExists(path: string): boolean;
  platform?: NodeJS.Platform;
}

export function workspaceDesktopStateOverride(
  environment: Readonly<Record<string, string | undefined>>,
): string | undefined {
  return environment.WORKSPACE_DESKTOP_STATE_DIR;
}

export function workspaceDesktopUsesInstalledProductData(options: WorkspaceDesktopInstalledDataOptions): boolean {
  if (!options.isPackaged) return false;
  const platform = options.platform ?? process.platform;
  if (platform !== "win32") return true;

  // Electron Builder's signed release candidate and the installed NSIS app use
  // the same packaged bytes and updater manifest. The installer-owned sibling
  // uninstaller is the durable distinction that survives a custom install path.
  // If that evidence is missing, fail safe into development state so launching
  // any unpacked package cannot migrate the installed product's data.
  const executableDirectory = win32.dirname(options.executablePath);
  return options.fileExists(win32.join(executableDirectory, `Uninstall ${options.productName}.exe`));
}

export function workspaceDesktopUserDataPath(options: WorkspaceDesktopUserDataPathOptions): string {
  const platform = options.platform ?? process.platform;
  const paths = platform === "win32" ? win32 : posix;
  const override = options.override?.trim();
  if (override) return paths.resolve(options.currentDirectory ?? process.cwd(), override);
  return paths.resolve(
    options.appDataPath,
    options.useInstalledProductData ? options.productName : developmentUserDataName,
  );
}
