# Desktop experience parity

Workspace is a product extraction of the mature Kai Workspace desktop experience, not a new interface inspired by it. The neutral desktop interaction model from `win-kymadocs` commit `57ff910` is the behavioral baseline. Product-specific integrations and language may be replaced, but the general-purpose interaction quality should be preserved.

## Product translation

| Baseline concept | Workspace concept |
| --- | --- |
| Workspace backed by a local SharePoint mirror | Space backed directly by an ordinary folder |
| Kits | Skills |
| Sources | Library |
| Microsoft organization login | Assistant setup using Pi providers |
| Kai | Assistant |
| SharePoint sync and publish | Local files first; cloud-synced folders work through their desktop clients |

The translation is intentionally narrow. It does not justify replacing the shell, tabs, file interactions, chat experience, desktop integration, or accessibility behavior.

## Required interaction model

### Persistent surface tabs

- Chat, file, History, and appearance surfaces open as tabs instead of route-only panes.
- Tabs persist and restore across application restarts.
- Each tab retains its Space identity; activating a tab from another Space activates that Space.
- Each Space remembers its most recently active tab.
- Existing conversations deduplicate to one tab while multiple unsent New Chat drafts remain possible.
- Renamed conversations update their tab titles.
- Moving or renaming a file retargets its open tab; deleting it closes the affected tab.
- Closing a tab selects the adjacent tab predictably.
- Arrow keys, Home, and End navigate the tab strip with correct focus and ARIA tab semantics.
- Inactive tab panels remain mounted when needed so drafts, scroll position, and transient UI state survive tab switches.

### Desktop shell

- Preserve the custom title bar and File, Edit, View, and Help menus.
- Preserve window size, position, maximized state, theme integration, and renderer recovery behavior.
- Closing the window may hide Workspace to the system tray when the preference is enabled; explicit Quit exits cleanly.
- The tray exposes clear Show and Quit actions and does not strand an invisible process.
- Update status and commands remain available from both the desktop menu and settings surface.

### Files and folders

- The Files rail item, resizable file pane, search, expandable tree, file-type icons, details pane, and file history remain first-class for the selected Space.
- Right-click actions are available throughout the file tree and use native desktop context behavior where appropriate.
- Supported actions include open, reveal in Explorer/Finder, copy path, attach to chat, rename, move, upload/import, delete, and version history. File and folder creation controls should appear only when the corresponding workflow is implemented and verified.
- Desktop drag-out, file opening, and reveal operations use safe workspace-relative paths and never escape the Space root.
- Destructive actions require clear confirmation and preserve recovery/history behavior where supported.
- Registering an existing folder as a Space never moves or converts user files. It maintains only the documented hidden `.workspace/` identity and conversation layer; that layer and native `.pi/` configuration never appear as ordinary Files.

### Chat and navigation

- Preserve conversation history, rename, drafts, streaming activity, tool/runtime detail, stop behavior, context attachments, copy actions, suggested prompts, and extension UI requests.
- Preserve the command palette, keyboard shortcuts, toast/confirm feedback, onboarding, Space creation/linking, themes, typography, and resizable layout.
- A dedicated Space selector chooses the root-folder entity. Primary navigation uses `Files`, `Capabilities`, `Chats`, `Library`, and `History`. Capabilities combines Installed and Discover views for Skills and Extensions while retaining scope, provenance, load state, diagnostics, and package lifecycle. Provider, model, API-key, and OAuth setup lives in `Settings → Assistant`.

## Deliberately removed or replaced

- Microsoft/Azure organization authentication and organization-account UI.
- SharePoint mirror, publish, readiness, and controlled-document semantics.
- Compliance/SOP-specific review surfaces and Kymanox/Kai branding.
- Company signing credentials and compatibility identifiers that are not needed by the separate Workspace product.

Pi remains the agent runtime. Workspace should expose Pi's provider setup, standard built-in tools, Skills, Extensions, packages, project trust, and supported extension UI without inventing a second capability system.

## Acceptance evidence

A corrective port is ready for release only when all of the following are true:

1. The original and Workspace fixture screens have been captured at the same viewport and reviewed side by side.
2. Tabs have been exercised for restore, multiple drafts, cross-Space activation, rename, move, delete, close fallback, and keyboard navigation.
3. File-tree context actions and native open/reveal/drag behavior have been exercised against a disposable Space.
4. Custom menus, close-to-tray, Show, Quit, window-state restore, and updater surfaces have been exercised in packaged Electron.
5. Type checks, tests, renderer build, desktop compile/preflight, and a packaged smoke build pass on the supported Node runtime.
6. The app contains no user-facing Kai, Kymanox, Kits, Sources, SharePoint, or Microsoft-login copy except in migration or historical documentation.
7. No public release is published until the side-by-side product review is accepted.

## Corrective candidate status

The first July 10, 2026 local candidate at commit `71e5fa4` was rejected after real screenshots exposed two release-blocking defects: it called the Files surface “Space,” and several newly written pane structures had no matching styles. That build must not be shipped or treated as visual-parity evidence.

The corrective candidate must retain the verified desktop behaviors above while also satisfying [the Workspace visual system](visual-design.md). In particular, browser review must cover every primary and Assistant surface in light and dark themes at the true minimum window size and at a tall desktop aspect ratio. Automated checks must guard the Files/Space distinction, the single Fluent shell-icon contract, compact neutral chrome, and the JSX-to-CSS contracts that were previously missing.

Acceptance item 7 remains intentionally open. The corrected version 0.2.1 candidate has not been pushed, tagged, published, or installed over the existing application.
