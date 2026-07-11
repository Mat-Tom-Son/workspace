import { useEffect, useMemo, useRef, useState, type ChangeEvent, type CSSProperties, type FormEvent, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import {
  ArrowClockwise20Regular,
  BookToolbox20Filled,
  BookToolbox20Regular,
  ChatMultiple20Filled,
  ChatMultiple20Regular,
  Checkmark20Regular,
  ChevronRight20Regular,
  Dismiss20Regular,
  DocumentFolder20Filled,
  DocumentFolder20Regular,
  Folder20Filled,
  History20Filled,
  History20Regular,
  ImageAdd20Regular,
  Keyboard20Regular,
  Library20Filled,
  Library20Regular,
  PlugConnected20Filled,
  PlugConnected20Regular,
  Search20Regular,
  Settings20Filled,
  Settings20Regular,
} from "@fluentui/react-icons";
import { filterWorkspaceIconOptions, workspaceIconOptions } from "../../workspace-icons";
import { workspaceBannerOptions } from "../../constants";
import { errorText } from "../../lib/api";
import { normalizeWorkspaceColor, processWorkspaceBannerImageFile, workspaceColorOptions, workspaceIdentityStyle, type WorkspaceIdentity } from "../../lib/workspace-identity";
import type { WorkspaceCustomizationPatch, WorkspaceRailMode, WorkspaceSummary } from "../../types";
import { WorkspaceIconGlyph } from "../chrome/common";

function WorkspaceModeRail({
  activeMode,
  workspace,
  workspaceIdentity: _workspaceIdentity,
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
  const FilesIcon = activeMode === "files" ? DocumentFolder20Filled : DocumentFolder20Regular;
  const ChatsIcon = activeMode === "chats" ? ChatMultiple20Filled : ChatMultiple20Regular;
  const LibraryIcon = activeMode === "library" ? Library20Filled : Library20Regular;
  const HistoryIcon = activeMode === "history" ? History20Filled : History20Regular;
  const workspaceLabel = workspace.name.trim() || "Space";
  const primaryItems: Array<{ mode: WorkspaceRailMode; label: string; ariaLabel: string; title: string; icon: ReactNode }> = [
    { mode: "files", label: "Files", ariaLabel: "Files", title: "Files in this Space", icon: <FilesIcon className="fluent-rail-icon" /> },
    { mode: "chats", label: "Chats", ariaLabel: "Chats", title: "Chats", icon: <ChatsIcon className="fluent-rail-icon" /> },
    { mode: "library", label: "Library", ariaLabel: "Library", title: "Reusable files for any Space", icon: <LibraryIcon className="fluent-rail-icon" /> },
    { mode: "history", label: "History", ariaLabel: "History", title: "Restore points and recent activity", icon: <HistoryIcon className="fluent-rail-icon" /> },
  ];
  const assistantItems = [
    { mode: "setup" as const, label: "Setup", RegularIcon: Settings20Regular, FilledIcon: Settings20Filled },
    { mode: "skills" as const, label: "Skills", RegularIcon: BookToolbox20Regular, FilledIcon: BookToolbox20Filled },
    { mode: "extensions" as const, label: "Extensions", RegularIcon: PlugConnected20Regular, FilledIcon: PlugConnected20Filled },
  ];
  return (
    <nav className="workspace-mode-rail professional-workspace-rail" aria-label="Workspace navigation">
      <div className="workspace-rail-nav">
        <button
          className={["workspace-rail-button", "workspace-rail-workspace", "workspace-rail-space-selector", activeMode === "workspaces" ? "active" : ""].filter(Boolean).join(" ")}
          type="button"
          onClick={() => onModeChange("workspaces")}
          aria-label={`Select or manage Space: ${workspaceLabel}`}
          aria-current={activeMode === "workspaces" ? "page" : undefined}
          title={`Select or manage Space: ${workspaceLabel}`}
        >
          <span className="workspace-rail-icon workspace-rail-space-avatar" aria-hidden="true"><Folder20Filled /></span>
          <span className="workspace-rail-space-copy"><span>Space</span><strong>{workspaceLabel}</strong></span>
          <ChevronRight20Regular className="workspace-rail-space-caret" aria-hidden="true" />
        </button>
        {primaryItems.map((item) => (
          <button
            className={[
              "workspace-rail-button",
              activeMode === item.mode ? "active" : "",
            ].filter(Boolean).join(" ")}
            type="button"
            key={item.mode}
            onClick={() => onModeChange(item.mode)}
            aria-label={item.ariaLabel}
            title={item.title}
          >
            <span className="workspace-rail-icon" aria-hidden="true">{item.icon}</span>
            <span className="workspace-rail-label">{item.label}</span>
          </button>
        ))}
        <div className="workspace-rail-group" role="group" aria-label="Assistant">
          <span className="workspace-rail-group-label"><span>Assistant</span></span>
          {assistantItems.map((item) => {
            const active = activeMode === item.mode;
            const Icon = active ? item.FilledIcon : item.RegularIcon;
            return <button className={["workspace-rail-button", "workspace-rail-assistant", active ? "active" : ""].filter(Boolean).join(" ")} type="button" key={item.mode} onClick={() => onModeChange(item.mode)} aria-label={`Assistant ${item.label}`} title={`Assistant · ${item.label}`}><span className="workspace-rail-icon" aria-hidden="true"><Icon /></span><span className="workspace-rail-label">{item.label}</span></button>;
          })}
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
            <Keyboard20Regular aria-hidden="true" />
            <span>Shortcuts</span>
          </button>
        </div>
        <div className="workspace-rail-settings-control">
          {accountControl}
          <Settings20Regular className="workspace-rail-settings-icon" aria-hidden="true" />
          <span className="workspace-rail-settings-label" aria-hidden="true">Settings</span>
        </div>
      </div>
    </nav>
  );
}

function WorkspacePaneHeader({
  title,
  detail,
  action,
}: {
  title: string;
  detail?: string;
  action?: ReactNode;
}) {
  const headerClassName = [
    "workspace-pane-current",
    "workspace-pane-header",
    "professional-pane-header",
    action ? "has-action" : "",
  ].filter(Boolean).join(" ");

  return (
    <div className="workspace-pane-header-wrap">
      <div className={headerClassName}>
        <span className="workspace-pane-page-copy">
          <strong className="workspace-pane-page-title">{title}</strong>
          {detail ? <span className="workspace-pane-page-detail">{detail}</span> : null}
        </span>
        {action ? <span className="workspace-pane-header-action professional-header-action">{action}</span> : null}
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
          {saving ? <ArrowClockwise20Regular className="spin" /> : <Checkmark20Regular />}
        </button>
        <button className="workspace-rename-action" type="button" disabled={saving} onClick={onClose} aria-label="Cancel rename" title="Cancel">
          <Dismiss20Regular />
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
                {identity.color === option.color ? <Checkmark20Regular /> : null}
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
                <Dismiss20Regular />
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
                {bannerUploadBusy ? <ArrowClockwise20Regular className="spin" /> : <ImageAdd20Regular />}
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
              <Dismiss20Regular />
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
            <Search20Regular aria-hidden="true" />
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

export { WorkspaceAppearancePanel, WorkspaceModeRail, WorkspacePaneHeader, WorkspaceRenameEditor };
