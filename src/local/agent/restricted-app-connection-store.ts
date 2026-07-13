import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { lstat, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import {
  normalizeRestrictedAppCredential,
  type RestrictedAppConnectionBinding,
  type RestrictedAppConnectionOwner,
  type RestrictedAppConnectionStore,
  type RestrictedAppCredential,
} from "./restricted-app-connections.js";

export interface RestrictedAppSecretEncryption {
  isAvailable(): boolean;
  encrypt(plaintext: string): Uint8Array;
  decrypt(ciphertext: Uint8Array): string;
}

interface ConnectionFile {
  schemaVersion: 1;
  records: ConnectionRecord[];
}

interface ConnectionRecord extends RestrictedAppConnectionBinding {
  credential: RestrictedAppCredential;
  updatedAt: string;
}

export class EncryptedRestrictedAppConnectionStore implements RestrictedAppConnectionStore {
  #queue: Promise<void> = Promise.resolve();

  constructor(
    private readonly filePath: string,
    private readonly encryption: RestrictedAppSecretEncryption,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async get(binding: RestrictedAppConnectionBinding): Promise<RestrictedAppCredential | undefined> {
    const normalized = normalizeBinding(binding);
    const record = (await this.#read()).records.find((item) => bindingKey(item) === bindingKey(normalized));
    return record ? structuredClone(record.credential) : undefined;
  }

  async set(binding: RestrictedAppConnectionBinding, credential: RestrictedAppCredential): Promise<void> {
    const normalized = normalizeBinding(binding);
    const safeCredential = normalizeRestrictedAppCredential(credential);
    await this.#update((data) => {
      data.records = data.records.filter((item) => bindingKey(item) !== bindingKey(normalized));
      data.records.push({ ...normalized, credential: safeCredential, updatedAt: this.now().toISOString() });
    });
  }

  async delete(binding: RestrictedAppConnectionBinding): Promise<boolean> {
    const normalized = normalizeBinding(binding);
    let removed = false;
    await this.#update((data) => {
      const next = data.records.filter((item) => bindingKey(item) !== bindingKey(normalized));
      removed = next.length !== data.records.length;
      data.records = next;
    });
    return removed;
  }

  async deleteApp(owner: RestrictedAppConnectionOwner): Promise<void> {
    const normalized = normalizeOwner(owner);
    await this.#update((data) => {
      data.records = data.records.filter((item) => item.workspaceId !== normalized.workspaceId
        || item.appId !== normalized.appId || item.digest !== normalized.digest);
    });
  }

  async #update(mutator: (data: ConnectionFile) => void): Promise<void> {
    let operationError: unknown;
    const operation = this.#queue.catch(() => undefined).then(async () => {
      try {
        const data = await this.#read();
        mutator(data);
        data.records.sort((left, right) => bindingKey(left).localeCompare(bindingKey(right)));
        await this.#write(data);
      } catch (error) {
        operationError = error;
      }
    });
    this.#queue = operation;
    await operation;
    if (operationError) throw operationError;
  }

  async #read(): Promise<ConnectionFile> {
    if (!existsSync(this.filePath)) return { schemaVersion: 1, records: [] };
    this.#assertEncryption();
    const info = await lstat(this.filePath);
    if (info.isSymbolicLink() || !info.isFile() || info.size > 2 * 1024 * 1024) throw new Error("Restricted app connection store is unsafe or too large.");
    try {
      const source = this.encryption.decrypt(await readFile(this.filePath));
      const value = JSON.parse(source) as unknown;
      if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Connection store is not an object.");
      const record = value as { schemaVersion?: unknown; records?: unknown };
      if (record.schemaVersion !== 1 || !Array.isArray(record.records)) throw new Error("Connection store version is unsupported.");
      const records = record.records.map((item) => normalizeRecord(item));
      const keys = records.map(bindingKey);
      if (new Set(keys).size !== keys.length) throw new Error("Connection store contains duplicate bindings.");
      return { schemaVersion: 1, records };
    } catch (error) {
      throw new Error(`Workspace could not read restricted app connections: ${errorMessage(error)}`);
    }
  }

  async #write(data: ConnectionFile): Promise<void> {
    this.#assertEncryption();
    if (existsSync(this.filePath)) {
      const info = await lstat(this.filePath);
      if (info.isSymbolicLink() || !info.isFile()) throw new Error("Restricted app connection store is not a regular file.");
    }
    await mkdir(dirname(this.filePath), { recursive: true });
    const temporary = `${this.filePath}.${randomUUID()}.tmp`;
    const ciphertext = this.encryption.encrypt(JSON.stringify(data));
    if (ciphertext.byteLength > 2 * 1024 * 1024) throw new Error("Restricted app connection store exceeds the size limit.");
    await writeFile(temporary, ciphertext, { flag: "wx" });
    try {
      await rename(temporary, this.filePath);
    } catch (error) {
      await rm(temporary, { force: true });
      throw error;
    }
  }

  #assertEncryption(): void {
    if (!this.encryption.isAvailable()) throw new Error("Operating-system secure storage is unavailable for restricted app connections.");
  }
}

function normalizeRecord(value: unknown): ConnectionRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Connection record is invalid.");
  const record = value as Partial<ConnectionRecord>;
  const binding = normalizeBinding(record as RestrictedAppConnectionBinding);
  const credential = normalizeRestrictedAppCredential(record.credential);
  if (typeof record.updatedAt !== "string" || Number.isNaN(Date.parse(record.updatedAt))) throw new Error("Connection update time is invalid.");
  return { ...binding, credential, updatedAt: record.updatedAt };
}

function normalizeBinding(value: RestrictedAppConnectionBinding): RestrictedAppConnectionBinding {
  const owner = normalizeOwner(value);
  const destinationId = identifier(value.destinationId, "destination id");
  let origin: URL;
  try {
    origin = new URL(value.origin);
  } catch {
    throw new Error("Restricted app connection origin is invalid.");
  }
  if (origin.protocol !== "https:" || origin.origin !== value.origin || origin.pathname !== "/" || origin.username || origin.password || origin.search || origin.hash) {
    throw new Error("Restricted app connection origin must be an exact HTTPS origin.");
  }
  return { ...owner, destinationId, origin: origin.origin };
}

function normalizeOwner(value: RestrictedAppConnectionOwner): RestrictedAppConnectionOwner {
  const workspaceId = identifier(value.workspaceId, "Space id", 200);
  const appId = identifier(value.appId, "app id");
  if (typeof value.digest !== "string" || !/^[0-9a-f]{64}$/.test(value.digest)) throw new Error("Restricted app connection digest is invalid.");
  return { workspaceId, appId, digest: value.digest };
}

function identifier(value: unknown, label: string, maximum = 64): string {
  if (typeof value !== "string" || !value || value.length > maximum || !/^[A-Za-z0-9._-]+$/.test(value)) {
    throw new Error(`Restricted app connection ${label} is invalid.`);
  }
  return value;
}

function bindingKey(value: RestrictedAppConnectionBinding): string {
  return JSON.stringify([value.workspaceId, value.appId, value.digest, value.destinationId, value.origin]);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error ?? "unknown error");
}
