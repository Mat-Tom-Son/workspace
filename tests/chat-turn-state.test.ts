import assert from "node:assert/strict";
import { test } from "node:test";

import { createChatTurnStateGate, observeChatTurnState } from "../web-local/src/lib/chat-turn-state.js";

test("an initial idle snapshot cannot settle a just-posted turn before running is observed", async () => {
  const gate = createChatTurnStateGate();
  let posting = true;
  let running = true;
  let streamOpen = true;
  let transcriptLoads = 0;
  let resolveTranscript: (() => void) | null = null;

  const receiveSnapshot = (serverRunning: boolean) => {
    const decision = observeChatTurnState(gate, serverRunning, posting);
    if (decision === "running") running = true;
    if (decision === "settle" && running) {
      transcriptLoads += 1;
      void new Promise<void>((resolve) => { resolveTranscript = resolve; }).then(() => {
        running = false;
        streamOpen = false;
      });
    }
  };

  receiveSnapshot(false);
  posting = false; // The POST can resolve before the buffered initial snapshot is dispatched.
  receiveSnapshot(false);
  assert.equal(transcriptLoads, 0);
  assert.equal(running, true);
  assert.equal(streamOpen, true);

  receiveSnapshot(true);
  receiveSnapshot(false);
  assert.equal(transcriptLoads, 1);
  assert.equal(running, true, "the stream remains live while transcript rehydration is pending");
  assert.equal(streamOpen, true);

  assert.ok(resolveTranscript);
  resolveTranscript();
  await Promise.resolve();
  assert.equal(running, false);
  assert.equal(streamOpen, false);
});
