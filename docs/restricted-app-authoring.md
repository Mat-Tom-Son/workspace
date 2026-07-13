# Restricted app authoring

This is the canonical package and bridge reference for Space apps that run in
Workspace's restricted web runtime. Read [Restricted app runtime](restricted-app-runtime.md)
for the security architecture, lifecycle boundaries, and remaining host gaps.

Restricted apps are not native Pi Extensions. They are prebuilt HTML, CSS, and
JavaScript packages that Workspace inspects without evaluation, pins to an
exact content digest, and runs in separate sandboxed Chromium hosts. Never add
`pi.extensions` or install one through Pi's package manager.

The checked-in [Connected inbox](../examples/packages/restricted-connected-inbox/README.md)
is the reference implementation. The separate
[full-trust Connected inbox](../examples/packages/connected-inbox/README.md)
shows the native Pi Extension lane and is intentionally not a sandbox example.

## Normal creation and installation

The normal product path begins in a Chat belonging to the target Space:

1. Ask the Assistant to build the app. It writes a complete package into an
   ordinary visible folder inside that Space.
2. The Assistant calls the host-owned `propose_space_app` tool with only the
   Space-relative package folder.
3. Workspace inspects the package without running JavaScript, computes its
   digest, and creates a review bound to the Space, Chat, source folder, and
   exact bytes.
4. Review and install that digest in the owning Chat. Proposal does not install
   code, grant a permission, or collect a credential.
5. Manage the installed app under **Capabilities → Installed → Apps in this
   Space**. Network destinations, file targets, notification categories,
   connections, and background work are separate grants.

**Advanced local install** in that Capabilities section is the developer and
recovery path for a completed package already inside the current Space. It
does not replace the Chat-bound proposal and review flow for agent-created
apps.

## Package layout

A small package can remain dependency-free:

```text
my-space-app/
├── package.json
├── agent-app.json
├── index.html
├── app.js
├── styles.css
└── worker.js       # required for tools, background work, or notifications
```

`package.json` identifies the data-only manifest and declares ESM:

```json
{
  "name": "my-space-app",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "agentApp": "agent-app.json"
}
```

Workspace requires `name`, `version`, `type: "module"`, and `agentApp`. It
rejects package `scripts`, `bin`, `workspaces`, `gypfile`, and `pi` fields.
Dependency metadata may describe the toolchain that produced the assets, but
Workspace never runs npm or installs those dependencies. Bundle every runtime
asset into the reviewed directory before proposing it. Package roots and files
must be ordinary files and directories, not links or junctions.

The package limits are 2,048 files, 50 MiB total, 20 MiB per file, a 512 KiB
app manifest, and 24 directory levels. `package.json` is limited to 64 KiB.

## Complete manifest template

`agent-app.json` is closed and versioned; unknown fields fail review. This
template exercises every current section:

```json
{
  "version": 1,
  "id": "my-space-app",
  "title": "My Space app",
  "description": "A Space-bound app with a connected service.",
  "runtime": {
    "kind": "sandboxed-web",
    "entry": "index.html",
    "worker": "worker.js"
  },
  "ui": {
    "icon": "mail"
  },
  "tools": [
    {
      "name": "search_records",
      "description": "Search records in the connected service.",
      "action": "search",
      "inputSchema": {
        "type": "object",
        "properties": {
          "query": { "type": "string", "maxLength": 500 }
        },
        "required": ["query"],
        "additionalProperties": false
      },
      "resultSchema": {
        "type": "object",
        "properties": {
          "count": { "type": "integer", "minimum": 0 }
        },
        "required": ["count"],
        "additionalProperties": false
      }
    }
  ],
  "background": {
    "intervalMinutes": 30
  },
  "permissions": {
    "network": [
      {
        "id": "records-api",
        "target": {
          "kind": "public-https",
          "origin": "https://api.example.com"
        },
        "methods": ["GET", "POST"],
        "auth": [
          { "kind": "api-key", "header": "x-api-key" },
          { "kind": "bearer" }
        ]
      },
      {
        "id": "project-service",
        "target": {
          "kind": "loopback-http",
          "host": "127.0.0.1",
          "port": 4317
        },
        "methods": ["GET", "POST"],
        "auth": [{ "kind": "none" }]
      }
    ],
    "files": [
      {
        "id": "exports",
        "target": "directory",
        "access": "read-write"
      }
    ],
    "notifications": [
      {
        "id": "refresh-finished",
        "title": "Refresh finished",
        "description": "The background refresh finished. Open Workspace to review the result."
      }
    ]
  }
}
```

Manifest ids use lowercase letters, numbers, and hyphens. `ui` and `tools` are
required even when they contain `{}` and `[]`. `permissions.network` is also
required and may be empty; `files` and `notifications` may be omitted and then
normalize to empty arrays. Tool names may additionally use underscores.

The supported tool-schema subset contains `object`, `array`, `string`,
`number`, `integer`, `boolean`, and `null`, with closed properties, required
keys, one `items` schema, scalar enums, and the declared string, number, and
array bounds. Open-ended or executable schema features are rejected. A worker
is required when `tools` is nonempty. Background intervals are whole minutes
from 15 through 1,440; background work requires a worker. Notification
declarations require both a worker and a background schedule. Notification
title and description are reviewed, bounded, plain single-line text.

Network methods are limited to `GET`, `POST`, `PUT`, `PATCH`, and `DELETE`.
Public targets are exact HTTPS origins. Loopback targets are numeric
`127.0.0.1` or `::1` addresses and cannot receive credentials or follow
redirects.

## Visible UI and content policy

The HTML entry runs with Node disabled and direct networking, navigation,
popups, downloads, dialogs, permissions, workers, frames, service workers, and
file selection denied. Scripts and fonts must come from reviewed same-origin
files. Styles may be same-origin or inline; images may be same-origin or
`data:`. Bundle browser libraries and assets into the package instead of using
a CDN. Use the host bridge for network and Space files.

The preload exposes one frozen global:

```js
const bridge = globalThis.workspaceRestrictedApp;
```

Bridge values and requests must be JSON-compatible and bounded. Do not pass
functions, DOM nodes, cyclic objects, secrets, or host identity fields.

### Context and placement

```js
let context = bridge.context.get();

const unsubscribe = bridge.context.onChanged((next) => {
  context = next;
  document.documentElement.dataset.theme = next.theme;
  render();
});
```

Context contains host-owned `workspaceId`, `appId`, `digest`, and `mountId`,
plus `placement` (`navigator` or `tab`), nullable `appTabId`, origin-relative
`route`, JSON `state`, `theme` (`light` or `dark`), and `active`. Treat identity
as descriptive; the host derives authority from the sending renderer, never
from values supplied back by app code. One UI entry can branch on placement and
route to render a compact left navigator and full work-tab views.

### Space-owned tabs

```js
await bridge.tabs.open({
  tabId: "record:123",
  title: "Record 123",
  route: "/records/123",
  state: { recordId: "123" },
});

// These are valid only from the currently mounted app tab.
await bridge.tabs.update({ title: "Record 123 · edited", route: "/records/123", state: { dirty: true } });
await bridge.tabs.close();
```

`tabId` is app-local and stable; it may use lowercase letters, numbers,
periods, underscores, colons, and hyphens. Routes must begin with one `/` and
remain origin-relative. State is JSON-compatible and limited to 64 KiB. The
app never supplies a Space id, digest, or shell tab id. Opening an existing
app-local id activates or retargets its Space-owned tab.

### Brokered network requests

`bridge.request` and `bridge.network.request` are aliases:

```js
const response = await bridge.request({
  destinationId: "records-api",
  method: "POST",
  path: "/v1/search",
  headers: {
    accept: "application/json",
    "content-type": "application/json"
  },
  body: JSON.stringify({ query: "quarterly" }),
});

if (response.encoding !== "utf8") throw new Error("Expected text");
const value = JSON.parse(response.body);
```

Requests name a reviewed destination, allowed method, and origin-relative
path. `GET` and `DELETE` cannot include a body. Request bodies default to a
128 KiB limit; responses default to 256 KiB and a 15-second deadline. App-set
headers are limited to `accept`, `content-type`, `if-modified-since`, and
`if-none-match`. The response contains `status`, a small safe header map,
`body`, and `encoding` (`utf8` for recognized text types, otherwise `base64`).
The host injects credentials after validation; app code never sets or reads an
authorization secret.

### App storage and invalidation hints

Storage is machine-local and keyed by Space and app id:

```js
const usage = await bridge.storage.usage();
const keys = await bridge.storage.keys("record:");
const current = await bridge.storage.get("record:123"); // undefined when absent

await bridge.storage.set("record:123", { title: "Quarterly" });
await bridge.storage.delete("record:old");

await bridge.storage.transaction({
  expectedRevision: usage.revision,
  set: [{ key: "record:123", value: { title: "Quarterly" } }],
  delete: ["record:old"],
});
```

`set`, `delete`, `clear`, and `transaction` return usage metadata plus
`changed` and `changedKeys`. Transactions may use `expectedRevision` for
optimistic concurrency and may also set `clear: true`. Values must be ordinary
JSON. Default limits are 5 MiB per app, 512 keys, 128 KiB per value, and 128
operations or 160 KiB per transaction.

Only active visible UI receives invalidation hints:

```js
bridge.storage.onChanged(async (event) => {
  if (!event.reset && !event.keys.includes("last-refresh")) return;
  const latest = await bridge.storage.get("last-refresh");
  renderRefresh(latest, event.revision);
});
```

The event contains `revision`, bounded `keys`, and `reset`. Hints are
coalesced, are not state themselves, and are never queued or replayed for an
inactive, occluded, minimized, or worker view. Always re-read storage. Also
read required state during startup because the view may have missed a hint.

### Granted Space files

A manifest file declaration is only a maximum request. The person maps it to
an ordinary relative file or directory in that app's Space before use:

```js
const listing = await bridge.files.list({ grantId: "exports", path: "." });
const previous = await bridge.files.read({ grantId: "exports", path: "report.json", encoding: "utf8" });
const written = await bridge.files.write({
  grantId: "exports",
  path: "report.json",
  encoding: "utf8",
  data: JSON.stringify({ ok: true }, null, 2),
  mode: "replace",
});
```

`list` returns `{ path, entries, truncated }`; entries contain `name`, `path`,
`kind`, optional `sizeBytes`, and `modifiedAt`. `read` returns `{ path,
encoding, data, sizeBytes, modifiedAt }`. `write` returns `{ path, sizeBytes,
modifiedAt }` and requires explicit `create` or `replace` mode. Data may be
`utf8` or `base64`. Default read and write limits are 512 KiB and listings are
limited to 200 entries. Every write is atomic and creates a targeted History
checkpoint. Grant-relative paths cannot traverse links, metadata roots, or the
selected Space target.

## Worker tools and background work

The optional worker is a separate hidden sandbox. It has the same bridge name,
Node denial, direct-network denial, and host-derived authority as visible UI.
It cannot manipulate visible tabs. Export `handleAction` for declared tools and
`handleBackground` for a declared schedule:

```js
export async function handleAction(action, input) {
  if (action !== "search") throw new Error("Unknown action.");
  const response = await globalThis.workspaceRestrictedApp.request({
    destinationId: "records-api",
    method: "GET",
    path: `/v1/records?query=${encodeURIComponent(input.query)}`,
    headers: { accept: "application/json" },
  });
  const value = JSON.parse(response.body);
  return { count: Number.isInteger(value.count) ? value.count : 0 };
}

export async function handleBackground(event) {
  let network;
  try {
    const response = await globalThis.workspaceRestrictedApp.request({
      destinationId: "records-api",
      method: "GET",
      path: "/v1/records?limit=20",
      headers: { accept: "application/json" },
    });
    network = { ok: response.status >= 200 && response.status < 300, status: response.status };
  } catch (error) {
    network = { ok: false, code: error?.code || "NETWORK_FAILED" };
  }

  let notification;
  try {
    notification = await globalThis.workspaceRestrictedApp.notifications.show({
      permissionId: "refresh-finished",
    });
  } catch (error) {
    notification = { status: "not-shown", code: error?.code || "NOTIFICATION_FAILED" };
  }

  await globalThis.workspaceRestrictedApp.storage.set("last-refresh", {
    reason: event.reason,
    scheduledAt: event.scheduledAt,
    completedAt: new Date().toISOString(),
    network,
    notification,
  });
}
```

Tool inputs and results are checked against the manifest schemas and limited
to 256 KiB. Worker invocations default to a five-second deadline. Background
events contain `reason` (`scheduled`, `manual`, or `resume`) and ISO
`scheduledAt`. A background declaration starts disabled. When enabled,
Workspace runs it only while Workspace is running, with a two-job global
concurrency limit and at most one staggered resume catch-up.

`notifications.show({ permissionId })` works only inside an enabled background
invocation and only for a separately granted manifest category. It returns a
status of `shown`, `rate-limited`, or `unsupported`. The host supplies the
reviewed title and description; the worker cannot add dynamic text, actions,
or URLs. Notification failure should not discard already completed work. Use
copy such as “refresh finished” when the result may be either success or
failure.

## Authentication declarations

Authentication describes what host-owned connection setup the destination
accepts. It never contains a credential:

| Kind | Manifest shape | Host behavior |
|---|---|---|
| None | `{ "kind": "none" }` | No connection is stored. It must be the destination's only auth declaration and is the only kind allowed for numeric loopback. |
| API key | `{ "kind": "api-key", "header": "x-api-key" }` | Capabilities collects the value and the broker injects it through the reviewed non-sensitive header name. |
| Bearer | `{ "kind": "bearer" }` | Capabilities stores the token and the broker writes `Authorization: Bearer …`. |
| Basic | `{ "kind": "basic" }` | Capabilities stores username/password and the broker creates the Basic authorization header. |
| OAuth PKCE | `{ "kind": "oauth2-pkce", "issuer": "https://identity.example.com", "clientId": "public-native-client", "scopes": ["records.read"] }` | Workspace performs public-issuer discovery, S256, system-browser authorization, one-shot loopback callback, encrypted storage, and refresh. |

A public destination may accept multiple credential kinds, but `none` cannot
be combined with another kind. OAuth requires a client id registered with a
public HTTPS issuer that supports public clients without a client secret, plus
scopes that exclude `openid`. Workspace cannot verify who owns that client
registration. Client secrets, device-code flow, and package-supplied
authorization or token endpoints are rejected. Connections are configured per
installed digest and destination in Capabilities. There is no connection or
secret-reading bridge.

## Default-off lifecycle and denial handling

Installing a reviewed digest makes its UI available but leaves network, file,
and notification grants off, stores no connection, and leaves background work
disabled. Storage is available without an external-power grant. A reviewed
update preserves app storage but resets destination grants, file grants,
notification grants, connections, and background authority. Removal deletes
app storage and connections but never deletes Space files. Source edits do not
change the installed bytes; propose and review a new digest.

Bridge promises reject an `Error`; host failures expose a stable enumerable
`error.code`. Handle denial as visible product state rather than retrying or
asking for secrets inside the app:

```js
try {
  await bridge.request({ destinationId: "records-api", method: "GET", path: "/v1/records" });
} catch (error) {
  if (error?.code === "NETWORK_DENIED") showStatus("Allow this destination in Capabilities.");
  else if (error?.code === "AUTH_REQUIRED") showStatus("Connect this destination in Capabilities.");
  else showStatus(error?.message || "The connection is unavailable.");
}
```

Common codes are:

- network: `NETWORK_DENIED`, `AUTH_REQUIRED`, `NETWORK_FAILED`;
- files: `FILE_DENIED`, `FILE_NOT_FOUND`, `FILE_CONFLICT`, `FILE_TOO_LARGE`,
  `FILE_FAILED`;
- storage: `STORAGE_INVALID`, `STORAGE_QUOTA`, `STORAGE_CONFLICT`,
  `STORAGE_CORRUPT`, `STORAGE_UNSAFE`, `STORAGE_FAILED`;
- notifications: `NOTIFICATION_DENIED`, `NOTIFICATION_FAILED`; and
- worker/tool lifecycle: `ACTION_UNKNOWN`, `INPUT_INVALID`, `OUTPUT_INVALID`,
  `APP_TIMEOUT`, `APP_CRASHED`, `APP_ERROR`, `APP_UNAVAILABLE`, and
  `REVISION_CHANGED`.

Do not repeatedly retry a denied power, infer that a declaration is a grant,
or collect credentials in app UI or storage. Provide useful local or demo state
when the external system is optional.

## Run the checked-in local demo

The Connected inbox package includes a project-service panel. To test it:

1. Register this repository as a Space, or copy
   `examples/packages/restricted-connected-inbox` into an ordinary folder in a
   registered Space.
2. Install that Space-relative package through **Advanced local install**.
3. From the repository root, start the companion process:

   ```powershell
   node examples/services/restricted-app-demo-service.mjs
   ```

4. In Capabilities, allow the app's **project-service** destination.
5. Open the app's **Project service** tab and use **Check health** or **Run
   refresh job**.

The helper is an ordinary dependency-free developer process that binds only
`127.0.0.1:4317`. Workspace and the sandboxed app do not execute, install,
stop, or trust it. The loopback broker verifies the reviewed address and port,
not which process owns the listener. See the
[example README](../examples/packages/restricted-connected-inbox/README.md)
for the storage-invalidation and static-notification walkthrough.

## Verification and related contracts

- Run `npm run check` and `npm test` after TypeScript or product behavior
  changes.
- Run `npm run desktop:prepare` after changing the sandbox host, preload,
  brokers, Electron integration, or packaged runtime resources. Its real
  Electron probe is a release boundary, not a substitute for Node-only tests.
- Keep [Security](../SECURITY.md), [Privacy](../PRIVACY.md),
  [Product model](product-model.md), [Assistant capabilities](assistant-capabilities.md),
  and [Architecture](architecture.md) aligned when authority or lifecycle
  changes.
- Keep native Pi `surface.json` work in the separate
  [Extension surfaces](extension-surfaces.md) contract.
