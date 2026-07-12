# Windows build

Workspace requires Node 22.19.0 or newer.

## Feedback ladder

Desktop release builds are intentionally thorough and therefore slow: they rebuild multiple processes, run Pi resource preflight, package Electron, create NSIS/update artifacts, and verify the result. That cost belongs at the release boundary, not in every edit-run cycle.

Use the smallest lane that exercises the layer you changed:

| Lane | Commands | Use it for |
|---|---|---|
| Type and behavior | `npm run check`, then `npm test` | Normal implementation feedback and every behavior handoff. |
| Desktop integration | `npm run desktop:prepare` | Electron/local API changes, runtime resources, renderer production build, and preflight. |
| Release-layout smoke | `npm run desktop:package:smoke` | Packaged-path behavior, Electron assets, preload/main integration, and local QA without NSIS compression. |
| Installer/release | `npm run desktop:make` | A versioned Windows release candidate only. |

During UI work, `npm run local:dev` is the normal live-reload loop. Run independent checks in parallel when the machine has capacity. Do not repeatedly run `desktop:make` to validate a renderer-only copy or styling change; promote the change through the later lanes once it is ready to hand off.

The lanes are cumulative confidence, not interchangeable artifacts. A passing development server does not verify ASAR/package paths, and an unpacked app does not verify the NSIS updater output. The retained `npm run desktop:package` command creates the slower Forge package and is useful only when diagnosing or changing that alternate lane; routine packaged QA should use `desktop:package:smoke` because it shares Electron Builder configuration with the release.

Electron Builder's unpacked `--dir` lane does not generate `resources/app-update.yml`. Workspace therefore keeps updater controls disabled in that smoke package instead of presenting a missing-feed error. The NSIS `desktop:make` lane and the tagged GitHub build are the updater verification boundary.

In one warm local comparison on the primary Windows workstation, `desktop:package:smoke` completed in about 68 seconds and the Forge `desktop:package` lane took about 412 seconds—roughly 6.2 times faster and nearly six minutes saved. Exact times depend on hardware and caches; the structural saving comes from using the release packager while skipping the alternate Forge pass and NSIS artifact work.

CI runs `check`, `test`, and `desktop:package:smoke`. Because the smoke command already includes `desktop:prepare`, CI does not run preparation as a separate duplicate step.

## Full Windows candidate

```powershell
npm run check
npm test
npm run desktop:make
```

`desktop:prepare` builds the renderer and Electron runtime and runs a native Pi resource smoke test. `desktop:package:smoke` adds Electron Builder's unpacked application plus packaged-asset and fuse verification. `desktop:make` includes preparation and uses Electron Builder as the canonical installer lane so the unpacked app, Electron fuses, NSIS installer, blockmap, `latest.yml`, and embedded `app-update.yml` come from one build.

Both package lanes place the public `workspace.cmd` launcher, an extensionless `workspace` shim for Pi/Git Bash, and the private `workspace-cli.ps1` helper in `<package>\bin`, outside `app.asar`; packaged-asset verification rejects missing or accidentally archived shims. PowerShell and Command Prompt resolve the CMD launcher, which explicitly invokes the private helper with `-ExecutionPolicy Bypass`; POSIX-style shells resolve the extensionless shim and delegate to that same CMD entry point. Electron Builder copies the directory with `extraFiles`, and the retained Forge diagnostic lane mirrors it with an `afterComplete` hook. `RunAsNode` stays disabled—the command communicates with the desktop process through protocol-v1 request and response files instead of executing JavaScript through Electron.

The NSIS include adds `<install>\bin` idempotently to the current user's `HKCU\Environment\Path`, broadcasts `WM_SETTINGCHANGE`, and removes only that entry during uninstall. It does not modify any shell profile. The shim normally launches the parent `Workspace.exe`; `WORKSPACE_CLI_APP` and the bounded `WORKSPACE_CLI_TIMEOUT_MS` override exist for unpacked automated tests and should not be set by the installer.

Protocol v1 exposes only read operations (`context`, `spaces list`, `tasks list`, and `capabilities list`). Its request directory is a same-user coordination channel, not an authenticated caller boundary. Do not add mutations to this protocol without caller authorization and an authenticated transport or equivalent per-launch request authentication.

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
