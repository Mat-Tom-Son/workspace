import type { CSSProperties, ReactNode, RefObject } from "react";
import { BrainCircuit20Regular } from "@fluentui/react-icons";
import { AlertTriangle, ChevronDown, Circle, CircleCheck, Loader2 } from "lucide-react";

import { runtimeThinkingFallbackTitle } from "../../constants";
import { formatActivityLogTime } from "../../lib/format";
import type { AgentActivityEvent, AgentActivityLogEntry, AgentActivityPhase, RuntimePreviewEntry, RuntimeThinkingSection } from "../../types";
import { FluentGlyph } from "../chrome/common";

export function RuntimeContextPreview({ entries, running = false }: { entries: RuntimePreviewEntry[]; running?: boolean }) {
  const visibleEntries = entries.filter((entry) => entry.kind === "thinking" && (running || entry.text.trim()));
  const sections = runtimeThinkingSections(visibleEntries, running);
  if (!visibleEntries.length || !sections.length) return null;
  const streaming = running && visibleEntries.some((entry) => entry.phase !== "complete");
  return (
    <section className={running ? "runtime-preview running" : "runtime-preview"} aria-label="Thinking output">
      <article className={`runtime-preview-item thinking ${streaming ? "streaming" : "complete"}`}>
        <div className="runtime-preview-item-header">
          <span className="runtime-preview-item-title">
            <FluentGlyph icon={BrainCircuit20Regular} size={15} />
            Thinking
          </span>
          <span className="runtime-preview-item-subtitle">
            {streaming ? "Streaming" : "Complete"}
          </span>
        </div>
        <div className="runtime-preview-outline">
          {sections.map((section) => <RuntimeThinkingSectionView section={section} key={section.id} />)}
        </div>
      </article>
    </section>
  );
}

function RuntimeThinkingSectionView({ section }: { section: RuntimeThinkingSection }) {
  const hasText = Boolean(section.text.trim());
  return (
    <section className={section.pending ? "runtime-preview-section pending" : "runtime-preview-section"}>
      <h4 className="runtime-preview-section-title">
        {section.pending ? <Loader2 className="spin" size={13} aria-hidden="true" /> : null}
        <span>{section.title}</span>
      </h4>
      {hasText ? (
        <p className="runtime-preview-section-body">
          {section.text}
        </p>
      ) : null}
    </section>
  );
}

function runtimeThinkingSections(entries: RuntimePreviewEntry[], running: boolean): RuntimeThinkingSection[] {
  const text = entries.map((entry) => entry.text.trim()).filter(Boolean).join("\n\n");
  const sections = text ? parseRuntimeThinkingText(text) : [];
  const pending = running && entries.some((entry) => entry.phase !== "complete" && !entry.text.trim());
  if (pending) {
    sections.push({
      id: "thinking-pending",
      title: runtimeThinkingFallbackTitle,
      text: "",
      pending: true,
    });
  }
  return sections.length ? sections : running ? [{
    id: "thinking-pending",
    title: runtimeThinkingFallbackTitle,
    text: "",
    pending: true,
  }] : [];
}

function parseRuntimeThinkingText(text: string): RuntimeThinkingSection[] {
  const sections: RuntimeThinkingSection[] = [];
  let currentTitle: string | null = null;
  let currentLines: string[] = [];

  const flushSection = () => {
    const sectionText = currentLines.join("\n").trim();
    if (!sectionText && !currentTitle) return;
    sections.push({
      id: `thinking-section-${sections.length + 1}`,
      title: currentTitle ?? runtimeThinkingFallbackTitle,
      text: sectionText,
    });
  };

  for (const line of text.replace(/\r\n/g, "\n").split("\n")) {
    const title = runtimeThinkingTitleFromLine(line);
    if (title) {
      flushSection();
      currentTitle = title;
      currentLines = [];
      continue;
    }
    currentLines.push(line);
  }

  flushSection();
  return sections;
}

function runtimeThinkingTitleFromLine(line: string): string | null {
  const trimmed = line.trim();
  const markdownHeading = trimmed.match(/^#{1,4}\s+(.{1,120})$/);
  const boldHeading = trimmed.match(/^\*\*([^*\n]{1,120})\*\*:?$/);
  const title = markdownHeading?.[1] ?? boldHeading?.[1];
  return title ? title.replace(/\s+/g, " ").trim() : null;
}

export function AgentActivityTicker({ events }: { events: AgentActivityEvent[] }) {
  const visibleEvents = [...events].reverse();
  return (
    <div className="agent-events" aria-label="Assistant activity" aria-live="polite">
      {visibleEvents.map((event, index) => (
        <span
          className={`agent-event ${event.phase ?? "running"}`}
          key={event.id}
          style={{ "--event-age-opacity": Math.max(0.34, 1 - index * 0.09) } as CSSProperties}
          title={event.message}
        >
          <span className="agent-event-dot" aria-hidden="true" />
          <span className="agent-event-copy">
            <strong>{event.message}</strong>
          </span>
        </span>
      ))}
    </div>
  );
}

export function AgentActivityLog({
  events,
  listRef,
  onScroll,
}: {
  events: AgentActivityLogEntry[];
  listRef: RefObject<HTMLDivElement | null>;
  onScroll: () => void;
}) {
  return (
    <section className="agent-activity-log" id="agent-activity-log" aria-label="Activity log">
      {events.length ? (
        <div className="agent-activity-log-list" ref={listRef} onScroll={onScroll}>
          {events.map((event) => (
            <article className={`agent-activity-log-item ${event.phase ?? "running"}`} key={event.id}>
              <span className="agent-activity-log-icon" aria-hidden="true">
                {activityPhaseIcon(event.phase)}
              </span>
              <span className="agent-activity-log-copy">
                <span className="agent-activity-log-line">
                  <strong>{event.message}</strong>
                  <time dateTime={event.arrivedAt}>{formatActivityLogTime(event.arrivedAt)}</time>
                </span>
                {event.detail ? <span className="agent-activity-log-detail">{event.detail}</span> : null}
                {event.toolName ? <code>{event.toolName}</code> : null}
              </span>
            </article>
          ))}
        </div>
      ) : (
        <p className="agent-activity-log-empty">Assistant activity will appear here during a turn.</p>
      )}
    </section>
  );
}

export function AgentActivityRecap({ events }: { events: AgentActivityEvent[] }) {
  const items = recapActivityEvents(events);
  if (!items.length) return null;
  const summary = activityRecapSummary(items);
  const errorCount = items.filter((event) => event.phase === "error").length;
  return (
    <details className={errorCount ? "agent-recap has-errors" : "agent-recap"} aria-label="Activity recap">
      <summary>
        <span className="agent-recap-heading">
          <span className="agent-recap-label">Activity recap</span>
          <strong>{summary}</strong>
        </span>
        <ChevronDown size={14} aria-hidden="true" />
      </summary>
      <div className="agent-recap-details">
        {items.map((event) => (
          <div className={`agent-recap-item ${event.phase ?? "complete"}`} key={event.id} title={event.message}>
            <span className="agent-recap-status">{activityPhaseLabel(event.phase)}</span>
            <span className="agent-recap-copy">
              <strong>{event.message}</strong>
            </span>
          </div>
        ))}
      </div>
    </details>
  );
}

export function normalizeAgentActivityEvent(event: Omit<AgentActivityEvent, "id">): Omit<AgentActivityEvent, "id"> | null {
  const message = activityMessageLabel(event).trim();
  if (!message) return null;
  const detail = event.detail?.trim();
  return {
    ...event,
    message,
    detail: detail || undefined,
  };
}

function activityMessageLabel(event: Omit<AgentActivityEvent, "id">): string {
  return event.message.trim();
}

export function shouldKeepActivityRecap(event: AgentActivityEvent): boolean {
  return Boolean(event.toolName || event.detail);
}

export function activityRecapKey(event: AgentActivityEvent): string {
  if (event.toolCallId) return `call:${event.toolCallId}`;
  if (event.toolName) return ["tool", event.toolName, event.detail ?? event.message].join("\u0000");
  return ["event", event.message, event.detail ?? ""].join("\u0000");
}

function recapActivityEvents(events: AgentActivityEvent[]): AgentActivityEvent[] {
  const latestByAction = new Map<string, AgentActivityEvent>();
  for (const event of events) {
    if (!shouldKeepActivityRecap(event)) continue;
    latestByAction.set(activityRecapKey(event), event);
  }
  return [...latestByAction.values()];
}

function activityRecapSummary(events: AgentActivityEvent[]): string {
  const count = events.length;
  const errorCount = events.filter((event) => event.phase === "error").length;
  if (errorCount) return `${count} ${count === 1 ? "tool action" : "tool actions"} run, ${errorCount} Learned From`;
  return `${count} ${count === 1 ? "tool action" : "tool actions"} completed`;
}

function activityPhaseLabel(phase?: AgentActivityPhase): string {
  if (phase === "error") return "Learned From";
  if (phase === "running" || phase === "streaming") return "Running";
  if (phase === "queued") return "Queued";
  return "Done";
}

function activityPhaseIcon(phase?: AgentActivityPhase): ReactNode {
  if (phase === "error") return <AlertTriangle size={13} />;
  if (phase === "complete") return <CircleCheck size={13} />;
  if (phase === "queued") return <Circle size={13} />;
  return <Loader2 className="spin" size={13} />;
}
