import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import {
  WorkspaceDesktopCliHost,
  workspaceCliInstanceData,
  workspaceCliRequestIdFromArgv,
  workspaceCliRequestIdFromInstanceData,
} from "../desktop/src/cli-host.js";
import { createWorkspaceCliRequest, type WorkspaceCliKernel } from "../src/local/cli/index.js";

test("desktop CLI launch metadata accepts both Electron argument forms", () => {
  const id = randomUUID();
  assert.equal(workspaceCliRequestIdFromArgv(["Workspace.exe", "--workspace-cli-request", id]), id);
  assert.equal(workspaceCliRequestIdFromArgv(["Workspace.exe", `--workspace-cli-request=${id}`]), id);
  assert.equal(workspaceCliRequestIdFromArgv(["Workspace.exe"]), null);
  assert.deepEqual(workspaceCliInstanceData(id), { kind: "workspace-cli", requestId: id });
  assert.deepEqual(workspaceCliInstanceData(null), { kind: "workspace-gui" });
  assert.equal(workspaceCliRequestIdFromInstanceData({ kind: "workspace-cli", requestId: id }), id);
  assert.equal(workspaceCliRequestIdFromInstanceData({ kind: "workspace-gui" }), null);
  assert.throws(() => workspaceCliRequestIdFromArgv(["Workspace.exe", "--workspace-cli-request", "../bad"]), /UUID/);
  assert.throws(() => workspaceCliRequestIdFromArgv([
    "Workspace.exe",
    "--workspace-cli-request",
    id,
    "--workspace-cli-request",
    randomUUID(),
  ]), /only once/);
});

test("desktop CLI host processes an atomic request through the executor", async () => {
  const stateRoot = await mkdtemp(join(tmpdir(), "workspace-desktop-cli-"));
  try {
    const host = new WorkspaceDesktopCliHost({
      stateRoot,
      kernel: fixtureKernel(),
      version: "9.8.7",
    });
    await host.initialize();
    const request = createWorkspaceCliRequest({
      id: randomUUID(),
      argv: ["version", "--json"],
      cwd: resolve("."),
    });
    await host.broker.writeRequest(request);
    await host.processRequest(request.id);
    const response = await host.broker.readResponse(request.id);
    assert.equal(response.exitCode, 0);
    assert.equal(response.stderr, "");
    assert.match(response.stdout, /"version": "9\.8\.7"/);
    assert.deepEqual(response.result, {
      name: "Workspace",
      version: "9.8.7",
      protocolVersion: 1,
    });
  } finally {
    await rm(stateRoot, { recursive: true, force: true });
  }
});

test("desktop CLI host serializes overlapping requests and exposes an idle drain", async () => {
  const stateRoot = await mkdtemp(join(tmpdir(), "workspace-desktop-cli-queue-"));
  let active = 0;
  let maxActive = 0;
  const kernel = fixtureKernel();
  kernel.listSpaces = async () => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    await new Promise<void>((resolveDelay) => setTimeout(resolveDelay, 15));
    active -= 1;
    return [];
  };
  try {
    const host = new WorkspaceDesktopCliHost({ stateRoot, kernel, version: "1.0.0" });
    await host.initialize();
    const requests = [randomUUID(), randomUUID()].map((id) => createWorkspaceCliRequest({
      id,
      argv: ["spaces", "list", "--json"],
      cwd: resolve("."),
    }));
    await Promise.all(requests.map((request) => host.broker.writeRequest(request)));
    const processing = requests.map((request) => host.processRequest(request.id));
    await host.whenIdle();
    await Promise.all(processing);
    assert.equal(maxActive, 1);
    assert.deepEqual(
      await Promise.all(requests.map(async (request) => (await host.broker.readResponse(request.id)).exitCode)),
      [0, 0],
    );
  } finally {
    await rm(stateRoot, { recursive: true, force: true });
  }
});

function fixtureKernel(): WorkspaceCliKernel {
  return {
    async getContext(actor) {
      return { cwd: actor.cwd, space: null };
    },
    async listSpaces() {
      return [];
    },
    async listTasks() {
      return [];
    },
    async listCapabilities() {
      return [];
    },
  };
}
