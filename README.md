# Workspace

Workspace is a local-first Electron app that gives every kind of computer work a place, with a native [Pi](https://pi.dev) assistant built in.

In the product, that place is called a **Space**: an understandable working context backed by an ordinary folder. A person can create a new Space and let Workspace create its folder, or turn an existing folder on their computer into a Space without moving or converting its files. Provider credentials, conversations, and app preferences live in application or Pi storage outside Space folders unless the person intentionally adds portable `.pi` project configuration.

## Product model

| Concept | What it means |
|---|---|
| **Workspace** | The product: an environment for general computer work. |
| **Space** | Everything associated with one activity, backed by an ordinary folder. |
| **Library** | Reusable personal materials that can be brought into any Space. |
| **Skill** | A reusable way of working that guides the Assistant. |
| **Extension** | A capability or connection the Assistant can use. |

The primary navigation follows the same model:

- **Space**
- **Chats**
- **Library**
- **History**
- **Assistant**
  - **Setup**
  - **Skills**
  - **Extensions**

The folder is an implementation detail, but never a proprietary boundary. Space files remain ordinary files that can be opened in other apps, synchronized by desktop storage tools, backed up, or revealed in the operating system.

## What it supports

- Creating a new Space or turning an existing local folder into a Space, including folders synchronized by tools such as Google Drive for desktop.
- Space file browsing, uploads, previews, chat attachments, and ordinary-folder access.
- A personal Library for organizing reusable files and copying them into Spaces when needed.
- Pi's normal built-in tools, provider/model selection, authentication, prompt templates, context files, and packages.
- Global and trusted-project Pi extensions.
- Agent Skills from standard `SKILL.md` directories, `.skill`/ZIP bundles, and skill-only imports from compatible multi-skill packs.
- Assisted Windows installation and GitHub-hosted application updates.

Workspace does not bundle organization-specific tools, instructions, document libraries, or cloud accounts.

Current desktop boundaries: Google Drive works through a Drive-for-desktop folder rather than native cloud mirroring, and first-run provider setup uses API keys. Native OAuth setup and direct Drive API sync are intentionally left for a later provider-adapter release.

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
npm run desktop:package
npm run desktop:make
```

`desktop:package` produces a Forge package for local verification. `desktop:make` builds and verifies the release-ready NSIS installer, blockmap, embedded GitHub feed configuration, and `latest.yml` under `out/builder`.

## Windows releases

Pushing a version tag such as `v0.1.0` runs the Windows release workflow and publishes the installer plus updater metadata to [GitHub Releases](https://github.com/Mat-Tom-Son/workspace/releases). The installed app checks that public feed shortly after startup, every four hours, and when you choose **Help > Check for Updates…**.

The release workflow supports an optional PFX certificate through GitHub secrets. The included personal certificate helper creates a self-signed identity outside the repository; this signs artifacts consistently but does not establish public Windows trust. Until a certificate-authority-backed identity is configured, users may still see Unknown Publisher or SmartScreen warnings.

See [Windows builds](docs/windows-build.md) and [Windows releases and signing](docs/windows-release.md).

## Pi integration resources

The user-facing **Library** contains personal materials. Separately, Workspace follows Pi's native resource locations for Assistant configuration rather than maintaining a parallel tool system:

- User resources: the configured Pi agent directory (normally `~/.pi/agent`).
- Portable project resources: `.pi/` inside a Space folder that the user has explicitly trusted.
- Packages: npm, git, HTTPS, and local package sources supported by Pi.

Npm and git package sources use the corresponding command-line tools on `PATH`; local package paths and Skill imports do not require them. The packaged app uses Pi's normal global agent directory (typically `~/.pi/agent`) for packages and resources, while provider credentials are encrypted by the operating system for Workspace. Internal APIs and code may retain terms such as `workspace`, `project`, and `resource` where they identify existing Pi or storage concepts; those names do not change the user-facing Space, Library, Skill, and Extension model.

See [Pi resources and compatibility](docs/pi-resources.md) for the trust and skill-pack model.
