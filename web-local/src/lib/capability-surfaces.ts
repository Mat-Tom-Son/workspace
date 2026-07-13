import type {
  AgentExtensionSurface,
  CapabilitySurface,
  WorkspaceSurfaceTab,
} from "../types";

export function contributedSurfaces(workspaceId: string, piSurfaces: AgentExtensionSurface[]): CapabilitySurface[] {
  return piSurfaces.map((surface): CapabilitySurface => ({
      key: `pi:${workspaceId}:${surface.id}`,
      id: surface.id,
      title: surface.title,
      ...(surface.description ? { description: surface.description } : {}),
      ...(surface.icon ? { icon: surface.icon } : {}),
      scope: surface.scope ?? "user",
      execution: "full-trust-pi",
      views: surface.views,
    }));
}

export function resolveSurfaceForKey(surfaces: CapabilitySurface[], key: string): CapabilitySurface | null {
  return surfaces.find((surface) => surface.key === key)
    ?? surfaces.find((surface) => surface.execution === "full-trust-pi" && surface.id === key)
    ?? null;
}

export function surfaceMatchesTab(surface: CapabilitySurface, tab: WorkspaceSurfaceTab): boolean {
  if (tab.kind !== "extension") return false;
  const identityMatches = tab.surfaceId === surface.key || (surface.execution === "full-trust-pi" && tab.surfaceId === surface.id);
  if (!identityMatches) return false;
  return tab.surfaceExecution === "full-trust-pi";
}
