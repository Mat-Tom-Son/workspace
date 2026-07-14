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
import {
  parseRestrictedAppManifest,
  restrictedAppNetworkOrigin,
  type RestrictedAppAutomationDeclaration,
  type RestrictedAppManifest,
} from "./restricted-app-manifest.js";
import { RestrictedAppFileBroker, type RestrictedAppFileGrant } from "./restricted-app-files.js";
import type { FileRestrictedAppStorage, RestrictedAppStorageUsage } from "./restricted-app-storage.js";
import { RestrictedAppOAuthError, type RestrictedAppOAuthPkceClient } from "./restricted-app-oauth.js";
import {
  inspectRestrictedAppPackage,
  stageRestrictedAppPackage,
} from "./restricted-app-package.js";
import {
  WorkspaceAutomationService,
  type WorkspaceAutomationClock,
  type WorkspaceAutomationRunContext,
  type WorkspaceAutomationRunResult,
} from "./workspace-automation-service.js";
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
  automations: RestrictedAppAutomationState[];
  installedAt: string;
  updatedAt: string;
}

export interface RestrictedAppAutomationState {
  id: string;
  enabled: boolean;
  lastRunAt?: string;
  lastError?: string;
  nextRunAt?: string;
}

export interface RestrictedAppAutomationRunReceipt {
  runId: string;
  automationId: string;
  reason: "scheduled" | "manual" | "resume";
  scheduledAt: string;
  startedAt: string;
  finishedAt: string;
  outcome: "success" | "failure" | "skipped" | "cancelled";
  error?: string;
}

export interface RestrictedAppRuntimeDescriptor extends RestrictedAppInstalled {
  stagedRoot: string;
}

export interface RestrictedAppRuntimeHost {
  invoke(app: RestrictedAppRuntimeDescriptor, action: string, input: unknown): Promise<unknown>;
  runAutomation?(app: RestrictedAppRuntimeDescriptor, event: {
    runId: string;
    automationId: string;
    handler: string;
    reason: "scheduled" | "manual" | "resume";
    scheduledAt: string;
  }, signal?: AbortSignal): Promise<void>;
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
  schemaVersion: 2;
  apps: RestrictedAppRegistryEntry[];
}

interface RestrictedAppAutomationRegistryState {
  id: string;
  enabled: boolean;
  lastScheduledAt?: string;
  lastRunAt?: string;
  lastError?: string;
}

interface RestrictedAppAutomationRegistryReceipt extends RestrictedAppAutomationRunReceipt {
  digest: string;
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
  automations: RestrictedAppAutomationRegistryState[];
  automationRuns: RestrictedAppAutomationRegistryReceipt[];
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
  readonly #automations: WorkspaceAutomationService;
  #registry: RestrictedAppRegistryFile;
  #queue: Promise<void> = Promise.resolve();
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
    const clock: WorkspaceAutomationClock = {
      now: this.#now,
      setTimeout(callback, delayMs) {
        const handle = setTimeout(callback, delayMs);
        handle.unref?.();
        return handle;
      },
      clearTimeout(handle) {
        clearTimeout(handle as NodeJS.Timeout);
      },
    };
    this.#automations = new WorkspaceAutomationService({
      clock,
      onResult: async (result) => this.#recordAutomationResult(result),
    });
  }

  static async create(options: RestrictedAppServiceOptions): Promise<RestrictedAppService> {
    const rootPath = resolve(options.rootPath);
    await mkdir(join(rootPath, "staged"), { recursive: true });
    const registry = await readRegistry(join(rootPath, "registry.json"));
    const service = new RestrictedAppService(options, registry);
    await service.#cleanupStaging();
    service.#syncAllAutomations();
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
      .map((item) => this.#copyInstalled(item));
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
        return this.#copyInstalled(existing);
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
      if (existing) {
        await this.#runtimeHost?.stop(input.workspaceId, existing.manifest.id, existing.digest);
        await this.#invalidateOAuthApp(existing);
      }
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
        automations: staged.manifest.automations.map((automation) => ({ id: automation.id, enabled: false })),
        automationRuns: [],
        fileCount: staged.fileCount,
        totalBytes: staged.totalBytes,
        installedAt: existing?.installedAt ?? timestamp,
        updatedAt: timestamp,
      };
      const next = this.#registry.apps.filter((item) => !(item.workspaceId === input.workspaceId && item.manifest.id === entry.manifest.id));
      next.push(entry);
      await this.#writeRegistry({ schemaVersion: 2, apps: next });
      if (existing) {
        this.#unregisterAppAutomations(existing);
        await this.#connections?.deleteApp(ownerFromEntry(existing));
        await this.#garbageCollectDigest(existing.digest);
      }
      this.#syncAppAutomations(entry);
      return this.#copyInstalled(entry);
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
      await this.#invalidateOAuthApp(existing);
      await this.#writeRegistry({
        schemaVersion: 2,
        apps: this.#registry.apps.filter((item) => item !== existing),
      });
      this.#unregisterAppAutomations(existing);
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
      await Promise.all(removed.map((app) => this.#invalidateOAuthApp(app)));
      await this.#writeRegistry({ schemaVersion: 2, apps: this.#registry.apps.filter((item) => item.workspaceId !== workspaceId) });
      for (const app of removed) this.#unregisterAppAutomations(app);
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
    return await this.#mutate(async () => {
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
      await this.#runtimeHost?.stop(app.workspaceId, app.manifest.id, app.digest);
      await this.#invalidateOAuthDestination(app, destination);
      await this.#connections.set({ ...ownerFromEntry(app), destinationId: destination.id, origin: restrictedAppNetworkOrigin(destination) }, credential);
      return { destinationId: destination.id, kind: credential.kind, configured: true };
    });
  }

  async deleteConnection(input: { workspaceId: string; appId: string; expectedDigest: string; destinationId: string }): Promise<boolean> {
    return await this.#mutate(async () => {
      if (!this.#connections) return false;
      const app = this.#installed(input.workspaceId, input.appId, input.expectedDigest);
      const destination = app.manifest.permissions.network.find((item) => item.id === input.destinationId);
      if (!destination) return false;
      await this.#runtimeHost?.stop(app.workspaceId, app.manifest.id, app.digest);
      const oauthRemoved = await this.#invalidateOAuthDestination(app, destination);
      if (oauthRemoved !== undefined) return oauthRemoved;
      return await this.#connections.delete({ ...ownerFromEntry(app), destinationId: destination.id, origin: restrictedAppNetworkOrigin(destination) });
    });
  }

  async connectOAuth(input: { workspaceId: string; appId: string; expectedDigest: string; destinationId: string }): Promise<RestrictedAppConnectionStatus> {
    this.#assertOpen();
    if (!this.#oauth) throw new RestrictedAppError("APP_UNAVAILABLE", "OAuth browser sign-in requires the Workspace desktop host.");
    await this.#queue.catch(() => undefined);
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

  async setAutomationEnabled(input: {
    workspaceId: string;
    appId: string;
    expectedDigest: string;
    automationId: string;
    enabled: boolean;
  }): Promise<RestrictedAppInstalled> {
    return await this.#mutate(async () => {
      const app = this.#installed(input.workspaceId, input.appId, input.expectedDigest);
      const declaration = automationDeclaration(app.manifest, input.automationId);
      if (input.enabled) this.#assertAutomationRuntime();
      const existing = this.#registry.apps.find((item) => item.workspaceId === app.workspaceId && item.manifest.id === app.manifest.id)!;
      const state = existing.automations.find((item) => item.id === declaration.id)!;
      if (state.enabled === input.enabled) return this.#copyInstalled(existing);
      const nextState: RestrictedAppAutomationRegistryState = {
        ...state,
        enabled: input.enabled,
        ...(input.enabled ? { lastScheduledAt: this.#now().toISOString() } : { lastError: undefined }),
      };
      const next: RestrictedAppRegistryEntry = {
        ...existing,
        automations: existing.automations.map((item) => item === state ? nextState : item),
      };
      if (!input.enabled) this.#syncAutomation(next, declaration);
      try {
        if (!input.enabled) await this.#runtimeHost?.stop(app.workspaceId, app.manifest.id, app.digest);
        await this.#writeRegistry({ schemaVersion: 2, apps: this.#registry.apps.map((item) => item === existing ? next : item) });
      } catch (error) {
        if (!input.enabled) this.#syncAutomation(existing, declaration);
        throw error;
      }
      this.#syncAutomation(next, declaration);
      return this.#copyInstalled(next);
    });
  }

  async runAutomationNow(input: {
    workspaceId: string;
    appId: string;
    expectedDigest: string;
    automationId: string;
  }): Promise<{ app: RestrictedAppInstalled; run: RestrictedAppAutomationRunReceipt }> {
    const app = this.#installed(input.workspaceId, input.appId, input.expectedDigest);
    const declaration = automationDeclaration(app.manifest, input.automationId);
    this.#assertAutomationRuntime();
    const key = automationKey(app.workspaceId, app.manifest.id, app.digest, declaration.id);
    if (!this.#automations.has(key)) {
      const entry = this.#registry.apps.find((item) => item.workspaceId === app.workspaceId && item.manifest.id === app.manifest.id)!;
      this.#syncAutomation(entry, declaration);
    }
    const result = await this.#automations.runNow(key);
    await this.#recordAutomationResult(result);
    return {
      app: this.#installed(input.workspaceId, input.appId, input.expectedDigest),
      run: publicAutomationRun(result),
    };
  }

  async listAutomationRuns(
    workspaceId: string,
    appId: string,
    expectedDigest: string,
    automationId: string,
  ): Promise<RestrictedAppAutomationRunReceipt[]> {
    const app = this.#installed(workspaceId, appId, expectedDigest);
    const declaration = automationDeclaration(app.manifest, automationId);
    const entry = this.#registry.apps.find((item) => item.workspaceId === app.workspaceId && item.manifest.id === app.manifest.id)!;
    return entry.automationRuns
      .filter((run) => run.automationId === declaration.id && run.digest === app.digest)
      .slice(-50)
      .reverse()
      .map(({ digest: _digest, ...run }) => structuredClone(run));
  }

  suspendAutomations(): void {
    this.#automations.suspend();
    this.#runtimeHost?.suspend?.();
  }

  resumeAutomations(): void {
    if (this.#closed) return;
    this.#runtimeHost?.resume?.();
    this.#automations.resume();
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
    this.#automations.close();
    await this.#queue.catch(() => undefined);
    await this.#runtimeHost?.close();
  }

  #installed(workspaceId: string, appId: string, expectedDigest: string): RestrictedAppInstalled {
    const id = appIdValue(appId);
    const digest = digestValue(expectedDigest);
    const entry = this.#registry.apps.find((item) => item.workspaceId === workspaceId && item.manifest.id === id);
    if (!entry) throw new RestrictedAppError("APP_UNAVAILABLE", "The restricted app is not installed in this Space.");
    if (entry.digest !== digest) throw new RestrictedAppError("REVISION_CHANGED", "The restricted app revision changed. Refresh before using it.");
    return this.#copyInstalled(entry);
  }

  #copyInstalled(entry: RestrictedAppRegistryEntry): RestrictedAppInstalled {
    const installed = copyInstalled(entry);
    installed.automations = installed.automations.map((state) => {
      const nextRunAt = this.#automations.nextScheduledAt(automationKey(entry.workspaceId, entry.manifest.id, entry.digest, state.id));
      return { ...state, ...(nextRunAt ? { nextRunAt } : {}) };
    });
    return installed;
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
        schemaVersion: 2,
        apps: this.#registry.apps.map((item) => item === existing ? next : item),
      });
      return this.#copyInstalled(next);
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
        schemaVersion: 2,
        apps: this.#registry.apps.map((item) => item === existing ? next : item),
      });
      return this.#copyInstalled(next);
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
        schemaVersion: 2,
        apps: this.#registry.apps.map((item) => item === existing ? next : item),
      });
      return this.#copyInstalled(next);
    });
  }

  #syncAllAutomations(): void {
    for (const app of this.#registry.apps) this.#syncAppAutomations(app);
  }

  #syncAppAutomations(app: RestrictedAppRegistryEntry): void {
    for (const declaration of app.manifest.automations) this.#syncAutomation(app, declaration);
  }

  #syncAutomation(app: RestrictedAppRegistryEntry, declaration: RestrictedAppAutomationDeclaration): void {
    const state = app.automations.find((item) => item.id === declaration.id);
    if (!state) throw new Error(`Restricted app automation state is missing for ${declaration.id}.`);
    const definition = {
      key: automationKey(app.workspaceId, app.manifest.id, app.digest, declaration.id),
      intervalMinutes: declaration.trigger.intervalMinutes,
      enabled: state.enabled,
      catchUp: declaration.catchUp,
      ...(state.lastScheduledAt ? { lastScheduledAt: state.lastScheduledAt } : {}),
      run: (context: WorkspaceAutomationRunContext) => this.#executeAutomation(
        app.workspaceId,
        app.manifest.id,
        app.digest,
        declaration.id,
        context,
      ),
    };
    if (this.#automations.has(definition.key)) this.#automations.update(definition);
    else this.#automations.register(definition);
  }

  #unregisterAppAutomations(app: RestrictedAppRegistryEntry): void {
    for (const declaration of app.manifest.automations) {
      this.#automations.unregister(automationKey(app.workspaceId, app.manifest.id, app.digest, declaration.id));
    }
  }

  async #executeAutomation(
    workspaceId: string,
    appId: string,
    digest: string,
    automationId: string,
    context: WorkspaceAutomationRunContext,
  ): Promise<void> {
    let execution: Promise<void> | undefined;
    await this.#mutate(async () => {
      const current = this.#installed(workspaceId, appId, digest);
      const declaration = automationDeclaration(current.manifest, automationId);
      const state = current.automations.find((item) => item.id === declaration.id)!;
      if (context.reason !== "manual" && !state.enabled) {
        throw new RestrictedAppError("APP_UNAVAILABLE", "The automation was disabled before it could start.");
      }
      this.#assertAutomationRuntime();
      const scoped: RestrictedAppRuntimeDescriptor = {
        ...current,
        networkGrants: current.networkGrants.filter((id) => declaration.permissions.network.includes(id)),
        fileGrants: current.fileGrants.filter((grant) => declaration.permissions.files.includes(grant.declarationId)),
        notificationGrants: current.notificationGrants.filter((id) => declaration.permissions.notifications.includes(id)),
        automations: current.automations.filter((automation) => automation.id === declaration.id),
        stagedRoot: this.#digestRoot(current.digest),
      };
      execution = this.#runtimeHost!.runAutomation!(scoped, {
        runId: context.runId,
        automationId: declaration.id,
        handler: declaration.handler,
        reason: context.reason,
        scheduledAt: context.scheduledAt,
      }, context.signal);
    });
    if (!execution) throw new RestrictedAppError("APP_UNAVAILABLE", "The automation could not start.");
    await execution;
  }

  async #recordAutomationResult(result: WorkspaceAutomationRunResult): Promise<void> {
    if (this.#closed) return;
    const owner = automationOwner(result.key.ownerId);
    await this.#mutate(async () => {
      const existing = this.#registry.apps.find((item) => item.workspaceId === owner.workspaceId
        && item.manifest.id === owner.appId && item.digest === owner.digest);
      if (!existing || existing.automationRuns.some((run) => run.runId === result.runId)) return;
      const declaration = existing.manifest.automations.find((item) => item.id === result.key.jobId);
      const state = existing.automations.find((item) => item.id === result.key.jobId);
      if (!declaration || !state) return;
      const nextState: RestrictedAppAutomationRegistryState = {
        ...state,
        ...(result.reason === "manual" ? {} : { lastScheduledAt: result.scheduledAt }),
        ...(result.outcome === "success" || result.outcome === "failure" ? { lastRunAt: result.finishedAt } : {}),
        ...(result.outcome === "failure" ? { lastError: result.error ?? "Automation run failed." }
          : result.outcome === "success" ? { lastError: undefined }
          : {}),
      };
      const receipt: RestrictedAppAutomationRegistryReceipt = {
        ...publicAutomationRun(result),
        digest: existing.digest,
      };
      const next: RestrictedAppRegistryEntry = {
        ...existing,
        automations: existing.automations.map((item) => item === state ? nextState : item),
        automationRuns: [...existing.automationRuns, receipt].slice(-200),
      };
      await this.#writeRegistry({ schemaVersion: 2, apps: this.#registry.apps.map((item) => item === existing ? next : item) });
    });
  }

  #assertAutomationRuntime(): void {
    if (!this.#runtimeHost?.runAutomation) {
      throw new RestrictedAppError("APP_UNAVAILABLE", "Automations require the Workspace desktop host.");
    }
  }

  async #invalidateOAuthApp(app: Pick<RestrictedAppRegistryEntry, "workspaceId" | "digest" | "manifest">): Promise<void> {
    if (!this.#oauth) return;
    for (const destination of app.manifest.permissions.network) {
      await this.#invalidateOAuthDestination(app, destination);
    }
  }

  async #invalidateOAuthDestination(
    app: Pick<RestrictedAppRegistryEntry, "workspaceId" | "digest" | "manifest">,
    destination: RestrictedAppManifest["permissions"]["network"][number],
  ): Promise<boolean | undefined> {
    if (!this.#oauth || !destination.auth.some((item) => item.kind === "oauth2-pkce")) return undefined;
    try {
      return await this.#oauth.disconnect({
        ...ownerFromEntry(app),
        destinationId: destination.id,
        origin: restrictedAppNetworkOrigin(destination),
      });
    } catch (error) {
      if (!(error instanceof RestrictedAppOAuthError)) throw error;
      throw new RestrictedAppError(error.code === "STORAGE_FAILED" ? "STORAGE_FAILED" : "AUTH_REQUIRED", error.message);
    }
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
  if (!existsSync(path)) return { schemaVersion: 2, apps: [] };
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
  if (record.schemaVersion !== 2 || !Array.isArray(record.apps)) {
    throw new Error("Restricted app registry version is unsupported.");
  }
  const apps = record.apps.map((item, index) => registryEntry(item, index));
  const keys = apps.map((item) => `${item.workspaceId}:${item.manifest.id}`);
  if (new Set(keys).size !== keys.length) throw new Error("Restricted app registry contains duplicate Space app ids.");
  return { schemaVersion: 2, apps };
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
  const declarations = manifest.automations;
  if (!Array.isArray(item.automations)) throw new Error("Restricted app registry automation states are missing.");
  const automations = item.automations.map((state) => automationRegistryStateValue(state, declarations));
  if (automations.length !== declarations.length
    || new Set(automations.map((state) => state.id)).size !== declarations.length
    || declarations.some((declaration) => !automations.some((state) => state.id === declaration.id))) {
    throw new Error("Restricted app registry automation states do not match the reviewed manifest.");
  }
  if (!Array.isArray(item.automationRuns) || item.automationRuns.length > 200) {
    throw new Error("Restricted app automation run history is invalid.");
  }
  const automationRuns = item.automationRuns.map((run) => automationRunReceiptValue(run, declarations, digest));
  if (new Set(automationRuns.map((run) => run.runId)).size !== automationRuns.length) {
    throw new Error("Restricted app automation run history contains duplicate run ids.");
  }
  return {
    workspaceId,
    packageName,
    version,
    digest,
    manifest,
    networkGrants,
    fileGrants,
    notificationGrants,
    automations,
    automationRuns,
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
    automations: item.automations.map(({ lastScheduledAt: _lastScheduledAt, ...automation }) => automation),
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

function automationDeclaration(manifest: RestrictedAppManifest, automationId: string): RestrictedAppAutomationDeclaration {
  const id = appIdValue(automationId);
  const declaration = manifest.automations.find((automation) => automation.id === id);
  if (!declaration) throw new RestrictedAppError("INPUT_INVALID", "The app did not declare this automation.");
  return declaration;
}

function automationKey(workspaceId: string, appId: string, digest: string, automationId: string): {
  ownerId: string;
  jobId: string;
} {
  return {
    ownerId: JSON.stringify([workspaceId, appId, digest]),
    jobId: automationId,
  };
}

function automationOwner(value: string): { workspaceId: string; appId: string; digest: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("Automation owner id is invalid.");
  }
  if (!Array.isArray(parsed) || parsed.length !== 3) throw new Error("Automation owner id is invalid.");
  return {
    workspaceId: nonempty(parsed[0], "Automation Space id", 200),
    appId: appIdValue(parsed[1]),
    digest: digestValue(parsed[2]),
  };
}

function publicAutomationRun(result: WorkspaceAutomationRunResult): RestrictedAppAutomationRunReceipt {
  return {
    runId: result.runId,
    automationId: result.key.jobId,
    reason: result.reason,
    scheduledAt: result.scheduledAt,
    startedAt: result.startedAt,
    finishedAt: result.finishedAt,
    outcome: result.outcome,
    ...(result.error ? { error: result.error } : {}),
  };
}

function automationRegistryStateValue(
  value: unknown,
  declarations: RestrictedAppAutomationDeclaration[],
): RestrictedAppAutomationRegistryState {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Restricted app automation state is invalid.");
  }
  const item = value as Partial<RestrictedAppAutomationRegistryState>;
  const id = appIdValue(item.id);
  if (!declarations.some((declaration) => declaration.id === id) || typeof item.enabled !== "boolean") {
    throw new Error("Restricted app automation state exceeds its reviewed declaration.");
  }
  const lastScheduledAt = item.lastScheduledAt === undefined
    ? undefined
    : isoDate(item.lastScheduledAt, "Restricted app automation scheduled time");
  const lastRunAt = item.lastRunAt === undefined
    ? undefined
    : isoDate(item.lastRunAt, "Restricted app automation run time");
  const lastError = item.lastError === undefined
    ? undefined
    : nonempty(item.lastError, "Restricted app automation error", 300);
  return {
    id,
    enabled: item.enabled,
    ...(lastScheduledAt ? { lastScheduledAt } : {}),
    ...(lastRunAt ? { lastRunAt } : {}),
    ...(lastError ? { lastError } : {}),
  };
}

function automationRunReceiptValue(
  value: unknown,
  declarations: RestrictedAppAutomationDeclaration[],
  expectedDigest: string,
): RestrictedAppAutomationRegistryReceipt {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Restricted app automation run receipt is invalid.");
  }
  const item = value as Partial<RestrictedAppAutomationRegistryReceipt>;
  const runId = nonempty(item.runId, "Restricted app automation run id", 200);
  const automationId = appIdValue(item.automationId);
  if (!declarations.some((declaration) => declaration.id === automationId) || digestValue(item.digest) !== expectedDigest) {
    throw new Error("Restricted app automation run receipt does not match its reviewed revision.");
  }
  if (item.reason !== "scheduled" && item.reason !== "manual" && item.reason !== "resume") {
    throw new Error("Restricted app automation run reason is invalid.");
  }
  if (item.outcome !== "success" && item.outcome !== "failure" && item.outcome !== "skipped" && item.outcome !== "cancelled") {
    throw new Error("Restricted app automation run outcome is invalid.");
  }
  const startedAt = isoDate(item.startedAt, "Restricted app automation start time");
  const finishedAt = isoDate(item.finishedAt, "Restricted app automation finish time");
  if (Date.parse(finishedAt) < Date.parse(startedAt)) throw new Error("Restricted app automation run times are invalid.");
  const error = item.error === undefined ? undefined : nonempty(item.error, "Restricted app automation run error", 300);
  if (item.outcome === "success" ? error !== undefined : error === undefined) {
    throw new Error("Restricted app automation run error does not match its outcome.");
  }
  return {
    runId,
    automationId,
    reason: item.reason,
    scheduledAt: isoDate(item.scheduledAt, "Restricted app automation scheduled time"),
    startedAt,
    finishedAt,
    outcome: item.outcome,
    ...(error ? { error } : {}),
    digest: expectedDigest,
  };
}
