const { contextBridge, ipcRenderer } = require("electron") as typeof import("electron");

function argumentValue(name: string): string {
  const prefix = `--workspace-${name}=`;
  const argument = process.argv.find((value) => value.startsWith(prefix));
  return argument ? argument.slice(prefix.length) : "";
}

const apiBaseUrl = argumentValue("api-base-url");
const appVersion = argumentValue("app-version");

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
  },
  workspace: {
    chooseFolder: () => ipcRenderer.invoke("workspace:workspace:choose-folder"),
    revealFolder: (workspaceId: string) => ipcRenderer.invoke("workspace:workspace:reveal-folder", workspaceId),
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
  shell: {
    openExternal: (url: string) => ipcRenderer.invoke("workspace:shell:open-external", url),
  },
  updates: {
    check: () => ipcRenderer.invoke("workspace:updates:check"),
  },
});
