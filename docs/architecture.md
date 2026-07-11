# Architecture

Workspace has three runtime layers:

1. The React renderer presents a Space selector plus Files, Skills, Extensions, Chats, Library, and History surfaces, with Assistant configuration in Settings.
2. The local Node API owns filesystem access, conversations, resource import, and Pi sessions.
3. Electron supplies native windows, menus, dialogs, secure storage, and packaging.

The renderer never receives provider secrets or unrestricted filesystem access. Native and filesystem operations cross typed API or preload boundaries.

## Product model and navigation

**Workspace** is the product. A **Space** is its unit of work: an understandable context for an activity, backed by one ordinary folder. Creating a Space creates a managed folder; turning an existing folder into a Space registers that folder in place. Neither path converts the user's files to an application-specific format.

The Space selector establishes the active root-folder entity; a Space is not itself a peer navigation surface. The primary information architecture is:

- **Files** — the ordinary folder contents of the selected Space.
- **Skills** — reusable ways of working, available personally or from a trusted Space.
- **Extensions** — executable capabilities and external connections, available personally or from a trusted Space.
- **Chats** — conversations associated with the selected Space.
- **Library** — reusable personal materials available across Spaces.
- **History** — checkpoints and recoverable changes for the selected Space.

Provider, model, and authentication configuration for the Pi-powered Assistant lives under **Settings → Assistant**.

The concepts have deliberately different scopes and trust levels. Library materials are passive and personal. Skills influence how the Assistant works. Extensions can execute code or reach other systems and therefore require stronger, explicit trust. Making something available does not silently activate it or add it to a chat's context.

Surface tabs are Space-bound rather than global views of the currently selected folder. Activating a tab activates its owning Space, and switching Spaces restores that Space's most recent tab. All open Chat panels remain mounted; an accepted Pi turn continues in the local API while its tab is inactive, the window is minimized, or the window is hidden to the system tray. Event-stream reconnects use server turn-state snapshots and persisted transcript rehydration so renderer sleep or wake does not lose the result.

Technical types, routes, and storage paths may continue to use `workspace`, `project`, or `resource` for API stability and compatibility with Pi. User-facing copy should use **Space** for the working context and **Library** for reusable personal materials. Pi's own “resource” terminology remains appropriate when describing Pi runtime discovery rather than the Library.

## Storage

Every Space is backed by an ordinary content folder. Its small portable data layer lives under `.workspace/`: `space.json` carries a stable, versioned identity and `conversations/` carries append-only Chat logs. Workspace reuses a valid manifest id when a moved folder is relinked. Both `.workspace/` and `.pi/` are hidden from the Files surface and excluded from History capture.

Operational state remains outside the folder. Electron user data holds content-addressed History objects, ignore rules, provider credentials, and application preferences. The configured Pi agent directory holds Pi sessions, trust decisions, personal capabilities, and Pi settings. Native Pi project skills, extensions, prompts, settings, and context stay separately under the Space's `.pi/` directory and load according to Pi's trust rules. Removing a linked Space deletes its external Workspace operational state but preserves `.workspace/`; deleting a managed Space removes the whole managed folder.

The Library is application-scoped, reusable across Spaces, and separate from chat context. Copying a Library item into a Space is an explicit action and produces an ordinary file in that Space; Library contents are not automatically attached to conversations or synchronized into every Space.

Folders synchronized by Google Drive for desktop or other desktop sync tools can be turned into Spaces like any other local folder. Native cloud-provider mirroring is a separate feature and should use a provider-neutral adapter with stable remote IDs and explicit conflict handling.

## Trust

Turning a folder into a Space does not automatically authorize executable project configuration. Workspace records trust outside the folder and passes that decision to Pi. Untrusted Space folders may be browsed and attached as content without loading project Skills, Extensions, packages, scripts, or settings. Native Pi context discovery still reads `AGENTS.md`; the UI calls this out because project instructions and executable-resource trust are separate Pi concepts.

## Packaging

The packaged app contains the compiled Electron/local API runtime, the renderer, Pi's production dependencies, and neutral icons. It does not contain a bundled document library or private skill catalog.
