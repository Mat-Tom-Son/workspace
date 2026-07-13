import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { lstat, mkdir, readFile, readdir, realpath, rename, rm, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

import {
  normalizeRestrictedAppCredential,
  RestrictedAppError,
  type RestrictedAppConnectionStatus,
  type RestrictedAppConnectionOwner,
  type RestrictedAppConnectionStore,
  type RestrictedAppCredential,
} from "./restricted-app-connections.js";
import { parseRestrictedAppManifest, restrictedAppNetworkOrigin, type RestrictedAppManifest } from "./restricted-app-manifest.js";
import { RestrictedAppFileBroker, type RestrictedAppFileGrant } from "./restricted-app-files.js";
import type { FileRestrictedAppStorage, RestrictedAppStorageUsage } from "./restricted-app-storage.js";
import { RestrictedAppOAuthError, type RestrictedAppOAuthPkceClient } from "./restricted-app-oauth.js";
import {
  inspectRestrictedAppPackage,
  stageRestrictedAppPackage,
} from "./restricted-app-package.js";
export interface RestrictedAppReview {
  packageName: string;
  version: string;
  digest: string;
  manifest: RestrictedAppManifest;
  fileCount: number;
  totalBytes: number;
}

export interface RestrictedAppInstalled extends RestrictedAppReview {
  workspaceId: string;
  networkGrants: string[];
  fileGrants: RestrictedAppFileGrant[];
  notificationGrants: string[];
  backgroundEnabled: boolean;
  backgroundLastRunAt?: string;
  backgroundLastError?: string;
  installedAt: string;
  updatedAt: string;
}

export interface RestrictedAppRuntimeDescriptor extends RestrictedAppInstalled {
  stagedRoot: string;
}

export interface RestrictedAppRuntimeHost {
  invoke(app: RestrictedAppRuntimeDescriptor, action: string, input: unknown): Promise<unknown>;
  runBackground?(app: RestrictedAppRuntimeDescriptor, event: { reason: "scheduled" | "manual" | "resume"; scheduledAt: string }): Promise<void>;
  suspend?(): void;
  resume?(): void;
  stop(workspaceId: string, appId: string, digest?: string): Promise<void>;
  close(): Promise<void>;
}

export interface RestrictedAppServiceOptions {
  rootPath: string;
  runtimeHost?: RestrictedAppRuntimeHost;
  connections?: RestrictedAppConnectionStore;
  storage?: FileRestrictedAppStorage;
  oauth?: RestrictedAppOAuthPkceClient;
  now?: () => Date;
}

interface RestrictedAppRegistryFile {
  schemaVersion: 1;
  apps: RestrictedAppRegistryEntry[];
}

interface RestrictedAppRegistryEntry {
  workspaceId: string;
  packageName: string;
  version: string;
  digest: string;
  manifest: RestrictedAppManifest;
  networkGrants: string[];
  fileGrants: RestrictedAppFileGrant[];
  notificationGrants: string[];
  backgroundEnabled: boolean;
  backgroundLastRunAt?: string;
  backgroundLastError?: string;
  fileCount: number;
  totalBytes: number;
  installedAt: string;
  updatedAt: string;
}

export class RestrictedAppService {
  readonly #rootPath: string;
  readonly #registryPath: string;
  readonly #stagingPath: string;
  readonly #runtimeHost?: RestrictedAppRuntimeHost;
  readonly #connections?: RestrictedAppConnectionStore;
  readonly #storage?: FileRestrictedAppStorage;
  readonly #oauth?: RestrictedAppOAuthPkceClient;
  readonly #now: () => Date;
  #registry: RestrictedAppRegistryFile;
  #queue: Promise<void> = Promise.resolve();
  readonly #backgroundTimers = new Map<string, NodeJS.Timeout>();
  readonly #backgroundWaiters: Array<() => void> = [];
  #backgroundActive = 0;
  #backgroundSuspended = false;
  #closed = false;

  private constructor(options: RestrictedAppServiceOptions, registry: RestrictedAppRegistryFile) {
    this.#rootPath = resolve(options.rootPath);
    this.#registryPath = join(this.#rootPath, "registry.json");
    this.#stagingPath = join(this.#rootPath, "staged");
    this.#runtimeHost = options.runtimeHost;
    this.#connections = options.connections;
    this.#storage = options.storage;
    this.#oauth = options.oauth;
    this.#now = options.now ?? (() => new Date());
    this.#registry = registry;
  }

  static async create(options: RestrictedAppServiceOptions): Promise<RestrictedAppService> {
    const rootPath = resolve(options.rootPath);
    await mkdir(join(rootPath, "staged"), { recursive: true });
    const registry = await readRegistry(join(rootPath, "registry.json"));
    const service = new RestrictedAppService(options, registry);
    await service.#cleanupStaging();
    service.#scheduleAllBackgroundApps(true);
    return service;
  }

  async inspect(input: { workspaceId: string; workspaceRoot: string; sourcePath: string }): Promise<RestrictedAppReview> {
    this.#assertOpen();
    const sourceRoot = await restrictedSourceRoot(input.workspaceRoot, input.sourcePath);
    const inspection = await inspectRestrictedAppPackage(sourceRoot);
    return reviewFromInspection(inspection);
  }

  async list(workspaceId: string): Promise<RestrictedAppInstalled[]> {
    this.#assertOpen();
    await this.#queue.catch(() => undefined);
    return this.#registry.apps
      .filter((item) => item.workspaceId === workspaceId)
      .sort((left, right) => left.manifest.title.localeCompare(right.manifest.title) || left.manifest.id.localeCompare(right.manifest.id))
      .map(copyInstalled);
  }

  async runtimeDescriptor(workspaceId: string, appId: string, expectedDigest: string): Promise<RestrictedAppRuntimeDescriptor> {
    this.#assertOpen();
    await this.#queue.catch(() => undefined);
    const app = this.#installed(workspaceId, appId, expectedDigest);
    return { ...app, stagedRoot: this.#digestRoot(app.digest) };
  }

  async install(input: {
    workspaceId: string;
    workspaceRoot: string;
    sourcePath: string;
    expectedDigest: string;
  }): Promise<RestrictedAppInstalled> {
    return await this.#mutate(async () => {
      const expectedDigest = digestValue(input.expectedDigest);
      const sourceRoot = await restrictedSourceRoot(input.workspaceRoot, input.sourcePath);
      const inspection = await inspectRestrictedAppPackage(sourceRoot);
      if (inspection.digest !== expectedDigest) throw new RestrictedAppError("REVISION_CHANGED", "The package changed after review. Review the new revision before installing it.");
      const existing = this.#registry.apps.find((item) => item.workspaceId === input.workspaceId && item.manifest.id === inspection.manifest.id);
      if (existing?.digest === inspection.digest) {
        try {
          await stageRestrictedAppPackage(sourceRoot, this.#stagingPath, expectedDigest);
        } catch (error) {
          throw new RestrictedAppError("REVISION_CHANGED", errorMessage(error));
        }
        return copyInstalled(existing);
      }
      if (existing && existing.packageName !== inspection.packageName) {
        throw new RestrictedAppError("INPUT_INVALID", "A different package already owns this restricted app id in the Space.");
      }
      let staged: Awaited<ReturnType<typeof stageRestrictedAppPackage>>;
      try {
        staged = await stageRestrictedAppPackage(sourceRoot, this.#stagingPath, expectedDigest);
      } catch (error) {
        throw new RestrictedAppError("REVISION_CHANGED", errorMessage(error));
      }
      if (staged.digest !== expectedDigest) throw new RestrictedAppError("REVISION_CHANGED", "The package changed while it was being staged.");
      if (existing) await this.#runtimeHost?.stop(input.workspaceId, existing.manifest.id, existing.digest);
      const timestamp = this.#now().toISOString();
      const entry: RestrictedAppRegistryEntry = {
        workspaceId: input.workspaceId,
        packageName: staged.packageName,
        version: staged.version,
        digest: staged.digest,
        manifest: structuredClone(staged.manifest),
        networkGrants: [],
        fileGrants: [],
        notificationGrants: [],
        backgroundEnabled: false,
        fileCount: staged.fileCount,
        totalBytes: staged.totalBytes,
        installedAt: existing?.installedAt ?? timestamp,
        updatedAt: timestamp,
      };
      const next = this.#registry.apps.filter((item) => !(item.workspaceId === input.workspaceId && item.manifest.id === entry.manifest.id));
      next.push(entry);
      await this.#writeRegistry({ schemaVersion: 1, apps: next });
      if (existing) {
        this.#clearBackground(existing.workspaceId, existing.manifest.id);
        await this.#connections?.deleteApp(ownerFromEntry(existing));
        await this.#garbageCollectDigest(existing.digest);
      }
      return copyInstalled(entry);
    });
  }

  async remove(input: { workspaceId: string; appId: string; expectedDigest?: string }): Promise<boolean> {
    return await this.#mutate(async () => {
      const appId = appIdValue(input.appId);
      const existing = this.#registry.apps.find((item) => item.workspaceId === input.workspaceId && item.manifest.id === appId);
      if (!existing) return false;
      if (input.expectedDigest !== undefined && digestValue(input.expectedDigest) !== existing.digest) {
        throw new RestrictedAppError("REVISION_CHANGED", "The installed app revision changed. Refresh before removing it.");
      }
      await this.#runtimeHost?.stop(input.workspaceId, appId, existing.digest);
      this.#clearBackground(input.workspaceId, appId);
      await this.#writeRegistry({
        schemaVersion: 1,
        apps: this.#registry.apps.filter((item) => item !== existing),
      });
      await this.#connections?.deleteApp(ownerFromEntry(existing));
      await this.#storage?.deleteApp({ workspaceId: existing.workspaceId, appId: existing.manifest.id });
      await this.#garbageCollectDigest(existing.digest);
      return true;
    });
  }

  async removeWorkspace(workspaceId: string): Promise<void> {
    await this.#mutate(async () => {
      const removed = this.#registry.apps.filter((item) => item.workspaceId === workspaceId);
      if (!removed.length) return;
      await Promise.all(removed.map((app) => this.#runtimeHost?.stop(workspaceId, app.manifest.id, app.digest)));
      for (const app of removed) this.#clearBackground(workspaceId, app.manifest.id);
      await this.#writeRegistry({ schemaVersion: 1, apps: this.#registry.apps.filter((item) => item.workspaceId !== workspaceId) });
      for (const app of removed) {
        await this.#connections?.deleteApp(ownerFromEntry(app));
        await this.#storage?.deleteApp({ workspaceId: app.workspaceId, appId: app.manifest.id });
        await this.#garbageCollectDigest(app.digest);
      }
    });
  }

  async invoke(input: { workspaceId: string; appId: string; expectedDigest: string; action: string; input: unknown }): Promise<unknown> {
    this.#assertOpen();
    await this.#queue.catch(() => undefined);
    if (!this.#runtimeHost) throw new RestrictedAppError("APP_UNAVAILABLE", "Restricted apps can run only in the Workspace desktop host.");
    const app = this.#installed(input.workspaceId, input.appId, input.expectedDigest);
    const action = app.manifest.tools.find((tool) => tool.action === input.action)?.action;
    if (!action) throw new RestrictedAppError("ACTION_UNKNOWN", "The restricted app action is not declared.");
    return await this.#runtimeHost.invoke({ ...app, stagedRoot: this.#digestRoot(app.digest) }, action, input.input);
  }

  async connectionStatus(workspaceId: string, appId: string, expectedDigest: string): Promise<RestrictedAppConnectionStatus[]> {
    this.#assertOpen();
    const app = this.#installed(workspaceId, appId, expectedDigest);
    return await Promise.all(app.manifest.permissions.network.map(async (destination) => {
      const none = destination.auth.some((item) => item.kind === "none");
      if (none) return { destinationId: destination.id, kind: "none" as const, configured: true };
      const credential = await this.#connections?.get({ ...ownerFromEntry(app), destinationId: destination.id, origin: restrictedAppNetworkOrigin(destination) });
      return {
        destinationId: destination.id,
        kind: credential?.kind ?? null,
        configured: Boolean(credential),
      };
    }));
  }

  async setConnection(input: { workspaceId: string; appId: string; expectedDigest: string; destinationId: string; credential: unknown }): Promise<RestrictedAppConnectionStatus> {
    this.#assertOpen();
    if (!this.#connections) throw new RestrictedAppError("APP_UNAVAILABLE", "Encrypted app connections require the Workspace desktop host.");
    const app = this.#installed(input.workspaceId, input.appId, input.expectedDigest);
    const destination = app.manifest.permissions.network.find((item) => item.id === input.destinationId);
    if (!destination) throw new RestrictedAppError("NETWORK_DENIED", "The app did not declare this connection destination.");
    let credential: RestrictedAppCredential;
    try {
      credential = normalizeRestrictedAppCredential(input.credential);
    } catch (error) {
      throw new RestrictedAppError("INPUT_INVALID", errorMessage(error));
    }
    if (credential.kind === "oauth2-pkce") throw new RestrictedAppError("INPUT_INVALID", "OAuth tokens can be created only by Workspace's browser sign-in flow.");
    if (!destination.auth.some((item) => item.kind === credential.kind)) throw new RestrictedAppError("AUTH_REQUIRED", "This connection type is not accepted by the app revision.");
    await this.#connections.set({ ...ownerFromEntry(app), destinationId: destination.id, origin: restrictedAppNetworkOrigin(destination) }, credential);
    return { destinationId: destination.id, kind: credential.kind, configured: true };
  }

  async deleteConnection(input: { workspaceId: string; appId: string; expectedDigest: string; destinationId: string }): Promise<boolean> {
    this.#assertOpen();
    if (!this.#connections) return false;
    const app = this.#installed(input.workspaceId, input.appId, input.expectedDigest);
    const destination = app.manifest.permissions.network.find((item) => item.id === input.destinationId);
    if (!destination) return false;
    return await this.#connections.delete({ ...ownerFromEntry(app), destinationId: destination.id, origin: restrictedAppNetworkOrigin(destination) });
  }

  async connectOAuth(input: { workspaceId: string; appId: string; expectedDigest: string; destinationId: string }): Promise<RestrictedAppConnectionStatus> {
    this.#assertOpen();
    if (!this.#oauth) throw new RestrictedAppError("APP_UNAVAILABLE", "OAuth browser sign-in requires the Workspace desktop host.");
    const app = this.#installed(input.workspaceId, input.appId, input.expectedDigest);
    const destination = app.manifest.permissions.network.find((item) => item.id === input.destinationId);
    const declaration = destination?.auth.find((item) => item.kind === "oauth2-pkce");
    if (!destination || destination.target.kind !== "public-https" || !declaration) {
      throw new RestrictedAppError("AUTH_REQUIRED", "This app destination does not declare OAuth browser sign-in.");
    }
    try {
      const status = await this.#oauth.connect({
        ...ownerFromEntry(app),
        destinationId: destination.id,
        origin: restrictedAppNetworkOrigin(destination),
      }, declaration);
      return { destinationId: destination.id, kind: status.kind, configured: true };
    } catch (error) {
      if (!(error instanceof RestrictedAppOAuthError)) throw error;
      throw new RestrictedAppError(
        error.code === "AUTH_CANCELLED" || error.code === "AUTH_DENIED" || error.code === "AUTH_REQUIRED" ? "AUTH_REQUIRED"
          : error.code === "STORAGE_FAILED" ? "STORAGE_FAILED" : "NETWORK_FAILED",
        error.message,
      );
    }
  }

  async grantNetwork(input: { workspaceId: string; appId: string; expectedDigest: string; destinationId: string }): Promise<RestrictedAppInstalled> {
    return await this.#setNetworkGrant(input, true);
  }

  async revokeNetwork(input: { workspaceId: string; appId: string; expectedDigest: string; destinationId: string }): Promise<RestrictedAppInstalled> {
    return await this.#setNetworkGrant(input, false);
  }

  async grantFiles(input: { workspaceId: string; workspaceRoot: string; appId: string; expectedDigest: string; permissionId: string; root: string }): Promise<RestrictedAppInstalled> {
    return await this.#setFileGrant(input, true);
  }

  async revokeFiles(input: { workspaceId: string; appId: string; expectedDigest: string; permissionId: string }): Promise<RestrictedAppInstalled> {
    return await this.#setFileGrant(input, false);
  }

  async grantNotifications(input: { workspaceId: string; appId: string; expectedDigest: string; permissionId: string }): Promise<RestrictedAppInstalled> {
    return await this.#setNotificationGrant(input, true);
  }

  async revokeNotifications(input: { workspaceId: string; appId: string; expectedDigest: string; permissionId: string }): Promise<RestrictedAppInstalled> {
    return await this.#setNotificationGrant(input, false);
  }

  async setBackgroundEnabled(input: { workspaceId: string; appId: string; expectedDigest: string; enabled: boolean }): Promise<RestrictedAppInstalled> {
    return await this.#mutate(async () => {
      const app = this.#installed(input.workspaceId, input.appId, input.expectedDigest);
      if (!app.manifest.background) throw new RestrictedAppError("INPUT_INVALID", "The app did not declare background work.");
      if (!this.#runtimeHost?.runBackground) throw new RestrictedAppError("APP_UNAVAILABLE", "Background apps require the Workspace desktop host.");
      if (app.backgroundEnabled === input.enabled) return app;
      const existing = this.#registry.apps.find((item) => item.workspaceId === app.workspaceId && item.manifest.id === app.manifest.id)!;
      if (!input.enabled) await this.#runtimeHost.stop(app.workspaceId, app.manifest.id, app.digest);
      const next: RestrictedAppRegistryEntry = {
        ...existing,
        backgroundEnabled: input.enabled,
        ...(input.enabled ? {} : { backgroundLastError: undefined }),
      };
      await this.#writeRegistry({ schemaVersion: 1, apps: this.#registry.apps.map((item) => item === existing ? next : item) });
      this.#scheduleBackground(next);
      return copyInstalled(next);
    });
  }

  async runBackgroundNow(input: { workspaceId: string; appId: string; expectedDigest: string }): Promise<RestrictedAppInstalled> {
    const app = this.#installed(input.workspaceId, input.appId, input.expectedDigest);
    if (!app.backgroundEnabled) throw new RestrictedAppError("INPUT_INVALID", "Enable background work before running it.");
    await this.#executeBackground(app.workspaceId, app.manifest.id, app.digest, "manual");
    return this.#installed(input.workspaceId, input.appId, input.expectedDigest);
  }

  suspendBackground(): void {
    this.#backgroundSuspended = true;
    this.#runtimeHost?.suspend?.();
    for (const timer of this.#backgroundTimers.values()) clearTimeout(timer);
    this.#backgroundTimers.clear();
  }

  resumeBackground(): void {
    if (!this.#backgroundSuspended || this.#closed) return;
    this.#backgroundSuspended = false;
    this.#runtimeHost?.resume?.();
    this.#scheduleAllBackgroundApps(true);
  }

  async storageUsage(workspaceId: string, appId: string, expectedDigest: string): Promise<RestrictedAppStorageUsage> {
    const app = this.#installed(workspaceId, appId, expectedDigest);
    if (!this.#storage) throw new RestrictedAppError("APP_UNAVAILABLE", "Restricted app storage requires the Workspace desktop host.");
    return await this.#storage.usage({ workspaceId: app.workspaceId, appId: app.manifest.id });
  }

  async clearStorage(workspaceId: string, appId: string, expectedDigest: string): Promise<RestrictedAppStorageUsage> {
    return await this.#mutate(async () => {
      const app = this.#installed(workspaceId, appId, expectedDigest);
      if (!this.#storage) throw new RestrictedAppError("APP_UNAVAILABLE", "Restricted app storage requires the Workspace desktop host.");
      await this.#runtimeHost?.stop(app.workspaceId, app.manifest.id, app.digest);
      return await this.#storage.clear({ workspaceId: app.workspaceId, appId: app.manifest.id });
    });
  }

  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    for (const timer of this.#backgroundTimers.values()) clearTimeout(timer);
    this.#backgroundTimers.clear();
    await this.#queue.catch(() => undefined);
    await this.#runtimeHost?.close();
  }

  #installed(workspaceId: string, appId: string, expectedDigest: string): RestrictedAppInstalled {
    const id = appIdValue(appId);
    const digest = digestValue(expectedDigest);
    const entry = this.#registry.apps.find((item) => item.workspaceId === workspaceId && item.manifest.id === id);
    if (!entry) throw new RestrictedAppError("APP_UNAVAILABLE", "The restricted app is not installed in this Space.");
    if (entry.digest !== digest) throw new RestrictedAppError("REVISION_CHANGED", "The restricted app revision changed. Refresh before using it.");
    return copyInstalled(entry);
  }

  async #setNetworkGrant(
    input: { workspaceId: string; appId: string; expectedDigest: string; destinationId: string },
    granted: boolean,
  ): Promise<RestrictedAppInstalled> {
    return await this.#mutate(async () => {
      const app = this.#installed(input.workspaceId, input.appId, input.expectedDigest);
      const destination = app.manifest.permissions.network.find((item) => item.id === input.destinationId);
      if (!destination) throw new RestrictedAppError("NETWORK_DENIED", "The app did not declare this network destination.");
      const currentlyGranted = app.networkGrants.includes(destination.id);
      if (currentlyGranted === granted) return app;
      const existing = this.#registry.apps.find((item) => item.workspaceId === app.workspaceId && item.manifest.id === app.manifest.id)!;
      await this.#runtimeHost?.stop(app.workspaceId, app.manifest.id, app.digest);
      const next: RestrictedAppRegistryEntry = {
        ...existing,
        networkGrants: granted
          ? [...existing.networkGrants, destination.id].sort()
          : existing.networkGrants.filter((id) => id !== destination.id),
      };
      await this.#writeRegistry({
        schemaVersion: 1,
        apps: this.#registry.apps.map((item) => item === existing ? next : item),
      });
      return copyInstalled(next);
    });
  }

  async #setFileGrant(
    input: { workspaceId: string; workspaceRoot?: string; appId: string; expectedDigest: string; permissionId: string; root?: string },
    granted: boolean,
  ): Promise<RestrictedAppInstalled> {
    return await this.#mutate(async () => {
      const app = this.#installed(input.workspaceId, input.appId, input.expectedDigest);
      const permission = app.manifest.permissions.files.find((item) => item.id === input.permissionId);
      if (!permission) throw new RestrictedAppError("FILE_DENIED", "The app did not declare this Space file permission.");
      const currentlyGranted = app.fileGrants.some((item) => item.declarationId === permission.id);
      if (currentlyGranted === granted) return app;
      const existing = this.#registry.apps.find((item) => item.workspaceId === app.workspaceId && item.manifest.id === app.manifest.id)!;
      const nextGrant = granted ? {
        id: permission.id,
        declarationId: permission.id,
        root: restrictedAppGrantRoot(input.root),
        access: permission.access,
      } : undefined;
      if (nextGrant) {
        if (!input.workspaceRoot) throw new RestrictedAppError("FILE_DENIED", "The app's Space is no longer registered.");
        try {
          await new RestrictedAppFileBroker().validateGrant({
            workspaceRoot: input.workspaceRoot,
            declarations: [permission],
            grants: [nextGrant],
          }, nextGrant.id);
        } catch (error) {
          throw new RestrictedAppError("FILE_DENIED", errorMessage(error));
        }
      }
      await this.#runtimeHost?.stop(app.workspaceId, app.manifest.id, app.digest);
      const next: RestrictedAppRegistryEntry = {
        ...existing,
        fileGrants: granted
          ? [...existing.fileGrants, nextGrant!].sort((left, right) => left.id.localeCompare(right.id))
          : existing.fileGrants.filter((item) => item.declarationId !== permission.id),
      };
      await this.#writeRegistry({
        schemaVersion: 1,
        apps: this.#registry.apps.map((item) => item === existing ? next : item),
      });
      return copyInstalled(next);
    });
  }

  async #setNotificationGrant(
    input: { workspaceId: string; appId: string; expectedDigest: string; permissionId: string },
    granted: boolean,
  ): Promise<RestrictedAppInstalled> {
    return await this.#mutate(async () => {
      const app = this.#installed(input.workspaceId, input.appId, input.expectedDigest);
      const permission = app.manifest.permissions.notifications.find((item) => item.id === input.permissionId);
      if (!permission) throw new RestrictedAppError("INPUT_INVALID", "The app did not declare this notification category.");
      const currentlyGranted = app.notificationGrants.includes(permission.id);
      if (currentlyGranted === granted) return app;
      const existing = this.#registry.apps.find((item) => item.workspaceId === app.workspaceId && item.manifest.id === app.manifest.id)!;
      await this.#runtimeHost?.stop(app.workspaceId, app.manifest.id, app.digest);
      const next: RestrictedAppRegistryEntry = {
        ...existing,
        notificationGrants: granted
          ? [...existing.notificationGrants, permission.id].sort()
          : existing.notificationGrants.filter((id) => id !== permission.id),
      };
      await this.#writeRegistry({
        schemaVersion: 1,
        apps: this.#registry.apps.map((item) => item === existing ? next : item),
      });
      return copyInstalled(next);
    });
  }

  #scheduleAllBackgroundApps(catchUp = false): void {
    for (const app of this.#registry.apps) this.#scheduleBackground(app, catchUp);
  }

  #scheduleBackground(app: RestrictedAppRegistryEntry, catchUp = false): void {
    this.#clearBackground(app.workspaceId, app.manifest.id);
    if (this.#closed || this.#backgroundSuspended || !app.backgroundEnabled || !app.manifest.background || !this.#runtimeHost?.runBackground) return;
    const interval = app.manifest.background.intervalMinutes * 60_000;
    const elapsed = app.backgroundLastRunAt ? Math.max(0, this.#now().getTime() - Date.parse(app.backgroundLastRunAt)) : 0;
    const overdue = Boolean(catchUp && app.backgroundLastRunAt && elapsed >= interval);
    const delay = overdue ? backgroundStagger(app.workspaceId, app.manifest.id) : app.backgroundLastRunAt ? Math.max(1_000, interval - elapsed) : interval;
    const reason = overdue ? "resume" as const : "scheduled" as const;
    const timer = setTimeout(() => {
      this.#backgroundTimers.delete(backgroundKey(app.workspaceId, app.manifest.id));
      void this.#executeBackground(app.workspaceId, app.manifest.id, app.digest, reason)
        .catch(() => undefined)
        .finally(() => {
          const current = this.#registry.apps.find((item) => item.workspaceId === app.workspaceId && item.manifest.id === app.manifest.id);
          if (current) this.#scheduleBackground(current);
        });
    }, delay);
    timer.unref?.();
    this.#backgroundTimers.set(backgroundKey(app.workspaceId, app.manifest.id), timer);
  }

  #clearBackground(workspaceId: string, appId: string): void {
    const key = backgroundKey(workspaceId, appId);
    const timer = this.#backgroundTimers.get(key);
    if (timer) clearTimeout(timer);
    this.#backgroundTimers.delete(key);
  }

  async #executeBackground(workspaceId: string, appId: string, digest: string, reason: "scheduled" | "manual" | "resume"): Promise<void> {
    if (this.#closed || !this.#runtimeHost?.runBackground) return;
    const app = this.#installed(workspaceId, appId, digest);
    if (!app.backgroundEnabled || !app.manifest.background) return;
    const scheduledAt = this.#now().toISOString();
    let failure: string | undefined;
    await this.#acquireBackgroundSlot();
    try {
      const current = this.#installed(workspaceId, appId, digest);
      if (!current.backgroundEnabled || this.#backgroundSuspended) return;
      await this.#runtimeHost.runBackground({ ...current, stagedRoot: this.#digestRoot(current.digest) }, { reason, scheduledAt });
    } catch (error) {
      failure = errorMessage(error).slice(0, 300);
    } finally {
      this.#releaseBackgroundSlot();
    }
    await this.#mutate(async () => {
      const existing = this.#registry.apps.find((item) => item.workspaceId === workspaceId && item.manifest.id === appId && item.digest === digest);
      if (!existing || !existing.backgroundEnabled) return;
      const next: RestrictedAppRegistryEntry = {
        ...existing,
        backgroundLastRunAt: this.#now().toISOString(),
        ...(failure ? { backgroundLastError: failure } : { backgroundLastError: undefined }),
      };
      await this.#writeRegistry({ schemaVersion: 1, apps: this.#registry.apps.map((item) => item === existing ? next : item) });
    });
    if (failure) throw new RestrictedAppError("APP_ERROR", failure);
  }

  async #acquireBackgroundSlot(): Promise<void> {
    if (this.#backgroundActive < 2) {
      this.#backgroundActive += 1;
      return;
    }
    await new Promise<void>((resolvePromise) => this.#backgroundWaiters.push(resolvePromise));
    this.#backgroundActive += 1;
  }

  #releaseBackgroundSlot(): void {
    this.#backgroundActive = Math.max(0, this.#backgroundActive - 1);
    this.#backgroundWaiters.shift()?.();
  }

  async #mutate<T>(operation: () => Promise<T>): Promise<T> {
    this.#assertOpen();
    let resolveResult!: (value: T) => void;
    let rejectResult!: (reason: unknown) => void;
    const result = new Promise<T>((resolvePromise, rejectPromise) => {
      resolveResult = resolvePromise;
      rejectResult = rejectPromise;
    });
    const queued = this.#queue.catch(() => undefined).then(async () => {
      try {
        resolveResult(await operation());
      } catch (error) {
        rejectResult(error);
      }
    });
    this.#queue = queued;
    await queued;
    return await result;
  }

  async #writeRegistry(next: RestrictedAppRegistryFile): Promise<void> {
    await mkdir(this.#rootPath, { recursive: true });
    const temporary = `${this.#registryPath}.${randomUUID()}.tmp`;
    await writeFile(temporary, `${JSON.stringify(next, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
    try {
      await rename(temporary, this.#registryPath);
    } catch (error) {
      await rm(temporary, { force: true });
      throw error;
    }
    this.#registry = next;
  }

  async #cleanupStaging(): Promise<void> {
    const referenced = new Set(this.#registry.apps.map((item) => item.digest));
    for (const entry of await readdir(this.#stagingPath, { withFileTypes: true })) {
      if (entry.isSymbolicLink() || !entry.isDirectory()) continue;
      if (/^\.staging-[0-9a-f-]{36}$/i.test(entry.name) || (/^[0-9a-f]{64}$/.test(entry.name) && !referenced.has(entry.name))) {
        await rm(join(this.#stagingPath, entry.name), { recursive: true, force: true });
      }
    }
  }

  async #garbageCollectDigest(digest: string): Promise<void> {
    if (this.#registry.apps.some((item) => item.digest === digest)) return;
    const root = this.#digestRoot(digest);
    const info = await lstat(root).catch((error: NodeJS.ErrnoException) => error.code === "ENOENT" ? null : Promise.reject(error));
    if (info && !info.isSymbolicLink() && info.isDirectory()) await rm(root, { recursive: true, force: true });
  }

  #digestRoot(digest: string): string {
    const value = digestValue(digest);
    const root = resolve(this.#stagingPath, value);
    if (relative(this.#stagingPath, root) !== value) throw new Error("Restricted app staging path is invalid.");
    return root;
  }

  #assertOpen(): void {
    if (this.#closed) throw new RestrictedAppError("APP_UNAVAILABLE", "The restricted app service is closed.");
  }
}

async function readRegistry(path: string): Promise<RestrictedAppRegistryFile> {
  if (!existsSync(path)) return { schemaVersion: 1, apps: [] };
  const info = await lstat(path);
  if (info.isSymbolicLink() || !info.isFile() || info.size > 5 * 1024 * 1024) throw new Error("Restricted app registry is unsafe or too large.");
  let value: unknown;
  try {
    value = JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    throw new Error(`Workspace could not read the restricted app registry: ${errorMessage(error)}`);
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Restricted app registry must be an object.");
  const record = value as { schemaVersion?: unknown; apps?: unknown };
  if (record.schemaVersion !== 1 || !Array.isArray(record.apps)) throw new Error("Restricted app registry version is unsupported.");
  const apps = record.apps.map((item, index) => registryEntry(item, index));
  const keys = apps.map((item) => `${item.workspaceId}:${item.manifest.id}`);
  if (new Set(keys).size !== keys.length) throw new Error("Restricted app registry contains duplicate Space app ids.");
  return { schemaVersion: 1, apps };
}

function registryEntry(value: unknown, index: number): RestrictedAppRegistryEntry {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`Restricted app registry entry ${index + 1} is invalid.`);
  const item = value as Partial<RestrictedAppRegistryEntry>;
  const manifest = parseRestrictedAppManifest(item.manifest);
  const workspaceId = nonempty(item.workspaceId, "Restricted app registry Space id", 200);
  const packageName = nonempty(item.packageName, "Restricted app registry package name", 214);
  const version = nonempty(item.version, "Restricted app registry version", 100);
  const digest = digestValue(item.digest);
  const networkGrants = Array.isArray(item.networkGrants) ? item.networkGrants.map((grant) => nonempty(grant, "Restricted app network grant", 64)) : [];
  if (new Set(networkGrants).size !== networkGrants.length || networkGrants.some((grant) => !manifest.permissions.network.some((item) => item.id === grant))) {
    throw new Error("Restricted app registry has invalid network grants.");
  }
  const fileGrants = Array.isArray(item.fileGrants) ? item.fileGrants.map((grant) => restrictedAppFileGrantValue(grant, manifest)) : [];
  if (new Set(fileGrants.map((grant) => grant.id)).size !== fileGrants.length) {
    throw new Error("Restricted app registry has invalid file grants.");
  }
  const notificationGrants = Array.isArray(item.notificationGrants)
    ? item.notificationGrants.map((grant) => nonempty(grant, "Restricted app notification grant", 64))
    : [];
  if (new Set(notificationGrants).size !== notificationGrants.length
    || notificationGrants.some((grant) => !manifest.permissions.notifications.some((item) => item.id === grant))) {
    throw new Error("Restricted app registry has invalid notification grants.");
  }
  const backgroundEnabled = item.backgroundEnabled === true;
  if (backgroundEnabled && !manifest.background) throw new Error("Restricted app registry enables undeclared background work.");
  const backgroundLastRunAt = item.backgroundLastRunAt === undefined
    ? undefined
    : isoDate(item.backgroundLastRunAt, "Restricted app background run time");
  const backgroundLastError = item.backgroundLastError === undefined
    ? undefined
    : nonempty(item.backgroundLastError, "Restricted app background error", 300);
  return {
    workspaceId,
    packageName,
    version,
    digest,
    manifest,
    networkGrants,
    fileGrants,
    notificationGrants,
    backgroundEnabled,
    ...(backgroundLastRunAt ? { backgroundLastRunAt } : {}),
    ...(backgroundLastError ? { backgroundLastError } : {}),
    fileCount: boundedInteger(item.fileCount, "Restricted app registry file count", 1, 2_048),
    totalBytes: boundedInteger(item.totalBytes, "Restricted app registry byte count", 1, 50 * 1024 * 1024),
    installedAt: isoDate(item.installedAt, "Restricted app installed time"),
    updatedAt: isoDate(item.updatedAt, "Restricted app updated time"),
  };
}

async function restrictedSourceRoot(workspaceRoot: string, sourcePath: string): Promise<string> {
  if (!sourcePath || sourcePath.includes("\0") || isAbsolute(sourcePath)) throw new RestrictedAppError("INPUT_INVALID", "Choose a relative package folder inside the Space.");
  const segments = sourcePath.replace(/\\/g, "/").split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..") || segments[0] === ".pi" || segments[0] === ".workspace") {
    throw new RestrictedAppError("INPUT_INVALID", "Restricted app source must be a normal visible folder in the Space.");
  }
  const root = await realpath(workspaceRoot);
  const candidate = resolve(root, ...segments);
  const sourceInfo = await lstat(candidate).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") throw new RestrictedAppError("INPUT_INVALID", "The restricted app package folder was not found.");
    throw error;
  });
  if (sourceInfo.isSymbolicLink() || !sourceInfo.isDirectory()) {
    throw new RestrictedAppError("INPUT_INVALID", "Restricted app source must be a normal folder, not a link or file.");
  }
  const resolved = await realpath(candidate);
  const child = relative(root, resolved);
  if (!child || child === ".." || child.startsWith(`..${sep}`) || isAbsolute(child)) throw new RestrictedAppError("INPUT_INVALID", "Restricted app source escapes the Space.");
  return resolved;
}

function reviewFromInspection(inspection: Awaited<ReturnType<typeof inspectRestrictedAppPackage>>): RestrictedAppReview {
  return {
    packageName: inspection.packageName,
    version: inspection.packageVersion,
    digest: inspection.digest,
    manifest: structuredClone(inspection.manifest),
    fileCount: inspection.files.length,
    totalBytes: inspection.totalBytes,
  };
}

function copyInstalled(item: RestrictedAppRegistryEntry): RestrictedAppInstalled {
  return structuredClone({
    workspaceId: item.workspaceId,
    packageName: item.packageName,
    version: item.version,
    digest: item.digest,
    manifest: item.manifest,
    networkGrants: item.networkGrants,
    fileGrants: item.fileGrants,
    notificationGrants: item.notificationGrants,
    backgroundEnabled: item.backgroundEnabled,
    ...(item.backgroundLastRunAt ? { backgroundLastRunAt: item.backgroundLastRunAt } : {}),
    ...(item.backgroundLastError ? { backgroundLastError: item.backgroundLastError } : {}),
    fileCount: item.fileCount,
    totalBytes: item.totalBytes,
    installedAt: item.installedAt,
    updatedAt: item.updatedAt,
  });
}

function ownerFromEntry(item: Pick<RestrictedAppRegistryEntry, "workspaceId" | "digest" | "manifest">): RestrictedAppConnectionOwner {
  return {
    workspaceId: item.workspaceId,
    appId: item.manifest.id,
    digest: item.digest,
  };
}

function digestValue(value: unknown): string {
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/.test(value)) throw new RestrictedAppError("INPUT_INVALID", "Restricted app digest is invalid.");
  return value;
}

function appIdValue(value: unknown): string {
  if (typeof value !== "string" || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(value)) throw new RestrictedAppError("INPUT_INVALID", "Restricted app id is invalid.");
  return value;
}

function nonempty(value: unknown, label: string, maximum: number): string {
  if (typeof value !== "string" || !value.trim() || value.length > maximum) throw new Error(`${label} is invalid.`);
  return value;
}

function boundedInteger(value: unknown, label: string, minimum: number, maximum: number): number {
  if (!Number.isInteger(value) || (value as number) < minimum || (value as number) > maximum) throw new Error(`${label} is invalid.`);
  return value as number;
}

function isoDate(value: unknown, label: string): string {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) throw new Error(`${label} is invalid.`);
  return value;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error ?? "unknown error");
}

function restrictedAppFileGrantValue(value: unknown, manifest: RestrictedAppManifest): RestrictedAppFileGrant {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Restricted app file grant is invalid.");
  const record = value as Partial<RestrictedAppFileGrant>;
  const id = nonempty(record.id, "Restricted app file grant id", 64);
  const declarationId = nonempty(record.declarationId, "Restricted app file declaration id", 64);
  const declaration = manifest.permissions.files.find((item) => item.id === declarationId);
  if (!declaration || id !== declarationId || record.access !== declaration.access) throw new Error("Restricted app file grant exceeds its declaration.");
  return { id, declarationId, root: restrictedAppGrantRoot(record.root), access: declaration.access };
}

function restrictedAppGrantRoot(value: unknown): string {
  if (typeof value !== "string" || !value || value.length > 512 || value.includes("\\") || value.includes(":") || value.includes("\0") || isAbsolute(value)) {
    throw new RestrictedAppError("INPUT_INVALID", "Choose a safe path inside the Space for this app.");
  }
  if (value === ".") return value;
  const segments = value.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
    throw new RestrictedAppError("INPUT_INVALID", "Choose a safe path inside the Space for this app.");
  }
  if (segments.some((segment) => segment.toLocaleLowerCase() === ".workspace" || segment.toLocaleLowerCase() === ".pi")) {
    throw new RestrictedAppError("FILE_DENIED", "Workspace metadata and executable Pi configuration cannot be granted to an app.");
  }
  return segments.join("/");
}

function backgroundKey(workspaceId: string, appId: string): string {
  return JSON.stringify([workspaceId, appId]);
}

function backgroundStagger(workspaceId: string, appId: string): number {
  let value = 0;
  for (const character of `${workspaceId}\0${appId}`) value = (value * 31 + character.charCodeAt(0)) >>> 0;
  return 1_000 + (value % 30_000);
}
