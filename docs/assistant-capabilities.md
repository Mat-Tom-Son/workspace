# Assistant capabilities

Workspace uses Pi's native capability system. This guide explains how Skills, Extensions, packages, scopes, and trust fit the product without confusing them with the user-facing Library.

## Library materials are not Pi resources

The word “resource” has two different possible meanings, so Workspace uses different product language:

| Kind | Examples | Behavior |
|---|---|---|
| **Library material** | A template, reference document, example, image, or reusable file | Passive personal content. It is copied explicitly into a Space and never becomes Chat context automatically. |
| **Pi resource** | A Skill, Extension, prompt template, theme, model/provider configuration, or context instruction | Configuration discovered by Pi. Some resources influence the Assistant or execute code and therefore have scope and trust implications. |

Internal APIs and storage may retain the name `resource` for compatibility. User-facing copy should say **Library** when it means reusable files and use the specific Pi term—**Skill**, **Extension**, prompt, or package—when it means Assistant configuration.

## Skills

A Skill is a reusable way of working. Its interoperable unit is an [Agent Skill](https://agentskills.io): a directory containing `SKILL.md` with `name` and `description` frontmatter. The directory can also contain relative `scripts/`, `references/`, `assets/`, templates, examples, or other supporting files. [Anthropic's public Skills repository](https://github.com/anthropics/skills) provides examples of that structure.

[Pi implements the Agent Skills standard](https://pi.dev/docs/latest/skills) with lenient validation: it warns about most violations and supports some layouts beyond the strict standard. Workspace relies on Pi for discovery and runtime behavior. Workspace's importer accepts:

- A standalone UTF-8 file named `SKILL.md` with a `name` in YAML frontmatter.
- A `.zip` or `.skill` archive containing one Skill.
- An archive containing multiple Skill directories, including the common `skills/<skill-name>/SKILL.md` layout.
- A compatible Anthropic-style plugin or marketplace bundle, from which Workspace imports only the discovered Skill directories.

The last case is deliberately **skill-compatible**, not full plugin compatibility. Workspace preserves each discovered Skill directory so its supporting scripts, references, and assets continue to resolve. It does not activate bundled hooks, agents, MCP servers, plugin commands, binaries, marketplace metadata, or Extensions merely because they share an archive with a Skill.

### Minimal Skill

Create a folder whose name matches the Skill name and add `SKILL.md`:

```text
meeting-notes/
├── SKILL.md
├── references/
└── assets/
```

```markdown
---
name: meeting-notes
description: Turn raw meeting notes into a clear summary with decisions and follow-ups. Use when the user asks to organize meeting notes.
---

# Meeting notes

Follow the workflow here. Read supporting files with paths relative to this Skill directory.
```

The description should say both what the Skill does and when it should be used. Pi places names and descriptions in its initial context, then loads the full instructions and supporting files on demand. Keep referenced paths relative so the entire directory remains portable.

The directory is the interoperable format. To use Workspace's importer, package that directory in `.zip` or `.skill`, or import a standalone file named `SKILL.md`. A standalone import requires a `name`; Pi reports other format diagnostics through its lenient validator.

Import safety checks reject absolute or traversing paths, symbolic links, more than 10,000 archive entries, archives larger than 100 MB, individual expanded files larger than 100 MB, and total expanded content larger than 500 MB. A standalone `SKILL.md` is limited to 2 MB. These checks reduce archive risk; they do not prove that imported scripts are safe. People should inspect an unfamiliar pack before installing it.

If a developer places a Skill directory into a standard Pi scope by another trusted mechanism, Workspace discovers it through Pi even though the desktop importer itself accepts files and archives rather than a raw directory picker.

## Extensions

A [Pi Extension](https://pi.dev/docs/latest/extensions) is executable code that can add tools, commands, providers, event behavior, or other runtime capabilities. Workspace uses Pi's normal extension loader and adapts supported extension UI requests—such as confirmation, selection, text input, notifications, and external links—to desktop UI.

Extensions are more powerful than Library materials and should be presented with their source, scope, load status, tools, commands, and diagnostics. Installing or trusting an Extension is a code-execution decision, not a content-import decision.

Pi's built-in tools remain available alongside loaded Extensions. Workspace does not replace them with a private tool registry.

## Scopes

| Product label | Pi scope | Typical location | Availability |
|---|---|---|---|
| **Personal** | User/global | The configured Pi agent directory, normally `~/.pi/agent` | Available across Spaces. |
| **This Space** | Project/local | `.pi/` inside the Space folder | Portable with that folder and loaded only when trust permits. |

Personal Skills commonly live below `~/.pi/agent/skills`; personal Extensions below `~/.pi/agent/extensions`. Space-scoped equivalents live below `.pi/skills` and `.pi/extensions` in the Space. Pi also discovers global and project `.agents/skills` locations, packages, and paths added through settings. The Pi catalog is therefore the authority rather than a hard-coded directory scan in the renderer.

Personal scope is convenient for capabilities a person wants everywhere. This Space scope is appropriate when a capability belongs with one activity or should travel with that folder. Scope does not indicate safety: personal executable code still deserves inspection.

## Space trust

Turning a folder into a Space grants filesystem visibility, not permission to execute its project configuration. If the folder contains trust-requiring `.pi` resources, Workspace records a separate, reversible trust decision outside the folder and passes it to Pi.

- **Untrusted Space:** content can still be browsed and attached, and personal capabilities remain available. Trust-gated project Skills, Extensions, packages, scripts, and settings do not load.
- **Trusted Space:** Pi may load the folder's project resources.
- **Trust removed:** the next catalog/session reload stops treating those project resources as authorized.

Trust means “allow Pi to load this folder's configuration.” It is not a signature, malware scan, endorsement, or guarantee of behavior.

Pi's native context discovery may still expose `AGENTS.md` instructions even when executable project resources are untrusted. The product should keep that distinction visible: instructional context and executable-resource trust are related risks, but they are not the same Pi mechanism.

Importing a Skill directly into **This Space** also requires Pi to consider that Space trusted, normally through a saved per-Space decision. Importing it into **Personal** scope is an explicit global install action and does not write to the Space.

## Packages

[Pi packages](https://pi.dev/docs/latest/packages) are a distribution and lifecycle mechanism. A package source can provide one or more Skills, Extensions, prompts, themes, or related resources. Workspace delegates installation and discovery to Pi's package manager rather than defining another package format.

Supported Pi sources include npm packages, git sources, HTTPS sources, and local paths. Npm and git sources require their corresponding command-line tools on `PATH`; local paths and direct Skill imports do not. Packages can be personal or project-scoped.

In product language, lead with the outcome (“install this Skill” or “add this Extension”) and show package source, scope, and diagnostics as provenance. Do not add **Packages** as a peer to Space, Library, Skills, or Extensions unless the product model is deliberately revisited.

## Authentication and external connections

Provider credentials belong to **Settings → Assistant** and application/Pi storage, never to a Space or Library. The current first-run desktop path supports API-key setup. Pi contains provider OAuth primitives, but Workspace should not claim general native OAuth support until the packaged desktop flow is wired and verified for the relevant provider.

Likewise, an Extension can implement an external connection, but that does not make the core app a native integration with that service. Google Drive currently works by registering a folder synchronized through Google Drive for desktop. Direct Drive API synchronization remains future provider-adapter work.

## Capability checklist

For every new Assistant capability, keep these answers visible in code and UI:

1. What will the Assistant gain: instructions, files, tools, commands, or network access?
2. Where did it come from?
3. Is it Personal or This Space?
4. Does it require Space trust?
5. Is it loaded, disabled, or failing diagnostics?
6. How can the person update, disable, remove, or revoke it?

The current catalog and import/install surfaces establish the first layer. Provenance inspection, permissions, enable/disable, update, and removal are important lifecycle work still to complete.
