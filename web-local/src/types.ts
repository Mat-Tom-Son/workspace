export type WorkspacePane = "files" | "chats" | "library" | "history" | "setup" | "skills" | "extensions";
export type WorkspaceRailMode = "workspaces" | WorkspacePane;
export type AppTheme = "light" | "dark";
export type AppThemePreference = AppTheme | "system";
export type AppTypographyFont = "default" | "stable" | "verdana" | "aptos";
export type AppTextSize = "compact" | "standard" | "comfortable";

export interface AppTypographyPreference {
  font: AppTypographyFont;
  textSize: AppTextSize;
}

export interface WorkspaceLocation {
  kind: "local";
  storage: "managed" | "linked";
  providerHint?: "google-drive";
}

export interface WorkspaceSummary {
  id: string;
  name: string;
  rootPath: string;
  location: WorkspaceLocation;
  createdAt: string;
  updatedAt: string;
}

export interface WorkspaceCustomization {
  color?: string;
  color2?: string;
  iconName?: string;
  bannerName?: string;
  bannerImage?: string | null;
}

export type WorkspaceCustomizationMap = Record<string, WorkspaceCustomization>;
export type WorkspaceCustomizationPatch = WorkspaceCustomization;
export interface WorkspaceColorOption { label: string; color: string; soft: string; border: string }
export interface WorkspaceBannerOption { name: string; label: string }
export interface WorkspacePaneBounds { min: number; max: number; fallback: number }

export interface TreeEntry {
  name: string;
  path: string;
  kind: "file" | "folder";
  sizeBytes?: number;
  updatedAt?: string;
  hasChildren?: boolean;
  ignored?: boolean;
  descendantIgnoredCount?: number;
  children?: TreeEntry[];
}

export type ChangeKind = "created" | "modified" | "deleted" | "remote_deleted";
export interface ChangeEntry { path: string; kind: ChangeKind }
export type ChangeKindCounts = Record<ChangeKind, number>;

export interface FileContextMenuState {
  entry: TreeEntry;
  x: number;
  y: number;
  returnFocusTarget?: HTMLElement | null;
}

export interface ConversationSummary {
  id: string;
  title: string;
  createdAt?: string;
  updatedAt: string;
}

export interface ChatMessageLanding {
  title?: string;
  summary: string;
  nextActions: string[];
  followUpPrompt: string | null;
  conversationTitle?: string;
  generatedAt: string;
  provider: string;
  model: string;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  createdAt: string;
  kind?: "conversation_title";
  landing?: ChatMessageLanding;
}

export type AgentActivityPhase = "queued" | "running" | "streaming" | "complete" | "error";
export interface AgentActivityEvent {
  id: string;
  message: string;
  detail?: string;
  toolName?: string;
  toolCallId?: string;
  phase?: AgentActivityPhase;
}
export interface AgentActivityLogEntry extends AgentActivityEvent { arrivedAt: string }
export interface RuntimePreviewEntry {
  id: string;
  kind: "thinking" | "tool";
  text: string;
  phase?: "streaming" | "complete";
}
export interface RuntimeThinkingSection { id: string; title: string; text: string; pending?: boolean }

export interface ChatRenameState {
  workspace: WorkspaceSummary;
  conversation: ConversationSummary;
  x: number;
  y: number;
}

export type ContextAttachmentMode = "full_original_text" | "full_extracted_text" | "path_only_reference";
export interface ContextAttachment {
  sourcePath: string;
  sourceFileName: string;
  sourceSizeBytes: number;
  mode: ContextAttachmentMode;
  includedInPrompt: boolean;
  reason: string | null;
  estimatedTokens: number;
  budgetTokens: number;
  provenance: string[];
  warnings: string[];
  userLabel: string;
  detail: string;
}
export interface ChatContextPathRequest { id: number; path: string }
export interface PendingChatSend {
  conversation: ConversationSummary;
  content: string;
  localUserMessage: ChatMessage;
  selectedPath: string | null;
  contextPaths: string[];
  transientConversation: boolean;
  draftStorageKey: string;
}
export interface WorkspaceFixtureConversation extends ConversationSummary {
  messages: ChatMessage[];
  activityEvents?: AgentActivityEvent[];
  runtimePreviews?: RuntimePreviewEntry[];
  running?: boolean;
  streamingAssistant?: string;
  contextAttachments?: ContextAttachment[];
}

export interface WorkspaceSurfaceTab {
  id: string;
  workspaceId: string;
  kind: "chat" | "file" | "history" | "appearance";
  title: string;
  conversationId?: string | null;
  path?: string;
  checkpointId?: string;
}

export interface AgentStatus {
  ready: boolean;
  configured: boolean;
  provider: string | null;
  model: string | null;
  piVersion: string | null;
  projectTrusted?: boolean;
  error: string | null;
}

export interface AgentModel {
  provider: string;
  id: string;
  name: string;
  authConfigured: boolean;
  oauthSupported: boolean;
  contextWindow?: number;
}

export interface AgentSkill {
  name: string;
  description: string;
  path: string;
  source: string;
  enabled: boolean;
  disableModelInvocation?: boolean;
}

export interface AgentExtension {
  id: string;
  name: string;
  path: string;
  source: string;
  enabled: boolean;
  commands: string[];
  tools: string[];
}

export interface AgentPackage { source: string; scope: "global" | "project"; enabled: boolean }
export interface AgentTool { name: string; description: string; source: string; active: boolean }
export interface AgentDiagnostic { type: "info" | "warning" | "error"; message: string; path?: string }
export interface AgentCatalog {
  skills: AgentSkill[];
  extensions: AgentExtension[];
  packages: AgentPackage[];
  tools: AgentTool[];
  diagnostics: AgentDiagnostic[];
  projectTrusted: boolean;
}

export interface WorkspaceCheckpoint {
  checkpointId: string;
  createdAt: string;
  label?: string;
  reason: string;
  fileCount: number;
}

export interface FileVersionEntry {
  path: string;
  hashSha256: string;
  sizeBytes: number;
  modifiedAt: string;
  capturedAt: string;
  checkpointId: string;
  checkpointLabel?: string;
  source?: "checkpoint" | "edit";
}
export interface FileVersionRestoreOutcome {
  restored: boolean;
  path: string;
  hashSha256: string;
  previousHashSha256: string | null;
  safetyCheckpointId: string;
}

export interface LocalEventStream {
  onmessage: ((event: { data: string }) => void) | null;
  onopen: (() => void) | null;
  onerror: ((error: unknown) => void) | null;
  close: () => void;
}

export type WorkspaceFileEvent =
  | { type: "ready"; recursive: boolean }
  | { type: "file_event"; eventType: string; path: string | null }
  | { type: "error"; message: string };

export interface ExtensionUiRequest {
  id: string;
  method: "select" | "confirm" | "input" | "editor" | "notify";
  title?: string;
  message?: string;
  options?: string[];
  placeholder?: string;
  initialValue?: string;
  secret?: boolean;
}

export interface ChatStreamEvent {
  type: "status" | "assistant_delta" | "assistant_message" | "assistant_thinking" | "tool" | "resources_changed" | "error" | "done" | "extension_ui_request" | "editor";
  conversationId: string;
  message?: string;
  text?: string;
  toolName?: string;
  toolCallId?: string;
  phase?: AgentActivityPhase;
  thinkingPhase?: "start" | "delta" | "end";
  detail?: string;
  request?: ExtensionUiRequest;
  editorMode?: "replace" | "append";
}

export interface BootstrapResponse { workspaces: WorkspaceSummary[]; agent: AgentStatus }
export interface DesktopUpdateStatus {
  supported: boolean;
  phase: "unsupported" | "idle" | "checking" | "available" | "not_available" | "downloading" | "ready" | "installing" | "error";
  currentVersion: string;
  availableVersion: string | null;
  progressPercent: number | null;
  checkedAt: string | null;
  message: string;
  error: string | null;
}
export type CommandPaletteGroupId = "go-to" | "switch-workspace" | "chats" | "files" | "actions";
export interface ShortcutRow { keys: string[]; action: string }
export interface ShortcutGroup { title: string; rows: ShortcutRow[] }
