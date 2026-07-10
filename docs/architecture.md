# Architecture

Workspace has three runtime layers:

1. The React renderer presents workspaces, files, resources, skills, extensions, and chat.
2. The local Node API owns filesystem access, conversations, resource import, and Pi sessions.
3. Electron supplies native windows, menus, dialogs, secure storage, and packaging.

The renderer never receives provider secrets or unrestricted filesystem access. Native and filesystem operations cross typed API or preload boundaries.

## Storage

User folders remain ordinary content folders. Application state belongs in the Electron user-data directory, and Pi state belongs in the configured Pi agent directory. A workspace may contain `.pi/` only when the user intentionally wants portable project skills, extensions, prompts, settings, or context.

Folders synchronized by Google Drive for desktop or other desktop sync tools work as local folders. Native cloud-provider mirroring is a separate feature and should use a provider-neutral adapter with stable remote IDs and explicit conflict handling.

## Trust

Opening a folder does not automatically authorize executable project configuration. Workspace records trust outside the folder and passes that decision to Pi. Untrusted folders may be browsed and attached as content without loading project Skills, Extensions, packages, scripts, or settings. Native Pi context discovery still reads `AGENTS.md`; the UI calls this out because project instructions and executable-resource trust are separate Pi concepts.

## Packaging

The packaged app contains the compiled Electron/local API runtime, the renderer, Pi's production dependencies, and neutral icons. It does not contain a bundled document library or private skill catalog.
