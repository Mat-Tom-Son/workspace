import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, before, test } from "node:test";

import { createWorkspaceCheckpoint, restoreWorkspaceCheckpoint } from "../src/local/history.js";
import { copyResourcesToWorkspace, listResourceTree, uploadResourceFiles } from "../src/local/resources.js";
import {
  configureWorkspaceStateRoot,
  legacyWorkspaceManifestFile,
  resourceLibraryRoot,
  workspaceManifestFile,
} from "../src/local/state-paths.js";
import {
  createManagedWorkspace,
  listWorkspaces,
  readWorkspaceTextFile,
  removeWorkspace,
  renameWorkspace,
  registerLinkedWorkspace,
  resolveWorkspacePath,
  scanWorkspaceTree,
  writeUploadedFiles,
  writeWorkspaceTextFile,
} from "../src/local/workspace.js";

let sandbox = "";
let stateRoot = "";
let contentRoot = "";

before(async () => {
  sandbox = await mkdtemp(join(tmpdir(), "workspace-local-test-"));
  stateRoot = join(sandbox, "state");
  contentRoot = join(sandbox, "content");
  configureWorkspaceStateRoot(stateRoot);
});

after(async () => {
  configureWorkspaceStateRoot(undefined);
  await rm(sandbox, { recursive: true, force: true });
});

test("managed Spaces keep portable identity metadata inside a hidden .workspace folder", async () => {
  const workspace = await createManagedWorkspace("Personal Space", contentRoot);
  const initialManifest = JSON.parse(await readFile(workspaceManifestFile(workspace.rootPath), "utf8")) as Record<string, unknown>;
  initialManifest.futurePortableField = { retained: true };
  await writeFile(workspaceManifestFile(workspace.rootPath), `${JSON.stringify(initialManifest, null, 2)}\n`, "utf8");
  const uploaded = await writeUploadedFiles(workspace.rootPath, "", [{
    fileName: "notes.txt",
    relativePath: "Notes/notes.txt",
    data: Buffer.from("hello workspace\n"),
  }]);

  assert.equal(uploaded[0]?.path, "Notes/notes.txt");
  assert.equal((await readWorkspaceTextFile(workspace.rootPath, "Notes/notes.txt")).text, "hello workspace\n");
  assert.equal((await scanWorkspaceTree(workspace.rootPath))[0]?.name, "Notes");
  const currentWorkspace = (await listWorkspaces()).find((item) => item.id === workspace.id);
  assert.ok(currentWorkspace);
  assert.equal(existsSync(workspaceManifestFile(workspace.rootPath)), true);
  assert.deepEqual(JSON.parse(await readFile(workspaceManifestFile(workspace.rootPath), "utf8")), {
    version: 1,
    id: currentWorkspace.id,
    name: currentWorkspace.name,
    createdAt: currentWorkspace.createdAt,
    updatedAt: currentWorkspace.updatedAt,
    futurePortableField: { retained: true },
  });
  assert.equal((await listWorkspaces()).length, 1);
  assert.throws(() => resolveWorkspacePath(workspace.rootPath, "../outside.txt"), /escapes/);
});

test("linked Google Drive folders keep portable metadata hidden from Files", async () => {
  const linkedRoot = join(sandbox, "Google Drive", "My Drive", "Project");
  await mkdir(linkedRoot, { recursive: true });
  await mkdir(join(linkedRoot, ".pi", "skills"), { recursive: true });
  await writeFile(join(linkedRoot, ".pi", "skills", "private.md"), "hidden capability", "utf8");
  const existingFile = join(linkedRoot, "existing.txt");
  await writeFile(existingFile, "original", "utf8");
  const workspace = await registerLinkedWorkspace(linkedRoot);
  assert.equal(workspace.rootPath, linkedRoot);
  assert.equal(workspace.location.storage, "linked");
  assert.equal(workspace.location.providerHint, "google-drive");
  assert.equal(await readFile(existingFile, "utf8"), "original");
  assert.equal(existsSync(workspaceManifestFile(linkedRoot)), true);
  assert.equal((await scanWorkspaceTree(linkedRoot))[0]?.path, "existing.txt");
});

test("a moved linked folder preserves its manifest identity when it is relinked", async () => {
  const originalRoot = join(sandbox, "portable-space-original");
  const movedRoot = join(sandbox, "portable-space-moved");
  await mkdir(originalRoot, { recursive: true });
  const original = await registerLinkedWorkspace(originalRoot);
  await rename(originalRoot, movedRoot);

  const relinked = await registerLinkedWorkspace(movedRoot);
  assert.equal(relinked.id, original.id);
  assert.equal(relinked.name, original.name);
  assert.equal(relinked.rootPath, movedRoot);
  assert.equal((await listWorkspaces()).filter((workspace) => workspace.id === original.id).length, 1);

  const duplicateRoot = join(sandbox, "portable-space-copy");
  await mkdir(join(duplicateRoot, ".workspace"), { recursive: true });
  await writeFile(workspaceManifestFile(duplicateRoot), await readFile(workspaceManifestFile(movedRoot), "utf8"), "utf8");
  await assert.rejects(registerLinkedWorkspace(duplicateRoot), /identity is already linked to another folder/);
});

test("legacy external manifests migrate non-destructively into .workspace", async () => {
  const linkedRoot = join(sandbox, "legacy-manifest-space");
  await mkdir(linkedRoot, { recursive: true });
  const legacyFile = legacyWorkspaceManifestFile(linkedRoot);
  await mkdir(dirname(legacyFile), { recursive: true });
  const legacyManifest = {
    id: "ws-0123456789abcdef",
    name: "Portable legacy identity",
    rootPath: linkedRoot,
    location: { kind: "local", storage: "linked" },
    createdAt: "2025-01-02T03:04:05.000Z",
    updatedAt: "2025-01-02T03:04:05.000Z",
  };
  await writeFile(legacyFile, `${JSON.stringify(legacyManifest)}\n`, "utf8");

  const workspace = await registerLinkedWorkspace(linkedRoot);
  assert.equal(workspace.id, legacyManifest.id);
  assert.equal(workspace.name, legacyManifest.name);
  assert.equal(existsSync(legacyFile), true);
  assert.equal(existsSync(workspaceManifestFile(linkedRoot)), true);
});

test("Space listing survives when portable metadata can no longer be maintained", async () => {
  const linkedRoot = join(sandbox, "metadata-became-unwritable");
  await mkdir(linkedRoot, { recursive: true });
  const workspace = await registerLinkedWorkspace(linkedRoot);
  await rm(join(linkedRoot, ".workspace"), { recursive: true, force: true });
  await writeFile(join(linkedRoot, ".workspace"), "temporarily blocked", "utf8");

  assert.equal((await listWorkspaces()).some((item) => item.id === workspace.id), true);
});

test("blocked portable metadata does not leave a failed linked registration in the registry", async () => {
  const linkedRoot = join(sandbox, "blocked-registration-metadata");
  await mkdir(linkedRoot, { recursive: true });
  await writeFile(join(linkedRoot, ".workspace"), "blocks the metadata directory", "utf8");

  await assert.rejects(registerLinkedWorkspace(linkedRoot));
  assert.equal((await listWorkspaces()).some((item) => item.rootPath === linkedRoot), false);
});

test("failed portable writes do not apply a Space rename", async () => {
  const linkedRoot = join(sandbox, "blocked-rename-metadata");
  await mkdir(linkedRoot, { recursive: true });
  const workspace = await registerLinkedWorkspace(linkedRoot);
  await rm(join(linkedRoot, ".workspace"), { recursive: true, force: true });
  await writeFile(join(linkedRoot, ".workspace"), "blocks the metadata directory", "utf8");

  await assert.rejects(renameWorkspace(workspace.id, "Failed rename"));
  const current = (await listWorkspaces()).find((item) => item.id === workspace.id);
  assert.equal(current?.name, workspace.name);
  assert.equal(current?.updatedAt, workspace.updatedAt);
});

test("failed portable writes do not rebind a moved Space identity", async () => {
  const originalRoot = join(sandbox, "blocked-rebind-original");
  const movedRoot = join(sandbox, "blocked-rebind-moved");
  await mkdir(originalRoot, { recursive: true });
  const workspace = await registerLinkedWorkspace(originalRoot);
  const portableManifest = await readFile(workspaceManifestFile(originalRoot), "utf8");
  await rename(originalRoot, movedRoot);
  const legacyFile = legacyWorkspaceManifestFile(movedRoot);
  await mkdir(dirname(legacyFile), { recursive: true });
  await writeFile(legacyFile, portableManifest, "utf8");
  await rm(join(movedRoot, ".workspace"), { recursive: true, force: true });
  await writeFile(join(movedRoot, ".workspace"), "blocks the metadata directory", "utf8");

  await assert.rejects(registerLinkedWorkspace(movedRoot));
  await rm(join(movedRoot, ".workspace"), { force: true });
  await mkdir(join(movedRoot, ".workspace"), { recursive: true });
  await writeFile(workspaceManifestFile(movedRoot), portableManifest, "utf8");
  await rename(movedRoot, originalRoot);
  const current = (await listWorkspaces()).find((item) => item.id === workspace.id);
  assert.equal(current?.rootPath, originalRoot);
});

test("a content edit succeeds when post-mutation portable metadata maintenance is blocked", async () => {
  const linkedRoot = join(sandbox, "blocked-touch-metadata");
  await mkdir(linkedRoot, { recursive: true });
  await writeFile(join(linkedRoot, "draft.txt"), "before", "utf8");
  const workspace = await registerLinkedWorkspace(linkedRoot);
  await rm(join(linkedRoot, ".workspace"), { recursive: true, force: true });
  await writeFile(join(linkedRoot, ".workspace"), "blocks the metadata directory", "utf8");

  await writeWorkspaceTextFile(linkedRoot, "draft.txt", "after");
  assert.equal(await readFile(join(linkedRoot, "draft.txt"), "utf8"), "after");
  const current = (await listWorkspaces()).find((item) => item.id === workspace.id);
  assert.equal(current?.updatedAt, workspace.updatedAt);
});

test("linked folders cannot overlap Workspace application state", async () => {
  await mkdir(stateRoot, { recursive: true });
  await assert.rejects(registerLinkedWorkspace(stateRoot), /cannot contain, or be contained by/);
  await assert.rejects(registerLinkedWorkspace(sandbox), /cannot contain, or be contained by/);
  await assert.rejects(createWorkspaceCheckpoint(sandbox), /does not contain Workspace application data/);
});

test("managed Space removal refuses a mismatched managed-content boundary", async () => {
  const workspace = await createManagedWorkspace("Removal guard", contentRoot);
  await assert.rejects(removeWorkspace(workspace.id, join(sandbox, "different-managed-root")), /only delete a managed Space/);
  assert.equal(existsSync(workspace.rootPath), true);
});

test("Library items copy into a visible From Library folder", async () => {
  assert.equal(resourceLibraryRoot(), join(stateRoot, "resources"));
  const workspace = await createManagedWorkspace("Library Target", contentRoot);
  await uploadResourceFiles("", [{ fileName: "template.md", data: Buffer.from("# Template\n") }]);
  assert.equal((await listResourceTree())[0]?.path, "template.md");
  const copied = await copyResourcesToWorkspace(workspace.rootPath, ["template.md"], "From Library");
  assert.deepEqual(copied, ["From Library/template.md"]);
  assert.equal(await readFile(join(workspace.rootPath, "From Library", "template.md"), "utf8"), "# Template\n");
});

test("restore points live externally and can restore workspace files", async () => {
  const workspace = await createManagedWorkspace("History Target", contentRoot);
  const file = join(workspace.rootPath, "draft.txt");
  await writeFile(file, "version one", "utf8");
  const checkpoint = await createWorkspaceCheckpoint(workspace.rootPath, { label: "Version one" });
  assert.equal(checkpoint.files.some((entry) => entry.path.startsWith(".workspace/")), false);
  assert.equal(checkpoint.directories.some((entry) => entry === ".workspace" || entry.startsWith(".workspace/")), false);
  await writeFile(file, "version two", "utf8");

  const result = await restoreWorkspaceCheckpoint(workspace.rootPath, checkpoint.checkpointId);
  assert.equal(result.restored, true);
  assert.equal(await readFile(file, "utf8"), "version one");
  assert.equal(existsSync(join(workspace.rootPath, "history")), false);
});
