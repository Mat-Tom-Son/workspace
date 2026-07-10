import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, normalize, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  Menu,
  net,
  powerSaveBlocker,
  protocol,
  screen,
  shell,
  type IpcMainInvokeEvent,
  type MenuItemConstructorOptions,
  type Rectangle,
} from "electron";

import { RoutedPiExtensionUiBridge, type PiExtensionUiEvent } from "../../src/local/agent/extension-ui.js";
import { defaultAgentSdkDir } from "../../src/local/agent/agent-data-dir.js";
import { startLocalApi } from "../../src/local/server.js";
import { getWorkspace } from "../../src/local/workspace.js";
import { PackagedPiRuntimeProvider } from "./pi-runtime.js";
import { SecureSettingsStore } from "./settings.js";
import { WorkspaceUpdater, type WorkspaceUpdateCheckResult } from "./updater.js";

const productName = "Workspace";
const appProtocol = "workspace-desktop";
const appUserModelId = "io.github.mattomson.workspace";
const currentFile = fileURLToPath(import.meta.url);
const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url));
const folderGrantTtlMs = 5 * 60 * 1000;
const folderGrants = new Map<string, { rootPath: string; expiresAt: number }>();

let mainWindow: BrowserWindow | null = null;
let closeLocalApi: (() => Promise<void>) | null = null;
let piRuntime: PackagedPiRuntimeProvider | null = null;
let apiSessionToken = "";
let quitting = false;
let powerBlockerId: number | null = null;
let workspaceUpdater: WorkspaceUpdater | null = null;
let shutdownPromise: Promise<void> | null = null;

protocol.registerSchemesAsPrivileged([{
  scheme: appProtocol,
  privileges: {
    standard: true,
    secure: true,
    supportFetchAPI: true,
    corsEnabled: true,
    stream: true,
  },
}]);

app.setName(productName);
if (process.platform === "win32") app.setAppUserModelId(appUserModelId);

const ownsInstance = app.requestSingleInstanceLock();
if (!ownsInstance) app.quit();

if (ownsInstance) {
  app.on("second-instance", () => showWindow());
  app.whenReady().then(async () => {
    configureStableUserDataPath();
    registerRendererProtocol();
    registerIpc();
    await createMainWindow();
    configureUpdater();
    configureMenu();
    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) void createMainWindow();
      else showWindow();
    });
  }).catch((error) => {
    dialog.showErrorBox(`${productName} could not start`, errorMessage(error));
    app.quit();
  });
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", (event) => {
  if (quitting) return;
  event.preventDefault();
  void prepareToQuit().finally(() => app.quit());
});

async function createMainWindow(): Promise<void> {
  if (mainWindow && !mainWindow.isDestroyed()) {
    showWindow();
    return;
  }

  const userData = app.getPath("userData");
  const settings = new SecureSettingsStore(join(userData, "secure-settings.bin"));
  const extensionUi = new RoutedPiExtensionUiBridge();
  extensionUi.on("event", (event: PiExtensionUiEvent) => {
    if (event.method === "openExternal") void openExternal(event.url);
    else if (event.method === "oauthDeviceCode") void openExternal(event.verificationUri);
    else if (event.method === "copyText") clipboard.writeText(event.text);
    else if (event.method === "openSettings") mainWindow?.webContents.send("workspace:agent:open-settings");
    else if (event.method === "quit") app.quit();
  });
  piRuntime = new PackagedPiRuntimeProvider({
    agentDir: defaultAgentSdkDir(),
    authStorageHost: settings,
    extensionUi,
  });

  apiSessionToken = randomUUID();
  const api = await startLocalApi({
    appMode: "desktop",
    port: 0,
    workspaceBase: join(userData, "workspaces"),
    stateBase: userData,
    sessionToken: apiSessionToken,
    allowedOrigins: [`${appProtocol}://app`],
    piRuntimeProvider: piRuntime,
    extensionUiBridge: extensionUi,
    localFolderGrantProvider: { consumeLocalFolderGrant },
    onAgentTurnActivity: updateAgentPowerState,
  });
  closeLocalApi = api.close;

  const state = readWindowState();
  mainWindow = new BrowserWindow({
    width: state?.width ?? 1440,
    height: state?.height ?? 920,
    x: state?.x,
    y: state?.y,
    minWidth: 1000,
    minHeight: 680,
    title: productName,
    icon: resolveWindowIcon(),
    backgroundColor: "#0b1020",
    show: false,
    webPreferences: {
      preload: resolvePreloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: true,
      devTools: !app.isPackaged,
      backgroundThrottling: false,
      additionalArguments: [
        rendererArgument("api-base-url", api.origin),
        rendererArgument("app-version", app.getVersion()),
      ],
    },
  });

  mainWindow.on("ready-to-show", () => mainWindow?.show());
  mainWindow.on("close", () => saveWindowState(mainWindow));
  mainWindow.on("closed", () => { mainWindow = null; });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void openExternal(url);
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (isTrustedRendererUrl(url)) return;
    event.preventDefault();
    void openExternal(url);
  });

  await mainWindow.loadURL(`${appProtocol}://app/index.html`);
}

function registerRendererProtocol(): void {
  const rendererRoot = resolveRendererDir();
  protocol.handle(appProtocol, async (request) => {
    const url = new URL(request.url);
    if (url.hostname !== "app") return new Response("Not found", { status: 404 });
    const relativePath = decodeURIComponent(url.pathname).replace(/^\/+/, "") || "index.html";
    const candidate = resolve(rendererRoot, relativePath);
    const relativeCandidate = relative(rendererRoot, candidate);
    if (!relativeCandidate || (!relativeCandidate.startsWith("..") && !normalize(relativeCandidate).startsWith(`..${process.platform === "win32" ? "\\" : "/"}`))) {
      if (candidate === rendererRoot) return net.fetch(pathToFileURL(join(rendererRoot, "index.html")).href);
      if (existsSync(candidate)) return net.fetch(pathToFileURL(candidate).href);
    }
    return new Response("Not found", { status: 404 });
  });
}

function registerIpc(): void {
  ipcMain.handle("workspace:api:session-headers", (event) => {
    assertTrustedRenderer(event);
    return { "x-workspace-session": apiSessionToken };
  });
  ipcMain.handle("workspace:workspace:choose-folder", async (event) => {
    assertTrustedRenderer(event);
    const result = mainWindow
      ? await dialog.showOpenDialog(mainWindow, { title: "Choose a folder to turn into a Space", properties: ["openDirectory", "createDirectory"] })
      : await dialog.showOpenDialog({ title: "Choose a folder to turn into a Space", properties: ["openDirectory", "createDirectory"] });
    const rootPath = result.filePaths[0];
    if (result.canceled || !rootPath) return null;
    return { path: rootPath, folderGrantId: createFolderGrant(rootPath) };
  });
  ipcMain.handle("workspace:workspace:reveal-folder", async (event, value: unknown) => {
    assertTrustedRenderer(event);
    if (typeof value !== "string") throw new Error("A Space id is required.");
    const workspace = await getWorkspace(value);
    const error = await shell.openPath(workspace.rootPath);
    if (error) throw new Error(`Workspace could not show this Space's folder. ${error}`);
  });
  ipcMain.handle("workspace:shell:open-external", async (event, value: unknown) => {
    assertTrustedRenderer(event);
    if (typeof value !== "string") throw new Error("A URL is required.");
    await openExternal(value);
  });
  ipcMain.handle("workspace:updates:check", async (event): Promise<WorkspaceUpdateCheckResult> => {
    assertTrustedRenderer(event);
    return checkForUpdates();
  });
}

function configureMenu(): void {
  const viewMenu: MenuItemConstructorOptions[] = [
    { role: "reload" },
    ...(!app.isPackaged ? [{ role: "toggleDevTools" } as MenuItemConstructorOptions] : []),
    { type: "separator" },
    { role: "resetZoom" },
    { role: "zoomIn" },
    { role: "zoomOut" },
    { type: "separator" },
    { role: "togglefullscreen" },
  ];
  const template: MenuItemConstructorOptions[] = [
    {
      label: "File",
      submenu: [
        { label: "Turn Folder into a Space…", accelerator: "CmdOrCtrl+O", click: () => mainWindow?.webContents.send("workspace:menu:open-folder") },
        { type: "separator" },
        process.platform === "darwin" ? { role: "close" } : { role: "quit" },
      ],
    },
    { label: "Edit", submenu: [{ role: "undo" }, { role: "redo" }, { type: "separator" }, { role: "cut" }, { role: "copy" }, { role: "paste" }, { role: "selectAll" }] },
    { label: "View", submenu: viewMenu },
    { label: "Window", submenu: [{ role: "minimize" }, { role: "close" }] },
    {
      label: "Help",
      submenu: [
        { label: "Check for Updates…", click: () => { void checkForUpdates(); } },
        { type: "separator" },
        { label: `Workspace ${app.getVersion()}`, enabled: false },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function configureUpdater(): void {
  if (workspaceUpdater) return;
  workspaceUpdater = new WorkspaceUpdater({
    getWindow: () => mainWindow,
    prepareToInstall: prepareToQuit,
  });
  workspaceUpdater.start();
}

function checkForUpdates(): Promise<WorkspaceUpdateCheckResult> {
  return workspaceUpdater?.check(true) ?? Promise.resolve({ status: "unsupported" });
}

function configureStableUserDataPath(): void {
  const target = join(app.getPath("appData"), productName);
  if (app.getPath("userData") !== target) app.setPath("userData", target);
}

function createFolderGrant(rootPath: string): string {
  const id = randomUUID();
  folderGrants.set(id, { rootPath: resolve(rootPath), expiresAt: Date.now() + folderGrantTtlMs });
  return id;
}

function consumeLocalFolderGrant(input: { rootPath: string; grantId: string }): boolean {
  const grant = folderGrants.get(input.grantId);
  folderGrants.delete(input.grantId);
  return Boolean(grant && grant.expiresAt >= Date.now() && samePath(grant.rootPath, input.rootPath));
}

function updateAgentPowerState(activeTurns: number): void {
  if (activeTurns > 0 && powerBlockerId === null) {
    powerBlockerId = powerSaveBlocker.start("prevent-app-suspension");
  } else if (activeTurns <= 0 && powerBlockerId !== null) {
    if (powerSaveBlocker.isStarted(powerBlockerId)) powerSaveBlocker.stop(powerBlockerId);
    powerBlockerId = null;
  }
}

async function openExternal(value: string): Promise<void> {
  const url = new URL(value);
  if (!new Set(["https:", "http:", "mailto:"]).has(url.protocol)) throw new Error(`Workspace cannot open ${url.protocol} links.`);
  await shell.openExternal(url.toString());
}

async function shutdown(): Promise<void> {
  workspaceUpdater?.dispose();
  updateAgentPowerState(0);
  const close = closeLocalApi;
  closeLocalApi = null;
  await Promise.allSettled([
    close?.() ?? Promise.resolve(),
    piRuntime?.flush() ?? Promise.resolve(),
  ]);
}

function prepareToQuit(): Promise<void> {
  quitting = true;
  shutdownPromise ??= shutdown();
  return shutdownPromise;
}

function showWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function assertTrustedRenderer(event: IpcMainInvokeEvent): void {
  if (!event.senderFrame || !isTrustedRendererUrl(event.senderFrame.url)) throw new Error("Untrusted renderer IPC request.");
}

function isTrustedRendererUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === `${appProtocol}:` && url.hostname === "app";
  } catch {
    return false;
  }
}

function rendererArgument(name: string, value: string): string {
  return `--workspace-${name}=${value}`;
}

function resolveRendererDir(): string {
  return app.isPackaged ? join(process.resourcesPath, "web-local") : join(repoRoot, "dist", "web-local");
}

function resolvePreloadPath(): string {
  return join(dirnameFromFile(currentFile), "preload.cjs");
}

function resolveWindowIcon(): string {
  return app.isPackaged ? join(process.resourcesPath, "assets", "icon.ico") : join(repoRoot, "desktop", "assets", "icon.ico");
}

function dirnameFromFile(value: string): string {
  return resolve(value, "..");
}

interface WindowState { x: number; y: number; width: number; height: number }

function readWindowState(): WindowState | null {
  const path = join(app.getPath("userData"), "window-state.json");
  if (!existsSync(path)) return null;
  try {
    const value = JSON.parse(readFileSync(path, "utf8")) as Partial<WindowState>;
    if (![value.x, value.y, value.width, value.height].every((part) => typeof part === "number" && Number.isFinite(part))) return null;
    const state = value as WindowState;
    return screen.getAllDisplays().some((display) => intersects(state, display.bounds)) ? state : null;
  } catch {
    return null;
  }
}

function saveWindowState(window: BrowserWindow | null): void {
  if (!window || window.isDestroyed()) return;
  try {
    writeFileSync(join(app.getPath("userData"), "window-state.json"), `${JSON.stringify(window.getNormalBounds(), null, 2)}\n`, "utf8");
  } catch {
    // Window placement is a convenience; startup should not fail if it cannot be saved.
  }
}

function intersects(a: WindowState, b: Rectangle): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

function samePath(first: string, second: string): boolean {
  const a = resolve(first);
  const b = resolve(second);
  return process.platform === "win32" ? a.toLocaleLowerCase() === b.toLocaleLowerCase() : a === b;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
