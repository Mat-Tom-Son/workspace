import { existsSync, readdirSync } from "node:fs";
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

const resourcesDir = join(packageDir, "resources");
const asarPath = join(resourcesDir, "app.asar");
const executablePath = process.platform === "win32"
  ? join(packageDir, "Workspace.exe")
  : process.platform === "darwin"
    ? join(packageDir, "Workspace.app")
    : join(packageDir, "workspace");

assertPath(executablePath, "Workspace executable");
assertPath(asarPath, "app.asar");
assertPath(join(resourcesDir, "web-local", "index.html"), "renderer index");
assertPath(join(resourcesDir, "assets", "icon.png"), "desktop icon");

if (existsSync(executablePath) && process.platform === "win32") {
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
    "/dist/desktop/desktop/src/main.js",
    "/dist/desktop/desktop/src/preload.cjs",
    "/node_modules/@earendil-works/pi-coding-agent/package.json",
    "/node_modules/electron-updater/package.json",
    "/node_modules/jszip/package.json",
  ]) {
    if (!entries.has(required)) failures.push(`app.asar is missing ${required}.`);
  }

  try {
    const packaged = JSON.parse(extractFile(asarPath, "package.json").toString("utf8"));
    if (packaged.name !== "workspace-desktop") failures.push(`Packaged npm name is ${packaged.name ?? "missing"}.`);
    if (packaged.productName !== "Workspace") failures.push(`Packaged product name is ${packaged.productName ?? "missing"}.`);
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
  const candidates = [join(outDir, "builder", "win-unpacked"), ...readdirSync(outDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^Workspace-(?:win32|darwin|linux)-/.test(entry.name))
    .map((entry) => join(outDir, entry.name))]
    .filter((candidate) => existsSync(candidate));
  return candidates[0] ?? null;
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
