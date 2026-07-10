import type { TreeEntry } from "../types";

export interface WorkspacePathMention {
  start: number;
  end: number;
  text: string;
  normalizedPath: string;
}

const knownFileExtensions = new Set([
  "csv",
  "doc",
  "docm",
  "docx",
  "dot",
  "dotm",
  "dotx",
  "gif",
  "htm",
  "html",
  "jpeg",
  "jpg",
  "json",
  "md",
  "pdf",
  "png",
  "potx",
  "ppt",
  "pptm",
  "pptx",
  "rtf",
  "svg",
  "txt",
  "webp",
  "xls",
  "xlsb",
  "xlsm",
  "xlsx",
  "xml",
]);

const leadingPathPunctuation = /^[([{"'`<]+/;
const trailingPathPunctuation = /[)\].,;:!?"'`>]+$/;

export function collectWorkspacePathCandidates(markdown: string, limit = 32): string[] {
  const candidates: string[] = [];
  const seen = new Set<string>();
  const addCandidate = (candidate: string | null) => {
    if (!candidate || seen.has(candidate) || candidates.length >= limit) return;
    seen.add(candidate);
    candidates.push(candidate);
  };

  const codeSpans = inlineCodeSpans(markdown);
  for (const span of codeSpans) {
    addCandidate(workspacePathCandidate(span.text, { allowSpaces: true }));
  }
  const markdownWithoutInlineCode = maskRanges(markdown, codeSpans);
  for (const mention of findWorkspacePathMentions(markdownWithoutInlineCode)) {
    addCandidate(mention.normalizedPath);
  }
  return candidates;
}

export function findWorkspacePathMentions(text: string): WorkspacePathMention[] {
  const mentions: WorkspacePathMention[] = [];
  const tokenPattern = /\S+/g;
  let match: RegExpExecArray | null;
  while ((match = tokenPattern.exec(text))) {
    const rawToken = match[0] ?? "";
    const leadingLength = rawToken.length - rawToken.replace(leadingPathPunctuation, "").length;
    const withoutLeading = rawToken.slice(leadingLength);
    const core = withoutLeading.replace(trailingPathPunctuation, "");
    const trailingLength = withoutLeading.length - core.length;
    const normalizedPath = workspacePathCandidate(core, { allowSpaces: false });
    if (!normalizedPath) continue;
    mentions.push({
      start: match.index + leadingLength,
      end: match.index + rawToken.length - trailingLength,
      text: core,
      normalizedPath,
    });
  }
  return mentions;
}

export function workspacePathCandidate(value: string, options: { allowSpaces: boolean }): string | null {
  const normalized = value.trim().replace(/\\/g, "/").replace(/\/+$/g, "");
  if (!normalized) return null;
  if (!options.allowSpaces && /\s/.test(normalized)) return null;
  if (/^[a-z][a-z0-9+.-]*:/i.test(normalized)) return null;
  if (/^[A-Za-z]:\//.test(normalized)) return null;
  if (normalized.startsWith("/") || normalized.startsWith("~")) return null;
  if (normalized.includes("\0")) return null;
  const segments = normalized.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) return null;
  const lastSegment = segments[segments.length - 1] ?? "";
  const extension = fileExtension(lastSegment);
  const hasSlash = normalized.includes("/");
  const hasKnownExtension = Boolean(extension && knownFileExtensions.has(extension));
  if (!hasSlash && !hasKnownExtension) return null;
  if (!hasSlash && /^\d+(?:\.\d+)+$/.test(normalized)) return null;
  return normalized;
}

export function resolveFixtureWorkspacePathCandidates(paths: string[], entries: TreeEntry[]): Map<string, string> {
  const files = collectFixtureFiles(entries);
  const byPath = new Map(files.map((entry) => [entry.path, entry.path]));
  const byLowerName = new Map<string, string[]>();
  for (const entry of files) {
    const name = entry.name.toLocaleLowerCase();
    byLowerName.set(name, [...(byLowerName.get(name) ?? []), entry.path]);
  }

  const resolved = new Map<string, string>();
  for (const path of paths) {
    const normalized = workspacePathCandidate(path, { allowSpaces: true });
    if (!normalized) continue;
    const direct = byPath.get(normalized);
    if (direct) {
      resolved.set(normalized, direct);
      continue;
    }
    if (normalized.includes("/")) continue;
    const matches = byLowerName.get(normalized.toLocaleLowerCase()) ?? [];
    if (matches.length === 1 && matches[0]) resolved.set(normalized, matches[0]);
  }
  return resolved;
}

function inlineCodeSpans(markdown: string): Array<{ start: number; end: number; text: string }> {
  const spans: Array<{ start: number; end: number; text: string }> = [];
  const inlineCodePattern = /`([^`\n]+)`/g;
  let match: RegExpExecArray | null;
  while ((match = inlineCodePattern.exec(markdown))) {
    spans.push({ start: match.index, end: match.index + match[0].length, text: match[1] ?? "" });
  }
  return spans;
}

function maskRanges(value: string, ranges: Array<{ start: number; end: number }>): string {
  if (!ranges.length) return value;
  const characters = [...value];
  for (const range of ranges) {
    for (let index = range.start; index < range.end; index += 1) {
      characters[index] = " ";
    }
  }
  return characters.join("");
}

function collectFixtureFiles(entries: TreeEntry[]): TreeEntry[] {
  const files: TreeEntry[] = [];
  for (const entry of entries) {
    if (entry.kind === "file") {
      files.push(entry);
      continue;
    }
    if (entry.children?.length) files.push(...collectFixtureFiles(entry.children));
  }
  return files;
}

function fileExtension(path: string): string {
  const match = /\.([^.\\/]+)$/.exec(path);
  return match?.[1]?.toLocaleLowerCase() ?? "";
}
