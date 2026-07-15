import assert from "node:assert/strict";
import test from "node:test";

import {
  desktopWindowMaterial,
  minimumWindowsMicaBuild,
  shouldUseMacVibrancy,
  shouldUseWindowsMica,
} from "../desktop/src/window-material.js";

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

test("macOS vibrancy follows the native platform, accessibility, and opt-out", () => {
  assert.equal(shouldUseMacVibrancy("darwin", false), true);
  assert.equal(shouldUseMacVibrancy("darwin", true), false);
  assert.equal(shouldUseMacVibrancy("darwin", false, false), false);
  assert.equal(shouldUseMacVibrancy("win32", false), false);
});

test("desktop window material selects one platform-native effect", () => {
  assert.equal(desktopWindowMaterial("win32", { windowsMica: true, macVibrancy: true }), "mica");
  assert.equal(desktopWindowMaterial("darwin", { windowsMica: true, macVibrancy: true }), "vibrancy");
  assert.equal(desktopWindowMaterial("darwin", { windowsMica: false, macVibrancy: false }), "none");
  assert.equal(desktopWindowMaterial("linux", { windowsMica: true, macVibrancy: true }), "none");
});
