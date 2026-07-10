# Pi resources and compatibility

Workspace exposes Pi resources directly instead of maintaining a parallel Assistant tool registry. In this document, “resource” is Pi's technical term for runtime-discovered configuration; it is distinct from the user-facing **Library** of reusable personal files.

In the product navigation, **Skills** and **Extensions** live under **Assistant** alongside **Setup**. A Skill describes a reusable way of working; an Extension adds an executable capability or connection.

## Extensions

Global extensions are discovered from the user's Pi agent directory. Pi project extensions are discovered from `.pi/extensions` inside a trusted Space folder. Extension commands, tools, providers, events, and resource discovery remain available through Pi's normal runtime.

The desktop preflight creates isolated global and project extensions and verifies that Pi loads both. It also verifies that Pi's built-in `read`, `bash`, `edit`, and `write` tools remain active.

## Skills

The base unit is an Agent Skill directory containing `SKILL.md` and any relative `scripts/`, `references/`, `assets/`, templates, or examples it needs. Import must preserve the entire directory. Product copy describes a Skill as a reusable way of working; `SKILL.md` remains the interoperable technical format.

The importer may accept:

- A skill directory or a single `SKILL.md`.
- ZIP and `.skill` archives containing one skill.
- Bundles containing `skills/*/SKILL.md`.
- Compatible plugin or marketplace archives, importing only their skill components by default.

Hooks, MCP servers, agents, binaries, and other plugin features outside discovered skill directories are not imported. Archive extraction rejects path traversal, symlinks, excessive file counts, and unreasonable expanded sizes. Importing a personal Skill is an explicit install action and makes its preserved scripts available to Pi; Pi project-scoped imports (shown as Space-scoped in the product) additionally require the folder's saved trust decision.

Pi packages remain the installation and update mechanism for npm, git, HTTPS, and local sources. Workspace surfaces Pi's diagnostics, scope, source, and enablement state rather than inventing a second package format.

Packages are distribution plumbing, not a separate top-level user concept. The interface should describe what a person is installing—a Skill or Extension—while retaining package source and diagnostic details where they are useful.
