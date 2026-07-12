import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { basename, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { fileURLToPath } from "node:url";

const rootDir = resolve(fileURLToPath(new URL("..", import.meta.url)));
const require = createRequire(import.meta.url);
const builder = require(join(rootDir, "electron-builder.desktop.cjs"));
const forge = require(join(rootDir, "desktop", "forge.config.cjs"));

test("Electron Builder packages executable CLI shims outside ASAR and includes PATH hooks", () => {
  assert.deepEqual(builder.extraFiles, [{
    from: "desktop/cli",
    to: "bin",
    filter: ["workspace.cmd", "workspace-cli.ps1"],
  }]);
  assert.equal(basename(builder.nsis.include), "cli-path.nsh");
  assert.equal(builder.asar, true);
  assert.equal(builder.electronFuses.runAsNode, false);
});

test("retained Forge packaging mirrors the package-root CLI bin layout", async () => {
  const hooks = forge.packagerConfig.afterComplete;
  assert.equal(Array.isArray(hooks), true);
  assert.equal(hooks.length, 1);
  const packageRoot = await mkdtemp(join(tmpdir(), "workspace-forge-cli-"));
  try {
    await hooks[0](packageRoot);
    for (const name of ["workspace.cmd", "workspace-cli.ps1"]) {
      assert.equal(
        await readFile(join(packageRoot, "bin", name), "utf8"),
        await readFile(join(rootDir, "desktop", "cli", name), "utf8"),
      );
    }
  } finally {
    await rm(packageRoot, { recursive: true, force: true });
  }
});

test("Windows CLI shim uses an atomic bounded protocol-v1 handoff", async () => {
  const [commandShim, powerShellShim] = await Promise.all([
    read("desktop/cli/workspace.cmd"),
    read("desktop/cli/workspace-cli.ps1"),
  ]);
  assert.match(commandShim, /-NoProfile\s+-NonInteractive/);
  assert.match(commandShim, /workspace-cli\.ps1"\s+%\*/);
  assert.match(commandShim, /exit \/b %ERRORLEVEL%/);

  for (const field of ["protocolVersion", "id", "argv", "cwd", "createdAt"]) {
    assert.match(powerShellShim, new RegExp(`\\b${field}\\s*=`), `request must include ${field}`);
  }
  assert.match(powerShellShim, /'Workspace\\cli'/);
  assert.match(powerShellShim, /'requests'/);
  assert.match(powerShellShim, /'responses'/);
  assert.match(powerShellShim, /CurrentFileSystemLocation\.ProviderPath/);
  assert.doesNotMatch(powerShellShim, /GetCurrentDirectory/);
  assert.match(powerShellShim, /\$temporaryRequestId\s*=\s*\[Guid\]::NewGuid\(\)/);
  assert.match(powerShellShim, /\[IO\.FileMode\]::CreateNew/);
  assert.match(powerShellShim, /\$requestStream\.Flush\(\$true\)/);
  assert.doesNotMatch(powerShellShim, /\$requestId\.\$PID\.tmp/);
  assert.match(powerShellShim, /\[IO\.File\]::Move\(\$temporaryRequestPath,\s*\$requestPath\)/);
  assert.match(powerShellShim, /Start-Process[\s\S]*?'--workspace-cli-request'[\s\S]*?-WindowStyle Hidden/);
  assert.match(powerShellShim, /WORKSPACE_CLI_APP/);
  assert.match(powerShellShim, /WORKSPACE_CLI_TIMEOUT_MS/);
  assert.match(powerShellShim, /ElapsedMilliseconds\s+-ge\s+\$timeoutMs/);
  assert.match(powerShellShim, /\[Console\]::Out\.Write\(\[string\]\$response\.stdout\)/);
  assert.match(powerShellShim, /\[Console\]::Error\.Write\(\[string\]\$response\.stderr\)/);
  assert.match(powerShellShim, /\$exitCode\s*=\s*\[Convert\]::ToInt32\(\$response\.exitCode/);
  assert.match(powerShellShim, /Remove-Item -LiteralPath \$path -Force/);
});

test("NSIS manages only the current-user PATH and broadcasts changes", async () => {
  const [nsis, powerShellShim] = await Promise.all([
    read("desktop/nsis/cli-path.nsh"),
    read("desktop/cli/workspace-cli.ps1"),
  ]);
  assert.match(nsis, /!macro customInstall/);
  assert.match(nsis, /!macro customUnInstall/);
  assert.match(nsis, /\$INSTDIR\\bin/);
  assert.match(nsis, /nsExec::ExecToStack/);
  assert.match(nsis, /-NoProfile\s+-NonInteractive/);
  assert.match(nsis, /--workspace-installer-manage-user-path \$\{ACTION\}/);
  assert.match(nsis, /\$\{HWND_BROADCAST\}\s+\$\{WM_SETTINGCHANGE\}/);
  assert.doesNotMatch(nsis, /HKLM|\$PROFILE|Documents\\PowerShell/i);

  assert.match(powerShellShim, /Microsoft\.Win32\.Registry\]::CurrentUser/);
  assert.match(powerShellShim, /RegistryValueOptions\]::DoNotExpandEnvironmentNames/);
  assert.match(powerShellShim, /RegistryValueKind\]::ExpandString/);
  assert.match(powerShellShim, /StringComparison\]::OrdinalIgnoreCase/);
  assert.match(powerShellShim, /DeleteValue\('Path',\s*\$false\)/);
});

test("packaged asset verification requires external CLI shims", async () => {
  const verifier = await read("scripts/verify-packaged-app-assets.mjs");
  assert.match(verifier, /join\(packageDir, "bin", "workspace\.cmd"\)/);
  assert.match(verifier, /join\(packageDir, "bin", "workspace-cli\.ps1"\)/);
  assert.match(verifier, /CLI shim must remain outside app\.asar/);
});

async function read(relativePath: string): Promise<string> {
  return readFile(join(rootDir, relativePath), "utf8");
}
