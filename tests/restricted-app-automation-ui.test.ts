import assert from "node:assert/strict";
import test from "node:test";

import {
  restrictedAppAutomationOutcomeLabel,
  restrictedAppAutomationVerificationLabel,
} from "../web-local/src/lib/restricted-app-automation.js";

test("automation history distinguishes interrupted work from an explicit cancellation", () => {
  assert.equal(restrictedAppAutomationOutcomeLabel({ outcome: "cancelled", state: "cancelled" }), "Cancelled");
  assert.equal(
    restrictedAppAutomationOutcomeLabel({ outcome: "interrupted", state: "expired" }),
    "Interrupted — completion unknown",
  );
});

test("automation history visibly identifies migrated receipts without captured identity evidence", () => {
  assert.equal(restrictedAppAutomationVerificationLabel("captured"), undefined);
  assert.equal(restrictedAppAutomationVerificationLabel("legacy-unverified"), "Legacy receipt — identity unverified");
});
