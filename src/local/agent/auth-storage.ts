import { join } from "node:path";

import {
  AuthStorage,
  type AuthStorageBackend,
  type AuthCredential,
} from "@earendil-works/pi-coding-agent";

export type PiAuthStorageData = Record<string, AuthCredential>;

/**
 * Host-owned persistence for Pi credentials.
 *
 * Electron can implement this with safeStorage, while a CLI or test host can
 * use Pi's normal auth.json file. Credential values never pass through the
 * catalog or setup-status APIs.
 */
export interface PiAuthStorageHost {
  load(): Promise<PiAuthStorageData | undefined>;
  save(data: PiAuthStorageData): Promise<void>;
}

export interface PersistentPiAuthStorage {
  authStorage: AuthStorage;
  /** Wait until host-backed credential writes are durable. */
  flush(): Promise<void>;
}

/**
 * Creates Pi AuthStorage using either a host-provided secure store or Pi's
 * native persistent auth.json implementation.
 */
export async function createPersistentPiAuthStorage(options: {
  agentDir: string;
  host?: PiAuthStorageHost;
}): Promise<PersistentPiAuthStorage> {
  if (!options.host) {
    return {
      authStorage: AuthStorage.create(join(options.agentDir, "auth.json")),
      flush: async () => undefined,
    };
  }

  const backend = await HostAuthStorageBackend.create(options.host);
  return {
    authStorage: AuthStorage.fromStorage(backend),
    flush: () => backend.flush(),
  };
}

/**
 * AuthStorage expects synchronous locked mutations. This adapter keeps the
 * authoritative value in memory and serializes encrypted host writes behind
 * it. Call flush() after a setup mutation or before shutdown.
 */
export class HostAuthStorageBackend implements AuthStorageBackend {
  private serialized: string | undefined;
  private persistQueue: Promise<void> = Promise.resolve();
  private persistError: unknown;
  private asyncLockQueue: Promise<void> = Promise.resolve();
  private asyncLockActive = false;

  private constructor(
    private readonly host: PiAuthStorageHost,
    initial: PiAuthStorageData | undefined,
  ) {
    this.serialized = initial && Object.keys(initial).length > 0
      ? JSON.stringify(initial)
      : undefined;
  }

  static async create(host: PiAuthStorageHost): Promise<HostAuthStorageBackend> {
    return new HostAuthStorageBackend(host, await host.load());
  }

  withLock<T>(fn: (current: string | undefined) => { result: T; next?: string }): T {
    if (this.asyncLockActive) {
      throw new Error("Pi credential storage is busy refreshing authentication. Try again in a moment.");
    }
    const update = fn(this.serialized);
    if (update.next !== undefined && update.next !== this.serialized) {
      this.serialized = update.next;
      this.enqueuePersist(update.next);
    }
    return update.result;
  }

  async withLockAsync<T>(
    fn: (current: string | undefined) => Promise<{ result: T; next?: string }>,
  ): Promise<T> {
    const previous = this.asyncLockQueue;
    let release!: () => void;
    this.asyncLockQueue = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    this.asyncLockActive = true;
    try {
      const update = await fn(this.serialized);
      if (update.next !== undefined && update.next !== this.serialized) {
        this.serialized = update.next;
        this.enqueuePersist(update.next);
      }
      return update.result;
    } finally {
      this.asyncLockActive = false;
      release();
    }
  }

  async flush(): Promise<void> {
    await this.persistQueue;
    if (this.persistError) {
      const error = this.persistError;
      this.persistError = undefined;
      throw error;
    }
  }

  private enqueuePersist(serialized: string): void {
    this.persistQueue = this.persistQueue
      .catch(() => undefined)
      .then(async () => {
        try {
          const parsed = JSON.parse(serialized) as PiAuthStorageData;
          await this.host.save(parsed);
        } catch (error) {
          this.persistError = error;
        }
      });
  }
}
