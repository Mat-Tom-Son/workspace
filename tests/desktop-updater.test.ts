import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";

import {
  WorkspaceUpdater,
  type WorkspaceUpdateCheckResultLike,
  type WorkspaceUpdateMessage,
  type WorkspaceUpdateStatus,
  type WorkspaceUpdaterAdapter,
  type WorkspaceUpdaterHost,
} from "../desktop/src/updater.js";

class FakeUpdater extends EventEmitter implements WorkspaceUpdaterAdapter {
  autoDownload = true;
  autoInstallOnAppQuit = true;
  allowDowngrade = true;
  allowPrerelease = true;
  installerPath: string | null = "C:\\updates\\Workspace-Setup.exe";
  checkResult: WorkspaceUpdateCheckResultLike | null = {
    isUpdateAvailable: true,
    updateInfo: { version: "1.1.0" },
  };
  checkError: Error | null = null;
  downloadError: Error | null = null;
  quitError: Error | null = null;
  quitCalls: Array<{ silent: boolean | undefined; forceRunAfter: boolean | undefined }> = [];

  async checkForUpdates(): Promise<WorkspaceUpdateCheckResultLike | null> {
    if (this.checkError) throw this.checkError;
    return this.checkResult;
  }

  async downloadUpdate(): Promise<void> {
    if (this.downloadError) throw this.downloadError;
    this.emit("download-progress", { percent: 42 });
    this.emit("update-downloaded", { version: this.checkResult?.updateInfo.version ?? "1.1.0" });
  }

  quitAndInstall(silent?: boolean, forceRunAfter?: boolean): void {
    this.quitCalls.push({ silent, forceRunAfter });
    if (this.quitError) throw this.quitError;
  }
}

class FakeHost implements WorkspaceUpdaterHost {
  supported = true;
  version = "1.0.0";
  nowValue = "2026-07-10T12:00:00.000Z";
  installerPresent = true;
  messageResponse = 1;
  messages: WorkspaceUpdateMessage[] = [];
  statuses: WorkspaceUpdateStatus[] = [];
  progress: number[] = [];

  isSupported(): boolean { return this.supported; }
  currentVersion(): string { return this.version; }
  now(): string { return this.nowValue; }
  installerExists(): boolean { return this.installerPresent; }
  async showMessage(options: WorkspaceUpdateMessage): Promise<{ response: number }> {
    this.messages.push(options);
    return { response: this.messageResponse };
  }
  setProgress(value: number): void { this.progress.push(value); }
  emitStatus(status: WorkspaceUpdateStatus): void { this.statuses.push(status); }
}

function createHarness(options: { prepare?: () => Promise<void> } = {}) {
  const adapter = new FakeUpdater();
  const host = new FakeHost();
  let prepareCalls = 0;
  const updater = new WorkspaceUpdater({
    updater: adapter,
    host,
    automaticChecks: false,
    timings: { transientRetryDelayMs: 60 * 60 * 1000 },
    prepareToInstall: options.prepare ?? (async () => { prepareCalls += 1; }),
  });
  updater.start();
  return { adapter, host, updater, prepareCalls: () => prepareCalls };
}

function nextTurn(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

test("background transient update failures defer and retry without surfacing an error", async () => {
  const { adapter, updater } = createHarness();
  adapter.checkError = new Error("net::ERR_INTERNET_DISCONNECTED");

  const status = await updater.check(false);

  assert.equal(status.phase, "idle");
  assert.equal(status.error, null);
  assert.match(status.message, /waiting for the network/i);
  updater.dispose();
});

test("manual update failures remain visible instead of being silently deferred", async () => {
  const { adapter, updater } = createHarness();
  adapter.checkError = new Error("net::ERR_INTERNET_DISCONNECTED");

  const status = await updater.check(true);

  assert.equal(status.phase, "error");
  assert.match(status.error ?? "", /ERR_INTERNET_DISCONNECTED/);
  updater.dispose();
});

test("choosing Later keeps a downloaded update ready for explicit install on quit", async () => {
  const { adapter, host, updater } = createHarness();
  host.messageResponse = 1;

  adapter.emit("update-downloaded", { version: "1.1.0" });
  await nextTurn();

  assert.equal(updater.getStatus().phase, "ready");
  assert.match(updater.getStatus().message, /install when you quit/i);
  assert.equal(updater.shouldInstallOnQuit(), true);
  assert.equal(host.messages.length, 1);
  updater.dispose();
});

test("Update now downloads, performs update-specific shutdown, and forces the app to relaunch", async () => {
  const { adapter, updater, prepareCalls } = createHarness();
  const checked = await updater.check(true);
  assert.equal(checked.phase, "available");

  await updater.updateNow();
  await nextTurn();

  assert.equal(adapter.autoDownload, false);
  assert.equal(adapter.autoInstallOnAppQuit, false);
  assert.equal(prepareCalls(), 1);
  assert.deepEqual(adapter.quitCalls, [{ silent: true, forceRunAfter: true }]);
  assert.equal(updater.getStatus().phase, "installing");
  updater.dispose();
});

test("install refuses to quit when the downloaded installer path is missing", async () => {
  const { adapter, host, updater } = createHarness();
  host.installerPresent = false;
  adapter.emit("update-downloaded", { version: "1.1.0" });
  await nextTurn();

  const status = await updater.install();

  assert.equal(status.phase, "error");
  assert.match(status.message, /installer is missing/i);
  assert.equal(adapter.quitCalls.length, 0);
  assert.equal(updater.shouldInstallOnQuit(), false);
  updater.dispose();
});

test("a quitAndInstall failure returns a valid downloaded installer to ready", async () => {
  const { adapter, updater, prepareCalls } = createHarness();
  adapter.quitError = new Error("installer launch failed");
  adapter.emit("update-downloaded", { version: "1.1.0" });
  await nextTurn();

  const status = await updater.install();

  assert.equal(prepareCalls(), 1);
  assert.equal(status.phase, "ready");
  assert.equal(status.progressPercent, 100);
  assert.match(status.error ?? "", /installer launch failed/);
  assert.equal(updater.shouldInstallOnQuit(), true);
  updater.dispose();
});

test("install-on-quit skips the already completed update shutdown and does not force relaunch", async () => {
  const { adapter, updater, prepareCalls } = createHarness();
  adapter.emit("update-downloaded", { version: "1.1.0" });
  await nextTurn();

  const status = await updater.installDownloadedUpdateOnQuit();

  assert.equal(status.phase, "installing");
  assert.equal(prepareCalls(), 0);
  assert.deepEqual(adapter.quitCalls, [{ silent: true, forceRunAfter: false }]);
  updater.dispose();
});
