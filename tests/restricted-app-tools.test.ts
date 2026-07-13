import assert from "node:assert/strict";
import test from "node:test";

import { createRestrictedAppTools } from "../src/local/agent/pi-client.js";
import type { RestrictedAppInstalled } from "../src/local/agent/restricted-app-service.js";

const digest = "a".repeat(64);
const installed: RestrictedAppInstalled = {
  workspaceId: "space-one",
  packageName: "connected-inbox",
  version: "1.0.0",
  digest,
  fileCount: 4,
  totalBytes: 1024,
  networkGrants: ["mail-api"],
  fileGrants: [],
  notificationGrants: [],
  backgroundEnabled: false,
  installedAt: "2026-07-13T00:00:00.000Z",
  updatedAt: "2026-07-13T00:00:00.000Z",
  manifest: {
    version: 1,
    id: "connected-inbox",
    title: "Connected inbox",
    runtime: { kind: "sandboxed-web", entry: "index.html", worker: "worker.js" },
    ui: { icon: "mail" },
    tools: [{
      name: "inbox_search",
      description: "Search messages in the connected inbox.",
      action: "search",
      inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"], additionalProperties: false },
      resultSchema: { type: "object", properties: { count: { type: "integer" } }, required: ["count"], additionalProperties: false },
    }],
    permissions: { network: [{ id: "mail-api", target: { kind: "public-https", origin: "https://mail.example.com" }, methods: ["GET"], auth: [{ kind: "none" }] }], files: [], notifications: [] },
  },
};

test("installed app actions become namespaced Pi tools bound to Space, app, digest, and action", async () => {
  const calls: unknown[] = [];
  const tools = createRestrictedAppTools({
    workspaceId: "space-one",
    apps: [installed],
    service: {
      async invoke(input) {
        calls.push(structuredClone(input));
        return { count: 3 };
      },
    },
  });
  assert.equal(tools.length, 1);
  assert.match(tools[0]!.name, /^app_[a-f0-9]{8}_inbox_search$/);
  assert.match(tools[0]!.description, /Connected inbox/);
  const result = await tools[0]!.execute("call-1", { query: "release" }, undefined, undefined, {} as never);
  assert.deepEqual(calls, [{ workspaceId: "space-one", appId: "connected-inbox", expectedDigest: digest, action: "search", input: { query: "release" } }]);
  assert.deepEqual(result.content, [{ type: "text", text: '{"count":3}' }]);
});

test("app tool names remain deterministic and distinct when packages reuse a declared tool name", () => {
  const other = structuredClone(installed);
  other.manifest.id = "project-mail";
  const tools = createRestrictedAppTools({ workspaceId: "space-one", apps: [installed, other], service: { invoke: async () => ({ count: 0 }) } });
  assert.equal(new Set(tools.map((tool) => tool.name)).size, 2);
  assert.ok(tools.every((tool) => tool.name.length <= 64));
});
