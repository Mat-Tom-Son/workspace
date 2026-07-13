import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  inspectRestrictedAppPackage,
  stageRestrictedAppPackage,
} from "../src/local/agent/restricted-app-package.js";

test("restricted app packages are inspected and content-addressed without evaluating their code", async () => {
  const sandbox = await mkdtemp(join(tmpdir(), "workspace-restricted-app-"));
  const source = join(sandbox, "source");
  const staged = join(sandbox, "staged");
  const canary = join(sandbox, "executed.txt");
  try {
    await writePackage(source, `throw new Error(${JSON.stringify(`code executed and would write ${canary}`)});\n`);
    const inspection = await inspectRestrictedAppPackage(source);
    assert.equal(inspection.manifest.id, "connected-inbox");
    assert.equal(inspection.manifest.runtime.entry, "index.html");
    assert.equal(inspection.manifest.runtime.worker, "worker.js");
    assert.equal(inspection.digest.length, 64);

    const receipt = await stageRestrictedAppPackage(source, staged);
    assert.equal(receipt.digest, inspection.digest);
    assert.equal(receipt.stagedRoot, join(staged, inspection.digest));
    assert.equal(await missing(canary), true, "inspection and staging must not evaluate app.js");

    await writeFile(join(source, "worker.js"), "globalThis.changed = true;\n", "utf8");
    const stagedEntry = await readFile(join(receipt.stagedRoot, "worker.js"), "utf8");
    assert.match(stagedEntry, /throw new Error/);
    assert.notEqual((await inspectRestrictedAppPackage(source)).digest, receipt.digest);
    assert.equal((await inspectRestrictedAppPackage(receipt.stagedRoot)).digest, receipt.digest);
  } finally {
    await rm(sandbox, { recursive: true, force: true });
  }
});

test("checked-in restricted app example stays valid for the staged contract", async () => {
  const inspection = await inspectRestrictedAppPackage(join(process.cwd(), "examples", "packages", "restricted-connected-inbox"));
  assert.equal(inspection.manifest.id, "restricted-connected-inbox");
  assert.deepEqual(inspection.manifest.permissions.network[0]?.target, { kind: "public-https", origin: "https://mail.example.com" });
  assert.equal(inspection.manifest.runtime.entry, "index.html");
});

test("restricted app package preflight rejects native Pi and package-manager execution paths", async () => {
  const sandbox = await mkdtemp(join(tmpdir(), "workspace-restricted-fields-"));
  try {
    for (const [field, value] of [
      ["scripts", { postinstall: "node setup.js" }],
      ["pi", { extensions: ["app.js"] }],
      ["bin", { command: "app.js" }],
    ] as const) {
      const root = join(sandbox, field);
      await writePackage(root, "export {};\n", { [field]: value });
      await assert.rejects(inspectRestrictedAppPackage(root), new RegExp(`cannot declare ${field}`));
    }
    const dependencies = join(sandbox, "dependencies");
    await writePackage(dependencies, "export {};\n", { dependencies: { library: "1.0.0" } });
    assert.equal((await inspectRestrictedAppPackage(dependencies)).manifest.runtime.entry, "index.html");
  } finally {
    await rm(sandbox, { recursive: true, force: true });
  }
});

test("restricted app package preflight rejects missing entries and linked files", async (t) => {
  const sandbox = await mkdtemp(join(tmpdir(), "workspace-restricted-links-"));
  try {
    const missingEntry = join(sandbox, "missing-entry");
    await writePackage(missingEntry, "export {};\n");
    await rm(join(missingEntry, "index.html"));
    await assert.rejects(inspectRestrictedAppPackage(missingEntry), /entry does not exist/);

    const linked = join(sandbox, "linked");
    await writePackage(linked, "export {};\n");
    try {
      await symlink(join(linked, "worker.js"), join(linked, "linked.js"), "file");
    } catch (error) {
      const code = error && typeof error === "object" && "code" in error ? (error as NodeJS.ErrnoException).code : undefined;
      if (code === "EPERM" || code === "EACCES") {
        t.diagnostic("Symlink assertion skipped because this Windows host disallows file symlinks.");
        return;
      }
      throw error;
    }
    await assert.rejects(inspectRestrictedAppPackage(linked), /cannot contain links/);
  } finally {
    await rm(sandbox, { recursive: true, force: true });
  }
});

async function writePackage(root: string, appSource: string, extraPackageFields: Record<string, unknown> = {}): Promise<void> {
  await mkdir(root, { recursive: true });
  await writeFile(join(root, "package.json"), JSON.stringify({
    name: "connected-inbox",
    version: "0.1.0",
    private: true,
    type: "module",
    agentApp: "agent-app.json",
    ...extraPackageFields,
  }), "utf8");
  await writeFile(join(root, "agent-app.json"), JSON.stringify({
    version: 1,
    id: "connected-inbox",
    title: "Connected inbox",
    runtime: { kind: "sandboxed-web", entry: "index.html", worker: "worker.js" },
    ui: { icon: "mail" },
    tools: [],
    permissions: {
      network: [{
        id: "inbox-api",
        target: { kind: "public-https", origin: "https://mail.example.com" },
        methods: ["GET"],
        auth: [{
          kind: "oauth2-pkce",
          issuer: "https://identity.example.com",
          clientId: "workspace-connected-inbox",
          scopes: ["mail.read"],
        }],
      }],
    },
  }), "utf8");
  await writeFile(join(root, "index.html"), "<!doctype html><script type=module src=app.js></script>", "utf8");
  await writeFile(join(root, "app.js"), "export {};\n", "utf8");
  await writeFile(join(root, "worker.js"), appSource, "utf8");
}

async function missing(path: string): Promise<boolean> {
  try {
    await readFile(path);
    return false;
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT") return true;
    throw error;
  }
}
