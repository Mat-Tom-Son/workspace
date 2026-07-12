# Workspace contributor guide

Workspace is a local-first Electron shell around ordinary folders and the native Pi agent runtime. Read [the product model](docs/product-model.md) before changing navigation, terminology, storage, trust, or Assistant behavior, and read [the management layer](docs/management-layer.md) before changing the kernel, CLI, task registry, or an agent-facing adapter. These documents record the shared product and control-plane direction; update them when those decisions change.

## Harness parity

- This `AGENTS.md` is the one canonical contributor contract. Codex reads it directly; Claude Code reads the root `CLAUDE.md`, which imports this file with `@AGENTS.md`.
- Edit shared policy here instead of copying it into `CLAUDE.md`, `.claude/`, `.codex/`, or harness-specific prose. Keep the root Claude entrypoint thin so the two harnesses cannot drift.
- Both harnesses use the same checked-in npm scripts, documentation, test suites, and release lanes. Do not create alternate Claude-only or Codex-only build or release commands.
- `workspace <command> --json`—for example, `workspace context --json`—is the stable installed-product inspection surface for any shell-capable harness. `npm run workspace:drive` is the separate real-Pi-turn test driver; do not conflate it with the read-only management CLI.
- The harness-loading conventions are documented by [Codex](https://developers.openai.com/codex/guides/agents-md) and [Claude Code](https://code.claude.com/docs/en/memory). Repository behavior is defined here.

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

## Workspace management layer

- `WorkspaceKernel` is the shared in-process read authority for versioned Space context, registered Spaces, active Assistant/compaction tasks, and Pi capability snapshots. The renderer/local API and CLI must consume the same semantic source rather than recreate selection or catalog rules.
- Every query carries an explicit actor. An explicit Space id wins; otherwise context resolves to the deepest registered Space containing the actor's current directory; otherwise it resolves to none.
- Keep adapters thin. The CLI projection intentionally emits compact, content-free summaries, while domain services continue to own mutations, trust, filesystem policy, History, and concurrency controls.
- Protocol v1 under `%APPDATA%\Workspace\cli` is same-user coordination, not an authenticated caller boundary. It must remain read-only. Mutations require a separately versioned authenticated transport, authorization and replay design, explicit scope, and durable receipts.
- Start and finish kernel task records on every Assistant-turn and Chat-compaction path, including errors and abort cleanup. Never leave ghost tasks or let a capability mutation interrupt active work.
- Treat snapshot versions and `--json` output as compatibility contracts. Update implementation, adapters, tests, [the management guide](docs/management-layer.md), README, security, and privacy documentation together when they change.

## Development

- Use Node 22.19.0 or newer.
- Run `npm run check` after TypeScript changes.
- Run `npm test` before handing off behavior changes.
- Use the smallest verification lane that can catch the failure you are working on; do not make an installer during every inner-loop UI change.
- Run `npm run desktop:prepare` after Electron, packaging, or runtime-resource changes, and before handing off a desktop-integrated change. The composed package and installer commands already include it.
- Run `npm run desktop:package:smoke` when packaged behavior or installer-facing assets change. It verifies the canonical Electron Builder layout without spending time on the NSIS installer.
- Run the slower Forge-based `npm run desktop:package` only when diagnosing or changing that retained package lane.
- Run `npm run desktop:make` only for an installer/release candidate; it already includes `desktop:verify:release`. Run the verifier alone only when rechecking existing `out/builder` artifacts.
- When changing the management layer or CLI, run the kernel, adapter, protocol, broker, desktop-host, and packaging suites through `npm test`; add focused coverage for every new snapshot or command.
- Never commit provider keys, signing material, tokens, or generated user data.
- Publish Windows releases only after the release commit is pushed to `main` and its CI run is green, then create a clean `v<package version>` tag pointing at that exact commit. Required assets are the installer, blockmap, `latest.yml`, and checksums from one build.
- Keep personal PFX files outside the repository and use only the `WIN_CSC_LINK` and `WIN_CSC_KEY_PASSWORD` GitHub secrets. Do not reuse organization signing credentials.
- Keep README claims and the docs in sync with shipped behavior. In particular, do not claim native Google Drive, provider OAuth, package lifecycle controls, or public signing until the corresponding user path is verified.

The verification ladder and release boundary are documented in [Windows build](docs/windows-build.md) and [Windows releases and signing](docs/windows-release.md). The control-plane boundary and real-agent driver are documented in [Workspace management layer](docs/management-layer.md).
