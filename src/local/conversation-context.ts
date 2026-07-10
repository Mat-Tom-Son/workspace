import { readFile, stat } from "node:fs/promises";
import { basename } from "node:path";

import { resolveWorkspacePath } from "./workspace.js";

export type ConversationContextMode = "full_original_text" | "path_only_reference";

export interface ConversationContextAttachment {
  sourcePath: string;
  sourceFileName: string;
  sourceSizeBytes: number;
  mode: ConversationContextMode;
  includedInPrompt: boolean;
  reason: string | null;
  estimatedTokens: number;
  budgetTokens: number;
  provenance: string[];
  warnings: string[];
  userLabel: string;
  detail: string;
}

export interface LoadedConversationContextAttachment extends ConversationContextAttachment {
  text: string | null;
}

export async function loadConversationContextAttachmentsForTurn(
  rootPath: string,
  paths: string[],
): Promise<LoadedConversationContextAttachment[]> {
  const budgetTokens = chatContextBudgetTokens();
  let remaining = budgetTokens;
  const result: LoadedConversationContextAttachment[] = [];
  for (const sourcePath of [...new Set(paths.map(normalizePath).filter(Boolean))].slice(0, 32)) {
    const attachment = await loadAttachment(rootPath, sourcePath, remaining, budgetTokens);
    if (attachment.includedInPrompt) remaining -= attachment.estimatedTokens;
    result.push(attachment);
  }
  return result;
}

async function loadAttachment(rootPath: string, sourcePath: string, remaining: number, budgetTokens: number): Promise<LoadedConversationContextAttachment> {
  const sourceFileName = basename(sourcePath);
  let sourceSizeBytes = 0;
  try {
    const path = resolveWorkspacePath(rootPath, sourcePath);
    const info = await stat(path);
    if (!info.isFile()) throw new Error("Only files can be attached to chat.");
    sourceSizeBytes = info.size;
    if (sourceSizeBytes > 8 * 1024 * 1024) throw new Error("The file is larger than the 8 MB chat attachment limit.");
    const bytes = await readFile(path);
    if (looksBinary(bytes)) throw new Error("Binary files are attached by path; Pi can inspect them with an appropriate tool or extension.");
    const text = normalizeText(bytes.toString("utf8"));
    const estimatedTokens = estimateTokens(text);
    if (estimatedTokens > remaining) throw new Error(`The file does not fit the remaining ${remaining.toLocaleString()}-token attachment budget.`);
    return {
      sourcePath,
      sourceFileName,
      sourceSizeBytes,
      mode: "full_original_text",
      includedInPrompt: true,
      reason: null,
      estimatedTokens,
      budgetTokens,
      provenance: ["UTF-8 text attached with normalized line endings."],
      warnings: [],
      userLabel: "Full text",
      detail: `Full text attached to this turn (about ${estimatedTokens.toLocaleString()} tokens).`,
      text,
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return {
      sourcePath,
      sourceFileName,
      sourceSizeBytes,
      mode: "path_only_reference",
      includedInPrompt: false,
      reason,
      estimatedTokens: 0,
      budgetTokens,
      provenance: [],
      warnings: [],
      userLabel: "Path only",
      detail: `The workspace-relative path is attached. Pi can inspect the file with tools. Reason: ${reason}`,
      text: null,
    };
  }
}

export function chatContextBudgetTokens(): number {
  const configured = Number(process.env.WORKSPACE_CHAT_CONTEXT_BUDGET_TOKENS);
  return Number.isFinite(configured) && configured > 1000 ? Math.floor(configured) : 90_000;
}

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3.5);
}

function normalizePath(value: string): string {
  return value.trim().replace(/\\/g, "/").replace(/^(?:\.\/)+/, "").replace(/^\/+/, "");
}

function normalizeText(value: string): string {
  const text = value.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  return text.endsWith("\n") ? text : `${text}\n`;
}

function looksBinary(bytes: Buffer): boolean {
  const sample = bytes.subarray(0, Math.min(bytes.length, 8192));
  return sample.includes(0);
}
