# Windows releases and signing

Workspace updates from the public releases in `Mat-Tom-Son/workspace`. Keep the application ID, executable name, package name, and repository stable so installed copies continue to recognize later versions.

## Release flow

1. Update `package.json` to a version that has never been released.
2. Run `npm run check`, `npm test`, and `npm run desktop:make` with Node 22.19.0 or newer.
3. Commit and push the clean `main` branch.
4. Create and push the exact tag `v<package version>`.
5. The `Windows Release` workflow rebuilds from the tag, verifies the feed and installer, creates a draft release, uploads every required asset, and only then publishes it.

Every release must contain artifacts from the same build:

- `Workspace-Setup-<version>.exe`
- `Workspace-Setup-<version>.exe.blockmap`
- `latest.yml`
- `SHA256SUMS.txt`

Draft releases are not update candidates. Do not replace an installer beneath an existing version: bump the version and publish a new tag instead. Rollbacks likewise require a newer version containing the desired older behavior.

## Updater behavior

The packaged `resources/app-update.yml` points to the public GitHub repository. Workspace never embeds a GitHub token and never overrides that feed at runtime. Installed Windows builds check silently after startup and every four hours; **Help > Check for Updates…** performs an interactive check. Downloads use the SHA-512 value in `latest.yml`, and a downloaded update is offered on restart.

## Signing

GitHub Actions recognizes these optional repository secrets:

- `WIN_CSC_LINK`: base64-encoded PFX bytes.
- `WIN_CSC_KEY_PASSWORD`: the PFX password.

If `WIN_CSC_LINK` exists, the workflow requires the installer to contain a signer certificate. If it is absent, the workflow creates an honest unsigned preview release. No Azure tenant, company certificate, or organization credential is used.

`scripts/create-personal-signing-certificate.ps1` creates an exportable self-signed code-signing identity in the current user's Windows certificate store and backs it up outside the repository. That is useful for stable personal artifact identity and testing the signing lane, but Windows does not publicly trust it. While that certificate is in use, the update feed deliberately omits `publisherName`; GitHub-hosted SHA-512 metadata is enforced, but Authenticode is not treated as a public trust anchor.

A trusted individual developer in the United States or Canada can later consider Microsoft Artifact Signing, or use an OV/EV certificate from a certificate authority. After replacing the two PFX secrets with a publicly trusted identity, set the repository variable `WORKSPACE_TRUSTED_CODE_SIGNING=1`. The build will then embed the publisher name and electron-updater will require a valid matching Authenticode signature. Keep the private PFX and password secret in every case.

Test that transition through an update from an older installed version before treating the new signing lane as production-ready.
