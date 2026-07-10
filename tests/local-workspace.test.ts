import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";

import { createWorkspaceCheckpoint, restoreWorkspaceCheckpoint } from "../src/local/history.js";
import { copyResourcesToWorkspace, listResourceTree, uploadResourceFiles } from "../src/local/resources.js";
import { configureWorkspaceStateRoot, resourceLibraryRoot } from "../src/local/state-paths.js";
import {
  createManagedWorkspace,
  listWorkspaces,
  readWorkspaceTextFile,
  removeWorkspace,
  registerLinkedWorkspace,
  resolveWorkspacePath,
  scanWorkspaceTree,
  writeUploadedFiles,
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

test("managed Spaces keep app metadata outside user folders", async () => {
  const workspace = await createManagedWorkspace("Personal Space", contentRoot);
  const uploaded = await writeUploadedFiles(workspace.rootPath, "", [{
    fileName: "notes.txt",
    relativePath: "Notes/notes.txt",
    data: Buffer.from("hello workspace\n"),
  }]);

  assert.equal(uploaded[0]?.path, "Notes/notes.txt");
  assert.equal((await readWorkspaceTextFile(workspace.rootPath, "Notes/notes.txt")).text, "hello workspace\n");
  assert.equal((await scanWorkspaceTree(workspace.rootPath))[0]?.name, "Notes");
  assert.equal(existsSync(join(workspace.rootPath, ".workspace")), false);
  assert.equal((await listWorkspaces()).length, 1);
  assert.throws(() => resolveWorkspacePath(workspace.rootPath, "../outside.txt"), /escapes/);
});

test("linked Google Drive folders are detected without adding metadata", async () => {
  const linkedRoot = join(sandbox, "Google Drive", "My Drive", "Project");
  await mkdir(linkedRoot, { recursive: true });
  const existingFile = join(linkedRoot, "existing.txt");
  await writeFile(existingFile, "original", "utf8");
  const workspace = await registerLinkedWorkspace(linkedRoot);
  assert.equal(workspace.rootPath, linkedRoot);
  assert.equal(workspace.location.storage, "linked");
  assert.equal(workspace.location.providerHint, "google-drive");
  assert.equal(await readFile(existingFile, "utf8"), "original");
  assert.equal(existsSync(join(linkedRoot, ".workspace")), false);
  assert.equal((await scanWorkspaceTree(linkedRoot))[0]?.path, "existing.txt");
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
  await writeFile(file, "version two", "utf8");

  const result = await restoreWorkspaceCheckpoint(workspace.rootPath, checkpoint.checkpointId);
  assert.equal(result.restored, true);
  assert.equal(await readFile(file, "utf8"), "version one");
  assert.equal(existsSync(join(workspace.rootPath, "history")), false);
});
