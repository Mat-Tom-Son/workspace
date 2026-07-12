import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { realpath, stat } from "node:fs/promises";
import { delimiter, isAbsolute, join, normalize, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  Menu,
  net,
  nativeImage,
  nativeTheme,
  Notification,
  powerMonitor,
  powerSaveBlocker,
  protocol,
  screen,
  shell,
  systemPreferences,
  Tray,
  type ContextMenuParams,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
  type MenuItemConstructorOptions,
  type Rectangle,
} from "electron";

import { RoutedPiExtensionUiBridge, type PiExtensionUiEvent } from "../../src/local/agent/extension-ui.js";
import { defaultAgentSdkDir } from "../../src/local/agent/agent-data-dir.js";
import { startLocalApi } from "../../src/local/server.js";
import { configureWorkspaceStateRoot } from "../../src/local/state-paths.js";
import { getWorkspace } from "../../src/local/workspace.js";
import { WorkspaceCliKernelAdapter } from "../../src/local/workspace-cli-adapter.js";
import { WorkspaceKernel } from "../../src/local/workspace-kernel.js";
import {
  WorkspaceDesktopCliHost,
  workspaceCliInstanceData,
  workspaceCliRequestIdFromArgv,
  workspaceCliRequestIdFromInstanceData,
} from "./cli-host.js";
import { PackagedPiRuntimeProvider } from "./pi-runtime.js";
import { SecureSettingsStore } from "./settings.js";
import { WorkspaceUpdater, type WorkspaceUpdateStatus } from "./updater.js";
import { shouldUseWindowsMica } from "./window-material.js";

const productName = "Workspace";
const appProtocol = "workspace-desktop";
const appUserModelId = "io.github.mattomson.workspace";
const desktopAssetRoutePrefix = "/_desktop-assets/";
const desktopTitleBarHeight = 40;
const desktopTitleBarOverlayPalettes = {
  light: { color: "#f3f4f6", symbolColor: "#1b2433" },
  dark: { color: "#20242b", symbolColor: "#f8fafc" },
} as const;
// Electron supports Mica on Windows 11 22H2+ (build 22621). Older builds and
// reduced-transparency sessions use a solid theme-matched window background.
const micaSupported = shouldUseWindowsMica(
  process.platform,
  process.getSystemVersion(),
  nativeTheme.prefersReducedTransparency,
);
const windowBackgroundColors = { light: "#f5f6f8", dark: "#111318" } as const;

function titleBarOverlayFor(theme: "light" | "dark"): Electron.TitleBarOverlay {
  return {
    ...desktopTitleBarOverlayPalettes[theme],
    // With Mica the window-controls corner stays transparent so the material
    // shows through the whole title bar instead of a solid strip.
    ...(micaSupported ? { color: "#00000000" } : {}),
    height: desktopTitleBarHeight,
  };
}
const currentFile = fileURLToPath(import.meta.url);
const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url));
const folderGrantTtlMs = 5 * 60 * 1000;
const shutdownTimeoutMs = 10_000;
const windowStateSaveDelayMs = 500;
const rendererRecoveryMaxAttempts = 6;
const rendererRecoveryBaseDelayMs = 1_000;
const rendererRecoveryMaxDelayMs = 30_000;
const resumeRendererHealthDelayMs = 5_000;
const resumeUpdateCheckDelayMs = 20_000;
const headlessCliIdleGraceMs = 500;
const defaultWindowState = { width: 1440, height: 960 };
const minimumWindowState = { width: 1100, height: 760 };
const folderGrants = new Map<string, { rootPath: string; expiresAt: number }>();

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let closeLocalApi: (() => Promise<void>) | null = null;
let piRuntime: PackagedPiRuntimeProvider | null = null;
let secureSettings: SecureSettingsStore | null = null;
let apiSessionToken = "";
let quitting = false;
let quittingForUpdate = false;
let quitShutdownComplete = false;
let quitFlowPromise: Promise<void> | null = null;
let activeAgentTurns = 0;
let powerBlockerId: number | null = null;
let workspaceUpdater: WorkspaceUpdater | null = null;
let shutdownPromise: Promise<void> | null = null;
let rendererProtocolRegistered = false;
let ipcRegistered = false;
let powerMonitorRegistered = false;
let accentColorMonitorRegistered = false;
let rendererRecoveryTimer: ReturnType<typeof setTimeout> | null = null;
let rendererRecoveryInFlight = false;
let rendererRecoveryAttempts = 0;
let rendererLoadFailed = false;
let rendererRecoveryFailurePromptShown = false;
let createWindowPromise: Promise<void> | null = null;
let rendererMenuState: RendererMenuState = { spaceOpen: false };
let desktopHostPromise: Promise<DesktopHost> | null = null;
let interactiveStartupPromise: Promise<void> | null = null;
let activateRegistered = false;
let interactiveRequested = false;
let cliRequestGeneration = 0;

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

configureStableUserDataPath();
let initialCliRequestId: string | null = null;
let initialCliArgumentError: unknown = null;
try {
  initialCliRequestId = workspaceCliRequestIdFromArgv(process.argv);
} catch (error) {
  initialCliArgumentError = error;
}
interactiveRequested = initialCliRequestId === null && initialCliArgumentError === null;
const ownsInstance = app.requestSingleInstanceLock(workspaceCliInstanceData(initialCliRequestId));
if (!ownsInstance) app.quit();

if (ownsInstance) {
  app.on("second-instance", (_event, argv, _workingDirectory, additionalData) => {
    let requestId: string | null = null;
    try {
      requestId = workspaceCliRequestIdFromInstanceData(additionalData) ?? workspaceCliRequestIdFromArgv(argv);
    } catch (error) {
      console.warn(`${productName} rejected an invalid CLI launch: ${errorMessage(error)}`);
      return;
    }
    if (requestId) {
      void processWorkspaceCliRequest(requestId).catch((error) => {
        console.warn(`${productName} could not process CLI request ${requestId}: ${errorMessage(error)}`);
      });
      return;
    }
    interactiveRequested = true;
    void startInteractiveApp().then(showWindow).catch(reportStartupError);
  });
  app.whenReady().then(async () => {
    configureStableUserDataPath();
    configureWorkspaceStateRoot(app.getPath("userData"));
    configurePackagedCliEnvironment();
    if (initialCliArgumentError) throw initialCliArgumentError;
    if (initialCliRequestId) {
      await processWorkspaceCliRequest(initialCliRequestId);
      if (!interactiveRequested) {
        await quitAfterCliRequest();
        return;
      }
    }
    await startInteractiveApp();
  }).catch(reportStartupError);
}

app.on("window-all-closed", () => {
  if (quittingForUpdate) return;
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", (event) => {
  quitting = true;
  if (quitShutdownComplete) return;
  event.preventDefault();
  if (quitFlowPromise) return;
  quitFlowPromise = finishQuitFlow().finally(() => { quitFlowPromise = null; });
});

async function finishQuitFlow(): Promise<void> {
  destroyTray();
  if (workspaceUpdater?.shouldInstallOnQuit()) {
    await shutdownForUpdateInstall();
    const status = await workspaceUpdater.installDownloadedUpdateOnQuit();
    if (status.phase === "installing") return;
    workspaceUpdater.dispose();
    workspaceUpdater = null;
    app.quit();
    return;
  }
  await shutdown();
  workspaceUpdater?.dispose();
  workspaceUpdater = null;
  quitShutdownComplete = true;
  app.quit();
}

interface DesktopHost {
  settings: SecureSettingsStore;
  extensionUi: RoutedPiExtensionUiBridge;
  runtime: PackagedPiRuntimeProvider;
  kernel: WorkspaceKernel;
  cli: WorkspaceDesktopCliHost;
}

async function ensureDesktopHost(): Promise<DesktopHost> {
  if (desktopHostPromise) return desktopHostPromise;
  desktopHostPromise = (async () => {
    const userData = app.getPath("userData");
    configureWorkspaceStateRoot(userData);
    const settings = new SecureSettingsStore(join(userData, "secure-settings.bin"));
    const extensionUi = new RoutedPiExtensionUiBridge();
    extensionUi.on("event", (event: PiExtensionUiEvent) => {
      if (event.method === "openExternal") void openExternal(event.url);
      else if (event.method === "oauthDeviceCode") void openExternal(event.verificationUri);
      else if (event.method === "copyText") clipboard.writeText(event.text);
      else if (event.method === "openSettings") mainWindow?.webContents.send("workspace:agent:open-settings");
      else if (event.method === "quit") app.quit();
    });
    const runtime = new PackagedPiRuntimeProvider({
      agentDir: defaultAgentSdkDir(),
      authStorageHost: settings,
      extensionUi,
    });
    const kernel = new WorkspaceKernel({ runtimeProvider: runtime });
    const cli = new WorkspaceDesktopCliHost({
      stateRoot: userData,
      kernel: new WorkspaceCliKernelAdapter(kernel),
      version: app.getVersion(),
      productName,
    });
    await cli.initialize();
    secureSettings = settings;
    piRuntime = runtime;
    return { settings, extensionUi, runtime, kernel, cli };
  })();
  return desktopHostPromise;
}

async function processWorkspaceCliRequest(requestId: string): Promise<void> {
  cliRequestGeneration += 1;
  const host = await ensureDesktopHost();
  await host.cli.processRequest(requestId);
}

async function startInteractiveApp(): Promise<void> {
  interactiveRequested = true;
  if (interactiveStartupPromise) return interactiveStartupPromise;
  interactiveStartupPromise = (async () => {
    await ensureDesktopHost();
    loadDesktopPreferences();
    registerRendererProtocol();
    registerIpc();
    await ensureMainWindow();
    configureUpdater();
    createTrayIfSupported();
    if (!activateRegistered) {
      activateRegistered = true;
      app.on("activate", () => {
        if (BrowserWindow.getAllWindows().length === 0) void ensureMainWindow();
        else showWindow();
      });
    }
  })();
  return interactiveStartupPromise;
}

async function quitAfterCliRequest(): Promise<void> {
  const host = await ensureDesktopHost();
  while (!interactiveRequested) {
    const observedGeneration = cliRequestGeneration;
    await host.cli.whenIdle();
    await host.runtime.flush();
    await new Promise<void>((resolveDelay) => setTimeout(resolveDelay, headlessCliIdleGraceMs));
    if (observedGeneration === cliRequestGeneration) break;
  }
  if (interactiveRequested) {
    await startInteractiveApp();
    return;
  }
  quitting = true;
  // Exit synchronously after the queue and host-backed auth storage are both
  // drained so a new process cannot hand work to a half-shutdown primary.
  quitShutdownComplete = true;
  app.quit();
}

function reportStartupError(error: unknown): void {
  console.error(`${productName} could not start: ${errorMessage(error)}`);
  if (interactiveRequested) dialog.showErrorBox(`${productName} could not start`, errorMessage(error));
  quitting = true;
  app.quit();
}

async function createMainWindow(): Promise<void> {
  if (mainWindow && !mainWindow.isDestroyed()) {
    showWindow();
    return;
  }

  const userData = app.getPath("userData");
  const host = await ensureDesktopHost();

  apiSessionToken = randomUUID();
  const api = await startLocalApi({
    appMode: "desktop",
    port: 0,
    workspaceBase: join(userData, "workspaces"),
    stateBase: userData,
    sessionToken: apiSessionToken,
    allowedOrigins: [`${appProtocol}://app`],
    piRuntimeProvider: host.runtime,
    extensionUiBridge: host.extensionUi,
    kernel: host.kernel,
    localFolderGrantProvider: { consumeLocalFolderGrant },
    onAgentTurnActivity: updateAgentPowerState,
  });
  closeLocalApi = api.close;

  const state = visibleWindowState(readWindowState());
  const initialState = state ?? defaultWindowState;
  mainWindow = new BrowserWindow({
    ...initialState,
    minWidth: minimumWindowState.width,
    minHeight: minimumWindowState.height,
    title: productName,
    icon: resolveWindowIcon(),
    autoHideMenuBar: process.platform === "win32",
    ...(process.platform === "win32" ? {
      ...(micaSupported ? { backgroundMaterial: "mica" as const } : {}),
      titleBarStyle: "hidden",
      titleBarOverlay: titleBarOverlayFor(nativeTheme.shouldUseDarkColors ? "dark" : "light"),
    } : {}),
    // A solid background would paint over the Mica material, so only set one
    // where Mica is unavailable.
    ...(micaSupported ? {} : { backgroundColor: windowBackgroundColors[nativeTheme.shouldUseDarkColors ? "dark" : "light"] }),
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
        rendererArgument("window-material", micaSupported ? "mica" : "none"),
      ],
    },
  });

  try {
    mainWindow.webContents.session.setSpellCheckerLanguages(["en-US"]);
  } catch (error) {
    console.warn(`${productName} could not configure spellchecker languages: ${errorMessage(error)}`);
  }
  configureWindowStatePersistence(mainWindow);
  if (state?.isMaximized) mainWindow.maximize();
  mainWindow.on("ready-to-show", () => mainWindow?.show());
  mainWindow.on("close", (event) => {
    if (quitting || quittingForUpdate || quitShutdownComplete) return;
    if (!tray || !desktopPreferences.closeToTray) return;
    event.preventDefault();
    mainWindow?.hide();
    maybeShowTrayNotice();
  });
  mainWindow.on("query-session-end", () => { void shutdown(); });
  mainWindow.on("session-end", () => {
    quitting = true;
    void shutdown();
  });
  mainWindow.on("closed", () => { mainWindow = null; });
  configureWindowNavigation(mainWindow);
  configureContextMenu(mainWindow);
  configureWindowResilience(mainWindow);
  configurePowerMonitor();
  configureAccentColorMonitor();
  configureMenu();

  try {
    await loadMainRenderer(mainWindow);
  } catch (error) {
    console.warn(`${productName} renderer load failed: ${errorMessage(error)}`);
    scheduleRendererRecovery(`initial renderer load failed: ${errorMessage(error)}`);
  }
}

function registerRendererProtocol(): void {
  if (rendererProtocolRegistered) return;
  rendererProtocolRegistered = true;
  const rendererRoot = resolveRendererDir();
  const desktopAssets = resolveDesktopAssetsDir();
  protocol.handle(appProtocol, (request) => {
    const url = new URL(request.url);
    if (url.hostname !== "app") return new Response("Not found", { status: 404 });
    if (request.method !== "GET" && request.method !== "HEAD") return new Response("Method not allowed", { status: 405 });
    const requestedPath = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
    if (requestedPath.startsWith(desktopAssetRoutePrefix)) {
      if (requestedPath !== `${desktopAssetRoutePrefix}icon-32.png`) return new Response("Not found", { status: 404 });
      return fetchProtocolFile(desktopAssets, "icon-32.png", request.method);
    }
    return fetchProtocolFile(rendererRoot, requestedPath.replace(/^\/+/, ""), request.method);
  });
}

function fetchProtocolFile(rootDir: string, requestedPath: string, method: string): Promise<Response> | Response {
  const candidate = resolve(rootDir, requestedPath);
  const relativeCandidate = relative(rootDir, candidate);
  if (/^\.\.(?:[\\/]|$)/.test(relativeCandidate) || isAbsolute(relativeCandidate)) return new Response("Not found", { status: 404 });
  if (!existsSync(candidate)) return new Response("Not found", { status: 404 });
  if (method === "HEAD") return new Response(null, { status: 200 });
  return net.fetch(pathToFileURL(candidate).href);
}

function registerIpc(): void {
  if (ipcRegistered) return;
  ipcRegistered = true;
  ipcMain.handle("workspace:api:session-headers", (event) => {
    assertTrustedRenderer(event);
    return { "x-workspace-session": apiSessionToken };
  });
  ipcMain.handle("workspace:runtime:health", async (event) => {
    assertTrustedRenderer(event);
    return {
      pi: piRuntime ? await piRuntime.health() : { ok: false, configured: false, version: "", message: "Pi is still starting." },
      settings: secureSettings ? await secureSettings.status() : { encryptionAvailable: false, configuredProviders: [] },
    };
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
  ipcMain.handle("workspace:workspace:open-path", async (event, value: unknown) => {
    assertTrustedRenderer(event);
    const request = workspacePathRequest(value);
    const filePath = await resolveWorkspaceItem(request.workspaceId, request.path);
    if (request.action === "reveal") {
      shell.showItemInFolder(filePath);
      return;
    }
    const result = await shell.openPath(filePath);
    if (result) throw new Error(`${productName} could not open this item. ${result}`);
  });
  ipcMain.handle("workspace:workspace:start-drag", async (event, value: unknown) => {
    assertTrustedRenderer(event);
    const request = workspacePathRequest(value, false);
    const filePath = await resolveWorkspaceItem(request.workspaceId, request.path);
    const info = await stat(filePath);
    if (!info.isFile()) throw new Error("Only files can be dragged out of a Space.");
    const icon = nativeImage.createFromPath(join(resolveDesktopAssetsDir(), "icon-32.png"));
    if (icon.isEmpty()) return false;
    event.sender.startDrag({ file: filePath, icon });
    return true;
  });
  ipcMain.handle("workspace:shell:open-external", async (event, value: unknown) => {
    assertTrustedRenderer(event);
    if (typeof value !== "string") throw new Error("A URL is required.");
    await openExternal(value);
  });
  ipcMain.handle("workspace:window:accent-color", (event) => {
    assertTrustedRenderer(event);
    return getWindowsAccentColor();
  });
  ipcMain.handle("workspace:window:get-close-to-tray", (event) => {
    assertTrustedRenderer(event);
    return closeToTrayStatus();
  });
  ipcMain.handle("workspace:window:set-close-to-tray", (event, value: unknown) => {
    assertTrustedRenderer(event);
    if (typeof value !== "boolean") throw new Error("Close-to-background preference must be a boolean.");
    updateDesktopPreferences({ closeToTray: value });
    return closeToTrayStatus();
  });
  ipcMain.on("workspace:window:set-theme", (event, value: unknown, source: unknown) => {
    assertTrustedRenderer(event);
    if (value !== "light" && value !== "dark") return;
    // Keep the OS-drawn chrome (Mica backdrop, frame, menus) on the app theme.
    // "system" preserves prefers-color-scheme change events in the renderer.
    nativeTheme.themeSource = source === "light" || source === "dark" || source === "system" ? source : value;
    if (process.platform !== "win32" || !mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.setTitleBarOverlay(titleBarOverlayFor(value));
    if (!micaSupported) mainWindow.setBackgroundColor(windowBackgroundColors[value]);
  });
  ipcMain.on("workspace:menu:set-state", (event, value: unknown) => {
    assertTrustedRenderer(event);
    updateApplicationMenuState(value);
  });
  ipcMain.handle("workspace:menu:popup", (event, menuId: unknown, bounds: unknown) => {
    assertTrustedRenderer(event);
    popupApplicationSubmenu(menuId, bounds);
  });
  ipcMain.handle("workspace:settings:status", (event) => {
    assertTrustedRenderer(event);
    return secureSettings?.status() ?? { encryptionAvailable: false, configuredProviders: [] };
  });
  ipcMain.handle("workspace:updates:status", (event): WorkspaceUpdateStatus => {
    assertTrustedRenderer(event);
    return getUpdateStatus();
  });
  ipcMain.handle("workspace:updates:check", async (event): Promise<WorkspaceUpdateStatus> => {
    assertTrustedRenderer(event);
    return checkForUpdates();
  });
  ipcMain.handle("workspace:updates:install", async (event): Promise<WorkspaceUpdateStatus> => {
    assertTrustedRenderer(event);
    return workspaceUpdater?.install() ?? getUpdateStatus();
  });
  ipcMain.handle("workspace:updates:update-now", async (event): Promise<WorkspaceUpdateStatus> => {
    assertTrustedRenderer(event);
    return workspaceUpdater?.updateNow() ?? getUpdateStatus();
  });
}

type RendererMenuCommand =
  | "new-space"
  | "open-local-folder"
  | "new-chat"
  | "reload-workspace-state"
  | "check-for-updates"
  | "open-settings"
  | "open-about"
  | "open-capabilities"
  | "open-skills"
  | "open-extensions"
  | "open-command-palette"
  | "open-keyboard-shortcuts";

type ApplicationMenuId = "file" | "edit" | "view" | "help";

interface RendererMenuState {
  spaceOpen: boolean;
}

function configureMenu(): void {
  Menu.setApplicationMenu(Menu.buildFromTemplate(buildApplicationMenuTemplate()));
  if (process.platform === "win32" && mainWindow) {
    mainWindow.setAutoHideMenuBar(false);
    mainWindow.setMenuBarVisibility(false);
  }
  updateApplicationMenuState(rendererMenuState);
}

function buildApplicationMenuTemplate(): MenuItemConstructorOptions[] {
  return [
    { id: "file", label: "File", submenu: buildApplicationSubmenuTemplate("file") },
    { id: "edit", label: "Edit", submenu: buildApplicationSubmenuTemplate("edit") },
    { id: "view", label: "View", submenu: buildApplicationSubmenuTemplate("view") },
    { id: "help", label: "Help", submenu: buildApplicationSubmenuTemplate("help") },
  ];
}

function buildApplicationSubmenuTemplate(menuId: ApplicationMenuId): MenuItemConstructorOptions[] {
  if (menuId === "file") {
    return [
      { label: "New Space", accelerator: "CommandOrControl+N", click: () => sendRendererMenuCommand("new-space") },
      { label: "Turn Folder into a Space...", accelerator: "CommandOrControl+O", click: () => sendRendererMenuCommand("open-local-folder") },
      { id: "new-chat", label: "New Chat", accelerator: "CommandOrControl+Shift+N", enabled: rendererMenuState.spaceOpen, click: () => sendRendererMenuCommand("new-chat") },
      { id: "refresh-space", label: "Refresh Space", accelerator: "CommandOrControl+R", enabled: rendererMenuState.spaceOpen, click: () => sendRendererMenuCommand("reload-workspace-state") },
      { type: "separator" },
      { label: "Check for Updates...", click: () => sendRendererMenuCommand("check-for-updates") },
      { label: "Settings...", accelerator: "CommandOrControl+,", click: () => sendRendererMenuCommand("open-settings") },
      { type: "separator" },
      process.platform === "darwin" ? { role: "close" } : { role: "quit" },
    ];
  }
  if (menuId === "edit") {
    return [
      { role: "undo" },
      { role: "redo" },
      { type: "separator" },
      { role: "cut" },
      { role: "copy" },
      { role: "paste" },
      { role: "delete" },
      { type: "separator" },
      { role: "selectAll" },
    ];
  }
  if (menuId === "view") {
    return [
      { label: "Command Palette...", accelerator: "CommandOrControl+K", click: () => sendRendererMenuCommand("open-command-palette") },
      { type: "separator" },
      { role: "resetZoom" },
      { role: "zoomIn" },
      { role: "zoomOut" },
      ...(!app.isPackaged ? [{ type: "separator" }, { role: "toggleDevTools" }] as MenuItemConstructorOptions[] : []),
      { type: "separator" },
      { role: "togglefullscreen" },
    ];
  }
  return [
    { id: "open-capabilities", label: "Capabilities", accelerator: "CommandOrControl+Shift+S", enabled: rendererMenuState.spaceOpen, click: () => sendRendererMenuCommand("open-capabilities") },
    { label: "Keyboard Shortcuts", accelerator: "CommandOrControl+/", click: () => sendRendererMenuCommand("open-keyboard-shortcuts") },
    { type: "separator" },
    { label: "Check for Updates...", click: () => sendRendererMenuCommand("check-for-updates") },
    { type: "separator" },
    { label: `About ${productName} ${app.getVersion()}`, click: () => sendRendererMenuCommand("open-about") },
  ];
}

function popupApplicationSubmenu(menuId: unknown, bounds: unknown): void {
  if (!mainWindow || mainWindow.isDestroyed() || !isApplicationMenuId(menuId)) return;
  const point = menuPopupPoint(bounds);
  Menu.buildFromTemplate(buildApplicationSubmenuTemplate(menuId)).popup({ window: mainWindow, x: point.x, y: point.y });
}

function isApplicationMenuId(value: unknown): value is ApplicationMenuId {
  return value === "file" || value === "edit" || value === "view" || value === "help";
}

function menuPopupPoint(value: unknown): { x: number; y: number } {
  const rawX = isRecord(value) ? Number(value.x) : Number.NaN;
  const rawY = isRecord(value) ? Number(value.y) : Number.NaN;
  return {
    x: Number.isFinite(rawX) ? Math.max(0, Math.round(rawX)) : 0,
    y: Number.isFinite(rawY) ? Math.max(0, Math.round(rawY)) : desktopTitleBarHeight,
  };
}

function sendRendererMenuCommand(command: RendererMenuCommand): void {
  const window = mainWindow;
  if (!window || window.isDestroyed() || window.webContents.isDestroyed()) return;
  showWindow();
  window.webContents.send("workspace:menu-command", command);
}

function updateApplicationMenuState(value: unknown): void {
  rendererMenuState = {
    spaceOpen: isRecord(value)
      ? value.spaceOpen === true || value.workspaceOpen === true
      : rendererMenuState.spaceOpen,
  };
  const menu = Menu.getApplicationMenu();
  setMenuItemEnabled(menu, "new-chat", rendererMenuState.spaceOpen);
  setMenuItemEnabled(menu, "refresh-space", rendererMenuState.spaceOpen);
  setMenuItemEnabled(menu, "open-capabilities", rendererMenuState.spaceOpen);
}

function setMenuItemEnabled(menu: Menu | null, id: string, enabled: boolean): void {
  const item = menu?.getMenuItemById(id);
  if (item) item.enabled = enabled;
}

function configureUpdater(): void {
  if (workspaceUpdater) return;
  workspaceUpdater = new WorkspaceUpdater({
    getWindow: () => mainWindow,
    prepareToInstall: shutdownForUpdateInstall,
  });
  workspaceUpdater.start();
}

function getUpdateStatus(): WorkspaceUpdateStatus {
  return workspaceUpdater?.getStatus() ?? {
    supported: false,
    phase: "unsupported",
    currentVersion: app.getVersion(),
    availableVersion: null,
    progressPercent: null,
    checkedAt: null,
    message: "Updates are available after Workspace is installed on Windows.",
    error: null,
  };
}

function checkForUpdates(interactive = true): Promise<WorkspaceUpdateStatus> {
  return workspaceUpdater?.check(interactive) ?? Promise.resolve(getUpdateStatus());
}

function configureStableUserDataPath(): void {
  const target = join(app.getPath("appData"), productName);
  if (app.getPath("userData") !== target) app.setPath("userData", target);
}

function configurePackagedCliEnvironment(): void {
  if (!app.isPackaged || process.platform !== "win32") return;
  const binDirectory = join(dirnameFromFile(process.execPath), "bin");
  const pathKey = Object.keys(process.env).find((key) => key.toLocaleLowerCase() === "path") ?? "Path";
  const currentPath = process.env[pathKey] ?? "";
  const alreadyPresent = currentPath
    .split(delimiter)
    .map((entry) => entry.trim().replace(/^"|"$/g, ""))
    .filter(Boolean)
    .some((entry) => samePath(entry, binDirectory));
  if (!alreadyPresent) process.env[pathKey] = currentPath ? `${binDirectory}${delimiter}${currentPath}` : binDirectory;
  // Agent shell tools inherit this process environment. Pinning the executable
  // makes their CLI calls address this exact installed Workspace build.
  process.env.WORKSPACE_CLI_APP = process.execPath;
}

function createFolderGrant(rootPath: string): string {
  cleanupFolderGrants();
  const id = randomUUID();
  folderGrants.set(id, { rootPath: resolve(rootPath), expiresAt: Date.now() + folderGrantTtlMs });
  return id;
}

function consumeLocalFolderGrant(input: { rootPath: string; grantId: string }): boolean {
  cleanupFolderGrants();
  const grant = folderGrants.get(input.grantId);
  folderGrants.delete(input.grantId);
  return Boolean(grant && grant.expiresAt >= Date.now() && samePath(grant.rootPath, input.rootPath));
}

function cleanupFolderGrants(): void {
  const now = Date.now();
  for (const [id, grant] of folderGrants) {
    if (grant.expiresAt <= now) folderGrants.delete(id);
  }
}

type WorkspacePathAction = "open" | "open-native" | "reveal";

function workspacePathRequest(value: unknown, requireAction = true): { workspaceId: string; path: string; action: WorkspacePathAction } {
  if (!isRecord(value)) throw new Error("A Space file request is required.");
  const workspaceId = typeof value.workspaceId === "string" ? value.workspaceId.trim() : "";
  const path = typeof value.path === "string" ? value.path : "";
  const action = value.action === "reveal" || value.action === "open-native" || value.action === "open"
    ? value.action
    : "open";
  if (!workspaceId) throw new Error("A Space id is required.");
  if (!path || path.includes("\0") || isAbsolute(path)) throw new Error("A relative Space file path is required.");
  if (requireAction && value.action !== undefined && value.action !== "reveal" && value.action !== "open-native" && value.action !== "open") {
    throw new Error("Unsupported Space file action.");
  }
  return { workspaceId, path, action };
}

async function resolveWorkspaceItem(workspaceId: string, itemPath: string): Promise<string> {
  const workspace = await getWorkspace(workspaceId);
  const rootPath = await realpath(workspace.rootPath);
  const candidate = resolve(rootPath, itemPath);
  assertPathInsideRoot(rootPath, candidate);
  const resolvedCandidate = await realpath(candidate);
  assertPathInsideRoot(rootPath, resolvedCandidate);
  return resolvedCandidate;
}

function assertPathInsideRoot(rootPath: string, candidate: string): void {
  const child = relative(rootPath, candidate);
  if (!child || /^\.\.(?:[\\/]|$)/.test(child) || isAbsolute(child)) throw new Error("The requested item is outside this Space.");
}

function updateAgentPowerState(activeTurns: number): void {
  activeAgentTurns = Math.max(0, activeTurns);
  updateTrayTooltip();
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
  if (shutdownPromise) return shutdownPromise;
  if (rendererRecoveryTimer) clearTimeout(rendererRecoveryTimer);
  rendererRecoveryTimer = null;
  updateAgentPowerState(0);
  const close = closeLocalApi;
  closeLocalApi = null;
  const runtime = piRuntime;
  piRuntime = null;
  shutdownPromise = (async () => {
    const outcomes = await Promise.allSettled([
      withShutdownTimeout(close?.() ?? Promise.resolve(), "local API"),
      withShutdownTimeout(runtime?.flush() ?? Promise.resolve(), "Pi state"),
    ]);
    for (const outcome of outcomes) {
      if (outcome.status === "rejected") console.warn(`${productName} shutdown cleanup failed: ${errorMessage(outcome.reason)}`);
    }
  })();
  return shutdownPromise;
}

async function shutdownForUpdateInstall(): Promise<void> {
  quittingForUpdate = true;
  quitting = true;
  destroyTray();
  await shutdown();
  quitShutdownComplete = true;
}

async function withShutdownTimeout<T>(promise: Promise<T>, label: string): Promise<T | void> {
  let timeout: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<void>((resolveTimeout) => {
        timeout = setTimeout(() => {
          console.warn(`${productName} shutdown timed out waiting for ${label}; continuing.`);
          resolveTimeout();
        }, shutdownTimeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function showWindow(): void {
  const window = mainWindow;
  if (!window || window.isDestroyed()) {
    if (app.isReady()) void ensureMainWindow();
    return;
  }
  if (window.isMinimized()) window.restore();
  if (!window.isVisible()) window.show();
  window.focus();
}

function ensureMainWindow(): Promise<void> {
  if (mainWindow && !mainWindow.isDestroyed()) return Promise.resolve();
  createWindowPromise ??= createMainWindow().finally(() => { createWindowPromise = null; });
  return createWindowPromise;
}

interface DesktopPreferences {
  closeToTray: boolean;
  trayNoticeShown: boolean;
}

let desktopPreferences: DesktopPreferences = { closeToTray: true, trayNoticeShown: false };

function desktopPreferencesPath(): string {
  return join(app.getPath("userData"), "desktop-preferences.json");
}

function loadDesktopPreferences(): void {
  if (!existsSync(desktopPreferencesPath())) return;
  try {
    const parsed = JSON.parse(readFileSync(desktopPreferencesPath(), "utf8"));
    if (!isRecord(parsed)) return;
    desktopPreferences = {
      closeToTray: typeof parsed.closeToTray === "boolean" ? parsed.closeToTray : true,
      trayNoticeShown: parsed.trayNoticeShown === true,
    };
  } catch (error) {
    console.warn(`${productName} could not read desktop preferences: ${errorMessage(error)}`);
  }
}

function updateDesktopPreferences(update: Partial<DesktopPreferences>): void {
  desktopPreferences = { ...desktopPreferences, ...update };
  try {
    writeFileSync(desktopPreferencesPath(), `${JSON.stringify(desktopPreferences, null, 2)}\n`, "utf8");
  } catch (error) {
    console.warn(`${productName} could not save desktop preferences: ${errorMessage(error)}`);
  }
}

function createTrayIfSupported(): void {
  if (tray || process.platform !== "win32") return;
  const iconPath = resolveWindowIcon();
  if (!existsSync(iconPath)) {
    console.warn(`${productName} tray icon was not found; close-to-background is unavailable.`);
    return;
  }
  tray = new Tray(iconPath);
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: `Open ${productName}`, click: showWindow },
    { type: "separator" },
    { label: "Check for Updates...", click: () => sendRendererMenuCommand("check-for-updates") },
    { type: "separator" },
    { label: `Quit ${productName}`, click: () => app.quit() },
  ]));
  tray.on("click", showWindow);
  tray.on("double-click", showWindow);
  updateTrayTooltip();
}

function destroyTray(): void {
  tray?.destroy();
  tray = null;
}

function updateTrayTooltip(): void {
  if (!tray) return;
  tray.setToolTip(activeAgentTurns > 0
    ? `${productName} — Assistant is working on ${activeAgentTurns === 1 ? "a task" : `${activeAgentTurns} tasks`}`
    : productName);
}

function maybeShowTrayNotice(): void {
  if (desktopPreferences.trayNoticeShown) return;
  updateDesktopPreferences({ trayNoticeShown: true });
  if (!Notification.isSupported()) return;
  new Notification({
    title: `${productName} is still running`,
    body: "Your Assistant can keep working in the background. Use the tray icon to reopen or quit Workspace, or change this in Settings.",
  }).show();
}

function closeToTrayStatus(): { supported: boolean; enabled: boolean } {
  return { supported: tray !== null, enabled: desktopPreferences.closeToTray };
}

function configurePowerMonitor(): void {
  if (powerMonitorRegistered) return;
  powerMonitorRegistered = true;
  powerMonitor.on("resume", () => {
    setTimeout(ensureRendererAfterResume, resumeRendererHealthDelayMs);
    setTimeout(() => { void checkForUpdates(false); }, resumeUpdateCheckDelayMs);
  });
  powerMonitor.on("shutdown", () => { void shutdown(); });
}

function configureAccentColorMonitor(): void {
  if (accentColorMonitorRegistered || process.platform !== "win32") return;
  accentColorMonitorRegistered = true;
  systemPreferences.on("accent-color-changed", () => {
    mainWindow?.webContents.send("workspace:window:accent-color-changed", getWindowsAccentColor());
  });
}

function getWindowsAccentColor(): string | null {
  if (process.platform !== "win32") return null;
  try {
    const raw = systemPreferences.getAccentColor().replace(/^#/, "");
    return /^[0-9a-fA-F]{8}$/.test(raw) ? `#${raw.slice(0, 6)}` : null;
  } catch {
    return null;
  }
}

function configureWindowResilience(window: BrowserWindow): void {
  window.webContents.on("did-fail-load", (_event, code, description, url, isMainFrame) => {
    if (!isMainFrame || !isTrustedRendererUrl(url)) return;
    rendererLoadFailed = true;
    scheduleRendererRecovery(description || `load failed with error ${code}`);
  });
  window.webContents.on("did-finish-load", () => {
    rendererLoadFailed = false;
    rendererRecoveryAttempts = 0;
  });
  window.webContents.on("render-process-gone", (_event, details) => {
    if (!window.isDestroyed()) scheduleRendererRecovery(`renderer process ended: ${details.reason}`);
  });
}

function ensureRendererAfterResume(): void {
  const window = mainWindow;
  if (!window || window.isDestroyed() || window.webContents.isDestroyed() || window.webContents.isLoadingMainFrame()) return;
  const currentUrl = window.webContents.getURL();
  if (!isTrustedRendererUrl(currentUrl)) scheduleRendererRecovery(`renderer was not on the app URL after resume: ${currentUrl || "blank"}`, 0);
}

function loadMainRenderer(window: BrowserWindow): Promise<void> {
  return window.loadURL(`${appProtocol}://app/index.html`);
}

function scheduleRendererRecovery(reason: string, delayMs?: number): void {
  if (quitting || quittingForUpdate || quitShutdownComplete) return;
  const window = mainWindow;
  if (!window || window.isDestroyed() || window.webContents.isDestroyed() || rendererRecoveryTimer || rendererRecoveryInFlight) return;
  if (rendererRecoveryAttempts >= rendererRecoveryMaxAttempts) {
    void showRendererRecoveryFailedDialog(reason);
    return;
  }
  const delay = delayMs ?? Math.min(rendererRecoveryMaxDelayMs, rendererRecoveryBaseDelayMs * (2 ** rendererRecoveryAttempts));
  rendererRecoveryTimer = setTimeout(() => {
    rendererRecoveryTimer = null;
    void recoverRenderer(reason);
  }, delay);
}

async function recoverRenderer(reason: string): Promise<void> {
  const window = mainWindow;
  if (!window || window.isDestroyed() || window.webContents.isDestroyed()) return;
  rendererRecoveryInFlight = true;
  rendererRecoveryAttempts += 1;
  let retryReason: string | null = null;
  try {
    console.warn(`${productName} reloading its window after a recoverable issue: ${reason}`);
    await loadMainRenderer(window);
  } catch (error) {
    retryReason = errorMessage(error);
  } finally {
    rendererRecoveryInFlight = false;
  }
  if (retryReason) scheduleRendererRecovery(retryReason);
  else {
    rendererLoadFailed = false;
    rendererRecoveryAttempts = 0;
    rendererRecoveryFailurePromptShown = false;
    window.webContents.send("workspace:runtime:renderer-recovered");
  }
}

async function showRendererRecoveryFailedDialog(reason: string): Promise<void> {
  if (rendererRecoveryFailurePromptShown) return;
  rendererRecoveryFailurePromptShown = true;
  const options = {
    type: "error" as const,
    message: `${productName} could not recover this window.`,
    detail: `The window failed to reload after ${rendererRecoveryAttempts} attempts. Restart to try again. (${reason})`,
    buttons: [`Restart ${productName}`, "Close"],
    defaultId: 0,
    cancelId: 1,
    noLink: true,
  };
  const result = mainWindow && !mainWindow.isDestroyed()
    ? await dialog.showMessageBox(mainWindow, options)
    : await dialog.showMessageBox(options);
  if (result.response === 0) {
    app.relaunch();
    app.exit(0);
  } else {
    app.quit();
  }
}

function configureWindowNavigation(window: BrowserWindow): void {
  window.webContents.setWindowOpenHandler(({ url }) => {
    void openExternal(url).catch((error) => console.warn(`${productName} blocked external navigation: ${errorMessage(error)}`));
    return { action: "deny" };
  });
  window.webContents.on("will-navigate", (event, url) => {
    if (isTrustedRendererUrl(url)) return;
    event.preventDefault();
    void openExternal(url).catch((error) => console.warn(`${productName} blocked external navigation: ${errorMessage(error)}`));
  });
}

function configureContextMenu(window: BrowserWindow): void {
  window.webContents.on("context-menu", (_event, params) => {
    const template = buildContextMenuTemplate(window, params);
    if (template) Menu.buildFromTemplate(template).popup({ window });
  });
}

function buildContextMenuTemplate(window: BrowserWindow, params: ContextMenuParams): MenuItemConstructorOptions[] | null {
  if (params.isEditable) return buildEditableContextMenuTemplate(window, params);
  if (params.selectionText.length > 0 || params.linkURL.length > 0) return buildSelectionContextMenuTemplate(params);
  return null;
}

function buildEditableContextMenuTemplate(window: BrowserWindow, params: ContextMenuParams): MenuItemConstructorOptions[] {
  const template: MenuItemConstructorOptions[] = [];
  if (params.misspelledWord.length > 0) {
    const suggestions = params.dictionarySuggestions.slice(0, 5);
    template.push(...(suggestions.length ? suggestions.map((suggestion) => ({
      label: suggestion,
      click: () => window.webContents.replaceMisspelling(suggestion),
    })) : [{ label: "No suggestions", enabled: false }]));
    template.push({ label: "Add to Dictionary", click: () => window.webContents.session.addWordToSpellCheckerDictionary(params.misspelledWord) }, { type: "separator" });
  }
  template.push(
    { role: "undo", enabled: params.editFlags.canUndo },
    { role: "redo", enabled: params.editFlags.canRedo },
    { type: "separator" },
    { role: "cut", enabled: params.editFlags.canCut },
    { role: "copy", enabled: params.editFlags.canCopy },
    { role: "paste", enabled: params.editFlags.canPaste },
    { role: "selectAll" },
  );
  return template;
}

function buildSelectionContextMenuTemplate(params: ContextMenuParams): MenuItemConstructorOptions[] {
  const template: MenuItemConstructorOptions[] = [];
  if (params.selectionText.length > 0) template.push({ role: "copy", enabled: params.editFlags.canCopy });
  if (params.linkURL.length > 0) template.push({ label: "Copy Link Address", click: () => clipboard.writeText(params.linkURL) });
  return template;
}

function assertTrustedRenderer(event: IpcMainInvokeEvent | IpcMainEvent): void {
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
  return `--workspace-${name}=${encodeURIComponent(value)}`;
}

function resolveRendererDir(): string {
  const directory = app.isPackaged ? join(process.resourcesPath, "web-local") : join(repoRoot, "dist", "web-local");
  if (!existsSync(join(directory, "index.html"))) throw new Error(`${productName} renderer build was not found at ${directory}. Run npm run local:build.`);
  return directory;
}

function resolvePreloadPath(): string {
  return join(dirnameFromFile(currentFile), "preload.cjs");
}

function resolveWindowIcon(): string {
  return app.isPackaged ? join(process.resourcesPath, "assets", "icon.ico") : join(repoRoot, "desktop", "assets", "icon.ico");
}

function resolveDesktopAssetsDir(): string {
  return app.isPackaged ? join(process.resourcesPath, "assets") : join(repoRoot, "desktop", "assets");
}

function dirnameFromFile(value: string): string {
  return resolve(value, "..");
}

interface WindowState { x: number; y: number; width: number; height: number; isMaximized: boolean }

function configureWindowStatePersistence(window: BrowserWindow): void {
  let saveTimer: ReturnType<typeof setTimeout> | null = null;
  const scheduleSave = () => {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveTimer = null;
      saveWindowState(window);
    }, windowStateSaveDelayMs);
  };
  window.on("resize", scheduleSave);
  window.on("move", scheduleSave);
  window.on("close", () => {
    if (saveTimer) clearTimeout(saveTimer);
    saveWindowState(window);
  });
}

function readWindowState(): WindowState | null {
  const path = join(app.getPath("userData"), "window-state.json");
  if (!existsSync(path)) return null;
  try {
    const value = JSON.parse(readFileSync(path, "utf8")) as Partial<WindowState>;
    if (![value.x, value.y, value.width, value.height].every((part) => typeof part === "number" && Number.isFinite(part))) return null;
    return {
      x: Math.round(value.x as number),
      y: Math.round(value.y as number),
      width: Math.max(minimumWindowState.width, Math.round(value.width as number)),
      height: Math.max(minimumWindowState.height, Math.round(value.height as number)),
      isMaximized: value.isMaximized === true,
    };
  } catch {
    return null;
  }
}

function visibleWindowState(state: WindowState | null): WindowState | null {
  if (!state || !screen.getAllDisplays().some((display) => intersects(state, display.bounds))) return null;
  const largestWorkArea = screen.getAllDisplays().reduce(
    (best, display) => display.workArea.width * display.workArea.height > best.width * best.height ? display.workArea : best,
    { x: 0, y: 0, width: minimumWindowState.width, height: minimumWindowState.height },
  );
  return {
    ...state,
    width: Math.min(state.width, largestWorkArea.width),
    height: Math.min(state.height, largestWorkArea.height),
  };
}

function saveWindowState(window: BrowserWindow): void {
  if (window.isDestroyed()) return;
  try {
    const bounds = window.isMaximized() ? window.getNormalBounds() : window.getBounds();
    const state: WindowState = { ...bounds, isMaximized: window.isMaximized() };
    writeFileSync(join(app.getPath("userData"), "window-state.json"), `${JSON.stringify(state, null, 2)}\n`, "utf8");
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
