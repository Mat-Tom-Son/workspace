# Restricted app runtime

Workspace has a second executable lane for apps an agent creates for a Space.
These apps can render arbitrary reviewed web UI in the left navigator and open
normal persistent tabs in the work area. They are intentionally separate from
native Pi Extensions.

For the exact package format, manifest template, bridge methods, worker
exports, denial handling, and hands-on workflow, use the canonical
[Restricted app authoring guide](restricted-app-authoring.md).

| Lane | Execution | Intended use |
|---|---|---|
| Native Pi Extension | Full current-user permissions; Pi may evaluate it while building the catalog. | Trusted developer capabilities, commands, providers, and compatibility with the Pi ecosystem. |
| Restricted app package | An exact reviewed revision runs as sandboxed web content with a narrow host bridge. | Agent-created inboxes, dashboards, extractors, and project-service panels with host-mediated powers. |

Restricted packages must never declare `pi.extensions`, use Pi's package
installer, or appear in Pi's loaded Extension catalog. Pi imports Extension
modules and calls their factories during catalog loading, which would cross the
restricted execution boundary before the app opened.

## Package contract

`agent-app.json` is strict and versioned. It declares:

- a required `sandboxed-web` HTML entry;
- an optional JavaScript worker entry for Assistant tools and named
  automations;
- optional UI metadata such as a rail icon;
- bounded Assistant tool declarations using a closed JSON Schema subset; and
- exact broker destinations, methods, and acceptable authentication modes;
- reviewed Space-file needs (`file` or `directory`, `read` or `read-write`);
- optional static notification categories, each with reviewed title and body;
  and
- a required `automations` array containing zero to sixteen independently
  controlled named interval jobs. Each job declares its handler, schedule,
  catch-up policy, overlap policy, and an exact subset of the app's reviewed
  network, file, and notification permissions.

Public destinations use `{ "kind": "public-https", "origin": "https://api.example.com" }`.
Local development services use an explicit numeric target such as
`{ "kind": "loopback-http", "host": "127.0.0.1", "port": 4317 }`.
Loopback targets do not use DNS, cannot redirect, and cannot receive saved
credentials. Workspace verifies the numeric address and port, but does not yet
verify which local process owns that port; the UI states that limitation when
access is granted.

Public auth declarations can use `none`, `api-key`, `bearer`, `basic`, or
`oauth2-pkce`. Manifests contain no secret values. OAuth declarations contain
only a public HTTPS issuer, an existing public native-client id, and scopes.
Workspace does not accept client secrets, arbitrary authorization/token
endpoints, OIDC scopes, or device-code declarations in this lane. Generated
apps cannot create a provider registration; provider-specific convenience
connections require a future Workspace-owned adapter and registration.

The package inspector never invokes npm, imports package code, or runs lifecycle
scripts. It rejects scripts, binaries, workspaces, native build flags, Pi
declarations, unsafe paths, links, missing entries, unknown powers, and
oversized content. Dependency metadata is permitted because an agent may use a
normal frontend toolchain, but Workspace never resolves or installs it: all
runtime assets must already be present in the reviewed package.

Files are copied into application storage under a SHA-256 content digest and
verified again. Installation requires the exact digest returned by inspection.
Machine-local receipts are keyed by Space and app id. Source edits after
installation do not change the installed revision.

```text
connected-inbox/
├── package.json
├── agent-app.json
├── index.html
├── app.js
├── styles.css
└── worker.js       # optional; required for tools, automations, or notifications
```

The checked-in [connected inbox app](../examples/packages/restricted-connected-inbox/README.md)
is an interactive reference package with a separate ordinary loopback demo
service. Workspace does not launch or trust that developer process.

## Visible app host

The trusted Workspace renderer owns only a placeholder rectangle and app
identity. Electron main verifies the installed Space/app/digest tuple, snapshots
the staged package, and mounts a `WebContentsView` in the main window. Every
mount gets a separate ephemeral session and origin.

The view has Chromium sandboxing and context isolation enabled, with Node,
webviews, popups, downloads, dialogs, permissions, direct network access,
navigation, workers, frames, service workers, and file selection denied. Its
CSP permits only reviewed same-origin scripts, styles, images, and fonts. Native
view bounds and visibility follow the owning DOM placeholder; inactive tabs,
hidden windows, minimization, and modal occlusion detach the native view while
leaving its renderer alive.

The preload exposes only `workspaceRestrictedApp`:

- `context.get()` and `context.onChanged()` report placement (`navigator` or
  `tab`), route, host-owned app identity, theme, active state, and bounded tab
  state;
- `tabs.open(...)` asks Workspace to create or activate a Space-owned work tab;
- a tab may update or close itself;
- `request(...)` sends a declared request through the network broker;
- `storage` provides Space-and-app-owned JSON data and active-UI invalidation
  hints;
- `files` lists, reads, or writes only through current reviewed grants; and
- `notifications.show({ permissionId })` selects reviewed static copy, only
  during an enabled automation invocation whose permission subset includes a
  separately granted category.

An app supplies a local `appTabId`, title, route, and JSON state. It never
supplies the owning Space, app id, digest, or shell tab id. Workspace derives
those values from the sending `WebContents` and constructs
`restricted-app:<space>:<app>:<digest>:<appTabId>`. App tabs use the same shell
storage, cross-Space activation, close behavior, and most-recent-tab restoration
as built-in tabs. An updated or removed revision cannot silently take over a
persisted old tab.

## Worker host

Apps that expose Assistant tools or automations declare a separate worker
module. Workspace loads it in a hidden sandboxed renderer with the same
direct-network and Node denials. Inputs and outputs are schema checked and
bounded; timeouts, crashes, cyclic values, intrinsic tampering, and oversized
results terminate the worker. The worker is optional so a UI-only app does not
need executable worker code.

Automations are first-class host jobs, not one app-wide background switch.
Every declared job starts disabled and is enabled separately in Capabilities.
The worker exports `handleAutomation(event)` and dispatches using the reviewed
`automationId` and `handler`. Intervals are whole minutes from 15 through
1,440. `catchUp: "latest"` permits at most one deterministically staggered run
for the latest missed occurrence after startup or resume; `"none"` skips missed
occurrences. `overlap` is currently fixed to `"skip"`.

One machine-wide `WorkspaceAutomationService` owns scheduling across every
Space and restricted app. It uses a FIFO queue, at most two active jobs, and
never overlaps the same named job. Scheduled, manual, skipped, cancelled, and
failed attempts produce durable run receipts. The cadence anchor is persisted
separately from one-off manual runs, so **Run now** does not shift the next
scheduled occurrence. A manual run is allowed while its schedule is disabled,
but it receives no notification authority. At launch, Workspace re-reads the
installed digest and current grants, then intersects those grants with that
job's reviewed permission subset. Disabling, updating, removing, sleeping, or
quitting stops stale launches before authority changes take effect.

Notifications are host-owned Windows notifications, not arbitrary renderer
UI. The manifest title and category copy are single-line reviewed text; the
runtime cannot add dynamic copy, actions, or URLs. A category grant, an enabled
automation, and inclusion in that automation's permission subset are all
required. The host limits each invocation,
category frequency, hourly app volume, and outstanding notifications. Rate
history is keyed by Space and app so renderer restarts, permission churn, and
digest updates cannot reset the anti-spam budget. Clicking revalidates the
current digest, declaration, grant, and automation authority before opening
the exact owning Space and app. Suspend, disable, update, removal, and shutdown
close outstanding notifications.

The real-Electron preparation probe covers both hosts: missing Node globals,
rejected Node imports, direct loopback HTTP/WebSocket denial, WebRTC and popup
denial, sender-bound broker failure, bounded results, timeout recovery, visible
UI loading, durable storage, active-only storage invalidation, a
History-covered Space-file write, automation execution, static notification
delivery and cleanup, and an app-requested host-owned tab.

## Network and credentials

Connections live in a separate operating-system-encrypted store outside the
Space and provider AuthStorage. A binding includes Space, app, digest,
destination id, and canonical target origin. Apps receive status and errors,
not secret values.

OAuth PKCE uses RFC 8414 discovery, S256, a random one-shot loopback callback,
state and verifier checks, the system browser, encrypted token storage, and
serialized refresh with refresh-token rotation. The same public-HTTPS broker
validates and pins discovery and token endpoints. Access and refresh tokens are
never returned to app JavaScript.

For public HTTPS, the broker enforces method, exact origin, bounded same-origin
redirects, public DNS resolution, approved-address pinning, TLS verification,
header stripping, credential injection, byte limits, and deadlines. For numeric
loopback HTTP, it bypasses DNS, connects only to the declared address and port,
rejects redirects, permits anonymous auth only, and applies the same method,
header, byte, and deadline controls. Direct renderer networking remains off in
both cases.

## Storage and Space files

Every installed app has bounded, machine-local JSON storage keyed by Space and
app id. The default limits are 5 MiB, 512 keys, 128 KiB per value, and bounded
atomic transactions with revision checks. It survives renderer replacement and
reviewed digest updates, is never placed in the Space, and is deleted when the
app or Space is removed.

Active visible UI may subscribe to bounded `storage.onChanged` invalidation
hints. The host coalesces keys, caps the list (falling back to `reset: true`),
and emits at most ten times per second. Hints are briefly coalesced in memory,
never durably queued or replayed, and are never delivered to workers, inactive
or occluded views, minimized windows,
or a view owned by another Space. Apps re-read storage after a hint; event data
is not a second state channel.

A file declaration grants nothing by itself. In Capabilities, the person maps
it to a relative file or folder inside that app's Space. The sandbox sends only
the grant id and a grant-relative path; the host derives Space/app/digest and
the selected root. The broker rejects absolute paths, traversal, links and
junction escapes, alternate data streams, `.workspace`, `.pi`, oversized
operations, and authority beyond the declaration. Writes are atomic and create
a targeted History checkpoint. Revocation or a digest update stops current app
hosts and removes the grant; uninstall never deletes or rewrites Space files.

## Review and lifecycle

The primary path starts in a Space Chat. The host-owned `propose_space_app`
tool accepts only a Space-relative package folder, inspects it, and creates a
machine-local review receipt bound to that Space, Chat, source path, and digest.
The tool cannot execute or install code, grant a destination, or collect a
credential. Its model-facing guidelines include the complete package, bridge,
worker, permission, storage, file, tab, automation, and OAuth declaration
contract, so app generation does not depend on a source checkout or hidden
Workspace-only skill.

Human approval installs the receipt's exact revision with network, file, and
notification access off and every automation disabled. Source changes require
a new review.
**Capabilities → Installed → Apps in this Space** manages destination, file,
and notification grants, connections, each automation's schedule and run
history, local data, and removal; advanced
local install remains a recovery/developer path. A reviewed update preserves
app storage but resets network grants, file grants, notification grants,
connections, every automation, and prior run receipts. Removing or updating an
app stops its UI views and worker before
changing staged bytes.

The restricted app itself appears directly in the contributed rail. Selecting
it mounts its navigator; the app decides which persistent work tabs to open.
This is not a `surface.json` contribution. `surface.json` remains the separate,
static compatibility lane for full-trust Pi Extensions.

## Remaining host capabilities

The web canvas and tab model are intentionally general; new product powers
should be narrow host services rather than additions to a fixed widget schema.
The main gaps are:

- host-owned remote subscriptions and arbitrary push adapters (static reviewed
  automation notifications are available);
- a Space-service registry that can verify process ownership and lifecycle,
  replacing raw loopback-port grants for managed project services; and
- finer resource controls for long-running or memory-heavy web apps.

A verified Space-service target is deliberately not exposed yet. An honest
implementation needs a trusted Workspace launcher/process authority outside the
renderer and local API, per-instance secret challenge, and generation-aware
lifecycle. Treating any listener on a reviewed port as owned would only rename
the existing raw-loopback limitation.

Chromium still carries browser-engine exploit and denial-of-service risk.
Electron updates, sender validation, package review, and the real-runtime probe
remain release requirements.
