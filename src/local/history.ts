import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { copyFile, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";

import { workspaceHistoryRoot } from "./state-paths.js";
import { assertWorkspaceDoesNotContainState, ensureSafeWorkspaceRoot } from "./workspace.js";

export interface WorkspaceCheckpoint {
  checkpointId: string;
  createdAt: string;
  label?: string;
  reason: string;
  fileCount: number;
}

const metadataName = "checkpoint.json";
const snapshotDirName = "files";
const preservedNames = new Set([".git", "node_modules"]);

export async function listWorkspaceCheckpoints(workspaceRoot: string): Promise<WorkspaceCheckpoint[]> {
  const historyRoot = workspaceHistoryRoot(ensureSafeWorkspaceRoot(workspaceRoot));
  if (!existsSync(historyRoot)) return [];
  const result: WorkspaceCheckpoint[] = [];
  for (const entry of await readdir(historyRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() || !validCheckpointId(entry.name)) continue;
    const checkpoint = await readCheckpoint(join(historyRoot, entry.name, metadataName));
    if (checkpoint) result.push(checkpoint);
  }
  return result.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

export async function createWorkspaceCheckpoint(
  workspaceRoot: string,
  options: { label?: string; reason?: string } = {},
): Promise<WorkspaceCheckpoint> {
  const root = ensureSafeWorkspaceRoot(workspaceRoot);
  assertWorkspaceDoesNotContainState(root);
  const createdAt = new Date().toISOString();
  const checkpointId = `cp-${createdAt.replace(/[-:.TZ]/g, "").slice(0, 14)}-${randomUUID().slice(0, 8)}`;
  const checkpointDir = join(workspaceHistoryRoot(root), checkpointId);
  const snapshotDir = join(checkpointDir, snapshotDirName);
  await mkdir(snapshotDir, { recursive: true });
  try {
    const fileCount = await copySnapshot(root, snapshotDir);
    const checkpoint: WorkspaceCheckpoint = {
      checkpointId,
      createdAt,
      ...(options.label?.trim() ? { label: options.label.trim().slice(0, 120) } : {}),
      reason: options.reason?.trim() || "manual",
      fileCount,
    };
    await writeFile(join(checkpointDir, metadataName), `${JSON.stringify(checkpoint, null, 2)}\n`, "utf8");
    return checkpoint;
  } catch (error) {
    await rm(checkpointDir, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
}

export async function restoreWorkspaceCheckpoint(workspaceRoot: string, checkpointId: string): Promise<{ restored: true; safetyCheckpointId: string }> {
  if (!validCheckpointId(checkpointId)) throw new Error("Invalid restore point id.");
  const root = ensureSafeWorkspaceRoot(workspaceRoot);
  const checkpointDir = join(workspaceHistoryRoot(root), checkpointId);
  const snapshotDir = join(checkpointDir, snapshotDirName);
  const selected = await readCheckpoint(join(checkpointDir, metadataName));
  if (!selected || !existsSync(snapshotDir)) throw notFound("Restore point not found.");

  const safety = await createWorkspaceCheckpoint(root, { reason: "pre_restore", label: `Before restoring ${checkpointId}` });
  const safetySnapshot = join(workspaceHistoryRoot(root), safety.checkpointId, snapshotDirName);
  try {
    await clearWorkspace(root);
    await copySnapshot(snapshotDir, root, false);
  } catch (error) {
    await clearWorkspace(root).catch(() => undefined);
    await copySnapshot(safetySnapshot, root, false).catch(() => undefined);
    throw new Error(`Restore failed; Workspace attempted to put the previous files back. ${error instanceof Error ? error.message : String(error)}`);
  }
  return { restored: true, safetyCheckpointId: safety.checkpointId };
}

async function clearWorkspace(root: string): Promise<void> {
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (preservedNames.has(entry.name)) continue;
    await rm(join(root, entry.name), { recursive: true, force: true });
  }
}

async function copySnapshot(source: string, destination: string, skipPreserved = true): Promise<number> {
  let count = 0;
  for (const entry of await readdir(source, { withFileTypes: true })) {
    if (entry.isSymbolicLink() || (skipPreserved && preservedNames.has(entry.name))) continue;
    const sourcePath = join(source, entry.name);
    const destinationPath = join(destination, entry.name);
    if (entry.isDirectory()) {
      await mkdir(destinationPath, { recursive: true });
      count += await copySnapshot(sourcePath, destinationPath, skipPreserved);
    } else if (entry.isFile()) {
      const info = await stat(sourcePath);
      if (info.size > 512 * 1024 * 1024) throw new Error(`Restore point skipped because ${basename(sourcePath)} is larger than 512 MB.`);
      await copyFile(sourcePath, destinationPath);
      count += 1;
    }
  }
  return count;
}

async function readCheckpoint(path: string): Promise<WorkspaceCheckpoint | null> {
  try {
    const value = JSON.parse(await readFile(path, "utf8")) as Partial<WorkspaceCheckpoint>;
    if (!validCheckpointId(value.checkpointId) || typeof value.createdAt !== "string" || typeof value.reason !== "string" || typeof value.fileCount !== "number") return null;
    return value as WorkspaceCheckpoint;
  } catch {
    return null;
  }
}

function validCheckpointId(value: unknown): value is string {
  return typeof value === "string" && /^cp-[A-Za-z0-9-]{10,80}$/.test(value);
}

function notFound(message: string): Error {
  const error = new Error(message) as Error & { statusCode?: number };
  error.statusCode = 404;
  return error;
}
