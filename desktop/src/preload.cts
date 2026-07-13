const { contextBridge, ipcRenderer } = require("electron") as typeof import("electron");

function argumentValue(name: string): string {
  const prefix = `--workspace-${name}=`;
  const argument = process.argv.find((value) => value.startsWith(prefix));
  if (!argument) return "";
  try {
    return decodeURIComponent(argument.slice(prefix.length));
  } catch {
    return "";
  }
}

const apiBaseUrl = argumentValue("api-base-url");
const appVersion = argumentValue("app-version");
const windowMaterial = argumentValue("window-material") === "mica" ? "mica" : "none";

contextBridge.exposeInMainWorld("workspaceDesktop", {
  desktop: true,
  api: {
    baseUrl: apiBaseUrl,
    getSessionHeaders: () => ipcRenderer.invoke("workspace:api:session-headers"),
  },
  app: {
    name: "Workspace",
    version: appVersion,
    platform: process.platform,
    iconUrl: "workspace-desktop://app/_desktop-assets/icon-32.png",
  },
  runtime: {
    getHealth: () => ipcRenderer.invoke("workspace:runtime:health"),
    onRendererRecovered: (callback: () => void) => {
      const listener = () => callback();
      ipcRenderer.on("workspace:runtime:renderer-recovered", listener);
      return () => ipcRenderer.removeListener("workspace:runtime:renderer-recovered", listener);
    },
  },
  workspace: {
    chooseFolder: () => ipcRenderer.invoke("workspace:workspace:choose-folder"),
    revealFolder: (workspaceId: string) => ipcRenderer.invoke("workspace:workspace:reveal-folder", workspaceId),
    openPath: (workspaceId: string, path: string, action: "open" | "open-native" | "reveal" = "open") => (
      ipcRenderer.invoke("workspace:workspace:open-path", { workspaceId, path, action })
    ),
    startDrag: (workspaceId: string, path: string) => ipcRenderer.invoke("workspace:workspace:start-drag", { workspaceId, path }),
    onOpenFolder: (callback: () => void) => {
      const listener = () => callback();
      ipcRenderer.on("workspace:menu:open-folder", listener);
      return () => ipcRenderer.removeListener("workspace:menu:open-folder", listener);
    },
  },
  agent: {
    onOpenSettings: (callback: () => void) => {
      const listener = () => callback();
      ipcRenderer.on("workspace:agent:open-settings", listener);
      return () => ipcRenderer.removeListener("workspace:agent:open-settings", listener);
    },
  },
  restrictedApps: {
    mountView: (request: unknown) => ipcRenderer.invoke("workspace:restricted-app-view:mount", request),
    layoutView: (request: unknown) => ipcRenderer.send("workspace:restricted-app-view:layout", request),
    unmountView: (mountId: string) => ipcRenderer.invoke("workspace:restricted-app-view:unmount", mountId),
    onTabCommand: (callback: (command: unknown) => void) => {
      const listener = (_event: unknown, command: unknown) => callback(command);
      ipcRenderer.on("workspace:restricted-app-view:tab-command", listener);
      return () => ipcRenderer.removeListener("workspace:restricted-app-view:tab-command", listener);
    },
    onViewState: (callback: (state: unknown) => void) => {
      const listener = (_event: unknown, state: unknown) => callback(state);
      ipcRenderer.on("workspace:restricted-app-view:state", listener);
      return () => ipcRenderer.removeListener("workspace:restricted-app-view:state", listener);
    },
    onOpenRequest: (callback: (owner: unknown) => void) => {
      const listener = (_event: unknown, owner: unknown) => callback(owner);
      ipcRenderer.on("workspace:restricted-app-view:open-request", listener);
      return () => ipcRenderer.removeListener("workspace:restricted-app-view:open-request", listener);
    },
  },
  window: {
    material: windowMaterial,
    setTheme: (theme: "light" | "dark", source?: "light" | "dark" | "system") => ipcRenderer.send("workspace:window:set-theme", theme, source),
    getAccentColor: () => ipcRenderer.invoke("workspace:window:accent-color"),
    getCloseToTray: () => ipcRenderer.invoke("workspace:window:get-close-to-tray"),
    setCloseToTray: (enabled: boolean) => ipcRenderer.invoke("workspace:window:set-close-to-tray", enabled),
    onAccentColorChanged: (callback: (accent: string | null) => void) => {
      const listener = (_event: unknown, accent: string | null) => callback(accent);
      ipcRenderer.on("workspace:window:accent-color-changed", listener);
      return () => ipcRenderer.removeListener("workspace:window:accent-color-changed", listener);
    },
  },
  shell: {
    openExternal: (url: string) => ipcRenderer.invoke("workspace:shell:open-external", url),
  },
  updates: {
    getStatus: () => ipcRenderer.invoke("workspace:updates:status"),
    check: () => ipcRenderer.invoke("workspace:updates:check"),
    install: () => ipcRenderer.invoke("workspace:updates:install"),
    updateNow: () => ipcRenderer.invoke("workspace:updates:update-now"),
    onStatusChanged: (callback: (status: unknown) => void) => {
      const listener = (_event: unknown, status: unknown) => callback(status);
      ipcRenderer.on("workspace:updates:status-changed", listener);
      return () => ipcRenderer.removeListener("workspace:updates:status-changed", listener);
    },
  },
  settings: {
    getStatus: () => ipcRenderer.invoke("workspace:settings:status"),
  },
  menu: {
    setState: (state: unknown) => ipcRenderer.send("workspace:menu:set-state", state),
    popup: (menuId: unknown, bounds: unknown) => ipcRenderer.invoke("workspace:menu:popup", menuId, bounds),
    onCommand: (callback: (command: unknown) => void) => {
      const listener = (_event: unknown, command: unknown) => callback(command);
      ipcRenderer.on("workspace:menu-command", listener);
      return () => ipcRenderer.removeListener("workspace:menu-command", listener);
    },
  },
});
