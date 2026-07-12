import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();

test("Claude Code imports the canonical Codex contributor contract", async () => {
  const [claude, agents] = await Promise.all([
    readFile(join(root, "CLAUDE.md"), "utf8"),
    readFile(join(root, "AGENTS.md"), "utf8"),
  ]);

  assert.match(claude, /^@AGENTS\.md$/m);
  assert.match(claude, /canonical contributor contract/i);
  assert.match(agents, /Harness parity/);
  assert.doesNotMatch(claude, /npm run desktop:make/);
});

test("public and contributor docs route management behavior to one guide", async () => {
  const files = ["README.md", "AGENTS.md", "CONTRIBUTING.md", "docs/product-model.md", "docs/architecture.md"];
  const contents = await Promise.all(files.map((file) => readFile(join(root, file), "utf8")));
  for (const content of contents) {
    assert.match(content, /management-layer\.md/, "Each canonical doc must link the management guide.");
  }
});
