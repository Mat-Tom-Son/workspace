# Windows releases and signing

Workspace updates from the public releases in `Mat-Tom-Son/workspace`. Keep the application id, executable name, package name, repository, and updater cache name stable so installed copies continue to recognize later versions.

- [Public releases](https://github.com/Mat-Tom-Son/workspace/releases)
- [GitHub Actions](https://github.com/Mat-Tom-Son/workspace/actions)

## Release contract

Every public release is rebuilt from an exact `v<package version>` tag and must contain four artifacts from that one cloud build:

- `Workspace-Setup-<version>.exe`
- `Workspace-Setup-<version>.exe.blockmap`
- `latest.yml`
- `SHA256SUMS.txt`

Draft releases are not update candidates. Never replace an installer or manifest beneath an existing version. Fixes and rollbacks both require a newer unique version and tag.

## Maintainer runbook

### 1. Prepare a unique version

Start from a clean `main` branch and use Node 24 when available; the supported floor is Node 22.19.0.

```powershell
npm version patch --no-git-tag-version
npm ci
npm run check
npm test
npm audit --audit-level=high
npm run desktop:make
git diff --check
```

Use `./scripts/build-signed-windows.ps1` instead of the final `desktop:make` command when building with the current user's personal certificate. `desktop:make` verifies the local NSIS candidate but never publishes it.

`desktop:make` includes `desktop:prepare`; a release candidate therefore must pass both native Pi preflight and the real-Electron restricted-app probe before Electron Builder creates the installer. Do not accept a Node-only sandbox test, a skipped Electron probe, or a package produced after that probe failed.

Review the complete diff and inspect the exact unpacked application and installer as described in [Windows build](windows-build.md). Confirm the version, Files/Space language, tabs, menus, background turn continuity, CLI, Mica/fallback, updater surface, and the restricted-app install/review, rail/tab, default-off grant and automation, run-receipt, storage, notification, suspend, and teardown paths. The local and cloud installers are separate builds, so use local QA to validate behavior rather than expecting byte-for-byte identity.

Prepare a complete checked-in release note at `docs/releases/<version>.md`. The tagged workflow can generate comparison metadata, but the public release body must explain material user-facing behavior, authorization and security boundaries, known limitations, upgrade behavior, and verification. Do not leave a feature release with only a generated changelog link.

### 2. Commit, push, and gate the tag

```powershell
git add -A
git commit -m "release: Workspace <version>"
git push origin main
```

Wait for the `CI` workflow on that exact commit to complete successfully. It runs type checks, tests, and the canonical unpacked Electron Builder smoke package as separate steps. Do not tag a commit whose main-branch CI is missing, cancelled, or failing.

Create an annotated tag pointing to the same commit and push only that tag:

```powershell
git tag -a v<version> -m "Workspace <version>"
git push origin v<version>
```

The tag must match `package.json` exactly. Do not move or recreate a published tag.

### 3. Watch the tagged workflows

The tag starts both `CI` and `Windows Release`. The release workflow performs independent named steps for:

1. tag/version validation;
2. dependency installation;
3. source checks;
4. tests;
5. high-severity dependency audit;
6. Windows installer build and release verification, including the real-Electron restricted-app probe inherited from `desktop:prepare`;
7. SHA-256 checksum generation;
8. retained workflow-artifact upload; and
9. draft creation followed by public release publication.

After publication, compare the generated GitHub body with `docs/releases/<version>.md`. Replace the generated-only body with the checked-in release note when needed, retaining a full-changelog link. This is a documentation correction, not permission to replace artifacts or reuse the tag.

Each gate is a separate workflow step so a later successful command cannot mask an earlier test or audit failure. Treat any failed workflow as an unaccepted release. Inspect whether GitHub created a draft or public asset before the failure; if it did, never reuse that version or tag. Diagnose the failure, bump the version, and repeat from a clean commit.

### 4. Verify the public release independently

Do not stop at a green workflow badge. Fetch the public release and verify:

- all four required assets exist and are non-empty;
- `latest.yml` reports the intended version, installer name, installer size, and SHA-512;
- downloaded `latest.yml`, blockmap, and installer SHA-256 values match `SHA256SUMS.txt`;
- the downloaded installer's computed SHA-512 matches `latest.yml`;
- Authenticode contains the expected signer when signing was required; and
- the public release is neither a draft nor a prerelease; and
- the public release body reflects the checked-in `docs/releases/<version>.md` instead of only linking to a generated comparison.

GitHub's release API exposes asset names, sizes, URLs, and SHA-256 digests for an additional cross-check. Keep downloaded verification files outside the repository and remove them after the audit.

### 5. Exercise the installed updater

When possible, keep a lower installed version for the final smoke test:

1. Confirm the installed version and `resources/app-update.yml`. Record one installed version-2 restricted app's reviewed digest, grants, connection status, automation settings and recent receipt count, and a harmless local-storage value when available.
2. Open **Help > Check for Updates…**.
3. Confirm the new version is offered without a missing-feed or network error.
4. Choose **Update now** to download it.
5. Confirm Workspace performs its update-specific shutdown and relaunch after the download. If a ready-update prompt appears instead, exercise **Restart now** or choose **Later** and then explicitly quit the app.
6. Confirm the restarted installed application reports the new version and preserves its Spaces, Chats, preferences, Pi state, version-2 restricted-app installs and reviewed digests, explicit grants, encrypted connection status, automation settings and receipts, and local app storage. Reopen the app's owning Space and verify its rail surface and any persistent Space-owned tab still resolve to that Space.

Do not silently install over a user's test environment merely to verify a release; leave the lower installed version available when the user is meant to exercise the update themselves.

## Updater behavior and feed gating

The NSIS/installed package contains `resources/app-update.yml`, which points to the public GitHub repository. Workspace never embeds a GitHub token and never overrides that feed at runtime. Installed Windows builds check silently after startup and every four hours; **Help > Check for Updates…** performs an interactive check.

Checks do not download an update. When a version is available, the user chooses **Update now**. Workspace downloads the installer, validates the SHA-512 from `latest.yml`, performs its update-specific shutdown, and asks electron-updater to relaunch. If a downloaded update becomes ready outside that immediate action, Workspace offers **Restart now** or **Later**; a ready update chosen for Later installs on explicit application quit.

Electron Builder's unpacked `--dir` smoke lane does not create `resources/app-update.yml`. Workspace deliberately reports updates as unsupported in that package instead of showing a red missing-manifest error. The installed NSIS package and tagged release are the updater boundary.

## Signing

GitHub Actions recognizes these optional repository secrets:

- `WIN_CSC_LINK`: base64-encoded PFX bytes.
- `WIN_CSC_KEY_PASSWORD`: the PFX password.

The workflow derives `WORKSPACE_REQUIRE_CODE_SIGNING=1` when a PFX secret exists, which makes a missing installer signature fail the build. If the secret is absent, the workflow publishes an honestly unsigned public release; it does not use Azure, company credentials, or an implicit local certificate.

`scripts/create-personal-signing-certificate.ps1` creates an exportable self-signed code-signing identity in the current user's Windows certificate store and backs it up under `%USERPROFILE%\.workspace-signing`, outside the repository. It provides stable personal artifact identity but not public Windows trust. Other computers may report an untrusted root or SmartScreen warning even though the artifact contains that signature.

While the personal self-signed certificate is in use, set the repository variable `WORKSPACE_TRUSTED_CODE_SIGNING=0`. The update feed then omits `publisherName`: GitHub SHA-512 metadata remains enforced, but Authenticode is not treated as a public trust anchor.

After configuring a publicly trusted signing lane, set `WORKSPACE_TRUSTED_CODE_SIGNING=1`. The current workflow can accept a CA-backed OV/EV PFX through the two secrets above; Microsoft Artifact Signing would require a separate, deliberately implemented cloud-signing integration rather than a PFX substitution. With trusted signing enabled, Electron Builder embeds the publisher name and electron-updater requires a matching valid signature. Test that transition through an update from an older installed version before treating the new identity as production-ready.

Keep every PFX, password, private key, provider credential, and temporary verification download outside source control. See [Security](../SECURITY.md) for the release-integrity boundary.
