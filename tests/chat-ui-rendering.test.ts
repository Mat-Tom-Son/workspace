import assert from "node:assert/strict";
import test from "node:test";

import { chatDraftStorageKey } from "../web-local/src/lib/format.js";
import { collectWorkspacePathCandidates, workspacePathCandidate } from "../web-local/src/lib/workspace-path-links.js";

test("blank Chat tabs keep independent drafts while saved conversations keep stable keys", () => {
  const firstDraft = chatDraftStorageKey("space-1", null, "chat:space-1:draft:first");
  const secondDraft = chatDraftStorageKey("space-1", null, "chat:space-1:draft:second");

  assert.notEqual(firstDraft, secondDraft);
  assert.equal(
    chatDraftStorageKey("space-1", "conversation-1", "chat:space-1:draft:first"),
    chatDraftStorageKey("space-1", "conversation-1", "chat:space-1:draft:second"),
  );
  assert.equal(chatDraftStorageKey("space-1", null), "workspace.chat-draft:space-1:new-chat");
});

test("assistant Markdown discovers relative Space links and common code paths", () => {
  const candidates = collectWorkspacePathCandidates([
    "Open [App](web-local/src/App.tsx) and [product notes](<docs/Product notes.md>).",
    "Then inspect `src/local/server.ts:42:7`, README.md#L12, and scripts/release.ps1.",
    "Leave [the web](https://example.com/docs/file.ts) external.",
  ].join("\n"));

  assert.deepEqual(candidates, [
    "src/local/server.ts",
    "web-local/src/App.tsx",
    "docs/Product notes.md",
    "README.md",
    "scripts/release.ps1",
  ]);
  assert.equal(workspacePathCandidate("./web-local/src/App.tsx:120", { allowSpaces: true }), "web-local/src/App.tsx");
  assert.equal(workspacePathCandidate("README.md#installation", { allowSpaces: true }), "README.md");
  assert.equal(workspacePathCandidate("https://example.com/file.ts", { allowSpaces: true }), null);
  assert.equal(workspacePathCandidate("../outside.ts", { allowSpaces: true }), null);
});
