export type ChatTurnStateDecision = "running" | "settle" | "ignore";

export interface ChatTurnStateGate {
  observe: (running: boolean) => ChatTurnStateDecision;
}

/**
 * A newly opened SSE connection always receives an idle snapshot before a
 * just-posted turn can broadcast its running state. Only a stream that has
 * observed `running: true` is allowed to interpret a later false snapshot as
 * the end of that turn.
 */
export function createChatTurnStateGate(): ChatTurnStateGate {
  let observedRunningTurn = false;
  return {
    observe(running) {
      if (running) {
        observedRunningTurn = true;
        return "running";
      }
      if (!observedRunningTurn) return "ignore";
      observedRunningTurn = false;
      return "settle";
    },
  };
}

export function observeChatTurnState(
  gate: ChatTurnStateGate,
  running: boolean,
  sendTransitioning: boolean,
): ChatTurnStateDecision {
  if (!running && sendTransitioning) return "ignore";
  return gate.observe(running);
}
