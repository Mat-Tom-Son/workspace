export type WorkspacePane = "files" | "chats" | "skills" | "extensions" | "resources" | "history";

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

export interface TreeEntry {
  name: string;
  path: string;
  kind: "file" | "folder";
  sizeBytes?: number;
  updatedAt?: string;
  children?: TreeEntry[];
}

export interface ConversationSummary {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  createdAt: string;
  kind?: "conversation_title";
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

export interface AgentPackage {
  source: string;
  scope: "global" | "project";
  enabled: boolean;
}

export interface AgentTool {
  name: string;
  description: string;
  source: string;
  active: boolean;
}

export interface AgentDiagnostic {
  type: "info" | "warning" | "error";
  message: string;
  path?: string;
}

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

export interface LocalEventStream {
  onmessage: ((event: { data: string }) => void) | null;
  onopen: (() => void) | null;
  onerror: ((error: unknown) => void) | null;
  close: () => void;
}

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
  type: "status" | "assistant_delta" | "assistant_message" | "tool" | "error" | "done" | "extension_ui_request" | "editor";
  conversationId: string;
  message?: string;
  text?: string;
  toolName?: string;
  phase?: string;
  detail?: string;
  request?: ExtensionUiRequest;
  editorMode?: "replace" | "append";
}

export interface BootstrapResponse {
  workspaces: WorkspaceSummary[];
  agent: AgentStatus;
}
