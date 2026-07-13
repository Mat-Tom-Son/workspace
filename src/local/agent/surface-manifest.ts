import { lstat, readFile, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import type { PiCatalogSource, PiExtensionCatalogItem } from "./skill-catalog.js";

export const extensionSurfaceManifestFileName = "surface.json";
export const extensionSurfaceManifestVersion = 1 as const;

const maxManifestBytes = 256 * 1024;
const idPattern = /^[a-z0-9][a-z0-9-]{0,63}$/;
const iconPattern = /^[a-z][a-z0-9-]{0,63}$/;

export type PiSurfaceBlock =
  | { type: "heading"; text: string; level: 1 | 2 | 3 }
  | { type: "text"; text: string }
  | { type: "callout"; tone: "info" | "success" | "warning"; title?: string; text: string }
  | { type: "metrics"; items: Array<{ label: string; value: string; detail?: string }> }
  | { type: "table"; columns: string[]; rows: string[][] }
  | { type: "list"; items: Array<{ title: string; detail?: string; badge?: string }> };

export interface PiExtensionSurfaceView {
  id: string;
  title: string;
  description?: string;
  blocks: PiSurfaceBlock[];
}

export interface PiExtensionSurface {
  id: string;
  title: string;
  description?: string;
  icon?: string;
  extensionPath: string;
  manifestPath: string;
  source: PiCatalogSource;
  views: PiExtensionSurfaceView[];
}

export interface PiExtensionSurfaceDiagnostic {
  type: "warning" | "error";
  message: string;
  path: string;
}

export interface PiExtensionSurfaceLoadResult {
  surfaces: PiExtensionSurface[];
  diagnostics: PiExtensionSurfaceDiagnostic[];
}

export async function loadExtensionSurfaceManifests(
  extensions: PiExtensionCatalogItem[],
): Promise<PiExtensionSurfaceLoadResult> {
  const surfaces: PiExtensionSurface[] = [];
  const diagnostics: PiExtensionSurfaceDiagnostic[] = [];
  const visitedManifestPaths = new Set<string>();

  for (const extension of [...extensions].sort((left, right) => left.resolvedPath.localeCompare(right.resolvedPath))) {
    const manifestPath = await surfaceManifestPath(extension.resolvedPath);
    if (!manifestPath || visitedManifestPaths.has(manifestPath)) continue;
    visitedManifestPaths.add(manifestPath);
    try {
      const manifestStat = await lstat(manifestPath);
      if (manifestStat.isSymbolicLink() || !manifestStat.isFile()) {
        throw new Error("Surface manifest must be a regular file, not a link or directory.");
      }
      if (manifestStat.size > maxManifestBytes) {
        throw new Error(`Surface manifest exceeds the ${maxManifestBytes / 1024} KB limit.`);
      }
      const source = await readFile(manifestPath, "utf8");
      const parsed = JSON.parse(source) as unknown;
      surfaces.push(parseExtensionSurfaceManifest(parsed, {
        extensionPath: extension.resolvedPath,
        manifestPath,
        source: extension.source,
      }));
    } catch (error) {
      if (isMissingFileError(error)) continue;
      diagnostics.push({
        type: "error",
        path: manifestPath,
        message: `Could not load Extension surface: ${errorMessage(error)}`,
      });
    }
  }

  const uniqueSurfaces: PiExtensionSurface[] = [];
  const ids = new Set<string>();
  for (const surface of surfaces.sort((left, right) => left.id.localeCompare(right.id) || left.manifestPath.localeCompare(right.manifestPath))) {
    if (ids.has(surface.id)) {
      diagnostics.push({
        type: "warning",
        path: surface.manifestPath,
        message: `Extension surface id is already registered and was ignored: ${surface.id}`,
      });
      continue;
    }
    ids.add(surface.id);
    uniqueSurfaces.push(surface);
  }

  return { surfaces: uniqueSurfaces, diagnostics };
}

export function parseExtensionSurfaceManifest(
  value: unknown,
  context: { extensionPath: string; manifestPath: string; source: PiCatalogSource },
): PiExtensionSurface {
  const manifest = objectValue(value, "Surface manifest");
  if (manifest.version !== extensionSurfaceManifestVersion) {
    throw new Error(`Surface manifest version must be ${extensionSurfaceManifestVersion}.`);
  }
  const id = idValue(manifest.id, "Surface id");
  const title = stringValue(manifest.title, "Surface title", 80);
  const description = optionalStringValue(manifest.description, "Surface description", 280);
  const icon = optionalPatternValue(manifest.icon, "Surface icon", iconPattern);
  const rawViews = arrayValue(manifest.views, "Surface views", 1, 32);
  const views = rawViews.map((view, index) => parseView(view, index));
  const viewIds = new Set<string>();
  for (const view of views) {
    if (viewIds.has(view.id)) throw new Error(`Surface view id is duplicated: ${view.id}`);
    viewIds.add(view.id);
  }
  return {
    id,
    title,
    ...(description ? { description } : {}),
    ...(icon ? { icon } : {}),
    extensionPath: context.extensionPath,
    manifestPath: context.manifestPath,
    source: { ...context.source },
    views,
  };
}

function parseView(value: unknown, index: number): PiExtensionSurfaceView {
  const view = objectValue(value, `Surface view ${index + 1}`);
  const description = optionalStringValue(view.description, `Surface view ${index + 1} description`, 280);
  return {
    id: idValue(view.id, `Surface view ${index + 1} id`),
    title: stringValue(view.title, `Surface view ${index + 1} title`, 80),
    ...(description ? { description } : {}),
    blocks: arrayValue(view.blocks, `Surface view ${index + 1} blocks`, 0, 64)
      .map((block, blockIndex) => parseBlock(block, index, blockIndex)),
  };
}

function parseBlock(value: unknown, viewIndex: number, blockIndex: number): PiSurfaceBlock {
  const label = `Surface view ${viewIndex + 1} block ${blockIndex + 1}`;
  const block = objectValue(value, label);
  if (block.type === "heading") {
    const level = block.level === undefined ? 2 : block.level;
    if (level !== 1 && level !== 2 && level !== 3) throw new Error(`${label} heading level must be 1, 2, or 3.`);
    return { type: "heading", text: stringValue(block.text, `${label} text`, 160), level };
  }
  if (block.type === "text") {
    return { type: "text", text: stringValue(block.text, `${label} text`, 4_000) };
  }
  if (block.type === "callout") {
    const tone = block.tone === undefined ? "info" : block.tone;
    if (tone !== "info" && tone !== "success" && tone !== "warning") throw new Error(`${label} tone is invalid.`);
    const title = optionalStringValue(block.title, `${label} title`, 120);
    return {
      type: "callout",
      tone,
      ...(title ? { title } : {}),
      text: stringValue(block.text, `${label} text`, 1_000),
    };
  }
  if (block.type === "metrics") {
    return {
      type: "metrics",
      items: arrayValue(block.items, `${label} items`, 1, 12).map((item, itemIndex) => {
        const metric = objectValue(item, `${label} metric ${itemIndex + 1}`);
        const detail = optionalStringValue(metric.detail, `${label} metric ${itemIndex + 1} detail`, 240);
        return {
          label: stringValue(metric.label, `${label} metric ${itemIndex + 1} label`, 80),
          value: stringValue(metric.value, `${label} metric ${itemIndex + 1} value`, 120),
          ...(detail ? { detail } : {}),
        };
      }),
    };
  }
  if (block.type === "table") {
    const columns = arrayValue(block.columns, `${label} columns`, 1, 12)
      .map((column, columnIndex) => stringValue(column, `${label} column ${columnIndex + 1}`, 100));
    const rows = arrayValue(block.rows, `${label} rows`, 0, 200).map((row, rowIndex) => {
      const cells = arrayValue(row, `${label} row ${rowIndex + 1}`, columns.length, columns.length);
      return cells.map((cell, cellIndex) => stringValue(cell, `${label} row ${rowIndex + 1} cell ${cellIndex + 1}`, 500));
    });
    return { type: "table", columns, rows };
  }
  if (block.type === "list") {
    return {
      type: "list",
      items: arrayValue(block.items, `${label} items`, 1, 100).map((item, itemIndex) => {
        const listItem = objectValue(item, `${label} item ${itemIndex + 1}`);
        const detail = optionalStringValue(listItem.detail, `${label} item ${itemIndex + 1} detail`, 500);
        const badge = optionalStringValue(listItem.badge, `${label} item ${itemIndex + 1} badge`, 60);
        return {
          title: stringValue(listItem.title, `${label} item ${itemIndex + 1} title`, 160),
          ...(detail ? { detail } : {}),
          ...(badge ? { badge } : {}),
        };
      }),
    };
  }
  throw new Error(`${label} type is unsupported.`);
}

async function surfaceManifestPath(extensionPath: string): Promise<string | null> {
  const resolvedPath = resolve(extensionPath);
  try {
    const extensionStat = await stat(resolvedPath);
    return join(extensionStat.isDirectory() ? resolvedPath : dirname(resolvedPath), extensionSurfaceManifestFileName);
  } catch (error) {
    if (isMissingFileError(error)) return null;
    throw error;
  }
}

function objectValue(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  return value as Record<string, unknown>;
}

function arrayValue(value: unknown, label: string, minimum: number, maximum: number): unknown[] {
  if (!Array.isArray(value) || value.length < minimum || value.length > maximum) {
    throw new Error(`${label} must contain between ${minimum} and ${maximum} items.`);
  }
  return value;
}

function stringValue(value: unknown, label: string, maximum: number): string {
  if (typeof value !== "string") throw new Error(`${label} must be text.`);
  const text = value.trim();
  if (!text || text.length > maximum) throw new Error(`${label} must contain between 1 and ${maximum} characters.`);
  return text;
}

function optionalStringValue(value: unknown, label: string, maximum: number): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  return stringValue(value, label, maximum);
}

function idValue(value: unknown, label: string): string {
  const id = stringValue(value, label, 64);
  if (!idPattern.test(id)) throw new Error(`${label} must use lowercase letters, numbers, and hyphens.`);
  return id;
}

function optionalPatternValue(value: unknown, label: string, pattern: RegExp): string | undefined {
  const text = optionalStringValue(value, label, 64);
  if (text && !pattern.test(text)) throw new Error(`${label} is invalid.`);
  return text;
}

function isMissingFileError(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT");
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
