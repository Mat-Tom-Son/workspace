# Workspace

[![CI](https://github.com/Mat-Tom-Son/workspace/actions/workflows/ci.yml/badge.svg)](https://github.com/Mat-Tom-Son/workspace/actions/workflows/ci.yml)
[![Latest release](https://img.shields.io/github/v/release/Mat-Tom-Son/workspace)](https://github.com/Mat-Tom-Son/workspace/releases/latest)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Workspace is a local-first Electron app that gives every kind of computer work a place, with a native [Pi](https://pi.dev) assistant built in.

In the product, that place is called a **Space**: an understandable working context backed by an ordinary folder. A person can create a new Space and let Workspace create its folder, or turn an existing folder on their computer into a Space without moving or converting its files. Each Space keeps its portable identity and Chats in a hidden `.workspace/` directory. Executable project capabilities remain separate under `.pi/`; provider credentials, trust, History objects, sessions, ignore rules, and app preferences stay in protected application or Pi storage outside the Space.

The core idea is simple: the folder stays ordinary; Workspace makes it feel like a place you can understand, return to, and work in with an Assistant.

## Get Workspace

[Download Workspace for Windows](https://github.com/Mat-Tom-Son/workspace/releases/latest) or [download Workspace for Apple silicon Macs](https://github.com/Mat-Tom-Son/workspace-mac-releases/releases/latest). Both installed apps use GitHub-hosted updates. The Mac app and DMG are Developer ID-signed, notarized, and accepted by Gatekeeper. Windows releases may use the project's stable personal certificate, but that self-signed identity is not publicly trusted, so Windows or SmartScreen may still show a warning.

## Product model

| Concept | What it means |
|---|---|
| **Workspace** | The product: an environment for general computer work. |
| **Space** | Everything associated with one activity, backed by an ordinary folder. |
| **Files** | The ordinary folder contents of the selected Space. |
| **Library** | Reusable personal materials that can be brought into any Space. |
| **Capabilities** | The place to discover and manage what the Assistant can do. |
| **Skill** | A reusable way of working that guides the Assistant. |
| **Extension** | A capability or connection the Assistant can use. |

The Space switcher selects the root-folder entity a person is working in. The primary navigation then opens surfaces for that selected Space and the surrounding product:

- **Files**
- **Capabilities**
- **Chats**
- **Library**
- **History**

Provider, model, API-key, and provider OAuth setup—when a provider flow is supported—lives under **Settings → Assistant**. Connections used by a restricted Space app are configured separately with that app in **Capabilities**.

The folder is an implementation detail, but never a proprietary boundary. Space files remain ordinary files that can be opened in other apps, synchronized by desktop storage tools, backed up, or revealed in the operating system.

Workspace reserves two hidden support directories inside a Space: `.workspace/` for the portable `space.json` identity and append-only conversation logs, and `.pi/` for native Pi project configuration. Neither appears in the Files surface or History checkpoints. Removing a linked Space from the app leaves `.workspace/` with the folder; deleting a managed Space deletes its folder normally.

## What it supports

- Creating a new Space or turning an existing local folder into a Space, including folders synchronized by tools such as Google Drive for desktop.
- Space file browsing, uploads, previews, chat attachments, and ordinary-folder access.
- A personal Library for organizing reusable files and copying them into Spaces when needed.
- Pi's normal built-in tools, provider/model selection, authentication, prompt templates, context files, and packages.
- One Capabilities surface for installed Skills and Extensions, official/reference sources, community Pi packages, provenance, scope, diagnostics, update, and removal.
- Global and registered-Space Pi Extensions. Native Pi Extensions run with the current user's permissions.
- Validated declarative Extension surfaces that can contribute an app rail destination, navigator pane, and Space-bound data views without injecting Extension code into the renderer.
- A [full-trust Connected inbox Pi Extension example](examples/packages/connected-inbox/README.md) and a separate, runnable [restricted Connected inbox Space app](examples/packages/restricted-connected-inbox/README.md).
- A separate restricted-app lane: strict non-evaluating review, content-addressed install receipts, arbitrary reviewed web UI in a sandboxed Space rail navigator, app-requested persistent Space-owned tabs, optional Assistant-action and automation workers, a shared machine-wide scheduler for named jobs, durable run receipts, bounded local app storage with active-view invalidation hints, reviewed History-covered Space-file grants, explicit public-HTTPS or loopback access, host-owned encrypted credentials, standards-only OAuth PKCE, and static reviewed system notifications from enabled automations.
- [Agent Skills](https://agentskills.io) from standard `SKILL.md` directories, `.skill`/ZIP bundles, and skill-only imports from compatible multi-skill packs.
- Assisted Windows installation and a signed/notarized Apple silicon DMG, with GitHub-hosted application updates on both platforms.
- A versioned, read-only management layer and installed `workspace` command for inspecting Space context, running work, and Pi capabilities without scraping the UI.

Workspace does not bundle organization-specific tools, instructions, document libraries, or cloud accounts.

Current desktop boundaries: Google Drive works through a Drive-for-desktop folder rather than native cloud mirroring, and first-run model-provider setup uses API keys. General native provider OAuth and direct Drive API sync are intentionally left for later provider-adapter releases. Restricted apps already have a separate, app-scoped OAuth PKCE connection lane for providers that publish compatible public-client metadata.

For the durable design rationale, context rules, and roadmap, see [Product model and roadmap](docs/product-model.md). For the shared control plane, CLI, and real-agent driver, see [Workspace management layer](docs/management-layer.md). For scopes, trust, Skill packs, Extensions, and packages, see [Assistant capabilities](docs/assistant-capabilities.md). The [desktop experience parity contract](docs/ui-parity.md) records the mature interactions this extraction must preserve, while the [visual system](docs/visual-design.md) defines the restrained shell, typography, icon, and layout rules.

## Restricted Space apps

Workspace's restricted-app lane lets an Assistant build an interactive app for one Space without turning generated code into a full-trust Pi Extension. The app can own a navigator destination in the contributed rail, open and restore persistent right-side work tabs, expose bounded Assistant actions, keep machine-local JSON state, call explicitly reviewed network targets, work inside a separately selected Space file or folder, and declare independently controlled named automations coordinated by one scheduler across every Space.

The normal creation path begins in a Space Chat:

1. The Assistant writes a complete, already-built package inside the Space and calls the host-owned `propose_space_app` tool with only its Space-relative folder.
2. Workspace inspects the package without evaluating JavaScript and returns a digest-pinned review to that owning Chat.
3. The person chooses whether to install that exact revision. Installation grants only bounded app storage; network destinations, files, notification categories, saved connections, and every automation remain off.
4. **Capabilities → Apps in this Space** manages each authority separately. The app itself opens from the contributed rail and may create normal Space-owned tabs in the work area.

Revoking a destination stops brokered requests but does not silently delete a saved credential; **Disconnect** removes the machine-local encrypted record. Provider-side token or API-key revocation remains the provider's responsibility. Updating an app preserves its local JSON storage but resets grants, connections, notification access, automation settings, and run receipts so a new digest cannot inherit old powers.

Start with [Restricted app authoring](docs/restricted-app-authoring.md) to build a package, [Restricted app runtime](docs/restricted-app-runtime.md) for the security and lifecycle contract, and the [Connected inbox example](examples/packages/restricted-connected-inbox/README.md) for a runnable rail, tab, loopback service, storage, automation, and notification walkthrough.

## Management layer

`WorkspaceKernel` is the shared in-process read authority for the product. It resolves an actor to a Space, returns versioned Space and running-task snapshots, and projects Pi's authoritative capability catalog with scope, provenance, trust, package, and diagnostic information. The renderer/local API and the installed CLI use that same kernel instance; writes still go through the domain services that own trust, filesystem, History, and concurrency policy.

This is the first management primitive for a future cross-Space Assistant and controlled Space runtimes, not a hidden mutation API. Protocol v1 is deliberately read-only and exposes no file contents, conversation text, credentials, or provider tokens. See [Workspace management layer](docs/management-layer.md) for the architecture, transport, security boundary, code map, and roadmap.

## Development

Use Node 22.19.0 or newer.

```bash
npm install
npm run local:dev
```

Useful checks:

```bash
npm run check
npm test
npm run desktop:prepare
npm run desktop:package:smoke
npm run desktop:make
npm run desktop:make:mac
```

`desktop:package:smoke` creates and verifies the canonical Windows Electron Builder unpacked app while skipping NSIS installer and updater-artifact creation. The slower `desktop:package` command retains a Forge package lane for targeted diagnostics. `desktop:make` builds the Windows NSIS candidate; `desktop:make:mac` builds the non-interactive, separately identified `Workspace Local Smoke` artifacts; `desktop:release:mac` signs, notarizes, verifies, and publishes the production Mac artifacts.

Use `npm run local:dev` for the fast UI loop, `check` and `test` for normal implementation feedback, and `desktop:prepare` for desktop integration. See [Windows builds](docs/windows-build.md) and [macOS builds](docs/macos-build.md) for platform packaging and release gates.

CI runs `check`, `test`, and `desktop:package:smoke`, so every branch verifies the same unpacked Electron Builder layout used by the release lane without paying the NSIS cost.

### Developing with Codex or Claude Code

The repository has one contributor contract: [AGENTS.md](AGENTS.md). Codex reads it directly. The tracked [CLAUDE.md](CLAUDE.md) uses Claude Code's `@AGENTS.md` import so both harnesses receive the same product rails, commands, test expectations, and release rules without duplicated prose.

To exercise one real Assistant turn through the same local API, Pi runtime, tools, Skills, Extensions, persistence, and event stream as the desktop app:

```powershell
npm run workspace:drive -- --workspace C:\path\to\space --prompt "Summarize this Space"
npm run workspace:drive -- --workspace C:\path\to\space --prompt "..." --json --agent-dir C:\temp\isolated-pi
```

In-process driver runs use temporary application state unless `WORKSPACE_STATE_DIR` is set. Use `--attach http://127.0.0.1:4327` to drive an already-running development API. This driver performs a real agent turn; it is distinct from the read-only installed management CLI below.

## Workspace CLI

The Windows installer includes a `workspace` command and adds its package-root `bin` directory to the current user's `PATH`. The Mac app carries the same command under `Workspace.app/Contents/bin`; Workspace adds that directory to child processes so Pi shell tools can use it. A DMG does not silently edit shell profiles, so exposing the command to unrelated Terminal sessions remains an explicit installation action.

The command uses a bounded protocol-v1 handoff under the platform application-data directory: `%APPDATA%\Workspace\cli` on Windows and `~/Library/Application Support/Workspace/cli` on macOS. It writes one atomic request, starts or contacts the packaged app, returns stdout, stderr, and the exit code, and removes the response. Platform helpers remain outside `app.asar`, and Electron's `RunAsNode` fuse stays disabled.

```powershell
workspace context --json
workspace spaces list
workspace tasks list --space "Personal Space"
workspace capabilities list --space "Personal Space" --json
```

Protocol v1 is deliberately read-only. It gives people, scripts, and the Assistant a shared way to inspect the Space resolved from the terminal's current folder, the registered Spaces, host-managed running tasks, and capability inventory—including inactive tools or configured packages that are not currently loaded. The handoff trusts the current operating-system user; mutating commands will require an authenticated transport and explicit authorization in a later protocol version.

Human-readable output is the default. Use `--json` for automation and `--space <id-or-exact-name>` when the terminal's current folder is not enough context. See [Workspace management layer](docs/management-layer.md) for snapshot fields, resolution rules, broker limits, and the distinction between this CLI and `workspace:drive`.

## Windows releases

Pushing an exact version tag such as `v<package version>` runs the Windows release workflow and publishes the installer plus updater metadata to [GitHub Releases](https://github.com/Mat-Tom-Son/workspace/releases). The installed app checks that public feed shortly after startup, every four hours, and when you choose **Help > Check for Updates…**. An unpacked `desktop:package:smoke` build intentionally disables updater controls because Electron Builder does not generate `resources/app-update.yml` for that lane.

The release workflow supports an optional PFX certificate through GitHub secrets. The included personal certificate helper creates a self-signed identity outside the repository; this signs artifacts consistently but does not establish public Windows trust. Until a certificate-authority-backed identity is configured, users may still see Unknown Publisher or SmartScreen warnings.

See [Windows builds](docs/windows-build.md) and [Windows releases and signing](docs/windows-release.md).

## macOS status

`npm run desktop:make:mac` builds the non-interactive, separately identified `Workspace Local Smoke` Apple silicon structural candidate. `npm run desktop:release:mac` builds, Developer ID-signs, notarizes, staples, verifies, and draft-first publishes the production artifacts to the separate public Mac feed. Packaged production Mac builds update from that feed; a signed 0.2.8 to 0.2.9 installed update has passed end to end. See [macOS build and release lane](docs/macos-build.md) and [macOS release runbook](docs/macos-release.md).

## Pi integration resources

The user-facing **Library** contains personal materials. Separately, Workspace follows Pi's native resource locations for Assistant configuration rather than maintaining a parallel tool system:

- User resources: the configured Pi agent directory (normally `~/.pi/agent`).
- Portable project resources: `.pi/` inside a folder the user has registered as a Space. Registration itself is Workspace's authorization to load that exact local Pi configuration.
- Packages: npm, git, HTTPS, and local package sources supported by Pi, managed as provenance and lifecycle records inside Capabilities.

Npm and git package sources use the corresponding command-line tools on `PATH`; local package paths and Skill imports do not require them. The packaged app uses Pi's normal global agent directory (typically `~/.pi/agent`) for packages and resources, while provider credentials are encrypted by the operating system for Workspace. Internal APIs and code may retain terms such as `workspace`, `project`, and `resource` where they identify existing Pi or storage concepts; those names do not change the user-facing Space, Library, Skill, and Extension model.

See [Assistant capabilities](docs/assistant-capabilities.md) for the product-facing model and [Pi resource compatibility](docs/pi-resources.md) for the compact implementation reference.

## Documentation map

- [Product model and roadmap](docs/product-model.md) — durable nouns, context rules, product rails, and future direction.
- [Architecture](docs/architecture.md) and [management layer](docs/management-layer.md) — runtime boundaries, shared kernel, CLI, and agent harness.
- [Assistant capabilities](docs/assistant-capabilities.md), [Extension surfaces](docs/extension-surfaces.md), [restricted app authoring](docs/restricted-app-authoring.md), [restricted app runtime](docs/restricted-app-runtime.md), and [Pi compatibility](docs/pi-resources.md) — Skills, full-trust Extensions, restricted apps, packages, scopes, authoring, and authorization.
- [Workspace 0.2.11 release notes](docs/releases/0.2.11.md) — first-request native Mac Quit behavior, the deferred graceful-shutdown coordinator, updater safety, and upgrade guidance.
- [Workspace 0.2.10 release notes](docs/releases/0.2.10.md) — native macOS chrome, menus, Finder and Quick Look workflows, close/reopen continuity, security boundaries, and upgrade guidance.
- [Workspace 0.2.9 release notes](docs/releases/0.2.9.md) — named Space-app automations, per-job authority, durable cadence, run receipts, and upgrade guidance.
- [Workspace 0.2.8 release notes](docs/releases/0.2.8.md) — the shipped Space-app foundation, security boundary, example, verification, and known limits.
- [Desktop parity](docs/ui-parity.md) and [visual system](docs/visual-design.md) — required interactions and design rules.
- [Windows build](docs/windows-build.md), [Windows release runbook](docs/windows-release.md), [macOS build lane](docs/macos-build.md), and [macOS release runbook](docs/macos-release.md) — verification, signing, updater, and publishing boundaries.
- [Contributing](CONTRIBUTING.md), [Security](SECURITY.md), and [Privacy](PRIVACY.md) — repository and user-data policies.

## Project policies

- [Contributing](CONTRIBUTING.md)
- [Security](SECURITY.md)
- [Privacy](PRIVACY.md)
- [MIT License](LICENSE)
