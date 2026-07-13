import assert from "node:assert/strict";
import test from "node:test";

import { resolveRestrictedAppOpenRequest } from "../web-local/src/lib/restricted-app-navigation.js";

const workspaces = [
  { id: "ws-current", name: "Current", rootPath: "C:\\Current", location: { kind: "local" as const, storage: "linked" as const }, createdAt: "2026-07-13T00:00:00.000Z", updatedAt: "2026-07-13T00:00:00.000Z" },
  { id: "ws-owner", name: "Owner", rootPath: "C:\\Owner", location: { kind: "local" as const, storage: "linked" as const }, createdAt: "2026-07-13T00:00:00.000Z", updatedAt: "2026-07-13T00:00:00.000Z" },
];

test("notification open requests target the exact owning Space even when another Space is active", () => {
  const target = resolveRestrictedAppOpenRequest({
    workspaceId: "ws-owner",
    appId: "connected-inbox",
    digest: "a".repeat(64),
    permissionId: "new-mail",
  }, workspaces);
  assert.equal(target?.workspace.id, "ws-owner");
  assert.equal(target?.mode, "app:restricted:ws-owner:connected-inbox");
  assert.notEqual(target?.workspace.id, "ws-current");
});

test("notification open requests do not invent a removed owning Space", () => {
  assert.equal(resolveRestrictedAppOpenRequest({
    workspaceId: "ws-removed",
    appId: "connected-inbox",
    digest: "a".repeat(64),
    permissionId: "new-mail",
  }, workspaces), null);
});
