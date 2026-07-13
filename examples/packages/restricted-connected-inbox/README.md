# Connected inbox app example

This package exercises Workspace's dynamic restricted-app runtime: a real
interactive rail navigator, persistent Space-owned tabs, brokered public
HTTPS, a numeric loopback service panel, durable app storage, a reviewed
Space-folder export, an optional Assistant/background worker, and a reviewed
static notification category for completed background syncs.

- `agent-app.json` declares the app identity, reviewed HTML entry, optional
  worker, tools, schemas, and exact network destinations.
- `index.html`, `styles.css`, and `app.js` form the sandboxed app UI. The same
  code adapts to the rail navigator and app-owned work tabs using
  `workspaceRestrictedApp.context`.
- `worker.js` exposes an Assistant action and a user-enabled background sync;
  that sync may select the separately granted `new-messages` notification.
- Network calls and tab creation go through the narrow
  `workspaceRestrictedApp` bridge; the app has no Node, filesystem, process,
  or direct network access. Search state uses the host storage bridge, and
  service exports use a separately granted Space folder plus History safety.

Install the Space-relative folder through **Capabilities → Apps in this
Space → Advanced local install**.

The mail endpoint is intentionally non-functional, while the local service
panel expects a service on `127.0.0.1:4317`. Both demonstrate that installing
the app grants nothing: allow each destination under Capabilities before the
broker will attempt a request. Workspace verifies the loopback address and
port, but this version does not verify process ownership.

Notifications are separately off after installation. If allowed, they can be
shown only during enabled background work while Workspace is running, using
the exact title and body reviewed in `agent-app.json`; app code cannot supply
dynamic notification copy, actions, or URLs.

No credential belongs in this directory. Auth declarations describe the
host-owned connection adapters the app accepts; they are never tokens or
client secrets.
