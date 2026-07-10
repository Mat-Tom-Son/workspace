import {
  Bot, Box, Check, ChevronDown, ChevronRight, CirclePlus, Clock3, Cloud, Code2, Copy,
  File, FileText, Folder, FolderOpen, History, Loader2, MessageSquare, Package, Paperclip,
  Plug, RefreshCw, Search, Send, Settings2, ShieldCheck, Sparkles, Trash2, Upload, X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { api, apiForm, createEventSource, errorText } from "./lib/api";
import type {
  AgentCatalog, AgentModel, AgentStatus, BootstrapResponse, ChatMessage, ChatStreamEvent,
  ConversationSummary, ExtensionUiRequest, TreeEntry, WorkspaceCheckpoint, WorkspacePane,
  WorkspaceSummary,
} from "./types";

const paneItems: Array<{ id: WorkspacePane; label: string; icon: ReactNode }> = [
  { id: "files", label: "Files", icon: <FolderOpen size={19} /> },
  { id: "chats", label: "Chats", icon: <MessageSquare size={19} /> },
  { id: "skills", label: "Skills", icon: <Sparkles size={19} /> },
  { id: "extensions", label: "Extensions", icon: <Plug size={19} /> },
  { id: "resources", label: "Resources", icon: <Box size={19} /> },
  { id: "history", label: "History", icon: <History size={19} /> },
];

export function App() {
  const [boot, setBoot] = useState<BootstrapResponse | null>(null);
  const [activeWorkspaceId, setActiveWorkspaceId] = useState(() => localStorage.getItem("workspace.active") ?? "");
  const [pane, setPane] = useState<WorkspacePane>("files");
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [setupOpen, setSetupOpen] = useState(false);

  const activeWorkspace = useMemo(() => {
    if (!boot?.workspaces.length) return null;
    return boot.workspaces.find((workspace) => workspace.id === activeWorkspaceId) ?? boot.workspaces[0] ?? null;
  }, [activeWorkspaceId, boot]);

  useEffect(() => {
    void refreshBootstrap();
  }, []);

  useEffect(() => window.workspaceDesktop?.workspace.onOpenFolder?.(() => {
    void openFolder();
  }), []);

  useEffect(() => window.workspaceDesktop?.agent.onOpenSettings?.(() => {
    setSetupOpen(true);
  }), []);

  useEffect(() => {
    if (!activeWorkspace) return;
    localStorage.setItem("workspace.active", activeWorkspace.id);
    setActiveWorkspaceId(activeWorkspace.id);
  }, [activeWorkspace?.id]);

  useEffect(() => {
    if (!activeWorkspace) return;
    let cancelled = false;
    void api<{ status: AgentStatus }>(`/api/agent/status?workspaceId=${encodeURIComponent(activeWorkspace.id)}`)
      .then((result) => {
        if (!cancelled) setBoot((current) => current ? { ...current, agent: result.status } : current);
      })
      .catch((statusError) => { if (!cancelled) setError(errorText(statusError)); });
    return () => { cancelled = true; };
  }, [activeWorkspace?.id]);

  async function refreshBootstrap() {
    try {
      const result = await api<BootstrapResponse>("/api/bootstrap");
      setBoot(result);
      setActiveWorkspaceId((current) => result.workspaces.some((workspace) => workspace.id === current)
        ? current
        : result.workspaces[0]?.id ?? "");
    } catch (loadError) {
      setError(errorText(loadError));
    }
  }

  async function createWorkspace(name: string) {
    setCreating(true);
    setError(null);
    try {
      const result = await api<{ workspace: WorkspaceSummary }>("/api/workspaces", {
        method: "POST",
        body: { name },
      });
      await refreshBootstrap();
      setActiveWorkspaceId(result.workspace.id);
    } catch (createError) {
      setError(errorText(createError));
    } finally {
      setCreating(false);
    }
  }

  async function openFolder() {
    const picker = window.workspaceDesktop?.workspace;
    if (!picker) {
      setError("Folder selection is available in the desktop app.");
      return;
    }
    try {
      const selected = await picker.chooseFolder();
      if (!selected) return;
      const result = await api<{ workspace: WorkspaceSummary }>("/api/workspaces/local-folder", {
        method: "POST",
        body: { rootPath: selected.path, folderGrantId: selected.folderGrantId },
      });
      await refreshBootstrap();
      setActiveWorkspaceId(result.workspace.id);
    } catch (openError) {
      setError(errorText(openError));
    }
  }

  if (!boot) {
    return <Centered icon={<Loader2 className="spin" />} title="Opening Workspace" detail={error ?? "Loading local workspaces and Pi."} />;
  }

  if (!activeWorkspace) {
    return <Welcome creating={creating} error={error} onCreate={createWorkspace} onOpenFolder={openFolder} />;
  }

  return (
    <div className="workspace-app">
      <nav className="mode-rail" aria-label="Workspace sections">
        <button className="brand-button" type="button" title="Workspace"><span>W</span></button>
        <div className="rail-items">
          {paneItems.map((item) => (
            <button className={pane === item.id ? "rail-button active" : "rail-button"} type="button" key={item.id} onClick={() => setPane(item.id)} title={item.label}>
              {item.icon}<small>{item.label}</small>
            </button>
          ))}
        </div>
        <button className="rail-button agent-button" type="button" onClick={() => setSetupOpen(true)} title="Agent settings">
          <Bot size={19} /><span className={boot.agent.configured ? "status-dot ready" : "status-dot"} /><small>Agent</small>
        </button>
      </nav>

      <WorkspaceSurface
        key={activeWorkspace.id}
        pane={pane}
        workspace={activeWorkspace}
        workspaces={boot.workspaces}
        agent={boot.agent}
        onAgentChanged={(agent) => setBoot((current) => current ? { ...current, agent } : current)}
        onSwitchWorkspace={setActiveWorkspaceId}
        onOpenFolder={openFolder}
        onCreateWorkspace={createWorkspace}
        onOpenSetup={() => setSetupOpen(true)}
        onError={setError}
      />

      {error ? <div className="global-error"><span>{error}</span><button type="button" onClick={() => setError(null)}><X size={15} /></button></div> : null}
      {setupOpen ? (
        <AgentSetup
          workspace={activeWorkspace}
          status={boot.agent}
          onClose={() => setSetupOpen(false)}
          onConfigured={(agent) => {
            setBoot((current) => current ? { ...current, agent } : current);
            setSetupOpen(false);
          }}
        />
      ) : null}
    </div>
  );
}

function Welcome({ creating, error, onCreate, onOpenFolder }: {
  creating: boolean;
  error: string | null;
  onCreate: (name: string) => Promise<void>;
  onOpenFolder: () => Promise<void>;
}) {
  const [name, setName] = useState("Personal Workspace");
  return (
    <main className="welcome-page">
      <div className="welcome-card">
        <div className="welcome-mark">W</div>
        <p className="eyebrow">LOCAL-FIRST AI WORKSPACE</p>
        <h1>Welcome to Workspace</h1>
        <p className="welcome-copy">Work with ordinary folders, chat through Pi, and add portable Skills and Extensions when you need them.</p>
        {error ? <div className="inline-error">{error}</div> : null}
        <form onSubmit={(event) => { event.preventDefault(); if (name.trim()) void onCreate(name.trim()); }}>
          <label>New workspace name<input value={name} onChange={(event) => setName(event.target.value)} maxLength={80} /></label>
          <button className="primary-button" type="submit" disabled={creating || !name.trim()}>
            {creating ? <Loader2 className="spin" size={17} /> : <Sparkles size={17} />} Start fresh
          </button>
        </form>
        <button className="secondary-button wide" type="button" onClick={() => void onOpenFolder()}>
          <FolderOpen size={17} /> Open a folder on this PC
        </button>
        <div className="drive-note"><Cloud size={16} /><span>A Google Drive for desktop folder works here like any other local folder.</span></div>
      </div>
    </main>
  );
}

function WorkspaceSurface(props: {
  pane: WorkspacePane;
  workspace: WorkspaceSummary;
  workspaces: WorkspaceSummary[];
  agent: AgentStatus;
  onAgentChanged: (status: AgentStatus) => void;
  onSwitchWorkspace: (id: string) => void;
  onOpenFolder: () => Promise<void>;
  onCreateWorkspace: (name: string) => Promise<void>;
  onOpenSetup: () => void;
  onError: (message: string | null) => void;
}) {
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [chatContextPaths, setChatContextPaths] = useState<string[]>([]);
  useEffect(() => {
    setSelectedPath(null);
    setChatContextPaths([]);
  }, [props.workspace.id]);
  return (
    <main className="main-shell">
      <header className="workspace-header">
        <div className="workspace-switcher">
          <span className="workspace-avatar">{props.workspace.name.slice(0, 1).toUpperCase()}</span>
          <select value={props.workspace.id} onChange={(event) => props.onSwitchWorkspace(event.target.value)} aria-label="Current workspace">
            {props.workspaces.map((workspace) => <option value={workspace.id} key={workspace.id}>{workspace.name}</option>)}
          </select>
          <ChevronDown size={16} />
        </div>
        <span className="location-chip">{props.workspace.location.providerHint === "google-drive" ? <Cloud size={14} /> : <Folder size={14} />}{props.workspace.location.storage === "linked" ? "Linked folder" : "Local workspace"}</span>
        <span className="workspace-path" title={props.workspace.rootPath}>{props.workspace.rootPath}</span>
      </header>

      {props.pane === "files" ? (
        <FilesPane key={props.workspace.id} workspace={props.workspace} selectedPath={selectedPath} onSelectPath={setSelectedPath} onAttach={(path) => setChatContextPaths((current) => unique([...current, path]))} onError={props.onError} />
      ) : null}
      {props.pane === "chats" ? (
        <ChatsPane key={props.workspace.id} workspace={props.workspace} agent={props.agent} contextPaths={chatContextPaths} onContextPathsChange={setChatContextPaths} onOpenSetup={props.onOpenSetup} onError={props.onError} />
      ) : null}
      {props.pane === "skills" || props.pane === "extensions" ? (
        <AgentLibraryPane key={`${props.workspace.id}:${props.pane}`} workspace={props.workspace} mode={props.pane} agent={props.agent} onAgentChanged={props.onAgentChanged} onOpenSetup={props.onOpenSetup} onError={props.onError} />
      ) : null}
      {props.pane === "resources" ? <ResourcesPane key={props.workspace.id} workspace={props.workspace} onError={props.onError} /> : null}
      {props.pane === "history" ? <HistoryPane key={props.workspace.id} workspace={props.workspace} onError={props.onError} /> : null}
    </main>
  );
}

function FilesPane({ workspace, selectedPath, onSelectPath, onAttach, onError }: {
  workspace: WorkspaceSummary;
  selectedPath: string | null;
  onSelectPath: (path: string | null) => void;
  onAttach: (path: string) => void;
  onError: (message: string | null) => void;
}) {
  const [tree, setTree] = useState<TreeEntry[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [fileText, setFileText] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const uploadRef = useRef<HTMLInputElement>(null);

  useEffect(() => { void loadTree(); }, [workspace.id]);
  useEffect(() => {
    setFileText(null);
    setFileError(null);
    if (!selectedPath) return;
    void api<{ text: string }>(`/api/workspaces/${workspace.id}/file?path=${encodeURIComponent(selectedPath)}`)
      .then((result) => setFileText(result.text))
      .catch((readError) => setFileError(errorText(readError)));
  }, [selectedPath, workspace.id]);

  async function loadTree() {
    setLoading(true);
    try {
      const result = await api<{ tree: TreeEntry[] }>(`/api/workspaces/${workspace.id}/tree`);
      setTree(result.tree);
    } catch (treeError) {
      onError(errorText(treeError));
    } finally {
      setLoading(false);
    }
  }

  async function uploadFiles(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (!files.length) return;
    const form = new FormData();
    form.set("targetFolderPath", "");
    form.set("relativePaths", JSON.stringify(files.map((file) => file.webkitRelativePath || file.name)));
    for (const file of files) form.append("files", file, file.name);
    try {
      await apiForm(`/api/workspaces/${workspace.id}/upload-local-files`, form);
      await loadTree();
    } catch (uploadError) {
      onError(errorText(uploadError));
    }
  }

  const visibleTree = query.trim() ? filterTree(tree, query.trim().toLocaleLowerCase()) : tree;
  return (
    <div className="pane-layout">
      <aside className="sidebar-pane">
        <PaneTitle icon={<FolderOpen size={18} />} title="Files" detail="Files in this workspace" />
        <div className="pane-toolbar">
          <label className="search-box"><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search files" /></label>
          <button className="icon-button" type="button" onClick={() => uploadRef.current?.click()} title="Add files"><Upload size={16} /></button>
          <button className="icon-button" type="button" onClick={() => void loadTree()} title="Refresh"><RefreshCw size={16} /></button>
          <input ref={uploadRef} hidden type="file" multiple onChange={(event) => void uploadFiles(event)} />
        </div>
        <div className="tree-scroll">{loading ? <LoadingRow label="Loading files" /> : <FileTree entries={visibleTree} selectedPath={selectedPath} onSelect={onSelectPath} />}</div>
      </aside>
      <section className="content-pane">
        {!selectedPath ? <EmptyState icon={<FileText size={30} />} title="Choose a file" detail="Preview a text file or attach it to your next chat." /> : (
          <>
            <div className="content-header"><div><p className="eyebrow">WORKSPACE FILE</p><h2>{selectedPath.split("/").pop()}</h2><span>{selectedPath}</span></div><button className="secondary-button" type="button" onClick={() => onAttach(selectedPath)}><Paperclip size={16} /> Attach to chat</button></div>
            <div className="file-preview">{fileError ? <div className="inline-error">{fileError}</div> : fileText === null ? <LoadingRow label="Reading file" /> : <pre>{fileText}</pre>}</div>
          </>
        )}
      </section>
    </div>
  );
}

function FileTree({ entries, selectedPath, onSelect, selectFolders = false, level = 0 }: { entries: TreeEntry[]; selectedPath: string | null; onSelect: (path: string) => void; selectFolders?: boolean; level?: number }) {
  const [closed, setClosed] = useState<Set<string>>(() => new Set());
  if (!entries.length && level === 0) return <div className="sidebar-empty">Drop or upload files to get started.</div>;
  return <div className="file-tree">{entries.map((entry) => {
    const collapsed = closed.has(entry.path);
    return <div key={entry.path}>
      <button className={selectedPath === entry.path ? "tree-row selected" : "tree-row"} type="button" style={{ paddingLeft: 12 + level * 16 }} onClick={() => {
        if (entry.kind === "folder") {
          setClosed((current) => toggleSet(current, entry.path));
          if (selectFolders) onSelect(entry.path);
        }
        else onSelect(entry.path);
      }}>
        {entry.kind === "folder" ? (collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />) : <span className="tree-spacer" />}
        {entry.kind === "folder" ? <Folder size={16} /> : <File size={16} />}<span>{entry.name}</span>
      </button>
      {entry.kind === "folder" && !collapsed && entry.children?.length ? <FileTree entries={entry.children} selectedPath={selectedPath} onSelect={onSelect} selectFolders={selectFolders} level={level + 1} /> : null}
    </div>;
  })}</div>;
}

function ChatsPane({ workspace, agent, contextPaths, onContextPathsChange, onOpenSetup, onError }: {
  workspace: WorkspaceSummary;
  agent: AgentStatus;
  contextPaths: string[];
  onContextPathsChange: (paths: string[]) => void;
  onOpenSetup: () => void;
  onError: (message: string | null) => void;
}) {
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [activeId, setActiveId] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [streaming, setStreaming] = useState("");
  const [status, setStatus] = useState("");
  const [sending, setSending] = useState(false);
  const [streamConnected, setStreamConnected] = useState(false);
  const [extensionRequest, setExtensionRequest] = useState<ExtensionUiRequest | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const sendingRef = useRef(false);
  const firstConversationRef = useRef<{ workspaceId: string; promise: Promise<ConversationSummary> } | null>(null);

  useEffect(() => { void loadConversations(); }, [workspace.id]);
  useEffect(() => { if (activeId) void loadMessages(activeId); else setMessages([]); }, [activeId, workspace.id]);
  useEffect(() => {
    setStreamConnected(false);
    if (!activeId) return;
    const stream = createEventSource(`/api/workspaces/${workspace.id}/conversations/${activeId}/events`);
    stream.onmessage = (event) => handleStream(JSON.parse(event.data) as ChatStreamEvent);
    stream.onopen = () => {
      setStreamConnected(true);
      if (sendingRef.current) void reconcileAfterReconnect(activeId);
    };
    stream.onerror = () => setStreamConnected(false);
    return () => { stream.close(); setStreamConnected(false); };
  }, [activeId, workspace.id]);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, streaming, status]);

  async function loadConversations() {
    try {
      const result = await api<{ conversations: ConversationSummary[] }>(`/api/workspaces/${workspace.id}/conversations`);
      const next = result.conversations.length ? result.conversations : [
        await createFirstConversation(),
      ];
      setConversations(next);
      setActiveId((current) => next.some((item) => item.id === current) ? current : next[0]?.id ?? "");
    } catch (loadError) { onError(errorText(loadError)); }
  }
  async function createFirstConversation(): Promise<ConversationSummary> {
    if (firstConversationRef.current?.workspaceId !== workspace.id) {
      const promise = api<{ conversation: ConversationSummary }>(`/api/workspaces/${workspace.id}/conversations`, { method: "POST", body: {} })
        .then((result) => result.conversation)
        .catch((error) => { firstConversationRef.current = null; throw error; });
      firstConversationRef.current = { workspaceId: workspace.id, promise };
    }
    return firstConversationRef.current.promise;
  }
  async function loadMessages(id: string): Promise<ChatMessage[]> {
    try {
      const result = await api<{ messages: ChatMessage[] }>(`/api/workspaces/${workspace.id}/conversations/${id}`);
      const visible = result.messages.filter((message) => message.role !== "system");
      setMessages(visible);
      return visible;
    } catch (loadError) { onError(errorText(loadError)); return []; }
  }
  async function reconcileAfterReconnect(id: string) {
    const latest = await loadMessages(id);
    if (sendingRef.current && latest.at(-1)?.role === "assistant") {
      sendingRef.current = false;
      setSending(false); setStatus(""); setStreaming(""); void loadConversations();
    }
  }
  async function newChat() {
    try {
      const result = await api<{ conversation: ConversationSummary }>(`/api/workspaces/${workspace.id}/conversations`, { method: "POST", body: {} });
      setConversations((current) => [result.conversation, ...current]);
      setActiveId(result.conversation.id);
    } catch (createError) { onError(errorText(createError)); }
  }
  function handleStream(event: ChatStreamEvent) {
    if (event.type === "assistant_delta") setStreaming((current) => current + (event.text ?? ""));
    else if (event.type === "status") setStatus(event.message === "Connected." && !sendingRef.current ? "" : event.message ?? "");
    else if (event.type === "tool") setStatus([event.toolName, event.phase, event.detail].filter(Boolean).join(" · "));
    else if (event.type === "extension_ui_request" && event.request) setExtensionRequest(event.request);
    else if (event.type === "editor") setDraft((current) => event.editorMode === "replace" ? event.text ?? "" : `${current}${event.text ?? ""}`);
    else if (event.type === "error") { sendingRef.current = false; setSending(false); setStatus(""); onError(event.message ?? "The agent turn failed."); }
    else if (event.type === "done") {
      sendingRef.current = false; setSending(false); setStatus(""); setStreaming(""); void loadMessages(activeId); void loadConversations();
    }
  }
  async function sendMessage(event: FormEvent) {
    event.preventDefault();
    const content = draft.trim();
    if (!content || sending || !activeId || !streamConnected) return;
    if (!agent.configured) { onOpenSetup(); return; }
    const conversationId = activeId;
    const optimistic: ChatMessage = { id: `local-${Date.now()}`, role: "user", content, createdAt: new Date().toISOString() };
    setMessages((current) => [...current, optimistic]);
    sendingRef.current = true; setDraft(""); setStreaming(""); setSending(true); setStatus("Pi is thinking…");
    try {
      await api(`/api/workspaces/${workspace.id}/conversations/${conversationId}/messages`, { method: "POST", body: { content, contextPaths } });
      onContextPathsChange([]);
    } catch (sendError) {
      sendingRef.current = false; setSending(false); setStatus(""); onError(errorText(sendError));
    }
  }
  async function stopTurn() {
    if (!activeId || !sending) return;
    setStatus("Stopping Pi…");
    try {
      const result = await api<{ aborted: boolean }>(`/api/workspaces/${workspace.id}/conversations/${activeId}/abort`, { method: "POST", body: {} });
      if (!result.aborted) {
        sendingRef.current = false;
        setSending(false); setStatus(""); setStreaming("");
        await loadMessages(activeId);
      }
    } catch (abortError) { onError(errorText(abortError)); }
  }
  async function respondToExtension(value: unknown, cancelled = false) {
    if (!extensionRequest || !activeId) return;
    if (extensionRequest.method === "notify") {
      setExtensionRequest(null);
      return;
    }
    try {
      await api(`/api/workspaces/${workspace.id}/conversations/${activeId}/extension-ui/${extensionRequest.id}`, { method: "POST", body: { value, cancelled } });
      setExtensionRequest(null);
    } catch (responseError) { onError(errorText(responseError)); }
  }

  return <div className="pane-layout">
    <aside className="sidebar-pane">
      <PaneTitle icon={<MessageSquare size={18} />} title="Chats" detail="Pi sessions in this workspace" action={<button className="icon-button" type="button" onClick={() => void newChat()} title="New chat" disabled={sending}><CirclePlus size={17} /></button>} />
      <div className="conversation-list">{conversations.length ? conversations.map((conversation) => <button className={activeId === conversation.id ? "conversation-row active" : "conversation-row"} type="button" key={conversation.id} onClick={() => setActiveId(conversation.id)} disabled={sending}><MessageSquare size={15} /><span><strong>{conversation.title}</strong><small>{formatDate(conversation.updatedAt)}</small></span></button>) : <div className="sidebar-empty">Preparing your first chat…</div>}</div>
    </aside>
    <section className="content-pane chat-pane">
      <div className="chat-header"><div><p className="eyebrow">PI AGENT</p><h2>{conversations.find((item) => item.id === activeId)?.title ?? "New chat"}</h2></div><button className="agent-status-chip" type="button" onClick={onOpenSetup}><span className={agent.configured ? "status-dot ready" : "status-dot"} />{agent.configured ? `${agent.provider} / ${agent.model}` : "Set up agent"}<Settings2 size={14} /></button></div>
      {!agent.configured ? <AgentEmpty onOpenSetup={onOpenSetup} /> : <div className="message-list">{messages.map((message) => <ChatBubble message={message} key={message.id} />)}{streaming ? <div className="message assistant"><div className="message-avatar"><Bot size={15} /></div><div className="message-body markdown"><ReactMarkdown remarkPlugins={[remarkGfm]}>{streaming}</ReactMarkdown></div></div> : null}{status ? <div className="turn-status"><Loader2 className={sending ? "spin" : ""} size={14} />{status}</div> : null}<div ref={endRef} /></div>}
      <form className="composer" onSubmit={(event) => void sendMessage(event)}>
        {contextPaths.length ? <div className="context-chips">{contextPaths.map((path) => <button type="button" key={path} onClick={() => onContextPathsChange(contextPaths.filter((item) => item !== path))}><Paperclip size={12} />{path}<X size={12} /></button>)}</div> : null}
        <div className="composer-row"><textarea value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} placeholder={!agent.configured ? "Set up Pi to start chatting…" : streamConnected ? "Ask Pi anything, or use /skill:name…" : "Connecting this chat…"} rows={2} disabled={sending || !streamConnected} /><button className="send-button" type={sending ? "button" : "submit"} onClick={sending ? () => void stopTurn() : undefined} disabled={!sending && (!streamConnected || !draft.trim())} title={sending ? "Stop Pi" : "Send"}>{sending ? <X size={18} /> : <Send size={18} />}</button></div>
      </form>
      {extensionRequest ? <ExtensionDialog request={extensionRequest} onRespond={respondToExtension} /> : null}
    </section>
  </div>;
}

function ChatBubble({ message }: { message: ChatMessage }) {
  return <div className={`message ${message.role}`}><div className="message-avatar">{message.role === "assistant" ? <Bot size={15} /> : <span>Y</span>}</div><div className="message-body markdown"><ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown><small>{formatTime(message.createdAt)}</small></div></div>;
}

function AgentEmpty({ onOpenSetup }: { onOpenSetup: () => void }) {
  return <div className="agent-empty"><div className="agent-orbit"><Bot size={32} /></div><p className="eyebrow">BRING YOUR OWN PI</p><h2>Connect your agent</h2><p>Choose any Pi-supported provider and model. Workspace itself does not require an account.</p><button className="primary-button" type="button" onClick={onOpenSetup}><Plug size={16} /> Set up Pi</button></div>;
}

function AgentSetup({ workspace, status, onClose, onConfigured }: { workspace: WorkspaceSummary; status: AgentStatus; onClose: () => void; onConfigured: (status: AgentStatus) => void }) {
  const [models, setModels] = useState<AgentModel[]>([]);
  const [provider, setProvider] = useState(status.provider ?? "openrouter");
  const [model, setModel] = useState(status.model ?? "");
  const [apiKey, setApiKey] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { void api<{ models: AgentModel[] }>(`/api/agent/models?workspaceId=${encodeURIComponent(workspace.id)}`).then((result) => {
    setModels(result.models); setLoading(false);
    const first = result.models.find((item) => item.provider === provider)
      ?? result.models.find((item) => item.provider === "openrouter")
      ?? result.models[0];
    if (first) {
      setProvider(first.provider);
      setModel((current) => result.models.some((item) => item.provider === first.provider && item.id === current) ? current : first.id);
    }
  }).catch((loadError) => { setError(errorText(loadError)); setLoading(false); }); }, [workspace.id]);
  const providers = unique(models.map((item) => item.provider)).sort();
  const providerModels = models.filter((item) => item.provider === provider);
  useEffect(() => { if (!providerModels.some((item) => item.id === model)) setModel(providerModels[0]?.id ?? ""); }, [provider]);
  const oauthSupported = providerModels.some((item) => item.oauthSupported);
  const providerAuthConfigured = providerModels.some((item) => item.authConfigured);
  async function save() {
    if (!provider || !model) return;
    setSaving(true); setError(null);
    try {
      const result = await api<{ status: AgentStatus }>("/api/agent/configure", { method: "POST", body: { workspaceId: workspace.id, provider, model, apiKey: apiKey.trim() || undefined } });
      onConfigured(result.status);
    } catch (saveError) { setError(errorText(saveError)); setSaving(false); }
  }
  async function connectOAuth() {
    setSaving(true); setError(null);
    try {
      const result = await api<{ status: AgentStatus }>("/api/agent/oauth", { method: "POST", body: { workspaceId: workspace.id, provider, model } });
      onConfigured(result.status);
    } catch (oauthError) { setError(errorText(oauthError)); setSaving(false); }
  }
  return <Modal title="Agent setup" subtitle="Configure native Pi for Workspace" onClose={onClose}>
    {loading ? <LoadingRow label="Loading Pi models" /> : <div className="setup-grid">
      <div className="setup-intro"><Bot size={24} /><div><strong>Native Pi runtime</strong><p>Built-in tools, skills, packages, slash commands, and trusted extensions are available.</p></div></div>
      {error ? <div className="inline-error">{error}</div> : null}
      <label>Provider<select value={provider} onChange={(event) => { setProvider(event.target.value); setModel(""); }}>{providers.map((item) => <option key={item}>{item}</option>)}</select></label>
      <label>Model<select value={model} onChange={(event) => setModel(event.target.value)}>{providerModels.map((item) => <option value={item.id} key={item.id}>{item.name || item.id}</option>)}</select></label>
      <label>API key <span>stored securely on this computer</span><input type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder={providerAuthConfigured ? "Saved credential available" : "Paste a key"} autoComplete="off" /></label>
      <button className="primary-button" type="button" onClick={() => void save()} disabled={saving || !model || (!providerAuthConfigured && !apiKey.trim())}>{saving ? <Loader2 className="spin" size={16} /> : <Check size={16} />} Save agent</button>
      {oauthSupported ? <button className="secondary-button" type="button" onClick={() => void connectOAuth()} disabled={saving}><Cloud size={16} /> Connect subscription with OAuth</button> : null}
      <p className="security-note"><ShieldCheck size={14} /> Project extensions load only after you trust the selected folder.</p>
    </div>}
  </Modal>;
}

function AgentLibraryPane({ workspace, mode, agent, onAgentChanged, onOpenSetup, onError }: {
  workspace: WorkspaceSummary;
  mode: "skills" | "extensions";
  agent: AgentStatus;
  onAgentChanged: (status: AgentStatus) => void;
  onOpenSetup: () => void;
  onError: (message: string | null) => void;
}) {
  const [catalog, setCatalog] = useState<AgentCatalog | null>(null);
  const [packageSource, setPackageSource] = useState("");
  const [scope, setScope] = useState<"global" | "project">("global");
  const [busy, setBusy] = useState(false);
  const importRef = useRef<HTMLInputElement>(null);
  useEffect(() => { void load(); }, [workspace.id]);
  async function load() { try { setCatalog(await api<AgentCatalog>(`/api/workspaces/${workspace.id}/agent/catalog`)); } catch (loadError) { onError(errorText(loadError)); } }
  async function setTrusted(trusted: boolean) { try { const result = await api<{ catalog: AgentCatalog }>(`/api/workspaces/${workspace.id}/agent/trust`, { method: "POST", body: { trusted } }); setCatalog(result.catalog); } catch (trustError) { onError(errorText(trustError)); } }
  async function installPackage() {
    if (!packageSource.trim()) return; setBusy(true);
    try { await api("/api/agent/packages/install", { method: "POST", body: { workspaceId: workspace.id, source: packageSource.trim(), scope } }); setPackageSource(""); await load(); } catch (installError) { onError(errorText(installError)); } finally { setBusy(false); }
  }
  async function importSkills(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []); event.target.value = ""; if (!files.length) return;
    const form = new FormData(); form.set("workspaceId", workspace.id); form.set("scope", scope); for (const file of files) form.append("files", file, file.name);
    setBusy(true); try { await apiForm("/api/agent/skills/import", form); await load(); } catch (importError) { onError(errorText(importError)); } finally { setBusy(false); }
  }
  return <div className="single-pane library-surface">
    <div className="library-heading"><div><p className="eyebrow">NATIVE PI</p><h1>{mode === "skills" ? "Skills" : "Extensions"}</h1><p>{mode === "skills" ? "Portable Agent Skills, loaded progressively when relevant." : "Pi extensions can add tools, commands, providers, and interactive workflows."}</p></div><button className="secondary-button" type="button" onClick={() => void load()}><RefreshCw size={15} /> Refresh</button></div>
    {!agent.configured ? <div className="trust-banner"><Bot size={18} /><div><strong>Chat agent not configured yet</strong><span>You can organize Skills and Extensions now, then choose a provider when you are ready to chat.</span></div><button className="secondary-button compact" type="button" onClick={onOpenSetup}>Set up chat</button></div> : null}
    <div className="trust-banner"><ShieldCheck size={18} /><div><strong>{catalog?.projectTrusted ? "Project trusted" : "Project resources are not trusted"}</strong><span>{catalog?.projectTrusted ? "Workspace-local Pi Skills, Extensions, packages, and settings may load." : "Global resources and native AGENTS.md context still work. Trust this folder to enable local Skills and Extensions."}</span></div><button className="secondary-button compact" type="button" onClick={() => void setTrusted(!catalog?.projectTrusted)}>{catalog?.projectTrusted ? "Remove trust" : "Trust folder"}</button></div>
    <section className="install-panel"><div className="scope-toggle"><button className={scope === "global" ? "active" : ""} type="button" onClick={() => setScope("global")}>Personal</button><button className={scope === "project" ? "active" : ""} type="button" onClick={() => setScope("project")}>This workspace</button></div>{mode === "skills" ? <><button className="primary-button" type="button" disabled={busy} onClick={() => importRef.current?.click()}><Upload size={15} /> Import skill or pack</button><input hidden ref={importRef} type="file" accept=".zip,.skill,.md" multiple onChange={(event) => void importSkills(event)} /></> : null}<label className="package-input"><Package size={15} /><input value={packageSource} onChange={(event) => setPackageSource(event.target.value)} placeholder="npm:package, git URL, or local package path" /><button type="button" disabled={busy || !packageSource.trim()} onClick={() => void installPackage()}>{busy ? <Loader2 className="spin" size={15} /> : "Install"}</button></label></section>
    {mode === "skills" ? <p className="security-note"><ShieldCheck size={14} /> Skills can include executable scripts. Inspect packs before importing; project-scoped imports also require folder trust.</p> : <p className="security-note"><ShieldCheck size={14} /> Npm and git sources use command-line tools installed on this computer.</p>}
    {catalog?.diagnostics.length ? <div className="diagnostics">{catalog.diagnostics.map((item, index) => <span className={item.type} key={`${item.message}-${index}`}>{item.message}</span>)}</div> : null}
    {mode === "skills" ? <div className="card-grid">{catalog?.skills.length ? catalog.skills.map((skill) => <article className="resource-card" key={`${skill.source}:${skill.name}`}><div className="card-icon"><Sparkles size={18} /></div><div><strong>{skill.name}</strong><p>{skill.description}</p><small>{skill.source} · {skill.path}</small></div><span className={skill.enabled ? "enabled-badge" : "disabled-badge"}>{skill.enabled ? "Enabled" : "Disabled"}</span></article>) : <EmptyState icon={<Sparkles size={30} />} title="No skills loaded" detail="Import an Agent Skill, add a Pi package, or place skills in a standard Pi location." />}</div> : <><div className="card-grid">{catalog?.extensions.length ? catalog.extensions.map((extension) => <article className="resource-card" key={`${extension.source}:${extension.id}`}><div className="card-icon"><Plug size={18} /></div><div><strong>{extension.name}</strong><p>{extension.tools.length} tools · {extension.commands.length} commands</p><small>{extension.source} · {extension.path}</small></div><span className={extension.enabled ? "enabled-badge" : "disabled-badge"}>{extension.enabled ? "Loaded" : "Disabled"}</span></article>) : <EmptyState icon={<Plug size={30} />} title="No extensions loaded" detail="Install a Pi package containing an extension, or add one to a trusted .pi/extensions folder." />}</div>{catalog?.tools.length ? <details className="tool-details"><summary><Code2 size={15} /> Available tools ({catalog.tools.length})</summary><div className="tool-list">{catalog.tools.map((tool) => <span key={tool.name}><strong>{tool.name}</strong>{tool.description}<small>{tool.source}</small></span>)}</div></details> : null}</>}
  </div>;
}

function ResourcesPane({ workspace, onError }: { workspace: WorkspaceSummary; onError: (message: string | null) => void }) {
  const [tree, setTree] = useState<TreeEntry[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const uploadRef = useRef<HTMLInputElement>(null);
  const selectedEntry = selected ? findTreeEntry(tree, selected) : null;
  useEffect(() => { void load(); }, []);
  async function load() { try { setTree((await api<{ tree: TreeEntry[] }>("/api/resources/tree")).tree); } catch (loadError) { onError(errorText(loadError)); } }
  async function upload(event: ChangeEvent<HTMLInputElement>) { const files = Array.from(event.target.files ?? []); event.target.value = ""; if (!files.length) return; const form = new FormData(); form.set("targetFolderPath", selectedEntry?.kind === "folder" ? selectedEntry.path : ""); form.set("relativePaths", JSON.stringify(files.map((file) => file.webkitRelativePath || file.name))); for (const file of files) form.append("files", file, file.name); try { await apiForm("/api/resources/upload", form); await load(); } catch (uploadError) { onError(errorText(uploadError)); } }
  async function createFolder() { const name = window.prompt("Folder name"); if (!name?.trim()) return; try { await api("/api/resources/folders", { method: "POST", body: { parentPath: selectedEntry?.kind === "folder" ? selectedEntry.path : "", name: name.trim() } }); await load(); } catch (folderError) { onError(errorText(folderError)); } }
  async function addToWorkspace() { if (!selected) return; try { await api("/api/resources/copy-to-workspace", { method: "POST", body: { workspaceId: workspace.id, paths: [selected], targetFolder: "Resources" } }); } catch (copyError) { onError(errorText(copyError)); } }
  return <div className="pane-layout"><aside className="sidebar-pane"><PaneTitle icon={<Box size={18} />} title="Resources" detail="Reusable personal files" /><div className="pane-toolbar"><label className="search-box"><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search resources" /></label><button className="icon-button" type="button" onClick={() => uploadRef.current?.click()} title={selectedEntry?.kind === "folder" ? `Upload to ${selectedEntry.name}` : "Upload"}><Upload size={16} /></button><button className="icon-button" type="button" onClick={() => void createFolder()} title={selectedEntry?.kind === "folder" ? `New folder in ${selectedEntry.name}` : "New folder"}><Folder size={16} /></button><input hidden ref={uploadRef} type="file" multiple onChange={(event) => void upload(event)} /></div><div className="tree-scroll"><FileTree entries={query.trim() ? filterTree(tree, query.trim().toLocaleLowerCase()) : tree} selectedPath={selected} onSelect={setSelected} selectFolders /></div></aside><section className="content-pane">{selectedEntry ? <div className="resource-selection"><div className="card-icon large">{selectedEntry.kind === "folder" ? <Folder size={26} /> : <FileText size={26} />}</div><p className="eyebrow">PERSONAL RESOURCE</p><h2>{selectedEntry.name}</h2><span>{selectedEntry.path}</span><button className="primary-button" type="button" onClick={() => void addToWorkspace()}><Copy size={16} /> Add to {workspace.name}</button><p>The resource is copied into this workspace’s visible <strong>Resources</strong> folder. It is never added to a prompt automatically.</p></div> : <EmptyState icon={<Box size={30} />} title="Your reusable library" detail="Upload templates, references, examples, or any files you want available across workspaces." />}</section></div>;
}

function HistoryPane({ workspace, onError }: { workspace: WorkspaceSummary; onError: (message: string | null) => void }) {
  const [items, setItems] = useState<WorkspaceCheckpoint[]>([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => { void load(); }, [workspace.id]);
  async function load() { try { setItems((await api<{ checkpoints: WorkspaceCheckpoint[] }>(`/api/workspaces/${workspace.id}/history/checkpoints`)).checkpoints); } catch (loadError) { onError(errorText(loadError)); } }
  async function savePoint() { setBusy(true); try { await api(`/api/workspaces/${workspace.id}/history/checkpoints`, { method: "POST", body: { label: "Manual restore point" } }); await load(); } catch (saveError) { onError(errorText(saveError)); } finally { setBusy(false); } }
  async function restore(item: WorkspaceCheckpoint) { if (!window.confirm(`Restore ${workspace.name} to ${formatDate(item.createdAt)}?`)) return; setBusy(true); try { await api(`/api/workspaces/${workspace.id}/history/checkpoints/${item.checkpointId}/restore`, { method: "POST", body: {} }); await load(); } catch (restoreError) { onError(errorText(restoreError)); } finally { setBusy(false); } }
  return <div className="single-pane history-surface"><div className="library-heading"><div><p className="eyebrow">LOCAL HISTORY</p><h1>Restore points</h1><p>Snapshots are stored in Workspace application data, outside your working folder.</p></div><button className="primary-button" type="button" onClick={() => void savePoint()} disabled={busy}>{busy ? <Loader2 className="spin" size={15} /> : <Clock3 size={15} />} Save restore point</button></div><div className="history-list">{items.length ? items.map((item) => <article key={item.checkpointId}><div className="history-icon"><History size={17} /></div><div><strong>{item.label || item.reason}</strong><span>{formatDate(item.createdAt)} · {item.fileCount} files</span></div><button className="secondary-button compact" type="button" onClick={() => void restore(item)} disabled={busy}>Restore</button></article>) : <EmptyState icon={<History size={30} />} title="No restore points yet" detail="Create one before a large set of edits when you want a local rollback point." />}</div></div>;
}

function ExtensionDialog({ request, onRespond }: { request: ExtensionUiRequest; onRespond: (value: unknown, cancelled?: boolean) => Promise<void> }) {
  const [value, setValue] = useState(request.initialValue ?? "");
  if (request.method === "notify") return <div className="extension-notice"><Plug size={15} /><span>{request.message}</span><button type="button" onClick={() => void onRespond(true)}><X size={14} /></button></div>;
  return <Modal title={request.title || "Extension request"} subtitle={request.message || "A Pi extension needs your input."} onClose={() => void onRespond(null, true)}>
    <div className="extension-dialog-content">{request.method === "select" ? <div className="select-options">{request.options?.map((option) => <button className="secondary-button" type="button" key={option} onClick={() => void onRespond(option)}>{option}</button>)}</div> : request.method === "confirm" ? <div className="modal-actions"><button className="secondary-button" type="button" onClick={() => void onRespond(false)}>No</button><button className="primary-button" type="button" onClick={() => void onRespond(true)}>Yes</button></div> : <><label>{request.method === "editor" ? "Response" : "Value"}{request.method === "editor" ? <textarea rows={8} value={value} onChange={(event) => setValue(event.target.value)} placeholder={request.placeholder} /> : <input type={request.secret ? "password" : "text"} value={value} onChange={(event) => setValue(event.target.value)} placeholder={request.placeholder} autoComplete={request.secret ? "off" : undefined} />}</label><div className="modal-actions"><button className="secondary-button" type="button" onClick={() => void onRespond(null, true)}>Cancel</button><button className="primary-button" type="button" onClick={() => void onRespond(value)}>Continue</button></div></>}</div>
  </Modal>;
}

function Modal({ title, subtitle, onClose, children }: { title: string; subtitle?: string; onClose: () => void; children: ReactNode }) {
  return <div className="modal-backdrop" role="presentation" onMouseDown={onClose}><section className="modal-card" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}><header><div><h2>{title}</h2>{subtitle ? <p>{subtitle}</p> : null}</div><button className="icon-button" type="button" onClick={onClose}><X size={17} /></button></header><div className="modal-body">{children}</div></section></div>;
}

function PaneTitle({ icon, title, detail, action }: { icon: ReactNode; title: string; detail: string; action?: ReactNode }) { return <div className="pane-title"><span>{icon}</span><div><h2>{title}</h2><p>{detail}</p></div>{action ? <div className="pane-title-action">{action}</div> : null}</div>; }
function LoadingRow({ label }: { label: string }) { return <div className="loading-row"><Loader2 className="spin" size={15} />{label}</div>; }
function EmptyState({ icon, title, detail }: { icon: ReactNode; title: string; detail: string }) { return <div className="empty-state"><div>{icon}</div><h2>{title}</h2><p>{detail}</p></div>; }
function Centered({ icon, title, detail }: { icon: ReactNode; title: string; detail: string }) { return <main className="centered-state"><div>{icon}</div><h1>{title}</h1><p>{detail}</p></main>; }
function unique<T>(values: T[]): T[] { return [...new Set(values)]; }
function toggleSet(current: Set<string>, value: string): Set<string> { const next = new Set(current); if (next.has(value)) next.delete(value); else next.add(value); return next; }
function formatDate(value: string): string { return new Date(value).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }); }
function formatTime(value: string): string { return new Date(value).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }); }
function filterTree(entries: TreeEntry[], query: string): TreeEntry[] { return entries.flatMap((entry) => { const children = entry.children ? filterTree(entry.children, query) : []; return entry.name.toLocaleLowerCase().includes(query) || children.length ? [{ ...entry, children }] : []; }); }
function findTreeEntry(entries: TreeEntry[], path: string): TreeEntry | null { for (const entry of entries) { if (entry.path === path) return entry; const child = entry.children ? findTreeEntry(entry.children, path) : null; if (child) return child; } return null; }
