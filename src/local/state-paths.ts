import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";

let configuredStateRoot: string | null = null;

export function configureWorkspaceStateRoot(rootPath: string | undefined): void {
  configuredStateRoot = rootPath?.trim() ? resolve(rootPath) : null;
}

export function workspaceStateRoot(): string {
  if (configuredStateRoot) return configuredStateRoot;
  const override = process.env.WORKSPACE_STATE_DIR?.trim();
  if (override) return resolve(override);
  return join(platformAppDataBase(), "Workspace");
}

export function managedWorkspaceRoot(): string {
  const override = process.env.WORKSPACE_CONTENT_DIR?.trim();
  return override ? resolve(override) : join(workspaceStateRoot(), "workspaces");
}

export function resourceLibraryRoot(): string {
  const override = process.env.WORKSPACE_RESOURCES_DIR?.trim();
  return override ? resolve(override) : join(workspaceStateRoot(), "resources");
}

export function workspaceRegistryFile(): string {
  return join(workspaceStateRoot(), "workspace-registry.json");
}

export function workspaceStateDir(workspaceRoot: string): string {
  const resolved = resolve(workspaceRoot);
  const key = workspaceStateKey(resolved);
  return join(workspaceStateRoot(), "state", "workspaces", key);
}

export function workspaceStateKey(workspaceRoot: string): string {
  const resolved = resolve(workspaceRoot);
  const readable = safeSegment(basename(resolved)).slice(0, 40) || "workspace";
  const normalized = process.platform === "win32" ? resolved.toLocaleLowerCase() : resolved;
  const hash = createHash("sha256").update(normalized).digest("hex").slice(0, 16);
  return `${readable}-${hash}`;
}

export function workspaceManifestFile(workspaceRoot: string): string {
  return join(workspaceStateDir(workspaceRoot), "workspace.json");
}

export function workspaceConversationDir(workspaceRoot: string): string {
  return join(workspaceStateDir(workspaceRoot), "conversations");
}

export function workspaceSessionDir(workspaceRoot: string): string {
  return join(workspaceStateDir(workspaceRoot), "sessions");
}

export function workspaceHistoryRoot(workspaceRoot: string): string {
  return join(workspaceStateDir(workspaceRoot), "history");
}

function platformAppDataBase(): string {
  if (process.platform === "win32") {
    const appData = process.env.APPDATA?.trim();
    if (appData) return appData;
  }
  if (process.platform === "darwin") return join(homedir(), "Library", "Application Support");
  return process.env.XDG_CONFIG_HOME?.trim() || join(homedir(), ".config");
}

function safeSegment(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
}
