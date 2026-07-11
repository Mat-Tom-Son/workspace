import { randomUUID } from "node:crypto";
import { existsSync, lstatSync } from "node:fs";
import { appendFile, copyFile, mkdir, open, readFile, readdir, unlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { legacyWorkspaceConversationDir, workspaceConversationDir } from "../state-paths.js";

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
  await prepareConversationRead(workspaceRoot);
  const files = new Set<string>();
  for (const dir of conversationReadDirs(workspaceRoot)) {
    if (!existsSync(dir)) continue;
    for (const file of await readdir(dir)) if (file.endsWith(".jsonl")) files.add(file);
  }
  const summaries: ConversationSummary[] = [];
  for (const file of files) {
    const conversationId = file.replace(/\.jsonl$/, "");
    if (!isValidConversationId(conversationId)) continue;
    const { messages, malformedLineCount } = await readConversationFile(workspaceRoot, conversationId);
    if (!messages.some((message) => message.role !== "system")) {
      if (malformedLineCount === 0) await unlink(existingConversationPath(workspaceRoot, conversationId));
      continue;
    }
    summaries.push(conversationSummary(conversationId, messages));
  }
  return summaries.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export async function createConversation(workspaceRoot: string, title = "New Chat"): Promise<ConversationSummary> {
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
  await prepareConversationRead(workspaceRoot);
  const path = existingConversationPath(workspaceRoot, conversationId);
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
  await ensurePortableConversationStorage(workspaceRoot);
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
  const path = join(conversationsDir(workspaceRoot), `${conversationId}.jsonl`);
  if (existsSync(path) && lstatSync(path).isSymbolicLink()) {
    throw new Error("Conversation logs cannot be symbolic links or junctions.");
  }
  return path;
}

function existingConversationPath(workspaceRoot: string, conversationId: string): string {
  const portablePath = conversationPath(workspaceRoot, conversationId);
  if (existsSync(portablePath) || existsSync(conversationMigrationMarker(workspaceRoot))) return portablePath;
  return join(legacyWorkspaceConversationDir(workspaceRoot), `${conversationId}.jsonl`);
}

function conversationReadDirs(workspaceRoot: string): string[] {
  const portableDir = conversationsDir(workspaceRoot);
  const legacyDir = legacyWorkspaceConversationDir(workspaceRoot);
  return existsSync(conversationMigrationMarker(workspaceRoot)) || !existsSync(legacyDir)
    ? [portableDir]
    : [portableDir, legacyDir];
}

const conversationMigrationByRoot = new Map<string, Promise<void>>();

async function ensurePortableConversationStorage(workspaceRoot: string): Promise<void> {
  const key = resolve(workspaceRoot);
  const inFlight = conversationMigrationByRoot.get(key);
  if (inFlight) return inFlight;
  const migration = migrateLegacyConversations(workspaceRoot).finally(() => {
    if (conversationMigrationByRoot.get(key) === migration) conversationMigrationByRoot.delete(key);
  });
  conversationMigrationByRoot.set(key, migration);
  return migration;
}

async function prepareConversationRead(workspaceRoot: string): Promise<void> {
  try {
    await ensurePortableConversationStorage(workspaceRoot);
  } catch (error) {
    if (!existsSync(legacyWorkspaceConversationDir(workspaceRoot))) throw error;
  }
}

async function migrateLegacyConversations(workspaceRoot: string): Promise<void> {
  const legacyDir = legacyWorkspaceConversationDir(workspaceRoot);
  if (!existsSync(legacyDir)) return;
  const portableDir = conversationsDir(workspaceRoot);
  const marker = conversationMigrationMarker(workspaceRoot);
  if (existsSync(marker)) return;
  await mkdir(portableDir, { recursive: true });
  for (const file of await readdir(legacyDir)) {
    if (!file.endsWith(".jsonl")) continue;
    const destination = join(portableDir, file);
    if (existsSync(destination)) continue;
    try {
      await copyFile(join(legacyDir, file), destination);
    } catch (error) {
      if (!isNodeError(error) || error.code !== "EEXIST") throw error;
    }
  }
  await writeFile(marker, "Legacy app-data conversations copied non-destructively.\n", { encoding: "utf8", flag: "wx" }).catch((error: unknown) => {
    if (!isNodeError(error) || error.code !== "EEXIST") throw error;
  });
}

function conversationMigrationMarker(workspaceRoot: string): string {
  return join(conversationsDir(workspaceRoot), ".external-migration-v1");
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
    title: manualConversationTitle(messages) || generatedConversationTitle(messages) || firstUser?.content.slice(0, 70) || "New Chat",
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
