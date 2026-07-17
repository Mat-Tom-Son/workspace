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

export interface WorkspaceAppStudioRemovalSummary {
  project: unknown | null;
  previews: readonly unknown[];
  releases: readonly unknown[];
  operations: readonly unknown[];
  incomingPreparedOperationCount?: number;
}

export function removeWorkspaceConfirmText(
  workspace: WorkspaceSummary,
  appStudio?: WorkspaceAppStudioRemovalSummary,
): string {
  const folderOutcome = workspace.location.storage === "linked"
    ? `Remove ${workspace.name} from Workspace? The original folder and everything inside it will stay on your computer.`
    : `Delete ${workspace.name} from this computer? This permanently deletes the managed Space folder and its local chat history. This cannot be undone.`;
  if (!appStudio) return folderOutcome;
  const consequences: string[] = [];
  if (appStudio.project) {
    const appState = [
      formatRemovalCount(appStudio.previews.length, "Development preview"),
      formatRemovalCount(appStudio.releases.length, "Release"),
      formatRemovalCount(appStudio.operations.length, "prepared operation"),
    ].join(", ");
    consequences.push(`This also permanently clears this computer's App Project and App Studio history (${appState}), including its receipts and unreferenced Release objects. Keeping the folder does not preserve that state.`);
  }
  if (appStudio.incomingPreparedOperationCount) {
    consequences.push(`This also cancels ${formatRemovalCount(appStudio.incomingPreparedOperationCount, "prepared App operation")} aimed at this Space.`);
  }
  return consequences.length ? `${folderOutcome} ${consequences.join(" ")}` : folderOutcome;
}

export function removeWorkspaceActionLabel(workspace: WorkspaceSummary): string {
  return workspace.location.storage === "linked" ? `Remove ${workspace.name}` : `Delete ${workspace.name}`;
}

function formatRemovalCount(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}
