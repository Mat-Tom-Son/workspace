# Workspace

Workspace is a local-first Electron app for working with folders, files, and a native [Pi](https://pi.dev) agent in one place.

The desktop app keeps your content in ordinary folders. Provider credentials, conversations, and app preferences live in application or Pi storage outside those folders unless you intentionally add portable `.pi` project configuration.

## What it supports

- Local folders as workspaces, including folders synchronized by tools such as Google Drive for desktop.
- File browsing, uploads, previews, chat attachments, and ordinary-folder access.
- Pi's normal built-in tools, provider/model selection, authentication, prompt templates, context files, and packages.
- Global and trusted-project Pi extensions.
- Agent Skills from standard `SKILL.md` directories, `.skill`/ZIP bundles, and skill-only imports from compatible multi-skill packs.

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
```

`desktop:package` produces an unpacked local app for verification. `desktop:make` produces an unsigned NSIS installer for personal testing. A public updater and signing lane are intentionally not configured; establish a new release repository and signing identity before distributing installers.

## Pi resources

Workspace follows Pi's native resource locations rather than maintaining a separate tool system:

- User resources: the configured Pi agent directory (normally `~/.pi/agent`).
- Portable project resources: `.pi/` inside a workspace that the user has explicitly trusted.
- Packages: npm, git, HTTPS, and local package sources supported by Pi.

Npm and git package sources use the corresponding command-line tools on `PATH`; local package paths and Skill imports do not require them. The packaged app uses Pi's normal global agent directory (typically `~/.pi/agent`) for packages and resources, while provider credentials are encrypted by the operating system for Workspace.

See [Pi resources and compatibility](docs/pi-resources.md) for the trust and skill-pack model.
