import { useEffect, useRef, useState, type FormEvent } from "react";
import { Check, Loader2 } from "lucide-react";

import { errorText } from "../../lib/api";
import { chatDisplayTitle } from "../../lib/format";
import type { ChatRenameState, ConversationSummary, WorkspaceSummary } from "../../types";

export function ChatRenamePopover({
  state,
  onRename,
  onClose,
}: {
  state: ChatRenameState;
  onRename: (workspace: WorkspaceSummary, conversation: ConversationSummary, title: string) => Promise<void>;
  onClose: () => void;
}) {
  const [title, setTitle] = useState(chatDisplayTitle({ serverTitle: state.conversation.title }));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setTitle(chatDisplayTitle({ serverTitle: state.conversation.title }));
    setError(null);
    window.requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
  }, [state.conversation.id, state.conversation.title]);

  useEffect(() => {
    function handlePointerDown(event: PointerEvent): void {
      const target = event.target;
      if (target instanceof Node && popoverRef.current?.contains(target)) return;
      onClose();
    }

    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape") onClose();
    }

    document.addEventListener("pointerdown", handlePointerDown, true);
    document.addEventListener("keydown", handleKeyDown, true);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
      document.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [onClose]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const nextTitle = title.replace(/\s+/g, " ").trim();
    if (!nextTitle) {
      setError("Enter a chat title.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onRename(state.workspace, state.conversation, nextTitle);
    } catch (renameError) {
      setError(errorText(renameError));
      setSaving(false);
    }
  }

  return (
    <div
      ref={popoverRef}
      className="chat-rename-popover"
      style={{ left: state.x, top: state.y }}
      role="dialog"
      aria-label="Rename chat"
      onClick={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.preventDefault()}
    >
      <form onSubmit={(event) => void handleSubmit(event)}>
        <label>
          <span>Rename chat</span>
          <input
            ref={inputRef}
            value={title}
            maxLength={80}
            onChange={(event) => setTitle(event.target.value)}
            disabled={saving}
          />
        </label>
        <div className="chat-rename-actions">
          <button type="button" disabled={saving} onClick={onClose}>Cancel</button>
          <button className="primary" type="submit" disabled={saving || !title.trim()}>
            {saving ? <Loader2 className="spin" size={14} /> : <Check size={14} />}
            Save
          </button>
        </div>
        {error ? <span className="chat-rename-error">{error}</span> : null}
      </form>
    </div>
  );
}
