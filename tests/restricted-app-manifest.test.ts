import assert from "node:assert/strict";
import test from "node:test";

import { parseRestrictedAppManifest } from "../src/local/agent/restricted-app-manifest.js";

function manifest(overrides: Record<string, unknown> = {}) {
  return {
    version: 1,
    id: "connected-inbox",
    title: "Connected inbox",
    runtime: { kind: "sandboxed-web", entry: "index.html", worker: "worker.js" },
    ui: { icon: "mail" },
    tools: [{
      name: "inbox_search",
      description: "Search the connected inbox.",
      action: "search",
      inputSchema: {
        type: "object",
        properties: { query: { type: "string", maxLength: 500 } },
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
    permissions: {
      files: [{ id: "exports", target: "directory", access: "read-write" }],
      notifications: [{ id: "new-mail", title: "New mail", description: "New messages are ready." }],
      network: [{
        id: "inbox-api",
        target: { kind: "public-https", origin: "https://mail.example.com" },
        methods: ["GET", "POST"],
        auth: [{
          kind: "oauth2-pkce",
          issuer: "https://identity.example.com",
          clientId: "workspace-connected-inbox",
          scopes: ["mail.read", "mail.send"],
        }],
      }],
    },
    background: { intervalMinutes: 30 },
    ...overrides,
  };
}

test("restricted app manifests normalize a bounded sandbox, tool, and connection contract", () => {
  const parsed = parseRestrictedAppManifest(manifest());
  assert.equal(parsed.runtime.kind, "sandboxed-web");
  assert.equal(parsed.runtime.entry, "index.html");
  assert.equal(parsed.runtime.worker, "worker.js");
  assert.equal(parsed.tools[0]?.inputSchema.additionalProperties, false);
  assert.deepEqual(parsed.permissions.network[0]?.methods, ["GET", "POST"]);
  assert.deepEqual(parsed.permissions.network[0]?.auth, [{
    kind: "oauth2-pkce",
    issuer: "https://identity.example.com",
    clientId: "workspace-connected-inbox",
    scopes: ["mail.read", "mail.send"],
  }]);
  assert.deepEqual(parsed.permissions.files, [{ id: "exports", target: "directory", access: "read-write" }]);
  assert.deepEqual(parsed.permissions.notifications, [{ id: "new-mail", title: "New mail", description: "New messages are ready." }]);
  assert.deepEqual(parsed.background, { intervalMinutes: 30 });
});

test("restricted app manifests reject undeclared powers and unsafe package paths", () => {
  assert.throws(() => parseRestrictedAppManifest(manifest({ arbitraryHostAccess: true })), /unsupported field/);
  assert.throws(() => parseRestrictedAppManifest(manifest({
    runtime: { kind: "node", entry: "app.js" },
  })), /sandboxed-web/);
  for (const entry of ["../index.html", "C:/index.html", "folder\\index.html", "CON/index.html", "app.ts"]) {
    assert.throws(() => parseRestrictedAppManifest(manifest({
      runtime: { kind: "sandboxed-web", entry, worker: "worker.js" },
    })), /path|segment|file type/);
  }
});

test("restricted app network grants require exact HTTPS DNS origins and explicit methods", () => {
  for (const origin of [
    "http://mail.example.com",
    "https://*.example.com",
    "https://user:pass@mail.example.com",
    "https://127.0.0.1",
    "https://mail.example.com/messages",
  ]) {
    assert.throws(() => parseRestrictedAppManifest(manifest({
      permissions: { network: [{ id: "mail", target: { kind: "public-https", origin }, methods: ["GET"], auth: [{ kind: "bearer" }] }] },
    })), /exact (?:HTTPS public DNS )?origin/);
  }
  assert.throws(() => parseRestrictedAppManifest(manifest({
    permissions: { network: [{ id: "mail", target: { kind: "public-https", origin: "https://mail.example.com" }, methods: ["CONNECT"], auth: [{ kind: "bearer" }] }] },
  })), /method is unsupported/);
  assert.throws(() => parseRestrictedAppManifest(manifest({
    permissions: { network: [{ id: "mail", target: { kind: "public-https", origin: "https://mail.example.com" }, methods: ["GET"], auth: [{ kind: "none" }, { kind: "bearer" }] }] },
  })), /cannot combine/);
  assert.throws(() => parseRestrictedAppManifest(manifest({
    permissions: { network: [{ id: "local", target: { kind: "loopback-http", host: "localhost", port: 4317 }, methods: ["GET"], auth: [{ kind: "none" }] }] },
  })), /loopback host/);
  assert.throws(() => parseRestrictedAppManifest(manifest({
    permissions: { network: [{ id: "local", target: { kind: "loopback-http", host: "127.0.0.1", port: 4317 }, methods: ["GET"], auth: [{ kind: "bearer" }] }] },
  })), /cannot receive saved credentials/);
  assert.throws(() => parseRestrictedAppManifest(manifest({
    permissions: { network: [{ id: "mail", target: { kind: "public-https", origin: "https://mail.example.com" }, methods: ["GET"], auth: [{ kind: "oauth2-pkce", issuer: "http://identity.example.com", clientId: "client", scopes: ["mail.read"] }] }] },
  })), /exact public HTTPS issuer URL/);
  assert.throws(() => parseRestrictedAppManifest(manifest({
    permissions: { network: [{ id: "mail", target: { kind: "public-https", origin: "https://mail.example.com" }, methods: ["GET"], auth: [{ kind: "oauth2-pkce", issuer: "https://identity.example.com", clientId: "client", scopes: ["openid"] }] }] },
  })), /scope is invalid or unsupported/);
});

test("restricted app file and background powers are explicit and bounded", () => {
  assert.throws(() => parseRestrictedAppManifest(manifest({
    permissions: { network: [], files: [{ id: "exports", target: "workspace", access: "read-write" }] },
  })), /target must be file or directory/);
  assert.throws(() => parseRestrictedAppManifest(manifest({
    permissions: { network: [], files: [{ id: "exports", target: "directory", access: "execute" }] },
  })), /access must be read or read-write/);
  assert.throws(() => parseRestrictedAppManifest(manifest({ background: { intervalMinutes: 5 } })), /between 15 and 1440/);
  assert.throws(() => parseRestrictedAppManifest(manifest({
    runtime: { kind: "sandboxed-web", entry: "index.html" },
    tools: [],
    background: { intervalMinutes: 30 },
  })), /must declare a sandboxed worker/);
});

test("restricted app notifications require scheduled workers and safe static single-line copy", () => {
  assert.throws(() => parseRestrictedAppManifest(manifest({
    runtime: { kind: "sandboxed-web", entry: "index.html" },
    tools: [],
    background: undefined,
  })), /notifications must declare a sandboxed background worker and schedule/);
  for (const title of ["New\nmail", "New\u202email"]) {
    assert.throws(() => parseRestrictedAppManifest(manifest({
      permissions: { network: [], files: [], notifications: [{ id: "new-mail", title, description: "New messages are ready." }] },
    })), /plain single-line text/);
  }
  assert.throws(() => parseRestrictedAppManifest(manifest({
    permissions: { network: [], files: [], notifications: [{ id: "new-mail", title: "New mail", description: "Ready\u0007now" }] },
  })), /plain single-line text/);
  for (const title of ["Connected\ninbox", "Connected\u202einbox"]) {
    assert.throws(() => parseRestrictedAppManifest(manifest({ title })), /plain single-line text/);
  }
});

test("restricted app tool schemas reject executable or open-ended schema features", () => {
  const baseTool = (inputSchema: unknown) => ({
    name: "search",
    description: "Search.",
    action: "search",
    inputSchema,
    resultSchema: { type: "object", properties: {}, required: [], additionalProperties: false },
  });
  assert.throws(() => parseRestrictedAppManifest(manifest({
    tools: [baseTool({ type: "object", properties: {}, required: [], additionalProperties: true })],
  })), /additionalProperties to false/);
  assert.throws(() => parseRestrictedAppManifest(manifest({
    tools: [baseTool({ type: "string", pattern: ".*" })],
  })), /unsupported field/);
  assert.throws(() => parseRestrictedAppManifest(manifest({
    tools: [baseTool({ type: "object", properties: { query: { type: "string" } }, required: ["missing"], additionalProperties: false })],
  })), /not declared/);
});
