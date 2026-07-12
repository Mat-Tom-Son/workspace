import assert from "node:assert/strict";
import test from "node:test";

import { minimumWindowsMicaBuild, shouldUseWindowsMica } from "../desktop/src/window-material.js";

test("Mica is limited to Windows 11 22H2 and respects reduced transparency", () => {
  assert.equal(minimumWindowsMicaBuild, 22621);
  assert.equal(shouldUseWindowsMica("win32", "10.0.22621", false), true);
  assert.equal(shouldUseWindowsMica("win32", "10.0.26100.1", false), true);
  assert.equal(shouldUseWindowsMica("win32", "10.0.22000", false), false);
  assert.equal(shouldUseWindowsMica("win32", "10.0.19045", false), false);
  assert.equal(shouldUseWindowsMica("win32", "not-a-version", false), false);
  assert.equal(shouldUseWindowsMica("win32", "10.0.26100", true), false);
  assert.equal(shouldUseWindowsMica("darwin", "10.0.26100", false), false);
});
