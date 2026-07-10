# Contributing to Workspace

Thanks for helping make folder-based computer work more understandable and more capable.

## Start with the product model

Before changing navigation, terminology, storage, trust, or Assistant behavior, read:

- [Product model and roadmap](docs/product-model.md)
- [Assistant capabilities](docs/assistant-capabilities.md)
- [Architecture](docs/architecture.md)
- [Workspace contributor guide](AGENTS.md)

The central constraint is that a Space remains an ordinary folder. Workspace may register and present that folder, but should not silently move, convert, decorate, upload, or place all of its contents into Assistant context.

## Report an issue

Use [GitHub Issues](https://github.com/Mat-Tom-Son/workspace/issues) for reproducible bugs and focused feature proposals. Include the Workspace version, Windows version, what you expected, what happened, and the smallest safe reproduction you can provide.

Do not put API keys, tokens, private file contents, personal paths, or security vulnerabilities in a public issue. Follow [the security policy](SECURITY.md) for vulnerabilities.

## Develop locally

Workspace requires Node 22.19.0 or newer.

```powershell
git clone https://github.com/Mat-Tom-Son/workspace.git
cd workspace
npm install
npm run local:dev
```

Keep changes focused and avoid committing generated `dist/`, `out/`, user-data, credential, or signing files.

## Verify a change

Use the smallest relevant lane while working, then promote the change before handoff:

```powershell
npm run check
npm test
npm run desktop:prepare
```

Use `npm run desktop:package:smoke` when packaged behavior or assets change. It verifies the canonical unpacked release layout without building an NSIS installer. Use `npm run desktop:make` only for an installer/release candidate. The purpose of each lane is explained in [Windows build](docs/windows-build.md).

Add or update tests for behavior changes. Update README and focused docs when a change affects shipped behavior, terminology, privacy, security, trust, build commands, or the roadmap.

## Pull requests

A useful pull request:

- Explains the user outcome and the problem it solves.
- Keeps internal compatibility names separate from user-facing Space and Library language.
- Identifies data, scope, context, and trust changes explicitly.
- Preserves Pi's native resource behavior instead of adding a parallel format.
- Includes relevant test and verification results.
- Calls out remaining risk or follow-up work without presenting roadmap items as shipped.

Maintainers publish releases from clean version tags. Contributors should not rewrite a released tag or replace artifacts beneath an existing version.

## License

By contributing, you agree that your contribution may be distributed under the repository's [MIT License](LICENSE).
