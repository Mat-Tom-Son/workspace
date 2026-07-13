import assert from "node:assert/strict";
import test from "node:test";

import { startRestrictedAppDemoService } from "../examples/services/restricted-app-demo-service.mjs";

test("restricted app demo service exposes only its bounded loopback JSON routes", async () => {
  const service = await startRestrictedAppDemoService({ port: 0 });
  try {
    assert.equal(service.host, "127.0.0.1");
    assert.ok(service.port > 0);
    assert.equal(service.origin, `http://127.0.0.1:${service.port}`);

    const health = await fetch(`${service.origin}/health`);
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), {
      ok: true,
      service: "restricted-app-demo-service",
      status: "ready",
    });

    const refresh = await fetch(`${service.origin}/jobs/refresh`, { method: "POST" });
    assert.equal(refresh.status, 202);
    assert.deepEqual(await refresh.json(), { ok: true, job: "refresh", status: "accepted" });

    const missing = await fetch(`${service.origin}/anything-else`);
    assert.equal(missing.status, 404);
    assert.deepEqual(await missing.json(), { ok: false, error: "Not found" });
  } finally {
    await service.close();
  }
});
