import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { parseAppPlatformArtifactDigest } from "../src/local/agent/app-platform-artifact.js";
import {
  computeDeclarationDigest,
  parseFeatureInstallationId,
  parseRuntimeInstanceId,
  parseTenantId,
} from "../src/local/agent/app-platform-contract.js";
import type { RestrictedAppEffectAuthorizer } from "../src/local/agent/restricted-app-connections.js";

import {
  RestrictedAppOAuthError,
  RestrictedAppOAuthPkceClient,
  type RestrictedAppOAuthBinding,
  type RestrictedAppOAuthConnection,
  type RestrictedAppOAuthEncryptedConnectionStore,
  type RestrictedAppOAuthJsonResponse,
  type RestrictedAppOAuthPkceConfiguration,
  type RestrictedAppOAuthPublicHttpsTransport,
} from "../src/local/agent/restricted-app-oauth.js";

const binding: RestrictedAppOAuthBinding = {
  tenantId: parseTenantId("tenant_one"),
  runtimeInstanceId: parseRuntimeInstanceId("runtime-instance_one"),
  featureId: "mail-app",
  featureInstallationId: parseFeatureInstallationId("feature-installation_one"),
  featureRevisionDigest: parseAppPlatformArtifactDigest(`workspace-artifact-v1:sha256:${"a".repeat(64)}`),
  declarationId: "mail-api",
  declarationDigest: computeDeclarationDigest({ id: "mail-api" }),
  targetIdentity: "https://api.example.com",
  owner: { kind: "instance", runtimeInstanceId: parseRuntimeInstanceId("runtime-instance_one") },
};

const configuration: RestrictedAppOAuthPkceConfiguration = {
  issuer: "https://auth.example.com",
  clientId: "workspace-public-client",
  scopes: ["mail.read", "profile.read"],
};

function metadata(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    issuer: configuration.issuer,
    authorization_endpoint: "https://auth.example.com/authorize",
    token_endpoint: "https://auth.example.com/token",
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    authorization_response_iss_parameter_supported: true,
    ...overrides,
  };
}

function deferred(): { promise: Promise<void>; resolve(): void } {
  let resolve!: () => void;
  const promise = new Promise<void>((settle) => { resolve = settle; });
  return { promise, resolve };
}

async function completeAuthorization(value: string): Promise<void> {
  const authorization = new URL(value);
  const callback = new URL(authorization.searchParams.get("redirect_uri")!);
  callback.searchParams.set("code", "authorization-code");
  callback.searchParams.set("state", authorization.searchParams.get("state")!);
  callback.searchParams.set("iss", configuration.issuer);
  const response = await fetch(callback);
  assert.equal(response.status, 200);
}

class MemoryEncryptedStore implements RestrictedAppOAuthEncryptedConnectionStore {
  readonly encrypted = true as const;
  readonly sets: RestrictedAppOAuthConnection[] = [];
  connection?: RestrictedAppOAuthConnection;
  beforeSetCommit?: () => void | Promise<void>;
  beforeDeleteCommit?: () => void | Promise<void>;

  async get(): Promise<RestrictedAppOAuthConnection | undefined> {
    return this.connection ? structuredClone(this.connection) : undefined;
  }

  async set(
    _binding: RestrictedAppOAuthBinding,
    connection: RestrictedAppOAuthConnection,
    authorizeCommit?: RestrictedAppEffectAuthorizer,
  ): Promise<void> {
    await this.beforeSetCommit?.();
    await authorizeCommit?.();
    this.connection = structuredClone(connection);
    this.sets.push(structuredClone(connection));
  }

  async delete(_binding: RestrictedAppOAuthBinding, authorizeCommit?: RestrictedAppEffectAuthorizer): Promise<boolean> {
    await this.beforeDeleteCommit?.();
    await authorizeCommit?.();
    const removed = this.connection !== undefined;
    this.connection = undefined;
    return removed;
  }
}

interface TransportCall {
  method: "GET" | "POST";
  url: string;
  form?: URLSearchParams;
  maxResponseBytes: number;
}

class ScriptedTransport implements RestrictedAppOAuthPublicHttpsTransport {
  readonly calls: TransportCall[] = [];
  getResponses: RestrictedAppOAuthJsonResponse[] = [{ status: 200, body: metadata() }];
  postResponses: RestrictedAppOAuthJsonResponse[] = [];
  beforeGetEffect?: () => void | Promise<void>;
  beforePostEffect?: () => void | Promise<void>;

  async getJson(
    url: URL,
    options: { signal: AbortSignal; maxResponseBytes: number; authorizeEffect?: RestrictedAppEffectAuthorizer },
  ): Promise<RestrictedAppOAuthJsonResponse> {
    assert.equal(options.signal.aborted, false);
    await this.beforeGetEffect?.();
    await options.authorizeEffect?.();
    this.calls.push({ method: "GET", url: url.href, maxResponseBytes: options.maxResponseBytes });
    const response = this.getResponses.shift();
    if (!response) throw new Error("No scripted GET response.");
    return structuredClone(response);
  }

  async postForm(
    url: URL,
    form: URLSearchParams,
    options: { signal: AbortSignal; maxResponseBytes: number; authorizeEffect?: RestrictedAppEffectAuthorizer },
  ): Promise<RestrictedAppOAuthJsonResponse> {
    assert.equal(options.signal.aborted, false);
    await this.beforePostEffect?.();
    await options.authorizeEffect?.();
    this.calls.push({ method: "POST", url: url.href, form: new URLSearchParams(form), maxResponseBytes: options.maxResponseBytes });
    const response = this.postResponses.shift();
    if (!response) throw new Error("No scripted POST response.");
    return structuredClone(response);
  }
}

test("OAuth PKCE discovers metadata, uses a one-shot loopback callback, and stores tokens without returning secrets", async () => {
  const store = new MemoryEncryptedStore();
  const transport = new ScriptedTransport();
  transport.postResponses.push({
    status: 200,
    body: {
      access_token: "access-secret",
      refresh_token: "refresh-secret",
      token_type: "bearer",
      expires_in: 3_600,
      scope: "mail.read profile.read",
    },
  });
  let authorizationUrl: URL | undefined;
  let callbackResponse: Response | undefined;
  const client = new RestrictedAppOAuthPkceClient({
    store,
    transport,
    now: () => new Date("2026-07-13T12:00:00.000Z"),
    openExternal: async (value) => {
      authorizationUrl = new URL(value);
      const redirect = authorizationUrl.searchParams.get("redirect_uri")!;
      const callback = new URL(redirect);
      assert.equal(callback.protocol, "http:");
      assert.equal(callback.hostname, "127.0.0.1");
      assert.notEqual(callback.port, "");
      assert.match(callback.pathname, /^\/oauth\/callback\/[A-Za-z0-9_-]{32}$/);
      callback.searchParams.set("code", "authorization-code");
      callback.searchParams.set("state", authorizationUrl.searchParams.get("state")!);
      callback.searchParams.set("iss", configuration.issuer);
      callbackResponse = await fetch(callback);
    },
  });

  const status = await client.connect(binding, configuration);

  assert.deepEqual(status, {
    kind: "oauth2-pkce",
    configured: true,
    scopes: configuration.scopes,
    expiresAt: "2026-07-13T13:00:00.000Z",
  });
  assert.equal("accessToken" in status, false);
  assert.equal("refreshToken" in status, false);
  assert.equal(callbackResponse?.status, 200);
  assert.doesNotMatch(await callbackResponse!.text(), /authorization-code|access-secret|refresh-secret/);

  assert.ok(authorizationUrl);
  assert.equal(authorizationUrl.origin, "https://auth.example.com");
  assert.equal(authorizationUrl.pathname, "/authorize");
  assert.equal(authorizationUrl.searchParams.get("response_type"), "code");
  assert.equal(authorizationUrl.searchParams.get("client_id"), configuration.clientId);
  assert.equal(authorizationUrl.searchParams.get("scope"), configuration.scopes.join(" "));
  assert.equal(authorizationUrl.searchParams.get("code_challenge_method"), "S256");
  const verifier = transport.calls[1]?.form?.get("code_verifier");
  assert.match(verifier ?? "", /^[A-Za-z0-9_-]{43}$/);
  assert.equal(
    authorizationUrl.searchParams.get("code_challenge"),
    createHash("sha256").update(verifier!, "ascii").digest("base64url"),
  );
  assert.deepEqual(transport.calls.map((call) => [call.method, call.url]), [
    ["GET", "https://auth.example.com/.well-known/oauth-authorization-server"],
    ["POST", "https://auth.example.com/token"],
  ]);
  const tokenForm = transport.calls[1]?.form;
  assert.deepEqual(Object.fromEntries(tokenForm!), {
    grant_type: "authorization_code",
    code: "authorization-code",
    client_id: configuration.clientId,
    redirect_uri: authorizationUrl.searchParams.get("redirect_uri")!,
    code_verifier: verifier!,
  });
  assert.equal("client_secret" in Object.fromEntries(tokenForm!), false);
  assert.equal(store.connection?.accessToken, "access-secret");
  assert.equal(store.connection?.refreshToken, "refresh-secret");
});

test("OAuth discovery performs no provider effect when authority is revoked during transport preparation", async () => {
  const store = new MemoryEncryptedStore();
  const transport = new ScriptedTransport();
  const paused = deferred();
  const release = deferred();
  let revoked = false;
  transport.beforeGetEffect = async () => {
    paused.resolve();
    await release.promise;
  };
  const client = new RestrictedAppOAuthPkceClient({
    store,
    transport,
    openExternal: async () => assert.fail("Revoked discovery must not open a browser."),
  });

  const operation = client.connect(binding, configuration, undefined, () => {
    if (revoked) throw new Error("authority revoked");
  });
  await paused.promise;
  revoked = true;
  release.resolve();

  await assert.rejects(operation, /authority revoked/);
  assert.equal(transport.calls.length, 0);
  assert.equal(store.sets.length, 0);
});

test("OAuth token exchange performs no provider effect when authority is revoked after callback", async () => {
  const store = new MemoryEncryptedStore();
  const transport = new ScriptedTransport();
  transport.postResponses.push({
    status: 200,
    body: { access_token: "must-not-be-observed", token_type: "Bearer" },
  });
  const paused = deferred();
  const release = deferred();
  let revoked = false;
  transport.beforePostEffect = async () => {
    paused.resolve();
    await release.promise;
  };
  const client = new RestrictedAppOAuthPkceClient({
    store,
    transport,
    openExternal: completeAuthorization,
  });

  const operation = client.connect(binding, configuration, undefined, () => {
    if (revoked) throw new Error("authority revoked");
  });
  await paused.promise;
  revoked = true;
  release.resolve();

  await assert.rejects(operation, /authority revoked/);
  assert.equal(transport.calls.filter((call) => call.method === "POST").length, 0);
  assert.equal(store.sets.length, 0);
});

test("OAuth token persistence performs no encrypted-store mutation when authority is revoked at commit", async () => {
  const store = new MemoryEncryptedStore();
  const transport = new ScriptedTransport();
  transport.postResponses.push({
    status: 200,
    body: { access_token: "must-not-persist", token_type: "Bearer" },
  });
  const paused = deferred();
  const release = deferred();
  let revoked = false;
  store.beforeSetCommit = async () => {
    paused.resolve();
    await release.promise;
  };
  const client = new RestrictedAppOAuthPkceClient({
    store,
    transport,
    openExternal: completeAuthorization,
  });

  const operation = client.connect(binding, configuration, undefined, () => {
    if (revoked) throw new Error("authority revoked");
  });
  await paused.promise;
  revoked = true;
  release.resolve();

  await assert.rejects(operation, /authority revoked/);
  assert.equal(transport.calls.filter((call) => call.method === "POST").length, 1);
  assert.equal(store.connection, undefined);
  assert.equal(store.sets.length, 0);
});

test("OAuth PKCE rejects untrusted provider metadata before opening a browser", async (t) => {
  const cases: Array<[string, Record<string, unknown>]> = [
    ["issuer mismatch", { issuer: "https://attacker.example.net" }],
    ["missing S256", { code_challenge_methods_supported: ["plain"] }],
    ["secret-only token endpoint", { token_endpoint_auth_methods_supported: ["client_secret_basic"] }],
    ["non-public token endpoint", { token_endpoint: "https://127.0.0.1/token" }],
    ["missing code response", { response_types_supported: ["token"] }],
  ];
  for (const [name, override] of cases) {
    await t.test(name, async () => {
      const transport = new ScriptedTransport();
      transport.getResponses = [{ status: 200, body: metadata(override) }];
      let opened = false;
      const client = new RestrictedAppOAuthPkceClient({
        store: new MemoryEncryptedStore(),
        transport,
        openExternal: async () => { opened = true; },
      });
      await assert.rejects(client.connect(binding, configuration), (error) => (
        error instanceof RestrictedAppOAuthError
          && (error.code === "PROVIDER_UNSUPPORTED" || error.code === "CONFIG_INVALID")
      ));
      assert.equal(opened, false);
      assert.equal(transport.calls.some((call) => call.method === "POST"), false);
    });
  }
});

test("OAuth PKCE consumes an exact callback once and rejects a mismatched state without exchanging a code", async () => {
  const transport = new ScriptedTransport();
  let callbackStatus = 0;
  const client = new RestrictedAppOAuthPkceClient({
    store: new MemoryEncryptedStore(),
    transport,
    openExternal: async (value) => {
      const authorization = new URL(value);
      const callback = new URL(authorization.searchParams.get("redirect_uri")!);
      callback.searchParams.set("code", "must-not-be-exchanged");
      callback.searchParams.set("state", "wrong-state");
      callback.searchParams.set("iss", configuration.issuer);
      callbackStatus = (await fetch(callback)).status;
    },
  });
  await assert.rejects(client.connect(binding, configuration), isOAuthError("AUTH_DENIED"));
  assert.equal(callbackStatus, 400);
  assert.equal(transport.calls.some((call) => call.method === "POST"), false);
});

test("OAuth PKCE callback wait is bounded and closes when authorization is abandoned", async () => {
  const transport = new ScriptedTransport();
  const client = new RestrictedAppOAuthPkceClient({
    store: new MemoryEncryptedStore(),
    transport,
    flowTimeoutMs: 25,
    networkTimeoutMs: 25,
    openExternal: async () => undefined,
  });
  await assert.rejects(client.connect(binding, configuration), isOAuthError("AUTH_CANCELLED"));
});

test("OAuth response objects are bounded even when an injected transport violates its contract", async () => {
  const transport = new ScriptedTransport();
  transport.getResponses = [{ status: 200, body: { padding: "x".repeat(70_000) } }];
  const client = new RestrictedAppOAuthPkceClient({
    store: new MemoryEncryptedStore(),
    transport,
    maxResponseBytes: 64 * 1024,
    openExternal: async () => assert.fail("Browser must not open for an oversized metadata response."),
  });
  await assert.rejects(client.connect(binding, configuration), isOAuthError("NETWORK_FAILED"));
  assert.equal(transport.calls[0]?.maxResponseBytes, 64 * 1024);
});

test("OAuth authorization serializes refresh, rotates the refresh token, and persists before injecting it", async () => {
  const store = new MemoryEncryptedStore();
  store.connection = {
    kind: "oauth2-pkce",
    issuer: configuration.issuer,
    clientId: configuration.clientId,
    requestedScopes: configuration.scopes,
    grantedScopes: configuration.scopes,
    tokenType: "Bearer",
    accessToken: "expiring-access",
    refreshToken: "old-refresh",
    expiresAt: "2026-07-13T12:00:30.000Z",
    connectedAt: "2026-07-12T12:00:00.000Z",
  };
  const transport = new ScriptedTransport();
  transport.getResponses.push({ status: 200, body: metadata() });
  transport.postResponses.push({
    status: 200,
    body: {
      access_token: "fresh-access",
      refresh_token: "new-refresh",
      token_type: "Bearer",
      expires_in: 3_600,
    },
  });
  const client = new RestrictedAppOAuthPkceClient({
    store,
    transport,
    now: () => new Date("2026-07-13T12:00:00.000Z"),
    openExternal: async () => assert.fail("Refresh must not open a browser."),
  });
  const one = new Headers({ authorization: "app-supplied-value" });
  const two = new Headers();

  await Promise.all([
    client.authorize(binding, configuration, one),
    client.authorize(binding, configuration, two),
  ]);

  assert.equal(one.get("authorization"), "Bearer fresh-access");
  assert.equal(two.get("authorization"), "Bearer fresh-access");
  assert.equal(transport.calls.filter((call) => call.method === "POST").length, 1);
  assert.deepEqual(Object.fromEntries(transport.calls.find((call) => call.method === "POST")!.form!), {
    grant_type: "refresh_token",
    refresh_token: "old-refresh",
    client_id: configuration.clientId,
  });
  assert.equal(store.connection?.refreshToken, "new-refresh");
  assert.equal(store.connection?.accessToken, "fresh-access");
  assert.equal(store.sets.length, 1);
});

test("OAuth authorization requires a new browser flow when an expiring connection has no refresh token", async () => {
  const store = new MemoryEncryptedStore();
  store.connection = {
    kind: "oauth2-pkce",
    issuer: configuration.issuer,
    clientId: configuration.clientId,
    requestedScopes: configuration.scopes,
    grantedScopes: configuration.scopes,
    tokenType: "Bearer",
    accessToken: "expiring-access",
    expiresAt: "2026-07-13T12:00:30.000Z",
    connectedAt: "2026-07-12T12:00:00.000Z",
  };
  const transport = new ScriptedTransport();
  const client = new RestrictedAppOAuthPkceClient({
    store,
    transport,
    now: () => new Date("2026-07-13T12:00:00.000Z"),
    openExternal: async () => undefined,
  });
  await assert.rejects(client.authorize(binding, configuration, new Headers()), isOAuthError("AUTH_REQUIRED"));
  assert.equal(transport.calls.length, 0);
});

test("OAuth disconnect invalidates an in-flight refresh before it can recreate the connection", async () => {
  const store = new MemoryEncryptedStore();
  store.connection = {
    kind: "oauth2-pkce",
    issuer: configuration.issuer,
    clientId: configuration.clientId,
    requestedScopes: configuration.scopes,
    grantedScopes: configuration.scopes,
    tokenType: "Bearer",
    accessToken: "expiring-access",
    refreshToken: "old-refresh",
    expiresAt: "2026-07-13T12:00:30.000Z",
    connectedAt: "2026-07-12T12:00:00.000Z",
  };
  let refreshStarted!: () => void;
  let releaseRefresh!: () => void;
  const started = new Promise<void>((resolve) => { refreshStarted = resolve; });
  const release = new Promise<void>((resolve) => { releaseRefresh = resolve; });
  let providerEffects = 0;
  const transport: RestrictedAppOAuthPublicHttpsTransport = {
    async getJson(_url, options) {
      await options.authorizeEffect?.();
      return { status: 200, body: metadata() };
    },
    async postForm(_url, _form, options) {
      refreshStarted();
      await release;
      await options.authorizeEffect?.();
      providerEffects += 1;
      return { status: 200, body: { access_token: "resurrected-access", token_type: "Bearer", expires_in: 3_600 } };
    },
  };
  const client = new RestrictedAppOAuthPkceClient({
    store,
    transport,
    now: () => new Date("2026-07-13T12:00:00.000Z"),
    openExternal: async () => assert.fail("Refresh must not open a browser."),
  });

  const authorization = client.authorize(binding, configuration, new Headers());
  await started;
  assert.equal(await client.disconnect(binding), true);
  releaseRefresh();
  await assert.rejects(authorization, isOAuthError("AUTH_REQUIRED"));
  assert.equal(store.connection, undefined);
  assert.equal(store.sets.length, 0);
  assert.equal(providerEffects, 0);
});

test("OAuth generation is rechecked at the encrypted-store commit after disconnect", async () => {
  const store = new MemoryEncryptedStore();
  store.connection = {
    kind: "oauth2-pkce",
    issuer: configuration.issuer,
    clientId: configuration.clientId,
    requestedScopes: configuration.scopes,
    grantedScopes: configuration.scopes,
    tokenType: "Bearer",
    accessToken: "expiring-access",
    refreshToken: "old-refresh",
    expiresAt: "2026-07-13T12:00:30.000Z",
    connectedAt: "2026-07-12T12:00:00.000Z",
  };
  const transport = new ScriptedTransport();
  transport.getResponses.push({ status: 200, body: metadata() });
  transport.postResponses.push({
    status: 200,
    body: { access_token: "must-not-persist", token_type: "Bearer", expires_in: 3_600 },
  });
  const commitReached = deferred();
  const releaseCommit = deferred();
  store.beforeSetCommit = async () => {
    commitReached.resolve();
    await releaseCommit.promise;
  };
  const client = new RestrictedAppOAuthPkceClient({
    store,
    transport,
    now: () => new Date("2026-07-13T12:00:00.000Z"),
    openExternal: async () => assert.fail("Refresh must not open a browser."),
  });

  const authorization = client.authorize(binding, configuration, new Headers());
  await commitReached.promise;
  assert.equal(await client.disconnect(binding), true);
  releaseCommit.resolve();

  await assert.rejects(authorization, isOAuthError("AUTH_REQUIRED"));
  assert.equal(store.connection, undefined);
  assert.equal(store.sets.length, 0);
});

test("OAuth configuration rejects secrets, arbitrary endpoints, and local issuers", async () => {
  const client = new RestrictedAppOAuthPkceClient({
    store: new MemoryEncryptedStore(),
    transport: new ScriptedTransport(),
    openExternal: async () => undefined,
  });
  await assert.rejects(client.connect(binding, {
    ...configuration,
    clientSecret: "must-not-be-accepted",
  } as RestrictedAppOAuthPkceConfiguration), isOAuthError("CONFIG_INVALID"));
  await assert.rejects(client.connect(binding, {
    ...configuration,
    tokenEndpoint: "https://attacker.example.net/token",
  } as RestrictedAppOAuthPkceConfiguration), isOAuthError("CONFIG_INVALID"));
  await assert.rejects(client.connect(binding, {
    ...configuration,
    issuer: "http://127.0.0.1:4567",
  }), isOAuthError("CONFIG_INVALID"));
  await assert.rejects(client.connect(binding, {
    ...configuration,
    scopes: ["openid", "mail.read"],
  }), isOAuthError("CONFIG_INVALID"));
});

function isOAuthError(code: RestrictedAppOAuthError["code"]): (error: unknown) => boolean {
  return (error) => error instanceof RestrictedAppOAuthError && error.code === code;
}
