# Windows build

Workspace requires Node 22.19.0 or newer.

```powershell
npm run check
npm test
npm run desktop:prepare
npm run desktop:package
npm run desktop:make
```

`desktop:prepare` builds the renderer and Electron runtime and runs a native Pi resource smoke test. `desktop:package` verifies the Forge package used for local QA. `desktop:make` uses Electron Builder as the canonical installer lane so the unpacked app, Electron fuses, NSIS installer, blockmap, `latest.yml`, and embedded `app-update.yml` come from one build.

For an unsigned NSIS installer:

```powershell
npm run desktop:make
```

For a build signed with the current user's personal certificate:

```powershell
.\scripts\create-personal-signing-certificate.ps1
.\scripts\build-signed-windows.ps1
```

The PFX and its DPAPI-protected password are stored in `%USERPROFILE%\.workspace-signing`, never in this repository. The certificate is self-signed and therefore remains untrusted on other computers unless they deliberately trust its public certificate. Replace the two GitHub signing secrets with a certificate-authority-backed PFX when one is available.

Use Node 22.19.0 or newer. On the primary development workstation, `build-signed-windows.ps1` deliberately invokes the bundled Node runtime rather than the older system Node.

See [Windows releases and signing](windows-release.md) for the public tag workflow.
