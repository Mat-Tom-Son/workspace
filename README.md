# Workspace

Workspace is a local-first Electron app that gives every kind of computer work a place, with a native [Pi](https://pi.dev) assistant built in.

In the product, that place is called a **Space**: an understandable working context backed by an ordinary folder. A person can create a new Space and let Workspace create its folder, or turn an existing folder on their computer into a Space without moving or converting its files. Each Space keeps its portable identity and Chats in a hidden `.workspace/` directory. Executable project capabilities remain separate under `.pi/`; provider credentials, trust, History objects, sessions, ignore rules, and app preferences stay in protected application or Pi storage outside the Space.

The core idea is simple: the folder stays ordinary; Workspace makes it feel like a place you can understand, return to, and work in with an Assistant.

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

Provider, model, API-key, and OAuth setup lives under **Settings → Assistant**.

The folder is an implementation detail, but never a proprietary boundary. Space files remain ordinary files that can be opened in other apps, synchronized by desktop storage tools, backed up, or revealed in the operating system.

Workspace reserves two hidden support directories inside a Space: `.workspace/` for the portable `space.json` identity and append-only conversation logs, and `.pi/` for native Pi project configuration. Neither appears in the Files surface or History checkpoints. Removing a linked Space from the app leaves `.workspace/` with the folder; deleting a managed Space deletes its folder normally.

## What it supports

- Creating a new Space or turning an existing local folder into a Space, including folders synchronized by tools such as Google Drive for desktop.
- Space file browsing, uploads, previews, chat attachments, and ordinary-folder access.
- A personal Library for organizing reusable files and copying them into Spaces when needed.
- Pi's normal built-in tools, provider/model selection, authentication, prompt templates, context files, and packages.
- One Capabilities surface for installed Skills and Extensions, official/reference sources, community Pi packages, provenance, scope, diagnostics, update, and removal.
- Global and trusted-Space Pi Extensions.
- [Agent Skills](https://agentskills.io) from standard `SKILL.md` directories, `.skill`/ZIP bundles, and skill-only imports from compatible multi-skill packs.
- Assisted Windows installation and GitHub-hosted application updates.

Workspace does not bundle organization-specific tools, instructions, document libraries, or cloud accounts.

Current desktop boundaries: Google Drive works through a Drive-for-desktop folder rather than native cloud mirroring, and first-run provider setup uses API keys. Native OAuth setup and direct Drive API sync are intentionally left for a later provider-adapter release.

For the durable design rationale, context rules, and roadmap, see [Product model and roadmap](docs/product-model.md). For scopes, trust, Skill packs, Extensions, and packages, see [Assistant capabilities](docs/assistant-capabilities.md). The [desktop experience parity contract](docs/ui-parity.md) records the mature interactions this extraction must preserve, while the [visual system](docs/visual-design.md) defines the restrained shell, typography, icon, and layout rules.

## Development

Use Node 22.19.0 or newer.

```powershell
npm install
npm run local:dev
```

Useful checks:

```powershell
npm run check
npm test
npm run desktop:prepare
npm run desktop:package:smoke
npm run desktop:make
```

`desktop:package:smoke` creates and verifies the canonical Electron Builder unpacked app while skipping NSIS installer and updater-artifact creation. The slower `desktop:package` command retains a Forge package lane for targeted diagnostics. `desktop:make` builds and verifies the release-ready NSIS installer, blockmap, embedded GitHub feed configuration, and `latest.yml` under `out/builder`.

Use `npm run local:dev` for the fast UI loop, `check` and `test` for normal implementation feedback, `desktop:prepare` for desktop integration, `desktop:package:smoke` for release-layout QA, and `desktop:make` only for a versioned release candidate. See [Windows builds](docs/windows-build.md) for the complete verification ladder.

CI runs `check`, `test`, and `desktop:package:smoke`, so every branch verifies the same unpacked Electron Builder layout used by the release lane without paying the NSIS cost.

## Windows releases

Pushing a version tag such as `v0.1.1` runs the Windows release workflow and publishes the installer plus updater metadata to [GitHub Releases](https://github.com/Mat-Tom-Son/workspace/releases). The installed app checks that public feed shortly after startup, every four hours, and when you choose **Help > Check for Updates…**.

The release workflow supports an optional PFX certificate through GitHub secrets. The included personal certificate helper creates a self-signed identity outside the repository; this signs artifacts consistently but does not establish public Windows trust. Until a certificate-authority-backed identity is configured, users may still see Unknown Publisher or SmartScreen warnings.

See [Windows builds](docs/windows-build.md) and [Windows releases and signing](docs/windows-release.md).

## Pi integration resources

The user-facing **Library** contains personal materials. Separately, Workspace follows Pi's native resource locations for Assistant configuration rather than maintaining a parallel tool system:

- User resources: the configured Pi agent directory (normally `~/.pi/agent`).
- Portable project resources: `.pi/` inside a Space folder that the user has explicitly trusted.
- Packages: npm, git, HTTPS, and local package sources supported by Pi, managed as provenance and lifecycle records inside Capabilities.

Npm and git package sources use the corresponding command-line tools on `PATH`; local package paths and Skill imports do not require them. The packaged app uses Pi's normal global agent directory (typically `~/.pi/agent`) for packages and resources, while provider credentials are encrypted by the operating system for Workspace. Internal APIs and code may retain terms such as `workspace`, `project`, and `resource` where they identify existing Pi or storage concepts; those names do not change the user-facing Space, Library, Skill, and Extension model.

See [Assistant capabilities](docs/assistant-capabilities.md) for the product-facing model and [Pi resource compatibility](docs/pi-resources.md) for the compact implementation reference.

## Project policies

- [Contributing](CONTRIBUTING.md)
- [Security](SECURITY.md)
- [Privacy](PRIVACY.md)
- [MIT License](LICENSE)
