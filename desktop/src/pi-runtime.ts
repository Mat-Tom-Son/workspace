import {
  VERSION as PI_SDK_VERSION,
  type ProgressEvent,
} from "@earendil-works/pi-coding-agent";

import {
  createPersistentPiAuthStorage,
  type PersistentPiAuthStorage,
  type PiAuthStorageHost,
} from "../../src/local/agent/auth-storage.js";
import type { PiExtensionUiBridge } from "../../src/local/agent/extension-ui.js";
import { importPiSkillBundle, type PiSkillBundleImportResult } from "../../src/local/agent/skill-import.js";
import {
  getPiSetupStatus,
  installPiPackage,
  listPiModels,
  listPiPackages,
  loginPiOAuth,
  removePiPackage,
  removePiProviderAuth,
  savePiApiKey,
  setPiDefaultModel,
  setPiProjectTrust,
  updatePiPackages,
  type PiConfiguredPackage,
  type PiModelSummary,
  type PiOAuthHooks,
  type PiPackageMutationOptions,
  type PiPreferredModel,
  type PiProjectTrustPolicy,
  type PiRuntimeConfig,
  type PiRuntimeProvider,
  type PiSetupStatus,
} from "../../src/local/agent/pi-runtime-config.js";

export interface PackagedPiRuntimeOptions {
  /** Pi config, packages, models, and session root outside user workspaces. */
  agentDir: string;
  /** Optional Electron-safeStorage implementation; native auth.json is the fallback. */
  authStorageHost?: PiAuthStorageHost;
  /** Shared HTTP/SSE or IPC bridge used by all extension sessions. */
  extensionUi?: PiExtensionUiBridge;
  preferredModel?: PiPreferredModel;
  projectTrust?: PiProjectTrustPolicy;
  additionalExtensionPaths?: string[];
  additionalSkillPaths?: string[];
  additionalPromptTemplatePaths?: string[];
  additionalThemePaths?: string[];
}

export interface PackagedPiRuntimeHealth {
  ok: boolean;
  configured: boolean;
  version: string;
  message?: string;
}

/** Native, provider-neutral Pi host used by the Electron main process. */
export class PackagedPiRuntimeProvider implements PiRuntimeProvider {
  private authStoragePromise: Promise<PersistentPiAuthStorage> | null = null;

  constructor(private readonly options: PackagedPiRuntimeOptions) {}

  async resolveRuntime(): Promise<PiRuntimeConfig> {
    const auth = await this.authStorage();
    return {
      agentDir: this.options.agentDir,
      authStorage: auth.authStorage,
      flushAuthStorage: () => auth.flush(),
      ...(this.options.extensionUi ? { extensionUi: this.options.extensionUi } : {}),
      ...(this.options.preferredModel ? { preferredModel: this.options.preferredModel } : {}),
      ...(this.options.projectTrust ? { projectTrust: this.options.projectTrust } : {}),
      ...(this.options.additionalExtensionPaths ? { additionalExtensionPaths: this.options.additionalExtensionPaths } : {}),
      ...(this.options.additionalSkillPaths ? { additionalSkillPaths: this.options.additionalSkillPaths } : {}),
      ...(this.options.additionalPromptTemplatePaths ? { additionalPromptTemplatePaths: this.options.additionalPromptTemplatePaths } : {}),
      ...(this.options.additionalThemePaths ? { additionalThemePaths: this.options.additionalThemePaths } : {}),
      metadata: {
        piVersion: PI_SDK_VERSION,
        nodeVersion: process.version,
        ...(this.options.preferredModel ? {
          provider: this.options.preferredModel.provider,
          model: this.options.preferredModel.id,
        } : {}),
      },
    };
  }

  async health(workspaceRoot = process.cwd()): Promise<PackagedPiRuntimeHealth> {
    try {
      const status = await this.getSetupStatus(workspaceRoot);
      return {
        ok: status.error === null,
        configured: status.configured,
        version: status.piVersion,
        ...(status.error ? { message: status.error } : {}),
      };
    } catch (error) {
      return {
        ok: false,
        configured: false,
        version: PI_SDK_VERSION,
        message: errorMessage(error),
      };
    }
  }

  getSetupStatus(workspaceRoot: string): Promise<PiSetupStatus> {
    return getPiSetupStatus(workspaceRoot, this);
  }

  listModels(workspaceRoot: string): Promise<PiModelSummary[]> {
    return listPiModels(workspaceRoot, this);
  }

  async saveApiKey(
    workspaceRoot: string,
    provider: string,
    apiKey: string,
    env?: Record<string, string>,
  ): Promise<void> {
    await savePiApiKey(workspaceRoot, provider, apiKey, { env, runtimeProvider: this });
  }

  removeAuth(workspaceRoot: string, provider: string): Promise<void> {
    return removePiProviderAuth(workspaceRoot, provider, this);
  }

  loginOAuth(workspaceRoot: string, provider: string, hooks: PiOAuthHooks): Promise<void> {
    return loginPiOAuth(workspaceRoot, provider, hooks, this);
  }

  setDefaultModel(workspaceRoot: string, model: PiPreferredModel): Promise<void> {
    return setPiDefaultModel(workspaceRoot, model, this);
  }

  setProjectTrust(workspaceRoot: string, decision: boolean | null): Promise<void> {
    return setPiProjectTrust(workspaceRoot, decision, this);
  }

  listPackages(workspaceRoot: string): Promise<PiConfiguredPackage[]> {
    return listPiPackages(workspaceRoot, this);
  }

  installPackage(
    workspaceRoot: string,
    source: string,
    options: Omit<PiPackageMutationOptions, "runtimeProvider"> = {},
  ): Promise<void> {
    return installPiPackage(workspaceRoot, source, { ...options, runtimeProvider: this });
  }

  removePackage(
    workspaceRoot: string,
    source: string,
    options: Omit<PiPackageMutationOptions, "runtimeProvider"> = {},
  ): Promise<boolean> {
    return removePiPackage(workspaceRoot, source, { ...options, runtimeProvider: this });
  }

  updatePackages(
    workspaceRoot: string,
    source?: string,
    options: { onProgress?: (event: ProgressEvent) => void } = {},
  ): Promise<void> {
    return updatePiPackages(workspaceRoot, source, { ...options, runtimeProvider: this });
  }

  importSkillBundle(
    workspaceRoot: string,
    input: { fileName: string; bytes: Uint8Array; scope?: "user" | "project" },
  ): Promise<PiSkillBundleImportResult> {
    return importPiSkillBundle(workspaceRoot, input, this);
  }

  async flush(): Promise<void> {
    if (this.authStoragePromise) await (await this.authStoragePromise).flush();
  }

  getExtensionUiBridge(): PiExtensionUiBridge | undefined {
    return this.options.extensionUi;
  }

  private authStorage(): Promise<PersistentPiAuthStorage> {
    this.authStoragePromise ??= createPersistentPiAuthStorage({
      agentDir: this.options.agentDir,
      ...(this.options.authStorageHost ? { host: this.options.authStorageHost } : {}),
    });
    return this.authStoragePromise;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
