import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

const rendererRoot = join(process.cwd(), "web-local", "src");

const [
  appSource,
  workspaceChromeSource,
  workspacePanesSource,
  workspaceIdentitySource,
  foundationCss,
  shellCss,
  legacyCss,
  surfacesCss,
  customizationCss,
  desktopSettingsSource,
  capabilitiesSource,
] = await Promise.all([
  readRenderer("App.tsx"),
  readRenderer("components/panes/workspaceChrome.tsx"),
  readRenderer("components/panes/workspacePanes.tsx"),
  readRenderer("lib/workspace-identity.ts"),
  readRenderer("professional-foundation.css"),
  readRenderer("professional-shell.css"),
  readRenderer("styles.css"),
  readRenderer("professional-surfaces.css"),
  readRenderer("professional-customization.css"),
  readRenderer("components/modals/DesktopSettingsModal.tsx"),
  readRenderer("components/panes/CapabilitiesPane.tsx"),
]);

test("Files is the first primary surface and Space remains the root selector", () => {
  const primaryItems = constArrayBody(workspaceChromeSource, "primaryItems");
  const primaryModes = [...primaryItems.matchAll(/mode:\s*"([^"]+)"/g)].map((match) => match[1]);

  assert.deepEqual(primaryModes, ["files", "capabilities", "chats", "library", "history"]);
  assert.doesNotMatch(primaryItems, /mode:\s*"workspaces"/);

  const selectorIndex = workspaceChromeSource.indexOf("workspace-rail-space-selector");
  const primaryRenderIndex = workspaceChromeSource.indexOf("primaryItems.map");
  assert.ok(selectorIndex >= 0, "the rail must expose a distinct Space selector");
  assert.ok(primaryRenderIndex > selectorIndex, "the Space selector must render before primary surfaces");
  assert.match(workspaceChromeSource, /onModeChange\("workspaces"\)/);
  assert.match(workspaceChromeSource, /workspace-rail-space-copy"><strong>\{workspaceLabel\}<\/strong>/);
  assert.doesNotMatch(workspaceChromeSource, /<span>Space<\/span>|ChevronRight20Regular|workspace-rail-space-caret/);
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
    "BookToolbox20",
  ];
  for (const icon of requiredNavPairs) {
    assert.match(workspaceChromeSource, new RegExp(`\\b${icon}Regular\\b`), `${icon} needs a regular state`);
    assert.match(workspaceChromeSource, new RegExp(`\\b${icon}Filled\\b`), `${icon} needs a filled active state`);
  }

  assert.match(workspaceChromeSource, /professional-workspace-rail/);
  assert.doesNotMatch(workspaceChromeSource, /aria-label="Assistant"/);
  assert.doesNotMatch(workspaceChromeSource, /mode:\s*"setup"/);
  assert.doesNotMatch(workspaceChromeSource, /<Bot\w*[^>]*>.*Assistant/s);
});

test("Skills and Extensions share one styled Capabilities destination", () => {
  const primaryItems = constArrayBody(workspaceChromeSource, "primaryItems");
  assert.match(primaryItems, /mode:\s*"capabilities"[\s\S]*?label:\s*"Capabilities"/);
  assert.doesNotMatch(primaryItems, /mode:\s*"skills"|mode:\s*"extensions"/);
  assert.match(appSource, /value === "skills" \|\| value === "extensions"\) return "capabilities"/);
  assert.match(appSource, /activeMode === "capabilities"[\s\S]*?<CapabilitiesPane/);
  assert.match(capabilitiesSource, /Installed[\s\S]*Discover/);
  assert.match(capabilitiesSource, /Search installed capabilities/);
  assert.match(capabilitiesSource, /Skills[\s\S]*Extensions/);
  assert.match(capabilitiesSource, /Personal[\s\S]*This Space/);
  assert.match(capabilitiesSource, /capabilities\/details\?id=/);
  assert.match(capabilitiesSource, /capabilities\/install/);
  assert.match(capabilitiesSource, /capabilities-view-tabs[\s\S]*?view === "installed" \? \([\s\S]*?capabilities-installed-panel/);
  assert.match(capabilitiesSource, /view === "installed" \? \([\s\S]*?capabilities-installed-panel[\s\S]*?: \([\s\S]*?capabilities-discover-panel/);
  assert.match(capabilitiesSource, /addOpen \? \([\s\S]*?<AddCapabilityDialog/);
  assert.doesNotMatch(capabilitiesSource, /<section className="professional-card capabilities-add-panel"/);
  assert.match(capabilitiesSource, /<CoreToolsSection tools=\{catalog\.tools\} management=\{catalog\.toolManagement\}/);
  assert.match(capabilitiesSource, /tool\.core === true \|\| tool\.kind === "core"/);
  assert.match(capabilitiesSource, /These tools ship with Pi\. New Chats start with the defaults below/);
  assert.match(capabilitiesSource, /On in new Chats[\s\S]*Available to Chats/);
  assert.doesNotMatch(capabilitiesSource, /active\s*·[\s\S]*available tools/i);
  assert.match(capabilitiesSource, /setTypeFilter\("all"\);[\s\S]*setScopeFilter\("all"\);[\s\S]*selectView\("installed"\)/);
  assert.match(capabilitiesSource, /ArrowRight[\s\S]*ArrowLeft[\s\S]*Home[\s\S]*End/);
  assert.doesNotMatch(capabilitiesSource, /from\s+["']lucide-react["']/);

  for (const className of [
    "capabilities-pane",
    "capabilities-view-tabs",
    "capabilities-view-content",
    "capabilities-add-panel",
    "capabilities-toolbar",
    "capabilities-search",
    "capabilities-resource-card",
    "capabilities-discover-card",
    "capability-dialog",
    "capability-review-facts",
    "capability-code-warning",
    "capabilities-core-tools",
  ]) {
    assert.equal(hasClassSelector(surfacesCss, className), true, `Capabilities class .${className} must be styled`);
  }
  for (const className of [...staticClassTokens(capabilitiesSource)].filter((name) => /^capabilit(?:y|ies)-/.test(name))) {
    assert.equal(hasClassSelector(surfacesCss, className), true, `Static Capabilities class .${className} must be styled`);
  }
  assert.match(surfacesCss, /@container workspace-pane \(max-width: 520px\)[\s\S]*?\.capabilities-resource-card/);
  assert.match(surfacesCss, /@media \(max-width: 600px\)[\s\S]*?\.capability-dialog/);
});

test("Assistant configuration lives in Settings instead of the rail", () => {
  assert.match(desktopSettingsSource, /id:\s*"assistant"[\s\S]*?label:\s*"Assistant"/);
  assert.match(desktopSettingsSource, /<AssistantSetupPane[\s\S]*?embedded/);
  assert.match(appSource, /openSettings\("assistant"\)/);
  assert.doesNotMatch(appSource, /activeMode\s*===\s*"setup"/);
  assert.doesNotMatch(workspaceChromeSource, /Assistant ·/);
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

test("professional shell keeps compact navigation and the persistent Space identity header", () => {
  const layoutRule = cssRuleBody(shellCss, ".app-shell .workspace-layout");
  const modePaneRule = cssRuleBody(shellCss, ".app-shell .workspace-layout .workspace-mode-pane");
  const railRule = cssRuleBody(shellCss, ".app-shell .professional-workspace-rail");
  const navButtonRule = cssRuleBody(shellCss, ".app-shell .professional-workspace-rail .workspace-rail-button");
  const spaceSelectorRule = cssRuleBody(shellCss, ".app-shell .professional-workspace-rail .workspace-rail-space-selector");
  const compactShellCss = shellCss.slice(shellCss.indexOf("@media (max-width: 820px)"));
  const compactSpaceSelectorRule = cssRuleBody(compactShellCss, ".app-shell .professional-workspace-rail .workspace-rail-space-selector");
  const compactSpaceCopyRule = cssRuleBody(compactShellCss, ".app-shell .professional-workspace-rail .workspace-rail-space-copy");
  const compactSpaceNameRule = cssRuleBody(compactShellCss, ".app-shell .professional-workspace-rail .workspace-rail-space-copy strong");
  const shortDesktopShellCss = shellCss.slice(shellCss.indexOf("@media (max-height: 720px)"));
  const shortDesktopRailRule = cssRuleBody(shortDesktopShellCss, ".app-shell .professional-workspace-rail");
  const paneHeaderRule = cssRuleBody(shellCss, ".app-shell .workspace-layout .workspace-mode-pane .professional-pane-header");
  const spacesPaneRule = cssRuleBody(surfacesCss, ".workspace-pane-content.professional-spaces");

  assert.match(modePaneRule, /border-color:\s*var\(--ui-border\)/);
  assert.match(railRule, /border-color:\s*var\(--ui-border\)/);
  assert.match(paneHeaderRule, /border:\s*1px\s+solid\s+var\(--ui-border\)/);
  assert.match(paneHeaderRule, /background:\s*var\(--ui-surface\)/);
  for (const structuralRule of [modePaneRule, railRule, paneHeaderRule]) {
    assert.doesNotMatch(structuralRule, /--workspace-(?:selection|custom)-/, "structural borders must stay independent of Space accent colors");
  }

  assert.ok(maxPxValue(customPropertyValue(layoutRule, "--workspace-rail-width")) <= 180, "desktop rail must remain compact");
  assert.equal(maxPxValue(customPropertyValue(layoutRule, "--workspace-identity-header-height")), 90, "the Space banner must retain its established 90px geometry");
  assert.ok(pxDeclaration(navButtonRule, "min-height") <= 40, "primary navigation rows must remain compact");
  assert.match(spaceSelectorRule, /height:\s*var\(--workspace-identity-header-height\)/, "the root Space selector must align with the identity banner");
  assert.match(spaceSelectorRule, /border-radius:\s*var\(--workspace-identity-radius\)/, "the root Space selector and banner must share a silhouette");
  assert.match(spaceSelectorRule, /grid-template-columns:\s*minmax\(0,\s*1fr\)/, "the desktop Space identity must use a centered single-column lockup");
  assert.match(spaceSelectorRule, /grid-template-rows:\s*auto\s+auto/);
  assert.match(spaceSelectorRule, /place-items:\s*center/);
  assert.match(layoutRule, /--workspace-identity-glyph-size:\s*26px/, "the Space identity glyph should carry slightly more visual weight");
  assert.match(layoutRule, /--workspace-identity-rail-label-size:\s*14px/);
  assert.match(layoutRule, /--workspace-identity-title-size:\s*17px/);
  assert.match(layoutRule, /--workspace-identity-tracking:\s*0\.01em/);
  assert.match(shortDesktopRailRule, /padding:\s*8px\s+6px\s+6px/, "short desktop layouts must keep the identity selector aligned with the pane banner");
  assert.match(shellCss, /\.workspace-rail-space-copy strong[\s\S]*?-webkit-line-clamp:\s*2/, "the taller Space selector must use its height for longer names");
  assert.match(shellCss, /\.workspace-rail-space-copy strong[\s\S]*?font-size:\s*var\(--workspace-identity-rail-label-size\)[\s\S]*?letter-spacing:\s*var\(--workspace-identity-tracking\)/, "the Space name needs a deliberate display treatment");
  assert.match(compactSpaceSelectorRule, /height:\s*auto/);
  assert.match(compactSpaceSelectorRule, /min-height:\s*46px/);
  assert.match(compactSpaceSelectorRule, /grid-template-columns:\s*28px\s+minmax\(0,\s*1fr\)/, "the narrow rail must retain its horizontal lockup");
  assert.match(compactSpaceSelectorRule, /grid-template-rows:\s*none/);
  assert.match(compactSpaceSelectorRule, /place-items:\s*center\s+start/);
  assert.match(compactSpaceCopyRule, /justify-items:\s*start/);
  assert.match(compactSpaceCopyRule, /text-align:\s*left/);
  assert.match(compactSpaceNameRule, /white-space:\s*nowrap/);
  assert.match(compactSpaceNameRule, /-webkit-line-clamp:\s*unset/);
  assert.match(spacesPaneRule, /scrollbar-gutter:\s*auto/, "the Spaces pane must not reserve a dead right-side gutter");
  assert.match(shellCss, /\.professional-workspace-rail \.workspace-rail-button svg,[\s\S]*?\{[\s\S]*?width:\s*20px;[\s\S]*?height:\s*20px;/);
});

test("Space customization is visible, compact, and separate from structural chrome", () => {
  assert.match(workspaceChromeSource, /"workspace-banner-surface"/);
  assert.match(workspaceChromeSource, /"space-identity-header"/);
  assert.match(workspaceChromeSource, /workspace-pane-banner-image/);
  assert.match(workspaceChromeSource, /workspaceIdentityStyle\(workspaceIdentity\)/);
  assert.match(workspaceChromeSource, /<WorkspaceIconGlyph icon=\{workspaceIdentity\.Icon\}/);
  assert.match(workspaceChromeSource, /data-space-icon=\{workspaceIdentity\.iconName\}/);
  assert.match(workspaceChromeSource, /workspace-appearance-preview/);
  assert.match(workspaceChromeSource, /onResetWorkspace/);
  assert.match(customizationCss, /\.workspace-banner-surface\.banner-none/);

  const bannerHeaderRule = cssRuleBody(customizationCss, ".app-shell .workspace-layout .workspace-mode-pane .professional-pane-header.space-identity-header");
  const bannerTitleRule = cssRuleBody(customizationCss, ".app-shell .professional-pane-header.space-identity-header .workspace-pane-current-lockup strong");
  const previewTitleRule = cssRuleBody(customizationCss, ".workspace-appearance-preview-copy strong {");
  const railIconRule = cssRuleBody(customizationCss, ".app-shell .professional-workspace-rail .workspace-rail-space-avatar");
  const darkRailIconRule = cssRuleBody(customizationCss, ".app-shell[data-theme=\"dark\"] .professional-workspace-rail .workspace-rail-space-selector .workspace-rail-space-avatar");
  assert.match(bannerHeaderRule, /border:\s*1px\s+solid\s+var\(--ui-border\)/);
  assert.match(bannerTitleRule, /line-height:\s*1\.3/);
  assert.match(bannerTitleRule, /font-size:\s*var\(--workspace-identity-title-size\)/);
  assert.match(bannerTitleRule, /letter-spacing:\s*var\(--workspace-identity-tracking\)/, "the identity title should read as a deliberate display label without replacing the selected font");
  assert.match(previewTitleRule, /font-size:\s*var\(--workspace-identity-title-size\)/, "the appearance preview must match the live identity title scale");
  assert.match(previewTitleRule, /letter-spacing:\s*var\(--workspace-identity-tracking\)/);
  assert.match(bannerTitleRule, /padding-block:\s*2px/, "identity titles need descender-safe line boxes");
  for (const identityIconRule of [railIconRule, darkRailIconRule]) {
    assert.match(identityIconRule, /background:\s*transparent/, "identity glyphs must not sit on filled tiles");
  }
  assert.doesNotMatch(workspaceChromeSource, /space-identity-header-icon|workspace-appearance-preview-icon/);
  assert.doesNotMatch(customizationCss, /space-identity-header-icon|workspace-appearance-preview-icon/);
  assert.match(darkRailIconRule, /box-shadow:\s*none/, "legacy dark-theme decoration must not recreate an icon tile");
  assert.match(customizationCss, /\.professional-appearance-surface/);
  assert.match(customizationCss, /\.workspace-banner-position-control/);
  assert.match(customizationCss, /\.professional-workspace-rail \.workspace-rail-button\.active[\s\S]*?box-shadow:\s*inset 3px 0 0 var\(--workspace-custom-color\)/);
  assert.match(customizationCss, /\.professional-spaces \.workspace-card-shell\.active[\s\S]*?background:\s*var\(--workspace-custom-color-soft\)/);
  assert.match(customizationCss, /\.professional-chats \.chat-workspace-heading > span:first-child[\s\S]*?color:\s*var\(--workspace-custom-color\)/);
  assert.doesNotMatch(
    appSource,
    /normalizeWorkspaceCustomizations\(customizationsRef\.current,\s*new Set\(workspaces/,
    "temporarily missing or moved Spaces must keep their identity until an explicit removal",
  );

  assert.match(foundationCss, /--workspace-ui-font:\s*var\(--workspace-font-family/);
  assert.doesNotMatch(foundationCss, /--workspace-font-size:/, "the professional layer must not override the user's text-size preference");
  assert.doesNotMatch(desktopSettingsSource, /from\s+["']lucide-react["']/);
  assert.match(desktopSettingsSource, /from\s+["']@fluentui\/react-icons["']/);
});

test("the left header is inherited Space identity on every mode, not a surface title", () => {
  const headerCall = appSource.match(/<WorkspacePaneHeader[\s\S]*?\/>/)?.[0];
  assert.ok(headerCall, "App must render the shared Space identity header");
  const headerIdentityProps = headerCall.split(" action=")[0]!;
  assert.match(headerIdentityProps, /workspace=\{workspace\}/);
  assert.match(headerIdentityProps, /identity=\{identity\}/);
  assert.match(headerIdentityProps, /switchable=\{activeMode !== "workspaces"\}/);
  assert.doesNotMatch(headerIdentityProps, /title=|paneTitle|onCustomize/);

  assert.match(workspaceChromeSource, /<strong>\{workspace\.name\}<\/strong>/);
  assert.match(workspaceChromeSource, /<span className="sr-only">\{detail\}<\/span>/);
  assert.match(workspaceChromeSource, /className="workspace-pane-switch-trigger"/);
  assert.match(workspaceChromeSource, /aria-haspopup="menu"/);
  assert.match(workspaceChromeSource, /role="menu" aria-label="Switch Space"/);
  assert.match(workspaceChromeSource, /role="menuitem"/);
  assert.match(workspaceChromeSource, /querySelector<HTMLButtonElement>\('\[role="menuitem"\]:not\(:disabled\)'\)\?\.focus\(\)/);
  assert.doesNotMatch(workspaceChromeSource, /role=\{switcherEnabled \? "button" : undefined\}/);
  assert.doesNotMatch(workspaceChromeSource, /onClick=\{toggleSwitcher\}[\s\S]{0,180}<WorkspaceIconGlyph/);
  assert.doesNotMatch(workspaceChromeSource, /space-identity-header-icon/);
  assert.doesNotMatch(workspaceChromeSource, /space-identity-header-text/);
  assert.doesNotMatch(workspaceChromeSource, /Customize Space.*professional-header-action/s);
});

test("every left-pane mode keeps content padding below the shared Space banner", () => {
  const headerIndex = appSource.indexOf("<WorkspacePaneHeader");
  const filesContentIndex = appSource.indexOf('activeMode === "files" ? <div className="local-files-panel">');
  const localFilesRule = cssRuleBody(legacyCss, ".local-files-panel");

  assert.ok(headerIndex >= 0 && filesContentIndex > headerIndex, "the Files content wrapper must render below the shared header");
  assert.doesNotMatch(appSource, /activeMode === "files" \? "file-panel local-files-panel"/);
  assert.match(localFilesRule, /flex:\s*1 1 auto/);
  assert.match(localFilesRule, /padding:\s*12px/);
});

test("the appearance preview mirrors the Space header rather than the active surface", () => {
  assert.match(workspaceChromeSource, /workspace-appearance-preview-copy"><strong>\{workspace\.name\}<\/strong>/);
  assert.doesNotMatch(workspaceChromeSource, /workspace-appearance-preview-copy"><strong>Files<\/strong>/);
  assert.match(customizationCss, /\.workspace-appearance-preview\s*\{[\s\S]*?min-height:\s*90px;/);
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
