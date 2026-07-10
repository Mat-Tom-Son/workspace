# Architecture

Workspace has three runtime layers:

1. The React renderer presents Spaces, files, Chats, the Library, History, and the Assistant surfaces.
2. The local Node API owns filesystem access, conversations, resource import, and Pi sessions.
3. Electron supplies native windows, menus, dialogs, secure storage, and packaging.

The renderer never receives provider secrets or unrestricted filesystem access. Native and filesystem operations cross typed API or preload boundaries.

## Product model and navigation

**Workspace** is the product. A **Space** is its unit of work: an understandable context for an activity, backed by one ordinary folder. Creating a Space creates a managed folder; turning an existing folder into a Space registers that folder in place. Neither path converts the user's files to an application-specific format.

The primary information architecture is:

- **Space** — the files and current working context.
- **Chats** — conversations associated with the selected Space.
- **Library** — reusable personal materials available across Spaces.
- **History** — checkpoints and recoverable changes for the selected Space.
- **Assistant** — configuration for the Pi-powered helper.
  - **Setup** — provider, model, and authentication.
  - **Skills** — reusable ways of working.
  - **Extensions** — executable capabilities and external connections.

The concepts have deliberately different scopes and trust levels. Library materials are passive and personal. Skills influence how the Assistant works. Extensions can execute code or reach other systems and therefore require stronger, explicit trust. Making something available does not silently activate it or add it to a chat's context.

Technical types, routes, and storage paths may continue to use `workspace`, `project`, or `resource` for API stability and compatibility with Pi. User-facing copy should use **Space** for the working context and **Library** for reusable personal materials. Pi's own “resource” terminology remains appropriate when describing Pi runtime discovery rather than the Library.

## Storage

Every Space is backed by an ordinary content folder. Application state belongs in the Electron user-data directory, and Pi state belongs in the configured Pi agent directory. A Space folder may contain `.pi/` only when the user intentionally wants portable project skills, extensions, prompts, settings, or context.

The Library is application-scoped, reusable across Spaces, and separate from chat context. Copying a Library item into a Space is an explicit action and produces an ordinary file in that Space; Library contents are not automatically attached to conversations or synchronized into every Space.

Folders synchronized by Google Drive for desktop or other desktop sync tools can be turned into Spaces like any other local folder. Native cloud-provider mirroring is a separate feature and should use a provider-neutral adapter with stable remote IDs and explicit conflict handling.

## Trust

Turning a folder into a Space does not automatically authorize executable project configuration. Workspace records trust outside the folder and passes that decision to Pi. Untrusted Space folders may be browsed and attached as content without loading project Skills, Extensions, packages, scripts, or settings. Native Pi context discovery still reads `AGENTS.md`; the UI calls this out because project instructions and executable-resource trust are separate Pi concepts.

## Packaging

The packaged app contains the compiled Electron/local API runtime, the renderer, Pi's production dependencies, and neutral icons. It does not contain a bundled document library or private skill catalog.
