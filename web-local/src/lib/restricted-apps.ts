import { api } from "./api";
import type {
  RestrictedAppAutomationRunReceipt,
  RestrictedAppConnectionStatus,
  RestrictedAppCredential,
  RestrictedAppInstalled,
  RestrictedAppProposal,
  RestrictedAppReview,
  RestrictedAppStorageUsage,
} from "../types";

function collectionPath(workspaceId: string): string {
  return `/api/workspaces/${encodeURIComponent(workspaceId)}/restricted-apps`;
}

function proposalPath(workspaceId: string, conversationId: string, proposalId?: string): string {
  const collection = `/api/workspaces/${encodeURIComponent(workspaceId)}/conversations/${encodeURIComponent(conversationId)}/restricted-app-proposals`;
  return proposalId ? `${collection}/${encodeURIComponent(proposalId)}` : collection;
}

export async function listRestrictedAppProposals(workspaceId: string, conversationId: string): Promise<RestrictedAppProposal[]> {
  return (await api<{ proposals: RestrictedAppProposal[] }>(proposalPath(workspaceId, conversationId))).proposals;
}

export async function installRestrictedAppProposal(workspaceId: string, conversationId: string, proposalId: string): Promise<RestrictedAppInstalled> {
  return (await api<{ app: RestrictedAppInstalled }>(`${proposalPath(workspaceId, conversationId, proposalId)}/install`, { method: "POST" })).app;
}

export async function dismissRestrictedAppProposal(workspaceId: string, conversationId: string, proposalId: string): Promise<boolean> {
  return (await api<{ dismissed: boolean }>(proposalPath(workspaceId, conversationId, proposalId), { method: "DELETE" })).dismissed;
}

function appPath(workspaceId: string, appId: string): string {
  return `${collectionPath(workspaceId)}/${encodeURIComponent(appId)}`;
}

export async function listRestrictedApps(workspaceId: string): Promise<RestrictedAppInstalled[]> {
  return (await api<{ apps: RestrictedAppInstalled[] }>(collectionPath(workspaceId))).apps;
}

export async function inspectRestrictedApp(workspaceId: string, sourcePath: string): Promise<RestrictedAppReview> {
  return (await api<{ review: RestrictedAppReview }>(`${collectionPath(workspaceId)}/inspect`, {
    method: "POST",
    body: { sourcePath },
  })).review;
}

export async function installRestrictedApp(workspaceId: string, sourcePath: string, expectedDigest: string): Promise<RestrictedAppInstalled> {
  return (await api<{ app: RestrictedAppInstalled }>(collectionPath(workspaceId), {
    method: "POST",
    body: { sourcePath, expectedDigest },
  })).app;
}

export async function removeRestrictedApp(workspaceId: string, appId: string, expectedDigest: string): Promise<boolean> {
  return (await api<{ removed: boolean }>(appPath(workspaceId, appId), {
    method: "DELETE",
    body: { expectedDigest },
  })).removed;
}

export async function listRestrictedAppConnections(workspaceId: string, appId: string, expectedDigest: string): Promise<RestrictedAppConnectionStatus[]> {
  const query = new URLSearchParams({ expectedDigest });
  return (await api<{ connections: RestrictedAppConnectionStatus[] }>(`${appPath(workspaceId, appId)}/connections?${query}`)).connections;
}

export async function setRestrictedAppNetworkGrant(
  workspaceId: string,
  appId: string,
  destinationId: string,
  expectedDigest: string,
  granted: boolean,
): Promise<RestrictedAppInstalled> {
  return (await api<{ app: RestrictedAppInstalled }>(`${appPath(workspaceId, appId)}/permissions/network/${encodeURIComponent(destinationId)}`, {
    method: granted ? "PUT" : "DELETE",
    body: { expectedDigest },
  })).app;
}

export async function setRestrictedAppFileGrant(
  workspaceId: string,
  appId: string,
  permissionId: string,
  expectedDigest: string,
  granted: boolean,
  root?: string,
): Promise<RestrictedAppInstalled> {
  return (await api<{ app: RestrictedAppInstalled }>(`${appPath(workspaceId, appId)}/permissions/files/${encodeURIComponent(permissionId)}`, {
    method: granted ? "PUT" : "DELETE",
    body: { expectedDigest, ...(granted ? { root } : {}) },
  })).app;
}

export async function setRestrictedAppNotificationGrant(
  workspaceId: string,
  appId: string,
  permissionId: string,
  expectedDigest: string,
  granted: boolean,
): Promise<RestrictedAppInstalled> {
  return (await api<{ app: RestrictedAppInstalled }>(`${appPath(workspaceId, appId)}/permissions/notifications/${encodeURIComponent(permissionId)}`, {
    method: granted ? "PUT" : "DELETE",
    body: { expectedDigest },
  })).app;
}

export async function setRestrictedAppAutomationEnabled(
  workspaceId: string,
  appId: string,
  automationId: string,
  expectedDigest: string,
  enabled: boolean,
): Promise<RestrictedAppInstalled> {
  return (await api<{ app: RestrictedAppInstalled }>(`${appPath(workspaceId, appId)}/automations/${encodeURIComponent(automationId)}`, {
    method: enabled ? "PUT" : "DELETE",
    body: { expectedDigest },
  })).app;
}

export async function runRestrictedAppAutomationNow(
  workspaceId: string,
  appId: string,
  automationId: string,
  expectedDigest: string,
): Promise<{ app: RestrictedAppInstalled; run: RestrictedAppAutomationRunReceipt }> {
  return api<{ app: RestrictedAppInstalled; run: RestrictedAppAutomationRunReceipt }>(`${appPath(workspaceId, appId)}/automations/${encodeURIComponent(automationId)}/run`, {
    method: "POST",
    body: { expectedDigest },
  });
}

export async function listRestrictedAppAutomationRuns(
  workspaceId: string,
  appId: string,
  automationId: string,
  expectedDigest: string,
): Promise<RestrictedAppAutomationRunReceipt[]> {
  const query = new URLSearchParams({ expectedDigest });
  return (await api<{ runs: RestrictedAppAutomationRunReceipt[] }>(`${appPath(workspaceId, appId)}/automations/${encodeURIComponent(automationId)}/runs?${query}`)).runs;
}

export async function getRestrictedAppStorageUsage(workspaceId: string, appId: string, expectedDigest: string): Promise<RestrictedAppStorageUsage> {
  const query = new URLSearchParams({ expectedDigest });
  return (await api<{ usage: RestrictedAppStorageUsage }>(`${appPath(workspaceId, appId)}/storage?${query}`)).usage;
}

export async function clearRestrictedAppStorage(workspaceId: string, appId: string, expectedDigest: string): Promise<RestrictedAppStorageUsage> {
  return (await api<{ usage: RestrictedAppStorageUsage }>(`${appPath(workspaceId, appId)}/storage`, {
    method: "DELETE",
    body: { expectedDigest },
  })).usage;
}

export async function setRestrictedAppConnection(
  workspaceId: string,
  appId: string,
  destinationId: string,
  expectedDigest: string,
  credential: RestrictedAppCredential,
): Promise<RestrictedAppConnectionStatus> {
  return (await api<{ connection: RestrictedAppConnectionStatus }>(`${appPath(workspaceId, appId)}/connections/${encodeURIComponent(destinationId)}`, {
    method: "PUT",
    body: { expectedDigest, credential },
  })).connection;
}

export async function connectRestrictedAppOAuth(
  workspaceId: string,
  appId: string,
  destinationId: string,
  expectedDigest: string,
): Promise<RestrictedAppConnectionStatus> {
  return (await api<{ connection: RestrictedAppConnectionStatus }>(`${appPath(workspaceId, appId)}/connections/${encodeURIComponent(destinationId)}/oauth`, {
    method: "POST",
    body: { expectedDigest },
  })).connection;
}

export async function deleteRestrictedAppConnection(workspaceId: string, appId: string, destinationId: string, expectedDigest: string): Promise<boolean> {
  return (await api<{ removed: boolean }>(`${appPath(workspaceId, appId)}/connections/${encodeURIComponent(destinationId)}`, {
    method: "DELETE",
    body: { expectedDigest },
  })).removed;
}
