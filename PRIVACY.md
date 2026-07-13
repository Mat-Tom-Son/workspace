# Privacy

Last updated: July 13, 2026

Workspace is a local-first desktop application. It does not require a Workspace account, and the current application does not include first-party analytics, advertising, or usage telemetry.

This document describes the behavior of the open-source Workspace application. Model providers, GitHub, package hosts, cloud-sync software, and third-party Skills or Extensions have their own privacy terms.

## What stays on this computer

By default, Workspace stores:

- Space files in the ordinary folders the user creates or registers.
- A hidden `.workspace/` directory inside each Space. Its `space.json` file stores the portable Space identity, and its `conversations/` directory stores that Space's Chat records.
- Library materials, the Space registry, History objects, ignore rules, and application settings under the local Workspace application-data directory.
- Pi settings, sessions, Pi's independent trust decisions, personal Skills, Extensions, and packages under the configured Pi agent directory, normally `~/.pi/agent`.
- Provider credentials in an application-scoped file encrypted through Electron's operating-system-backed `safeStorage`. Workspace refuses credential operations when that encryption is unavailable.
- Restricted-app install receipts, content-addressed package snapshots, and Space-and-app-scoped JSON storage under the application-data `restricted-apps` directory, plus separately encrypted restricted-app connections in `restricted-app-connections.bin`.
- Short-lived CLI request, claim, and response files under `%APPDATA%\Workspace\cli` when the installed `workspace` command is used.

Registering an existing folder does not upload, move, duplicate, or rename the user's files. It does add the documented hidden `.workspace/` identity and Chat storage. Removing a linked Space from Workspace leaves both the ordinary files and `.workspace/` in place. Deleting a Workspace-managed Space deletes its managed folder after confirmation. Uninstalling Workspace does not itself delete linked Space folders.

## When data leaves this computer

### Model providers

When a user sends an Assistant message, Pi sends the request to the provider and model selected in Settings → Assistant. The request can include the message, relevant conversation history and instructions, explicitly selected text attachments, and tool results produced during the turn. If the Assistant uses filesystem or Extension tools, information those tools return may become part of later model context.

Workspace does not proxy these requests through a Workspace account service. The selected provider receives and processes them under that provider's terms and settings. Do not send sensitive material to a provider unless its handling is acceptable for that material.

### Application updates

Installed Windows builds check the public `Mat-Tom-Son/workspace` GitHub release feed shortly after startup, every four hours while running, and when **Help > Check for Updates…** is selected. A check sends a normal network request to GitHub, which can receive standard request metadata such as an IP address and user agent.

Checks do not download an installer. When an update is available, the user chooses **Update now**; Workspace downloads it, performs its update-specific shutdown, and asks the updater to relaunch the app. If an already-downloaded update becomes ready outside that immediate action, Workspace can offer **Restart now** or **Later**; a ready update deferred with Later installs on explicit application quit. Unpacked development and release-smoke packages have no update manifest and do not contact the feed through Workspace's updater.

### Packages and external capabilities

Installing or updating a Pi package can contact its npm, git, HTTPS, or other configured source. Package tools receive the normal network and repository metadata required for that operation.

Skills may include scripts, and Extensions or packages can make their own network requests or open external sites. Their data handling is determined by their code and the services they contact, not by this policy. Review the source and documentation before installing an unfamiliar capability.

An Extension can contribute a local declarative surface through `surface.json`. Workspace reads and displays that manifest only after Pi loads the Extension. Surface version 1 contains static text and data and has no direct account, network, or credential bridge. Do not put credentials or sensitive remote records in a surface manifest, especially when the Space is synchronized by another application.

The restricted-app service copies an explicitly reviewed package digest into content-addressed Workspace application storage and records the Space/app receipt outside the Space. Inspection and installation do not execute its JavaScript or contact declared destinations. Visible UI and optional Assistant/background work use separate ephemeral sandbox renderers. Direct renderer networking is denied; a host broker can contact only a separately granted public HTTPS origin or numeric loopback address and port. Loopback access does not verify process ownership. API-key, bearer, basic, and OAuth PKCE connections are stored in a separate operating-system-encrypted file bound to the Space, app, digest, destination, and canonical origin. OAuth uses the system browser and a one-shot loopback callback; tokens are not returned to app code. App JSON storage is machine-local, bounded, scoped to Space and app, preserved across reviewed updates, and deleted on uninstall or Space removal. Storage-change hints contain bounded key names and go only to the active visible owning app view. Separately granted Windows notifications use only the static title and body reviewed in the manifest and can be shown only by enabled background work; clicking one opens its owning Space and app. Workspace does not send these notifications through a Workspace cloud service. Windows receives and displays them according to the computer's notification and lock-screen settings, which may expose their reviewed text outside the app window. A separately granted Space file or folder remains ordinary user content; reads and writes are grant-relative and writes create a targeted History checkpoint. Removing an app deletes its storage and credentials but does not delete Space files. Secret values are not returned to app code, stored in manifests or Space files, included in tool payloads, or intentionally logged.

## Local CLI and development harness

The installed `workspace` command writes an atomic request containing its arguments, the terminal's current working directory, a random request id, protocol version, and timestamp. The desktop host returns stdout, stderr, exit status, and a compact read-only result. Depending on the command, that result can include local Space names and paths, running Assistant/compaction task metadata, and capability names, scope, source, and status.

The shim removes its request and response after completion, and the broker cleans stale bounded files during initialization. These files remain local and are not sent to a Workspace service, but another process running as the same Windows user may be able to read or submit them. Protocol v1 does not expose file contents, conversation text, or credentials. See [Workspace management layer](docs/management-layer.md) and [Security](SECURITY.md).

`npm run workspace:drive` is a developer test harness, not the installed management CLI. It sends the supplied prompt and any explicitly selected context through the configured model provider by the same Pi/local-API path as a desktop Chat. In-process runs use temporary Workspace application state unless `WORKSPACE_STATE_DIR` is set; `--agent-dir` can isolate Pi state. Treat its prompts, reports, and provider traffic with the same privacy care as an interactive Chat.

## Space authorization and Assistant context

Creating or registering a Space authorizes Workspace to load project Skills, Extensions, packages, scripts, settings, and instructions from Pi-supported locations in that exact folder. This does not upload the whole folder and does not certify its code as safe. Removing the Space revokes Workspace's authorization; the folder and its portable `.workspace/` data remain according to the linked-versus-managed removal rules above.

Library materials are passive personal files. Adding one to a Space creates an independent local copy under `From Library`; it is not shared with the Assistant until the user attaches it or the Assistant accesses it through an authorized tool.

The folder's executable configuration can later change through local edits, source control, or a desktop synchronization tool without another registration prompt. Review native Pi Extensions and package changes with the same care as other current-user code. See [Assistant capabilities](docs/assistant-capabilities.md) for the complete distinction.

## Google Drive and other synchronized folders

Workspace does not currently connect to the Google Drive API or run its own cloud mirror. It can register an ordinary local folder managed by Google Drive for desktop or another sync application. That separate application may upload and synchronize the folder—including `.workspace/space.json`, `.workspace/conversations/`, and any `.pi/` project configuration—under its own settings and privacy policy. Do not place a Space in a synchronized folder unless synchronizing its Chat history and hidden metadata is acceptable.

## User choices

Users choose which folders become Spaces, which files are attached to Chats, which model provider receives Assistant requests, and which Personal or This Space capabilities are installed. Registering the folder is the local Pi authorization. Restricted-app package installation, each network destination, file, and notification grant, background work, and each stored connection are separate choices and can be revoked independently.

Because this project is early stage, not every data-management action has a dedicated UI yet. Application and Pi data remain ordinary local files, but manual changes should be made only while Workspace is closed and after creating a backup.

## Changes and questions

Material privacy behavior changes should update this file in the same release. General questions can use [GitHub Issues](https://github.com/Mat-Tom-Son/workspace/issues), but do not include private data or credentials. Report security concerns privately through [the security policy](SECURITY.md).
