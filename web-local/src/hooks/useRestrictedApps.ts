import { useCallback, useEffect, useRef, useState } from "react";

import { listRestrictedApps } from "../lib/restricted-apps";
import type { RestrictedAppInstalled } from "../types";

const emptyRestrictedAppFixtures: Record<string, RestrictedAppInstalled[]> = {};

export function useRestrictedApps({
  activeWorkspaceId,
  fixtureMode = false,
  fixtureApps = emptyRestrictedAppFixtures,
  onError,
}: {
  activeWorkspaceId: string;
  fixtureMode?: boolean;
  fixtureApps?: Record<string, RestrictedAppInstalled[]>;
  onError: (error: unknown) => void;
}) {
  const [appsByWorkspace, setAppsByWorkspace] = useState<Record<string, RestrictedAppInstalled[]>>(fixtureApps);
  const [knownWorkspaceIds, setKnownWorkspaceIds] = useState<Set<string>>(() => new Set(Object.keys(fixtureApps)));
  const [loadingWorkspaceIds, setLoadingWorkspaceIds] = useState<Set<string>>(() => new Set());
  const requestVersionsRef = useRef(new Map<string, number>());

  const refresh = useCallback(async (workspaceId: string) => {
    if (!workspaceId) return;
    if (fixtureMode) {
      setAppsByWorkspace((current) => ({ ...current, [workspaceId]: fixtureApps[workspaceId] ?? current[workspaceId] ?? [] }));
      setKnownWorkspaceIds((current) => new Set(current).add(workspaceId));
      return;
    }
    const requestVersion = (requestVersionsRef.current.get(workspaceId) ?? 0) + 1;
    requestVersionsRef.current.set(workspaceId, requestVersion);
    setLoadingWorkspaceIds((current) => new Set(current).add(workspaceId));
    try {
      const apps = await listRestrictedApps(workspaceId);
      if (requestVersionsRef.current.get(workspaceId) !== requestVersion) return;
      setAppsByWorkspace((current) => ({ ...current, [workspaceId]: apps }));
      setKnownWorkspaceIds((current) => new Set(current).add(workspaceId));
    } catch (caught) {
      if (requestVersionsRef.current.get(workspaceId) === requestVersion) onError(caught);
    } finally {
      if (requestVersionsRef.current.get(workspaceId) === requestVersion) {
        setLoadingWorkspaceIds((current) => {
          const next = new Set(current);
          next.delete(workspaceId);
          return next;
        });
      }
    }
  }, [fixtureApps, fixtureMode, onError]);

  useEffect(() => {
    if (fixtureMode) {
      setAppsByWorkspace({ ...fixtureApps, [activeWorkspaceId]: fixtureApps[activeWorkspaceId] ?? [] });
      setKnownWorkspaceIds(new Set([...Object.keys(fixtureApps), activeWorkspaceId]));
      return;
    }
    void refresh(activeWorkspaceId);
  }, [activeWorkspaceId, fixtureApps, fixtureMode, refresh]);

  const replaceApps = useCallback((workspaceId: string, apps: RestrictedAppInstalled[]) => {
    setAppsByWorkspace((current) => ({ ...current, [workspaceId]: apps }));
    setKnownWorkspaceIds((current) => new Set(current).add(workspaceId));
  }, []);

  const upsertApp = useCallback((app: RestrictedAppInstalled) => {
    setAppsByWorkspace((current) => {
      const existing = current[app.workspaceId] ?? [];
      const next = existing.some((item) => item.manifest.id === app.manifest.id)
        ? existing.map((item) => item.manifest.id === app.manifest.id ? app : item)
        : [...existing, app];
      return { ...current, [app.workspaceId]: next };
    });
    setKnownWorkspaceIds((current) => new Set(current).add(app.workspaceId));
  }, []);

  const removeApp = useCallback((workspaceId: string, appId: string) => {
    setAppsByWorkspace((current) => ({
      ...current,
      [workspaceId]: (current[workspaceId] ?? []).filter((item) => item.manifest.id !== appId),
    }));
    setKnownWorkspaceIds((current) => new Set(current).add(workspaceId));
  }, []);

  const replaceRuntimeInstanceApps = useCallback((
    workspaceId: string,
    runtimeInstanceId: string,
    apps: RestrictedAppInstalled[],
  ) => {
    setAppsByWorkspace((current) => {
      const preserved = (current[workspaceId] ?? []).filter((item) => item.runtimeInstanceId !== runtimeInstanceId);
      const replacements = apps.filter((item) => (
        item.workspaceId === workspaceId && item.runtimeInstanceId === runtimeInstanceId
      ));
      const next = [...preserved, ...replacements].sort((left, right) => (
        left.manifest.title.localeCompare(right.manifest.title) || left.manifest.id.localeCompare(right.manifest.id)
      ));
      return { ...current, [workspaceId]: next };
    });
    setKnownWorkspaceIds((current) => new Set(current).add(workspaceId));
  }, []);

  return {
    appsByWorkspace,
    knownWorkspaceIds,
    loadingWorkspaceIds,
    refresh,
    replaceApps,
    replaceRuntimeInstanceApps,
    upsertApp,
    removeApp,
  };
}
