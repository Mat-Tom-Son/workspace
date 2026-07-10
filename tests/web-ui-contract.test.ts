import assert from "node:assert/strict";
import test from "node:test";

import { assistantNavigation, primaryNavigation, welcomeActions } from "../web-local/src/ui-contract.js";

test("Workspace navigation expresses the Space mental model", () => {
  assert.deepEqual(primaryNavigation.map(({ id, label }) => [id, label]), [
    ["space", "Space"],
    ["chats", "Chats"],
    ["library", "Library"],
    ["history", "History"],
  ]);
  assert.deepEqual(assistantNavigation.map(({ id, label }) => [id, label]), [
    ["setup", "Setup"],
    ["skills", "Skills"],
    ["extensions", "Extensions"],
  ]);
  assert.deepEqual(welcomeActions, {
    create: "Create a Space",
    linkFolder: "Turn an existing folder into a Space",
  });
});
