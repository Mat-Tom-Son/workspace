import { existsSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { extractFile, listPackage } from "@electron/asar";
import electronFuses from "@electron/fuses";

const { FuseV1Options, getCurrentFuseWire } = electronFuses;

const rootDir = resolve(fileURLToPath(new URL("..", import.meta.url)));
const outDir = join(rootDir, "out");
const failures = [];
const WasmTrapHandlersFuse = 8;
const fuseDisabled = "0".charCodeAt(0);
const fuseEnabled = "1".charCodeAt(0);

const packageDirArgument = readArgument("--package-dir");
const packageDir = packageDirArgument ? resolve(rootDir, packageDirArgument) : findPackageDir();
if (!packageDir) {
  console.error("Workspace package verification failed: no unpacked Workspace app was found under out/.");
  process.exit(1);
}
if (!existsSync(packageDir)) failures.push(`Packaged app directory does not exist: ${packageDir}.`);

const packagedPlatform = readArgument("--platform") ?? inferPackagedPlatform(packageDir);
const macAppBundleName = process.env.WORKSPACE_ALLOW_UNSIGNED_MAC_BUILD === "1"
  ? "Workspace Local Smoke.app"
  : "Workspace.app";
const macExecutableName = process.env.WORKSPACE_ALLOW_UNSIGNED_MAC_BUILD === "1"
  ? "Workspace Local Smoke"
  : "Workspace";
const appDir = packagedPlatform === "darwin" && !packageDir.endsWith(".app")
  ? join(packageDir, macAppBundleName)
  : packageDir;
const resourcesDir = packagedPlatform === "darwin"
  ? join(appDir, "Contents", "Resources")
  : join(appDir, "resources");
const binDir = packagedPlatform === "darwin" ? join(appDir, "Contents", "bin") : join(appDir, "bin");
const asarPath = join(resourcesDir, "app.asar");
const executablePath = packagedPlatform === "win32"
  ? join(appDir, "Workspace.exe")
  : packagedPlatform === "darwin"
    ? join(appDir, "Contents", "MacOS", macExecutableName)
    : join(appDir, "workspace");

assertPath(executablePath, "Workspace executable");
assertPath(asarPath, "app.asar");
assertPath(join(resourcesDir, "web-local", "index.html"), "renderer index");
assertPath(join(resourcesDir, "assets", "icon.png"), "desktop icon");
assertPath(join(binDir, "workspace"), "Workspace CLI shell shim");
if (packagedPlatform === "win32") {
  assertPath(join(binDir, "workspace.cmd"), "Workspace CLI command shim");
  assertPath(join(binDir, "workspace-cli.ps1"), "Workspace CLI PowerShell helper");
} else if (packagedPlatform === "darwin") {
  assertPath(join(binDir, "workspace-cli.jxa.js"), "Workspace CLI macOS helper");
  assertPath(join(resourcesDir, "icon.icns"), "macOS application icon");
  if (existsSync(join(binDir, "workspace")) && !(statSync(join(binDir, "workspace")).mode & 0o111)) {
    failures.push("Workspace CLI shell shim is not executable.");
  }
}

if (existsSync(executablePath) && (packagedPlatform === "win32" || packagedPlatform === "darwin")) {
  try {
    const wire = await getCurrentFuseWire(executablePath);
    const expectedFuses = new Map([
      [FuseV1Options.RunAsNode, fuseDisabled],
      [FuseV1Options.EnableCookieEncryption, fuseEnabled],
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable, fuseDisabled],
      [FuseV1Options.EnableNodeCliInspectArguments, fuseDisabled],
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation, fuseEnabled],
      [FuseV1Options.OnlyLoadAppFromAsar, fuseEnabled],
      [FuseV1Options.LoadBrowserProcessSpecificV8Snapshot, fuseDisabled],
      [FuseV1Options.GrantFileProtocolExtraPrivileges, fuseDisabled],
      [WasmTrapHandlersFuse, fuseEnabled],
    ]);
    for (const [fuse, expected] of expectedFuses) {
      const name = fuse === WasmTrapHandlersFuse ? "WasmTrapHandlers" : FuseV1Options[fuse];
      if (wire[fuse] !== expected) failures.push(`Electron fuse ${name} is not in the required state.`);
    }
  } catch (error) {
    failures.push(`Could not inspect Electron security fuses: ${formatError(error)}`);
  }
}

if (existsSync(asarPath)) {
  const entries = new Set(listPackage(asarPath).map(normalizeAsarPath));
  for (const required of [
    "/package.json",
    "/LICENSE",
    "/dist/desktop/desktop/src/main.js",
    "/dist/desktop/desktop/src/preload.cjs",
    "/dist/desktop/desktop/src/restricted-app-host.js",
    "/dist/desktop/desktop/src/restricted-app-preload.cjs",
    "/node_modules/@earendil-works/pi-coding-agent/package.json",
    "/node_modules/electron-updater/package.json",
    "/node_modules/jszip/package.json",
  ]) {
    if (!entries.has(required)) failures.push(`app.asar is missing ${required}.`);
  }
  for (const externalOnly of [
    "/bin/workspace.cmd",
    "/bin/workspace",
    "/bin/workspace-cli.ps1",
    "/bin/workspace-cli.jxa.js",
    "/desktop/cli/workspace.cmd",
    "/desktop/cli/workspace",
    "/desktop/cli/workspace-cli.ps1",
    "/desktop/cli/workspace-cli.jxa.js",
  ]) {
    if (entries.has(externalOnly)) failures.push(`CLI shim must remain outside app.asar: ${externalOnly}.`);
  }

  try {
    const packaged = JSON.parse(extractFile(asarPath, "package.json").toString("utf8"));
    if (packaged.name !== "workspace-desktop") failures.push(`Packaged npm name is ${packaged.name ?? "missing"}.`);
    if (packaged.productName !== "Workspace") failures.push(`Packaged product name is ${packaged.productName ?? "missing"}.`);
    const expectedBuildChannel = process.env.WORKSPACE_ALLOW_UNSIGNED_MAC_BUILD === "1" ? "mac-local-smoke" : "production";
    if (packaged.workspaceBuildChannel !== expectedBuildChannel) {
      failures.push(`Packaged build channel is ${packaged.workspaceBuildChannel ?? "missing"}; expected ${expectedBuildChannel}.`);
    }
  } catch (error) {
    failures.push(`Could not inspect packaged package.json: ${formatError(error)}`);
  }
}

if (failures.length) {
  console.error("Workspace package verification failed:\n");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`Verified packaged Workspace app at ${packageDir}.`);

function findPackageDir() {
  if (!existsSync(outDir)) return null;
  const builderDir = join(outDir, "builder");
  const builderCandidates = existsSync(builderDir)
    ? readdirSync(builderDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && (entry.name === "win-unpacked" || /^mac(?:-|$)/.test(entry.name)))
      .map((entry) => join(builderDir, entry.name))
    : [];
  const candidates = [...builderCandidates, ...readdirSync(outDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^Workspace-(?:win32|darwin|linux)-/.test(entry.name))
    .map((entry) => join(outDir, entry.name))]
    .filter((candidate) => existsSync(candidate));
  return candidates[0] ?? null;
}

function inferPackagedPlatform(packagePath) {
  if (packagePath.endsWith(".app") || existsSync(join(packagePath, "Workspace.app")) || existsSync(join(packagePath, "Workspace Local Smoke.app"))) return "darwin";
  if (existsSync(join(packagePath, "Workspace.exe"))) return "win32";
  return process.platform;
}

function readArgument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function assertPath(path, label) {
  if (!existsSync(path)) failures.push(`Missing ${label}: ${path}.`);
}

function normalizeAsarPath(path) {
  const normalized = path.replaceAll("\\", "/");
  return normalized.startsWith("/") ? normalized : `/${normalized}`;
}

function formatError(error) {
  return error instanceof Error ? error.message : String(error);
}
