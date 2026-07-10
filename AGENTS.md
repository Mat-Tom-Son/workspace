# Workspace contributor guide

Workspace is a local-first Electron shell around ordinary folders and the native Pi agent runtime.

## Product boundaries

- Use **Workspace** as the user-facing product name.
- Keep package, protocol, IPC, updater, user-data, and environment identifiers independent and product-neutral.
- Keep provider credentials and application state outside user content folders.
- Treat project `.pi` resources as executable configuration: load them only after the user trusts the folder.
- Prefer Pi's built-in tools, resource loader, auth storage, model registry, package manager, skills, and extensions over app-specific replacements.
- Do not bundle proprietary tools, instructions, source libraries, or account integrations.

## Development

- Use Node 22.19.0 or newer.
- Run `npm run check` after TypeScript changes.
- Run `npm test` before handing off behavior changes.
- Run `npm run desktop:prepare` after Electron, packaging, or runtime-resource changes.
- Run `npm run desktop:package` when installer-facing assets or packaged behavior changes.
- Run `npm run desktop:make` and `npm run desktop:verify:release` before a Windows release.
- Never commit provider keys, signing material, tokens, or generated user data.
- Publish Windows releases only from a clean `v<package version>` tag. Required assets are the installer, blockmap, `latest.yml`, and checksums from one build.
- Keep personal PFX files outside the repository and use only the `WIN_CSC_LINK` and `WIN_CSC_KEY_PASSWORD` GitHub secrets. Do not reuse organization signing credentials.
