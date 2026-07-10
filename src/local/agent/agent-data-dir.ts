import { createHash } from "node:crypto";
import { basename, join, resolve } from "node:path";

import { getAgentDir } from "@earendil-works/pi-coding-agent";

/**
 * Default on-disk home for the Pi SDK config directory (models.json, SDK settings).
 * Defaults to Pi's native ~/.pi/agent directory so global Pi packages, skills,
 * extensions, prompts, themes, models, and auth are available to Workspace.
 * Desktop hosts can inject a dedicated userData path with WORKSPACE_AGENT_DIR.
 */
export function defaultAgentSdkDir(runtimeEnv: NodeJS.ProcessEnv = {}): string {
  const override = firstNonEmpty(
    runtimeEnv.WORKSPACE_AGENT_DIR,
    runtimeEnv.PI_CODING_AGENT_DIR,
    process.env.WORKSPACE_AGENT_DIR,
    process.env.PI_CODING_AGENT_DIR,
  );
  if (override) return override;
  return getAgentDir();
}

/** External session storage keyed by workspace path; never pollutes user files. */
export function workspaceSessionDir(workspaceRoot: string, agentDir = defaultAgentSdkDir()): string {
  return join(agentDir, "sessions", workspaceStorageKey(workspaceRoot));
}

export function workspaceStorageKey(workspaceRoot: string): string {
  const resolved = resolve(workspaceRoot);
  return `${readableDirSegment(basename(resolved))}-${createHash("sha256").update(normalizedStoragePath(resolved)).digest("hex").slice(0, 12)}`;
}

function readableDirSegment(name: string): string {
  const cleaned = name.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
  return cleaned || "workspace";
}

function normalizedStoragePath(value: string): string {
  return process.platform === "win32" ? value.toLowerCase() : value;
}

function firstNonEmpty(...values: Array<string | undefined>): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}
