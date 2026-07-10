# Windows build

Workspace requires Node 22.19.0 or newer.

```powershell
npm run check
npm test
npm run desktop:prepare
npm run desktop:package
```

`desktop:prepare` builds the renderer and Electron runtime and runs a native Pi resource smoke test. `desktop:package` additionally verifies the unpacked app and its ASAR contents.

For a personal unsigned NSIS installer:

```powershell
npm run desktop:make
```

Unsigned installers are for local testing only. Public distribution needs a new signing certificate, release repository, updater feed, and CI release workflow. None of those identities are inherited or assumed by this repository.
