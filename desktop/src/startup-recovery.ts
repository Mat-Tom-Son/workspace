import { isNewerRestrictedAppRegistryVersionError } from "../../src/local/agent/restricted-app-registry-error.js";

export const latestWorkspaceReleaseUrl = "https://github.com/Mat-Tom-Son/workspace/releases/latest";

export interface WorkspaceStartupRecoveryPlan {
  reason: "newer-local-state";
  actualVersion: number;
  supportedVersion: number;
  title: string;
  message: string;
}

export type WorkspaceStartupRecoveryStage =
  | { kind: "initial" }
  | { kind: "available"; version: string }
  | { kind: "unavailable" }
  | { kind: "check-failed" }
  | { kind: "install-failed" };

export interface WorkspaceStartupRecoveryDialog {
  stage: WorkspaceStartupRecoveryStage["kind"];
  type: "warning" | "error";
  title: string;
  message: string;
  detail: string;
  buttons: string[];
  defaultId: number;
  cancelId: number;
  checkId: number | null;
  downloadId: number | null;
  releasesId: number;
}

export interface WorkspaceStartupRecoveryHost {
  showDialog(dialog: WorkspaceStartupRecoveryDialog): Promise<number>;
  checkForUpdate(): Promise<string | null>;
  downloadAndInstall(): Promise<boolean>;
  openReleases(): Promise<void>;
  quit(): void;
}

export function workspaceStartupRecoveryPlan(error: unknown): WorkspaceStartupRecoveryPlan | null {
  if (!isNewerRestrictedAppRegistryVersionError(error)) return null;
  return {
    reason: "newer-local-state",
    actualVersion: error.actualVersion,
    supportedVersion: error.supportedVersion,
    title: "Workspace update required",
    message: "This version of Workspace cannot safely open newer local data.",
  };
}

export function workspaceStartupRecoveryDialog(
  plan: WorkspaceStartupRecoveryPlan,
  stage: WorkspaceStartupRecoveryStage,
): WorkspaceStartupRecoveryDialog {
  const common = { title: plan.title, checkId: null, downloadId: null } as const;
  if (stage.kind === "initial") {
    return {
      ...common,
      stage: stage.kind,
      type: "warning",
      message: plan.message,
      detail: "Local Workspace data was created by a newer build. Check for a compatible update before opening it. Your Spaces and app data are safe.",
      buttons: ["Check for Updates", "Open Releases", "Quit"],
      defaultId: 0,
      cancelId: 2,
      checkId: 0,
      releasesId: 1,
    };
  }
  if (stage.kind === "available") {
    const version = stage.version.trim().slice(0, 100);
    return {
      ...common,
      stage: stage.kind,
      type: "warning",
      message: `Workspace ${version || "update"} is available.`,
      detail: "Download and install it before opening the newer local data. Your Spaces and app data are safe.",
      buttons: ["Download and Install", "Open Releases", "Quit"],
      defaultId: 0,
      cancelId: 2,
      downloadId: 0,
      releasesId: 1,
    };
  }
  const checkFailed = stage.kind === "check-failed";
  const installFailed = stage.kind === "install-failed";
  return {
    ...common,
    stage: stage.kind,
    type: checkFailed || installFailed ? "error" : "warning",
    message: installFailed
      ? "Workspace could not download and install the required update."
      : checkFailed
        ? "Workspace could not check for updates."
        : "No compatible Workspace update was found.",
    detail: "Open the public Releases page or return to the newer development build that created this data. Your Spaces and app data are safe.",
    buttons: ["Open Releases", "Quit"],
    defaultId: 0,
    cancelId: 1,
    releasesId: 0,
  };
}

export async function runWorkspaceStartupRecovery(
  plan: WorkspaceStartupRecoveryPlan,
  host: WorkspaceStartupRecoveryHost,
): Promise<"installing" | "quit"> {
  const initial = workspaceStartupRecoveryDialog(plan, { kind: "initial" });
  const initialChoice = await host.showDialog(initial);
  if (initialChoice !== initial.checkId) return await finishRecoveryChoice(initialChoice, initial, host);

  let availableVersion: string | null;
  try {
    availableVersion = await host.checkForUpdate();
  } catch {
    const failed = workspaceStartupRecoveryDialog(plan, { kind: "check-failed" });
    return await finishRecoveryChoice(await host.showDialog(failed), failed, host);
  }
  if (!availableVersion?.trim()) {
    const unavailable = workspaceStartupRecoveryDialog(plan, { kind: "unavailable" });
    return await finishRecoveryChoice(await host.showDialog(unavailable), unavailable, host);
  }

  const available = workspaceStartupRecoveryDialog(plan, { kind: "available", version: availableVersion });
  const availableChoice = await host.showDialog(available);
  if (availableChoice !== available.downloadId) return await finishRecoveryChoice(availableChoice, available, host);

  let installing = false;
  try {
    installing = await host.downloadAndInstall();
  } catch {
    installing = false;
  }
  if (installing) return "installing";
  const failed = workspaceStartupRecoveryDialog(plan, { kind: "install-failed" });
  return await finishRecoveryChoice(await host.showDialog(failed), failed, host);
}

async function finishRecoveryChoice(
  choice: number,
  dialog: WorkspaceStartupRecoveryDialog,
  host: WorkspaceStartupRecoveryHost,
): Promise<"quit"> {
  try {
    if (choice === dialog.releasesId) await host.openReleases();
  } finally {
    host.quit();
  }
  return "quit";
}
