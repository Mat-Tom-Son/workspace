import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const rootDir = resolve(fileURLToPath(new URL("..", import.meta.url)));

test("Windows release configuration points at the public Workspace update feed", () => {
  const packageJson = JSON.parse(read("package.json"));
  const require = createRequire(import.meta.url);
  const builder = require(join(rootDir, "electron-builder.desktop.cjs"));

  assert.equal(packageJson.repository.url, "https://github.com/Mat-Tom-Son/workspace.git");
  assert.equal(packageJson.dependencies["electron-updater"], "6.8.9");
  assert.match(packageJson.scripts["desktop:make"], /electron-builder/);
  assert.doesNotMatch(packageJson.scripts["desktop:make"], /prepackaged/);
  assert.deepEqual(builder.publish, [{
    provider: "github",
    owner: "Mat-Tom-Son",
    repo: "workspace",
    releaseType: "release",
  }]);
  assert.equal(builder.electronFuses.runAsNode, false);
  assert.equal(builder.electronFuses.onlyLoadAppFromAsar, true);
  assert.equal(builder.win.verifyUpdateCodeSignature, false);
  assert.equal(builder.nsis.differentialPackage, true);
});

test("Updater and release workflow keep credentials out of the application", () => {
  const updaterSource = read("desktop/src/updater.ts");
  const workflow = read(".github/workflows/windows-release.yml");

  assert.doesNotMatch(updaterSource, /setFeedURL/);
  assert.doesNotMatch(updaterSource, /GH_TOKEN|GITHUB_TOKEN/);
  assert.match(updaterSource, /checkForUpdates/);
  assert.match(updaterSource, /quitAndInstall/);
  assert.match(workflow, /tags:/);
  assert.match(workflow, /WIN_CSC_LINK/);
  assert.match(workflow, /WORKSPACE_TRUSTED_CODE_SIGNING/);
  assert.match(workflow, /latest\.yml/);
  assert.match(workflow, /docs\/releases\/\$version\.md/);
  assert.match(workflow, /--notes-file \$notes/);
  assert.doesNotMatch(workflow, /--generate-notes/);
  assert.match(workflow, /--draft/);
  assert.match(workflow, /--draft=false/);
});

function read(path: string): string {
  return readFileSync(join(rootDir, path), "utf8");
}
