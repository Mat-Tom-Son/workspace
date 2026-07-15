import assert from "node:assert/strict";
import test from "node:test";

import { AppLifetimeResource } from "../desktop/src/app-lifetime-resource.js";

test("an app-lifetime resource survives window-style reacquisition and closes once", async () => {
  const lifetime = new AppLifetimeResource<{ origin: string; close: () => Promise<void> }>();
  let creates = 0;
  let closes = 0;
  const create = async () => {
    creates += 1;
    return { origin: "http://127.0.0.1:1234", close: async () => { closes += 1; } };
  };

  const [first, concurrent] = await Promise.all([lifetime.ensure(create), lifetime.ensure(create)]);
  const afterWindowClose = await lifetime.ensure(create);

  assert.equal(first, concurrent);
  assert.equal(afterWindowClose, first);
  assert.equal(creates, 1);
  await Promise.all([lifetime.close(), lifetime.close()]);
  assert.equal(closes, 1);
  await assert.rejects(lifetime.ensure(create), /shutting down/i);
});

test("a failed app-lifetime resource creation can be retried", async () => {
  const lifetime = new AppLifetimeResource<{ close: () => Promise<void> }>();
  let attempts = 0;
  const create = async () => {
    attempts += 1;
    if (attempts === 1) throw new Error("not ready");
    return { close: async () => undefined };
  };

  await assert.rejects(lifetime.ensure(create), /not ready/);
  await lifetime.ensure(create);
  assert.equal(attempts, 2);
  await lifetime.close();
});
