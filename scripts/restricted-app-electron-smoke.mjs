import assert from "node:assert/strict";
import { createServer } from "node:http";
import { appendFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, protocol } from "electron";

import {
  RestrictedAppHost,
  restrictedAppProtocol,
} from "../dist/desktop/desktop/src/restricted-app-host.js";
import { stageRestrictedAppPackage } from "../dist/desktop/src/local/agent/restricted-app-package.js";
import { FileRestrictedAppStorage } from "../dist/desktop/src/local/agent/restricted-app-storage.js";

const rootDir = resolve(fileURLToPath(new URL("..", import.meta.url)));

protocol.registerSchemesAsPrivileged([{
  scheme: restrictedAppProtocol,
  privileges: { standard: true, secure: true },
}]);
app.on("window-all-closed", () => {});

let failed = false;
void mark("loaded")
  .then(() => app.whenReady())
  .then(() => mark("ready"))
  .then(runSmoke)
  .then(() => console.log("Restricted app Electron sandbox smoke passed."))
  .catch((error) => {
    failed = true;
    void mark(`error ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
    console.error(error);
  })
  .finally(() => app.exit(failed ? 1 : 0));

async function runSmoke() {
  await mark("smoke-start");
  const sandbox = await mkdtemp(join(tmpdir(), "workspace-restricted-electron-"));
  const listener = createServer((_request, response) => {
    hits += 1;
    response.writeHead(200, { "content-type": "text/plain" });
    response.end("escape");
  });
  let hits = 0;
  listener.on("upgrade", (socket) => {
    hits += 1;
    socket.destroy();
  });
  await new Promise((resolveListen, reject) => {
    listener.once("error", reject);
    listener.listen(0, "127.0.0.1", resolveListen);
  });
  await mark("listener-ready");
  const address = listener.address();
  assert.ok(address && typeof address === "object");
  const escapeUrl = `http://127.0.0.1:${address.port}/escape`;
  let host;
  try {
    process.env.WORKSPACE_STATE_DIR = join(sandbox, "state");
    const workspaceRoot = join(sandbox, "space");
    const sourceRoot = join(workspaceRoot, "apps", "source");
    const stagingRoot = join(sandbox, "staged");
    await writeSmokePackage(sourceRoot, address.port);
    await mkdir(join(workspaceRoot, "exports"), { recursive: true });
    const receipt = await stageRestrictedAppPackage(sourceRoot, stagingRoot);
    await mark("package-staged");
    const connections = new EmptyConnections();
    const storage = new FileRestrictedAppStorage(join(sandbox, "app-data"));
    const tabCommands = [];
    host = new RestrictedAppHost({
      connections,
      storage,
      resolveWorkspaceRoot: (workspaceId) => workspaceId === "ws-electron-smoke" ? workspaceRoot : undefined,
      preloadPath: join(rootDir, "dist", "desktop", "desktop", "src", "restricted-app-preload.cjs"),
      invocationTimeoutMs: 2_000,
      onTabCommand: (command) => tabCommands.push(command),
    });
    const descriptor = {
      workspaceId: "ws-electron-smoke",
      packageName: receipt.packageName,
      version: receipt.version,
      digest: receipt.digest,
      manifest: receipt.manifest,
      networkGrants: ["escape"],
      fileGrants: [{ id: "exports", declarationId: "exports", root: "exports", access: "read-write" }],
      backgroundEnabled: true,
      fileCount: receipt.fileCount,
      totalBytes: receipt.totalBytes,
      installedAt: "2026-07-13T00:00:00.000Z",
      updatedAt: "2026-07-13T00:00:00.000Z",
      stagedRoot: receipt.stagedRoot,
    };

    const probe = await host.invoke(descriptor, "probe", { text: "Hello, 🌍 — 你好", escapeUrl });
    await mark(`probe-complete ${JSON.stringify(probe)}`);
    assert.deepEqual(probe, {
      echoed: "Hello, 🌍 — 你好",
      nodeGlobalsAbsent: true,
      nodeImportBlocked: true,
      directFetchBlocked: true,
      directWebSocketBlocked: true,
      webRtcBlocked: true,
      popupBlocked: true,
      brokerDenied: true,
      workerTopLevelStorageDenied: true,
    });
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
    assert.equal(hits, 0, "the restricted renderer must not reach the loopback listener directly");

    await assert.rejects(host.invoke(descriptor, "frame", {}), (error) => error?.code === "APP_CRASHED");
    const afterFrame = await host.invoke(descriptor, "probe", { text: "Frame recovery", escapeUrl });
    assert.equal(afterFrame.echoed, "Frame recovery");
    await assert.rejects(host.invoke(descriptor, "huge", {}), (error) => error?.code === "OUTPUT_INVALID");
    await assert.rejects(host.invoke(descriptor, "cyclic", {}), (error) => error?.code === "OUTPUT_INVALID");
    await assert.rejects(host.invoke(descriptor, "intrinsics", {}), (error) => error?.code === "OUTPUT_INVALID");
    await assert.rejects(host.invoke(descriptor, "hang", {}), (error) => error?.code === "APP_TIMEOUT");
    await mark("timeout-complete");

    const recovered = await host.invoke(descriptor, "probe", { text: "Recovered ✅", escapeUrl });
    assert.equal(recovered.echoed, "Recovered ✅");
    assert.equal(hits, 0);
    await mark("recovery-complete");

    await host.runBackground(descriptor, { reason: "manual", scheduledAt: "2026-07-13T00:00:00.000Z" });
    assert.deepEqual(await storage.get({ workspaceId: descriptor.workspaceId, appId: descriptor.manifest.id }, "background"), {
      reason: "manual",
      scheduledAt: "2026-07-13T00:00:00.000Z",
    });
    await mark("background-complete");

    const parent = new BrowserWindow({ show: true, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
    await parent.loadURL("data:text/html,<main>Workspace owner</main>");
    const mountId = "11111111-1111-4111-8111-111111111111";
    await host.mountUi(descriptor, parent.webContents, parent, {
      mountId,
      placement: "navigator",
      route: "/",
      state: { escapeUrl },
      sequence: 0,
      bounds: { x: 0, y: 0, width: 320, height: 500 },
      active: true,
      occluded: false,
      theme: "dark",
    });
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 150));
    assert.equal(hits, 0, "the visible restricted app must not reach loopback directly");
    assert.deepEqual(tabCommands.map((command) => ({ type: command.type, workspaceId: command.workspaceId, appId: command.appId, digest: command.digest, tab: command.tab })), [{
      type: "open",
      workspaceId: descriptor.workspaceId,
      appId: descriptor.manifest.id,
      digest: descriptor.digest,
      tab: {
        appTabId: "smoke-tab",
        title: "Sandbox ready",
        route: "/ready",
        state: { directFetchBlocked: true, stored: "visible-ui", file: "host-brokered" },
      },
    }]);
    host.layoutUi(parent.webContents.id, {
      mountId,
      placement: "navigator",
      route: "/",
      state: { escapeUrl },
      sequence: 1,
      bounds: { x: 0, y: 0, width: 320, height: 500 },
      active: false,
      occluded: true,
      theme: "dark",
    });
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 150));
    assert.deepEqual(await storage.get({ workspaceId: descriptor.workspaceId, appId: descriptor.manifest.id }, "inactive-powers"), {
      fileDenied: true,
      networkDenied: true,
    });
    assert.equal(hits, 0, "an inactive app view must not retain file or network powers");
    await host.unmountUi(parent.webContents.id, mountId);
    parent.destroy();
    await mark("ui-complete");
  } finally {
    await mark("cleanup-start");
    try {
      await host?.close();
    } catch (error) {
      await mark(`host-close-error ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
      throw error;
    }
    await mark("host-closed");
    await new Promise((resolveClose) => listener.close(resolveClose));
    await rm(sandbox, { recursive: true, force: true });
  }
}

async function mark(message) {
  const path = process.env.WORKSPACE_RESTRICTED_SMOKE_LOG;
  if (path) await appendFile(path, `${new Date().toISOString()} ${message}\n`, "utf8");
}

async function writeSmokePackage(root, loopbackPort) {
  await mkdir(root, { recursive: true });
  await Promise.all([
    writeFile(join(root, "package.json"), JSON.stringify({
      name: "restricted-electron-smoke",
      version: "0.1.0",
      private: true,
      type: "module",
      agentApp: "agent-app.json",
    }), "utf8"),
    writeFile(join(root, "agent-app.json"), JSON.stringify(smokeManifest(loopbackPort)), "utf8"),
    writeFile(join(root, "index.html"), "<!doctype html><main id=app></main><script type=module src=ui.js></script>", "utf8"),
    writeFile(join(root, "ui.js"), `
const bridge = globalThis.workspaceRestrictedApp;
const context = bridge.context.get();
bridge.context.onChanged(async (next) => {
  if (next.active) return;
  let fileDenied = false;
  let networkDenied = false;
  try { await bridge.files.read({ grantId: "exports", path: "smoke.txt", encoding: "utf8" }); } catch { fileDenied = true; }
  try { await bridge.request({ destinationId: "escape", method: "GET", path: "/escape" }); } catch { networkDenied = true; }
  await bridge.storage.set("inactive-powers", { fileDenied, networkDenied });
});
let directFetchBlocked = false;
try { await fetch(context.state.escapeUrl); } catch { directFetchBlocked = true; }
await bridge.storage.set("visible", "visible-ui");
const stored = await bridge.storage.get("visible");
await bridge.files.write({ grantId: "exports", path: "smoke.txt", encoding: "utf8", data: "host-brokered", mode: "create" });
const file = await bridge.files.read({ grantId: "exports", path: "smoke.txt", encoding: "utf8" });
document.querySelector("#app").textContent = context.theme + ":" + String(directFetchBlocked);
await bridge.tabs.open({ tabId: "smoke-tab", title: "Sandbox ready", route: "/ready", state: { directFetchBlocked, stored, file: file.data } });
`, "utf8"),
    writeFile(join(root, "worker.js"), `
let workerTopLevelStorageDenied = false;
try { await globalThis.workspaceRestrictedApp.storage.set("worker-top-level", true); }
catch { workerTopLevelStorageDenied = true; }

export async function handleAction(action, input) {
  if (action === "huge") return "x".repeat(300000);
  if (action === "cyclic") { const value = {}; value.self = value; return value; }
  if (action === "frame") { document.body.append(document.createElement("iframe")); return null; }
  if (action === "intrinsics") {
    JSON.stringify = () => "{}";
    TextEncoder.prototype.encode = () => new Uint8Array(0);
    return "x".repeat(300000);
  }
  if (action === "hang") { for (;;) {} }
  let nodeImportBlocked = false;
  try { await import("node:fs"); } catch { nodeImportBlocked = true; }
  let directFetchBlocked = false;
  try { await fetch(input.escapeUrl); } catch { directFetchBlocked = true; }
  let directWebSocketBlocked = false;
  try {
    directWebSocketBlocked = await new Promise((resolve) => {
      const socket = new WebSocket(input.escapeUrl.replace("http:", "ws:"));
      const timer = setTimeout(() => { socket.close(); resolve(true); }, 500);
      socket.onopen = () => { clearTimeout(timer); socket.close(); resolve(false); };
      socket.onerror = () => { clearTimeout(timer); resolve(true); };
    });
  } catch { directWebSocketBlocked = true; }
  const webRtcBlocked = typeof RTCPeerConnection === "undefined";
  const popupBlocked = window.open(input.escapeUrl) === null;
  let brokerDenied = false;
  try {
    await globalThis.workspaceRestrictedApp.request({ destinationId: "mail-api", method: "GET", path: "/messages" });
  } catch { brokerDenied = true; }
  return {
    echoed: input.text,
    nodeGlobalsAbsent: typeof process === "undefined" && typeof require === "undefined" && typeof Buffer === "undefined",
    nodeImportBlocked,
    directFetchBlocked,
    directWebSocketBlocked,
    webRtcBlocked,
    popupBlocked,
    brokerDenied,
    workerTopLevelStorageDenied,
  };
}

export async function handleBackground(event) {
  await globalThis.workspaceRestrictedApp.storage.set("background", event);
}
`, "utf8"),
  ]);
}

function smokeManifest(loopbackPort) {
  const emptyInput = { type: "object", properties: {}, required: [], additionalProperties: false };
  return {
    version: 1,
    id: "restricted-electron-smoke",
    title: "Restricted Electron smoke",
    runtime: { kind: "sandboxed-web", entry: "index.html", worker: "worker.js" },
    ui: { icon: "apps" },
    background: { intervalMinutes: 30 },
    tools: [
      {
        name: "probe",
        description: "Probe the Chromium sandbox boundary.",
        action: "probe",
        inputSchema: {
          type: "object",
          properties: {
            text: { type: "string", maxLength: 200 },
            escapeUrl: { type: "string", maxLength: 500 },
          },
          required: ["text", "escapeUrl"],
          additionalProperties: false,
        },
        resultSchema: {
          type: "object",
          properties: {
            echoed: { type: "string", maxLength: 200 },
            nodeGlobalsAbsent: { type: "boolean" },
            nodeImportBlocked: { type: "boolean" },
            directFetchBlocked: { type: "boolean" },
            directWebSocketBlocked: { type: "boolean" },
            webRtcBlocked: { type: "boolean" },
            popupBlocked: { type: "boolean" },
            brokerDenied: { type: "boolean" },
            workerTopLevelStorageDenied: { type: "boolean" },
          },
          required: ["echoed", "nodeGlobalsAbsent", "nodeImportBlocked", "directFetchBlocked", "directWebSocketBlocked", "webRtcBlocked", "popupBlocked", "brokerDenied", "workerTopLevelStorageDenied"],
          additionalProperties: false,
        },
      },
      { name: "huge", description: "Return an oversized result.", action: "huge", inputSchema: emptyInput, resultSchema: { type: "string" } },
      { name: "cyclic", description: "Return a cyclic result.", action: "cyclic", inputSchema: emptyInput, resultSchema: { type: "object", properties: {}, required: [], additionalProperties: false } },
      { name: "frame", description: "Try to create a child frame.", action: "frame", inputSchema: emptyInput, resultSchema: { type: "null" } },
      { name: "intrinsics", description: "Tamper with renderer intrinsics.", action: "intrinsics", inputSchema: emptyInput, resultSchema: { type: "string" } },
      { name: "hang", description: "Block the renderer.", action: "hang", inputSchema: emptyInput, resultSchema: { type: "null" } },
    ],
    permissions: {
      files: [{ id: "exports", target: "directory", access: "read-write" }],
      network: [
        { id: "mail-api", target: { kind: "public-https", origin: "https://mail.example.com" }, methods: ["GET"], auth: [{ kind: "none" }] },
        { id: "escape", target: { kind: "loopback-http", host: "127.0.0.1", port: loopbackPort }, methods: ["GET"], auth: [{ kind: "none" }] },
      ],
    },
  };
}

class EmptyConnections {
  async get() { return undefined; }
  async set() {}
  async delete() { return false; }
  async deleteApp() {}
}
