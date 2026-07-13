import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";

import {
  RegisteredSpaceRuntimeProvider,
  RegisteredSpaceTrustAuthority,
} from "../src/local/agent/registered-space-runtime.js";

test("registered Space membership grants Pi project trust and removal revokes it", async () => {
  const registeredRoot = join(process.cwd(), "registered-space-runtime", "registered");
  const otherRoot = join(process.cwd(), "registered-space-runtime", "other");
  const authority = new RegisteredSpaceTrustAuthority([registeredRoot]);
  const provider = new RegisteredSpaceRuntimeProvider({
    async resolveRuntime() {
      return { projectTrust: { request: async () => true } };
    },
  }, authority);

  assert.equal((await provider.resolveRuntime(registeredRoot)).projectTrust?.override, true);
  assert.equal((await provider.resolveRuntime(otherRoot)).projectTrust?.override, false);
  assert.equal((await provider.resolveRuntime(join(registeredRoot, "child"))).projectTrust?.override, false, "authorization is exact-root, not inherited by descendants");

  authority.grant(otherRoot);
  assert.equal((await provider.resolveRuntime(otherRoot)).projectTrust?.override, true);

  authority.revoke(registeredRoot);
  assert.equal((await provider.resolveRuntime(registeredRoot)).projectTrust?.override, false);
});
