# Privacy

Last updated: July 12, 2026

Workspace is a local-first desktop application. It does not require a Workspace account, and the current application does not include first-party analytics, advertising, or usage telemetry.

This document describes the behavior of the open-source Workspace application. Model providers, GitHub, package hosts, cloud-sync software, and third-party Skills or Extensions have their own privacy terms.

## What stays on this computer

By default, Workspace stores:

- Space files in the ordinary folders the user creates or registers.
- A hidden `.workspace/` directory inside each Space. Its `space.json` file stores the portable Space identity, and its `conversations/` directory stores that Space's Chat records.
- Library materials, the Space registry, History objects, ignore rules, and application settings under the local Workspace application-data directory.
- Pi settings, sessions, trust decisions, personal Skills, Extensions, and packages under the configured Pi agent directory, normally `~/.pi/agent`.
- Provider credentials in an application-scoped file encrypted through Electron's operating-system-backed `safeStorage`. Workspace refuses credential operations when that encryption is unavailable.
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

## Local CLI and development harness

The installed `workspace` command writes an atomic request containing its arguments, the terminal's current working directory, a random request id, protocol version, and timestamp. The desktop host returns stdout, stderr, exit status, and a compact read-only result. Depending on the command, that result can include local Space names and paths, running Assistant/compaction task metadata, and capability names, scope, source, and status.

The shim removes its request and response after completion, and the broker cleans stale bounded files during initialization. These files remain local and are not sent to a Workspace service, but another process running as the same Windows user may be able to read or submit them. Protocol v1 does not expose file contents, conversation text, or credentials. See [Workspace management layer](docs/management-layer.md) and [Security](SECURITY.md).

`npm run workspace:drive` is a developer test harness, not the installed management CLI. It sends the supplied prompt and any explicitly selected context through the configured model provider by the same Pi/local-API path as a desktop Chat. In-process runs use temporary Workspace application state unless `WORKSPACE_STATE_DIR` is set; `--agent-dir` can isolate Pi state. Treat its prompts, reports, and provider traffic with the same privacy care as an interactive Chat.

## Space trust and Assistant context

Turning a folder into a Space does not automatically authorize its executable Pi configuration. Trusting a Space allows Pi to load project Skills, Extensions, packages, scripts, and settings from Pi-supported project locations. Trust does not upload the whole folder and does not certify the code as safe.

Library materials are passive personal files. Adding one to a Space creates an independent local copy under `From Library`; it is not shared with the Assistant until the user attaches it or the Assistant accesses it through an authorized tool.

Pi's native context discovery may expose `AGENTS.md` instructions separately from executable project-resource trust. See [Assistant capabilities](docs/assistant-capabilities.md) for the complete distinction.

## Google Drive and other synchronized folders

Workspace does not currently connect to the Google Drive API or run its own cloud mirror. It can register an ordinary local folder managed by Google Drive for desktop or another sync application. That separate application may upload and synchronize the folder—including `.workspace/space.json`, `.workspace/conversations/`, and any `.pi/` project configuration—under its own settings and privacy policy. Do not place a Space in a synchronized folder unless synchronizing its Chat history and hidden metadata is acceptable.

## User choices

Users choose which folders become Spaces, which files are attached to Chats, which model provider receives Assistant requests, which personal or Space-scoped capabilities are installed, and whether a Space is trusted.

Because this project is early stage, not every data-management action has a dedicated UI yet. Application and Pi data remain ordinary local files, but manual changes should be made only while Workspace is closed and after creating a backup.

## Changes and questions

Material privacy behavior changes should update this file in the same release. General questions can use [GitHub Issues](https://github.com/Mat-Tom-Son/workspace/issues), but do not include private data or credentials. Report security concerns privately through [the security policy](SECURITY.md).
