import assert from "node:assert/strict";
import test from "node:test";

import { defaultWorkspaceBannerName } from "../web-local/src/constants.js";
import {
  normalizeWorkspaceBannerImage,
  normalizeWorkspaceBannerImagePosition,
  normalizeWorkspaceCustomizations,
  workspaceBannerOptionFor,
} from "../web-local/src/lib/workspace-customization.js";
import { writeStoredJsonValue } from "../web-local/src/lib/storage.js";
import type { WorkspaceSummary } from "../web-local/src/types.js";

const workspace: WorkspaceSummary = {
  id: "space-home",
  name: "Home projects",
  rootPath: "C:\\Users\\you\\Documents\\Home projects",
  location: { kind: "local", storage: "linked" },
  createdAt: "2026-07-10T00:00:00.000Z",
  updatedAt: "2026-07-10T00:00:00.000Z",
};

test("Space banners keep Classic as the explicit default while supporting None", () => {
  assert.equal(defaultWorkspaceBannerName, "classic");
  assert.equal(workspaceBannerOptionFor(undefined).name, "classic");
  assert.equal(workspaceBannerOptionFor("none").name, "none");
  assert.equal(workspaceBannerOptionFor("unknown").name, "classic");
});

test("Space customization normalization accepts only supported fields", () => {
  const raster = "data:image/png;base64,AA==";
  const normalized = normalizeWorkspaceCustomizations({
    [workspace.id]: {
      color: "#0D74CE",
      color2: "#5C7C2E",
      iconName: "home",
      bannerName: "aurora",
      bannerImage: raster,
      bannerImagePosition: "bottom",
      ignored: "value",
    },
    removed: { color: "#ffffff" },
  }, new Set([workspace.id]), new Set(["folder", "home", "airplane"]));

  assert.deepEqual(normalized, {
    [workspace.id]: {
      color: "#0d74ce",
      color2: "#5c7c2e",
      iconName: "home",
      bannerName: "aurora",
      bannerImage: raster,
      bannerImagePosition: "bottom",
    },
  });
});

test("Space customization normalization rejects unsafe images and invalid values", () => {
  const normalized = normalizeWorkspaceCustomizations({
    [workspace.id]: {
      color: "blue",
      color2: "#12345g",
      iconName: "not-a-real-icon",
      bannerName: "not-a-banner",
      bannerImage: "data:image/svg+xml;base64,PHN2Zy8+",
      bannerImagePosition: "left",
    },
  }, undefined, new Set(["folder", "home", "airplane"]));

  assert.deepEqual(normalized, {});
  assert.equal(normalizeWorkspaceBannerImage("https://example.com/banner.png"), null);
  assert.equal(normalizeWorkspaceBannerImage("data:image/svg+xml;base64,PHN2Zy8+"), null);
  assert.equal(normalizeWorkspaceBannerImagePosition("left"), "center");
});

test("preference storage reports quota failures instead of silently claiming durability", () => {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  try {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: { localStorage: { setItem: () => { throw new Error("quota"); }, removeItem: () => {} } },
    });
    assert.equal(writeStoredJsonValue("workspace.appearance.test", { color: "#0d74ce" }), false);

    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: { localStorage: { setItem: () => {}, removeItem: () => {} } },
    });
    assert.equal(writeStoredJsonValue("workspace.appearance.test", { color: "#0d74ce" }), true);
  } finally {
    if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
    else Reflect.deleteProperty(globalThis, "window");
  }
});
