# Workspace contributor guide

Workspace is a local-first Electron shell around ordinary folders and the native Pi agent runtime. Read [the product model](docs/product-model.md) before changing navigation, terminology, storage, trust, or Assistant behavior. It records the shared product direction; update it when a product decision changes.

## Product boundaries

- Use **Workspace** as the user-facing product name.
- A **Space** is a human-friendly working context backed by one ordinary folder. Registering an existing folder must not move, copy, or rename user files. Workspace deliberately maintains hidden, portable `.workspace/space.json` identity metadata and `.workspace/conversations/` logs in that folder.
- The folder is transparent infrastructure, not a proprietary container. Keep **Show folder** and normal filesystem interoperability intact.
- Use **Library** only for passive, reusable personal materials. Library items enter a Space through an explicit copy and never become Assistant context automatically.
- Use **Capability** as the navigation umbrella. Inside it, use **Skill** for a reusable way of working and **Extension** for executable Pi capabilities or connections. Packages are distribution and lifecycle plumbing, not another top-level product concept.
- Keep package, protocol, IPC, updater, user-data, and environment identifiers independent and product-neutral.
- Keep provider credentials, trust decisions, History objects, Pi sessions, ignore rules, and machine-specific application state outside user content folders. Only the documented portable `.workspace/` records belong in a Space.
- Treat project Pi resources—including `.pi` and other Pi-supported project locations—as executable configuration: load them only after the user trusts the folder.
- Prefer Pi's built-in tools, resource loader, auth storage, model registry, package manager, skills, and extensions over app-specific replacements.
- Do not bundle proprietary tools, instructions, source libraries, or account integrations.
- Do not describe a desktop-synchronized folder as native cloud integration. Google Drive currently works through Google Drive for desktop; direct Drive APIs and native provider OAuth are future adapter work.

## Product rails

- **Local first:** a Space remains useful as a folder without an account or cloud service.
- **Understandable:** explain outcomes in terms of Spaces, Library materials, and Capabilities; identify Skills and Extensions inside that surface, and reveal technical paths and package sources as supporting detail.
- **Explicit context:** adding, copying, installing, trusting, and attaching are separate user actions. Do not silently put files or capabilities into a conversation.
- **Progressive trust:** browsing a folder is lower trust than executing its `.pi` configuration. Trust decisions live outside the Space and must be reversible.
- **Portable identity:** `.workspace/` is data, not executable configuration. Preserve a valid manifest id when a Space folder moves, hide `.workspace/` and `.pi/` from Files, and exclude both from History capture.
- **Space-bound tabs:** every surface tab owns a Space id. Activating a tab activates that Space; switching Spaces restores that Space's most recent tab. Never make a tab silently inherit whichever Space happens to be selected.
- **Background continuity:** inactive Chat tabs stay mounted while their turns run. Tab switches, taskbar minimization, sleep/wake recovery, and close-to-tray must not cancel an accepted turn or lose its persisted result; only an explicit stop or quit may do that.
- **Native Pi compatibility:** preserve standard `SKILL.md` directories and Pi scopes. Do not fork a Workspace-only skill or extension format.
- **General computer work:** avoid code-only assumptions in primary UI copy and workflows.

## Stable information architecture

The rail starts with the **Space** selector, followed by **Files**, **Capabilities**, **Chats**, **Library**, and **History**. **Shortcuts** and **Settings** stay at the bottom. Capabilities combines Skills and Extensions into one Installed/Discover surface; package source, scope, type, load state, diagnostics, update, and removal remain visible inside it. Provider, model, API-key, and OAuth setup belongs in **Settings → Assistant**, not in the rail. User-facing copy uses **Space** and **Library** even where internal routes or types retain `workspace`, `project`, or `resource` for compatibility.

See [Assistant capabilities](docs/assistant-capabilities.md) for the scopes, trust model, Anthropic-compatible skill import behavior, package boundary, and distinction between Library materials and Pi resources.

## Development

- Use Node 22.19.0 or newer.
- Run `npm run check` after TypeScript changes.
- Run `npm test` before handing off behavior changes.
- Use the smallest verification lane that can catch the failure you are working on; do not make an installer during every inner-loop UI change.
- Run `npm run desktop:prepare` after Electron, packaging, or runtime-resource changes, and before handing off a desktop-integrated change. The composed package and installer commands already include it.
- Run `npm run desktop:package:smoke` when packaged behavior or installer-facing assets change. It verifies the canonical Electron Builder layout without spending time on the NSIS installer.
- Run the slower Forge-based `npm run desktop:package` only when diagnosing or changing that retained package lane.
- Run `npm run desktop:make` only for an installer/release candidate; it already includes `desktop:verify:release`. Run the verifier alone only when rechecking existing `out/builder` artifacts.
- Never commit provider keys, signing material, tokens, or generated user data.
- Publish Windows releases only from a clean `v<package version>` tag. Required assets are the installer, blockmap, `latest.yml`, and checksums from one build.
- Keep personal PFX files outside the repository and use only the `WIN_CSC_LINK` and `WIN_CSC_KEY_PASSWORD` GitHub secrets. Do not reuse organization signing credentials.
- Keep README claims and the docs in sync with shipped behavior. In particular, do not claim native Google Drive, provider OAuth, package lifecycle controls, or public signing until the corresponding user path is verified.

The verification ladder and release boundary are documented in [Windows build](docs/windows-build.md) and [Windows releases and signing](docs/windows-release.md).
