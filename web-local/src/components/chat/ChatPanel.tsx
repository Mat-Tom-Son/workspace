import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type * as React from "react";
import { ArrowDown20Regular, ArrowUp20Regular } from "@fluentui/react-icons";
import { AlertTriangle, CircleCheck, Loader2, Square, X } from "lucide-react";

import { agentActivityLogLimit, assistantName, chatDraftDebounceMs, genericChatEmptyGreetings, workspacePathDragType } from "../../constants";
import { createFixtureContextAttachment, fixtureAgentActivityEvents, fixtureConversationSummary } from "../../fixtures/shared";
import { api, createEventSource, errorText } from "../../lib/api";
import { chatDisplayTitle, chatDraftStorageKey, clearStoredChatDraft, formatBytes, latestTranscriptTime, modelConversationTitle, readStoredChatDraft, writeStoredChatDraft } from "../../lib/format";
import { resolveFixtureWorkspacePathCandidates } from "../../lib/workspace-path-links";
import { workspaceIdentityFor, workspaceIdentityStyle, type WorkspaceIdentity } from "../../lib/workspace-identity";
import type { AgentActivityEvent, AgentActivityLogEntry, ChatContextPathRequest, ChatMessage, ChatStreamEvent, ContextAttachment, ConversationSummary, ExtensionUiRequest, PendingChatSend, RuntimePreviewEntry, TreeEntry, WorkspaceCustomizationMap, WorkspaceFixtureConversation, WorkspaceSummary } from "../../types";
import { Banner, FluentGlyph, WorkspaceIconGlyph } from "../chrome/common";
import { FileTypeIcon } from "../tree/FileTree";
import { AgentActivityLog, AgentActivityTicker, RuntimeContextPreview, activityRecapKey, normalizeAgentActivityEvent, shouldKeepActivityRecap } from "./activity";
import { ChatMessageRow, MarkdownMessage, copyMarkdownToClipboard } from "./messages";
import { showToast } from "../../ui/feedback";

const emptyFixtureTreeEntries: TreeEntry[] = [];

export function ChatPanel({
  workspace,
  workspaceCustomizations,
  active = true,
  targetConversationId = null,
  targetConversationTitle = null,
  contextPathRequest,
  onAddPathToChatContext,
  onOpenWorkspaceFile,
  selectedPath,
  onConversationActivated,
  onConversationsChanged,
  onAgentFinished,
  fixtureMode = false,
  fixtureConversations,
  fixtureTreeEntries = emptyFixtureTreeEntries,
}: {
  workspace: WorkspaceSummary;
  workspaceCustomizations: WorkspaceCustomizationMap;
  active?: boolean;
  targetConversationId?: string | null;
  targetConversationTitle?: string | null;
  contextPathRequest: ChatContextPathRequest | null;
  onAddPathToChatContext?: (path: string) => void;
  onOpenWorkspaceFile?: (path: string) => void;
  selectedPath: string | null;
  onConversationActivated?: (conversation: ConversationSummary | null) => void;
  onConversationsChanged?: (conversations: ConversationSummary[]) => void;
  onAgentFinished: () => void | Promise<void>;
  fixtureMode?: boolean;
  fixtureConversations?: WorkspaceFixtureConversation[];
  fixtureTreeEntries?: TreeEntry[];
}) {
  const [conversation, setConversation] = useState<ConversationSummary | null>(null);
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const conversationsRef = useRef<ConversationSummary[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [running, setRunning] = useState(false);
  const [streamingAssistant, setStreamingAssistant] = useState("");
  const [runtimePreviews, setRuntimePreviews] = useState<RuntimePreviewEntry[]>([]);
  const [events, setEvents] = useState<AgentActivityEvent[]>([]);
  const [activityLog, setActivityLog] = useState<AgentActivityLogEntry[]>([]);
  const [activityLogOpen, setActivityLogOpen] = useState(false);
  const [activityRecap, setActivityRecap] = useState<AgentActivityEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [contextAttachments, setContextAttachments] = useState<ContextAttachment[]>([]);
  const [attachingPath, setAttachingPath] = useState<string | null>(null);
  const [activeContextPath, setActiveContextPath] = useState<string | null>(null);
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [extensionRequest, setExtensionRequest] = useState<ExtensionUiRequest | null>(null);
  const emptyStateGreeting = useMemo(() => randomChatEmptyGreeting(), []);
  const workspaceIdentity = useMemo(
    () => workspaceIdentityFor(workspace, workspaceCustomizations),
    [workspace, workspaceCustomizations],
  );
  const [userPinnedToBottom, setUserPinnedToBottom] = useState(true);
  const messageListRef = useRef<HTMLDivElement | null>(null);
  const messageEndRef = useRef<HTMLDivElement | null>(null);
  const activityLogListRef = useRef<HTMLDivElement | null>(null);
  const composerTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const userPinnedToBottomRef = useRef(true);
  const activityLogPinnedToBottomRef = useRef(true);
  const streamingBufferRef = useRef("");
  const streamingFlushRef = useRef<number | null>(null);
  const activeThinkingPreviewIdRef = useRef<string | null>(null);
  const runtimePreviewIdRef = useRef(0);
  const eventIdRef = useRef(0);
  const eventClearTimerRef = useRef<number | null>(null);
  const workspaceIdRef = useRef(workspace.id);
  const eventStreamReadyConversationIdRef = useRef<string | null>(null);
  const pendingSendRef = useRef<PendingChatSend | null>(null);
  const postingPendingSendRef = useRef(false);
  const suppressMessageEnterIdsRef = useRef<Set<string>>(new Set());
  const transientConversationIdsRef = useRef<Set<string>>(new Set());
  const scriptPlaybackStateRef = useRef<"idle" | "playing" | "done">("idle");
  const scriptPlaybackTimerRef = useRef<number | null>(null);
  const activeDraftStorageKeyRef = useRef<string | null>(null);
  const draftRef = useRef(draft);
  const draftStorageKey = useMemo(
    () => chatDraftStorageKey(workspace.id, targetConversationId ?? conversation?.id ?? null),
    [workspace.id, targetConversationId, conversation?.id],
  );
  const runtimePreviewScrollKey = useMemo(
    () => runtimePreviews.map((entry) => `${entry.id}:${entry.phase ?? ""}:${entry.text.length}`).join("|"),
    [runtimePreviews],
  );

  function commitConversations(next: ConversationSummary[] | ((current: ConversationSummary[]) => ConversationSummary[])): void {
    const nextConversations = typeof next === "function" ? next(conversationsRef.current) : next;
    conversationsRef.current = nextConversations;
    setConversations(nextConversations);
    onConversationsChanged?.(nextConversations);
  }

  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);

  useEffect(() => () => {
    if (!fixtureMode && activeDraftStorageKeyRef.current) writeStoredChatDraft(activeDraftStorageKeyRef.current, draftRef.current);
    clearAgentEventTimer();
    cancelStreamingFlush();
    releaseScriptPlayback();
  }, []);

  useEffect(() => {
    workspaceIdRef.current = workspace.id;
    setActivityRecap([]);
    resetActivityLog();
    clearRuntimePreviews();
    pendingSendRef.current = null;
    postingPendingSendRef.current = false;
    eventStreamReadyConversationIdRef.current = null;
    transientConversationIdsRef.current = new Set();
  }, [workspace.id]);

  useEffect(() => {
    if (fixtureMode) return;
    const previousKey = activeDraftStorageKeyRef.current;
    if (previousKey === draftStorageKey) return;
    if (previousKey) writeStoredChatDraft(previousKey, draft);
    activeDraftStorageKeyRef.current = draftStorageKey;
    setDraft(readStoredChatDraft(draftStorageKey));
  }, [draftStorageKey, fixtureMode]);

  useEffect(() => {
    if (fixtureMode) return;
    const key = draftStorageKey;
    const timerId = window.setTimeout(() => {
      if (activeDraftStorageKeyRef.current === key) writeStoredChatDraft(key, draft);
    }, chatDraftDebounceMs);
    return () => window.clearTimeout(timerId);
  }, [draft, draftStorageKey, fixtureMode]);

  useEffect(() => {
    if (fixtureMode) return;
    void loadConversationList();
  }, [workspace.id, fixtureMode]);

  useEffect(() => {
    if (!fixtureMode) return;
    const script = fixtureScriptPlayback();
    const scriptConversation = script
      ? (fixtureConversations ?? []).find((item) => item.id === script.conversationId) ?? null
      : null;
    const scriptTargeted = Boolean(scriptConversation) && (!targetConversationId || targetConversationId === scriptConversation?.id);
    if (scriptPlaybackStateRef.current === "playing") {
      // Benign re-run mid-playback (e.g. the conversation is activated at send time) — leave the show alone.
      if (scriptTargeted) return;
      // The tab moved to a different conversation mid-playback — stop and hydrate normally below.
      cancelScriptPlayback();
    }
    if (script && scriptConversation && scriptTargeted && scriptPlaybackStateRef.current === "idle" && !fixtureScriptPlaybackClaimed) {
      fixtureScriptPlaybackClaimed = true;
      startScriptPlayback(scriptConversation, script.delayMs);
      return;
    }
    const fixtureConversation = targetConversationId
      ? fixtureConversations?.find((item) => item.id === targetConversationId) ?? null
      : fixtureConversations?.[0] ?? null;
    const fixtureConversationSummaryValue = fixtureConversation ? fixtureConversationSummary(fixtureConversation) : null;
    const fixtureRunning = fixtureConversation?.running ?? fixtureAgentRunning();
    setError(null);
    const fixtureEvents = fixtureConversation?.activityEvents ?? fixtureAgentActivityEvents();
    const fixturePreviews = fixtureConversation?.runtimePreviews ?? fixtureRuntimePreviews();
    commitConversations((fixtureConversations ?? []).map(fixtureConversationSummary));
    if (fixtureConversation && fixtureConversationSummaryValue) {
      setConversation(fixtureConversationSummaryValue);
      onConversationActivated?.(fixtureConversationSummaryValue);
      setMessages(fixtureConversation.messages.filter((message) => message.role !== "system"));
      setStreamingAssistant(fixtureConversation.streamingAssistant ?? (fixtureRunning ? "I’m reading the selected files and checking the generated outputs now." : ""));
      setContextAttachments(fixtureConversation.contextAttachments ?? []);
      setActiveContextPath(null);
    } else {
      setConversation(null);
      onConversationActivated?.(null);
      setMessages([]);
      setStreamingAssistant("");
      setContextAttachments([]);
      setActiveContextPath(null);
    }
    setRunning(fixtureRunning);
    setEvents(fixtureEvents);
    seedActivityLog(fixtureEvents);
    setActivityRecap(fixtureEvents);
    setRuntimePreviews(fixturePreviews);
  }, [workspace.id, fixtureMode, targetConversationId, fixtureConversations]);

  useEffect(() => {
    if (fixtureMode) return;
    if (!targetConversationId) {
      if (!conversation) return;
      pendingSendRef.current = null;
      postingPendingSendRef.current = false;
      eventStreamReadyConversationIdRef.current = null;
      setConversation(null);
      setMessages([]);
      setStreamingAssistant("");
      setRunning(false);
      setEvents([]);
      setActivityRecap([]);
      resetActivityLog();
      clearRuntimePreviews();
      cancelStreamingFlush();
      setContextAttachments([]);
      setActiveContextPath(null);
      userPinnedToBottomRef.current = true;
      setUserPinnedToBottom(true);
      onConversationActivated?.(null);
      return;
    }
    if (conversation?.id === targetConversationId) return;
    const selected = conversations.find((item) => item.id === targetConversationId);
    if (selected) void switchConversation(selected);
  }, [targetConversationId, conversations, conversation?.id, fixtureMode]);

  useEffect(() => {
    if (fixtureMode || !targetConversationId || !targetConversationTitle) return;
    setConversation((current) => (
      current?.id === targetConversationId && current.title !== targetConversationTitle
        ? { ...current, title: targetConversationTitle }
        : current
    ));
    commitConversations((current) => current.map((item) => (
      item.id === targetConversationId && item.title !== targetConversationTitle
        ? { ...item, title: targetConversationTitle }
        : item
    )));
  }, [targetConversationId, targetConversationTitle, fixtureMode]);

  useEffect(() => {
    resizeComposerTextarea();
  }, [draft]);

  useEffect(() => {
    const keepStreamOpen = active || running || Boolean(pendingSendRef.current);
    if (fixtureMode || !conversation || !keepStreamOpen) return;
    const conversationId = conversation.id;
    eventStreamReadyConversationIdRef.current = null;
    const source = createEventSource(`/api/workspaces/${workspace.id}/conversations/${conversationId}/events`);
    source.onopen = () => {
      eventStreamReadyConversationIdRef.current = conversationId;
      if (pendingSendRef.current?.conversation.id === conversationId) void postPendingMessage();
    };
    source.onerror = (streamError) => {
      if (eventStreamReadyConversationIdRef.current === conversationId) eventStreamReadyConversationIdRef.current = null;
      const pending = pendingSendRef.current;
      if (pending?.conversation.id === conversationId) {
        pendingSendRef.current = null;
        postingPendingSendRef.current = false;
        setRunning(false);
        clearRuntimePreviews();
        setError(errorText(streamError));
        setDraft(pending.content);
        setMessages((current) => current.filter((message) => message.id !== pending.localUserMessage.id));
        if (pending.transientConversation) {
          transientConversationIdsRef.current.delete(conversationId);
          setConversation(null);
          commitConversations((current) => current.filter((item) => item.id !== conversationId));
        }
      }
    };
    source.onmessage = (event) => {
      const data = JSON.parse(event.data) as ChatStreamEvent;
      if (data.type === "status" && data.message) {
        addAgentEvent({ message: data.message, phase: "running" });
      }
      if (data.type === "tool") {
        addAgentEvent({
          message: data.message ?? "Agent activity",
          detail: data.detail,
          phase: data.phase,
          toolCallId: data.toolCallId,
          toolName: data.toolName,
        });
      }
      if (data.type === "assistant_thinking") {
        setRunning(true);
        if (data.thinkingPhase === "start") startThinkingPreview();
        if (data.text) appendThinkingPreview(data.text);
        if (data.thinkingPhase === "end") finishThinkingPreview();
      }
      if (data.type === "assistant_delta" && data.text) {
        setRunning(true);
        queueStreamingText(data.text);
      }
      if (data.type === "assistant_message" && typeof data.text === "string") {
        flushStreamingText();
        setStreamingAssistant(data.text);
      }
      if (data.type === "extension_ui_request" && data.request) {
        if (data.request.method === "notify") {
          showToast({ text: data.request.message ?? "Extension notification", tone: "info" });
          addAgentEvent({ message: data.request.message ?? "Extension notification", phase: "complete" });
        } else {
          setExtensionRequest(data.request);
        }
      }
      if (data.type === "editor" && typeof data.text === "string") {
        setDraft((current) => data.editorMode === "replace" ? data.text ?? "" : `${current}${data.text ?? ""}`);
        window.requestAnimationFrame(() => composerTextareaRef.current?.focus());
      }
      if (data.type === "error") {
        flushStreamingText();
        finishThinkingPreview();
        setError(data.message ?? "Agent error");
        setRunning(false);
        scheduleEventClear();
      }
      if (data.type === "done") {
        flushStreamingText();
        finishThinkingPreview();
        scheduleEventClear();
        // Keep the streamed bubble on screen until the persisted transcript
        // arrives, then swap in one commit so the reply never blinks out.
        void loadMessages(conversationId, false, { settleStreamingTurn: true });
        void onAgentFinished();
      }
    };
    return () => {
      if (eventStreamReadyConversationIdRef.current === conversationId) eventStreamReadyConversationIdRef.current = null;
      source.close();
      cancelStreamingFlush();
      activeThinkingPreviewIdRef.current = null;
    };
  }, [active, conversation?.id, running, workspace.id, fixtureMode]);

  useEffect(() => {
    if (!contextPathRequest) return;
    void attachContextPath(contextPathRequest.path);
  }, [contextPathRequest?.id]);

  useEffect(() => {
    if (userPinnedToBottomRef.current) scrollMessagesToBottom("auto");
  }, [messages, streamingAssistant, runtimePreviewScrollKey, running, events.length]);

  useEffect(() => {
    if (!activityLogOpen || !activityLogPinnedToBottomRef.current) return;
    scrollActivityLogToBottom("auto");
  }, [activityLog.length, activityLogOpen]);

  function scrollMessagesToBottom(behavior: ScrollBehavior = "smooth") {
    window.requestAnimationFrame(() => {
      const list = messageListRef.current;
      const sentinel = messageEndRef.current;
      if (sentinel) sentinel.scrollIntoView({ behavior, block: "end", inline: "nearest" });
      else if (list) list.scrollTo({ top: list.scrollHeight, behavior });
      userPinnedToBottomRef.current = true;
      setUserPinnedToBottom(true);
    });
  }

  function updateScrollPosition() {
    const list = messageListRef.current;
    if (!list) return;
    const distanceFromBottom = list.scrollHeight - list.scrollTop - list.clientHeight;
    const isPinned = distanceFromBottom < 120;
    userPinnedToBottomRef.current = isPinned;
    setUserPinnedToBottom(isPinned);
  }

  function scrollActivityLogToBottom(behavior: ScrollBehavior = "smooth") {
    window.requestAnimationFrame(() => {
      const list = activityLogListRef.current;
      if (!list) return;
      list.scrollTo({ top: list.scrollHeight, behavior });
      activityLogPinnedToBottomRef.current = true;
    });
  }

  function updateActivityLogScrollPosition() {
    const list = activityLogListRef.current;
    if (!list) return;
    const distanceFromBottom = list.scrollHeight - list.scrollTop - list.clientHeight;
    activityLogPinnedToBottomRef.current = distanceFromBottom < 24;
  }

  function toggleActivityLog() {
    setActivityLogOpen((open) => {
      const nextOpen = !open;
      if (nextOpen) {
        activityLogPinnedToBottomRef.current = true;
        scrollActivityLogToBottom("auto");
      }
      return nextOpen;
    });
  }

  function queueStreamingText(text: string) {
    streamingBufferRef.current += text;
    if (streamingFlushRef.current !== null) return;
    streamingFlushRef.current = window.requestAnimationFrame(() => {
      streamingFlushRef.current = null;
      flushStreamingText();
    });
  }

  function flushStreamingText() {
    const nextText = streamingBufferRef.current;
    if (!nextText) return;
    streamingBufferRef.current = "";
    setStreamingAssistant((current) => `${current}${nextText}`);
  }

  function cancelStreamingFlush() {
    if (streamingFlushRef.current !== null) window.cancelAnimationFrame(streamingFlushRef.current);
    streamingFlushRef.current = null;
    streamingBufferRef.current = "";
  }

  function addRuntimePreview(preview: RuntimePreviewEntry) {
    setRuntimePreviews((current) => {
      const existingIndex = current.findIndex((item) => item.id === preview.id);
      if (existingIndex >= 0) {
        const updated = [...current];
        updated[existingIndex] = { ...updated[existingIndex], ...preview };
        return updated;
      }
      return [...current, preview];
    });
  }

  function startThinkingPreview() {
    const id = `thinking-${++runtimePreviewIdRef.current}`;
    activeThinkingPreviewIdRef.current = id;
    addRuntimePreview({
      id,
      kind: "thinking",
      text: "",
      phase: "streaming",
    });
  }

  function appendThinkingPreview(text: string) {
    let id = activeThinkingPreviewIdRef.current;
    if (!id) {
      startThinkingPreview();
      id = activeThinkingPreviewIdRef.current;
    }
    if (!id) return;
    setRuntimePreviews((current) => current.map((entry) => (
      entry.id === id
        ? { ...entry, text: `${entry.text}${text}`, phase: "streaming" }
        : entry
    )));
  }

  function finishThinkingPreview() {
    const id = activeThinkingPreviewIdRef.current;
    if (!id) return;
    activeThinkingPreviewIdRef.current = null;
    setRuntimePreviews((current) => current.map((entry) => (
      entry.id === id
        ? { ...entry, phase: "complete" }
        : entry
    )));
  }

  function clearRuntimePreviews() {
    activeThinkingPreviewIdRef.current = null;
    setRuntimePreviews([]);
  }

  function resetActivityLog() {
    activityLogPinnedToBottomRef.current = true;
    setActivityLog([]);
    setActivityLogOpen(false);
  }

  function seedActivityLog(seedEvents: AgentActivityEvent[]) {
    const now = Date.now();
    activityLogPinnedToBottomRef.current = true;
    setActivityLog(seedEvents.slice(-agentActivityLogLimit).map((event, index) => ({
      ...event,
      arrivedAt: new Date(now + index).toISOString(),
    })));
  }

  function addAgentEvent(event: Omit<AgentActivityEvent, "id">) {
    clearAgentEventTimer();
    const normalized = normalizeAgentActivityEvent(event);
    if (!normalized) return;
    const message = normalized.message;
    const detail = normalized.detail;
    if (!message) return;
    const nextEvent = {
      id: `activity-${++eventIdRef.current}`,
      message,
      detail,
      phase: normalized.phase,
      toolCallId: normalized.toolCallId,
      toolName: normalized.toolName,
    };
    setActivityLog((current) => [...current, { ...nextEvent, arrivedAt: new Date().toISOString() }].slice(-agentActivityLogLimit));
    setEvents((current) => {
      if (nextEvent.toolCallId) {
        const existingIndex = current.findIndex((item) => item.toolCallId === nextEvent.toolCallId);
        if (existingIndex >= 0) {
          const updated = [...current];
          updated[existingIndex] = { ...nextEvent, id: current[existingIndex]?.id ?? nextEvent.id };
          return updated;
        }
      }
      const last = current[current.length - 1];
      if (last?.message === message && last.detail === detail && last.phase === normalized.phase) return current;
      return [...current, nextEvent];
    });
    if (shouldKeepActivityRecap(nextEvent)) {
      setActivityRecap((current) => {
        const withoutDuplicate = current.filter((item) => activityRecapKey(item) !== activityRecapKey(nextEvent));
        return [...withoutDuplicate, nextEvent];
      });
    }
  }

  function scheduleEventClear() {
    clearAgentEventTimer();
    eventClearTimerRef.current = window.setTimeout(() => setEvents([]), 2400);
  }

  function clearAgentEventTimer() {
    if (eventClearTimerRef.current !== null) window.clearTimeout(eventClearTimerRef.current);
    eventClearTimerRef.current = null;
  }

  function cancelScriptPlayback() {
    if (scriptPlaybackTimerRef.current !== null) {
      window.clearTimeout(scriptPlaybackTimerRef.current);
      scriptPlaybackTimerRef.current = null;
    }
    if (scriptPlaybackStateRef.current === "playing") scriptPlaybackStateRef.current = "done";
  }

  // Unmount variant of cancelScriptPlayback: releases the page-level claim instead of marking the
  // playback done, so React StrictMode's simulated dev unmount/remount replays cleanly.
  function releaseScriptPlayback() {
    if (scriptPlaybackTimerRef.current !== null) {
      window.clearTimeout(scriptPlaybackTimerRef.current);
      scriptPlaybackTimerRef.current = null;
    }
    if (scriptPlaybackStateRef.current === "playing") {
      scriptPlaybackStateRef.current = "idle";
      fixtureScriptPlaybackClaimed = false;
    }
  }

  // Dev-only fixture script playback (`?fixture=workspace&script=<conversationId>`): replays the
  // conversation's first user+assistant pair as live action — typed prompt, activity events, streamed
  // reply — for product-video recording. Drives the same state setters the live event stream uses.
  function startScriptPlayback(conversation: WorkspaceFixtureConversation, initialDelayMs: number) {
    scriptPlaybackStateRef.current = "playing";
    setError(null);
    commitConversations((fixtureConversations ?? []).map(fixtureConversationSummary));
    setConversation(null);
    setMessages([]);
    setStreamingAssistant("");
    setRunning(false);
    setEvents([]);
    setActivityRecap([]);
    resetActivityLog();
    setRuntimePreviews([]);
    setContextAttachments(conversation.contextAttachments ?? []);
    setActiveContextPath(null);
    setDraft("");
    userPinnedToBottomRef.current = true;
    setUserPinnedToBottom(true);
    composerTextareaRef.current?.focus();
    const firstUser = conversation.messages.find((message) => message.role === "user");
    const firstAssistant = conversation.messages.find((message) => message.role === "assistant");
    if (!firstUser || !firstAssistant) {
      scriptPlaybackStateRef.current = "done";
      return;
    }
    const seededEvents = conversation.activityEvents ?? [];
    const firstPreview = (conversation.runtimePreviews ?? []).find((entry) => entry.kind === "thinking") ?? null;
    const prompt = firstUser.content;
    const chunks = scriptAssistantChunks(firstAssistant.content);

    const schedule = (delayMs: number, step: () => void) => {
      scriptPlaybackTimerRef.current = window.setTimeout(() => {
        scriptPlaybackTimerRef.current = null;
        if (scriptPlaybackStateRef.current !== "playing") return;
        step();
      }, delayMs);
    };

    const finish = () => {
      setMessages([firstUser, firstAssistant]);
      setStreamingAssistant("");
      setRunning(false);
      setEvents(seededEvents);
      seedActivityLog(seededEvents);
      setActivityRecap(seededEvents);
      setRuntimePreviews(conversation.runtimePreviews ?? []);
      scriptPlaybackStateRef.current = "done";
    };

    const streamChunk = (index: number) => {
      if (index >= chunks.length) {
        schedule(350, finish);
        return;
      }
      setStreamingAssistant((current) => `${current}${chunks[index]}`);
      schedule(30 + Math.random() * 30, () => streamChunk(index + 1));
    };

    const startStreaming = () => {
      setEvents(seededEvents);
      seedActivityLog(seededEvents);
      if (firstPreview) setRuntimePreviews([firstPreview]);
      schedule(420, () => streamChunk(0));
    };

    const revealEvent = (index: number) => {
      if (index >= seededEvents.length) {
        startStreaming();
        return;
      }
      setEvents(seededEvents.slice(0, index + 1).map((event, i) => (i === index ? { ...event, phase: "running" as const } : event)));
      if (firstPreview && index === Math.min(1, seededEvents.length - 1)) {
        setRuntimePreviews([{ ...firstPreview, phase: "streaming" }]);
      }
      schedule(700 + Math.random() * 200, () => revealEvent(index + 1));
    };

    const sendPrompt = () => {
      const summary = fixtureConversationSummary(conversation);
      setDraft("");
      setConversation(summary);
      onConversationActivated?.(summary);
      setMessages([firstUser]);
      setRunning(true);
      userPinnedToBottomRef.current = true;
      setUserPinnedToBottom(true);
      scrollMessagesToBottom("auto");
      schedule(650, () => revealEvent(0));
    };

    const typeChar = (index: number) => {
      setDraft(prompt.slice(0, index + 1));
      if (index + 1 >= prompt.length) {
        schedule(400, sendPrompt);
        return;
      }
      schedule(26 + Math.random() * 20, () => typeChar(index + 1));
    };

    schedule(initialDelayMs, () => typeChar(0));
  }

  function resizeComposerTextarea() {
    const textarea = composerTextareaRef.current;
    if (!textarea) return;
    const maxHeight = Number.parseFloat(getComputedStyle(textarea).maxHeight);
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, maxHeight)}px`;
    textarea.style.overflowY = textarea.scrollHeight > maxHeight ? "auto" : "hidden";
  }

  async function loadConversationList() {
    if (fixtureMode) return;
    pendingSendRef.current = null;
    postingPendingSendRef.current = false;
    eventStreamReadyConversationIdRef.current = null;
    transientConversationIdsRef.current = new Set();
    setError(null);
    setRunning(false);
    setStreamingAssistant("");
    clearRuntimePreviews();
    setEvents([]);
    setActivityRecap([]);
    resetActivityLog();
    setContextAttachments([]);
    setActiveContextPath(null);
    setConversation(null);
    setMessages([]);
    onConversationActivated?.(null);
    userPinnedToBottomRef.current = true;
    setUserPinnedToBottom(true);
    try {
      const result = await api<{ conversations: ConversationSummary[] }>(`/api/workspaces/${workspace.id}/conversations`);
      commitConversations(result.conversations);
    } catch (conversationError) {
      setError(errorText(conversationError));
    }
  }

  async function newConversation() {
    if (fixtureMode) {
      cancelScriptPlayback();
      setConversation(null);
      commitConversations((fixtureConversations ?? []).map(fixtureConversationSummary));
      setMessages([]);
      setDraft("");
      setRunning(false);
      setError(null);
      setEvents([]);
      setActivityRecap([]);
      resetActivityLog();
      setStreamingAssistant("");
      clearRuntimePreviews();
      setContextAttachments([]);
      setActiveContextPath(null);
      onConversationActivated?.(null);
      return;
    }
    setRunning(false);
    setError(null);
    setEvents([]);
    setActivityRecap([]);
    resetActivityLog();
    setStreamingAssistant("");
    clearRuntimePreviews();
    setContextAttachments([]);
    setActiveContextPath(null);
    userPinnedToBottomRef.current = true;
    setUserPinnedToBottom(true);
    const result = await api<{ conversation: ConversationSummary }>(`/api/workspaces/${workspace.id}/conversations`, { method: "POST" });
    transientConversationIdsRef.current.add(result.conversation.id);
    setConversation(result.conversation);
    onConversationActivated?.(result.conversation);
    setMessages([]);
    scrollMessagesToBottom("auto");
  }

  async function switchConversation(selected: ConversationSummary) {
    if (fixtureMode) return;
    setConversation(selected);
    onConversationActivated?.(selected);
    setRunning(false);
    setError(null);
    setEvents([]);
    setActivityRecap([]);
    resetActivityLog();
    setStreamingAssistant("");
    clearRuntimePreviews();
    cancelStreamingFlush();
    setContextAttachments([]);
    setActiveContextPath(null);
    userPinnedToBottomRef.current = true;
    setUserPinnedToBottom(true);
    await loadMessages(selected.id, true);
  }

  const hasRuntimePreview = runtimePreviews.length > 0;
  const hasTranscript = messages.length > 0 || Boolean(streamingAssistant) || hasRuntimePreview || running;

  async function loadMessages(conversationId: string, pinToBottom = false, options: { settleStreamingTurn?: boolean } = {}) {
    const settleStreamingTurn = options.settleStreamingTurn ?? false;
    try {
      if (fixtureMode) return;
      const result = await api<{ messages: ChatMessage[] }>(`/api/workspaces/${workspace.id}/conversations/${conversationId}`);
      const transcript = result.messages.filter((message) => message.role !== "system");
      setMessages((current) => {
        // Rows that replace content already on screen (the streamed reply)
        // must not replay the message-enter animation when they mount.
        if (settleStreamingTurn) {
          const knownIds = new Set(current.map((message) => message.id));
          for (const message of transcript) {
            if (!knownIds.has(message.id)) suppressMessageEnterIdsRef.current.add(message.id);
          }
        } else {
          suppressMessageEnterIdsRef.current.clear();
        }
        return transcript;
      });
      applyModelConversationTitle(conversationId, result.messages);
      applyKnownFirstUserConversationTitle(conversationId, result.messages);
      if (pinToBottom) {
        userPinnedToBottomRef.current = true;
        setUserPinnedToBottom(true);
        scrollMessagesToBottom("auto");
      }
    } finally {
      if (settleStreamingTurn) {
        setStreamingAssistant("");
        setRunning(false);
      }
    }
  }

  function applyKnownFirstUserConversationTitle(conversationId: string, transcript: ChatMessage[]) {
    const existing = conversationsRef.current.find((item) => item.id === conversationId) ?? conversation;
    if (!existing) return;
    const title = chatDisplayTitle({ serverTitle: existing.title, messages: transcript });
    if (existing.title === title) return;
    const updatedAt = latestTranscriptTime(transcript) ?? existing.updatedAt;
    const updatedConversation = { ...existing, title, updatedAt };
    setConversation((current) => current?.id === conversationId ? updatedConversation : current);
    commitConversations((current) => {
      const next = current.some((item) => item.id === conversationId)
        ? current.map((item) => item.id === conversationId ? updatedConversation : item)
        : [updatedConversation, ...current];
      return next.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
    });
    if (conversation?.id === conversationId || targetConversationId === conversationId) {
      onConversationActivated?.(updatedConversation);
    }
  }

  function applyModelConversationTitle(conversationId: string, transcript: ChatMessage[]) {
    const title = modelConversationTitle(transcript);
    if (!title) return;
    const updatedAt = latestTranscriptTime(transcript) ?? new Date().toISOString();
    const existing = conversationsRef.current.find((item) => item.id === conversationId) ?? conversation;
    if (!existing || (existing.title === title && existing.updatedAt === updatedAt)) return;
    const updatedConversation = { ...existing, title, updatedAt };
    setConversation((current) => current?.id === conversationId ? updatedConversation : current);
    commitConversations((current) => {
      const next = current.some((item) => item.id === conversationId)
        ? current.map((item) => item.id === conversationId ? updatedConversation : item)
        : [updatedConversation, ...current];
      return next.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
    });
    if (conversation?.id === conversationId || targetConversationId === conversationId) {
      onConversationActivated?.(updatedConversation);
    }
  }

  async function sendMessage() {
    if (!draft.trim() || running) return;
    // While a fixture script is replaying, the composer belongs to the playback — ignore manual sends.
    if (fixtureMode && scriptPlaybackStateRef.current === "playing") return;
    const content = draft.trim();
    const sentDraftStorageKey = draftStorageKey;
    setDraft("");
    setRunning(true);
    setError(null);
    setEvents([]);
    setActivityRecap([]);
    clearRuntimePreviews();
    clearAgentEventTimer();
    userPinnedToBottomRef.current = true;
    setUserPinnedToBottom(true);
    const now = Date.now();
    const localUserMessage: ChatMessage = { id: `local-${now}`, role: "user", content, createdAt: new Date(now).toISOString() };
    setMessages((current) => [...current, localUserMessage]);
    scrollMessagesToBottom("auto");
    if (fixtureMode) {
      const fixtureConversation = conversation ?? { id: "fixture-chat", title: "New chat", updatedAt: new Date(now).toISOString() };
      setConversation(fixtureConversation);
      onConversationActivated?.(fixtureConversation);
      commitConversations((current) => current.some((item) => item.id === fixtureConversation.id) ? current : [fixtureConversation, ...current]);
      window.setTimeout(() => {
        setMessages((current) => [
          ...current,
          {
            id: `fixture-reply-${now}`,
            role: "assistant",
            content: "This is a saved preview. Open the live app to continue with the Assistant.",
            createdAt: new Date().toISOString(),
          },
        ]);
        setRunning(false);
      }, 240);
      return;
    }
    try {
      const activeConversation = conversation ?? (await api<{ conversation: ConversationSummary }>(`/api/workspaces/${workspace.id}/conversations`, { method: "POST" })).conversation;
      const shouldUseOptimisticFirstPromptTitle = !conversation || transientConversationIdsRef.current.has(activeConversation.id) || activeConversation.title === "Workspace chat";
      const optimisticConversation = shouldUseOptimisticFirstPromptTitle
        ? {
            ...activeConversation,
            title: chatDisplayTitle({ firstUserMessage: content }),
            updatedAt: localUserMessage.createdAt,
          }
        : activeConversation;
      if (!conversation) {
        transientConversationIdsRef.current.add(activeConversation.id);
      }
      if (shouldUseOptimisticFirstPromptTitle) {
        setConversation(optimisticConversation);
        onConversationActivated?.(optimisticConversation);
        commitConversations((current) => [optimisticConversation, ...current.filter((item) => item.id !== optimisticConversation.id)]);
      }
      pendingSendRef.current = {
        conversation: activeConversation,
        content,
        localUserMessage,
        selectedPath,
        contextPaths: contextAttachments.map((attachment) => attachment.sourcePath),
        transientConversation: transientConversationIdsRef.current.has(activeConversation.id),
        draftStorageKey: sentDraftStorageKey,
      };
      if (eventStreamReadyConversationIdRef.current === activeConversation.id) void postPendingMessage();
    } catch (sendError) {
      setRunning(false);
      clearRuntimePreviews();
      setError(errorText(sendError));
      setDraft(content);
      setMessages((current) => current.filter((message) => message.id !== localUserMessage.id));
    }
  }

  async function postPendingMessage() {
    const pending = pendingSendRef.current;
    if (!pending || postingPendingSendRef.current) return;
    if (eventStreamReadyConversationIdRef.current !== pending.conversation.id) return;
    postingPendingSendRef.current = true;
    pendingSendRef.current = null;
    try {
      const result = await api<{ accepted: boolean; message: ChatMessage }>(`/api/workspaces/${workspace.id}/conversations/${pending.conversation.id}/messages`, {
        method: "POST",
        body: {
          content: pending.content,
          selectedPath: pending.selectedPath,
          contextPaths: pending.contextPaths,
        },
      });
      clearStoredChatDraft(pending.draftStorageKey);
      const shouldUseFirstPromptTitle = pending.transientConversation || pending.conversation.title === "Workspace chat";
      const updatedConversation = {
        ...pending.conversation,
        title: shouldUseFirstPromptTitle ? chatDisplayTitle({ firstUserMessage: pending.content }) : chatDisplayTitle({ serverTitle: pending.conversation.title }),
        updatedAt: result.message.createdAt,
      };
      transientConversationIdsRef.current.delete(pending.conversation.id);
      setConversation((current) => current?.id === pending.conversation.id ? updatedConversation : current);
      commitConversations((current) => [updatedConversation, ...current.filter((item) => item.id !== updatedConversation.id)]);
      onConversationActivated?.(updatedConversation);
      // The optimistic bubble is already visible; its persisted replacement
      // must mount without replaying the enter animation.
      suppressMessageEnterIdsRef.current.add(result.message.id);
      setMessages((current) => current.map((message) => message.id === pending.localUserMessage.id ? result.message : message));
    } catch (sendError) {
      setRunning(false);
      clearRuntimePreviews();
      setError(errorText(sendError));
      setDraft(pending.content);
      setMessages((current) => current.filter((message) => message.id !== pending.localUserMessage.id));
      if (pending.transientConversation) {
        transientConversationIdsRef.current.delete(pending.conversation.id);
        setConversation(null);
        commitConversations((current) => current.filter((item) => item.id !== pending.conversation.id));
      }
    } finally {
      postingPendingSendRef.current = false;
    }
  }

  async function abortTurn() {
    if (!running) return;
    addAgentEvent({ message: "Stopping the Assistant", phase: "running" });
    if (pendingSendRef.current) {
      const pending = pendingSendRef.current;
      pendingSendRef.current = null;
      postingPendingSendRef.current = false;
      setRunning(false);
      clearRuntimePreviews();
      setMessages((current) => current.filter((message) => message.id !== pending.localUserMessage.id));
      if (pending.transientConversation) {
        transientConversationIdsRef.current.delete(pending.conversation.id);
        setConversation(null);
      }
      return;
    }
    if (fixtureMode) {
      cancelScriptPlayback();
      setRunning(false);
      setStreamingAssistant("");
      clearRuntimePreviews();
      return;
    }
    if (!conversation) return;
    try {
      const result = await api<{ aborted: boolean }>(`/api/workspaces/${workspace.id}/conversations/${conversation.id}/abort`, { method: "POST" });
      if (!result.aborted) addAgentEvent({ message: "No running Assistant turn found", phase: "complete" });
    } catch (abortError) {
      setError(errorText(abortError));
    }
  }

  async function compactConversation() {
    if (running || fixtureMode || !conversation) return;
    setRunning(true);
    setError(null);
    addAgentEvent({ message: "Compacting chat context", phase: "running" });
    try {
      await api<{ compacted: boolean }>(`/api/workspaces/${workspace.id}/conversations/${conversation.id}/compact`, { method: "POST" });
      setRunning(false);
      addAgentEvent({ message: "Chat context compacted", phase: "complete" });
      scheduleEventClear();
    } catch (compactError) {
      setRunning(false);
      setError(errorText(compactError));
    }
  }

  async function attachContextPath(path: string) {
    setError(null);
    setAttachingPath(path);
    try {
      if (contextAttachments.some((attachment) => attachment.sourcePath === path)) return;
      if (fixtureMode) {
        setContextAttachments((current) => [...current, createFixtureContextAttachment(path)]);
        return;
      }
      const result = await api<{ attachment: ContextAttachment }>(`/api/workspaces/${workspace.id}/context-attachments`, {
        method: "POST",
        body: { path },
      });
      setContextAttachments((current) => current.some((item) => item.sourcePath === result.attachment.sourcePath)
        ? current
        : [...current, result.attachment]);
    } catch (attachError) {
      setError(errorText(attachError));
    } finally {
      setAttachingPath(null);
      setDragActive(false);
    }
  }

  function removeContextAttachment(sourcePath: string) {
    setContextAttachments((current) => current.filter((attachment) => attachment.sourcePath !== sourcePath));
    if (activeContextPath === sourcePath) setActiveContextPath(null);
  }

  const copyMessage = useCallback(async (messageId: string, content: string) => {
    try {
      await copyMarkdownToClipboard(content);
      setCopiedMessageId(messageId);
      window.setTimeout(() => setCopiedMessageId((current) => current === messageId ? null : current), 1600);
    } catch (copyError) {
      setError(errorText(copyError));
    }
  }, []);

  const resolveWorkspacePathLinks = useCallback(async (paths: string[]) => {
    if (fixtureMode) return resolveFixtureWorkspacePathCandidates(paths, fixtureTreeEntries);
    const result = await api<{ existing: string[] }>(`/api/workspaces/${workspace.id}/paths-exist`, {
      method: "POST",
      body: { paths },
    });
    const byCandidate = new Map<string, string>();
    for (const path of paths) {
      const direct = result.existing.find((existingPath) => existingPath === path);
      if (direct) {
        byCandidate.set(path, direct);
        continue;
      }
      if (path.includes("/")) continue;
      const bareNameMatches = result.existing.filter((existingPath) => (existingPath.split("/").pop() ?? "").toLocaleLowerCase() === path.toLocaleLowerCase());
      if (bareNameMatches.length === 1 && bareNameMatches[0]) byCandidate.set(path, bareNameMatches[0]);
    }
    return byCandidate;
  }, [fixtureMode, fixtureTreeEntries, workspace.id]);

  function droppedWorkspacePath(event: React.DragEvent<HTMLElement>): string {
    return event.dataTransfer.getData(workspacePathDragType);
  }

  function hasWorkspacePathDrag(event: React.DragEvent<HTMLElement>): boolean {
    return Array.from(event.dataTransfer.types).includes(workspacePathDragType);
  }

  function handleComposerDragEnter(event: React.DragEvent<HTMLFormElement>): void {
    if (!hasWorkspacePathDrag(event) || !onAddPathToChatContext) return;
    event.preventDefault();
    setDragActive(true);
  }

  function handleComposerDragOver(event: React.DragEvent<HTMLFormElement>): void {
    if (!hasWorkspacePathDrag(event) || !onAddPathToChatContext) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    setDragActive(true);
  }

  function handleComposerDragLeave(event: React.DragEvent<HTMLFormElement>): void {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragActive(false);
  }

  function handleComposerDrop(event: React.DragEvent<HTMLFormElement>): void {
    if (!hasWorkspacePathDrag(event) || !onAddPathToChatContext) return;
    event.preventDefault();
    const path = droppedWorkspacePath(event);
    setDragActive(false);
    if (path) onAddPathToChatContext(path);
  }

  const activeContextAttachment = contextAttachments.find((attachment) => attachment.sourcePath === activeContextPath) ?? null;
  const latestAssistantMessage = [...messages].reverse().find((message) => message.role === "assistant") ?? null;
  const latestAssistantMessageId = latestAssistantMessage?.id ?? null;
  const suggestedNextPrompt = !running && !streamingAssistant
    ? latestAssistantMessage?.landing?.followUpPrompt?.trim() ?? ""
    : "";
  const activityToggleClassName = [
    "agent-activity-toggle",
    activityLogOpen ? "open" : "",
    activityLog.length ? "has-activity" : "",
    activityLog.some((event) => event.phase === "error") ? "has-error" : "",
  ].filter(Boolean).join(" ");

  async function respondToExtension(value: unknown, cancelled = false) {
    if (!extensionRequest || !conversation) return;
    const request = extensionRequest;
    setExtensionRequest(null);
    try {
      await api(`/api/workspaces/${workspace.id}/conversations/${conversation.id}/extension-ui/${request.id}`, {
        method: "POST",
        body: { value, cancelled },
      });
    } catch (caught) {
      setError(errorText(caught));
    }
  }

  function applySuggestedPrompt(prompt: string): void {
    if (!prompt || running) return;
    setDraft(prompt);
    window.requestAnimationFrame(() => {
      composerTextareaRef.current?.focus();
      composerTextareaRef.current?.setSelectionRange(prompt.length, prompt.length);
    });
  }

  return (
    <section
      className="panel chat-panel"
    >
      <div className={error || hasTranscript || running ? "chat-top-chrome" : "chat-top-chrome empty"}>
        <div className="chat-top-notice">
          {error ? <Banner tone="error" text={error} /> : null}
        </div>
        <div className="chat-floating-actions">
          {running ? (
            <button className="new-chat-button stop-chat-button" type="button" onClick={() => void abortTurn()} aria-label="Stop Assistant" title="Stop Assistant">
              <Square size={15} />
            </button>
          ) : null}
        </div>
      </div>
      <div className="chat-scroll-shell">
        <div className="message-list" ref={messageListRef} onScroll={updateScrollPosition}>
          {messages.map((message) => {
            const isLatestAssistantAtRest = message.role === "assistant" && message.id === latestAssistantMessageId && !running && !streamingAssistant;
            const showRecap = isLatestAssistantAtRest && activityRecap.length > 0;
            const showRuntimePreview = isLatestAssistantAtRest && hasRuntimePreview;
            return (
              <ChatMessageRow
                message={message}
                copied={copiedMessageId === message.id}
                showLanding={isLatestAssistantAtRest}
                suppressEnterAnimation={suppressMessageEnterIdsRef.current.has(message.id)}
                showRecap={showRecap}
                showRuntimePreview={showRuntimePreview}
                runtimePreviews={runtimePreviews}
                activityRecap={activityRecap}
                workspaceId={workspace.id}
                onOpenWorkspaceFile={onOpenWorkspaceFile}
                resolveWorkspacePathLinks={resolveWorkspacePathLinks}
                onCopyMessage={copyMessage}
                key={message.id}
              />
            );
          })}
          {running && (streamingAssistant || hasRuntimePreview) ? (
            <article className="message assistant streaming">
              <div className="message-header">
                <span className="message-author">{assistantName}</span>
              </div>
              {hasRuntimePreview ? <RuntimeContextPreview entries={runtimePreviews} running={running} /> : null}
              {streamingAssistant ? <MarkdownMessage content={streamingAssistant} /> : null}
            </article>
          ) : null}
          {running && !streamingAssistant && !hasRuntimePreview ? (
            <article className="message assistant streaming working-message">
              <div className="message-header">
                <span className="message-author">{assistantName}</span>
              </div>
              <div className="typing-line"><Loader2 className="spin" size={14} /> Working</div>
            </article>
          ) : null}
          {!hasTranscript ? (
            <ChatEmptyState greeting={emptyStateGreeting} workspace={workspace} identity={workspaceIdentity} />
          ) : null}
          <div className="message-end-sentinel" ref={messageEndRef} aria-hidden="true" />
        </div>
        {!userPinnedToBottom ? (
          <button className="jump-to-latest" type="button" onClick={() => scrollMessagesToBottom()}>
            <FluentGlyph icon={ArrowDown20Regular} size={15} />
            Latest
          </button>
        ) : null}
      </div>
      <form
        className={dragActive ? "composer composer-drop-active" : "composer"}
        onDragEnter={handleComposerDragEnter}
        onDragOver={handleComposerDragOver}
        onDragLeave={handleComposerDragLeave}
        onDrop={handleComposerDrop}
        onSubmit={(event) => {
          event.preventDefault();
          if (draft.trim() && !running) void sendMessage();
        }}
      >
        {dragActive ? <div className="composer-drop-affordance" aria-hidden="true">Attach to chat</div> : null}
        <div className="agent-activity-row">
          {events.length ? <AgentActivityTicker events={events} /> : <span className="agent-events-spacer" aria-hidden="true" />}
          {suggestedNextPrompt ? (
            <button
              className="suggested-prompt-button"
              type="button"
              onClick={() => applySuggestedPrompt(suggestedNextPrompt)}
              title={suggestedNextPrompt}
              aria-label={`Use suggested prompt: ${suggestedNextPrompt}`}
            >
              <span>{suggestedNextPrompt}</span>
            </button>
          ) : null}
          <button
            className={activityToggleClassName}
            type="button"
            onClick={toggleActivityLog}
            aria-expanded={activityLogOpen}
            aria-controls="agent-activity-log"
            title="Activity"
          >
            <span>Activity</span>
          </button>
        </div>
        {activityLogOpen ? (
          <AgentActivityLog
            events={activityLog}
            listRef={activityLogListRef}
            onScroll={updateActivityLogScrollPosition}
          />
        ) : null}
        {contextAttachments.length || attachingPath ? (
          <div
            className="context-tray"
            aria-label="Attached files"
          >
            {contextAttachments.length ? (
              <div className="context-pill-list">
                {contextAttachments.map((attachment) => (
                  <div className={`context-chip ${attachment.mode}`} key={attachment.sourcePath}>
                    <button
                      className="context-chip-main"
                      type="button"
                      onClick={() => setActiveContextPath((current) => current === attachment.sourcePath ? null : attachment.sourcePath)}
                      title={attachment.detail}
                      aria-label={`Show attachment details for ${attachment.sourceFileName}`}
                    >
                      <FileTypeIcon path={attachment.sourcePath} />
                      <span className="context-chip-name">{attachment.sourceFileName}</span>
                      <ContextModeIcon attachment={attachment} />
                    </button>
                    <button className="context-chip-remove" type="button" onClick={() => removeContextAttachment(attachment.sourcePath)} aria-label={`Remove ${attachment.sourceFileName}`}>
                      <X size={12} />
                    </button>
                  </div>
                ))}
              </div>
            ) : null}
            {attachingPath ? (
              <div className="context-chip checking">
                <span className="file-icon file-icon-unknown">
                  <Loader2 className="spin" size={13} />
                </span>
                <span className="context-chip-name">Checking</span>
              </div>
            ) : null}
            {activeContextAttachment ? (
              <ContextAttachmentPopover attachment={activeContextAttachment} onClose={() => setActiveContextPath(null)} />
            ) : null}
          </div>
        ) : null}
        <div className="composer-input-shell">
          <textarea
            ref={composerTextareaRef}
            aria-label="Message Assistant"
            rows={2}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                if (draft.trim() && !running) void sendMessage();
              }
            }}
            placeholder="Message Assistant"
          />
          <button className="send-button" type="submit" disabled={!draft.trim() || running} aria-label="Send message" aria-busy={running ? "true" : undefined}>
            <FluentGlyph icon={ArrowUp20Regular} size={18} />
          </button>
        </div>
      </form>
      {extensionRequest ? <ExtensionRequestDialog request={extensionRequest} onRespond={respondToExtension} /> : null}
    </section>
  );
}

function ExtensionRequestDialog({ request, onRespond }: { request: ExtensionUiRequest; onRespond: (value: unknown, cancelled?: boolean) => Promise<void> }) {
  const [value, setValue] = useState(request.initialValue ?? "");
  return <div className="modal-backdrop extension-request-backdrop" role="presentation" onMouseDown={() => void onRespond(null, true)}>
    <section className="modal-card extension-request-dialog" role="dialog" aria-modal="true" aria-labelledby={`extension-request-${request.id}`} onMouseDown={(event) => event.stopPropagation()}>
      <header><div><h2 id={`extension-request-${request.id}`}>{request.title || "Extension request"}</h2>{request.message ? <p>{request.message}</p> : null}</div><button className="minimal-icon-button" type="button" onClick={() => void onRespond(null, true)} aria-label="Cancel extension request"><X size={16} /></button></header>
      <div className="modal-body extension-dialog-content">
        {request.method === "select" ? <div className="select-options">{request.options?.map((option) => <button className="secondary-button" type="button" key={option} onClick={() => void onRespond(option)}>{option}</button>)}</div> : null}
        {request.method === "confirm" ? <div className="modal-actions"><button className="secondary-button" type="button" onClick={() => void onRespond(false)}>No</button><button className="primary-button" type="button" onClick={() => void onRespond(true)}>Yes</button></div> : null}
        {request.method === "input" || request.method === "editor" ? <><label>{request.method === "editor" ? "Response" : "Value"}{request.method === "editor" ? <textarea rows={9} value={value} onChange={(event) => setValue(event.target.value)} placeholder={request.placeholder} autoFocus /> : <input type={request.secret ? "password" : "text"} value={value} onChange={(event) => setValue(event.target.value)} placeholder={request.placeholder} autoFocus autoComplete={request.secret ? "off" : undefined} />}</label><div className="modal-actions"><button className="secondary-button" type="button" onClick={() => void onRespond(null, true)}>Cancel</button><button className="primary-button" type="button" onClick={() => void onRespond(value)}>Continue</button></div></> : null}
      </div>
    </section>
  </div>;
}

function ContextModeIcon({ attachment }: { attachment: ContextAttachment }) {
  if (attachment.mode === "path_only_reference") {
    return <AlertTriangle className="context-chip-status blocked" size={12} aria-hidden="true" />;
  }
  if (attachment.warnings.length) {
    return <AlertTriangle className="context-chip-status review" size={12} aria-hidden="true" />;
  }
  return <CircleCheck className="context-chip-status verified" size={12} aria-hidden="true" />;
}

function ContextAttachmentPopover({ attachment, onClose }: { attachment: ContextAttachment; onClose: () => void }) {
  const chatSpacePercent = attachment.budgetTokens > 0 ? Math.round((attachment.estimatedTokens / attachment.budgetTokens) * 100) : 0;
  const chatSpaceLabel = chatSpacePercent === 0 ? "under 1%" : `about ${chatSpacePercent}% of the limit`;
  return (
    <div className="context-meta-popover">
      <div className="context-meta-title">
        <FileTypeIcon path={attachment.sourcePath} />
        <strong>{attachment.sourceFileName}</strong>
        <button type="button" onClick={onClose} aria-label="Close context details">
          <X size={13} />
        </button>
      </div>
      <dl className="context-meta-grid">
        <div>
          <dt>Attached as</dt>
          <dd>{attachment.userLabel}</dd>
        </div>
        <div>
          <dt>Size</dt>
          <dd>{formatBytes(attachment.sourceSizeBytes)}</dd>
        </div>
        <div>
          <dt>Chat space</dt>
          <dd>{chatSpaceLabel}</dd>
        </div>
      </dl>
      <p>{attachment.detail}</p>
      {attachment.provenance.length ? <p>{attachment.provenance.join("; ")}</p> : null}
      {attachment.warnings.length ? <p>Review notes: {attachment.warnings.join("; ")}</p> : null}
    </div>
  );
}

function ChatEmptyState({
  greeting,
  workspace,
  identity,
}: {
  greeting: string;
  workspace: WorkspaceSummary;
  identity: WorkspaceIdentity;
}) {
  const Icon = identity.Icon;
  return (
    <div className="chat-empty-state" style={workspaceIdentityStyle(identity)}>
      <strong>{greeting}</strong>
      <span className="chat-empty-workspace">
        <WorkspaceIconGlyph icon={Icon} size={15} />
        <span>{workspace.name}</span>
      </span>
    </div>
  );
}

function randomChatEmptyGreeting(): string {
  const templates = genericChatEmptyGreetings;
  const template = templates[Math.floor(Math.random() * templates.length)] ?? "Hello.";
  return template;
}

function fixtureAgentRunning(): boolean {
  return new URLSearchParams(window.location.search).get("agentState") === "running";
}

// One playback per page load: the first ChatPanel whose fixture conversations contain the script
// conversation claims it, so extra tabs for the same workspace never restart the show.
let fixtureScriptPlaybackClaimed = false;

function fixtureScriptPlayback(): { conversationId: string; delayMs: number } | null {
  if (!import.meta.env.DEV) return null;
  const params = new URLSearchParams(window.location.search);
  if (params.get("fixture") !== "workspace") return null;
  const conversationId = params.get("script");
  if (!conversationId) return null;
  const parsedDelay = Number.parseInt(params.get("scriptDelay") ?? "", 10);
  const delayMs = Number.isFinite(parsedDelay) && parsedDelay >= 0 ? parsedDelay : 1500;
  return { conversationId, delayMs };
}

function scriptAssistantChunks(content: string): string[] {
  const parts = content.split(/(\s+)/);
  const chunks: string[] = [];
  let buffer = "";
  for (const part of parts) {
    buffer += part;
    if (buffer.trim().length >= 8) {
      chunks.push(buffer);
      buffer = "";
    }
  }
  if (buffer) chunks.push(buffer);
  return chunks;
}

function fixtureRuntimePreviews(): RuntimePreviewEntry[] {
  if (new URLSearchParams(window.location.search).get("agentEvents") !== "1") return [];
  const running = fixtureAgentRunning();
  const previews: RuntimePreviewEntry[] = [
    {
      id: "fixture-thinking-context",
      kind: "thinking",
      text: "I need to compare the project notes, inspect the spreadsheet, and identify the decisions that need the user’s attention.\n\n**Checking the files**\n\nI’m matching the notes against the budget so the answer can point to the exact files involved.",
      phase: "complete",
    },
    {
      id: "fixture-thinking-formatting",
      kind: "thinking",
      text: "**Organizing the result**\n\nI’m separating the cost differences from the open questions so the next action is easy to see.",
      phase: running ? "streaming" : "complete",
    },
  ];
  if (running) {
    previews.push({
      id: "fixture-thinking-next",
      kind: "thinking",
      text: "",
      phase: "streaming",
    });
  }
  return previews;
}
