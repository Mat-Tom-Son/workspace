import assert from "node:assert/strict";
import test from "node:test";

import {
  RestrictedAppNotificationBroker,
  type RestrictedAppNotificationDisplay,
  type RestrictedAppNotificationHandle,
} from "../src/local/agent/restricted-app-notifications.js";

class Sink {
  readonly shown: Array<{
    notification: RestrictedAppNotificationDisplay;
    callbacks: { onClick: () => void; onClose: () => void };
    handle: RestrictedAppNotificationHandle & { closed: boolean };
  }> = [];
  supported = true;

  isSupported(): boolean { return this.supported; }

  show(notification: RestrictedAppNotificationDisplay, callbacks: { onClick: () => void; onClose: () => void }) {
    const handle = {
      closed: false,
      close: () => {
        handle.closed = true;
        callbacks.onClose();
      },
    };
    this.shown.push({ notification, callbacks, handle });
    return handle;
  }
}

const digestOne = "1".repeat(64);
const digestTwo = "2".repeat(64);

function context(overrides: Record<string, unknown> = {}) {
  return {
    workspaceId: "ws-1111111111111111",
    appId: "connected-inbox",
    digest: digestOne,
    appTitle: "Connected inbox",
    declarations: [
      { id: "new-mail", title: "New mail", description: "New messages are ready." },
      { id: "sync-error", title: "Sync paused", description: "Open the app to reconnect." },
      { id: "export-ready", title: "Export ready", description: "Your export is ready." },
    ],
    grants: ["new-mail", "sync-error", "export-ready"],
    backgroundEnabled: true,
    invocationId: "invocation-one",
    ...overrides,
  };
}

test("notification broker renders only reviewed static copy during granted background work", () => {
  const sink = new Sink();
  const opened: unknown[] = [];
  const broker = new RestrictedAppNotificationBroker({ sink });
  assert.deepEqual(broker.show(context(), { permissionId: "new-mail" }, (request) => opened.push(request)), { status: "shown" });
  assert.deepEqual(sink.shown[0]?.notification, {
    workspaceId: "ws-1111111111111111",
    appId: "connected-inbox",
    digest: digestOne,
    permissionId: "new-mail",
    title: "Workspace · Connected inbox — New mail",
    body: "New messages are ready.",
  });
  sink.shown[0]?.callbacks.onClick();
  assert.deepEqual(opened, [{ workspaceId: "ws-1111111111111111", appId: "connected-inbox", digest: digestOne, permissionId: "new-mail" }]);
  assert.equal(sink.shown[0]?.handle.closed, true, "clicking consumes and closes the current notification");
  sink.shown[0]?.callbacks.onClick();
  assert.equal(opened.length, 1, "a stale native click cannot reopen the app");
  broker.dispose();
});

test("notification broker rejects dynamic payloads, missing grants, and disabled background authority", () => {
  const sink = new Sink();
  const broker = new RestrictedAppNotificationBroker({ sink });
  assert.throws(() => broker.show(context(), { permissionId: "new-mail", body: "injected" }, () => undefined), /only a valid permissionId/);
  assert.throws(() => broker.show(context({ grants: [] }), { permissionId: "new-mail" }, () => undefined), /not granted/);
  assert.throws(() => broker.show(context({ backgroundEnabled: false }), { permissionId: "new-mail" }, () => undefined), /Enable background work/);
  assert.equal(sink.shown.length, 0);
  broker.dispose();
});

test("notification anti-spam quota survives close, permission churn, background churn, and digest updates", () => {
  let now = 1_000;
  const sink = new Sink();
  const broker = new RestrictedAppNotificationBroker({ sink, now: () => now });
  for (let index = 0; index < 8; index += 1) {
    assert.deepEqual(broker.show(context({ invocationId: `invocation-${index}` }), { permissionId: "new-mail" }, () => undefined), { status: "shown" });
    now += 5 * 60_000 + 1;
  }
  broker.closeApp({ workspaceId: "ws-1111111111111111", appId: "connected-inbox" }, digestOne);
  const updated = context({ digest: digestTwo, invocationId: "after-update", grants: [], backgroundEnabled: false });
  assert.throws(() => broker.show(updated, { permissionId: "new-mail" }, () => undefined), /Enable background work/);
  assert.deepEqual(broker.show({ ...updated, grants: ["new-mail"], backgroundEnabled: true }, { permissionId: "new-mail" }, () => undefined), { status: "rate-limited" });
  assert.equal(sink.shown.length, 8);
  broker.dispose();
});

test("notification broker enforces invocation and outstanding limits", () => {
  let now = 1_000;
  const sink = new Sink();
  const broker = new RestrictedAppNotificationBroker({ sink, now: () => now });
  assert.equal(broker.show(context(), { permissionId: "new-mail" }, () => undefined).status, "shown");
  assert.equal(broker.show(context(), { permissionId: "sync-error" }, () => undefined).status, "shown");
  assert.equal(broker.show(context(), { permissionId: "export-ready" }, () => undefined).status, "rate-limited");
  now += 5 * 60_000 + 1;
  assert.equal(broker.show(context({ invocationId: "two" }), { permissionId: "export-ready" }, () => undefined).status, "shown");
  now += 5 * 60_000 + 1;
  assert.equal(broker.show(context({ invocationId: "three", declarations: [...context().declarations, { id: "digest-ready", title: "Digest ready", description: "Your digest is ready." }], grants: [...context().grants, "digest-ready"] }), { permissionId: "digest-ready" }, () => undefined).status, "shown");
  assert.equal(sink.shown[0]?.handle.closed, true, "the oldest outstanding notification is closed at the per-app cap");
  broker.dispose();
});

test("notification lifecycle cleanup filters digest handles and tolerates synchronous native close", () => {
  const sink = new Sink();
  const broker = new RestrictedAppNotificationBroker({ sink });
  broker.show(context(), { permissionId: "new-mail" }, () => undefined);
  broker.show(context({ digest: digestTwo, invocationId: "two" }), { permissionId: "sync-error" }, () => undefined);
  broker.closeApp({ workspaceId: "ws-1111111111111111", appId: "connected-inbox" }, digestOne);
  assert.equal(sink.shown[0]?.handle.closed, true);
  assert.equal(sink.shown[1]?.handle.closed, false);
  broker.closeAll();
  assert.equal(sink.shown[1]?.handle.closed, true);
  broker.dispose();

  const synchronousSink = {
    isSupported: () => true,
    show: (_notification: RestrictedAppNotificationDisplay, callbacks: { onClick: () => void; onClose: () => void }) => {
      callbacks.onClose();
      return { close: () => undefined };
    },
  };
  const synchronous = new RestrictedAppNotificationBroker({ sink: synchronousSink });
  assert.equal(synchronous.show(context(), { permissionId: "new-mail" }, () => undefined).status, "shown");
  synchronous.closeAll();
  synchronous.dispose();
});
