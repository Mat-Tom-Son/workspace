import type { WorkspaceSummary } from "../types";

export function workspaceHeaderSourceBadgeLabel(workspace: WorkspaceSummary): string {
  if (workspace.location.providerHint === "google-drive") return "Google Drive";
  return workspace.location.storage === "linked" ? "Linked folder" : "On this computer";
}

export function slugId(value: string): string {
  return surfaceDomIdSuffix(value.trim().toLowerCase().replace(/\s+/g, "-"));
}

export function surfaceDomIdSuffix(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]/g, (character) => `-${character.charCodeAt(0).toString(16)}-`);
}

export function surfaceTabDomId(tabId: string): string {
  return `surface-tab-${surfaceDomIdSuffix(tabId)}`;
}

export function surfacePanelDomId(tabId: string): string {
  return `surface-panel-${surfaceDomIdSuffix(tabId)}`;
}

export function removeWorkspaceConfirmText(workspace: WorkspaceSummary): string {
  if (workspace.location.storage === "linked") {
    return `Remove ${workspace.name} from Workspace? The original folder and everything inside it will stay on your computer.`;
  }
  return `Delete ${workspace.name} from this computer? This permanently deletes the managed Space folder and its local chat history. This cannot be undone.`;
}

export function removeWorkspaceActionLabel(workspace: WorkspaceSummary): string {
  return workspace.location.storage === "linked" ? `Remove ${workspace.name}` : `Delete ${workspace.name}`;
}
