import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const main = await readFile(new URL("../desktop/src/main.ts", import.meta.url), "utf8");
const preload = await readFile(new URL("../desktop/src/preload.cts", import.meta.url), "utf8");

test("Darwin file menus require the trusted main renderer and canonical Space validation", () => {
  assert.match(
    main,
    /ipcMain\.handle\("workspace:workspace:popup-file-menu"[\s\S]*?assertTrustedMainRenderer\(event\)[\s\S]*?process\.platform !== "darwin"[\s\S]*?parseNativeFileMenuRequest\(value\)[\s\S]*?validateNativeFileMenuEntry\(request\)[\s\S]*?popupNativeFileMenu\(request\)/,
  );
  assert.match(main, /validateNativeFileMenuEntry[\s\S]*?resolveWorkspaceItem\(request\.workspaceId, request\.path\)/);
});

test("Finder and Open Recent recreate the Mac window before routing a queued Space", () => {
  assert.match(
    main,
    /drainPendingMacOpenPaths[\s\S]*?while \(pendingMacOpenPaths\.length\)[\s\S]*?await ensureMainWindow\(\)[\s\S]*?registeredSpaceIdForOpenPath\(path\)[\s\S]*?workspace:workspace:open-space/,
  );
  assert.match(main, /registeredSpaceIdForOpenPath[\s\S]*?info\.isDirectory\(\)[\s\S]*?realpath\(workspace\.rootPath\)[\s\S]*?samePath\(openedRoot, registeredRoot\)/);
  assert.match(main, /request = \{ token: randomUUID\(\), workspaceId \}[\s\S]*?workspace:workspace:open-space/);
  assert.match(preload, /deliveredTokens[\s\S]*?workspace:workspace:take-open-space[\s\S]*?then\(deliver\)/);
});

test("the interactive local API is app-lifetime state rather than BrowserWindow state", () => {
  assert.match(main, /localApiLifetime = new AppLifetimeResource/);
  assert.match(main, /createMainWindow[\s\S]*?ensureInteractiveLocalApi\(\)/);
  assert.doesNotMatch(main, /mainWindow\.on\("closed"[\s\S]{0,300}localApiLifetime\.close/);
  assert.match(main, /shutdown[\s\S]*?localApiLifetime\.close\(\)/);
});

test("ad hoc Mac smoke builds use a separate identity and never start the production updater", () => {
  assert.match(main, /localMacSmokeProductName = "Workspace Local Smoke"/);
  assert.match(main, /localMacSmokeBuild[\s\S]*?packagedBuildChannel\(\) === "mac-local-smoke"/);
  assert.match(main, /packagedBuildChannel[\s\S]*?workspaceBuildChannel[\s\S]*?Historical production packages/);
  assert.match(main, /configureUpdater[\s\S]*?workspaceUpdater \|\| localMacSmokeBuild/);
});
