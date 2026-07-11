import { defaultWorkspaceBannerName, maxWorkspaceBannerImageDataUrlLength, workspaceBannerOptions } from "../constants";
import type { WorkspaceBannerImagePosition, WorkspaceBannerOption, WorkspaceCustomization, WorkspaceCustomizationMap } from "../types";

export function workspaceBannerOptionFor(bannerName: string | null | undefined): WorkspaceBannerOption {
  const normalized = bannerName?.trim().toLowerCase();
  return workspaceBannerOptions.find((option) => option.name === normalized)
    ?? workspaceBannerOptions.find((option) => option.name === defaultWorkspaceBannerName)
    ?? workspaceBannerOptions[0];
}

export function normalizeWorkspaceBannerImage(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  if (!/^data:image\/(?:png|jpeg|webp|gif|bmp);base64,/i.test(value)) return null;
  if (value.length > maxWorkspaceBannerImageDataUrlLength) return null;
  return value;
}

export function normalizeWorkspaceBannerImagePosition(value: unknown): WorkspaceBannerImagePosition {
  return value === "top" || value === "bottom" ? value : "center";
}

export function normalizeWorkspaceCustomizations(
  value: unknown,
  allowedWorkspaceIds?: ReadonlySet<string>,
  allowedIconNames?: ReadonlySet<string>,
): WorkspaceCustomizationMap {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const normalized: WorkspaceCustomizationMap = {};
  for (const [workspaceId, candidate] of Object.entries(value)) {
    if (!workspaceId || allowedWorkspaceIds && !allowedWorkspaceIds.has(workspaceId)) continue;
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) continue;
    const record = candidate as Record<string, unknown>;
    const customization: WorkspaceCustomization = {};

    if (isHexColor(record.color)) customization.color = record.color.trim().toLowerCase();
    if (isHexColor(record.color2)) customization.color2 = record.color2.trim().toLowerCase();
    if (typeof record.iconName === "string") {
      const iconName = record.iconName.trim().toLowerCase();
      if (/^[a-z0-9-]{1,64}$/.test(iconName) && (!allowedIconNames || allowedIconNames.has(iconName))) customization.iconName = iconName;
    }
    if (typeof record.bannerName === "string") {
      const bannerName = record.bannerName.trim().toLowerCase();
      if (workspaceBannerOptions.some((option) => option.name === bannerName)) customization.bannerName = bannerName;
    }
    if (typeof record.bannerImage === "string") {
      const bannerImage = normalizeWorkspaceBannerImage(record.bannerImage);
      if (bannerImage) customization.bannerImage = bannerImage;
    }
    if (record.bannerImagePosition === "top" || record.bannerImagePosition === "center" || record.bannerImagePosition === "bottom") {
      customization.bannerImagePosition = record.bannerImagePosition;
    }

    if (hasWorkspaceCustomization(customization)) normalized[workspaceId] = customization;
  }
  return normalized;
}

export function hasWorkspaceCustomization(customization: WorkspaceCustomization | null | undefined): boolean {
  return Boolean(customization && Object.values(customization).some((value) => value !== undefined && value !== null && value !== ""));
}

function isHexColor(value: unknown): value is string {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value.trim());
}
