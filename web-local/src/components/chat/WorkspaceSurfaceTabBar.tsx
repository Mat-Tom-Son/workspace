import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent } from "react";
import { ChevronDown, X } from "lucide-react";

import { chatDisplayTitle } from "../../lib/format";
import { workspaceIdentityFor, workspaceIdentityStyle } from "../../lib/workspace-identity";
import { surfacePanelDomId, surfaceTabDomId } from "../../lib/workspace-ui";
import type { ConversationSummary, WorkspaceCustomizationMap, WorkspaceSummary, WorkspaceSurfaceTab } from "../../types";
import { FluentGlyph, NewChatIcon, WorkspaceIconGlyph } from "../chrome/common";

export function WorkspaceSurfaceTabBar({
  tabs,
  workspaces,
  workspaceCustomizations,
  activeTabId,
  newChatWorkspaceId,
  newChatWorkspaceName,
  onActivate,
  onClose,
  onNewChat,
  onNewChatInWorkspace,
  onRenameChat,
}: {
  tabs: WorkspaceSurfaceTab[];
  workspaces: WorkspaceSummary[];
  workspaceCustomizations: WorkspaceCustomizationMap;
  activeTabId: string | null;
  newChatWorkspaceId: string;
  newChatWorkspaceName: string;
  onActivate: (tabId: string) => void;
  onClose: (tabId: string) => void;
  onNewChat: () => void;
  onNewChatInWorkspace: (workspace: WorkspaceSummary) => void;
  onRenameChat: (workspace: WorkspaceSummary, conversation: ConversationSummary, event: ReactMouseEvent) => void;
}) {
  const [workspaceMenuOpen, setWorkspaceMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const menuButtonRef = useRef<HTMLButtonElement | null>(null);
  const otherWorkspaces = workspaces.filter((item) => item.id !== newChatWorkspaceId);

  useEffect(() => {
    if (!workspaceMenuOpen) return;
    window.requestAnimationFrame(() => menuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus());

    function handlePointerDown(event: PointerEvent): void {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (menuRef.current?.contains(target) || menuButtonRef.current?.contains(target)) return;
      setWorkspaceMenuOpen(false);
    }

    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setWorkspaceMenuOpen(false);
      window.requestAnimationFrame(() => menuButtonRef.current?.focus());
    }

    document.addEventListener("pointerdown", handlePointerDown, true);
    document.addEventListener("keydown", handleKeyDown, true);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
      document.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [workspaceMenuOpen]);

  function handleTabListKeyDown(event: ReactKeyboardEvent<HTMLDivElement>): void {
    if (!tabs.length) return;
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;

    const activeIndex = tabs.findIndex((tab) => tab.id === activeTabId);
    const currentIndex = activeIndex >= 0 ? activeIndex : 0;
    const lastIndex = tabs.length - 1;
    let nextIndex = currentIndex;

    if (event.key === "Home") nextIndex = 0;
    else if (event.key === "End") nextIndex = lastIndex;
    else if (event.key === "ArrowRight") nextIndex = activeIndex >= 0 ? (currentIndex + 1) % tabs.length : 0;
    else if (event.key === "ArrowLeft") nextIndex = activeIndex >= 0 ? (currentIndex - 1 + tabs.length) % tabs.length : lastIndex;

    const nextTab = tabs[nextIndex];
    if (!nextTab) return;
    event.preventDefault();
    onActivate(nextTab.id);
    window.requestAnimationFrame(() => document.getElementById(surfaceTabDomId(nextTab.id))?.focus());
  }

  function workspaceMenuItems(): HTMLButtonElement[] {
    return Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? []);
  }

  function focusWorkspaceMenuItem(offset: number): void {
    const items = workspaceMenuItems();
    if (!items.length) return;
    const activeIndex = Math.max(0, items.findIndex((item) => item === document.activeElement));
    items[(activeIndex + offset + items.length) % items.length]?.focus();
  }

  function handleWorkspaceMenuKeyDown(event: ReactKeyboardEvent<HTMLDivElement>): void {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      focusWorkspaceMenuItem(1);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      focusWorkspaceMenuItem(-1);
      return;
    }
    if (event.key === "Home") {
      event.preventDefault();
      workspaceMenuItems()[0]?.focus();
      return;
    }
    if (event.key === "End") {
      event.preventDefault();
      const items = workspaceMenuItems();
      items[items.length - 1]?.focus();
    }
  }

  function handleWorkspaceMenuSelect(targetWorkspace: WorkspaceSummary): void {
    setWorkspaceMenuOpen(false);
    onNewChatInWorkspace(targetWorkspace);
  }

  return (
    <div className={tabs.length ? "surface-tabbar" : "surface-tabbar empty"}>
      <div className="surface-tabs" role="tablist" aria-label="Open tabs" onKeyDown={handleTabListKeyDown}>
        {tabs.map((tab) => {
          const tabWorkspace = workspaces.find((item) => item.id === tab.workspaceId);
          const workspaceName = tabWorkspace?.name ?? "Space";
          const resolvedWorkspace = tabWorkspace ?? fallbackWorkspaceSummary(tab.workspaceId, workspaceName);
          const identity = workspaceIdentityFor(resolvedWorkspace, workspaceCustomizations);
          const Icon = identity.Icon;
          const style = workspaceIdentityStyle(identity);
          return (
            <span
              className={tab.id === activeTabId ? "surface-tab active" : "surface-tab"}
              key={tab.id}
              style={style}
              title={`${tab.title} - ${workspaceName}`}
              onContextMenu={(event) => {
                if (!tab.conversationId) return;
                onRenameChat(resolvedWorkspace, {
                  id: tab.conversationId,
                  title: chatDisplayTitle({ serverTitle: tab.title }),
                  updatedAt: new Date().toISOString(),
                }, event);
              }}
              onAuxClick={(event) => {
                if (event.button !== 1) return;
                event.preventDefault();
                onClose(tab.id);
              }}
            >
              <button
                id={surfaceTabDomId(tab.id)}
                className="surface-tab-main"
                type="button"
                role="tab"
                aria-selected={tab.id === activeTabId}
                aria-controls={surfacePanelDomId(tab.id)}
                aria-label={`${tab.title} in ${workspaceName}`}
                tabIndex={tab.id === activeTabId ? 0 : -1}
                onClick={() => onActivate(tab.id)}
              >
                <span className="surface-tab-icon" aria-hidden="true"><WorkspaceIconGlyph icon={Icon} size={15} /></span>
                <span className="surface-tab-copy">
                  <span className="surface-tab-title">{tab.title}</span>
                </span>
              </button>
              <button
                className="surface-tab-close"
                type="button"
                onClick={() => onClose(tab.id)}
                aria-label={`Close ${tab.title}`}
                title="Close tab"
              >
                <X size={14} />
              </button>
            </span>
          );
        })}
      </div>
      <div className="surface-tab-actions">
        <button className="surface-tab-action" type="button" onClick={onNewChat} aria-label={`New chat in ${newChatWorkspaceName}`} title={`New chat in ${newChatWorkspaceName}`}>
          <FluentGlyph icon={NewChatIcon} size={18} />
        </button>
        {otherWorkspaces.length ? (
          <div className="surface-tab-workspace-menu-anchor">
            <button
              ref={menuButtonRef}
              className="surface-tab-action surface-tab-action-caret"
              type="button"
              onClick={() => setWorkspaceMenuOpen((current) => !current)}
              aria-label="New chat in another Space"
              aria-haspopup="menu"
              aria-expanded={workspaceMenuOpen}
              title="New chat in another Space"
            >
              <ChevronDown size={14} />
            </button>
            {workspaceMenuOpen ? (
              <div
                ref={menuRef}
                className="surface-tab-workspace-menu"
                role="menu"
                onClick={(event) => event.stopPropagation()}
                onContextMenu={(event) => event.preventDefault()}
                onKeyDown={handleWorkspaceMenuKeyDown}
              >
                {otherWorkspaces.map((item) => {
                  const identity = workspaceIdentityFor(item, workspaceCustomizations);
                  const Icon = identity.Icon;
                  return (
                    <button
                      type="button"
                      role="menuitem"
                      tabIndex={-1}
                      key={item.id}
                      style={workspaceIdentityStyle(identity)}
                      onClick={() => handleWorkspaceMenuSelect(item)}
                      title={item.name}
                    >
                      <span className="workspace-identity-icon"><WorkspaceIconGlyph icon={Icon} size={14} /></span>
                      <span>{item.name}</span>
                    </button>
                  );
                })}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function fallbackWorkspaceSummary(id: string, name: string): WorkspaceSummary {
  return {
    id,
    name,
    rootPath: "",
    location: { kind: "local", storage: "linked" },
    createdAt: "",
    updatedAt: "",
  };
}
