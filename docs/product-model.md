# Product model and roadmap

This document is the durable product brief for Workspace. It exists so design, implementation, and release decisions stay aligned as the app grows.

## Product promise

Workspace makes an ordinary folder understandable as a place for getting something done, then gives that place a capable Assistant.

Many people already have the right raw material—folders, files, cloud-synchronized directories, and repeatable ways of working—but do not think of a folder as an environment they can return to. A **Space** closes that gap. It adds a human mental model and an Assistant without turning the folder into a proprietary format.

Workspace is for general computer work. Coding is one valid use, not the organizing metaphor.

## The nouns

| Concept | User promise | Boundary |
|---|---|---|
| **Workspace** | The desktop product that brings places, conversations, materials, and an Assistant together. | It is not the name of each folder-backed activity. |
| **Space** | One understandable place for an activity, backed by an ordinary folder. | Registering a folder does not move or convert it. |
| **Chats** | Conversations grounded in the selected Space. | A chat does not automatically receive every file in the Space. |
| **Library** | Personal materials worth reusing across Spaces. | Items are passive and are copied explicitly; they are not prompt context. |
| **History** | Checkpoints and recoverable changes associated with a Space. | It should remain distinct from chat history. |
| **Assistant** | Pi setup and capability management. | It is configured independently from Space content. |
| **Skill** | A reusable way of working that helps the Assistant approach a task. | A Skill may contain executable scripts and is not merely a document. |
| **Extension** | An executable capability or connection available to the Assistant. | It has a stronger trust implication than a Library item. |

The stable navigation follows these nouns:

- **Space**
- **Chats**
- **Library**
- **History**
- **Assistant**
  - **Setup**
  - **Skills**
  - **Extensions**

## A Space is a view of a folder, not a new file format

There are two honest ways to create a Space:

1. **Create a Space:** Workspace creates a normal folder under its managed local content location.
2. **Turn an existing folder into a Space:** Workspace registers the folder in place.

Both routes should lead to the same product experience. Registration must not move, duplicate, rename, or add metadata to the folder. App state, conversations, trust decisions, and provider credentials stay in application storage unless the user intentionally places portable Pi configuration in `.pi/`.

The user should always be able to reveal a Space in the operating system, open its files with other applications, back it up normally, or synchronize it with a desktop sync tool. A Google Drive for desktop folder works because it is a local folder; that is not the same as direct Google Drive API integration.

## Context is explicit

Physical availability, Assistant context, and executable capability are different states:

| Action | What changes | What does not happen implicitly |
|---|---|---|
| Register a folder as a Space | The folder appears in Workspace. | Files are not uploaded or converted. |
| Add a Library item to a Space | An independent copy is written under `From Library`. | The original is not changed and the copy is not attached to a chat. |
| Attach a file to a Chat | That file is made available to the conversation. | Other Space files are not included automatically. |
| Install a personal Skill or Extension | It becomes available through the user's Pi scope. | It is not copied into every Space. |
| Trust a Space | Pi may load trust-gated `.pi` configuration from that folder. | Trust does not certify the code as safe or publish it globally. |

This separation is a core product rail. “Available,” “in this Space,” “in this chat,” and “allowed to execute” must never collapse into one invisible state.

## Assistant model

Workspace hosts Pi instead of recreating an agent framework. Pi owns model/provider behavior, built-in tools, standard resource discovery, packages, Skills, Extensions, and project trust. Workspace supplies the desktop experience: setup, catalog surfaces, secure credential persistence, folder selection, extension UI bridges, and clear scope/trust explanations.

There are two capability scopes:

- **Personal:** available across Spaces from the user's Pi agent directory.
- **This Space:** portable configuration stored under the Space's `.pi/` directory and loaded only after explicit trust.

Packages can distribute Skills, Extensions, prompts, themes, and related Pi resources. They remain installation plumbing; the primary UI should describe the capability a person is gaining. See [Assistant capabilities](assistant-capabilities.md) for the complete compatibility and safety model.

## Product rails

When a design is ambiguous, prefer the option that best preserves these properties:

1. **Local first:** core work does not require an account or cloud service.
2. **Ordinary files:** user content stays portable and directly accessible.
3. **Clear language:** expose the Space mental model before filesystem or package-manager jargon.
4. **Explicit context:** people can tell what the Assistant can see in the current chat.
5. **Progressive trust:** reading content and executing configuration are separate permissions.
6. **Pi compatibility:** use standard Pi behavior and formats instead of parallel Workspace-only systems.
7. **Capability transparency:** show source, scope, status, and diagnostics for executable additions.
8. **Provider neutrality:** cloud and model integrations should use replaceable adapters rather than shape the core model.

## Roadmap and known gaps

### Foundation now

- Create a folder-backed Space or register an existing folder without conversion.
- Rename a Space, remove a linked-folder registration without deleting its files, or delete a managed Space with an explicit destructive warning.
- Browse and upload Space files, run Space-scoped Chats, use the Library, and view History.
- Restore content-addressed History checkpoints created around file mutations and Assistant turns.
- Configure a Pi provider/model with an API key and use Pi's built-in tools.
- Discover personal and trusted-Space Skills and Extensions.
- Import standard Skills and compatible skill bundles while preserving their supporting files.
- Build a Windows installer and deliver updates through GitHub Releases.

### Next product layer

- Make Space location, storage ownership, History coverage, and trust state easier to inspect at a glance.
- Add Library organization controls such as rename, move, delete, reveal, and bulk operations.
- Add capability lifecycle controls: inspect provenance and permissions, enable/disable, update, and remove Skills, Extensions, and packages.
- Make “what this Chat can see and use” visible before and during a conversation.
- Strengthen onboarding, keyboard/accessibility behavior, renderer interaction tests, recovery, export, and diagnostics.

### Later adapters and distribution maturity

- Add native provider OAuth only with a complete desktop callback/device-code experience and verified credential handling.
- Add direct cloud-storage integrations behind a provider-neutral model with stable remote IDs, offline behavior, explicit conflicts, and no surprise deletion.
- Move from personal or unsigned Windows artifacts to a publicly trusted code-signing identity.
- Consider additional Windows architectures after the x64 release lane is stable.

Roadmap wording must distinguish shipped behavior from direction. Update this section when a capability moves between layers.

## Decision test

Before adding a new top-level concept, ask:

1. Can it fit cleanly as Space content, a Chat, a Library material, a Skill, or an Extension?
2. Is its scope obvious: personal, one Space, or one Chat?
3. Can a person understand what it can read, change, or execute?
4. Does it preserve normal folders and standard Pi compatibility?
5. Would it still make sense for non-coding computer work?

If those answers are unclear, the feature needs a sharper mental model before it needs another navigation item.
