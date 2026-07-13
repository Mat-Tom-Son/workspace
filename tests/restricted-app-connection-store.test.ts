import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

import {
  EncryptedRestrictedAppConnectionStore,
  type RestrictedAppSecretEncryption,
} from "../src/local/agent/restricted-app-connection-store.js";
import type { RestrictedAppConnectionBinding } from "../src/local/agent/restricted-app-connections.js";

class TestEncryption implements RestrictedAppSecretEncryption {
  available = true;

  isAvailable(): boolean {
    return this.available;
  }

  encrypt(plaintext: string): Uint8Array {
    return Buffer.from(plaintext, "utf8").map((value) => value ^ 0xa5);
  }

  decrypt(ciphertext: Uint8Array): string {
    return Buffer.from(Buffer.from(ciphertext).map((value) => value ^ 0xa5)).toString("utf8");
  }
}

const digest = "b".repeat(64);

function binding(overrides: Partial<RestrictedAppConnectionBinding> = {}): RestrictedAppConnectionBinding {
  return {
    workspaceId: "space-one",
    appId: "mail-app",
    digest,
    destinationId: "mail-api",
    origin: "https://mail.example.com",
    ...overrides,
  };
}

async function temporaryStore(t: test.TestContext): Promise<{
  file: string;
  encryption: TestEncryption;
  store: EncryptedRestrictedAppConnectionStore;
}> {
  const root = await mkdtemp(join(tmpdir(), "workspace-connections-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const file = join(root, "restricted-app-connections.bin");
  const encryption = new TestEncryption();
  return { file, encryption, store: new EncryptedRestrictedAppConnectionStore(file, encryption) };
}

test("encrypted connection store persists without exposing plaintext credentials", async (t) => {
  const { file, encryption, store } = await temporaryStore(t);
  await store.set(binding(), { kind: "bearer", token: "durable-secret-token" });

  const ciphertext = await readFile(file);
  assert.equal(ciphertext.includes(Buffer.from("durable-secret-token")), false);

  const reopened = new EncryptedRestrictedAppConnectionStore(file, encryption);
  assert.deepEqual(await reopened.get(binding()), { kind: "bearer", token: "durable-secret-token" });
});

test("encrypted connection store binds secrets to Space, app, digest, destination, and origin", async (t) => {
  const { store } = await temporaryStore(t);
  await store.set(binding(), { kind: "api-key", value: "bound-secret" });

  assert.deepEqual(await store.get(binding()), { kind: "api-key", value: "bound-secret" });
  for (const mismatch of [
    binding({ workspaceId: "space-two" }),
    binding({ appId: "other-app" }),
    binding({ digest: "c".repeat(64) }),
    binding({ destinationId: "calendar-api" }),
    binding({ origin: "https://other.example.com" }),
  ]) {
    assert.equal(await store.get(mismatch), undefined);
  }
});

test("encrypted connection store serializes writes and durably revokes exact and app bindings", async (t) => {
  const { file, encryption, store } = await temporaryStore(t);
  await Promise.all([
    store.set(binding(), { kind: "bearer", token: "first" }),
    store.set(binding({ destinationId: "calendar-api", origin: "https://calendar.example.com" }), { kind: "basic", username: "user", password: "second" }),
  ]);

  assert.equal(await store.delete(binding()), true);
  assert.equal(await store.delete(binding()), false);
  let reopened = new EncryptedRestrictedAppConnectionStore(file, encryption);
  assert.equal(await reopened.get(binding()), undefined);
  assert.deepEqual(
    await reopened.get(binding({ destinationId: "calendar-api", origin: "https://calendar.example.com" })),
    { kind: "basic", username: "user", password: "second" },
  );

  await reopened.deleteApp({ workspaceId: "space-one", appId: "mail-app", digest });
  reopened = new EncryptedRestrictedAppConnectionStore(file, encryption);
  assert.equal(await reopened.get(binding({ destinationId: "calendar-api", origin: "https://calendar.example.com" })), undefined);
});

test("encrypted connection store fails closed on corruption and never falls back to a backup", async (t) => {
  const { file, encryption, store } = await temporaryStore(t);
  await store.set(binding(), { kind: "bearer", token: "revoked-secret" });
  const staleCiphertext = await readFile(file);
  await store.delete(binding());
  await writeFile(`${file}.bak`, staleCiphertext);
  await writeFile(file, Buffer.from("corrupt primary"));

  const reopened = new EncryptedRestrictedAppConnectionStore(file, encryption);
  await assert.rejects(reopened.get(binding()), /could not read restricted app connections/i);
  assert.deepEqual((await readdir(join(file, ".."))).filter((name) => name.endsWith(".bak")), ["restricted-app-connections.bin.bak"]);
});

test("encrypted connection store refuses credential writes when encryption is unavailable", async (t) => {
  const { encryption, store } = await temporaryStore(t);
  encryption.available = false;
  await assert.rejects(
    store.set(binding(), { kind: "bearer", token: "must-not-write" }),
    /secure storage is unavailable/i,
  );
});
