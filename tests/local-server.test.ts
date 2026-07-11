import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { startLocalApi } from "../src/local/server.js";

test("local API covers Space files, the Library, and external restore points", async () => {
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
      body: JSON.stringify({ name: "API Space" }),
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
    const uploadedLibraryItem = await json(`${api.origin}/api/resources/upload`, { method: "POST", body: resources }) as { uploaded: Array<{ path: string }> };
    assert.equal(uploadedLibraryItem.uploaded[0]?.path, "reference.txt");
    const libraryTree = await json(`${api.origin}/api/resources/tree`) as { tree: Array<{ path: string }> };
    assert.equal(libraryTree.tree[0]?.path, "reference.txt");
    const copiedLibraryItem = await json(`${api.origin}/api/resources/copy-to-workspace`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ workspaceId: created.workspace.id, paths: ["reference.txt"] }),
    }) as { copied: string[] };
    assert.deepEqual(copiedLibraryItem.copied, ["From Library/reference.txt"]);
    const libraryPreview = await json(`${api.origin}/api/workspaces/${created.workspace.id}/file?path=From%20Library%2Freference.txt`) as { text: string };
    assert.equal(libraryPreview.text, "reference");

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

test("chat streams snapshot running state and survive a throwing desktop activity observer", async () => {
  const sandbox = await mkdtemp(join(tmpdir(), "workspace-background-chat-test-"));
  const activityCounts: number[] = [];
  const api = await startLocalApi({
    port: 0,
    stateBase: join(sandbox, "state"),
    workspaceBase: join(sandbox, "content"),
    loadEnv: false,
    onAgentTurnActivity(activeTurns) {
      activityCounts.push(activeTurns);
      throw new Error("simulated desktop observer failure");
    },
  });
  const streamController = new AbortController();
  try {
    const created = await json(`${api.origin}/api/workspaces`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Background Space" }),
    }) as { workspace: { id: string } };
    const createdConversation = await json(`${api.origin}/api/workspaces/${created.workspace.id}/conversations`, {
      method: "POST",
    }) as { conversation: { id: string } };
    const conversationId = createdConversation.conversation.id;
    const streamResponse = await fetch(
      `${api.origin}/api/workspaces/${created.workspace.id}/conversations/${conversationId}/events`,
      { signal: streamController.signal },
    );
    assert.equal(streamResponse.ok, true);
    const streamEvents: Array<{ type?: string; running?: boolean }> = [];
    const pump = pumpSseEvents(streamResponse, streamEvents).catch((error: unknown) => {
      if (!(error instanceof DOMException && error.name === "AbortError")) throw error;
    });

    await waitFor(() => streamEvents.some((event) => event.type === "turn_state" && event.running === false));
    const firstPost = await fetch(`${api.origin}/api/workspaces/${created.workspace.id}/conversations/${conversationId}/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: "Reply briefly." }),
    });
    assert.equal(firstPost.status, 202, await firstPost.text());
    await waitFor(() => streamEvents.some((event) => event.type === "turn_state" && event.running === true));
    await waitFor(() => activityCounts.length >= 2 && activityCounts.at(-1) === 0);
    assert.deepEqual(activityCounts.slice(0, 2), [1, 0]);

    // If the observer exception escaped changeTurnCount, the running key would
    // remain stranded and this second turn would return 409.
    const secondPost = await fetch(`${api.origin}/api/workspaces/${created.workspace.id}/conversations/${conversationId}/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: "Try once more." }),
    });
    assert.equal(secondPost.status, 202, await secondPost.text());
    await waitFor(() => activityCounts.length >= 4 && activityCounts.at(-1) === 0);
    assert.deepEqual(activityCounts.slice(2, 4), [1, 0]);

    streamController.abort();
    await pump;
  } finally {
    streamController.abort();
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

async function pumpSseEvents(response: Response, events: Array<{ type?: string; running?: boolean }>): Promise<void> {
  const reader = response.body?.getReader();
  assert.ok(reader);
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return;
    buffer += decoder.decode(value, { stream: true });
    let boundary = buffer.indexOf("\n\n");
    while (boundary >= 0) {
      const frame = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      const data = frame
        .split(/\r?\n/)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trimStart())
        .join("\n");
      if (data) events.push(JSON.parse(data) as { type?: string; running?: boolean });
      boundary = buffer.indexOf("\n\n");
    }
  }
}

async function waitFor(predicate: () => boolean, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("Timed out waiting for background chat state.");
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }
}
