import { createHash, randomUUID } from "node:crypto";
import { createReadStream, existsSync, lstatSync } from "node:fs";
import {
  copyFile,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import {
  basename,
  dirname,
  extname,
  isAbsolute,
  join,
  parse,
  relative,
  resolve,
  sep,
} from "node:path";

import { isOfficeDocumentPath, isOfficeLockFileName, officeDocumentLockPresent } from "./office-lock-files.js";
import {
  managedWorkspaceRoot,
  workspaceStateDir,
  workspaceStateRoot,
  workspaceManifestFile,
  workspaceRegistryFile,
} from "./state-paths.js";
import { isAlwaysHiddenWorkspaceEntry, isWorkspaceIgnored, readWorkspaceIgnoreState } from "./workspace-ignore.js";

export interface WorkspaceLocation {
  kind: "local";
  storage: "managed" | "linked";
  providerHint?: "google-drive";
}

export interface WorkspaceSummary {
  id: string;
  name: string;
  rootPath: string;
  location: WorkspaceLocation;
  createdAt: string;
  updatedAt: string;
}

export interface TreeEntry {
  name: string;
  path: string;
  kind: "file" | "folder";
  sizeBytes?: number;
  updatedAt?: string;
  ignored?: boolean;
  descendantIgnoredCount?: number;
  hasChildren?: boolean;
  children?: TreeEntry[];
}

export interface WorkspaceEntryInfo {
  name: string;
  path: string;
  kind: "file" | "folder";
  sizeBytes: number;
  createdAt: string;
  modifiedAt: string;
  extension: string | null;
  mimeType: string;
  hashSha256: string | null;
  officeDocument: boolean;
  openInOffice: boolean;
}

export interface WorkspaceMovedEntry {
  fromPath: string;
  path: string;
  name: string;
  kind: "file" | "folder";
  updatedAt: string;
}

export interface WorkspaceCreatedEntry {
  path: string;
  name: string;
  kind: "file" | "folder";
  sizeBytes?: number;
  updatedAt: string;
}

export interface WorkspaceTreeOptions {
  includeIgnored?: boolean;
}

interface WorkspaceRegistry {
  version: 1;
  workspaces: WorkspaceSummary[];
}

const maxPreviewBytes = 2 * 1024 * 1024;

export async function listWorkspaces(): Promise<WorkspaceSummary[]> {
  const registry = await readRegistry();
  return registry.workspaces
    .filter((workspace) => existsSync(workspace.rootPath))
    .filter((workspace) => workspace.location.storage !== "linked" || linkedWorkspaceStateSeparated(workspace.rootPath))
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export async function createManagedWorkspace(name: string, baseDir = managedWorkspaceRoot()): Promise<WorkspaceSummary> {
  const normalizedName = normalizeWorkspaceName(name);
  await mkdir(baseDir, { recursive: true });
  const rootPath = await nextAvailableDirectory(baseDir, safeSegment(normalizedName) || "workspace");
  await mkdir(rootPath, { recursive: false });
  return registerWorkspace({
    name: normalizedName,
    rootPath,
    location: { kind: "local", storage: "managed" },
  });
}

export async function registerLinkedWorkspace(rootPath: string, providerHint?: "google-drive"): Promise<WorkspaceSummary> {
  const safeRoot = ensureSafeWorkspaceRoot(rootPath);
  assertLinkedWorkspaceStateSeparation(safeRoot);
  const info = await stat(safeRoot).catch(() => null);
  if (!info?.isDirectory()) throw new Error("The folder selected for this Space does not exist.");
  return registerWorkspace({
    name: basename(safeRoot),
    rootPath: safeRoot,
    location: {
      kind: "local",
      storage: "linked",
      ...(providerHint === "google-drive" || looksLikeGoogleDrivePath(safeRoot) ? { providerHint: "google-drive" as const } : {}),
    },
  });
}

export async function getWorkspace(workspaceId: string): Promise<WorkspaceSummary> {
  assertId(workspaceId);
  const workspace = (await listWorkspaces()).find((item) => item.id === workspaceId);
  if (!workspace) throw notFound("Space not found.");
  if (workspace.location.storage === "linked") assertLinkedWorkspaceStateSeparation(workspace.rootPath);
  return workspace;
}

export async function renameWorkspace(workspaceId: string, name: string): Promise<WorkspaceSummary> {
  assertId(workspaceId);
  const normalizedName = normalizeWorkspaceName(name);
  const registry = await readRegistry();
  const workspace = registry.workspaces.find((item) => item.id === workspaceId);
  if (!workspace || !existsSync(workspace.rootPath)) throw notFound("Space not found.");
  workspace.name = normalizedName;
  workspace.updatedAt = new Date().toISOString();
  await writeRegistry(registry);
  await writeExternalManifest(workspace);
  return workspace;
}

export async function removeWorkspace(
  workspaceId: string,
  managedBase = managedWorkspaceRoot(),
): Promise<{ removed: true; deleted: boolean; rootPath: string }> {
  const workspace = await getWorkspace(workspaceId);
  const registry = await readRegistry();
  const rootPath = ensureSafeWorkspaceRoot(workspace.rootPath);
  let deleted = false;
  if (workspace.location.storage === "managed") {
    const base = resolve(managedBase);
    if (samePath(rootPath, base) || !pathContains(base, rootPath)) {
      throw new Error("Workspace will only delete a managed Space inside its registered managed-content folder.");
    }
    await rm(rootPath, { recursive: true, force: false });
    deleted = true;
  }
  registry.workspaces = registry.workspaces.filter((item) => item.id !== workspaceId);
  await writeRegistry(registry);
  await rm(workspaceStateDir(rootPath), { recursive: true, force: true });
  return { removed: true, deleted, rootPath };
}

export async function scanWorkspaceTree(
  rootPath: string,
  maxDepth = 20,
  relativePath = "",
  options: WorkspaceTreeOptions = {},
): Promise<TreeEntry[]> {
  const safeRoot = ensureSafeWorkspaceRoot(rootPath);
  const scanRoot = resolveWorkspacePath(safeRoot, relativePath || ".");
  const info = await stat(scanRoot).catch(() => null);
  if (!info?.isDirectory()) throw new Error("Requested Space tree path is not a folder.");
  const ignoreState = await readWorkspaceIgnoreState(safeRoot);
  return scanDirectory(safeRoot, scanRoot, 0, Math.min(Math.max(maxDepth, 0), 50), ignoreState.patterns, options.includeIgnored !== false);
}

export async function readWorkspaceTextFile(rootPath: string, relativePath: string): Promise<{ text: string }> {
  const path = resolveWorkspacePath(rootPath, relativePath);
  const info = await stat(path).catch(() => null);
  if (!info?.isFile()) throw notFound("File not found.");
  if (info.size > maxPreviewBytes) throw new Error("This file is too large to preview (2 MB maximum).");
  const bytes = await readFile(path);
  if (looksBinary(bytes)) throw new Error("This file is binary and cannot be previewed as text.");
  return { text: bytes.toString("utf8") };
}

export async function writeWorkspaceTextFile(rootPath: string, relativePath: string, text: string): Promise<{ path: string; text: string }> {
  const path = resolveWorkspacePath(rootPath, relativePath);
  const info = await stat(path).catch(() => null);
  if (!info?.isFile()) throw notFound("File not found.");
  if (Buffer.byteLength(text, "utf8") > maxPreviewBytes) throw new Error("This file is too large to edit (2 MB maximum).");
  await writeFile(path, text, "utf8");
  await touchWorkspace(rootPath);
  return { path: normalizeRelative(relative(ensureSafeWorkspaceRoot(rootPath), path)), text };
}

export async function getWorkspaceEntryInfo(rootPath: string, relativePath: string): Promise<WorkspaceEntryInfo> {
  const root = ensureSafeWorkspaceRoot(rootPath);
  const path = resolveWorkspacePath(root, relativePath);
  const info = await stat(path).catch(() => null);
  if (!info || (!info.isFile() && !info.isDirectory())) throw notFound("Space item not found.");
  const extension = info.isFile() ? extname(path).toLowerCase() || null : null;
  const officeDocument = info.isFile() && isOfficeDocumentPath(path);
  return {
    name: basename(path),
    path: normalizeRelative(relative(root, path)),
    kind: info.isDirectory() ? "folder" : "file",
    sizeBytes: info.isFile() ? info.size : 0,
    createdAt: info.birthtime.toISOString(),
    modifiedAt: info.mtime.toISOString(),
    extension,
    mimeType: info.isDirectory() ? "inode/directory" : contentTypeForExtension(extension),
    hashSha256: info.isFile() ? await sha256File(path) : null,
    officeDocument,
    openInOffice: officeDocument ? await officeDocumentLockPresent(path) : false,
  };
}

export async function findExistingWorkspaceFilePaths(rootPath: string, requestedPaths: string[]): Promise<string[]> {
  const root = ensureSafeWorkspaceRoot(rootPath);
  const requests = [...new Set(requestedPaths.map(normalizeRelative).filter(Boolean))].slice(0, 32);
  const existing = new Set<string>();
  const unresolvedNames = new Set<string>();
  for (const request of requests) {
    try {
      const path = resolveWorkspacePath(root, request);
      if ((await stat(path)).isFile()) {
        existing.add(normalizeRelative(relative(root, path)));
        continue;
      }
    } catch (error) {
      if (!(error instanceof Error) || !("code" in error) || (error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    if (!request.includes("/")) unresolvedNames.add(request.toLocaleLowerCase());
  }
  if (unresolvedNames.size) {
    const matches = new Map<string, string[]>();
    for (const name of unresolvedNames) matches.set(name, []);
    await visitWorkspaceFiles(root, root, (path, name) => matches.get(name.toLocaleLowerCase())?.push(path));
    for (const paths of matches.values()) if (paths.length === 1 && paths[0]) existing.add(paths[0]);
  }
  return [...existing].sort((left, right) => left.localeCompare(right));
}

export async function moveWorkspaceEntry(
  rootPath: string,
  input: { sourcePath: string; targetFolderPath?: string },
): Promise<WorkspaceMovedEntry> {
  const root = ensureSafeWorkspaceRoot(rootPath);
  const sourcePath = normalizeRelative(input.sourcePath);
  const targetFolderPath = normalizeRelative(input.targetFolderPath ?? "");
  if (!sourcePath || sourcePath === ".") throw new Error("Select a file or folder to move.");
  if (targetFolderPath === sourcePath || targetFolderPath.startsWith(`${sourcePath}/`)) throw new Error("Folders cannot be moved into themselves.");
  const source = resolveWorkspacePath(root, sourcePath);
  if (samePath(source, root)) throw new Error("The Space root cannot be moved.");
  const sourceInfo = await stat(source).catch(() => null);
  if (!sourceInfo || (!sourceInfo.isFile() && !sourceInfo.isDirectory())) throw notFound("Space item not found.");
  const targetFolder = resolveWorkspacePath(root, targetFolderPath || ".");
  if (!(await stat(targetFolder)).isDirectory()) throw new Error("Move items into a folder.");
  if (dirname(source) === targetFolder) throw new Error("That item is already in the selected folder.");
  const destination = join(targetFolder, basename(source));
  if (existsSync(destination)) throw new Error(`A file or folder named ${basename(source)} already exists there.`);
  await rename(source, destination);
  const movedInfo = await stat(destination);
  await touchWorkspace(root);
  return {
    fromPath: sourcePath,
    path: normalizeRelative(relative(root, destination)),
    name: basename(destination),
    kind: movedInfo.isDirectory() ? "folder" : "file",
    updatedAt: movedInfo.mtime.toISOString(),
  };
}

export async function renameWorkspaceEntry(
  rootPath: string,
  input: { path: string; newName: string },
): Promise<WorkspaceMovedEntry> {
  const root = ensureSafeWorkspaceRoot(rootPath);
  const sourcePath = normalizeRelative(input.path);
  if (!sourcePath || sourcePath === ".") throw new Error("Select a file or folder to rename.");
  const newName = safeFileName(input.newName);
  const source = resolveWorkspacePath(root, sourcePath);
  if (samePath(source, root)) throw new Error("The Space root cannot be renamed.");
  const sourceInfo = await stat(source).catch(() => null);
  if (!sourceInfo || (!sourceInfo.isFile() && !sourceInfo.isDirectory())) throw notFound("Space item not found.");
  if (basename(source) === newName) throw new Error("That item already has this name.");
  const destination = join(dirname(source), newName);
  resolveWorkspacePath(root, normalizeRelative(relative(root, destination)));
  if (existsSync(destination)) throw new Error(`A file or folder named ${newName} already exists there.`);
  await rename(source, destination);
  const renamedInfo = await stat(destination);
  await touchWorkspace(root);
  return {
    fromPath: sourcePath,
    path: normalizeRelative(relative(root, destination)),
    name: newName,
    kind: renamedInfo.isDirectory() ? "folder" : "file",
    updatedAt: renamedInfo.mtime.toISOString(),
  };
}

export async function createWorkspaceFolder(
  rootPath: string,
  parentPath: string,
  name: string,
): Promise<WorkspaceCreatedEntry> {
  const root = ensureSafeWorkspaceRoot(rootPath);
  const parent = resolveWorkspacePath(root, parentPath || ".");
  if (!(await stat(parent)).isDirectory()) throw new Error("Create folders inside a Space folder.");
  const safeName = safeFileName(name);
  const destination = join(parent, safeName);
  if (existsSync(destination)) throw new Error(`A file or folder named ${safeName} already exists there.`);
  await mkdir(destination, { recursive: false });
  const info = await stat(destination);
  await touchWorkspace(root);
  return {
    path: normalizeRelative(relative(root, destination)),
    name: safeName,
    kind: "folder",
    updatedAt: info.mtime.toISOString(),
  };
}

export async function createWorkspaceTextFile(
  rootPath: string,
  parentPath: string,
  name: string,
  text = "",
): Promise<WorkspaceCreatedEntry> {
  const root = ensureSafeWorkspaceRoot(rootPath);
  const parent = resolveWorkspacePath(root, parentPath || ".");
  if (!(await stat(parent)).isDirectory()) throw new Error("Create files inside a Space folder.");
  const safeName = safeFileName(name);
  const destination = join(parent, safeName);
  if (Buffer.byteLength(text, "utf8") > maxPreviewBytes) throw new Error("The new file is too large (2 MB maximum).");
  await writeFile(destination, text, { encoding: "utf8", flag: "wx" });
  const info = await stat(destination);
  await touchWorkspace(root);
  return {
    path: normalizeRelative(relative(root, destination)),
    name: safeName,
    kind: "file",
    sizeBytes: info.size,
    updatedAt: info.mtime.toISOString(),
  };
}

export async function deleteWorkspaceEntry(rootPath: string, relativePath: string): Promise<{ deleted: true; path: string; kind: "file" | "folder" }> {
  const root = ensureSafeWorkspaceRoot(rootPath);
  const normalized = normalizeRelative(relativePath);
  if (!normalized || normalized === ".") throw new Error("Select a file or folder to delete.");
  const path = resolveWorkspacePath(root, normalized);
  if (samePath(path, root)) throw new Error("The Space root cannot be deleted.");
  const info = await stat(path).catch(() => null);
  if (!info || (!info.isFile() && !info.isDirectory())) throw notFound("Space item not found.");
  await rm(path, { recursive: info.isDirectory(), force: false });
  await touchWorkspace(root);
  return { deleted: true, path: normalized, kind: info.isDirectory() ? "folder" : "file" };
}

export async function writeUploadedFiles(
  rootPath: string,
  targetFolderPath: string,
  files: Array<{ fileName: string; relativePath?: string; data: Buffer }>,
): Promise<Array<{ path: string; sizeBytes: number }>> {
  const targetFolder = resolveWorkspacePath(rootPath, targetFolderPath || ".");
  await mkdir(targetFolder, { recursive: true });
  const written: Array<{ path: string; sizeBytes: number }> = [];
  for (const file of files) {
    const uploadPath = safeUploadPath(file.relativePath || file.fileName);
    const desired = resolveWorkspacePath(targetFolder, uploadPath);
    await mkdir(dirname(desired), { recursive: true });
    const destination = await nextAvailableFile(desired);
    await writeFile(destination, file.data, { flag: "wx" });
    written.push({ path: normalizeRelative(relative(rootPath, destination)), sizeBytes: file.data.byteLength });
  }
  await touchWorkspace(rootPath);
  return written;
}

export async function copyPathIntoWorkspace(
  sourcePath: string,
  workspaceRoot: string,
  targetFolderPath: string,
): Promise<string> {
  const targetFolder = resolveWorkspacePath(workspaceRoot, targetFolderPath || ".");
  await mkdir(targetFolder, { recursive: true });
  const destination = await nextAvailablePath(join(targetFolder, safeFileName(basename(sourcePath))));
  await copyVisiblePath(sourcePath, destination);
  await touchWorkspace(workspaceRoot);
  return normalizeRelative(relative(workspaceRoot, destination));
}

export function resolveWorkspacePath(rootPath: string, relativePath: string): string {
  const root = ensureSafeWorkspaceRoot(rootPath);
  const normalized = normalizeRelative(relativePath || ".");
  if (isAbsolute(relativePath) || normalized.split("/").includes("..")) {
    throw new Error("Path escapes the selected Space.");
  }
  const path = resolve(root, normalized || ".");
  if (path !== root && !path.startsWith(`${root}${sep}`)) throw new Error("Path escapes the selected Space.");
  assertNoLinkSegments(root, path);
  return path;
}

export function ensureSafeWorkspaceRoot(rootPath: string): string {
  const resolved = resolve(rootPath);
  if (!isAbsolute(resolved) || resolved === parse(resolved).root) throw new Error("A filesystem root cannot be used as a Space.");
  if (existsSync(resolved) && lstatSync(resolved).isSymbolicLink()) throw new Error("A Space cannot be a symbolic link or junction.");
  return resolved;
}

export function assertWorkspaceDoesNotContainState(rootPath: string): void {
  const root = ensureSafeWorkspaceRoot(rootPath);
  const stateRoot = resolve(workspaceStateRoot());
  if (pathContains(root, stateRoot)) {
    throw new Error("Choose a narrower folder that does not contain Workspace application data.");
  }
}

export async function sha256File(path: string): Promise<string> {
  const hash = createHash("sha256");
  await new Promise<void>((resolvePromise, reject) => {
    createReadStream(path).on("data", (chunk) => hash.update(chunk)).on("error", reject).on("end", resolvePromise);
  });
  return hash.digest("hex");
}

async function registerWorkspace(input: Omit<WorkspaceSummary, "id" | "createdAt" | "updatedAt">): Promise<WorkspaceSummary> {
  const registry = await readRegistry();
  const rootPath = resolve(input.rootPath);
  const existing = registry.workspaces.find((workspace) => samePath(workspace.rootPath, rootPath));
  if (existing) return existing;
  const now = new Date().toISOString();
  const workspace: WorkspaceSummary = {
    ...input,
    id: stableWorkspaceId(rootPath),
    rootPath,
    createdAt: now,
    updatedAt: now,
  };
  registry.workspaces.push(workspace);
  await writeRegistry(registry);
  await writeExternalManifest(workspace);
  return workspace;
}

async function touchWorkspace(rootPath: string): Promise<void> {
  const registry = await readRegistry();
  const workspace = registry.workspaces.find((item) => samePath(item.rootPath, rootPath));
  if (!workspace) return;
  workspace.updatedAt = new Date().toISOString();
  await writeRegistry(registry);
  await writeExternalManifest(workspace);
}

async function readRegistry(): Promise<WorkspaceRegistry> {
  const file = workspaceRegistryFile();
  if (!existsSync(file)) return { version: 1, workspaces: [] };
  try {
    const parsed = JSON.parse(await readFile(file, "utf8")) as Partial<WorkspaceRegistry>;
    if (!Array.isArray(parsed.workspaces)) return { version: 1, workspaces: [] };
    return {
      version: 1,
      workspaces: parsed.workspaces.filter(isWorkspaceSummary).map((workspace) => ({ ...workspace, rootPath: resolve(workspace.rootPath) })),
    };
  } catch {
    return { version: 1, workspaces: [] };
  }
}

async function writeRegistry(registry: WorkspaceRegistry): Promise<void> {
  const file = workspaceRegistryFile();
  await mkdir(dirname(file), { recursive: true });
  await atomicJsonWrite(file, registry);
}

async function writeExternalManifest(workspace: WorkspaceSummary): Promise<void> {
  const file = workspaceManifestFile(workspace.rootPath);
  await mkdir(dirname(file), { recursive: true });
  await atomicJsonWrite(file, workspace);
}

async function atomicJsonWrite(file: string, value: unknown): Promise<void> {
  const temp = `${file}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temp, file);
}

async function scanDirectory(
  root: string,
  directory: string,
  depth: number,
  maxDepth: number,
  ignorePatterns: string[],
  includeIgnored: boolean,
): Promise<TreeEntry[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const result: TreeEntry[] = [];
  for (const entry of entries) {
    if (entry.isSymbolicLink() || isAlwaysHiddenWorkspaceEntry(entry.name) || isOfficeLockFileName(entry.name)) continue;
    const path = join(directory, entry.name);
    const info = await stat(path);
    const relativePath = normalizeRelative(relative(root, path));
    const ignored = isWorkspaceIgnored(relativePath, ignorePatterns);
    if (ignored && !includeIgnored) continue;
    if (entry.isDirectory()) {
      const children = depth < maxDepth ? await scanDirectory(root, path, depth + 1, maxDepth, ignorePatterns, includeIgnored) : [];
      const descendantIgnoredCount = children.reduce((total, child) => total + (child.ignored ? 1 : 0) + (child.descendantIgnoredCount ?? 0), 0);
      result.push({
        name: entry.name,
        path: relativePath,
        kind: "folder",
        updatedAt: info.mtime.toISOString(),
        ...(ignored ? { ignored: true } : {}),
        ...(descendantIgnoredCount ? { descendantIgnoredCount } : {}),
        hasChildren: children.length > 0,
        children,
      });
    } else if (entry.isFile()) {
      result.push({
        name: entry.name,
        path: relativePath,
        kind: "file",
        sizeBytes: info.size,
        updatedAt: info.mtime.toISOString(),
        ...(ignored ? { ignored: true } : {}),
      });
    }
  }
  return result.sort((left, right) => left.kind === right.kind ? left.name.localeCompare(right.name) : left.kind === "folder" ? -1 : 1);
}

async function visitWorkspaceFiles(root: string, directory: string, visitor: (relativePath: string, name: string) => void): Promise<void> {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isSymbolicLink() || isAlwaysHiddenWorkspaceEntry(entry.name) || isOfficeLockFileName(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await visitWorkspaceFiles(root, path, visitor);
    else if (entry.isFile()) visitor(normalizeRelative(relative(root, path)), entry.name);
  }
}

function contentTypeForExtension(extension: string | null): string {
  switch (extension) {
    case ".txt": return "text/plain";
    case ".md": case ".markdown": return "text/markdown";
    case ".json": return "application/json";
    case ".csv": return "text/csv";
    case ".html": case ".htm": return "text/html";
    case ".pdf": return "application/pdf";
    case ".docx": return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    case ".xlsx": return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    case ".pptx": return "application/vnd.openxmlformats-officedocument.presentationml.presentation";
    case ".png": return "image/png";
    case ".jpg": case ".jpeg": return "image/jpeg";
    case ".gif": return "image/gif";
    case ".svg": return "image/svg+xml";
    default: return "application/octet-stream";
  }
}

async function copyVisiblePath(source: string, destination: string): Promise<void> {
  const info = await stat(source).catch(() => null);
  if (!info) throw notFound("Library item not found.");
  if (lstatSync(source).isSymbolicLink()) throw new Error("Symbolic links cannot be copied into a Space.");
  if (info.isFile()) {
    await copyFile(source, destination, 1);
    return;
  }
  if (!info.isDirectory()) throw new Error("Only ordinary files and folders can be copied.");
  await mkdir(destination, { recursive: false });
  for (const entry of await readdir(source, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue;
    await copyVisiblePath(join(source, entry.name), join(destination, entry.name));
  }
}

async function nextAvailableDirectory(parent: string, segment: string): Promise<string> {
  let candidate = join(parent, segment);
  for (let index = 2; existsSync(candidate); index += 1) candidate = join(parent, `${segment}-${index}`);
  return candidate;
}

async function nextAvailableFile(desired: string): Promise<string> {
  if (!existsSync(desired)) return desired;
  const extension = extname(desired);
  const stem = basename(desired, extension);
  let index = 2;
  let candidate = join(dirname(desired), `${stem} (${index})${extension}`);
  while (existsSync(candidate)) candidate = join(dirname(desired), `${stem} (${index += 1})${extension}`);
  return candidate;
}

async function nextAvailablePath(desired: string): Promise<string> {
  if (!existsSync(desired)) return desired;
  const info = await stat(desired);
  return info.isDirectory() ? nextAvailableDirectory(dirname(desired), basename(desired)) : nextAvailableFile(desired);
}

function assertNoLinkSegments(root: string, path: string): void {
  const rel = relative(root, path);
  if (!rel || rel === ".") return;
  let cursor = root;
  for (const segment of rel.split(sep).filter(Boolean)) {
    cursor = join(cursor, segment);
    if (!existsSync(cursor)) return;
    if (lstatSync(cursor).isSymbolicLink()) throw new Error("Space paths cannot traverse symbolic links or junctions.");
  }
}

function safeUploadPath(value: string): string {
  const segments = normalizeRelative(value).split("/").filter(Boolean);
  if (!segments.length || segments.some((segment) => segment === "..")) throw new Error("Uploaded file path is not allowed.");
  return segments.map(safeFileName).join("/");
}

function safeFileName(value: string): string {
  const name = value.trim();
  if (!name || name === "." || name === ".." || /[\\/:*?"<>|\u0000-\u001f]/.test(name)) throw new Error("File name is not allowed.");
  const windowsStem = name.split(".")[0]?.toLocaleUpperCase() ?? "";
  if (/[. ]$/.test(name) || /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/.test(windowsStem)) {
    throw new Error("File name is reserved by Windows.");
  }
  return name.slice(0, 240);
}

function normalizeWorkspaceName(value: string): string {
  const name = value.replace(/\s+/g, " ").trim().slice(0, 80);
  if (!name) throw new Error("Space name is required.");
  return name;
}

function safeSegment(value: string): string {
  return value.toLocaleLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
}

function normalizeRelative(value: string): string {
  return value.trim().replace(/\\/g, "/").replace(/^(?:\.\/)+/, "").replace(/^\/+|\/+$/g, "");
}

function stableWorkspaceId(rootPath: string): string {
  const normalized = process.platform === "win32" ? resolve(rootPath).toLocaleLowerCase() : resolve(rootPath);
  return `ws-${createHash("sha256").update(normalized).digest("hex").slice(0, 16)}`;
}

function samePath(left: string, right: string): boolean {
  return process.platform === "win32" ? resolve(left).toLocaleLowerCase() === resolve(right).toLocaleLowerCase() : resolve(left) === resolve(right);
}

function assertLinkedWorkspaceStateSeparation(rootPath: string): void {
  if (linkedWorkspaceStateSeparated(rootPath)) return;
  throw new Error("Linked folders cannot contain, or be contained by, Workspace application data. Choose a different folder.");
}

function linkedWorkspaceStateSeparated(rootPath: string): boolean {
  const root = resolve(rootPath);
  const stateRoot = resolve(workspaceStateRoot());
  return !pathContains(root, stateRoot) && !pathContains(stateRoot, root);
}

function pathContains(parentPath: string, childPath: string): boolean {
  const parent = normalizeComparisonPath(parentPath);
  const child = normalizeComparisonPath(childPath);
  return child === parent || child.startsWith(`${parent}${sep}`);
}

function normalizeComparisonPath(value: string): string {
  const resolved = resolve(value).replace(/[\\/]+$/, "");
  return process.platform === "win32" ? resolved.toLocaleLowerCase() : resolved;
}

function looksLikeGoogleDrivePath(path: string): boolean {
  return /(^|[\\/])(google drive|my drive|shared drives|drivefs)([\\/]|$)/i.test(path);
}

function looksBinary(bytes: Buffer): boolean {
  const sample = bytes.subarray(0, Math.min(bytes.length, 8192));
  if (sample.includes(0)) return true;
  let controls = 0;
  for (const byte of sample) if (byte < 9 || (byte > 13 && byte < 32)) controls += 1;
  return sample.length > 0 && controls / sample.length > 0.1;
}

function isWorkspaceSummary(value: unknown): value is WorkspaceSummary {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<WorkspaceSummary>;
  return typeof item.id === "string" && typeof item.name === "string" && typeof item.rootPath === "string"
    && item.location?.kind === "local" && (item.location.storage === "managed" || item.location.storage === "linked")
    && typeof item.createdAt === "string" && typeof item.updatedAt === "string";
}

function assertId(value: string): void {
  if (!/^ws-[a-f0-9]{16}$/.test(value)) throw new Error("Invalid Space id.");
}

function notFound(message: string): Error {
  const error = new Error(message) as Error & { statusCode?: number };
  error.statusCode = 404;
  return error;
}
