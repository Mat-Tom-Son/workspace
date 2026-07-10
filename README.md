# Workspace

Workspace is a local-first Electron app for working with folders, files, and a native [Pi](https://pi.dev) agent in one place.

The desktop app keeps your content in ordinary folders. Provider credentials, conversations, and app preferences live in application or Pi storage outside those folders unless you intentionally add portable `.pi` project configuration.

## What it supports

- Local folders as workspaces, including folders synchronized by tools such as Google Drive for desktop.
- File browsing, uploads, previews, chat attachments, and ordinary-folder access.
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

## Pi resources

Workspace follows Pi's native resource locations rather than maintaining a separate tool system:

- User resources: the configured Pi agent directory (normally `~/.pi/agent`).
- Portable project resources: `.pi/` inside a workspace that the user has explicitly trusted.
- Packages: npm, git, HTTPS, and local package sources supported by Pi.

Npm and git package sources use the corresponding command-line tools on `PATH`; local package paths and Skill imports do not require them. The packaged app uses Pi's normal global agent directory (typically `~/.pi/agent`) for packages and resources, while provider credentials are encrypted by the operating system for Workspace.

See [Pi resources and compatibility](docs/pi-resources.md) for the trust and skill-pack model.
