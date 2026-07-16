import { randomUUID } from "node:crypto";
import { Buffer } from "node:buffer";
import { existsSync } from "node:fs";
import { lstat, mkdir, readFile, readdir, realpath, rename, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

import {
  normalizeRestrictedAppCredential,
  RestrictedAppError,
  type RestrictedAppConnectionBinding,
  type RestrictedAppConnectionFeatureScope,
  type RestrictedAppConnectionStatus,
  type RestrictedAppConnectionStore,
  type RestrictedAppCredential,
  type RestrictedAppEffectAuthorizer,
} from "./restricted-app-connections.js";
import {
  parseRestrictedAppManifest,
  restrictedAppNetworkOrigin,
  type RestrictedAppAutomationDeclaration,
  type RestrictedAppManifest,
} from "./restricted-app-manifest.js";
import { RestrictedAppFileBroker, type RestrictedAppFileGrant } from "./restricted-app-files.js";
import type {
  FileRestrictedAppStorage,
  RestrictedAppStorageOwner,
  RestrictedAppStorageUsage,
} from "./restricted-app-storage.js";
import { RestrictedAppOAuthError, type RestrictedAppOAuthPkceClient } from "./restricted-app-oauth.js";
import {
  inspectRestrictedAppPackage,
  stageRestrictedAppPackage,
} from "./restricted-app-package.js";
import {
  workspaceAutomationMaxErrorLength,
  WorkspaceAutomationService,
  type WorkspaceAutomationClock,
  type WorkspaceAutomationRunContext,
  type WorkspaceAutomationRunResult,
} from "./workspace-automation-service.js";
import {
  advanceAuthorityStamp,
  authorityStampsEqual,
  computeDeclarationDigest,
  createAuthorityGeneration,
  createAuthorityStamp,
  createDataNamespaceId,
  createFeatureInstallationId,
  createPrincipalId,
  createProjectId,
  createRuntimeInstanceId,
  createTenantId,
  parseAuthorityGeneration,
  parseAuthorityStamp,
  parseDataNamespaceId,
  parseFeatureInstallationId,
  parsePrincipalId,
  parseProjectId,
  parseRuntimeInstanceId,
  parseTenantId,
  type AuthorityGeneration,
  type AuthorityStamp,
  type DataNamespaceId,
  type FeatureInstallationId,
  type EffectivePrincipal,
  type PrincipalId,
  type ProjectId,
  type RuntimeInstanceId,
  type TenantId,
} from "./app-platform-contract.js";
import {
  parseAppPlatformArtifactDigest,
  type AppPlatformArtifactDigest,
} from "./app-platform-artifact.js";
export interface RestrictedAppReview {
  packageName: string;
  version: string;
  digest: string;
  artifactDigest: AppPlatformArtifactDigest;
  manifest: RestrictedAppManifest;
  fileCount: number;
  totalBytes: number;
}

export interface RestrictedAppInstalled extends RestrictedAppReview {
  workspaceId: string;
  projectId: ProjectId;
  tenantId: TenantId;
  principalId: PrincipalId;
  runtimeInstanceId: RuntimeInstanceId;
  runtimeInstanceKind: "development";
  featureInstallationId: FeatureInstallationId;
  dataNamespaceId: DataNamespaceId;
  authority: Readonly<AuthorityStamp>;
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
  receiptId: string;
  verification: "captured" | "legacy-unverified";
  runId: string;
  automationId: string;
  reason: "scheduled" | "manual" | "resume";
  scheduledAt: string;
  startedAt: string;
  finishedAt: string;
  outcome: "success" | "failure" | "skipped" | "cancelled" | "interrupted";
  error?: string;
  kind?: "job";
  tenantId?: TenantId;
  runtimeInstanceId?: RuntimeInstanceId;
  featureInstallationId?: FeatureInstallationId;
  featureRevisionDigest?: AppPlatformArtifactDigest;
  dataNamespaceId?: DataNamespaceId;
  effectivePrincipal?: EffectivePrincipal;
  authority?: Readonly<AuthorityStamp>;
  acceptedAt?: string;
  state?: "succeeded" | "failed" | "skipped" | "cancelled" | "expired";
  occurrenceId?: string;
  attemptId?: string;
}

export interface RestrictedAppRuntimeDescriptor extends RestrictedAppInstalled {
  stagedRoot: string;
}

export interface RestrictedAppRuntimeAuthority {
  workspaceId: string;
  appId: string;
  digest: string;
  runtimeInstanceId: RuntimeInstanceId;
  featureInstallationId: FeatureInstallationId;
  authority: Readonly<AuthorityStamp>;
}

export interface RestrictedAppRuntimeHost {
  syncAuthority?(authorities: readonly RestrictedAppRuntimeAuthority[]): void;
  invoke(app: RestrictedAppRuntimeDescriptor, action: string, input: unknown): Promise<unknown>;
  runAutomation?(app: RestrictedAppRuntimeDescriptor, event: {
    runId: string;
    automationId: string;
    handler: string;
    reason: "scheduled" | "manual" | "resume";
    scheduledAt: string;
    effectivePrincipal: EffectivePrincipal;
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
  schemaVersion: 3;
  localIdentity: {
    tenantId: TenantId;
    principalId: PrincipalId;
    servicePrincipalId: PrincipalId;
    principalGeneration: AuthorityGeneration;
  };
  projects: RestrictedAppProjectRegistryEntry[];
  runtimeInstances: RestrictedAppRuntimeInstanceRegistryEntry[];
  installations: RestrictedAppRegistryEntry[];
  migrations: RestrictedAppRegistryMigration[];
  pendingCleanups: RestrictedAppPendingCleanup[];
  acceptedAutomationRuns: RestrictedAppAcceptedAutomationRegistryReceipt[];
  historicalAutomationRuns: RestrictedAppHistoricalAutomationRegistryReceipt[];
}

const restrictedAppRegistryMaximumBytes = 5 * 1024 * 1024;

interface RestrictedAppProjectRegistryEntry {
  workspaceId: string;
  projectId: ProjectId;
  createdAt: string;
}

interface RestrictedAppRuntimeInstanceRegistryEntry {
  kind: "development";
  workspaceId: string;
  projectId: ProjectId;
  runtimeInstanceId: RuntimeInstanceId;
  runtimeInstanceGeneration: AuthorityGeneration;
  createdAt: string;
  updatedAt: string;
}

interface RestrictedAppRegistryMigration {
  fromVersion: 2;
  toVersion: 3;
  migratedAt: string;
}

interface RestrictedAppPendingCleanup {
  cleanupId: string;
  connectionScope: RestrictedAppConnectionFeatureScope | null;
  storageOwner: RestrictedAppStorageOwner | null;
  packageDigest: string | null;
  createdAt: string;
}

interface RestrictedAppAutomationRegistryState {
  id: string;
  enabled: boolean;
  lastScheduledAt?: string;
  lastRunAt?: string;
  lastError?: string;
}

interface RestrictedAppAutomationRegistryReceipt extends RestrictedAppAutomationRunReceipt {
  packageDigest: string;
}

interface RestrictedAppAcceptedAutomationRegistryReceipt extends AcceptedAutomationContext {
  readonly receiptId: string;
  readonly verification: "captured";
  readonly kind: "job";
  readonly state: "accepted";
  readonly workspaceId: string;
  readonly appId: string;
  readonly packageDigest: string;
  readonly runId: string;
  readonly automationId: string;
  readonly reason: "scheduled" | "manual" | "resume";
  readonly scheduledAt: string;
}

interface RestrictedAppHistoricalAutomationRegistryReceipt extends RestrictedAppAutomationRegistryReceipt {
  readonly workspaceId: string;
  readonly appId: string;
}

interface AcceptedAutomationContext {
  readonly tenantId: TenantId;
  readonly runtimeInstanceId: RuntimeInstanceId;
  readonly featureInstallationId: FeatureInstallationId;
  readonly featureRevisionDigest: AppPlatformArtifactDigest;
  readonly dataNamespaceId: DataNamespaceId;
  readonly effectivePrincipal: EffectivePrincipal;
  readonly authority: Readonly<AuthorityStamp>;
  readonly acceptedAt: string;
  readonly occurrenceId: string;
  readonly attemptId: string;
}

interface RestrictedAppRegistryEntry {
  workspaceId: string;
  projectId: ProjectId;
  runtimeInstanceId: RuntimeInstanceId;
  featureInstallationId: FeatureInstallationId;
  dataNamespaceId: DataNamespaceId;
  authority: Readonly<AuthorityStamp>;
  packageName: string;
  version: string;
  digest: string;
  artifactDigest: AppPlatformArtifactDigest;
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
  readonly #acceptedAutomations = new Map<string, AcceptedAutomationContext>();
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
      onResult: async (result) => { await this.#recordAutomationResult(result); },
    });
  }

  static async create(options: RestrictedAppServiceOptions): Promise<RestrictedAppService> {
    const rootPath = resolve(options.rootPath);
    await mkdir(join(rootPath, "staged"), { recursive: true });
    const now = options.now ?? (() => new Date());
    const loaded = await readRegistry(join(rootPath, "registry.json"), now);
    const reconciled = reconcileInterruptedAutomationRuns(loaded.registry, now().toISOString());
    const service = new RestrictedAppService({ ...options, now }, reconciled.registry);
    if (loaded.needsWrite || reconciled.needsWrite) await service.#writeRegistry(reconciled.registry);
    else service.#syncRuntimeAuthorities();
    if (options.storage) {
      for (const entry of reconciled.registry.installations) {
        await options.storage.migrateLegacyOwner(
          { workspaceId: entry.workspaceId, appId: entry.manifest.id },
          storageOwnerFromEntry(entry, reconciled.registry.localIdentity),
        );
      }
    }
    await service.#drainPendingCleanups();
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
    return this.#registry.installations
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
      const existing = this.#registry.installations.find((item) => item.workspaceId === input.workspaceId && item.manifest.id === inspection.manifest.id);
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
      const context = developmentContext(this.#registry, input.workspaceId, timestamp);
      const entry: RestrictedAppRegistryEntry = {
        workspaceId: input.workspaceId,
        projectId: context.project.projectId,
        runtimeInstanceId: context.runtimeInstance.runtimeInstanceId,
        featureInstallationId: existing?.featureInstallationId ?? createFeatureInstallationId(),
        dataNamespaceId: existing?.dataNamespaceId ?? createDataNamespaceId(),
        authority: existing
          ? advanceAuthorityStamp(existing.authority, [
            "featureInstallationGeneration",
            "grantGeneration",
            "connectionGeneration",
            "jobGeneration",
          ])
          : authorityForContext(this.#registry, context.runtimeInstance),
        packageName: staged.packageName,
        version: staged.version,
        digest: staged.digest,
        artifactDigest: staged.artifactDigest,
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
      const next = this.#registry.installations.filter((item) => !(item.workspaceId === input.workspaceId && item.manifest.id === entry.manifest.id));
      next.push(entry);
      const pendingCleanups = existing
        ? [...this.#registry.pendingCleanups, pendingCleanupForEntry(existing, this.#registry.localIdentity, false, timestamp)]
        : this.#registry.pendingCleanups;
      await this.#writeRegistry({
        ...this.#registry,
        projects: context.projects,
        runtimeInstances: context.runtimeInstances,
        installations: next,
        pendingCleanups,
      });
      if (existing) {
        this.#unregisterAppAutomations(existing);
        await this.#drainPendingCleanups();
      }
      this.#syncAppAutomations(entry);
      return this.#copyInstalled(entry);
    });
  }

  async remove(input: { workspaceId: string; appId: string; expectedDigest?: string }): Promise<boolean> {
    return await this.#mutate(async () => {
      const appId = appIdValue(input.appId);
      const existing = this.#registry.installations.find((item) => item.workspaceId === input.workspaceId && item.manifest.id === appId);
      if (!existing) return false;
      if (input.expectedDigest !== undefined && digestValue(input.expectedDigest) !== existing.digest) {
        throw new RestrictedAppError("REVISION_CHANGED", "The installed app revision changed. Refresh before removing it.");
      }
      await this.#runtimeHost?.stop(input.workspaceId, appId, existing.digest);
      await this.#invalidateOAuthApp(existing);
      const timestamp = this.#now().toISOString();
      await this.#writeRegistry({
        ...this.#registry,
        installations: this.#registry.installations.filter((item) => item !== existing),
        pendingCleanups: [
          ...this.#registry.pendingCleanups,
          pendingCleanupForEntry(existing, this.#registry.localIdentity, true, timestamp),
        ],
      });
      this.#unregisterAppAutomations(existing);
      await this.#drainPendingCleanups();
      return true;
    });
  }

  async removeWorkspace(workspaceId: string): Promise<void> {
    await this.#mutate(async () => {
      const removed = this.#registry.installations.filter((item) => item.workspaceId === workspaceId);
      const hasContext = this.#registry.projects.some((item) => item.workspaceId === workspaceId)
        || this.#registry.runtimeInstances.some((item) => item.workspaceId === workspaceId);
      if (!removed.length && !hasContext) return;
      await Promise.all(removed.map((app) => this.#runtimeHost?.stop(workspaceId, app.manifest.id, app.digest)));
      await Promise.all(removed.map((app) => this.#invalidateOAuthApp(app)));
      const timestamp = this.#now().toISOString();
      await this.#writeRegistry({
        ...this.#registry,
        projects: this.#registry.projects.filter((item) => item.workspaceId !== workspaceId),
        runtimeInstances: this.#registry.runtimeInstances.filter((item) => item.workspaceId !== workspaceId),
        installations: this.#registry.installations.filter((item) => item.workspaceId !== workspaceId),
        pendingCleanups: [
          ...this.#registry.pendingCleanups,
          ...removed.map((app) => pendingCleanupForEntry(app, this.#registry.localIdentity, true, timestamp)),
        ],
      });
      for (const app of removed) this.#unregisterAppAutomations(app);
      await this.#drainPendingCleanups();
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
      if (none) return { destinationId: destination.id, owner: "instance" as const, kind: "none" as const, configured: true };
      const binding = connectionBinding(app, this.#registry.localIdentity, destination);
      const credential = await this.#connections?.get(binding);
      return {
        destinationId: destination.id,
        owner: binding.owner.kind,
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
      const authorized = await this.#advanceInstalledAuthority(app, ["connectionGeneration"]);
      const authorizeEffect = () => this.#assertInstalledAuthority(authorized);
      await this.#invalidateOAuthDestination(authorized, destination, authorizeEffect);
      await this.#connections.set(
        connectionBinding(authorized, this.#registry.localIdentity, destination),
        credential,
        authorizeEffect,
      );
      return { destinationId: destination.id, owner: "instance", kind: credential.kind, configured: true };
    });
  }

  async deleteConnection(input: { workspaceId: string; appId: string; expectedDigest: string; destinationId: string }): Promise<boolean> {
    return await this.#mutate(async () => {
      if (!this.#connections) return false;
      const app = this.#installed(input.workspaceId, input.appId, input.expectedDigest);
      const destination = app.manifest.permissions.network.find((item) => item.id === input.destinationId);
      if (!destination) return false;
      await this.#runtimeHost?.stop(app.workspaceId, app.manifest.id, app.digest);
      const authorized = await this.#advanceInstalledAuthority(app, ["connectionGeneration"]);
      const authorizeEffect = () => this.#assertInstalledAuthority(authorized);
      const oauthRemoved = await this.#invalidateOAuthDestination(authorized, destination, authorizeEffect);
      const removed = oauthRemoved !== undefined
        ? oauthRemoved
        : await this.#connections.delete(
          connectionBinding(authorized, this.#registry.localIdentity, destination),
          authorizeEffect,
        );
      return removed;
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
      await this.#runtimeHost?.stop(app.workspaceId, app.manifest.id, app.digest);
      const authorized = await this.#mutate(async () => {
        const current = this.#installed(input.workspaceId, input.appId, input.expectedDigest);
        return await this.#advanceInstalledAuthority(current, ["connectionGeneration"]);
      });
      const status = await this.#oauth.connect(
        connectionBinding(authorized, this.#registry.localIdentity, destination),
        declaration,
        undefined,
        () => this.#assertInstalledAuthority(authorized),
      );
      return { destinationId: destination.id, owner: "instance", kind: status.kind, configured: true };
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
      const existing = this.#registry.installations.find((item) => item.workspaceId === app.workspaceId && item.manifest.id === app.manifest.id)!;
      const state = existing.automations.find((item) => item.id === declaration.id)!;
      if (state.enabled === input.enabled) return this.#copyInstalled(existing);
      const nextState: RestrictedAppAutomationRegistryState = {
        ...state,
        enabled: input.enabled,
        ...(input.enabled ? { lastScheduledAt: this.#now().toISOString() } : { lastError: undefined }),
      };
      const next: RestrictedAppRegistryEntry = {
        ...existing,
        authority: advanceAuthorityStamp(existing.authority, ["jobGeneration"]),
        automations: existing.automations.map((item) => item === state ? nextState : item),
      };
      if (!input.enabled) this.#syncAutomation(next, declaration);
      try {
        if (!input.enabled) await this.#runtimeHost?.stop(app.workspaceId, app.manifest.id, app.digest);
        await this.#writeRegistry({
          ...this.#registry,
          installations: this.#registry.installations.map((item) => item === existing ? next : item),
        });
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
    const entry = this.#registry.installations.find((item) => item.runtimeInstanceId === app.runtimeInstanceId
      && item.featureInstallationId === app.featureInstallationId)!;
    const key = automationKey(entry, declaration.id);
    if (!this.#automations.has(key)) {
      this.#syncAutomation(entry, declaration);
    }
    const result = await this.#automations.runNow(key);
    const recorded = await this.#recordAutomationResult(result);
    if (!recorded) throw new RestrictedAppError("APP_UNAVAILABLE", "The automation receipt could not be persisted.");
    return {
      app: this.#installed(input.workspaceId, input.appId, input.expectedDigest),
      run: recorded,
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
    const entry = this.#registry.installations.find((item) => item.workspaceId === app.workspaceId && item.manifest.id === app.manifest.id)!;
    return entry.automationRuns
      .filter((run) => run.automationId === declaration.id && run.packageDigest === app.digest)
      .slice(-50)
      .reverse()
      .map(({ packageDigest: _packageDigest, ...run }) => structuredClone(run));
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
    return await this.#storage.usage(storageOwnerFromEntry(app, this.#registry.localIdentity));
  }

  async clearStorage(workspaceId: string, appId: string, expectedDigest: string): Promise<RestrictedAppStorageUsage> {
    return await this.#mutate(async () => {
      const app = this.#installed(workspaceId, appId, expectedDigest);
      if (!this.#storage) throw new RestrictedAppError("APP_UNAVAILABLE", "Restricted app storage requires the Workspace desktop host.");
      await this.#runtimeHost?.stop(app.workspaceId, app.manifest.id, app.digest);
      await this.#advanceInstalledAuthority(app, ["dataGeneration"]);
      return await this.#storage.clear(storageOwnerFromEntry(app, this.#registry.localIdentity));
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
    const entry = this.#registry.installations.find((item) => item.workspaceId === workspaceId && item.manifest.id === id);
    if (!entry) throw new RestrictedAppError("APP_UNAVAILABLE", "The restricted app is not installed in this Space.");
    if (entry.digest !== digest) throw new RestrictedAppError("REVISION_CHANGED", "The restricted app revision changed. Refresh before using it.");
    return this.#copyInstalled(entry);
  }

  #copyInstalled(entry: RestrictedAppRegistryEntry): RestrictedAppInstalled {
    const installed = copyInstalled(entry, this.#registry.localIdentity);
    installed.automations = installed.automations.map((state) => {
      const nextRunAt = this.#automations.nextScheduledAt(automationKey(entry, state.id));
      return { ...state, ...(nextRunAt ? { nextRunAt } : {}) };
    });
    return installed;
  }

  async #advanceInstalledAuthority(
    app: Pick<RestrictedAppInstalled, "workspaceId" | "digest" | "manifest">,
    fields: readonly Parameters<typeof advanceAuthorityStamp>[1][number][],
  ): Promise<RestrictedAppInstalled> {
    const existing = this.#registry.installations.find((item) => item.workspaceId === app.workspaceId
      && item.manifest.id === app.manifest.id && item.digest === app.digest);
    if (!existing) throw new RestrictedAppError("REVISION_CHANGED", "The restricted app authority changed before the operation completed.");
    const next = { ...existing, authority: advanceAuthorityStamp(existing.authority, fields) };
    await this.#writeRegistry({
      ...this.#registry,
      installations: this.#registry.installations.map((item) => item === existing ? next : item),
    });
    return this.#copyInstalled(next);
  }

  #assertInstalledAuthority(expected: Pick<RestrictedAppInstalled,
    "runtimeInstanceId" | "featureInstallationId" | "artifactDigest" | "authority">): void {
    const current = this.#registry.installations.find((item) => item.runtimeInstanceId === expected.runtimeInstanceId
      && item.featureInstallationId === expected.featureInstallationId
      && item.artifactDigest === expected.artifactDigest);
    if (!current || !authorityStampsEqual(current.authority, expected.authority)) {
      throw new RestrictedAppError("AUTHORITY_STALE", "The restricted app authority changed before the effect committed.");
    }
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
      const existing = this.#registry.installations.find((item) => item.workspaceId === app.workspaceId && item.manifest.id === app.manifest.id)!;
      await this.#runtimeHost?.stop(app.workspaceId, app.manifest.id, app.digest);
      const next: RestrictedAppRegistryEntry = {
        ...existing,
        authority: advanceAuthorityStamp(existing.authority, ["grantGeneration"]),
        networkGrants: granted
          ? [...existing.networkGrants, destination.id].sort()
          : existing.networkGrants.filter((id) => id !== destination.id),
      };
      await this.#writeRegistry({
        ...this.#registry,
        installations: this.#registry.installations.map((item) => item === existing ? next : item),
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
      const existing = this.#registry.installations.find((item) => item.workspaceId === app.workspaceId && item.manifest.id === app.manifest.id)!;
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
        authority: advanceAuthorityStamp(existing.authority, ["grantGeneration"]),
        fileGrants: granted
          ? [...existing.fileGrants, nextGrant!].sort((left, right) => left.id.localeCompare(right.id))
          : existing.fileGrants.filter((item) => item.declarationId !== permission.id),
      };
      await this.#writeRegistry({
        ...this.#registry,
        installations: this.#registry.installations.map((item) => item === existing ? next : item),
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
      const existing = this.#registry.installations.find((item) => item.workspaceId === app.workspaceId && item.manifest.id === app.manifest.id)!;
      await this.#runtimeHost?.stop(app.workspaceId, app.manifest.id, app.digest);
      const next: RestrictedAppRegistryEntry = {
        ...existing,
        authority: advanceAuthorityStamp(existing.authority, ["grantGeneration"]),
        notificationGrants: granted
          ? [...existing.notificationGrants, permission.id].sort()
          : existing.notificationGrants.filter((id) => id !== permission.id),
      };
      await this.#writeRegistry({
        ...this.#registry,
        installations: this.#registry.installations.map((item) => item === existing ? next : item),
      });
      return this.#copyInstalled(next);
    });
  }

  #syncAllAutomations(): void {
    for (const app of this.#registry.installations) this.#syncAppAutomations(app);
  }

  #syncAppAutomations(app: RestrictedAppRegistryEntry): void {
    for (const declaration of app.manifest.automations) this.#syncAutomation(app, declaration);
  }

  #syncAutomation(app: RestrictedAppRegistryEntry, declaration: RestrictedAppAutomationDeclaration): void {
    const state = app.automations.find((item) => item.id === declaration.id);
    if (!state) throw new Error(`Restricted app automation state is missing for ${declaration.id}.`);
    const definition = {
      key: automationKey(app, declaration.id),
      intervalMinutes: declaration.trigger.intervalMinutes,
      enabled: state.enabled,
      catchUp: declaration.catchUp,
      ...(state.lastScheduledAt ? { lastScheduledAt: state.lastScheduledAt } : {}),
      run: (context: WorkspaceAutomationRunContext) => this.#executeAutomation(
        app.runtimeInstanceId,
        app.featureInstallationId,
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
      this.#automations.unregister(automationKey(app, declaration.id));
    }
  }

  async #executeAutomation(
    runtimeInstanceId: RuntimeInstanceId,
    featureInstallationId: FeatureInstallationId,
    digest: string,
    automationId: string,
    context: WorkspaceAutomationRunContext,
  ): Promise<void> {
    let execution: Promise<void> | undefined;
    await this.#mutate(async () => {
      const entry = this.#registry.installations.find((item) => item.runtimeInstanceId === runtimeInstanceId
        && item.featureInstallationId === featureInstallationId);
      if (!entry || entry.digest !== digest) {
        throw new RestrictedAppError("REVISION_CHANGED", "The automation Feature revision changed before it could start.");
      }
      const current = this.#copyInstalled(entry);
      const declaration = automationDeclaration(current.manifest, automationId);
      const state = current.automations.find((item) => item.id === declaration.id)!;
      if (context.reason !== "manual" && !state.enabled) {
        throw new RestrictedAppError("APP_UNAVAILABLE", "The automation was disabled before it could start.");
      }
      this.#assertAutomationRuntime();
      const effectivePrincipal = Object.freeze({
        principalId: context.reason === "manual"
          ? this.#registry.localIdentity.principalId
          : this.#registry.localIdentity.servicePrincipalId,
        kind: context.reason === "manual" ? "human" as const : "service" as const,
        realm: "local" as const,
      });
      const scoped: RestrictedAppRuntimeDescriptor = {
        ...current,
        networkGrants: current.networkGrants.filter((id) => declaration.permissions.network.includes(id)),
        fileGrants: current.fileGrants.filter((grant) => declaration.permissions.files.includes(grant.declarationId)),
        notificationGrants: current.notificationGrants.filter((id) => declaration.permissions.notifications.includes(id)),
        automations: current.automations.filter((automation) => automation.id === declaration.id),
        stagedRoot: this.#digestRoot(current.digest),
      };
      const acceptedAt = this.#now().toISOString();
      const accepted: RestrictedAppAcceptedAutomationRegistryReceipt = {
        receiptId: `receipt_${randomUUID()}`,
        verification: "captured",
        kind: "job",
        state: "accepted",
        workspaceId: current.workspaceId,
        appId: current.manifest.id,
        packageDigest: current.digest,
        runId: context.runId,
        automationId: declaration.id,
        reason: context.reason,
        scheduledAt: context.scheduledAt,
        tenantId: current.tenantId,
        runtimeInstanceId: current.runtimeInstanceId,
        featureInstallationId: current.featureInstallationId,
        featureRevisionDigest: current.artifactDigest,
        dataNamespaceId: current.dataNamespaceId,
        effectivePrincipal,
        authority: parseAuthorityStamp(current.authority),
        acceptedAt,
        occurrenceId: `occurrence_${context.runId}`,
        attemptId: `attempt_${context.runId}`,
      };
      if (this.#registry.acceptedAutomationRuns.some((item) => item.runId === context.runId)
        || this.#registry.historicalAutomationRuns.some((item) => item.runId === context.runId)) {
        throw new RestrictedAppError("APP_UNAVAILABLE", "The automation run id is already present in the durable receipt ledger.");
      }
      if (this.#registry.acceptedAutomationRuns.length >= 1_000) {
        throw new RestrictedAppError("APP_UNAVAILABLE", "The durable accepted-run ledger is full and requires recovery before another automation can start.");
      }
      const next = {
        ...this.#registry,
        acceptedAutomationRuns: [...this.#registry.acceptedAutomationRuns, accepted],
      };
      assertRegistryPersistenceBound(reconcileInterruptedAutomationRuns(
        next,
        acceptedAt,
        "\0".repeat(workspaceAutomationMaxErrorLength),
      ).registry);
      await this.#writeRegistry(next);
      this.#acceptedAutomations.set(context.runId, accepted);
      execution = this.#runtimeHost!.runAutomation!(scoped, {
        runId: context.runId,
        automationId: declaration.id,
        handler: declaration.handler,
        reason: context.reason,
        scheduledAt: context.scheduledAt,
        effectivePrincipal,
      }, context.signal);
    });
    if (!execution) throw new RestrictedAppError("APP_UNAVAILABLE", "The automation could not start.");
    await execution;
  }

  async #recordAutomationResult(result: WorkspaceAutomationRunResult): Promise<RestrictedAppAutomationRunReceipt | undefined> {
    if (this.#closed) return undefined;
    const owner = automationOwner(result.key.ownerId);
    let recorded: RestrictedAppAutomationRunReceipt | undefined;
    try {
      await this.#mutate(async () => {
        const historicalDuplicate = this.#registry.historicalAutomationRuns.find((run) => run.runId === result.runId);
        if (historicalDuplicate) {
          const {
            packageDigest: _packageDigest,
            workspaceId: _workspaceId,
            appId: _appId,
            ...receipt
          } = historicalDuplicate;
          recorded = structuredClone(receipt);
          return;
        }
        const existing = this.#registry.installations.find((item) => item.runtimeInstanceId === owner.runtimeInstanceId
          && item.featureInstallationId === owner.featureInstallationId && item.digest === owner.digest);
        const pending = this.#registry.acceptedAutomationRuns.find((item) => item.runId === result.runId);
        if (!pending && !existing) return;
        if (pending && (pending.runtimeInstanceId !== owner.runtimeInstanceId
          || pending.featureInstallationId !== owner.featureInstallationId
          || pending.packageDigest !== owner.digest
          || pending.automationId !== result.key.jobId
          || pending.reason !== result.reason
          || pending.scheduledAt !== result.scheduledAt)) {
          throw new Error("Automation result does not match its durable accepted receipt.");
        }
        const declaration = existing?.manifest.automations.find((item) => item.id === result.key.jobId);
        const state = existing?.automations.find((item) => item.id === result.key.jobId);
        const accepted = pending ?? this.#acceptedAutomations.get(result.runId) ?? (existing
          ? acceptedAutomationContext(existing, this.#registry.localIdentity, result)
          : undefined);
        if (!accepted) return;
        const publicReceipt = capturedAutomationRun(result, accepted);
        const packageDigest = pending?.packageDigest ?? existing!.digest;
        const workspaceId = pending?.workspaceId ?? existing!.workspaceId;
        const appId = pending?.appId ?? existing!.manifest.id;
        const receipt: RestrictedAppAutomationRegistryReceipt = { ...publicReceipt, packageDigest };
        const historical: RestrictedAppHistoricalAutomationRegistryReceipt = {
          ...receipt,
          workspaceId,
          appId,
        };
        let installations = this.#registry.installations;
        if (existing && declaration && state) {
          const nextState: RestrictedAppAutomationRegistryState = {
            ...state,
            ...(result.reason === "manual" ? {} : { lastScheduledAt: result.scheduledAt }),
            ...(result.outcome === "success" || result.outcome === "failure" ? { lastRunAt: result.finishedAt } : {}),
            ...(result.outcome === "failure" ? { lastError: result.error ?? "Automation run failed." }
              : result.outcome === "success" ? { lastError: undefined }
              : {}),
          };
          const next: RestrictedAppRegistryEntry = {
            ...existing,
            automations: existing.automations.map((item) => item === state ? nextState : item),
            automationRuns: [...existing.automationRuns, receipt].slice(-200),
          };
          installations = installations.map((item) => item === existing ? next : item);
        }
        await this.#writeRegistry({
          ...this.#registry,
          installations,
          acceptedAutomationRuns: this.#registry.acceptedAutomationRuns.filter((item) => item.runId !== result.runId),
          historicalAutomationRuns: [...this.#registry.historicalAutomationRuns, historical].slice(-1_000),
        });
        recorded = publicReceipt;
      });
    } finally {
      this.#acceptedAutomations.delete(result.runId);
    }
    return recorded;
  }

  #assertAutomationRuntime(): void {
    if (!this.#runtimeHost?.runAutomation) {
      throw new RestrictedAppError("APP_UNAVAILABLE", "Automations require the Workspace desktop host.");
    }
  }

  async #invalidateOAuthApp(app: Pick<RestrictedAppRegistryEntry,
    "runtimeInstanceId" | "featureInstallationId" | "artifactDigest" | "manifest">): Promise<void> {
    if (!this.#oauth) return;
    for (const destination of app.manifest.permissions.network) {
      await this.#invalidateOAuthDestination(app, destination);
    }
  }

  async #invalidateOAuthDestination(
    app: Pick<RestrictedAppRegistryEntry,
      "runtimeInstanceId" | "featureInstallationId" | "artifactDigest" | "manifest">,
    destination: RestrictedAppManifest["permissions"]["network"][number],
    authorizeEffect?: RestrictedAppEffectAuthorizer,
  ): Promise<boolean | undefined> {
    if (!this.#oauth || !destination.auth.some((item) => item.kind === "oauth2-pkce")) return undefined;
    try {
      return await this.#oauth.disconnect(
        connectionBinding(app, this.#registry.localIdentity, destination),
        authorizeEffect,
      );
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
        await this.#drainPendingCleanups();
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
    const source = serializeRegistryFile(next);
    await writeFile(temporary, source, { encoding: "utf8", flag: "wx" });
    try {
      await rename(temporary, this.#registryPath);
    } catch (error) {
      await rm(temporary, { force: true });
      throw error;
    }
    this.#registry = next;
    this.#syncRuntimeAuthorities();
  }

  #syncRuntimeAuthorities(): void {
    this.#runtimeHost?.syncAuthority?.(this.#registry.installations.map((item) => ({
      workspaceId: item.workspaceId,
      appId: item.manifest.id,
      digest: item.digest,
      runtimeInstanceId: item.runtimeInstanceId,
      featureInstallationId: item.featureInstallationId,
      authority: item.authority,
    })));
  }

  async #drainPendingCleanups(): Promise<void> {
    for (const cleanup of [...this.#registry.pendingCleanups]) {
      let complete = true;
      if (cleanup.connectionScope) {
        if (!this.#connections) complete = false;
        else {
          try {
            await this.#connections.deleteFeature(cleanup.connectionScope);
          } catch {
            complete = false;
          }
        }
      }
      if (cleanup.storageOwner) {
        if (!this.#storage) complete = false;
        else {
          try {
            await this.#storage.deleteApp(cleanup.storageOwner);
          } catch {
            complete = false;
          }
        }
      }
      if (cleanup.packageDigest) {
        try {
          await this.#garbageCollectDigest(cleanup.packageDigest);
        } catch {
          complete = false;
        }
      }
      if (!complete) continue;
      await this.#writeRegistry({
        ...this.#registry,
        pendingCleanups: this.#registry.pendingCleanups.filter((item) => item.cleanupId !== cleanup.cleanupId),
      });
    }
  }

  async #cleanupStaging(): Promise<void> {
    const referenced = new Set(this.#registry.installations.map((item) => item.digest));
    for (const entry of await readdir(this.#stagingPath, { withFileTypes: true })) {
      if (entry.isSymbolicLink() || !entry.isDirectory()) continue;
      if (/^\.staging-[0-9a-f-]{36}$/i.test(entry.name) || (/^[0-9a-f]{64}$/.test(entry.name) && !referenced.has(entry.name))) {
        await rm(join(this.#stagingPath, entry.name), { recursive: true, force: true });
      }
    }
  }

  async #garbageCollectDigest(digest: string): Promise<void> {
    if (this.#registry.installations.some((item) => item.digest === digest)) return;
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

async function readRegistry(
  path: string,
  now: () => Date,
): Promise<{ registry: RestrictedAppRegistryFile; needsWrite: boolean }> {
  if (!existsSync(path)) return { registry: freshRegistry(), needsWrite: true };
  const info = await lstat(path);
  if (info.isSymbolicLink() || !info.isFile() || info.size > restrictedAppRegistryMaximumBytes) {
    throw new Error("Restricted app registry is unsafe or too large.");
  }
  let value: unknown;
  try {
    value = JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    throw new Error(`Workspace could not read the restricted app registry: ${errorMessage(error)}`);
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Restricted app registry must be an object.");
  const record = value as Record<string, unknown>;
  if (record.schemaVersion === 3) return { registry: registryFileV3(record), needsWrite: false };
  if (record.schemaVersion === 2) {
    return {
      registry: await migrateRegistryV2(record, dirname(path), now().toISOString()),
      needsWrite: true,
    };
  }
  throw new Error("Restricted app registry version is unsupported.");
}

function freshRegistry(): RestrictedAppRegistryFile {
  return {
    schemaVersion: 3,
    localIdentity: {
      tenantId: createTenantId(),
      principalId: createPrincipalId(),
      servicePrincipalId: createPrincipalId(),
      principalGeneration: createAuthorityGeneration(),
    },
    projects: [],
    runtimeInstances: [],
    installations: [],
    migrations: [],
    pendingCleanups: [],
    acceptedAutomationRuns: [],
    historicalAutomationRuns: [],
  };
}

function reconcileInterruptedAutomationRuns(
  registry: RestrictedAppRegistryFile,
  recoveredAt: string,
  recoveryError = "Workspace restarted after accepting this automation run; completion of external effects is unknown.",
): { registry: RestrictedAppRegistryFile; needsWrite: boolean } {
  if (registry.acceptedAutomationRuns.length === 0) return { registry, needsWrite: false };
  const recovered = registry.acceptedAutomationRuns.map((accepted): RestrictedAppHistoricalAutomationRegistryReceipt => {
    const finishedAt = Date.parse(recoveredAt) >= Date.parse(accepted.acceptedAt) ? recoveredAt : accepted.acceptedAt;
    return {
      receiptId: accepted.receiptId,
      verification: "captured",
      kind: "job",
      tenantId: accepted.tenantId,
      runtimeInstanceId: accepted.runtimeInstanceId,
      featureInstallationId: accepted.featureInstallationId,
      featureRevisionDigest: accepted.featureRevisionDigest,
      dataNamespaceId: accepted.dataNamespaceId,
      effectivePrincipal: accepted.effectivePrincipal,
      authority: parseAuthorityStamp(accepted.authority),
      acceptedAt: accepted.acceptedAt,
      state: "expired",
      occurrenceId: accepted.occurrenceId,
      attemptId: accepted.attemptId,
      runId: accepted.runId,
      automationId: accepted.automationId,
      reason: accepted.reason,
      scheduledAt: accepted.scheduledAt,
      startedAt: accepted.acceptedAt,
      finishedAt,
      outcome: "interrupted",
      error: recoveryError,
      packageDigest: accepted.packageDigest,
      workspaceId: accepted.workspaceId,
      appId: accepted.appId,
    };
  });
  const installations = registry.installations.map((entry) => {
    const matches = recovered.filter((receipt) => receipt.workspaceId === entry.workspaceId
      && receipt.appId === entry.manifest.id
      && receipt.packageDigest === entry.digest
      && receipt.runtimeInstanceId === entry.runtimeInstanceId
      && receipt.featureInstallationId === entry.featureInstallationId);
    if (matches.length === 0) return entry;
    const byAutomation = new Map(matches.map((receipt) => [receipt.automationId, receipt]));
    const automations = entry.automations.map((automation) => {
      const receipt = byAutomation.get(automation.id);
      return receipt ? { ...automation, lastRunAt: receipt.finishedAt, lastError: receipt.error } : automation;
    });
    const automationRuns = [...entry.automationRuns];
    for (const { workspaceId: _workspaceId, appId: _appId, ...receipt } of matches) {
      if (!automationRuns.some((item) => item.runId === receipt.runId)) automationRuns.push(receipt);
    }
    return { ...entry, automations, automationRuns: automationRuns.slice(-200) };
  });
  return {
    needsWrite: true,
    registry: {
      ...registry,
      installations,
      acceptedAutomationRuns: [],
      historicalAutomationRuns: [...registry.historicalAutomationRuns, ...recovered].slice(-1_000),
    },
  };
}

function assertRegistryPersistenceBound(registry: RestrictedAppRegistryFile): void {
  serializeRegistryFile(registry);
}

function serializeRegistryFile(registry: RestrictedAppRegistryFile): string {
  const source = `${JSON.stringify(registry, null, 2)}\n`;
  if (Buffer.byteLength(source, "utf8") > restrictedAppRegistryMaximumBytes) {
    throw new Error(`Restricted app registry exceeds the ${restrictedAppRegistryMaximumBytes}-byte persistence limit.`);
  }
  return source;
}

function registryFileV3(record: Record<string, unknown>): RestrictedAppRegistryFile {
  exactObjectKeys(record, [
    "schemaVersion", "localIdentity", "projects", "runtimeInstances", "installations", "migrations", "pendingCleanups",
    "acceptedAutomationRuns", "historicalAutomationRuns",
  ], "Restricted app registry");
  const local = objectValue(record.localIdentity, "Restricted app local identity");
  exactObjectKeys(local, ["tenantId", "principalId", "servicePrincipalId", "principalGeneration"], "Restricted app local identity");
  const localIdentity = {
    tenantId: parseTenantId(local.tenantId),
    principalId: parsePrincipalId(local.principalId),
    servicePrincipalId: parsePrincipalId(local.servicePrincipalId),
    principalGeneration: parseAuthorityGeneration(local.principalGeneration, "Restricted app local Principal generation"),
  };
  const projects = arrayValue(record.projects, "Restricted app projects").map(projectRegistryEntry);
  const runtimeInstances = arrayValue(record.runtimeInstances, "Restricted app Runtime Instances").map(runtimeInstanceRegistryEntry);
  const installations = arrayValue(record.installations, "Restricted app Feature Installations").map(registryEntry);
  const migrations = arrayValue(record.migrations, "Restricted app registry migrations").map(registryMigrationEntry);
  const pendingCleanups = arrayValue(record.pendingCleanups, "Restricted app pending cleanups").map(pendingCleanupEntry);
  const acceptedAutomationRuns = arrayValue(record.acceptedAutomationRuns, "Restricted app accepted automation receipts")
    .map(acceptedAutomationRunReceiptValue);
  const historicalAutomationRuns = arrayValue(record.historicalAutomationRuns, "Restricted app historical automation receipts")
    .map(historicalAutomationRunReceiptValue);
  if (acceptedAutomationRuns.length > 1_000 || historicalAutomationRuns.length > 1_000) {
    throw new Error("Restricted app automation receipt ledger exceeds its retention bound.");
  }

  assertUnique(projects.map((item) => item.workspaceId), "Restricted app registry contains duplicate Space projects.");
  assertUnique(projects.map((item) => item.projectId), "Restricted app registry contains duplicate project ids.");
  assertUnique(runtimeInstances.map((item) => item.workspaceId), "Restricted app registry contains duplicate Space Runtime Instances.");
  assertUnique(runtimeInstances.map((item) => item.runtimeInstanceId), "Restricted app registry contains duplicate Runtime Instance ids.");
  assertUnique(installations.map((item) => `${item.workspaceId}:${item.manifest.id}`), "Restricted app registry contains duplicate Space Feature ids.");
  assertUnique(installations.map((item) => item.featureInstallationId), "Restricted app registry contains duplicate Feature Installation ids.");
  assertUnique(installations.map((item) => item.dataNamespaceId), "Restricted app registry contains duplicate data namespace ids.");
  assertUnique(pendingCleanups.map((item) => item.cleanupId), "Restricted app registry contains duplicate pending cleanup ids.");
  assertUnique(acceptedAutomationRuns.map((item) => item.runId), "Restricted app registry contains duplicate accepted automation run ids.");
  assertUnique(historicalAutomationRuns.map((item) => item.runId), "Restricted app registry contains duplicate historical automation run ids.");
  if (acceptedAutomationRuns.some((item) => historicalAutomationRuns.some((receipt) => receipt.runId === item.runId))) {
    throw new Error("Restricted app automation run cannot be both accepted and terminal.");
  }

  for (const runtime of runtimeInstances) {
    const project = projects.find((item) => item.workspaceId === runtime.workspaceId);
    if (!project || project.projectId !== runtime.projectId) {
      throw new Error("Restricted app Runtime Instance does not match its App Project.");
    }
  }
  for (const installation of installations) {
    const project = projects.find((item) => item.workspaceId === installation.workspaceId);
    const runtime = runtimeInstances.find((item) => item.workspaceId === installation.workspaceId);
    if (!project || !runtime || installation.projectId !== project.projectId
      || installation.runtimeInstanceId !== runtime.runtimeInstanceId
      || installation.authority.runtimeInstanceGeneration !== runtime.runtimeInstanceGeneration
      || installation.authority.principalGeneration !== localIdentity.principalGeneration) {
      throw new Error("Restricted app Feature Installation does not match its host-owned context or authority.");
    }
    for (const receipt of installation.automationRuns) {
      if (receipt.verification !== "captured") continue;
      const expectedPrincipalId = receipt.reason === "manual"
        ? localIdentity.principalId
        : localIdentity.servicePrincipalId;
      const expectedPrincipalKind = receipt.reason === "manual" ? "human" : "service";
      if (receipt.tenantId !== localIdentity.tenantId
        || receipt.runtimeInstanceId !== installation.runtimeInstanceId
        || receipt.featureInstallationId !== installation.featureInstallationId
        || receipt.featureRevisionDigest !== installation.artifactDigest
        || receipt.dataNamespaceId !== installation.dataNamespaceId
        || receipt.effectivePrincipal?.realm !== "local"
        || receipt.effectivePrincipal.principalId !== expectedPrincipalId
        || receipt.effectivePrincipal.kind !== expectedPrincipalKind) {
        throw new Error("Restricted app automation receipt does not match its owning installation context.");
      }
    }
  }
  return {
    schemaVersion: 3,
    localIdentity,
    projects,
    runtimeInstances,
    installations,
    migrations,
    pendingCleanups,
    acceptedAutomationRuns,
    historicalAutomationRuns,
  };
}

async function migrateRegistryV2(
  record: Record<string, unknown>,
  registryRoot: string,
  migratedAt: string,
): Promise<RestrictedAppRegistryFile> {
  exactObjectKeys(record, ["schemaVersion", "apps"], "Restricted app registry v2");
  const legacy = arrayValue(record.apps, "Restricted app registry v2 apps").map(legacyRegistryEntry);
  assertUnique(legacy.map((item) => `${item.workspaceId}:${item.manifest.id}`), "Restricted app registry contains duplicate Space app ids.");
  const registry = freshRegistry();
  let next = registry;
  const installations: RestrictedAppRegistryEntry[] = [];
  for (const entry of legacy) {
    const context = developmentContext(next, entry.workspaceId, entry.installedAt);
    next = { ...next, projects: context.projects, runtimeInstances: context.runtimeInstances };
    let inspection: Awaited<ReturnType<typeof inspectRestrictedAppPackage>>;
    try {
      inspection = await inspectRestrictedAppPackage(join(registryRoot, "staged", entry.digest));
    } catch (error) {
      throw new Error(`Workspace could not migrate restricted app ${entry.manifest.id} because its reviewed staged artifact is unavailable: ${errorMessage(error)}`);
    }
    const mismatches = [
      inspection.digest !== entry.digest ? "digest" : undefined,
      inspection.packageName !== entry.packageName ? "package name" : undefined,
      inspection.packageVersion !== entry.version ? "version" : undefined,
      inspection.files.length !== entry.fileCount ? "file count" : undefined,
      inspection.totalBytes !== entry.totalBytes ? "byte count" : undefined,
      computeDeclarationDigest(inspection.manifest) !== computeDeclarationDigest(entry.manifest) ? "manifest" : undefined,
    ].filter((item): item is string => item !== undefined);
    if (mismatches.length > 0) {
      throw new Error(`Workspace could not migrate restricted app ${entry.manifest.id} because its staged artifact does not match the registry (${mismatches.join(", ")}).`);
    }
    installations.push({
      ...entry,
      projectId: context.project.projectId,
      runtimeInstanceId: context.runtimeInstance.runtimeInstanceId,
      featureInstallationId: createFeatureInstallationId(),
      dataNamespaceId: createDataNamespaceId(),
      authority: authorityForContext(next, context.runtimeInstance),
      artifactDigest: inspection.artifactDigest,
    });
  }
  return registryFileV3({
    ...next,
    installations,
    migrations: [{ fromVersion: 2, toVersion: 3, migratedAt }],
  });
}

type CommonRegistryEntry = Omit<RestrictedAppRegistryEntry,
  "projectId" | "runtimeInstanceId" | "featureInstallationId" | "dataNamespaceId" | "authority" | "artifactDigest">;

function registryEntry(value: unknown, index: number): RestrictedAppRegistryEntry {
  const item = objectValue(value, `Restricted app registry entry ${index + 1}`);
  exactObjectKeys(item, [
    "workspaceId", "projectId", "runtimeInstanceId", "featureInstallationId", "dataNamespaceId", "authority",
    "packageName", "version", "digest", "artifactDigest", "manifest", "networkGrants", "fileGrants",
    "notificationGrants", "automations", "automationRuns", "fileCount", "totalBytes", "installedAt", "updatedAt",
  ], "Restricted app registry entry");
  const common = commonRegistryEntry(value, index, "v3");
  return {
    ...common,
    projectId: parseProjectId(item.projectId),
    runtimeInstanceId: parseRuntimeInstanceId(item.runtimeInstanceId),
    featureInstallationId: parseFeatureInstallationId(item.featureInstallationId),
    dataNamespaceId: parseDataNamespaceId(item.dataNamespaceId),
    authority: parseAuthorityStamp(item.authority),
    artifactDigest: parseAppPlatformArtifactDigest(item.artifactDigest),
  };
}

function legacyRegistryEntry(value: unknown, index: number): CommonRegistryEntry {
  const item = objectValue(value, `Restricted app registry v2 entry ${index + 1}`);
  exactObjectKeys(item, [
    "workspaceId", "packageName", "version", "digest", "manifest", "networkGrants", "fileGrants",
    "notificationGrants", "automations", "automationRuns", "fileCount", "totalBytes", "installedAt", "updatedAt",
  ], "Restricted app registry v2 entry");
  return commonRegistryEntry(value, index, "v2");
}

function commonRegistryEntry(value: unknown, index: number, sourceVersion: "v2" | "v3"): CommonRegistryEntry {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`Restricted app registry entry ${index + 1} is invalid.`);
  const item = value as Partial<RestrictedAppRegistryEntry>;
  const manifest = parseRestrictedAppManifest(item.manifest);
  const workspaceId = nonempty(item.workspaceId, "Restricted app registry Space id", 200);
  const packageName = nonempty(item.packageName, "Restricted app registry package name", 214);
  const version = nonempty(item.version, "Restricted app registry version", 100);
  const digest = digestValue(item.digest);
  if (!Array.isArray(item.networkGrants)) throw new Error("Restricted app registry network grants are missing.");
  const networkGrants = item.networkGrants.map((grant) => nonempty(grant, "Restricted app network grant", 64));
  if (new Set(networkGrants).size !== networkGrants.length || networkGrants.some((grant) => !manifest.permissions.network.some((item) => item.id === grant))) {
    throw new Error("Restricted app registry has invalid network grants.");
  }
  if (!Array.isArray(item.fileGrants)) throw new Error("Restricted app registry file grants are missing.");
  const fileGrants = item.fileGrants.map((grant) => restrictedAppFileGrantValue(grant, manifest));
  if (new Set(fileGrants.map((grant) => grant.id)).size !== fileGrants.length) {
    throw new Error("Restricted app registry has invalid file grants.");
  }
  if (!Array.isArray(item.notificationGrants)) throw new Error("Restricted app registry notification grants are missing.");
  const notificationGrants = item.notificationGrants
    .map((grant) => nonempty(grant, "Restricted app notification grant", 64));
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
  const automationRuns = item.automationRuns.map((run) => automationRunReceiptValue(
    run,
    declarations,
    digest,
    sourceVersion,
  ));
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

function projectRegistryEntry(value: unknown, index: number): RestrictedAppProjectRegistryEntry {
  const item = objectValue(value, `Restricted app project ${index + 1}`);
  exactObjectKeys(item, ["workspaceId", "projectId", "createdAt"], "Restricted app project");
  return {
    workspaceId: nonempty(item.workspaceId, "Restricted app project Space id", 200),
    projectId: parseProjectId(item.projectId),
    createdAt: isoDate(item.createdAt, "Restricted app project creation time"),
  };
}

function runtimeInstanceRegistryEntry(value: unknown, index: number): RestrictedAppRuntimeInstanceRegistryEntry {
  const item = objectValue(value, `Restricted app Runtime Instance ${index + 1}`);
  exactObjectKeys(item, ["kind", "workspaceId", "projectId", "runtimeInstanceId", "runtimeInstanceGeneration", "createdAt", "updatedAt"], "Restricted app Runtime Instance");
  if (item.kind !== "development") throw new Error("Local restricted app Runtime Instance kind must be development.");
  return {
    kind: "development",
    workspaceId: nonempty(item.workspaceId, "Restricted app Runtime Instance Space id", 200),
    projectId: parseProjectId(item.projectId),
    runtimeInstanceId: parseRuntimeInstanceId(item.runtimeInstanceId),
    runtimeInstanceGeneration: parseAuthorityGeneration(item.runtimeInstanceGeneration, "Restricted app Runtime Instance generation"),
    createdAt: isoDate(item.createdAt, "Restricted app Runtime Instance creation time"),
    updatedAt: isoDate(item.updatedAt, "Restricted app Runtime Instance update time"),
  };
}

function registryMigrationEntry(value: unknown, index: number): RestrictedAppRegistryMigration {
  const item = objectValue(value, `Restricted app registry migration ${index + 1}`);
  exactObjectKeys(item, ["fromVersion", "toVersion", "migratedAt"], "Restricted app registry migration");
  if (item.fromVersion !== 2 || item.toVersion !== 3) throw new Error("Restricted app registry migration is unsupported.");
  return { fromVersion: 2, toVersion: 3, migratedAt: isoDate(item.migratedAt, "Restricted app registry migration time") };
}

function pendingCleanupEntry(value: unknown, index: number): RestrictedAppPendingCleanup {
  const item = objectValue(value, `Restricted app pending cleanup ${index + 1}`);
  exactObjectKeys(item, ["cleanupId", "connectionScope", "storageOwner", "packageDigest", "createdAt"], "Restricted app pending cleanup");
  const cleanupId = nonempty(item.cleanupId, "Restricted app cleanup id", 64);
  if (!/^cleanup_[0-9a-f-]{36}$/i.test(cleanupId)) throw new Error("Restricted app cleanup id is invalid.");

  let connectionScope: RestrictedAppConnectionFeatureScope | null = null;
  if (item.connectionScope !== null) {
    const scope = objectValue(item.connectionScope, "Restricted app cleanup connection scope");
    exactObjectKeys(scope, [
      "tenantId", "runtimeInstanceId", "featureId", "featureInstallationId", "featureRevisionDigest",
    ], "Restricted app cleanup connection scope");
    connectionScope = {
      tenantId: parseTenantId(scope.tenantId),
      runtimeInstanceId: parseRuntimeInstanceId(scope.runtimeInstanceId),
      featureId: appIdValue(scope.featureId),
      featureInstallationId: parseFeatureInstallationId(scope.featureInstallationId),
      featureRevisionDigest: parseAppPlatformArtifactDigest(scope.featureRevisionDigest),
    };
  }

  let storageOwner: RestrictedAppStorageOwner | null = null;
  if (item.storageOwner !== null) {
    const owner = objectValue(item.storageOwner, "Restricted app cleanup storage owner");
    exactObjectKeys(owner, [
      "ownerClass", "tenantId", "runtimeInstanceId", "featureInstallationId", "dataNamespaceId",
    ], "Restricted app cleanup storage owner");
    if (owner.ownerClass !== "instance") throw new Error("Restricted app cleanup storage owner class is invalid.");
    storageOwner = {
      ownerClass: "instance",
      tenantId: parseTenantId(owner.tenantId),
      runtimeInstanceId: parseRuntimeInstanceId(owner.runtimeInstanceId),
      featureInstallationId: parseFeatureInstallationId(owner.featureInstallationId),
      dataNamespaceId: parseDataNamespaceId(owner.dataNamespaceId),
    };
  }

  return {
    cleanupId,
    connectionScope,
    storageOwner,
    packageDigest: item.packageDigest === null ? null : digestValue(item.packageDigest),
    createdAt: isoDate(item.createdAt, "Restricted app cleanup creation time"),
  };
}

function developmentContext(
  registry: RestrictedAppRegistryFile,
  workspaceId: string,
  timestamp: string,
): {
  project: RestrictedAppProjectRegistryEntry;
  runtimeInstance: RestrictedAppRuntimeInstanceRegistryEntry;
  projects: RestrictedAppProjectRegistryEntry[];
  runtimeInstances: RestrictedAppRuntimeInstanceRegistryEntry[];
} {
  const project = registry.projects.find((item) => item.workspaceId === workspaceId) ?? {
    workspaceId,
    projectId: createProjectId(),
    createdAt: timestamp,
  };
  const existingRuntime = registry.runtimeInstances.find((item) => item.workspaceId === workspaceId);
  if (existingRuntime && existingRuntime.projectId !== project.projectId) {
    throw new Error("Restricted app Development Instance does not match its App Project.");
  }
  const runtimeInstance = existingRuntime ?? {
    kind: "development" as const,
    workspaceId,
    projectId: project.projectId,
    runtimeInstanceId: createRuntimeInstanceId(),
    runtimeInstanceGeneration: createAuthorityGeneration(),
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  return {
    project,
    runtimeInstance,
    projects: registry.projects.includes(project) ? registry.projects : [...registry.projects, project],
    runtimeInstances: registry.runtimeInstances.includes(runtimeInstance)
      ? registry.runtimeInstances
      : [...registry.runtimeInstances, runtimeInstance],
  };
}

function authorityForContext(
  registry: RestrictedAppRegistryFile,
  runtimeInstance: RestrictedAppRuntimeInstanceRegistryEntry,
): Readonly<AuthorityStamp> {
  return parseAuthorityStamp({
    ...createAuthorityStamp(),
    runtimeInstanceGeneration: runtimeInstance.runtimeInstanceGeneration,
    principalGeneration: registry.localIdentity.principalGeneration,
  });
}

function objectValue(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw new Error(`${label} must be a plain object.`);
  return value as Record<string, unknown>;
}

function arrayValue(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array.`);
  return value;
}

function exactObjectKeys(record: Record<string, unknown>, expected: readonly string[], label: string): void {
  const keys = Object.keys(record);
  const unsupported = keys.find((key) => !expected.includes(key));
  if (unsupported) throw new Error(`${label} contains unsupported field: ${unsupported}.`);
  const missing = expected.find((key) => !Object.prototype.hasOwnProperty.call(record, key));
  if (missing) throw new Error(`${label} is missing required field: ${missing}.`);
}

function assertUnique(values: readonly string[], message: string): void {
  if (new Set(values).size !== values.length) throw new Error(message);
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
    artifactDigest: inspection.artifactDigest,
    manifest: structuredClone(inspection.manifest),
    fileCount: inspection.files.length,
    totalBytes: inspection.totalBytes,
  };
}

function copyInstalled(
  item: RestrictedAppRegistryEntry,
  localIdentity: RestrictedAppRegistryFile["localIdentity"],
): RestrictedAppInstalled {
  return structuredClone({
    workspaceId: item.workspaceId,
    projectId: item.projectId,
    tenantId: localIdentity.tenantId,
    principalId: localIdentity.principalId,
    runtimeInstanceId: item.runtimeInstanceId,
    runtimeInstanceKind: "development" as const,
    featureInstallationId: item.featureInstallationId,
    dataNamespaceId: item.dataNamespaceId,
    authority: item.authority,
    packageName: item.packageName,
    version: item.version,
    digest: item.digest,
    artifactDigest: item.artifactDigest,
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

function connectionFeatureScope(
  item: Pick<RestrictedAppRegistryEntry, "runtimeInstanceId" | "featureInstallationId" | "artifactDigest" | "manifest">,
  localIdentity: RestrictedAppRegistryFile["localIdentity"],
): RestrictedAppConnectionFeatureScope {
  return {
    tenantId: localIdentity.tenantId,
    runtimeInstanceId: item.runtimeInstanceId,
    featureId: item.manifest.id,
    featureInstallationId: item.featureInstallationId,
    featureRevisionDigest: item.artifactDigest,
  };
}

function connectionBinding(
  item: Pick<RestrictedAppRegistryEntry, "runtimeInstanceId" | "featureInstallationId" | "artifactDigest" | "manifest">,
  localIdentity: RestrictedAppRegistryFile["localIdentity"],
  declaration: RestrictedAppManifest["permissions"]["network"][number],
): RestrictedAppConnectionBinding {
  return {
    ...connectionFeatureScope(item, localIdentity),
    declarationId: declaration.id,
    declarationDigest: computeDeclarationDigest(declaration),
    targetIdentity: restrictedAppNetworkOrigin(declaration),
    owner: { kind: "instance", runtimeInstanceId: item.runtimeInstanceId },
  };
}

function storageOwnerFromEntry(
  item: Pick<RestrictedAppRegistryEntry, "runtimeInstanceId" | "featureInstallationId" | "dataNamespaceId">,
  localIdentity: RestrictedAppRegistryFile["localIdentity"],
): RestrictedAppStorageOwner {
  return {
    ownerClass: "instance",
    tenantId: localIdentity.tenantId,
    runtimeInstanceId: item.runtimeInstanceId,
    featureInstallationId: item.featureInstallationId,
    dataNamespaceId: item.dataNamespaceId,
  };
}

function pendingCleanupForEntry(
  item: RestrictedAppRegistryEntry,
  localIdentity: RestrictedAppRegistryFile["localIdentity"],
  deleteStorage: boolean,
  createdAt: string,
): RestrictedAppPendingCleanup {
  return {
    cleanupId: `cleanup_${randomUUID()}`,
    connectionScope: connectionFeatureScope(item, localIdentity),
    storageOwner: deleteStorage ? storageOwnerFromEntry(item, localIdentity) : null,
    packageDigest: item.digest,
    createdAt,
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

function automationKey(
  app: Pick<RestrictedAppRegistryEntry, "runtimeInstanceId" | "featureInstallationId" | "digest">,
  automationId: string,
): {
  ownerId: string;
  jobId: string;
} {
  return {
    ownerId: JSON.stringify([app.runtimeInstanceId, app.featureInstallationId, app.digest]),
    jobId: automationId,
  };
}

function automationOwner(value: string): {
  runtimeInstanceId: RuntimeInstanceId;
  featureInstallationId: FeatureInstallationId;
  digest: string;
} {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("Automation owner id is invalid.");
  }
  if (!Array.isArray(parsed) || parsed.length !== 3) throw new Error("Automation owner id is invalid.");
  return {
    runtimeInstanceId: parseRuntimeInstanceId(parsed[0]),
    featureInstallationId: parseFeatureInstallationId(parsed[1]),
    digest: digestValue(parsed[2]),
  };
}

function acceptedAutomationContext(
  entry: RestrictedAppRegistryEntry,
  localIdentity: RestrictedAppRegistryFile["localIdentity"],
  result: WorkspaceAutomationRunResult,
): AcceptedAutomationContext {
  return {
    tenantId: localIdentity.tenantId,
    runtimeInstanceId: entry.runtimeInstanceId,
    featureInstallationId: entry.featureInstallationId,
    featureRevisionDigest: entry.artifactDigest,
    dataNamespaceId: entry.dataNamespaceId,
    effectivePrincipal: Object.freeze({
      principalId: result.reason === "manual" ? localIdentity.principalId : localIdentity.servicePrincipalId,
      kind: result.reason === "manual" ? "human" : "service",
      realm: "local",
    }),
    authority: parseAuthorityStamp(entry.authority),
    acceptedAt: result.scheduledAt,
    occurrenceId: `occurrence_${result.runId}`,
    attemptId: `attempt_${result.runId}`,
  };
}

function capturedAutomationRun(
  result: WorkspaceAutomationRunResult,
  accepted: AcceptedAutomationContext,
): RestrictedAppAutomationRunReceipt {
  const state = result.outcome === "success"
    ? "succeeded"
    : result.outcome === "failure"
      ? "failed"
      : result.outcome;
  return {
    receiptId: `receipt_${randomUUID()}`,
    verification: "captured",
    kind: "job",
    tenantId: accepted.tenantId,
    runtimeInstanceId: accepted.runtimeInstanceId,
    featureInstallationId: accepted.featureInstallationId,
    featureRevisionDigest: accepted.featureRevisionDigest,
    dataNamespaceId: accepted.dataNamespaceId,
    effectivePrincipal: accepted.effectivePrincipal,
    authority: parseAuthorityStamp(accepted.authority),
    acceptedAt: accepted.acceptedAt,
    state,
    occurrenceId: accepted.occurrenceId,
    attemptId: accepted.attemptId,
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

function acceptedAutomationRunReceiptValue(value: unknown): RestrictedAppAcceptedAutomationRegistryReceipt {
  const item = objectValue(value, "Restricted app accepted automation receipt");
  exactObjectKeys(item, [
    "receiptId", "verification", "kind", "state", "workspaceId", "appId", "packageDigest", "runId",
    "automationId", "reason", "scheduledAt", "tenantId", "runtimeInstanceId", "featureInstallationId",
    "featureRevisionDigest", "dataNamespaceId", "effectivePrincipal", "authority", "acceptedAt",
    "occurrenceId", "attemptId",
  ], "Restricted app accepted automation receipt");
  if (item.verification !== "captured" || item.kind !== "job" || item.state !== "accepted") {
    throw new Error("Restricted app accepted automation receipt state is invalid.");
  }
  if (item.reason !== "scheduled" && item.reason !== "manual" && item.reason !== "resume") {
    throw new Error("Restricted app accepted automation reason is invalid.");
  }
  const effectivePrincipal = effectivePrincipalValue(item.effectivePrincipal);
  const scheduledAt = isoDate(item.scheduledAt, "Restricted app accepted automation scheduled time");
  const acceptedAt = isoDate(item.acceptedAt, "Restricted app automation acceptance time");
  return {
    receiptId: nonempty(item.receiptId, "Restricted app automation receipt id", 200),
    verification: "captured",
    kind: "job",
    state: "accepted",
    workspaceId: nonempty(item.workspaceId, "Restricted app automation Space id", 200),
    appId: appIdValue(item.appId),
    packageDigest: digestValue(item.packageDigest),
    runId: nonempty(item.runId, "Restricted app automation run id", 200),
    automationId: appIdValue(item.automationId),
    reason: item.reason,
    scheduledAt,
    tenantId: parseTenantId(item.tenantId),
    runtimeInstanceId: parseRuntimeInstanceId(item.runtimeInstanceId),
    featureInstallationId: parseFeatureInstallationId(item.featureInstallationId),
    featureRevisionDigest: parseAppPlatformArtifactDigest(item.featureRevisionDigest),
    dataNamespaceId: parseDataNamespaceId(item.dataNamespaceId),
    effectivePrincipal,
    authority: parseAuthorityStamp(item.authority),
    acceptedAt,
    occurrenceId: nonempty(item.occurrenceId, "Restricted app automation occurrence id", 200),
    attemptId: nonempty(item.attemptId, "Restricted app automation attempt id", 200),
  };
}

function historicalAutomationRunReceiptValue(value: unknown): RestrictedAppHistoricalAutomationRegistryReceipt {
  const item = objectValue(value, "Restricted app historical automation receipt");
  const workspaceId = nonempty(item.workspaceId, "Restricted app automation Space id", 200);
  const appId = appIdValue(item.appId);
  const { workspaceId: _workspaceId, appId: _appId, ...terminal } = item;
  const parsed = automationRunReceiptValue(terminal, [], "", "v3");
  if (parsed.verification !== "captured") {
    throw new Error("Historical automation ledger accepts only captured receipts.");
  }
  return { ...parsed, workspaceId, appId };
}

function effectivePrincipalValue(value: unknown): EffectivePrincipal {
  const item = objectValue(value, "Restricted app automation effective Principal");
  exactObjectKeys(item, ["principalId", "kind", "realm"], "Restricted app automation effective Principal");
  if (item.kind !== "human" && item.kind !== "agent" && item.kind !== "service" && item.kind !== "system") {
    throw new Error("Restricted app automation effective Principal kind is invalid.");
  }
  if (item.realm !== "local" && item.realm !== "cloud") {
    throw new Error("Restricted app automation effective Principal realm is invalid.");
  }
  return Object.freeze({ principalId: parsePrincipalId(item.principalId), kind: item.kind, realm: item.realm });
}

function automationRunReceiptValue(
  value: unknown,
  declarations: RestrictedAppAutomationDeclaration[],
  expectedDigest: string,
  sourceVersion: "v2" | "v3",
): RestrictedAppAutomationRegistryReceipt {
  const item = objectValue(value, "Restricted app automation run receipt");
  const errorKeys = Object.prototype.hasOwnProperty.call(item, "error") ? ["error"] : [];
  if (sourceVersion === "v2") {
    exactObjectKeys(item, [
      "runId", "automationId", "reason", "scheduledAt", "startedAt", "finishedAt", "outcome", ...errorKeys, "digest",
    ], "Restricted app registry v2 automation run receipt");
  } else if (item.verification === "legacy-unverified") {
    exactObjectKeys(item, [
      "receiptId", "verification", "runId", "automationId", "reason", "scheduledAt", "startedAt", "finishedAt",
      "outcome", ...errorKeys, "packageDigest",
    ], "Legacy restricted app automation run receipt");
  } else {
    exactObjectKeys(item, [
      "receiptId", "verification", "kind", "tenantId", "runtimeInstanceId", "featureInstallationId",
      "featureRevisionDigest", "dataNamespaceId", "effectivePrincipal", "authority", "acceptedAt", "state",
      "occurrenceId", "attemptId", "runId", "automationId", "reason", "scheduledAt", "startedAt", "finishedAt",
      "outcome", ...errorKeys, "packageDigest",
    ], "Captured restricted app automation run receipt");
  }

  const runId = nonempty(item.runId, "Restricted app automation run id", 200);
  const automationId = appIdValue(item.automationId);
  const packageDigest = digestValue(sourceVersion === "v2" ? item.digest : item.packageDigest);
  if (expectedDigest && (!declarations.some((declaration) => declaration.id === automationId)
    || packageDigest !== expectedDigest)) {
    throw new Error("Restricted app automation run receipt does not match its reviewed revision.");
  }
  if (item.reason !== "scheduled" && item.reason !== "manual" && item.reason !== "resume") {
    throw new Error("Restricted app automation run reason is invalid.");
  }
  const reason: RestrictedAppAutomationRunReceipt["reason"] = item.reason;
  if (item.outcome !== "success" && item.outcome !== "failure" && item.outcome !== "skipped"
    && item.outcome !== "cancelled" && item.outcome !== "interrupted") {
    throw new Error("Restricted app automation run outcome is invalid.");
  }
  const outcome: RestrictedAppAutomationRunReceipt["outcome"] = item.outcome;
  const startedAt = isoDate(item.startedAt, "Restricted app automation start time");
  const finishedAt = isoDate(item.finishedAt, "Restricted app automation finish time");
  if (Date.parse(finishedAt) < Date.parse(startedAt)) throw new Error("Restricted app automation run times are invalid.");
  const error = item.error === undefined ? undefined : nonempty(item.error, "Restricted app automation run error", 300);
  if (item.outcome === "success" ? error !== undefined : error === undefined) {
    throw new Error("Restricted app automation run error does not match its outcome.");
  }

  const base = {
    receiptId: sourceVersion === "v2"
      ? `receipt_${randomUUID()}`
      : nonempty(item.receiptId, "Restricted app automation receipt id", 200),
    runId,
    automationId,
    reason,
    scheduledAt: isoDate(item.scheduledAt, "Restricted app automation scheduled time"),
    startedAt,
    finishedAt,
    outcome,
    ...(error ? { error } : {}),
    packageDigest,
  };
  if (sourceVersion === "v2" || item.verification === "legacy-unverified") {
    return { ...base, verification: "legacy-unverified" };
  }
  if (item.verification !== "captured" || item.kind !== "job") {
    throw new Error("Captured restricted app automation receipt identity is invalid.");
  }
  const effectivePrincipal = effectivePrincipalValue(item.effectivePrincipal);
  const expectedState = outcome === "success"
    ? "succeeded"
    : outcome === "failure"
      ? "failed"
      : outcome === "interrupted"
        ? "expired"
        : outcome;
  if (item.state !== expectedState) throw new Error("Restricted app automation receipt state does not match its outcome.");
  return {
    ...base,
    verification: "captured",
    kind: "job",
    tenantId: parseTenantId(item.tenantId),
    runtimeInstanceId: parseRuntimeInstanceId(item.runtimeInstanceId),
    featureInstallationId: parseFeatureInstallationId(item.featureInstallationId),
    featureRevisionDigest: parseAppPlatformArtifactDigest(item.featureRevisionDigest),
    dataNamespaceId: parseDataNamespaceId(item.dataNamespaceId),
    effectivePrincipal,
    authority: parseAuthorityStamp(item.authority),
    acceptedAt: isoDate(item.acceptedAt, "Restricted app automation acceptance time"),
    state: expectedState,
    occurrenceId: nonempty(item.occurrenceId, "Restricted app automation occurrence id", 200),
    attemptId: nonempty(item.attemptId, "Restricted app automation attempt id", 200),
  };
}
