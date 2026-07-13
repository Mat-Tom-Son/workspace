import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
import { RoutedRestrictedAppProposalHost } from "../src/local/agent/restricted-app-proposals.js";
import type { RestrictedAppOAuthPkceClient } from "../src/local/agent/restricted-app-oauth.js";
import { FileRestrictedAppStorage } from "../src/local/agent/restricted-app-storage.js";
import { startLocalApi } from "../src/local/server.js";

test("restricted app API keeps review, install, grants, connections, invocation, and removal separate", async () => {
  const sandbox = await mkdtemp(join(tmpdir(), "workspace-restricted-api-"));
  const runtime = new RuntimeHost();
  const connections = new Connections();
  const storage = new FileRestrictedAppStorage(join(sandbox, "state", "restricted-apps", "data"));
  const oauth = new FakeOAuth();
  const service = await RestrictedAppService.create({
    rootPath: join(sandbox, "state", "restricted-apps"),
    runtimeHost: runtime,
    connections,
    storage,
    oauth: oauth as unknown as RestrictedAppOAuthPkceClient,
  });
  const api = await startLocalApi({
    port: 0,
    stateBase: join(sandbox, "state"),
    workspaceBase: join(sandbox, "spaces"),
    loadEnv: false,
    restrictedAppService: service,
  });
  try {
    const created = await request<{ workspace: { id: string; rootPath: string } }>(api.origin, "/api/workspaces", {
      method: "POST",
      body: { name: "Restricted apps" },
    });
    const workspace = created.workspace;
    const sourcePath = "tools/mail-app";
    await writePackage(join(workspace.rootPath, ...sourcePath.split("/")));
    await mkdir(join(workspace.rootPath, "reports"), { recursive: true });

    const invalid = await fetch(`${api.origin}/api/workspaces/${workspace.id}/restricted-apps/inspect`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sourcePath: join(workspace.rootPath, "tools", "mail-app") }),
    });
    assert.equal(invalid.status, 400);

    const inspected = await request<{ review: { digest: string; manifest: { id: string } } }>(
      api.origin,
      `/api/workspaces/${workspace.id}/restricted-apps/inspect`,
      { method: "POST", body: { sourcePath } },
    );
    assert.equal(inspected.review.manifest.id, "mail-app");

    const installed = await request<{ app: { digest: string; networkGrants: string[]; fileGrants: unknown[]; notificationGrants: string[]; backgroundEnabled: boolean } }>(
      api.origin,
      `/api/workspaces/${workspace.id}/restricted-apps`,
      { method: "POST", body: { sourcePath, expectedDigest: inspected.review.digest } },
    );
    assert.equal(installed.app.digest, inspected.review.digest);
    assert.deepEqual(installed.app.networkGrants, []);
    assert.deepEqual(installed.app.fileGrants, []);
    assert.deepEqual(installed.app.notificationGrants, []);
    assert.equal(installed.app.backgroundEnabled, false);

    const granted = await request<{ app: { networkGrants: string[] } }>(
      api.origin,
      `/api/workspaces/${workspace.id}/restricted-apps/mail-app/permissions/network/mail-api`,
      { method: "PUT", body: { expectedDigest: inspected.review.digest } },
    );
    assert.deepEqual(granted.app.networkGrants, ["mail-api"]);

    const fileGranted = await request<{ app: { fileGrants: Array<{ declarationId: string; root: string; access: string }> } }>(
      api.origin,
      `/api/workspaces/${workspace.id}/restricted-apps/mail-app/permissions/files/exports`,
      { method: "PUT", body: { expectedDigest: inspected.review.digest, root: "reports" } },
    );
    assert.deepEqual(fileGranted.app.fileGrants, [{ id: "exports", declarationId: "exports", root: "reports", access: "read-write" }]);

    const notificationsGranted = await request<{ app: { notificationGrants: string[] } }>(
      api.origin,
      `/api/workspaces/${workspace.id}/restricted-apps/mail-app/permissions/notifications/new-mail`,
      { method: "PUT", body: { expectedDigest: inspected.review.digest } },
    );
    assert.deepEqual(notificationsGranted.app.notificationGrants, ["new-mail"]);
    const notificationsRevoked = await request<{ app: { notificationGrants: string[] } }>(
      api.origin,
      `/api/workspaces/${workspace.id}/restricted-apps/mail-app/permissions/notifications/new-mail`,
      { method: "DELETE", body: { expectedDigest: inspected.review.digest } },
    );
    assert.deepEqual(notificationsRevoked.app.notificationGrants, []);

    const background = await request<{ app: { backgroundEnabled: boolean } }>(
      api.origin,
      `/api/workspaces/${workspace.id}/restricted-apps/mail-app/background`,
      { method: "PUT", body: { expectedDigest: inspected.review.digest } },
    );
    assert.equal(background.app.backgroundEnabled, true);
    const backgroundRun = await request<{ app: { backgroundLastRunAt?: string } }>(
      api.origin,
      `/api/workspaces/${workspace.id}/restricted-apps/mail-app/background/run`,
      { method: "POST", body: { expectedDigest: inspected.review.digest } },
    );
    assert.ok(backgroundRun.app.backgroundLastRunAt);
    assert.equal(runtime.backgroundRuns.length, 1);

    await storage.set({ workspaceId: workspace.id, appId: "mail-app" }, "view", { folder: "inbox" });
    const usage = await request<{ usage: { keyCount: number } }>(
      api.origin,
      `/api/workspaces/${workspace.id}/restricted-apps/mail-app/storage?expectedDigest=${inspected.review.digest}`,
    );
    assert.equal(usage.usage.keyCount, 1);
    const cleared = await request<{ usage: { keyCount: number } }>(
      api.origin,
      `/api/workspaces/${workspace.id}/restricted-apps/mail-app/storage`,
      { method: "DELETE", body: { expectedDigest: inspected.review.digest } },
    );
    assert.equal(cleared.usage.keyCount, 0);

    const oauthStatus = await request<{ connection: { destinationId: string; kind: string; configured: boolean } }>(
      api.origin,
      `/api/workspaces/${workspace.id}/restricted-apps/mail-app/connections/mail-api/oauth`,
      { method: "POST", body: { expectedDigest: inspected.review.digest } },
    );
    assert.deepEqual(oauthStatus.connection, { destinationId: "mail-api", kind: "oauth2-pkce", configured: true });
    assert.equal(oauth.connectCount, 1);
    assert.equal(oauth.configuration?.issuer, "https://identity.example.com");

    await request(
      api.origin,
      `/api/workspaces/${workspace.id}/restricted-apps/mail-app/connections/mail-api`,
      {
        method: "PUT",
        body: {
          expectedDigest: inspected.review.digest,
          credential: { kind: "api-key", value: "secret" },
        },
      },
    );
    const statuses = await request<{ connections: Array<{ destinationId: string; kind: string; configured: boolean }> }>(
      api.origin,
      `/api/workspaces/${workspace.id}/restricted-apps/mail-app/connections?expectedDigest=${inspected.review.digest}`,
    );
    assert.deepEqual(statuses.connections, [{ destinationId: "mail-api", kind: "api-key", configured: true }]);

    const invoked = await request<{ result: unknown }>(
      api.origin,
      `/api/workspaces/${workspace.id}/restricted-apps/mail-app/invoke`,
      { method: "POST", body: { expectedDigest: inspected.review.digest, action: "search", input: { query: "invoice" } } },
    );
    assert.deepEqual(invoked.result, { count: 3 });
    assert.deepEqual(runtime.invocations[0]?.app.networkGrants, ["mail-api"]);

    const revoked = await request<{ app: { networkGrants: string[] } }>(
      api.origin,
      `/api/workspaces/${workspace.id}/restricted-apps/mail-app/permissions/network/mail-api`,
      { method: "DELETE", body: { expectedDigest: inspected.review.digest } },
    );
    assert.deepEqual(revoked.app.networkGrants, []);

    const filesRevoked = await request<{ app: { fileGrants: unknown[] } }>(
      api.origin,
      `/api/workspaces/${workspace.id}/restricted-apps/mail-app/permissions/files/exports`,
      { method: "DELETE", body: { expectedDigest: inspected.review.digest } },
    );
    assert.deepEqual(filesRevoked.app.fileGrants, []);

    const removed = await request<{ removed: boolean }>(
      api.origin,
      `/api/workspaces/${workspace.id}/restricted-apps/mail-app`,
      { method: "DELETE", body: { expectedDigest: inspected.review.digest } },
    );
    assert.equal(removed.removed, true);
    assert.deepEqual((await request<{ apps: unknown[] }>(api.origin, `/api/workspaces/${workspace.id}/restricted-apps`)).apps, []);
  } finally {
    await api.close();
    await rm(sandbox, { recursive: true, force: true });
  }
});

test("restricted app proposals are host-inspected, owning-Chat bound, persisted, and digest-pinned", async () => {
  const sandbox = await mkdtemp(join(tmpdir(), "workspace-restricted-proposal-api-"));
  const stateRoot = join(sandbox, "state", "restricted-apps");
  const service = await RestrictedAppService.create({ rootPath: stateRoot });
  const proposals = await RoutedRestrictedAppProposalHost.create({ service, registryPath: join(stateRoot, "proposals.json") });
  const api = await startLocalApi({
    port: 0,
    stateBase: join(sandbox, "state"),
    workspaceBase: join(sandbox, "spaces"),
    loadEnv: false,
    restrictedAppService: service,
    restrictedAppProposalHost: proposals,
  });
  try {
    const { workspace } = await request<{ workspace: { id: string; rootPath: string } }>(api.origin, "/api/workspaces", { method: "POST", body: { name: "Proposed apps" } });
    const first = await request<{ conversation: { id: string } }>(api.origin, `/api/workspaces/${workspace.id}/conversations`, { method: "POST" });
    const second = await request<{ conversation: { id: string } }>(api.origin, `/api/workspaces/${workspace.id}/conversations`, { method: "POST" });
    await writePackage(join(workspace.rootPath, "tools", "mail-app"));

    const result = await proposals.propose({
      workspaceId: workspace.id,
      workspaceRoot: workspace.rootPath,
      conversationId: first.conversation.id,
      sourcePath: "tools/mail-app",
    });
    assert.equal(result.status, "pending");
    const proposalId = result.proposal!.id;

    const owned = await request<{ proposals: Array<{ id: string; sourcePath: string; workspaceRoot?: string; status: string }> }>(
      api.origin,
      `/api/workspaces/${workspace.id}/conversations/${first.conversation.id}/restricted-app-proposals`,
    );
    assert.deepEqual(owned.proposals.map(({ id, sourcePath, status }) => ({ id, sourcePath, status })), [{ id: proposalId, sourcePath: "tools/mail-app", status: "pending" }]);
    assert.equal("workspaceRoot" in owned.proposals[0]!, false, "machine paths stay outside renderer proposal payloads");
    assert.deepEqual((await request<{ proposals: unknown[] }>(api.origin, `/api/workspaces/${workspace.id}/conversations/${second.conversation.id}/restricted-app-proposals`)).proposals, []);

    const wrongChat = await fetch(`${api.origin}/api/workspaces/${workspace.id}/conversations/${second.conversation.id}/restricted-app-proposals/${proposalId}/install`, { method: "POST" });
    assert.equal(wrongChat.status, 404);

    const installed = await request<{ app: { digest: string; networkGrants: string[] }; proposal: { status: string } }>(
      api.origin,
      `/api/workspaces/${workspace.id}/conversations/${first.conversation.id}/restricted-app-proposals/${proposalId}/install`,
      { method: "POST" },
    );
    assert.equal(installed.app.digest, result.proposal!.review.digest);
    assert.deepEqual(installed.app.networkGrants, []);
    assert.equal(installed.proposal.status, "installed");

    const dismissedResult = await proposals.propose({ workspaceId: workspace.id, workspaceRoot: workspace.rootPath, conversationId: first.conversation.id, sourcePath: "tools/mail-app" });
    const dismissed = await request<{ dismissed: boolean }>(
      api.origin,
      `/api/workspaces/${workspace.id}/conversations/${first.conversation.id}/restricted-app-proposals/${dismissedResult.proposal!.id}`,
      { method: "DELETE" },
    );
    assert.equal(dismissed.dismissed, true);
    assert.equal((await proposals.get(dismissedResult.proposal!.id))?.status, "dismissed");
  } finally {
    await api.close();
    await rm(sandbox, { recursive: true, force: true });
  }
});

async function request<T = unknown>(
  origin: string,
  path: string,
  options: { method?: string; body?: unknown } = {},
): Promise<T> {
  const response = await fetch(`${origin}${path}`, {
    method: options.method ?? "GET",
    ...(options.body !== undefined ? {
      headers: { "content-type": "application/json" },
      body: JSON.stringify(options.body),
    } : {}),
  });
  const value = await response.json() as T & { error?: string };
  assert.equal(response.ok, true, value.error);
  return value;
}

async function writePackage(root: string): Promise<void> {
  await mkdir(root, { recursive: true });
  await Promise.all([
    writeFile(join(root, "package.json"), JSON.stringify({
      name: "mail-app",
      version: "0.1.0",
      private: true,
      type: "module",
      agentApp: "agent-app.json",
    }), "utf8"),
    writeFile(join(root, "agent-app.json"), JSON.stringify({
      version: 1,
      id: "mail-app",
      title: "Mail",
      runtime: { kind: "sandboxed-web", entry: "index.html", worker: "worker.js" },
      ui: { icon: "mail" },
      tools: [{
        name: "search",
        description: "Search mail",
        action: "search",
        inputSchema: {
          type: "object",
          properties: { query: { type: "string", minLength: 1, maxLength: 100 } },
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
          auth: [
            { kind: "api-key", header: "x-api-key" },
            { kind: "oauth2-pkce", issuer: "https://identity.example.com", clientId: "workspace-mail", scopes: ["mail.read"] },
          ],
        }],
      },
    }), "utf8"),
    writeFile(join(root, "index.html"), "<!doctype html><script type=module src=app.js></script>", "utf8"),
    writeFile(join(root, "app.js"), "export {};\n", "utf8"),
    writeFile(join(root, "worker.js"), "export async function handleAction() { return { count: 3 }; }\nexport async function handleBackground() {}\n", "utf8"),
  ]);
}

class RuntimeHost implements RestrictedAppRuntimeHost {
  readonly invocations: Array<{ app: RestrictedAppRuntimeDescriptor; action: string; input: unknown }> = [];
  readonly backgroundRuns: Array<{ app: RestrictedAppRuntimeDescriptor; event: { reason: "scheduled" | "manual" | "resume"; scheduledAt: string } }> = [];
  async invoke(app: RestrictedAppRuntimeDescriptor, action: string, input: unknown): Promise<unknown> {
    this.invocations.push({ app: structuredClone(app), action, input: structuredClone(input) });
    return { count: 3 };
  }
  async runBackground(app: RestrictedAppRuntimeDescriptor, event: { reason: "scheduled" | "manual" | "resume"; scheduledAt: string }): Promise<void> {
    this.backgroundRuns.push({ app: structuredClone(app), event: structuredClone(event) });
  }
  async stop(): Promise<void> {}
  async close(): Promise<void> {}
}

class FakeOAuth {
  connectCount = 0;
  configuration?: { issuer: string; clientId: string; scopes: string[] };
  async connect(_binding: unknown, configuration: { issuer: string; clientId: string; scopes: string[] }): Promise<{ kind: "oauth2-pkce"; connectedAt: string; expiresAt: string }> {
    this.connectCount += 1;
    this.configuration = structuredClone(configuration);
    return { kind: "oauth2-pkce", connectedAt: "2026-07-13T12:00:00.000Z", expiresAt: "2026-07-13T13:00:00.000Z" };
  }
}

class Connections implements RestrictedAppConnectionStore {
  readonly records = new Map<string, RestrictedAppCredential>();
  async get(binding: RestrictedAppConnectionBinding): Promise<RestrictedAppCredential | undefined> {
    return structuredClone(this.records.get(key(binding)));
  }
  async set(binding: RestrictedAppConnectionBinding, credential: RestrictedAppCredential): Promise<void> {
    this.records.set(key(binding), structuredClone(credential));
  }
  async delete(binding: RestrictedAppConnectionBinding): Promise<boolean> {
    return this.records.delete(key(binding));
  }
  async deleteApp(owner: RestrictedAppConnectionOwner): Promise<void> {
    for (const item of [...this.records.keys()]) if (item.startsWith(JSON.stringify([owner.workspaceId, owner.appId, owner.digest]).slice(0, -1))) this.records.delete(item);
  }
}

function key(binding: RestrictedAppConnectionBinding): string {
  return JSON.stringify([binding.workspaceId, binding.appId, binding.digest, binding.destinationId, binding.origin]);
}
