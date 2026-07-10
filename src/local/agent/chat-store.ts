import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { appendFile, mkdir, open, readFile, readdir, unlink } from "node:fs/promises";
import { join } from "node:path";

import { workspaceConversationDir } from "../state-paths.js";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  createdAt: string;
  kind?: "conversation_title";
  landing?: ChatMessageLanding;
}

export interface ConversationSummary {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

export interface ChatMessageLanding {
  summary: string;
  nextActions: string[];
  followUpPrompt: string | null;
  conversationTitle?: string;
  generatedAt: string;
  provider: string;
  model: string;
}

export async function listConversations(workspaceRoot: string): Promise<ConversationSummary[]> {
  const dir = conversationsDir(workspaceRoot);
  if (!existsSync(dir)) return [];
  const files = (await readdir(dir)).filter((file) => file.endsWith(".jsonl"));
  const summaries: ConversationSummary[] = [];
  for (const file of files) {
    const conversationId = file.replace(/\.jsonl$/, "");
    if (!isValidConversationId(conversationId)) continue;
    const { messages, malformedLineCount } = await readConversationFile(workspaceRoot, conversationId);
    if (!messages.some((message) => message.role !== "system")) {
      if (malformedLineCount === 0) await unlink(conversationPath(workspaceRoot, conversationId));
      continue;
    }
    summaries.push(conversationSummary(conversationId, messages));
  }
  return summaries.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export async function createConversation(workspaceRoot: string, title = "Workspace chat"): Promise<ConversationSummary> {
  const now = new Date().toISOString();
  const id = `chat-${randomUUID()}`;
  await appendMessage(workspaceRoot, id, { id: randomUUID(), role: "system", content: title, createdAt: now });
  return { id, title, createdAt: now, updatedAt: now };
}

export async function renameConversation(workspaceRoot: string, conversationId: string, title: string): Promise<ConversationSummary> {
  const now = new Date().toISOString();
  const normalizedTitle = normalizeConversationTitle(title);
  if (!normalizedTitle) throw new Error("Conversation title is required.");
  if (!(await readConversation(workspaceRoot, conversationId)).length) throw new Error("Conversation not found.");
  await appendMessage(workspaceRoot, conversationId, {
    id: randomUUID(),
    role: "system",
    kind: "conversation_title",
    content: normalizedTitle,
    createdAt: now,
  });
  const messages = await readConversation(workspaceRoot, conversationId);
  return conversationSummary(conversationId, messages);
}

export async function readConversation(workspaceRoot: string, conversationId: string): Promise<ChatMessage[]> {
  return (await readConversationFile(workspaceRoot, conversationId)).messages;
}

async function readConversationFile(workspaceRoot: string, conversationId: string): Promise<{ messages: ChatMessage[]; malformedLineCount: number }> {
  const path = conversationPath(workspaceRoot, conversationId);
  if (!existsSync(path)) return { messages: [], malformedLineCount: 0 };
  const messages: ChatMessage[] = [];
  let malformedLineCount = 0;
  for (const rawLine of (await readFile(path, "utf8")).split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const parsed = parseChatMessage(line);
    if (parsed) messages.push(parsed);
    else malformedLineCount += 1;
  }
  return { messages, malformedLineCount };
}

export async function appendMessage(workspaceRoot: string, conversationId: string, message: ChatMessage): Promise<void> {
  const path = conversationPath(workspaceRoot, conversationId);
  await mkdir(conversationsDir(workspaceRoot), { recursive: true });
  const prefix = await needsLineBreakBeforeAppend(path) ? "\n" : "";
  await appendFile(path, `${prefix}${JSON.stringify(message)}\n`, "utf8");
}

export function conversationsDir(workspaceRoot: string): string {
  return workspaceConversationDir(workspaceRoot);
}

function conversationPath(workspaceRoot: string, conversationId: string): string {
  assertValidConversationId(conversationId);
  return join(conversationsDir(workspaceRoot), `${conversationId}.jsonl`);
}

function parseChatMessage(line: string): ChatMessage | null {
  try {
    const parsed = JSON.parse(line) as Partial<ChatMessage>;
    if (!parsed || typeof parsed !== "object") return null;
    if (typeof parsed.id !== "string") return null;
    if (parsed.role !== "user" && parsed.role !== "assistant" && parsed.role !== "system") return null;
    if (typeof parsed.content !== "string") return null;
    if (typeof parsed.createdAt !== "string") return null;
    const message: ChatMessage = {
      id: parsed.id,
      role: parsed.role,
      content: parsed.content,
      createdAt: parsed.createdAt,
    };
    if (parsed.kind === "conversation_title") message.kind = parsed.kind;
    if (isChatMessageLanding(parsed.landing)) message.landing = parsed.landing;
    return message;
  } catch {
    return null;
  }
}

function isChatMessageLanding(value: unknown): value is ChatMessageLanding {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Partial<ChatMessageLanding>;
  return (
    typeof record.summary === "string" &&
    Array.isArray(record.nextActions) &&
    record.nextActions.every((item) => typeof item === "string") &&
    (typeof record.followUpPrompt === "string" || record.followUpPrompt === null) &&
    (record.conversationTitle === undefined || typeof record.conversationTitle === "string") &&
    typeof record.generatedAt === "string" &&
    typeof record.provider === "string" &&
    typeof record.model === "string"
  );
}

function conversationSummary(conversationId: string, messages: ChatMessage[]): ConversationSummary {
  const firstUser = messages.find((message) => message.role === "user");
  const last = messages[messages.length - 1];
  return {
    id: conversationId,
    title: manualConversationTitle(messages) || generatedConversationTitle(messages) || firstUser?.content.slice(0, 70) || "Workspace chat",
    createdAt: messages[0]?.createdAt ?? new Date().toISOString(),
    updatedAt: last?.createdAt ?? new Date().toISOString(),
  };
}

function manualConversationTitle(messages: ChatMessage[]): string | null {
  for (const message of [...messages].reverse()) {
    if (message.role !== "system" || message.kind !== "conversation_title") continue;
    const title = normalizeConversationTitle(message.content);
    if (title) return title;
  }
  return null;
}

function generatedConversationTitle(messages: ChatMessage[]): string | null {
  for (const message of [...messages].reverse()) {
    const title = message.landing?.conversationTitle?.replace(/\s+/g, " ").trim();
    if (title) return title.slice(0, 80);
  }
  return null;
}

function normalizeConversationTitle(title: string): string {
  return title.replace(/\s+/g, " ").trim().slice(0, 80);
}

function assertValidConversationId(conversationId: string): void {
  if (!isValidConversationId(conversationId)) {
    throw new Error("Invalid conversation id.");
  }
}

function isValidConversationId(conversationId: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(conversationId);
}

async function needsLineBreakBeforeAppend(path: string): Promise<boolean> {
  let handle: Awaited<ReturnType<typeof open>> | null = null;
  try {
    handle = await open(path, "r");
    const info = await handle.stat();
    if (info.size === 0) return false;
    const lastByte = Buffer.alloc(1);
    await handle.read(lastByte, 0, 1, info.size - 1);
    return lastByte[0] !== 0x0a && lastByte[0] !== 0x0d;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return false;
    throw error;
  } finally {
    await handle?.close();
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
