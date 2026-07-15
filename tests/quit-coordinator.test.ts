import assert from "node:assert/strict";
import test from "node:test";

import { GracefulQuitCoordinator, type QuitPreparationOutcome } from "../desktop/src/quit-coordinator.js";

function nextTurn(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

test("graceful quit prepares once and resumes Electron on a deferred turn", async () => {
  let prepareCalls = 0;
  let quitCalls = 0;
  let resolvePreparation: ((outcome: QuitPreparationOutcome) => void) | null = null;
  const deferred: Array<() => void> = [];
  const coordinator = new GracefulQuitCoordinator({
    prepare: () => {
      prepareCalls += 1;
      return new Promise((resolve) => { resolvePreparation = resolve; });
    },
    quit: () => { quitCalls += 1; },
    defer: (callback) => { deferred.push(callback); },
  });

  coordinator.requestQuit();
  coordinator.requestQuit();
  assert.equal(prepareCalls, 1);
  assert.equal(coordinator.shouldPreventNativeQuit(), true);
  assert.equal(quitCalls, 0);

  resolvePreparation?.("quit");
  await nextTurn();
  assert.equal(coordinator.shouldPreventNativeQuit(), false);
  assert.equal(deferred.length, 1);
  assert.equal(quitCalls, 0, "quit must not re-enter the native menu termination cycle");

  deferred.shift()?.();
  assert.equal(quitCalls, 1);
});

test("an updater handoff allows native termination without scheduling a competing quit", async () => {
  let quitCalls = 0;
  const deferred: Array<() => void> = [];
  const coordinator = new GracefulQuitCoordinator({
    prepare: async () => "handoff",
    quit: () => { quitCalls += 1; },
    defer: (callback) => { deferred.push(callback); },
  });

  coordinator.requestQuit();
  await nextTurn();

  assert.equal(coordinator.shouldPreventNativeQuit(), false);
  assert.equal(deferred.length, 0);
  assert.equal(quitCalls, 0);
});

test("unexpected preparation failures are reported but cannot strand the app", async () => {
  const errors: unknown[] = [];
  let quitCalls = 0;
  const coordinator = new GracefulQuitCoordinator({
    prepare: async () => { throw new Error("cleanup broke"); },
    quit: () => { quitCalls += 1; },
    onError: (error) => { errors.push(error); },
  });

  coordinator.requestQuit();
  await nextTurn();
  await nextTurn();

  assert.equal(errors.length, 1);
  assert.equal(coordinator.shouldPreventNativeQuit(), false);
  assert.equal(quitCalls, 1);
});

test("pre-authorized CLI and updater exits pass through without preparing again", async () => {
  let prepareCalls = 0;
  let quitCalls = 0;
  const coordinator = new GracefulQuitCoordinator({
    prepare: async () => { prepareCalls += 1; return "quit"; },
    quit: () => { quitCalls += 1; },
  });

  coordinator.allowNativeQuit();
  coordinator.requestQuit();
  await nextTurn();

  assert.equal(prepareCalls, 0);
  assert.equal(quitCalls, 1);
});
