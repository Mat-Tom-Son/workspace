import { useEffect, useMemo, useRef, useState, type ChangeEvent, type CSSProperties, type FormEvent, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { DocumentFolder20Filled, DocumentFolder20Regular } from "@fluentui/react-icons";
import { Bot, Check, ChevronDown, History, ImagePlus, Keyboard, LibraryBig, Loader2, MessageSquare, Plug, Search, Settings2, Sparkles, X } from "lucide-react";
import { filterWorkspaceIconOptions, workspaceIconOptions } from "../../workspace-icons";
import { workspaceBannerOptions } from "../../constants";
import { errorText } from "../../lib/api";
import { normalizeWorkspaceColor, processWorkspaceBannerImageFile, workspaceColorOptions, workspaceIdentityFor, workspaceIdentityStyle, type WorkspaceIdentity } from "../../lib/workspace-identity";
import { surfaceDomIdSuffix, workspaceHeaderSourceBadgeLabel } from "../../lib/workspace-ui";
import type { WorkspaceCustomizationMap, WorkspaceCustomizationPatch, WorkspaceRailMode, WorkspaceSummary } from "../../types";
import { WorkspaceIconGlyph } from "../chrome/common";

function WorkspaceModeRail({
  activeMode,
  workspace,
  workspaceIdentity,
  onModeChange,
  accountControl,
  onOpenKeyboardShortcuts,
  updateControl,
}: {
  activeMode: WorkspaceRailMode;
  workspace: WorkspaceSummary;
  workspaceIdentity: WorkspaceIdentity;
  onModeChange: (mode: WorkspaceRailMode) => void;
  accountControl: ReactNode;
  onOpenKeyboardShortcuts: () => void;
  updateControl?: ReactNode;
}) {
  const WorkspaceIcon = workspaceIdentity.Icon;
  const FilesIcon = activeMode === "space" ? DocumentFolder20Filled : DocumentFolder20Regular;
  const workspaceLabel = workspace.name.trim() || "Space";
  const items: Array<{ mode: WorkspaceRailMode; label: string; ariaLabel: string; title: string; icon: ReactNode; className?: string; showLabel?: boolean }> = [
    {
      mode: "workspaces",
      label: workspaceLabel,
      ariaLabel: `Space: ${workspaceLabel}`,
      title: `Space: ${workspaceLabel}`,
      icon: <WorkspaceIconGlyph icon={WorkspaceIcon} size={20} className="workspace-rail-custom-icon" />,
      className: "workspace-rail-workspace",
      showLabel: false,
    },
    { mode: "space", label: "Space", ariaLabel: "Space", title: "Files in this Space", icon: <FilesIcon className="fluent-rail-icon" /> },
    { mode: "chats", label: "Chats", ariaLabel: "Chats", title: "Chats", icon: <MessageSquare size={20} /> },
    { mode: "library", label: "Library", ariaLabel: "Library", title: "Reusable files for any Space", icon: <LibraryBig size={20} /> },
    { mode: "history", label: "History", ariaLabel: "History", title: "Restore points and recent activity", icon: <History size={20} /> },
  ];
  return (
    <nav className="workspace-mode-rail" aria-label="Workspace sections">
      <div className="workspace-rail-nav">
        {items.map((item) => (
          <button
            className={[
              "workspace-rail-button",
              item.className ?? "",
              activeMode === item.mode ? "active" : "",
            ].filter(Boolean).join(" ")}
            type="button"
            key={item.mode}
            onClick={() => onModeChange(item.mode)}
            aria-label={item.ariaLabel}
            title={item.title}
          >
            <span className="workspace-rail-icon" aria-hidden="true">{item.icon}</span>
            {item.showLabel === false ? null : <span className="workspace-rail-label">{item.label}</span>}
          </button>
        ))}
        <div className="workspace-rail-group" role="group" aria-label="Assistant">
          <span className="workspace-rail-group-label"><Bot size={15} /><span>Assistant</span></span>
          {([
            { mode: "setup" as const, label: "Setup", icon: <Settings2 size={18} /> },
            { mode: "skills" as const, label: "Skills", icon: <Sparkles size={18} /> },
            { mode: "extensions" as const, label: "Extensions", icon: <Plug size={18} /> },
          ]).map((item) => <button className={["workspace-rail-button", "workspace-rail-assistant", activeMode === item.mode ? "active" : ""].filter(Boolean).join(" ")} type="button" key={item.mode} onClick={() => onModeChange(item.mode)} aria-label={`Assistant ${item.label}`} title={`Assistant · ${item.label}`}><span className="workspace-rail-icon" aria-hidden="true">{item.icon}</span><span className="workspace-rail-label">{item.label}</span></button>)}
        </div>
      </div>
      <div className="workspace-rail-account">
        <div className="workspace-rail-tools">
          {updateControl ? <div className="workspace-rail-update">{updateControl}</div> : null}
          <button
            className="workspace-rail-quiet-button"
            type="button"
            onClick={onOpenKeyboardShortcuts}
            aria-label="Keyboard shortcuts"
            title="Keyboard shortcuts"
          >
            <Keyboard size={16} aria-hidden="true" />
            <span>Shortcuts</span>
          </button>
        </div>
        {accountControl}
      </div>
    </nav>
  );
}

function WorkspacePaneHeader({
  workspace,
  title,
  detail,
  identity,
  workspaces,
  workspaceCustomizations,
  onSwitchWorkspace,
  action,
}: {
  workspace: WorkspaceSummary;
  title: string;
  detail?: string;
  identity: WorkspaceIdentity;
  workspaces?: WorkspaceSummary[];
  workspaceCustomizations?: WorkspaceCustomizationMap;
  onSwitchWorkspace?: (workspace: WorkspaceSummary) => void;
  action?: ReactNode;
}) {
  const [quickSwitcherOpen, setQuickSwitcherOpen] = useState(false);
  const headerRef = useRef<HTMLDivElement>(null);
  const quickSwitcherEnabled = Boolean(workspaces?.length && workspaceCustomizations && onSwitchWorkspace);
  const switcherId = `workspace-header-switcher-${surfaceDomIdSuffix(workspace.id)}`;
  const headerClassName = [
    "workspace-pane-current",
    "workspace-pane-header",
    "workspace-banner-surface",
    `banner-${identity.bannerName}`,
    workspace.location.providerHint === "google-drive" ? "drive" : "local",
    identity.bannerImage ? "has-banner-image" : "",
    action ? "has-action" : "",
    quickSwitcherEnabled ? "has-switcher" : "",
    quickSwitcherOpen ? "switcher-open" : "",
  ].filter(Boolean).join(" ");

  useEffect(() => {
    if (!quickSwitcherOpen) return;
    function closeOnOutsidePointer(event: PointerEvent) {
      if (headerRef.current?.contains(event.target as Node)) return;
      setQuickSwitcherOpen(false);
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setQuickSwitcherOpen(false);
    }
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [quickSwitcherOpen]);

  function toggleQuickSwitcher() {
    if (!quickSwitcherEnabled) return;
    setQuickSwitcherOpen((current) => !current);
  }

  function handleHeaderKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (!quickSwitcherEnabled || event.currentTarget !== event.target) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      toggleQuickSwitcher();
    }
  }

  return (
    <div className="workspace-pane-header-wrap" ref={headerRef}>
      <div
        className={headerClassName}
        style={workspaceIdentityStyle(identity)}
        role={quickSwitcherEnabled ? "button" : undefined}
        tabIndex={quickSwitcherEnabled ? 0 : undefined}
        aria-haspopup={quickSwitcherEnabled ? "dialog" : undefined}
        aria-expanded={quickSwitcherEnabled ? quickSwitcherOpen : undefined}
        aria-controls={quickSwitcherEnabled ? switcherId : undefined}
        onClick={toggleQuickSwitcher}
        onKeyDown={handleHeaderKeyDown}
        title={quickSwitcherEnabled ? "Switch Space" : undefined}
      >
        {identity.bannerImage ? (
          <span className="workspace-pane-banner-image" aria-hidden="true">
            <img src={identity.bannerImage} alt="" draggable={false} />
            <span className="workspace-pane-banner-scrim" />
          </span>
        ) : null}
        <span className="workspace-pane-current-copy">
          <span className="workspace-pane-current-lockup">
            <span className="workspace-pane-current-icon" aria-hidden="true">
              <WorkspaceIconGlyph icon={identity.Icon} size={20} />
            </span>
            <strong>{title}</strong>
          </span>
          {detail ? <span className="sr-only">{detail}</span> : null}
        </span>
        {quickSwitcherEnabled ? (
          <span className="workspace-pane-switch-caret" aria-hidden="true">
            <ChevronDown size={18} />
          </span>
        ) : null}
        {action ? (
          <span
            className="workspace-pane-header-action"
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => event.stopPropagation()}
          >
            {action}
          </span>
        ) : null}
      </div>
      {quickSwitcherEnabled && quickSwitcherOpen && workspaces && workspaceCustomizations && onSwitchWorkspace ? (
        <WorkspaceHeaderSwitcher
          id={switcherId}
          currentWorkspace={workspace}
          workspaces={workspaces}
          workspaceCustomizations={workspaceCustomizations}
          onSwitchWorkspace={onSwitchWorkspace}
          onClose={() => setQuickSwitcherOpen(false)}
        />
      ) : null}
    </div>
  );
}

function WorkspaceHeaderSwitcher({
  id,
  currentWorkspace,
  workspaces,
  workspaceCustomizations,
  onSwitchWorkspace,
  onClose,
}: {
  id: string;
  currentWorkspace: WorkspaceSummary;
  workspaces: WorkspaceSummary[];
  workspaceCustomizations: WorkspaceCustomizationMap;
  onSwitchWorkspace: (workspace: WorkspaceSummary) => void;
  onClose: () => void;
}) {
  return (
    <div className="workspace-header-switcher" id={id} role="dialog" aria-label="Switch Space">
      <div className="workspace-header-switcher-list">
        {workspaces.map((item) => {
          const active = item.id === currentWorkspace.id;
          const identity = workspaceIdentityFor(item, workspaceCustomizations);
          const Icon = identity.Icon;
          return (
            <button
              className={active ? "workspace-header-switcher-row active" : "workspace-header-switcher-row"}
              type="button"
              key={item.id}
              disabled={active}
              aria-current={active ? "page" : undefined}
              style={workspaceIdentityStyle(identity)}
              onClick={() => {
                onClose();
                onSwitchWorkspace(item);
              }}
            >
              <span className="workspace-header-switcher-icon" aria-hidden="true">
                <WorkspaceIconGlyph icon={Icon} size={17} />
              </span>
              <span className="workspace-header-switcher-copy">
                <strong>{item.name}</strong>
              </span>
              <span className="workspace-header-switcher-badge">{workspaceHeaderSourceBadgeLabel(item)}</span>
              {active ? <Check className="workspace-header-switcher-check" size={15} aria-hidden="true" /> : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function WorkspaceRenameEditor({
  open,
  workspace,
  onRenameWorkspace,
  onClose,
}: {
  open: boolean;
  workspace: WorkspaceSummary;
  onRenameWorkspace: (workspace: WorkspaceSummary, name: string) => Promise<void>;
  onClose: () => void;
}) {
  const [name, setName] = useState(workspace.name);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setName(workspace.name);
    setSaving(false);
    setError(null);
    const frame = window.requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [open, workspace.id, workspace.name]);

  if (!open) return null;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextName = name.trim();
    if (!nextName) {
      setError("Enter a Space name.");
      return;
    }
    if (nextName === workspace.name) {
      onClose();
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onRenameWorkspace(workspace, nextName);
      onClose();
    } catch (renameError) {
      setError(errorText(renameError));
      setSaving(false);
    }
  }

  function handleKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Escape" || saving) return;
    event.preventDefault();
    onClose();
  }

  return (
    <div className="workspace-rename-panel">
      <form className="workspace-rename-form" onSubmit={(event) => void handleSubmit(event)}>
        <input
          ref={inputRef}
          value={name}
          maxLength={80}
          autoComplete="off"
          disabled={saving}
          onChange={(event) => {
            setName(event.currentTarget.value);
            if (error) setError(null);
          }}
          onKeyDown={handleKeyDown}
          aria-label={`Space name for ${workspace.name}`}
        />
        <button className="workspace-rename-action save" type="submit" disabled={saving || !name.trim()} aria-label="Save Space name" title="Save">
          {saving ? <Loader2 className="spin" size={14} /> : <Check size={14} />}
        </button>
        <button className="workspace-rename-action" type="button" disabled={saving} onClick={onClose} aria-label="Cancel rename" title="Cancel">
          <X size={14} />
        </button>
      </form>
      {error ? <span className="workspace-rename-error">{error}</span> : null}
    </div>
  );
}

function WorkspaceAppearancePanel({
  workspaceId,
  identity,
  onCustomizeWorkspace,
}: {
  workspaceId: string;
  identity: WorkspaceIdentity;
  onCustomizeWorkspace: (workspaceId: string, patch: WorkspaceCustomizationPatch) => void;
}) {
  const [iconSearchQuery, setIconSearchQuery] = useState("");
  const [bannerUploadBusy, setBannerUploadBusy] = useState(false);
  const [bannerUploadError, setBannerUploadError] = useState<string | null>(null);
  const bannerFileInputRef = useRef<HTMLInputElement>(null);
  const filteredWorkspaceIconOptions = useMemo(() => filterWorkspaceIconOptions(iconSearchQuery), [iconSearchQuery]);

  useEffect(() => {
    setIconSearchQuery("");
    setBannerUploadBusy(false);
    setBannerUploadError(null);
  }, [workspaceId]);

  async function handleBannerFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file || bannerUploadBusy) return;
    setBannerUploadBusy(true);
    setBannerUploadError(null);
    try {
      const bannerImage = await processWorkspaceBannerImageFile(file);
      onCustomizeWorkspace(workspaceId, { bannerImage });
    } catch (uploadError) {
      setBannerUploadError(errorText(uploadError));
    } finally {
      setBannerUploadBusy(false);
    }
  }

  return (
    <div className="workspace-appearance-inner">
      <div className="workspace-appearance-row colors">
        <span className="workspace-appearance-label">Color</span>
        <div className="workspace-color-controls">
          <div className="workspace-color-swatches" role="group" aria-label="Space color presets">
            {workspaceColorOptions.map((option) => (
              <button
                className={identity.color === option.color ? "workspace-color-swatch active" : "workspace-color-swatch"}
                key={option.label}
                type="button"
                style={{ "--swatch-color": option.color, "--swatch-soft": option.soft } as CSSProperties}
                onClick={() => onCustomizeWorkspace(workspaceId, { color: option.color })}
                aria-label={`Use ${option.label} color`}
                aria-pressed={identity.color === option.color}
                title={option.label}
              >
                {identity.color === option.color ? <Check size={12} /> : null}
              </button>
            ))}
          </div>
          <div className="workspace-color-wheels">
            <label className="workspace-color-picker" style={workspaceIdentityStyle(identity)}>
              <span className="workspace-color-wheel" aria-hidden="true">
                <span className="workspace-color-wheel-current" />
              </span>
              <input
                type="color"
                value={identity.color}
                onChange={(event) => onCustomizeWorkspace(workspaceId, { color: normalizeWorkspaceColor(event.currentTarget.value) })}
                aria-label="Choose Space color"
              />
              <span className="workspace-color-value">{identity.color.toUpperCase()}</span>
            </label>
            <label
              className={identity.hasCustomSecondary ? "workspace-color-picker secondary" : "workspace-color-picker secondary matched"}
              style={{ ...workspaceIdentityStyle(identity), "--workspace-custom-color": identity.secondaryColor } as CSSProperties}
              title="Second banner color"
            >
              <span className="workspace-color-wheel" aria-hidden="true">
                <span className="workspace-color-wheel-current" />
              </span>
              <input
                type="color"
                value={identity.secondaryColor}
                onChange={(event) => onCustomizeWorkspace(workspaceId, { color2: normalizeWorkspaceColor(event.currentTarget.value) })}
                aria-label="Choose second banner color"
              />
              <span className="workspace-color-value">{identity.hasCustomSecondary ? identity.secondaryColor.toUpperCase() : "+ Pair"}</span>
            </label>
            {identity.hasCustomSecondary ? (
              <button
                className="workspace-color-pair-clear"
                type="button"
                onClick={() => onCustomizeWorkspace(workspaceId, { color2: undefined })}
                aria-label="Remove second banner color"
                title="Match primary color"
              >
                <X size={12} />
              </button>
            ) : null}
          </div>
        </div>
      </div>
      <div className="workspace-appearance-row banners">
        <span className="workspace-appearance-label">Banner</span>
        <div className="workspace-banner-picker" style={workspaceIdentityStyle(identity)}>
          <div className="workspace-banner-gallery" role="group" aria-label="Space banner styles">
            {workspaceBannerOptions.map((option) => {
              const active = !identity.bannerImage && identity.bannerName === option.name;
              return (
                <button
                  className={[
                    "workspace-banner-swatch",
                    "workspace-banner-surface",
                    `banner-${option.name}`,
                    active ? "active" : "",
                  ].filter(Boolean).join(" ")}
                  key={option.name}
                  type="button"
                  onClick={() => onCustomizeWorkspace(workspaceId, { bannerName: option.name, bannerImage: undefined })}
                  aria-label={`Use ${option.label} banner`}
                  aria-pressed={active}
                  title={option.label}
                >
                  <span className="workspace-banner-swatch-name">{option.label}</span>
                </button>
              );
            })}
            <button
              className={identity.bannerImage ? "workspace-banner-swatch upload has-image active" : "workspace-banner-swatch upload"}
              type="button"
              onClick={() => bannerFileInputRef.current?.click()}
              disabled={bannerUploadBusy}
              aria-label={identity.bannerImage ? "Replace custom banner image" : "Upload custom banner image"}
              aria-pressed={Boolean(identity.bannerImage)}
              title={identity.bannerImage ? "Replace image" : "Upload image"}
            >
              {identity.bannerImage ? <img src={identity.bannerImage} alt="" draggable={false} /> : null}
              <span className="workspace-banner-swatch-name">
                {bannerUploadBusy ? <Loader2 className="spin" size={13} /> : <ImagePlus size={13} />}
                {identity.bannerImage ? "Replace" : "Upload"}
              </span>
            </button>
          </div>
          <input
            ref={bannerFileInputRef}
            className="workspace-banner-file-input"
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif,image/bmp"
            onChange={(event) => void handleBannerFileChange(event)}
            tabIndex={-1}
            aria-hidden="true"
          />
          {identity.bannerImage ? (
            <button
              className="workspace-banner-remove"
              type="button"
              onClick={() => {
                setBannerUploadError(null);
                onCustomizeWorkspace(workspaceId, { bannerImage: undefined });
              }}
              disabled={bannerUploadBusy}
            >
              <X size={12} />
              Remove custom image
            </button>
          ) : null}
          {bannerUploadError ? <span className="workspace-banner-upload-error">{bannerUploadError}</span> : null}
        </div>
      </div>
      <div className="workspace-appearance-row icons">
        <span className="workspace-appearance-label">Icon</span>
        <div className="workspace-icon-picker">
          <label className="workspace-icon-search">
            <Search size={14} aria-hidden="true" />
            <input
              type="search"
              value={iconSearchQuery}
              onChange={(event) => setIconSearchQuery(event.currentTarget.value)}
              placeholder={`Search ${workspaceIconOptions.length} icons`}
              aria-label="Search Space icons"
            />
          </label>
          <div className="workspace-icon-grid" aria-label="Space icon">
            {filteredWorkspaceIconOptions.map((option) => {
              const Icon = option.Icon;
              return (
                <button
                  className={identity.iconName === option.name ? "workspace-icon-option active" : "workspace-icon-option"}
                  key={option.name}
                  type="button"
                  onClick={() => onCustomizeWorkspace(workspaceId, { iconName: option.name })}
                  aria-label={`Use ${option.label} icon`}
                  title={option.label}
                >
                  <WorkspaceIconGlyph icon={Icon} size={18} filled={identity.iconName === option.name} />
                </button>
              );
            })}
          </div>
          <span className="workspace-icon-result-count">
            {filteredWorkspaceIconOptions.length ? `${filteredWorkspaceIconOptions.length} icons` : "No icons found"}
          </span>
        </div>
      </div>
    </div>
  );
}

export { WorkspaceAppearancePanel, WorkspaceHeaderSwitcher, WorkspaceModeRail, WorkspacePaneHeader, WorkspaceRenameEditor };
