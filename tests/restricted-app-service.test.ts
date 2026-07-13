import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import test from "node:test";

import type {
  RestrictedAppConnectionBinding,
  RestrictedAppConnectionOwner,
  RestrictedAppConnectionStore,
  RestrictedAppCredential,
} from "../src/local/agent/restricted-app-connections.js";
import {
  RestrictedAppService,
  type RestrictedAppRuntimeDescriptor,
  type RestrictedAppRuntimeHost,
} from "../src/local/agent/restricted-app-service.js";
import { FileRestrictedAppStorage } from "../src/local/agent/restricted-app-storage.js";
import { RestrictedAppNotificationBroker } from "../src/local/agent/restricted-app-notifications.js";

const spaceOne = "ws-1111111111111111";
const spaceTwo = "ws-2222222222222222";
const spaceThree = "ws-3333333333333333";

test("RestrictedAppService inspects reviewed bytes and requires the expected digest before installation", async () => {
  const sandbox = await mkdtemp(join(tmpdir(), "workspace-restricted-service-review-"));
  const workspaceRoot = join(sandbox, "space");
  const rootPath = join(sandbox, "state", "restricted-apps");
  try {
    await writePackage(join(workspaceRoot, "apps", "inbox"));
    const service = await RestrictedAppService.create({ rootPath });
    const review = await service.inspect({ workspaceId: spaceOne, workspaceRoot, sourcePath: "apps/inbox" });

    assert.equal(review.packageName, "connected-inbox");
    assert.equal(review.manifest.id, "connected-inbox");
    assert.equal(review.manifest.runtime.entry, "index.html");
    assert.equal(review.manifest.runtime.worker, "worker.js");
    assert.match(review.digest, /^[0-9a-f]{64}$/);
    assert.ok(review.fileCount >= 4);
    assert.ok(review.totalBytes > 0);

    await assert.rejects(
      service.install({ workspaceId: spaceOne, workspaceRoot, sourcePath: "apps/inbox", expectedDigest: "0".repeat(64) }),
      /changed after review/i,
    );

    const installed = await service.install({
      workspaceId: spaceOne,
      workspaceRoot,
      sourcePath: "apps/inbox",
      expectedDigest: review.digest,
    });
    assert.equal(installed.digest, review.digest);
    assert.equal(installed.workspaceId, spaceOne);
    assert.deepEqual(installed.networkGrants, [], "installation reviews code but does not implicitly grant network access");
    assert.deepEqual(installed.fileGrants, [], "installation does not implicitly grant Space files");
    assert.deepEqual(installed.notificationGrants, [], "installation does not implicitly grant notifications");
    assert.equal(installed.backgroundEnabled, false, "installation does not implicitly enable background work");
    assert.equal("stagedRoot" in installed, false, "app-data staging paths must remain internal");
    assert.equal(existsSync(join(rootPath, "staged", review.digest, "worker.js")), true);
    assert.match(await readFile(join(rootPath, "staged", review.digest, "worker.js"), "utf8"), /must remain inert/);
    await service.close();
  } finally {
    await rm(sandbox, { recursive: true, force: true });
  }
});

test("RestrictedAppService persists Space-scoped installs and keeps shared staged bytes until the last removal", async () => {
  const sandbox = await mkdtemp(join(tmpdir(), "workspace-restricted-service-persistence-"));
  const workspaceRoot = join(sandbox, "space");
  const rootPath = join(sandbox, "state", "restricted-apps");
  try {
    await writePackage(join(workspaceRoot, "apps", "inbox"));
    const firstRuntime = new RecordingRuntimeHost();
    const first = await RestrictedAppService.create({ rootPath, runtimeHost: firstRuntime });
    const review = await first.inspect({ workspaceId: spaceOne, workspaceRoot, sourcePath: "apps/inbox" });
    await first.install({ workspaceId: spaceOne, workspaceRoot, sourcePath: "apps/inbox", expectedDigest: review.digest });
    await first.install({ workspaceId: spaceTwo, workspaceRoot, sourcePath: "apps/inbox", expectedDigest: review.digest });
    assert.equal((await first.list(spaceOne)).length, 1);
    assert.equal((await first.list(spaceTwo)).length, 1);
    assert.deepEqual(await first.list("ws-3333333333333333"), []);
    await first.close();

    const secondRuntime = new RecordingRuntimeHost();
    const reopened = await RestrictedAppService.create({ rootPath, runtimeHost: secondRuntime });
    assert.equal((await reopened.list(spaceOne))[0]?.digest, review.digest);
    assert.equal((await reopened.list(spaceTwo))[0]?.digest, review.digest);

    assert.equal(await reopened.remove({ workspaceId: spaceOne, appId: "connected-inbox", expectedDigest: review.digest }), true);
    assert.equal(existsSync(join(rootPath, "staged", review.digest)), true, "another Space still references the digest");
    assert.deepEqual(await reopened.list(spaceOne), []);
    assert.equal((await reopened.list(spaceTwo)).length, 1);

    assert.equal(await reopened.remove({ workspaceId: spaceTwo, appId: "connected-inbox", expectedDigest: review.digest }), true);
    assert.equal(existsSync(join(rootPath, "staged", review.digest)), false, "the last removal should collect staged bytes");
    assert.deepEqual(secondRuntime.stops.map(({ workspaceId }) => workspaceId), [spaceOne, spaceTwo]);
    await reopened.close();
  } finally {
    await rm(sandbox, { recursive: true, force: true });
  }
});

test("RestrictedAppService keeps installs idempotent, repairs missing staged bytes, and prevents app-id takeover", async () => {
  const sandbox = await mkdtemp(join(tmpdir(), "workspace-restricted-service-update-"));
  const workspaceRoot = join(sandbox, "space");
  const sourceRoot = join(workspaceRoot, "apps", "inbox");
  const rootPath = join(sandbox, "state", "restricted-apps");
  const runtime = new RecordingRuntimeHost();
  const connections = new MemoryConnectionStore();
  const timestamps = [
    new Date("2026-07-13T12:00:00.000Z"),
    new Date("2026-07-13T12:01:00.000Z"),
  ];
  try {
    await writePackage(sourceRoot);
    const service = await RestrictedAppService.create({
      rootPath,
      runtimeHost: runtime,
      connections,
      now: () => timestamps.shift() ?? new Date("2026-07-13T12:02:00.000Z"),
    });
    const firstReview = await service.inspect({ workspaceId: spaceOne, workspaceRoot, sourcePath: "apps/inbox" });
    const firstInstall = await service.install({ workspaceId: spaceOne, workspaceRoot, sourcePath: "apps/inbox", expectedDigest: firstReview.digest });
    const repeated = await service.install({ workspaceId: spaceOne, workspaceRoot, sourcePath: "apps/inbox", expectedDigest: firstReview.digest });
    assert.deepEqual(repeated, firstInstall);
    assert.deepEqual(runtime.stops, []);

    await rm(join(rootPath, "staged", firstReview.digest), { recursive: true, force: true });
    const repaired = await service.install({ workspaceId: spaceOne, workspaceRoot, sourcePath: "apps/inbox", expectedDigest: firstReview.digest });
    assert.equal(repaired.digest, firstReview.digest);
    assert.equal(existsSync(join(rootPath, "staged", firstReview.digest, "worker.js")), true, "idempotent install must restore a missing staged snapshot");

    await writePackage(sourceRoot, { version: "0.2.0", appSource: "export async function handleAction() { return { count: 2 }; }\n" });
    const updateReview = await service.inspect({ workspaceId: spaceOne, workspaceRoot, sourcePath: "apps/inbox" });
    const updated = await service.install({ workspaceId: spaceOne, workspaceRoot, sourcePath: "apps/inbox", expectedDigest: updateReview.digest });
    assert.equal(updated.installedAt, firstInstall.installedAt);
    assert.notEqual(updated.updatedAt, firstInstall.updatedAt);
    assert.deepEqual(runtime.stops, [{ workspaceId: spaceOne, appId: "connected-inbox", digest: firstReview.digest }]);
    assert.equal(existsSync(join(rootPath, "staged", firstReview.digest)), false);
    assert.deepEqual(connections.deletedApps, [{ workspaceId: spaceOne, appId: "connected-inbox", digest: firstReview.digest }]);

    await writePackage(join(workspaceRoot, "apps", "takeover"), { packageName: "different-package" });
    const takeover = await service.inspect({ workspaceId: spaceOne, workspaceRoot, sourcePath: "apps/takeover" });
    await assert.rejects(
      service.install({ workspaceId: spaceOne, workspaceRoot, sourcePath: "apps/takeover", expectedDigest: takeover.digest }),
      (error: unknown) => errorCode(error) === "INPUT_INVALID" && /different package already owns/i.test(errorMessage(error)),
    );
    assert.equal((await service.list(spaceOne))[0]?.digest, updateReview.digest);
    await service.close();
  } finally {
    await rm(sandbox, { recursive: true, force: true });
  }
});

test("RestrictedAppService delegates declared actions with the installed owner and binds connections to Space, app, digest, destination, and origin", async () => {
  const sandbox = await mkdtemp(join(tmpdir(), "workspace-restricted-service-runtime-"));
  const workspaceRoot = join(sandbox, "space");
  const rootPath = join(sandbox, "state", "restricted-apps");
  const runtime = new RecordingRuntimeHost();
  const connections = new MemoryConnectionStore();
  try {
    await writePackage(join(workspaceRoot, "apps", "inbox"));
    const service = await RestrictedAppService.create({ rootPath, runtimeHost: runtime, connections });
    const review = await service.inspect({ workspaceId: spaceOne, workspaceRoot, sourcePath: "apps/inbox" });
    await service.install({ workspaceId: spaceOne, workspaceRoot, sourcePath: "apps/inbox", expectedDigest: review.digest });

    assert.deepEqual(await service.connectionStatus(spaceOne, "connected-inbox", review.digest), [{
      destinationId: "mail-api",
      kind: null,
      configured: false,
    }]);
    const credential = { kind: "api-key" as const, value: "secret-value" };
    assert.deepEqual(await service.setConnection({
      workspaceId: spaceOne,
      appId: "connected-inbox",
      expectedDigest: review.digest,
      destinationId: "mail-api",
      credential,
    }), { destinationId: "mail-api", kind: "api-key", configured: true });
    assert.deepEqual(connections.setBindings, [{
      binding: {
        workspaceId: spaceOne,
        appId: "connected-inbox",
        digest: review.digest,
        destinationId: "mail-api",
        origin: "https://mail.example.com",
      },
      credential,
    }]);
    assert.deepEqual(await service.connectionStatus(spaceOne, "connected-inbox", review.digest), [{
      destinationId: "mail-api",
      kind: "api-key",
      configured: true,
    }]);

    const granted = await service.grantNetwork({
      workspaceId: spaceOne,
      appId: "connected-inbox",
      expectedDigest: review.digest,
      destinationId: "mail-api",
    });
    assert.deepEqual(granted.networkGrants, ["mail-api"]);
    assert.deepEqual((await service.list(spaceOne))[0]?.networkGrants, ["mail-api"], "the explicit grant must be durable");

    const result = await service.invoke({
      workspaceId: spaceOne,
      appId: "connected-inbox",
      expectedDigest: review.digest,
      action: "search",
      input: { query: "invoice" },
    });
    assert.deepEqual(result, { count: 7 });
    assert.equal(runtime.invocations.length, 1);
    assert.equal(runtime.invocations[0]?.app.workspaceId, spaceOne);
    assert.equal(runtime.invocations[0]?.app.digest, review.digest);
    assert.deepEqual(runtime.invocations[0]?.app.networkGrants, ["mail-api"]);
    assert.equal(runtime.invocations[0]?.app.stagedRoot, join(rootPath, "staged", review.digest));
    assert.equal(isAbsolute(runtime.invocations[0]?.app.stagedRoot ?? ""), true);
    assert.equal(runtime.invocations[0]?.action, "search");
    assert.deepEqual(runtime.invocations[0]?.input, { query: "invoice" });

    await assert.rejects(
      service.invoke({ workspaceId: spaceOne, appId: "connected-inbox", expectedDigest: review.digest, action: "undeclared", input: {} }),
      (error: unknown) => errorCode(error) === "ACTION_UNKNOWN",
    );
    const revoked = await service.revokeNetwork({
      workspaceId: spaceOne,
      appId: "connected-inbox",
      expectedDigest: review.digest,
      destinationId: "mail-api",
    });
    assert.deepEqual(revoked.networkGrants, []);
    assert.deepEqual(runtime.stops, [
      { workspaceId: spaceOne, appId: "connected-inbox", digest: review.digest },
      { workspaceId: spaceOne, appId: "connected-inbox", digest: review.digest },
    ], "grant and revoke both stop the old runtime owner before changing its permissions");
    assert.equal(await service.deleteConnection({
      workspaceId: spaceOne,
      appId: "connected-inbox",
      expectedDigest: review.digest,
      destinationId: "mail-api",
    }), true);
    assert.deepEqual(connections.deleteBindings, [{
      workspaceId: spaceOne,
      appId: "connected-inbox",
      digest: review.digest,
      destinationId: "mail-api",
      origin: "https://mail.example.com",
    }]);
    await service.close();
    assert.equal(runtime.closeCount, 1);
  } finally {
    await rm(sandbox, { recursive: true, force: true });
  }
});

test("RestrictedAppService keeps storage across reviewed updates while resetting file, notification, and background authority", async () => {
  const sandbox = await mkdtemp(join(tmpdir(), "workspace-restricted-service-powers-"));
  const workspaceRoot = join(sandbox, "space");
  const sourceRoot = join(workspaceRoot, "apps", "inbox");
  const rootPath = join(sandbox, "state", "restricted-apps");
  const storage = new FileRestrictedAppStorage(join(rootPath, "data"));
  const runtime = new RecordingRuntimeHost();
  const owner = { workspaceId: spaceOne, appId: "connected-inbox" };
  try {
    await writePackage(sourceRoot);
    const service = await RestrictedAppService.create({ rootPath, runtimeHost: runtime, storage });
    const review = await service.inspect({ workspaceId: spaceOne, workspaceRoot, sourcePath: "apps/inbox" });
    await service.install({ workspaceId: spaceOne, workspaceRoot, sourcePath: "apps/inbox", expectedDigest: review.digest });
    await storage.set(owner, "view", { folder: "inbox" });

    await assert.rejects(service.grantFiles({
      workspaceId: spaceOne,
      workspaceRoot,
      appId: "connected-inbox",
      expectedDigest: review.digest,
      permissionId: "exports",
      root: "missing-reports",
    }), (error: unknown) => errorCode(error) === "FILE_DENIED");
    await mkdir(join(workspaceRoot, "reports"), { recursive: true });

    const withFiles = await service.grantFiles({
      workspaceId: spaceOne,
      workspaceRoot,
      appId: "connected-inbox",
      expectedDigest: review.digest,
      permissionId: "exports",
      root: "reports",
    });
    assert.deepEqual(withFiles.fileGrants, [{ id: "exports", declarationId: "exports", root: "reports", access: "read-write" }]);
    const withNotifications = await service.grantNotifications({
      workspaceId: spaceOne,
      appId: "connected-inbox",
      expectedDigest: review.digest,
      permissionId: "new-mail",
    });
    assert.deepEqual(withNotifications.notificationGrants, ["new-mail"]);
    const enabled = await service.setBackgroundEnabled({
      workspaceId: spaceOne,
      appId: "connected-inbox",
      expectedDigest: review.digest,
      enabled: true,
    });
    assert.equal(enabled.backgroundEnabled, true);
    const ran = await service.runBackgroundNow({ workspaceId: spaceOne, appId: "connected-inbox", expectedDigest: review.digest });
    assert.equal(runtime.backgroundRuns.length, 1);
    assert.equal(runtime.backgroundRuns[0]?.event.reason, "manual");
    assert.deepEqual(runtime.backgroundRuns[0]?.app.notificationGrants, ["new-mail"]);
    assert.ok(ran.backgroundLastRunAt);

    await writePackage(sourceRoot, { version: "0.2.0", appSource: "export async function handleAction() { return { count: 2 }; }\nexport async function handleBackground() {}\n" });
    const nextReview = await service.inspect({ workspaceId: spaceOne, workspaceRoot, sourcePath: "apps/inbox" });
    const updated = await service.install({ workspaceId: spaceOne, workspaceRoot, sourcePath: "apps/inbox", expectedDigest: nextReview.digest });
    assert.deepEqual(updated.fileGrants, []);
    assert.deepEqual(updated.notificationGrants, []);
    assert.equal(updated.backgroundEnabled, false);
    assert.deepEqual(await storage.get(owner, "view"), { folder: "inbox" }, "same app storage survives a reviewed digest update");

    await service.remove({ workspaceId: spaceOne, appId: "connected-inbox", expectedDigest: nextReview.digest });
    assert.equal((await storage.usage(owner)).keyCount, 0, "uninstall deletes machine-local app storage");
    await service.close();
  } finally {
    await rm(sandbox, { recursive: true, force: true });
  }
});

test("RestrictedAppService removes machine-local app state for only the removed Space", async () => {
  const sandbox = await mkdtemp(join(tmpdir(), "workspace-restricted-service-space-removal-"));
  const workspaceRoot = join(sandbox, "space");
  const rootPath = join(sandbox, "state", "restricted-apps");
  const storage = new FileRestrictedAppStorage(join(rootPath, "data"));
  try {
    await writePackage(join(workspaceRoot, "apps", "inbox"));
    const service = await RestrictedAppService.create({ rootPath, storage });
    const review = await service.inspect({ workspaceId: spaceOne, workspaceRoot, sourcePath: "apps/inbox" });
    await service.install({ workspaceId: spaceOne, workspaceRoot, sourcePath: "apps/inbox", expectedDigest: review.digest });
    await service.install({ workspaceId: spaceTwo, workspaceRoot, sourcePath: "apps/inbox", expectedDigest: review.digest });
    await storage.set({ workspaceId: spaceOne, appId: "connected-inbox" }, "owner", "one");
    await storage.set({ workspaceId: spaceTwo, appId: "connected-inbox" }, "owner", "two");

    await service.removeWorkspace(spaceOne);
    assert.deepEqual(await service.list(spaceOne), []);
    assert.equal((await storage.usage({ workspaceId: spaceOne, appId: "connected-inbox" })).keyCount, 0);
    assert.equal(await storage.get({ workspaceId: spaceTwo, appId: "connected-inbox" }, "owner"), "two");
    assert.equal((await service.list(spaceTwo)).length, 1);
    assert.equal(existsSync(join(rootPath, "staged", review.digest)), true);

    await service.removeWorkspace(spaceTwo);
    assert.equal((await storage.usage({ workspaceId: spaceTwo, appId: "connected-inbox" })).keyCount, 0);
    assert.equal(existsSync(join(rootPath, "staged", review.digest)), false);
    await service.close();
  } finally {
    await rm(sandbox, { recursive: true, force: true });
  }
});

test("RestrictedAppService re-reads notification grants after a queued background run acquires a global slot", async () => {
  const sandbox = await mkdtemp(join(tmpdir(), "workspace-restricted-service-background-slot-"));
  const workspaceRoot = join(sandbox, "space");
  const rootPath = join(sandbox, "state", "restricted-apps");
  const runtime = new QueuedNotificationRuntimeHost();
  try {
    await writePackage(join(workspaceRoot, "apps", "inbox"));
    const service = await RestrictedAppService.create({ rootPath, runtimeHost: runtime });
    const review = await service.inspect({ workspaceId: spaceOne, workspaceRoot, sourcePath: "apps/inbox" });
    for (const workspaceId of [spaceOne, spaceTwo, spaceThree]) {
      await service.install({ workspaceId, workspaceRoot, sourcePath: "apps/inbox", expectedDigest: review.digest });
      await service.grantNotifications({ workspaceId, appId: "connected-inbox", expectedDigest: review.digest, permissionId: "new-mail" });
      await service.setBackgroundEnabled({ workspaceId, appId: "connected-inbox", expectedDigest: review.digest, enabled: true });
    }
    const first = service.runBackgroundNow({ workspaceId: spaceOne, appId: "connected-inbox", expectedDigest: review.digest });
    const second = service.runBackgroundNow({ workspaceId: spaceTwo, appId: "connected-inbox", expectedDigest: review.digest });
    await runtime.waitForStarts(2);
    const queued = service.runBackgroundNow({ workspaceId: spaceThree, appId: "connected-inbox", expectedDigest: review.digest });
    await service.revokeNotifications({ workspaceId: spaceThree, appId: "connected-inbox", expectedDigest: review.digest, permissionId: "new-mail" });
    runtime.releaseOne();
    await assert.rejects(queued, /notification category is not granted/i);
    runtime.releaseOne();
    await Promise.all([first, second]);
    assert.deepEqual(runtime.notificationsShown.sort(), [spaceOne, spaceTwo]);
    assert.deepEqual(runtime.notificationsDenied, [spaceThree]);
    await service.close();
  } finally {
    runtime.closeBroker();
    await rm(sandbox, { recursive: true, force: true });
  }
});

test("RestrictedAppService starts every Space app stop together and preserves state if any stop fails", async () => {
  const sandbox = await mkdtemp(join(tmpdir(), "workspace-restricted-service-remove-failure-"));
  const workspaceRoot = join(sandbox, "space");
  const rootPath = join(sandbox, "state", "restricted-apps");
  const runtime = new RejectingStopRuntimeHost("second-inbox");
  try {
    await writePackage(join(workspaceRoot, "apps", "inbox"));
    await writePackage(join(workspaceRoot, "apps", "second"), { packageName: "second-inbox", appId: "second-inbox" });
    const service = await RestrictedAppService.create({ rootPath, runtimeHost: runtime });
    for (const sourcePath of ["apps/inbox", "apps/second"]) {
      const review = await service.inspect({ workspaceId: spaceOne, workspaceRoot, sourcePath });
      await service.install({ workspaceId: spaceOne, workspaceRoot, sourcePath, expectedDigest: review.digest });
    }
    await assert.rejects(service.removeWorkspace(spaceOne), /stop failed/);
    assert.deepEqual(runtime.stops.sort(), ["connected-inbox", "second-inbox"]);
    assert.deepEqual((await service.list(spaceOne)).map((app) => app.manifest.id).sort(), ["connected-inbox", "second-inbox"]);
    await service.close();
  } finally {
    await rm(sandbox, { recursive: true, force: true });
  }
});

test("RestrictedAppService fails closed when its durable registry is corrupt", async () => {
  const sandbox = await mkdtemp(join(tmpdir(), "workspace-restricted-service-corrupt-"));
  const rootPath = join(sandbox, "restricted-apps");
  try {
    await mkdir(join(rootPath, "staged"), { recursive: true });
    await writeFile(join(rootPath, "registry.json"), "{not-json", "utf8");
    await assert.rejects(
      RestrictedAppService.create({ rootPath }),
      /could not read the restricted app registry/i,
    );
  } finally {
    await rm(sandbox, { recursive: true, force: true });
  }
});

test("RestrictedAppService confines package sources to normal visible directories inside the Space", async (t) => {
  const sandbox = await mkdtemp(join(tmpdir(), "workspace-restricted-service-paths-"));
  const workspaceRoot = join(sandbox, "space");
  const rootPath = join(sandbox, "state", "restricted-apps");
  const outsideRoot = join(sandbox, "outside-app");
  try {
    await writePackage(join(workspaceRoot, "apps", "inbox"));
    await writePackage(join(workspaceRoot, ".pi", "hidden-app"));
    await writePackage(join(workspaceRoot, ".workspace", "hidden-app"));
    await writePackage(outsideRoot);
    const service = await RestrictedAppService.create({ rootPath });
    assert.equal((await service.inspect({ workspaceId: spaceOne, workspaceRoot, sourcePath: "apps/inbox" })).manifest.id, "connected-inbox");

    for (const sourcePath of [outsideRoot, "../outside-app", ".pi/hidden-app", ".workspace/hidden-app", ".", ""]) {
      await assert.rejects(
        service.inspect({ workspaceId: spaceOne, workspaceRoot, sourcePath }),
        (error: unknown) => errorCode(error) === "INPUT_INVALID",
        sourcePath || "<empty>",
      );
    }

    const linkedPath = join(workspaceRoot, "apps", "linked-outside");
    try {
      await symlink(outsideRoot, linkedPath, process.platform === "win32" ? "junction" : "dir");
      await assert.rejects(
        service.inspect({ workspaceId: spaceOne, workspaceRoot, sourcePath: "apps/linked-outside" }),
        (error: unknown) => errorCode(error) === "INPUT_INVALID" && /link|escapes the Space/i.test(errorMessage(error)),
      );
    } catch (error) {
      const code = error && typeof error === "object" && "code" in error ? (error as NodeJS.ErrnoException).code : undefined;
      if (code === "EPERM" || code === "EACCES") t.diagnostic("Link confinement assertion skipped because this Windows host disallows directory links.");
      else throw error;
    }
    await service.close();
  } finally {
    await rm(sandbox, { recursive: true, force: true });
  }
});

class RecordingRuntimeHost implements RestrictedAppRuntimeHost {
  readonly invocations: Array<{ app: RestrictedAppRuntimeDescriptor; action: string; input: unknown }> = [];
  readonly backgroundRuns: Array<{ app: RestrictedAppRuntimeDescriptor; event: { reason: "scheduled" | "manual" | "resume"; scheduledAt: string } }> = [];
  readonly stops: Array<{ workspaceId: string; appId: string; digest?: string }> = [];
  closeCount = 0;

  async invoke(app: RestrictedAppRuntimeDescriptor, action: string, input: unknown): Promise<unknown> {
    this.invocations.push({ app: structuredClone(app), action, input: structuredClone(input) });
    return { count: 7 };
  }

  async runBackground(app: RestrictedAppRuntimeDescriptor, event: { reason: "scheduled" | "manual" | "resume"; scheduledAt: string }): Promise<void> {
    this.backgroundRuns.push({ app: structuredClone(app), event: structuredClone(event) });
  }

  async stop(workspaceId: string, appId: string, digest?: string): Promise<void> {
    this.stops.push({ workspaceId, appId, ...(digest ? { digest } : {}) });
  }

  async close(): Promise<void> {
    this.closeCount += 1;
  }
}

class QueuedNotificationRuntimeHost implements RestrictedAppRuntimeHost {
  readonly notificationsShown: string[] = [];
  readonly notificationsDenied: string[] = [];
  readonly #releases: Array<() => void> = [];
  readonly #broker = new RestrictedAppNotificationBroker({
    sink: {
      isSupported: () => true,
      show: (notification, callbacks) => {
        this.notificationsShown.push(notification.workspaceId);
        return { close: callbacks.onClose };
      },
    },
  });
  #started = 0;

  async invoke(): Promise<unknown> { return {}; }

  async runBackground(app: RestrictedAppRuntimeDescriptor): Promise<void> {
    this.#started += 1;
    if (this.#started <= 2) await new Promise<void>((resolvePromise) => this.#releases.push(resolvePromise));
    try {
      this.#broker.show({
        workspaceId: app.workspaceId,
        appId: app.manifest.id,
        digest: app.digest,
        appTitle: app.manifest.title,
        declarations: app.manifest.permissions.notifications,
        grants: app.notificationGrants,
        backgroundEnabled: app.backgroundEnabled,
        invocationId: `background-${app.workspaceId}`,
      }, { permissionId: "new-mail" }, () => undefined);
    } catch (error) {
      this.notificationsDenied.push(app.workspaceId);
      throw error;
    }
  }

  async waitForStarts(count: number): Promise<void> {
    for (let attempt = 0; this.#started < count && attempt < 100; attempt += 1) await new Promise((resolvePromise) => setTimeout(resolvePromise, 5));
    assert.equal(this.#started, count);
  }

  releaseOne(): void { this.#releases.shift()?.(); }
  async stop(): Promise<void> {}
  async close(): Promise<void> {}
  closeBroker(): void { this.#broker.dispose(); }
}

class RejectingStopRuntimeHost implements RestrictedAppRuntimeHost {
  readonly stops: string[] = [];
  constructor(readonly rejectedAppId: string) {}
  async invoke(): Promise<unknown> { return {}; }
  async stop(_workspaceId: string, appId: string): Promise<void> {
    this.stops.push(appId);
    if (appId === this.rejectedAppId) throw new Error("stop failed");
  }
  async close(): Promise<void> {}
}

class MemoryConnectionStore implements RestrictedAppConnectionStore {
  readonly records = new Map<string, RestrictedAppCredential>();
  readonly setBindings: Array<{ binding: RestrictedAppConnectionBinding; credential: RestrictedAppCredential }> = [];
  readonly deleteBindings: RestrictedAppConnectionBinding[] = [];
  readonly deletedApps: RestrictedAppConnectionOwner[] = [];

  async get(binding: RestrictedAppConnectionBinding): Promise<RestrictedAppCredential | undefined> {
    return structuredClone(this.records.get(connectionKey(binding)));
  }

  async set(binding: RestrictedAppConnectionBinding, credential: RestrictedAppCredential): Promise<void> {
    this.setBindings.push({ binding: structuredClone(binding), credential: structuredClone(credential) });
    this.records.set(connectionKey(binding), structuredClone(credential));
  }

  async delete(binding: RestrictedAppConnectionBinding): Promise<boolean> {
    this.deleteBindings.push(structuredClone(binding));
    return this.records.delete(connectionKey(binding));
  }

  async deleteApp(owner: RestrictedAppConnectionOwner): Promise<void> {
    this.deletedApps.push(structuredClone(owner));
    const prefix = JSON.stringify([owner.workspaceId, owner.appId, owner.digest]).slice(0, -1);
    for (const key of this.records.keys()) if (key.startsWith(prefix)) this.records.delete(key);
  }
}

async function writePackage(root: string, options: {
  packageName?: string;
  version?: string;
  appId?: string;
  appSource?: string;
} = {}): Promise<void> {
  const packageName = options.packageName ?? "connected-inbox";
  const version = options.version ?? "0.1.0";
  const appId = options.appId ?? "connected-inbox";
  await mkdir(root, { recursive: true });
  await writeFile(join(root, "package.json"), JSON.stringify({
    name: packageName,
    version,
    private: true,
    type: "module",
    agentApp: "agent-app.json",
  }), "utf8");
  await writeFile(join(root, "agent-app.json"), JSON.stringify({
    version: 1,
    id: appId,
    title: "Connected inbox",
    runtime: { kind: "sandboxed-web", entry: "index.html", worker: "worker.js" },
    ui: { icon: "mail" },
    tools: [{
      name: "inbox_search",
      description: "Search the connected inbox.",
      action: "search",
      inputSchema: {
        type: "object",
        properties: { query: { type: "string", maxLength: 500 } },
        required: ["query"],
        additionalProperties: false,
      },
      resultSchema: {
        type: "object",
        properties: { count: { type: "integer", minimum: 0 } },
        required: ["count"],
        additionalProperties: false,
      },
    }],
    background: { intervalMinutes: 30 },
    permissions: {
      files: [{ id: "exports", target: "directory", access: "read-write" }],
      notifications: [{ id: "new-mail", title: "New mail", description: "New messages are ready." }],
      network: [{
        id: "mail-api",
        target: { kind: "public-https", origin: "https://mail.example.com" },
        methods: ["GET"],
        auth: [{ kind: "api-key", header: "x-api-key" }],
      }],
    },
  }), "utf8");
  await writeFile(join(root, "index.html"), "<!doctype html><script type=module src=app.js></script>", "utf8");
  await writeFile(join(root, "app.js"), "export {};\n", "utf8");
  await writeFile(join(root, "worker.js"), options.appSource ?? "// This code must remain inert during review and installation.\nexport async function handleAction() { return { count: 0 }; }\n", "utf8");
}

function connectionKey(binding: RestrictedAppConnectionBinding): string {
  return JSON.stringify([binding.workspaceId, binding.appId, binding.digest, binding.destinationId, binding.origin]);
}

function errorCode(error: unknown): string | undefined {
  return error && typeof error === "object" && "code" in error ? String((error as { code: unknown }).code) : undefined;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
