import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { win32 } from "node:path";
import test from "node:test";

import {
  workspaceDesktopUserDataPath,
  workspaceDesktopStateOverride,
  workspaceDesktopUsesInstalledProductData,
} from "../desktop/src/user-data-path.js";

test("non-packaged desktop runs cannot default to installed Workspace state", () => {
  const appDataPath = "C:\\Users\\developer\\AppData\\Roaming";
  const development = workspaceDesktopUserDataPath({
    appDataPath,
    productName: "Workspace",
    useInstalledProductData: false,
    platform: "win32",
    currentDirectory: "C:\\source\\workspace",
  });
  const production = workspaceDesktopUserDataPath({
    appDataPath,
    productName: "Workspace",
    useInstalledProductData: true,
    platform: "win32",
    currentDirectory: "C:\\source\\workspace",
  });

  assert.equal(development, win32.join(appDataPath, "Workspace Development"));
  assert.equal(production, win32.join(appDataPath, "Workspace"));
  assert.notEqual(development.toLowerCase(), production.toLowerCase());
});

test("desktop user-data override remains explicit in development and production", () => {
  const common = {
    appDataPath: "/Users/developer/Library/Application Support",
    productName: "Workspace",
    override: "fixtures/desktop-state",
    platform: "darwin" as const,
    currentDirectory: "/source/workspace",
  };
  assert.equal(
    workspaceDesktopUserDataPath({ ...common, useInstalledProductData: false }),
    "/source/workspace/fixtures/desktop-state",
  );
  assert.equal(
    workspaceDesktopUserDataPath({ ...common, useInstalledProductData: true }),
    "/source/workspace/fixtures/desktop-state",
  );
});

test("the legacy host-injected desktop variable cannot opt a child into production state", () => {
  const productionState = "C:\\Users\\developer\\AppData\\Roaming\\Workspace";
  assert.equal(workspaceDesktopStateOverride({
    WORKSPACE_DESKTOP_USER_DATA_DIR: productionState,
  }), undefined);
  assert.equal(workspaceDesktopStateOverride({
    WORKSPACE_DESKTOP_USER_DATA_DIR: productionState,
    WORKSPACE_DESKTOP_STATE_DIR: "C:\\fixtures\\explicit-desktop-state",
  }), "C:\\fixtures\\explicit-desktop-state");
});

test("only an installer-owned packaged Windows app selects installed product data", () => {
  const executablePath = "C:\\build\\win-unpacked\\Workspace.exe";
  const expectedUninstaller = "C:\\build\\win-unpacked\\Uninstall Workspace.exe";

  assert.equal(workspaceDesktopUsesInstalledProductData({
    executablePath,
    productName: "Workspace",
    isPackaged: false,
    platform: "win32",
    fileExists: () => true,
  }), false, "source Electron stays isolated even if its directory happens to contain an uninstaller");
  assert.equal(workspaceDesktopUsesInstalledProductData({
    executablePath,
    productName: "Workspace",
    isPackaged: true,
    platform: "win32",
    fileExists: (path) => path === expectedUninstaller,
  }), true);
  assert.equal(workspaceDesktopUsesInstalledProductData({
    executablePath,
    productName: "Workspace",
    isPackaged: true,
    platform: "win32",
    fileExists: () => false,
  }), false, "both feed-less smoke output and feed-bearing release candidates stay isolated before installation");
});

test("packaged non-Windows identities retain their configured data directory", () => {
  assert.equal(workspaceDesktopUsesInstalledProductData({
    executablePath: "/Applications/Workspace.app/Contents/MacOS/Workspace",
    productName: "Workspace",
    isPackaged: true,
    platform: "darwin",
    fileExists: () => false,
  }), true);
});

test("desktop startup delegates installed-state selection to the fail-safe classifier", () => {
  const main = readFileSync(new URL("../desktop/src/main.ts", import.meta.url), "utf8");
  assert.match(main, /workspaceDesktopUsesInstalledProductData\(\{[\s\S]*?executablePath:\s*process\.execPath/);
  assert.match(main, /fileExists:\s*existsSync/);
  assert.match(main, /workspaceDesktopUserDataPath\(\{[\s\S]*?useInstalledProductData/);
});
