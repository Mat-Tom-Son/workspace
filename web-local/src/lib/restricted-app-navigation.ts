import type { WorkspaceRailMode, WorkspaceSummary } from "../types";

export interface RestrictedAppOpenRequest {
  workspaceId: string;
  appId: string;
  digest: string;
  permissionId: string;
}

export function restrictedAppRailMode(workspaceId: string, appId: string): WorkspaceRailMode {
  return `app:restricted:${workspaceId}:${appId}`;
}

export function resolveRestrictedAppOpenRequest(
  request: RestrictedAppOpenRequest,
  workspaces: readonly WorkspaceSummary[],
): { workspace: WorkspaceSummary; mode: WorkspaceRailMode } | null {
  if (!request.workspaceId || !request.appId || !request.digest || !request.permissionId) return null;
  const workspace = workspaces.find((item) => item.id === request.workspaceId);
  return workspace ? { workspace, mode: restrictedAppRailMode(workspace.id, request.appId) } : null;
}
