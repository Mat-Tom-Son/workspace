import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import test from "node:test";

import { hashAppPlatformArtifact } from "../src/local/agent/app-platform-artifact.js";
import { canonicalizeJson, computeDeclarationDigest } from "../src/local/agent/app-platform-contract.js";

interface ConformanceFixture {
  formatVersion: 1;
  declarations: Array<{ name: string; value: unknown; canonical: string; digest: string }>;
  artifacts: Array<{
    name: string;
    entries: Array<{ path: string; bytesBase64: string }>;
    digest: string;
  }>;
}

const fixturePath = resolve("tests/fixtures/app-platform-digest-conformance-v1.json");

test("language-neutral digest vectors agree with the App-platform implementation", async () => {
  const fixture = JSON.parse(await readFile(fixturePath, "utf8")) as ConformanceFixture;
  assert.equal(fixture.formatVersion, 1);
  for (const vector of fixture.declarations) {
    assert.equal(canonicalizeJson(vector.value), vector.canonical, vector.name);
    assert.equal(computeDeclarationDigest(vector.value), vector.digest, vector.name);
  }
  for (const vector of fixture.artifacts) {
    const entries = vector.entries.map((entry) => ({
      path: entry.path,
      bytes: Buffer.from(entry.bytesBase64, "base64"),
    }));
    assert.equal(hashAppPlatformArtifact(entries), vector.digest, vector.name);
    assert.equal(hashAppPlatformArtifact([...entries].reverse()), vector.digest, `${vector.name} reversed`);
  }
});

test("an implementation-independent executable agrees with every digest vector", () => {
  const result = spawnSync(
    process.execPath,
    [resolve("scripts/verify-app-platform-conformance.mjs"), fixturePath],
    { cwd: process.cwd(), encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /verified 3 declaration and 4 artifact vectors/);
});
