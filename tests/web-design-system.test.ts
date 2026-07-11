import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

const rendererRoot = join(process.cwd(), "web-local", "src");

const [
  workspaceChromeSource,
  workspacePanesSource,
  workspaceIdentitySource,
  foundationCss,
  shellCss,
  legacyCss,
  surfacesCss,
  customizationCss,
  desktopSettingsSource,
] = await Promise.all([
  readRenderer("components/panes/workspaceChrome.tsx"),
  readRenderer("components/panes/workspacePanes.tsx"),
  readRenderer("lib/workspace-identity.ts"),
  readRenderer("professional-foundation.css"),
  readRenderer("professional-shell.css"),
  readRenderer("styles.css"),
  readRenderer("professional-surfaces.css"),
  readRenderer("professional-customization.css"),
  readRenderer("components/modals/DesktopSettingsModal.tsx"),
]);

test("Files is the first primary surface and Space remains the root selector", () => {
  const primaryItems = constArrayBody(workspaceChromeSource, "primaryItems");
  const primaryModes = [...primaryItems.matchAll(/mode:\s*"([^"]+)"/g)].map((match) => match[1]);

  assert.deepEqual(primaryModes, ["files", "chats", "library", "history"]);
  assert.doesNotMatch(primaryItems, /mode:\s*"workspaces"/);

  const selectorIndex = workspaceChromeSource.indexOf("workspace-rail-space-selector");
  const primaryRenderIndex = workspaceChromeSource.indexOf("primaryItems.map");
  assert.ok(selectorIndex >= 0, "the rail must expose a distinct Space selector");
  assert.ok(primaryRenderIndex > selectorIndex, "the Space selector must render before primary surfaces");
  assert.match(workspaceChromeSource, /onModeChange\("workspaces"\)/);
  assert.match(workspaceChromeSource, /<span>Space<\/span><strong>\{workspaceLabel\}<\/strong>/);
});

test("pane navigation uses one Fluent icon contract", () => {
  for (const [name, source] of [
    ["workspaceChrome.tsx", workspaceChromeSource],
    ["workspacePanes.tsx", workspacePanesSource],
  ] as const) {
    assert.doesNotMatch(source, /from\s+["']lucide-react["']/, `${name} must not mix Lucide into product surfaces`);
    assert.match(source, /from\s+["']@fluentui\/react-icons["']/, `${name} must use Fluent icons`);
  }

  const requiredNavPairs = [
    "DocumentFolder20",
    "ChatMultiple20",
    "Library20",
    "History20",
    "Settings20",
    "BookToolbox20",
    "PlugConnected20",
  ];
  for (const icon of requiredNavPairs) {
    assert.match(workspaceChromeSource, new RegExp(`\\b${icon}Regular\\b`), `${icon} needs a regular state`);
    assert.match(workspaceChromeSource, new RegExp(`\\b${icon}Filled\\b`), `${icon} needs a filled active state`);
  }

  assert.match(workspaceChromeSource, /professional-workspace-rail/);
  assert.doesNotMatch(workspaceChromeSource, /<Bot\w*[^>]*>.*Assistant/s);
});

test("Space identity and typography keep the restrained defaults", () => {
  const defaultIconBody = functionBody(workspaceIdentitySource, "defaultWorkspaceIconName");
  assert.match(defaultIconBody, /^\s*return\s+["']folder["'];?\s*$/);
  assert.doesNotMatch(defaultIconBody, /notebook/i);

  const heavyWeightMatch = foundationCss.match(/--workspace-font-weight-heavy:\s*(\d+)\s*;/);
  assert.ok(heavyWeightMatch, "professional foundation must declare the heavy-weight token");
  assert.equal(Number(heavyWeightMatch[1]), 700);

  const numericWeights = [
    Number(heavyWeightMatch[1]),
    ...[...foundationCss.matchAll(/font-weight:\s*(\d+)\s*;/g)].map((match) => Number(match[1])),
  ];
  assert.ok(numericWeights.every((weight) => weight <= 700), `foundation contains a weight above 700: ${numericWeights.join(", ")}`);
});

test("every used P0 pane class has a CSS selector", () => {
  const p0Classes = [
    "assistant-setup-card",
    "setup-intro",
    "setup-grid",
    "security-note",
    "trust-banner",
    "install-panel",
    "scope-toggle",
    "package-input",
    "card-grid",
    "resource-card",
    "empty-state",
    "tool-details",
    "tool-list",
    "loading-row",
    "inline-error",
    "diagnostics",
    "history-list",
    "history-pane-actions",
    "library-split",
    "library-tree",
    "library-detail",
    "resource-selection",
    "chat-workspace-heading",
    "professional-surface",
    "professional-card",
    "professional-button",
    "professional-field",
    "professional-notice",
    "professional-install-panel",
    "professional-card-grid",
    "professional-empty-state",
  ];
  const staticClasses = staticClassTokens(workspacePanesSource);
  const combinedCss = stripCssComments(`${legacyCss}\n${surfacesCss}`);
  const usedP0Classes = p0Classes.filter((className) => staticClasses.has(className));
  const missingSelectors = usedP0Classes.filter((className) => !hasClassSelector(combinedCss, className));

  assert.ok(usedP0Classes.length > 0, "the P0 contract must cover classes used by workspacePanes");
  assert.deepEqual(missingSelectors, [], `P0 classes without CSS selectors: ${missingSelectors.join(", ")}`);
});

test("professional shell keeps compact neutral structure", () => {
  const layoutRule = cssRuleBody(shellCss, ".app-shell .workspace-layout");
  const modePaneRule = cssRuleBody(shellCss, ".app-shell .workspace-layout .workspace-mode-pane");
  const railRule = cssRuleBody(shellCss, ".app-shell .professional-workspace-rail");
  const navButtonRule = cssRuleBody(shellCss, ".app-shell .professional-workspace-rail .workspace-rail-button");
  const spaceSelectorRule = cssRuleBody(shellCss, ".app-shell .professional-workspace-rail .workspace-rail-space-selector");
  const paneHeaderRule = cssRuleBody(shellCss, ".app-shell .workspace-layout .workspace-mode-pane .professional-pane-header");

  assert.match(modePaneRule, /border-color:\s*var\(--ui-border\)/);
  assert.match(railRule, /border-color:\s*var\(--ui-border\)/);
  assert.match(paneHeaderRule, /border-bottom:\s*1px\s+solid\s+var\(--ui-border\)/);
  assert.match(paneHeaderRule, /background:\s*var\(--ui-surface\)/);
  for (const structuralRule of [modePaneRule, railRule, paneHeaderRule]) {
    assert.doesNotMatch(structuralRule, /--workspace-(?:selection|custom)-/, "structural borders must stay independent of Space accent colors");
  }

  assert.ok(maxPxValue(customPropertyValue(layoutRule, "--workspace-rail-width")) <= 180, "desktop rail must remain compact");
  assert.ok(maxPxValue(customPropertyValue(layoutRule, "--workspace-identity-header-height")) <= 56, "pane header must remain compact");
  assert.ok(pxDeclaration(navButtonRule, "min-height") <= 40, "primary navigation rows must remain compact");
  assert.ok(pxDeclaration(spaceSelectorRule, "min-height") <= 48, "Space selector must remain compact");
  assert.match(shellCss, /\.professional-workspace-rail \.workspace-rail-button svg,[\s\S]*?\{[\s\S]*?width:\s*20px;[\s\S]*?height:\s*20px;/);
});

test("Space customization is visible, compact, and separate from structural chrome", () => {
  assert.match(workspaceChromeSource, /workspace-banner-surface space-identity-header/);
  assert.match(workspaceChromeSource, /workspace-pane-banner-image/);
  assert.match(workspaceChromeSource, /workspaceIdentityStyle\(workspaceIdentity\)/);
  assert.match(workspaceChromeSource, /<WorkspaceIconGlyph icon=\{workspaceIdentity\.Icon\}/);
  assert.match(workspaceChromeSource, /data-space-icon=\{workspaceIdentity\.iconName\}/);
  assert.match(workspaceChromeSource, /workspace-appearance-preview/);
  assert.match(workspaceChromeSource, /onResetWorkspace/);
  assert.match(customizationCss, /\.workspace-banner-surface\.banner-none/);

  const bannerHeaderRule = cssRuleBody(customizationCss, ".app-shell .workspace-layout .workspace-mode-pane .professional-pane-header.space-identity-header");
  assert.match(bannerHeaderRule, /border-bottom:\s*1px\s+solid\s+var\(--ui-border\)/);
  assert.doesNotMatch(bannerHeaderRule, /height:\s*(?:[6-9]\d|\d{3,})px/);
  assert.match(customizationCss, /\.professional-appearance-surface/);
  assert.match(customizationCss, /\.workspace-banner-position-control/);

  assert.match(foundationCss, /--workspace-ui-font:\s*var\(--workspace-font-family/);
  assert.doesNotMatch(foundationCss, /--workspace-font-size:/, "the professional layer must not override the user's text-size preference");
  assert.doesNotMatch(desktopSettingsSource, /from\s+["']lucide-react["']/);
  assert.match(desktopSettingsSource, /from\s+["']@fluentui\/react-icons["']/);
});

async function readRenderer(relativePath: string): Promise<string> {
  return readFile(join(rendererRoot, relativePath), "utf8");
}

function constArrayBody(source: string, constName: string): string {
  const match = source.match(new RegExp(`const\\s+${escapeRegExp(constName)}[\\s\\S]*?=\\s*\\[([\\s\\S]*?)\\n\\s*\\];`));
  assert.ok(match, `could not find ${constName} array`);
  return match[1];
}

function functionBody(source: string, functionName: string): string {
  const match = source.match(new RegExp(`function\\s+${escapeRegExp(functionName)}\\s*\\([^)]*\\)\\s*:[^{]+\\{([\\s\\S]*?)\\n\\}`));
  assert.ok(match, `could not find ${functionName} function`);
  return match[1];
}

function staticClassTokens(source: string): Set<string> {
  return new Set(
    [...source.matchAll(/className="([^"]+)"/g)]
      .flatMap((match) => match[1].split(/\s+/))
      .filter(Boolean),
  );
}

function hasClassSelector(css: string, className: string): boolean {
  return new RegExp(`\\.${escapeRegExp(className)}(?=\\s|[.#:>+~,{\\[]|\\))`).test(css);
}

function cssRuleBody(css: string, selector: string): string {
  const selectorIndex = css.indexOf(selector);
  assert.ok(selectorIndex >= 0, `could not find CSS selector: ${selector}`);
  const openBraceIndex = css.indexOf("{", selectorIndex);
  const closeBraceIndex = css.indexOf("}", openBraceIndex);
  assert.ok(openBraceIndex >= 0 && closeBraceIndex > openBraceIndex, `could not read CSS rule: ${selector}`);
  return css.slice(openBraceIndex + 1, closeBraceIndex);
}

function customPropertyValue(ruleBody: string, property: string): string {
  const match = ruleBody.match(new RegExp(`${escapeRegExp(property)}:\\s*([^;]+);`));
  assert.ok(match, `could not find ${property}`);
  return match[1];
}

function maxPxValue(value: string): number {
  const values = [...value.matchAll(/(\d+(?:\.\d+)?)px/g)].map((match) => Number(match[1]));
  assert.ok(values.length > 0, `expected a pixel value in: ${value}`);
  return Math.max(...values);
}

function pxDeclaration(ruleBody: string, property: string): number {
  const match = ruleBody.match(new RegExp(`${escapeRegExp(property)}:\\s*(\\d+(?:\\.\\d+)?)px\\s*;`));
  assert.ok(match, `could not find pixel declaration ${property}`);
  return Number(match[1]);
}

function stripCssComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
