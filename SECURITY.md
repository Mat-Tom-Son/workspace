# Security policy

## Report a vulnerability privately

Please use a [GitHub private security advisory](https://github.com/Mat-Tom-Son/workspace/security/advisories/new) to report a suspected vulnerability. Do not open a public issue for an unpatched security problem.

Include the affected version or commit, impact, reproduction steps or proof of concept, and any suggested mitigation you have. Remove real credentials, private documents, and unnecessary personal information from the report.

If a secret was exposed, revoke or rotate it with its provider first. Never paste API keys, tokens, certificate passwords, private keys, or signing material into an issue, discussion, screenshot, test fixture, or repository file.

## Supported versions

Workspace is an early-stage project. Security fixes target the current public release and the `main` branch. Upgrade to the newest release when a fix is published; older releases may not receive a backport.

## Security boundaries

Workspace is local first, but local does not mean that every action is sandboxed:

- A Space exposes an ordinary folder to the local application and Pi's filesystem tools.
- Selected chat attachments and later tool results may be sent to the configured model provider as part of an Assistant turn.
- Skills can influence model behavior and may include executable scripts.
- Extensions and Pi packages can execute code with the current user's permissions and can make network requests.
- Trusting a Space allows Pi to load trust-gated project configuration from its `.pi` and other Pi-supported project resource locations. Trust is authorization, not code review, signing, or malware detection.
- Personal capabilities are available across Spaces and should be reviewed even though they do not use Space trust.

Workspace separates folder registration from executable project trust, validates imported Skill archives against traversal, symlink, count, and size hazards, and stores desktop provider credentials with Electron's operating-system-backed `safeStorage`. Those controls do not make third-party code inherently safe.

Only install Skills, Extensions, and packages whose source you understand. Review capability provenance and supporting scripts before use, especially when a package can run shell commands or access sensitive folders.

## Release integrity

Public releases are built from version tags and include an installer, blockmap, update manifest, and SHA-256 checksum file. The updater also validates the SHA-512 digest in `latest.yml`.

The project may publish unsigned or self-signed preview builds until a publicly trusted code-signing identity is configured. A self-signed certificate provides artifact continuity for its owner but does not establish public Windows trust. Verify the release source and published checksums, and expect Windows to warn when the publisher is not publicly trusted.
