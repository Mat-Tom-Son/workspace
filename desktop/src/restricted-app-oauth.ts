import type { RestrictedAppConnectionStore } from "../../src/local/agent/restricted-app-connections.js";
import { RestrictedAppNetworkBroker } from "../../src/local/agent/restricted-app-connections.js";
import type { RestrictedAppManifest } from "../../src/local/agent/restricted-app-manifest.js";
import {
  RestrictedAppOAuthError,
  RestrictedAppOAuthPkceClient,
  type RestrictedAppOAuthBinding,
  type RestrictedAppOAuthConnection,
  type RestrictedAppOAuthJsonResponse,
  type RestrictedAppOAuthPublicHttpsTransport,
} from "../../src/local/agent/restricted-app-oauth.js";

const oauthDigest = "0".repeat(64);

export function createRestrictedAppOAuthClient(
  connections: RestrictedAppConnectionStore,
  openExternal: (url: string) => Promise<void>,
): RestrictedAppOAuthPkceClient {
  const store = {
    encrypted: true as const,
    async get(binding: RestrictedAppOAuthBinding): Promise<RestrictedAppOAuthConnection | undefined> {
      const credential = await connections.get(binding);
      return credential?.kind === "oauth2-pkce" ? credential : undefined;
    },
    async set(binding: RestrictedAppOAuthBinding, connection: RestrictedAppOAuthConnection): Promise<void> {
      await connections.set(binding, connection);
    },
    async delete(binding: RestrictedAppOAuthBinding): Promise<boolean> {
      return await connections.delete(binding);
    },
  };
  return new RestrictedAppOAuthPkceClient({
    store,
    transport: createOAuthTransport(),
    openExternal,
  });
}

function createOAuthTransport(): RestrictedAppOAuthPublicHttpsTransport {
  const credentials: RestrictedAppConnectionStore = {
    async get() { return undefined; },
    async set() { throw new Error("OAuth transport cannot save destination credentials."); },
    async delete() { return false; },
    async deleteApp() {},
  };
  const broker = new RestrictedAppNetworkBroker({
    credentials,
    maxRedirects: 0,
    maxRequestBytes: 128 * 1024,
    maxResponseBytes: 512 * 1024,
  });
  const execute = async (
    url: URL,
    method: "GET" | "POST",
    body: string | undefined,
    options: { signal: AbortSignal; maxResponseBytes: number },
  ): Promise<RestrictedAppOAuthJsonResponse> => {
    const destinationId = "oauth-provider";
    const manifest: RestrictedAppManifest = {
      version: 1,
      id: "oauth-host",
      title: "OAuth host",
      runtime: { kind: "sandboxed-web", entry: "index.html" },
      ui: {},
      tools: [],
      permissions: {
        network: [{
          id: destinationId,
          target: { kind: "public-https", origin: url.origin },
          methods: [method],
          auth: [{ kind: "none" }],
        }],
        files: [],
        notifications: [],
      },
    };
    const response = await broker.request({
      workspaceId: "oauth-host",
      appId: manifest.id,
      digest: oauthDigest,
      networkGrants: [destinationId],
    }, manifest, {
      destinationId,
      method,
      path: `${url.pathname}${url.search}`,
      headers: method === "POST" ? { accept: "application/json", "content-type": "application/x-www-form-urlencoded" } : { accept: "application/json" },
      ...(body !== undefined ? { body } : {}),
    }, options.signal);
    if (response.encoding !== "utf8" || Buffer.byteLength(response.body, "utf8") > options.maxResponseBytes) {
      throw new RestrictedAppOAuthError("NETWORK_FAILED", "The OAuth provider response exceeded its safe JSON limit.");
    }
    let parsed: unknown;
    try { parsed = JSON.parse(response.body); } catch { throw new RestrictedAppOAuthError("NETWORK_FAILED", "The OAuth provider returned invalid JSON."); }
    return { status: response.status, body: parsed };
  };
  return {
    getJson: (url, options) => execute(url, "GET", undefined, options),
    postForm: (url, form, options) => execute(url, "POST", form.toString(), options),
  };
}
