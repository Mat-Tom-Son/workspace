import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { startLocalApi } from "../src/local/server.js";

test("local API covers workspace files, resources, and external restore points", async () => {
  const sandbox = await mkdtemp(join(tmpdir(), "workspace-api-test-"));
  const api = await startLocalApi({
    port: 0,
    stateBase: join(sandbox, "state"),
    workspaceBase: join(sandbox, "content"),
    loadEnv: false,
  });
  try {
    assert.deepEqual(await json(`${api.origin}/api/bootstrap`), {
      workspaces: [],
      agent: { ready: true, configured: false, provider: null, model: null, piVersion: null, projectTrusted: false, error: null },
    });

    const created = await json(`${api.origin}/api/workspaces`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "API Workspace" }),
    }) as { workspace: { id: string } };

    const files = new FormData();
    files.set("targetFolderPath", "");
    files.set("relativePaths", JSON.stringify(["Notes/readme.md"]));
    files.append("files", new Blob(["# Hello\n"]), "readme.md");
    await ok(`${api.origin}/api/workspaces/${created.workspace.id}/upload-local-files`, { method: "POST", body: files });
    const preview = await json(`${api.origin}/api/workspaces/${created.workspace.id}/file?path=Notes%2Freadme.md`) as { text: string };
    assert.equal(preview.text, "# Hello\n");

    const resources = new FormData();
    resources.set("targetFolderPath", "");
    resources.set("relativePaths", JSON.stringify(["reference.txt"]));
    resources.append("files", new Blob(["reference"]), "reference.txt");
    await ok(`${api.origin}/api/resources/upload`, { method: "POST", body: resources });
    await ok(`${api.origin}/api/resources/copy-to-workspace`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ workspaceId: created.workspace.id, paths: ["reference.txt"], targetFolder: "Resources" }),
    });

    const checkpoint = await json(`${api.origin}/api/workspaces/${created.workspace.id}/history/checkpoints`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ label: "API snapshot" }),
    }) as { checkpoint: { fileCount: number } };
    assert.equal(checkpoint.checkpoint.fileCount, 2);
  } finally {
    await api.close();
    await rm(sandbox, { recursive: true, force: true });
  }
});

test("desktop linked folders require the exact one-shot picker grant", async () => {
  const sandbox = await mkdtemp(join(tmpdir(), "workspace-desktop-grant-test-"));
  const linkedRoot = join(sandbox, "linked");
  const stateRoot = join(sandbox, "state");
  await mkdir(linkedRoot, { recursive: true });
  let available = true;
  const api = await startLocalApi({
    port: 0,
    appMode: "desktop",
    stateBase: stateRoot,
    sessionToken: "desktop-session",
    loadEnv: false,
    localFolderGrantProvider: {
      consumeLocalFolderGrant(input) {
        assert.deepEqual(input, { rootPath: linkedRoot, grantId: "grant-1" });
        if (!available) return false;
        available = false;
        return true;
      },
    },
  });
  try {
    const headers = { "content-type": "application/json", "x-workspace-session": "desktop-session" };
    const first = await fetch(`${api.origin}/api/workspaces/local-folder`, {
      method: "POST",
      headers,
      body: JSON.stringify({ rootPath: linkedRoot, folderGrantId: "grant-1" }),
    });
    assert.equal(first.status, 201, await first.text());
    const replay = await fetch(`${api.origin}/api/workspaces/local-folder`, {
      method: "POST",
      headers,
      body: JSON.stringify({ rootPath: linkedRoot, folderGrantId: "grant-1" }),
    });
    assert.equal(replay.status, 403);
  } finally {
    await api.close();
    await rm(sandbox, { recursive: true, force: true });
  }
});

async function json(url: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(url, init);
  const text = await response.text();
  assert.equal(response.ok, true, text);
  return JSON.parse(text) as unknown;
}

async function ok(url: string, init?: RequestInit): Promise<void> {
  const response = await fetch(url, init);
  const text = await response.text();
  assert.equal(response.ok, true, text);
}
