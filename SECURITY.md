# Security policy

## Report a vulnerability privately

Please use a [GitHub private security advisory](https://github.com/Mat-Tom-Son/workspace/security/advisories/new) to report a suspected vulnerability. Do not open a public issue for an unpatched security problem.

Include the affected version or commit, impact, reproduction steps or proof of concept, and any suggested mitigation you have. Remove real credentials, private documents, and unnecessary personal information from the report.

If a secret was exposed, revoke or rotate it with its provider first. Never paste API keys, tokens, certificate passwords, private keys, or signing material into an issue, discussion, screenshot, test fixture, or repository file.

## Supported versions

Workspace is an early-stage project. Security fixes target the current public release and the `main` branch. Upgrade to the newest release when a fix is published; older releases may not receive a backport.

## Security boundaries

Workspace is local first, but local does not mean that every action is sandboxed:

- A Space exposes an ordinary folder to the local application and Pi's filesystem tools.
- Selected chat attachments and later tool results may be sent to the configured model provider as part of an Assistant turn.
- Skills can influence model behavior and may include executable scripts.
- Extensions and Pi packages can execute code with the current user's permissions and can make network requests.
- Creating or registering a Space authorizes Workspace to load project configuration from its `.pi` and other Pi-supported project resource locations. Registration is authorization, not code review, signing, or malware detection.
- Personal capabilities are available across Spaces and should be reviewed even though they do not use registered-Space authorization.

Workspace intentionally treats successful Space creation or registration as the project-runtime grant and removes the redundant trust prompt. Native Pi Extensions in that folder can execute with the current user's permissions during catalog loading, and later local, source-control, or synchronization changes to `.pi` do not trigger another prompt. Removing the Space revokes Workspace's exact-root override; it does not rewrite Pi's independent trust store for other Pi clients.

Loaded Extensions can contribute `surface.json` views. Workspace accepts these only beside an Extension Pi loaded, rejects links and oversized or invalid manifests, and renders a fixed plain-data block vocabulary through host-owned components. Surface manifests cannot inject HTML, scripts, styles, event handlers, or React code into the renderer. This protects the renderer boundary; it does not sandbox the owning Extension process or make that Extension safe.

Restricted app packages are a separate lane. Workspace validates the closed version-2 `agent-app.json` contract, including each named automation's schedule and exact permission subset; rejects lifecycle scripts, binaries, native build and Pi declarations, unsafe paths, links, and bounded-size violations; and installs only an explicitly reviewed content digest. Dependency metadata is inert because Workspace never resolves it or invokes npm; all runtime assets must already be in the review. Inspection and installation do not evaluate package JavaScript. Installation grants no declared network, Space-file, or notification access, stores no connection, and leaves every automation disabled.

Visible restricted-app UI runs from a verified in-memory snapshot in a sandboxed, context-isolated `WebContentsView` with Node disabled, a unique ephemeral session, restrictive CSP, direct network/navigation/frame/dialog/permission paths denied, sender-bound IPC, and lifecycle limits. Assistant actions and automations use a separate hidden sandbox with time and byte limits. Worker host powers exist only while an accepted action or automation is pending; automation powers are the intersection of the job's reviewed subset and current grants. Network, file, and tab powers from UI require an active visible view, and hidden UI is throttled. Notifications accept only a reviewed category id during an enabled automation that includes that category; the host supplies fixed single-line copy, rate limits by Space/app across renderer restarts and app updates, and revalidates click authority before opening the owning Space. A manual run while its schedule is disabled cannot notify. Brokered public HTTPS requires an installed-revision grant, enforces method/origin/redirect rules, rejects private and reserved DNS results, pins an approved public address, and injects encrypted API-key, bearer, basic, or refreshed OAuth PKCE authorization only in main. OAuth discovery and token endpoints use the same public-address controls; client secrets, package-supplied endpoints, and device-code auth are rejected. Numeric loopback HTTP is a separate anonymous-only grant with no DNS or redirects; it verifies address and port, not process ownership. Network and file grants compose: app code with both powers can send user input, app storage, Assistant-action data, or content read from a granted Space file to a granted destination. The broker constrains where and how a request is sent, not the meaning or sensitivity of its body.

Revoking a network destination stops broker access but does not delete its separately stored connection; **Disconnect** deletes the local encrypted record but does not rotate an API key or bearer credential or revoke provider-side OAuth authorization. Credential replacement, Disconnect, app update, and app removal invalidate the OAuth binding generation so an in-flight browser connection or refresh cannot restore a deleted local token. Automation launches re-read installed-revision authority and current grants at launch and are serialized with grant, connection, update, and removal mutations; manual runs use the same Space capability-mutation authority lane. One host scheduler limits the machine to two active jobs and prevents same-job overlap. Durable receipts record success, failure, skipped, and cancelled outcomes without including app payloads or credentials. Host-owned JSON storage is quota-bound and Space/app-scoped; bounded storage-change hints go only to the active visible owning UI and are never queued for hidden views or workers. File requests are grant-relative and reject traversal, links, metadata roots, oversized operations, and undeclared writes; grants are validated against existing ordinary targets, and writes are atomic and History-covered. The real-Electron preparation probe exercises both hosts, including direct loopback denial, out-of-lifecycle worker denial, storage, file write/read, automation notifications, storage invalidation, host-owned tab creation, and termination of a hung worker. A Node process, worker thread, or `vm` alone is not an acceptable boundary. Chromium exploit and CPU/memory denial-of-service risk still exist, so Electron must remain current and the runtime probe must stay release-gating. See [Restricted app runtime](docs/restricted-app-runtime.md).

Only install Skills, Extensions, and packages whose source you understand. Review capability provenance and supporting scripts before use, especially when a package can run shell commands or access sensitive folders.

## Local management surfaces

The packaged renderer talks to a loopback-only local API with a per-launch desktop session token and an app-specific allowed origin. That boundary is for the trusted packaged renderer; it is not a network API intended for other local applications. Development mode has different local-origin assumptions and must not be exposed beyond the loopback interface.

The installed `workspace` command uses a separate protocol-v1 file broker under `%APPDATA%\Workspace\cli`. Requests and responses are UUID-named, atomic, size- and age-bounded, path-confined, and rejected when they are symbolic links or unsafe file types. Electron's single-instance host serializes accepted requests and cleans stale files.

That broker is same-Windows-user coordination, not authenticated interprocess communication. Another process running as the same user may be able to submit a request or read its result. Protocol v1 therefore exposes only compact Space names/paths, running-task metadata, and capability provenance/status. It does not return file contents, conversation text, API keys, provider credentials, or signing material.

Do not add mutations to protocol v1. Any future write-capable management surface requires authenticated caller identity, per-action authorization and scope, request freshness/replay protection, confirmation and revocation behavior, durable receipts, and the existing registered-Space, History, filesystem, and active-turn checks. See [Workspace management layer](docs/management-layer.md).

## Release integrity

Public releases are built from version tags and include an installer, blockmap, update manifest, and SHA-256 checksum file. The updater also validates the SHA-512 digest in `latest.yml`.

The project may publish unsigned or self-signed public releases until a publicly trusted code-signing identity is configured. A self-signed certificate provides artifact continuity for its owner but does not establish public Windows trust. Verify the release source and published checksums, and expect Windows to warn when the publisher is not publicly trusted.
