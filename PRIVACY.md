# Privacy

Last updated: July 10, 2026

Workspace is a local-first desktop application. It does not require a Workspace account, and the current application does not include first-party analytics, advertising, or usage telemetry.

This document describes the behavior of the open-source Workspace application. Model providers, GitHub, package hosts, cloud-sync software, and third-party Skills or Extensions have their own privacy terms.

## What stays on this computer

By default, Workspace stores:

- Space files in the ordinary folders the user creates or registers.
- Library materials, the Space registry, conversation records, History data, and application settings under the local Workspace application-data directory.
- Pi settings, sessions, personal Skills, Extensions, and packages under the configured Pi agent directory, normally `~/.pi/agent`.
- Provider credentials in an application-scoped file encrypted through Electron's operating-system-backed `safeStorage`. Workspace refuses credential operations when that encryption is unavailable.

Registering an existing folder does not upload, move, duplicate, rename, or add metadata to it. Removing or uninstalling Workspace does not itself delete those ordinary Space folders.

## When data leaves this computer

### Model providers

When a user sends an Assistant message, Pi sends the request to the provider and model selected in Assistant Setup. The request can include the message, relevant conversation history and instructions, explicitly selected text attachments, and tool results produced during the turn. If the Assistant uses filesystem or Extension tools, information those tools return may become part of later model context.

Workspace does not proxy these requests through a Workspace account service. The selected provider receives and processes them under that provider's terms and settings. Do not send sensitive material to a provider unless its handling is acceptable for that material.

### Application updates

Installed Windows builds check the public `Mat-Tom-Son/workspace` GitHub release feed shortly after startup, every four hours while running, and when **Help > Check for Updates…** is selected. A check sends a normal network request to GitHub, which can receive standard request metadata such as an IP address and user agent. When an update is available, the current updater downloads it automatically and offers installation on restart.

### Packages and external capabilities

Installing or updating a Pi package can contact its npm, git, HTTPS, or other configured source. Package tools receive the normal network and repository metadata required for that operation.

Skills may include scripts, and Extensions or packages can make their own network requests or open external sites. Their data handling is determined by their code and the services they contact, not by this policy. Review the source and documentation before installing an unfamiliar capability.

## Space trust and Assistant context

Turning a folder into a Space does not automatically authorize its executable Pi configuration. Trusting a Space allows Pi to load project Skills, Extensions, packages, scripts, and settings from Pi-supported project locations. Trust does not upload the whole folder and does not certify the code as safe.

Library materials are passive personal files. Adding one to a Space creates an independent local copy under `From Library`; it is not shared with the Assistant until the user attaches it or the Assistant accesses it through an authorized tool.

Pi's native context discovery may expose `AGENTS.md` instructions separately from executable project-resource trust. See [Assistant capabilities](docs/assistant-capabilities.md) for the complete distinction.

## Google Drive and other synchronized folders

Workspace does not currently connect to the Google Drive API or run its own cloud mirror. It can register an ordinary local folder managed by Google Drive for desktop or another sync application. That separate application may upload and synchronize the folder under its own settings and privacy policy.

## User choices

Users choose which folders become Spaces, which files are attached to Chats, which model provider receives Assistant requests, which personal or Space-scoped capabilities are installed, and whether a Space is trusted.

Because this project is early stage, not every data-management action has a dedicated UI yet. Application and Pi data remain ordinary local files, but manual changes should be made only while Workspace is closed and after creating a backup.

## Changes and questions

Material privacy behavior changes should update this file in the same release. General questions can use [GitHub Issues](https://github.com/Mat-Tom-Son/workspace/issues), but do not include private data or credentials. Report security concerns privately through [the security policy](SECURITY.md).
