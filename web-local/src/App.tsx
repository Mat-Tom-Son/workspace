import {
  Bot, Check, ChevronDown, ChevronRight, CirclePlus, Clock3, Cloud, Code2, Copy,
  File, FileText, Folder, FolderOpen, History, LibraryBig, Loader2, MessageSquare, Package,
  Paperclip, Plug, RefreshCw, Search, Send, Settings2, ShieldCheck, Sparkles, Trash2, Upload, X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { api, apiForm, createEventSource, errorText } from "./lib/api";
import { assistantNavigation, primaryNavigation, welcomeActions } from "./ui-contract";
import type {
  AgentCatalog, AgentModel, AgentStatus, BootstrapResponse, ChatMessage, ChatStreamEvent,
  ConversationSummary, ExtensionUiRequest, TreeEntry, WorkspaceCheckpoint, WorkspacePane,
  WorkspaceSummary,
} from "./types";

const primaryPaneItems: Array<{ id: WorkspacePane; label: string; icon: ReactNode }> = [
  { ...primaryNavigation[0], icon: <FolderOpen size={18} /> },
  { ...primaryNavigation[1], icon: <MessageSquare size={19} /> },
  { ...primaryNavigation[2], icon: <LibraryBig size={19} /> },
  { ...primaryNavigation[3], icon: <History size={19} /> },
];

const assistantPaneItems: Array<{ id: "skills" | "extensions"; label: string; icon: ReactNode }> = [
  { ...assistantNavigation[1], icon: <Sparkles size={18} /> },
  { ...assistantNavigation[2], icon: <Plug size={18} /> },
];

export function App() {
  const [boot, setBoot] = useState<BootstrapResponse | null>(null);
  const [activeWorkspaceId, setActiveWorkspaceId] = useState(() => localStorage.getItem("workspace.active") ?? "");
  const [pane, setPane] = useState<WorkspacePane>("space");
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [createSpaceOpen, setCreateSpaceOpen] = useState(false);

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
    setPane("setup");
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

  async function createWorkspace(name: string): Promise<boolean> {
    setCreating(true);
    setError(null);
    try {
      const result = await api<{ workspace: WorkspaceSummary }>("/api/workspaces", {
        method: "POST",
        body: { name },
      });
      await refreshBootstrap();
      setActiveWorkspaceId(result.workspace.id);
      return true;
    } catch (createError) {
      setError(errorText(createError));
      return false;
    } finally {
      setCreating(false);
    }
  }

  async function openFolder() {
    const picker = window.workspaceDesktop?.workspace;
    if (!picker) {
      setError("Turning a folder into a Space is available in the desktop app.");
      return;
    }
    setError(null);
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
    return <Centered icon={<Loader2 className="spin" />} title="Opening Workspace" detail={error ?? "Loading your Spaces and Assistant."} />;
  }

  if (!activeWorkspace) {
    return <Welcome creating={creating} error={error} onCreate={createWorkspace} onOpenFolder={openFolder} />;
  }

  return (
    <div className="workspace-app">
      <nav className="mode-rail" aria-label="Workspace sections">
        <div className="brand-lockup" aria-label="Workspace"><span>W</span><strong>Workspace</strong></div>
        <div className="rail-items">
          {primaryPaneItems.map((item) => (
            <button className={pane === item.id ? "rail-button active" : "rail-button"} type="button" key={item.id} onClick={() => setPane(item.id)} title={item.label} aria-label={item.label} aria-current={pane === item.id ? "page" : undefined}>
              {item.icon}<span>{item.label}</span>
            </button>
          ))}
          <div className={pane === "setup" || pane === "skills" || pane === "extensions" ? "rail-group active" : "rail-group"} role="group" aria-label="Assistant">
            <div className="rail-group-label"><Bot size={18} /><span>Assistant</span><i className={boot.agent.configured ? "status-dot ready" : "status-dot"} /></div>
            <button className={pane === "setup" ? "rail-subbutton active" : "rail-subbutton"} type="button" onClick={() => setPane("setup")} title="Assistant setup" aria-label="Assistant Setup" aria-current={pane === "setup" ? "page" : undefined}>
              <Settings2 size={17} /><span>{assistantNavigation[0].label}</span>
            </button>
            {assistantPaneItems.map((item) => (
              <button className={pane === item.id ? "rail-subbutton active" : "rail-subbutton"} type="button" key={item.id} onClick={() => setPane(item.id)} title={item.label} aria-label={`Assistant ${item.label}`} aria-current={pane === item.id ? "page" : undefined}>
                {item.icon}<span>{item.label}</span>
              </button>
            ))}
          </div>
        </div>
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
        onCreateSpace={() => setCreateSpaceOpen(true)}
        onOpenSetup={() => setPane("setup")}
        onError={setError}
      />

      {error ? <div className="global-error" role="alert"><span>{error}</span><button type="button" onClick={() => setError(null)} aria-label="Dismiss error"><X size={15} /></button></div> : null}
      {createSpaceOpen ? <CreateSpaceDialog creating={creating} onClose={() => setCreateSpaceOpen(false)} onCreate={createWorkspace} /> : null}
    </div>
  );
}

function Welcome({ creating, error, onCreate, onOpenFolder }: {
  creating: boolean;
  error: string | null;
  onCreate: (name: string) => Promise<boolean>;
  onOpenFolder: () => Promise<void>;
}) {
  const [name, setName] = useState("");
  return (
    <main className="welcome-page">
      <div className="welcome-card">
        <div className="welcome-mark">W</div>
        <p className="eyebrow">WORKSPACE</p>
        <h1>Give your work a Space</h1>
        <p className="welcome-copy">A Space keeps everything for one kind of work together—files, Chats, History, and your Assistant.</p>
        {error ? <div className="inline-error">{error}</div> : null}
        <form onSubmit={(event) => { event.preventDefault(); if (name.trim()) void onCreate(name.trim()); }}>
          <label>What are you working on?<input value={name} onChange={(event) => setName(event.target.value)} placeholder="Plan a trip, organize photos, manage a move…" maxLength={80} autoFocus /></label>
          <button className="primary-button" type="submit" disabled={creating || !name.trim()}>
            {creating ? <Loader2 className="spin" size={17} /> : <CirclePlus size={17} />} {welcomeActions.create}
          </button>
        </form>
        <div className="welcome-divider"><span>or</span></div>
        <button className="secondary-button wide" type="button" onClick={() => void onOpenFolder()}>
          <FolderOpen size={17} /> {welcomeActions.linkFolder}
        </button>
        <div className="drive-note"><Cloud size={16} /><span>The folder stays where it is. Google Drive for desktop folders work too.</span></div>
      </div>
    </main>
  );
}

function CreateSpaceDialog({ creating, onClose, onCreate }: {
  creating: boolean;
  onClose: () => void;
  onCreate: (name: string) => Promise<boolean>;
}) {
  const [name, setName] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (name.trim() && await onCreate(name.trim())) onClose();
  }
  return <Modal title="Create a Space" subtitle="Give this work a place of its own." onClose={onClose}>
    <form className="setup-grid" onSubmit={(event) => void submit(event)}>
      <label>What are you working on?<input value={name} onChange={(event) => setName(event.target.value)} placeholder="2026 taxes, family photos, job search…" maxLength={80} autoFocus /></label>
      <p className="security-note"><Folder size={14} /> Workspace creates an ordinary folder for this Space on your computer.</p>
      <div className="modal-actions"><button className="secondary-button" type="button" onClick={onClose}>Cancel</button><button className="primary-button" type="submit" disabled={creating || !name.trim()}>{creating ? <Loader2 className="spin" size={16} /> : <CirclePlus size={16} />} Create Space</button></div>
    </form>
  </Modal>;
}

function WorkspaceSurface(props: {
  pane: WorkspacePane;
  workspace: WorkspaceSummary;
  workspaces: WorkspaceSummary[];
  agent: AgentStatus;
  onAgentChanged: (status: AgentStatus) => void;
  onSwitchWorkspace: (id: string) => void;
  onOpenFolder: () => Promise<void>;
  onCreateSpace: () => void;
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
          <select value={props.workspace.id} onChange={(event) => props.onSwitchWorkspace(event.target.value)} aria-label="Current Space">
            {props.workspaces.map((workspace) => <option value={workspace.id} key={workspace.id}>{workspace.name}</option>)}
          </select>
          <ChevronDown size={16} />
        </div>
        {window.workspaceDesktop?.workspace.revealFolder ? <button className="location-chip location-chip-button" type="button" aria-label={`Show folder for ${props.workspace.name}`} title={`Show folder: ${props.workspace.rootPath}`} onClick={() => void window.workspaceDesktop?.workspace.revealFolder?.(props.workspace.id).catch((revealError) => props.onError(errorText(revealError)))}>{props.workspace.location.providerHint === "google-drive" ? <Cloud size={14} /> : <Folder size={14} />}{props.workspace.location.providerHint === "google-drive" ? "Google Drive" : "This computer"}</button> : <span className="location-chip" title={props.workspace.rootPath}>{props.workspace.location.providerHint === "google-drive" ? <Cloud size={14} /> : <Folder size={14} />}{props.workspace.location.providerHint === "google-drive" ? "Google Drive" : "This computer"}</span>}
        <div className="space-actions"><button className="header-action" type="button" onClick={props.onCreateSpace}><CirclePlus size={15} /> New Space</button><button className="header-action" type="button" onClick={() => void props.onOpenFolder()} title="Turn an existing folder into a Space"><FolderOpen size={15} /> Add folder as Space</button></div>
      </header>

      {props.pane === "space" ? (
        <SpacePane key={props.workspace.id} workspace={props.workspace} selectedPath={selectedPath} onSelectPath={setSelectedPath} onAttach={(path) => setChatContextPaths((current) => unique([...current, path]))} onError={props.onError} />
      ) : null}
      {props.pane === "chats" ? (
        <ChatsPane key={props.workspace.id} workspace={props.workspace} agent={props.agent} contextPaths={chatContextPaths} onContextPathsChange={setChatContextPaths} onOpenSetup={props.onOpenSetup} onError={props.onError} />
      ) : null}
      {props.pane === "skills" || props.pane === "extensions" ? (
        <AssistantCapabilityPane key={`${props.workspace.id}:${props.pane}`} workspace={props.workspace} mode={props.pane} agent={props.agent} onOpenSetup={props.onOpenSetup} onError={props.onError} />
      ) : null}
      {props.pane === "setup" ? <AssistantSetupPane key={props.workspace.id} workspace={props.workspace} status={props.agent} onConfigured={props.onAgentChanged} /> : null}
      {props.pane === "library" ? <LibraryPane key={props.workspace.id} workspace={props.workspace} onError={props.onError} /> : null}
      {props.pane === "history" ? <HistoryPane key={props.workspace.id} workspace={props.workspace} onError={props.onError} /> : null}
    </main>
  );
}

function SpacePane({ workspace, selectedPath, onSelectPath, onAttach, onError }: {
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
        <PaneTitle icon={<FolderOpen size={18} />} title="Space" detail="Files and folders for this work" />
        <div className="pane-toolbar">
          <label className="search-box"><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search files" /></label>
          <button className="icon-button" type="button" onClick={() => uploadRef.current?.click()} title="Add files"><Upload size={16} /></button>
          <button className="icon-button" type="button" onClick={() => void loadTree()} title="Refresh"><RefreshCw size={16} /></button>
          <input ref={uploadRef} hidden type="file" multiple onChange={(event) => void uploadFiles(event)} />
        </div>
        <div className="tree-scroll">{loading ? <LoadingRow label="Loading files" /> : <FileTree entries={visibleTree} selectedPath={selectedPath} onSelect={onSelectPath} />}</div>
      </aside>
      <section className="content-pane">
        {!selectedPath ? <EmptyState icon={<FileText size={30} />} title="Choose something in this Space" detail="Preview a text file or attach it to your next Chat." /> : (
          <>
            <div className="content-header"><div><p className="eyebrow">SPACE FILE</p><h2>{selectedPath.split("/").pop()}</h2><span>{selectedPath}</span></div><button className="secondary-button" type="button" onClick={() => onAttach(selectedPath)}><Paperclip size={16} /> Attach to Chat</button></div>
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
    else if (event.type === "error") { sendingRef.current = false; setSending(false); setStatus(""); onError(event.message ?? "The Assistant could not finish that turn."); }
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
      <PaneTitle icon={<MessageSquare size={18} />} title="Chats" detail="Conversations in this Space" action={<button className="icon-button" type="button" onClick={() => void newChat()} title="New Chat" disabled={sending}><CirclePlus size={17} /></button>} />
      <div className="conversation-list">{conversations.length ? conversations.map((conversation) => <button className={activeId === conversation.id ? "conversation-row active" : "conversation-row"} type="button" key={conversation.id} onClick={() => setActiveId(conversation.id)} disabled={sending}><MessageSquare size={15} /><span><strong>{conversation.title}</strong><small>{formatDate(conversation.updatedAt)}</small></span></button>) : <div className="sidebar-empty">Preparing your first chat…</div>}</div>
    </aside>
    <section className="content-pane chat-pane">
      <div className="chat-header"><div><p className="eyebrow">ASSISTANT</p><h2>{conversations.find((item) => item.id === activeId)?.title ?? "New Chat"}</h2></div><button className="agent-status-chip" type="button" onClick={onOpenSetup}><span className={agent.configured ? "status-dot ready" : "status-dot"} />{agent.configured ? `${agent.provider} / ${agent.model}` : "Set up Assistant"}<Settings2 size={14} /></button></div>
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
  return <div className="agent-empty"><div className="agent-orbit"><Bot size={32} /></div><p className="eyebrow">BRING YOUR OWN PI</p><h2>Set up your Assistant</h2><p>Choose any Pi-supported provider and model. Workspace itself does not require an account.</p><button className="primary-button" type="button" onClick={onOpenSetup}><Settings2 size={16} /> Set up Assistant</button></div>;
}

function AssistantSetupPane({ workspace, status, onConfigured }: { workspace: WorkspaceSummary; status: AgentStatus; onConfigured: (status: AgentStatus) => void }) {
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
      setModels((current) => current.map((item) => item.provider === provider ? { ...item, authConfigured: true } : item));
      setApiKey("");
      onConfigured(result.status);
    } catch (saveError) { setError(errorText(saveError)); } finally { setSaving(false); }
  }
  async function connectOAuth() {
    setSaving(true); setError(null);
    try {
      const result = await api<{ status: AgentStatus }>("/api/agent/oauth", { method: "POST", body: { workspaceId: workspace.id, provider, model } });
      setModels((current) => current.map((item) => item.provider === provider ? { ...item, authConfigured: true } : item));
      onConfigured(result.status);
    } catch (oauthError) { setError(errorText(oauthError)); } finally { setSaving(false); }
  }
  return <div className="single-pane assistant-surface">
    <div className="library-heading"><div><p className="eyebrow">NATIVE PI</p><h1>Assistant setup</h1><p>Choose the provider and model that power your Assistant.</p></div></div>
    <section className="assistant-setup-card">
      {loading ? <LoadingRow label="Loading Pi models" /> : <div className="setup-grid">
        <div className="setup-intro"><Bot size={24} /><div><strong>Your Assistant, your provider</strong><p>Workspace uses native Pi, including its built-in tools, Skills, commands, and trusted Extensions.</p></div></div>
        {error ? <div className="inline-error">{error}</div> : null}
        <label>Provider<select value={provider} onChange={(event) => { setProvider(event.target.value); setModel(""); }}>{providers.map((item) => <option key={item}>{item}</option>)}</select></label>
        <label>Model<select value={model} onChange={(event) => setModel(event.target.value)}>{providerModels.map((item) => <option value={item.id} key={item.id}>{item.name || item.id}</option>)}</select></label>
        <label>API key <span>stored securely on this computer</span><input type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder={providerAuthConfigured ? "Saved credential available" : "Paste a key"} autoComplete="off" /></label>
        <button className="primary-button" type="button" onClick={() => void save()} disabled={saving || !model || (!providerAuthConfigured && !apiKey.trim())}>{saving ? <Loader2 className="spin" size={16} /> : <Check size={16} />} Save setup</button>
        {oauthSupported ? <button className="secondary-button" type="button" onClick={() => void connectOAuth()} disabled={saving}><Cloud size={16} /> Connect subscription with OAuth</button> : null}
        <p className="security-note"><ShieldCheck size={14} /> Extensions stored in this Space load only after you trust the Space.</p>
      </div>}
    </section>
  </div>;
}

function AssistantCapabilityPane({ workspace, mode, agent, onOpenSetup, onError }: {
  workspace: WorkspaceSummary;
  mode: "skills" | "extensions";
  agent: AgentStatus;
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
  return <div className="single-pane assistant-surface">
    <div className="library-heading"><div><p className="eyebrow">ASSISTANT</p><h1>{mode === "skills" ? "Skills" : "Extensions"}</h1><p>{mode === "skills" ? "Reusable ways of working, loaded progressively when relevant." : "Capabilities and connections your Assistant can use."}</p></div><button className="secondary-button" type="button" onClick={() => void load()}><RefreshCw size={15} /> Refresh</button></div>
    {!agent.configured ? <div className="trust-banner"><Bot size={18} /><div><strong>Assistant not set up yet</strong><span>You can organize Skills and Extensions now, then choose a provider when you are ready to Chat.</span></div><button className="secondary-button compact" type="button" onClick={onOpenSetup}>Open Setup</button></div> : null}
    <div className="trust-banner"><ShieldCheck size={18} /><div><strong>{catalog?.projectTrusted ? "This Space is trusted" : "This Space is not trusted"}</strong><span>{catalog?.projectTrusted ? "Skills, Extensions, packages, and settings stored in this Space may load." : "Personal Skills and Extensions still work. Trust this Space to enable capabilities stored inside it."}</span></div><button className="secondary-button compact" type="button" onClick={() => void setTrusted(!catalog?.projectTrusted)}>{catalog?.projectTrusted ? "Remove trust" : "Trust Space"}</button></div>
    <section className="install-panel"><div className="scope-toggle"><button className={scope === "global" ? "active" : ""} type="button" onClick={() => setScope("global")}>Personal</button><button className={scope === "project" ? "active" : ""} type="button" onClick={() => setScope("project")}>This Space</button></div>{mode === "skills" ? <><button className="primary-button" type="button" disabled={busy} onClick={() => importRef.current?.click()}><Upload size={15} /> Import Skill or pack</button><input hidden ref={importRef} type="file" accept=".zip,.skill,.md" multiple onChange={(event) => void importSkills(event)} /></> : null}<label className="package-input"><Package size={15} /><input value={packageSource} onChange={(event) => setPackageSource(event.target.value)} placeholder="npm package, git URL, or local package path" /><button type="button" disabled={busy || !packageSource.trim()} onClick={() => void installPackage()}>{busy ? <Loader2 className="spin" size={15} /> : "Install"}</button></label></section>
    {mode === "skills" ? <p className="security-note"><ShieldCheck size={14} /> Skills can include executable scripts. Inspect packs before importing; Skills added to this Space also require Space trust.</p> : <p className="security-note"><ShieldCheck size={14} /> Npm and git sources use command-line tools installed on this computer.</p>}
    {catalog?.diagnostics.length ? <div className="diagnostics">{catalog.diagnostics.map((item, index) => <span className={item.type} key={`${item.message}-${index}`}>{item.message}</span>)}</div> : null}
    {mode === "skills" ? <div className="card-grid">{catalog?.skills.length ? catalog.skills.map((skill) => <article className="resource-card" key={`${skill.source}:${skill.name}`}><div className="card-icon"><Sparkles size={18} /></div><div><strong>{skill.name}</strong><p>{skill.description}</p><small>{skill.source} · {skill.path}</small></div><span className={skill.enabled ? "enabled-badge" : "disabled-badge"}>{skill.enabled ? "Enabled" : "Disabled"}</span></article>) : <EmptyState icon={<Sparkles size={30} />} title="No Skills loaded" detail="Import a Skill or compatible pack, add a Pi package, or place Skills in a standard Pi location." />}</div> : <><div className="card-grid">{catalog?.extensions.length ? catalog.extensions.map((extension) => <article className="resource-card" key={`${extension.source}:${extension.id}`}><div className="card-icon"><Plug size={18} /></div><div><strong>{extension.name}</strong><p>{extension.tools.length} tools · {extension.commands.length} commands</p><small>{extension.source} · {extension.path}</small></div><span className={extension.enabled ? "enabled-badge" : "disabled-badge"}>{extension.enabled ? "Loaded" : "Disabled"}</span></article>) : <EmptyState icon={<Plug size={30} />} title="No Extensions loaded" detail="Install a Pi package containing an Extension, or add one to a trusted .pi/extensions folder." />}</div>{catalog?.tools.length ? <details className="tool-details"><summary><Code2 size={15} /> Available tools ({catalog.tools.length})</summary><div className="tool-list">{catalog.tools.map((tool) => <span key={tool.name}><strong>{tool.name}</strong>{tool.description}<small>{tool.source}</small></span>)}</div></details> : null}</>}
  </div>;
}

function LibraryPane({ workspace, onError }: { workspace: WorkspaceSummary; onError: (message: string | null) => void }) {
  const [tree, setTree] = useState<TreeEntry[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [copying, setCopying] = useState(false);
  const [copyStatus, setCopyStatus] = useState("");
  const uploadRef = useRef<HTMLInputElement>(null);
  const selectedEntry = selected ? findTreeEntry(tree, selected) : null;
  useEffect(() => { void load(); }, []);
  useEffect(() => { setCopyStatus(""); }, [selected, workspace.id]);
  async function load() { try { setTree((await api<{ tree: TreeEntry[] }>("/api/resources/tree")).tree); } catch (loadError) { onError(errorText(loadError)); } }
  async function upload(event: ChangeEvent<HTMLInputElement>) { const files = Array.from(event.target.files ?? []); event.target.value = ""; if (!files.length) return; const form = new FormData(); form.set("targetFolderPath", selectedEntry?.kind === "folder" ? selectedEntry.path : ""); form.set("relativePaths", JSON.stringify(files.map((file) => file.webkitRelativePath || file.name))); for (const file of files) form.append("files", file, file.name); try { await apiForm("/api/resources/upload", form); await load(); } catch (uploadError) { onError(errorText(uploadError)); } }
  async function createFolder() { const name = window.prompt("Folder name"); if (!name?.trim()) return; try { await api("/api/resources/folders", { method: "POST", body: { parentPath: selectedEntry?.kind === "folder" ? selectedEntry.path : "", name: name.trim() } }); await load(); } catch (folderError) { onError(errorText(folderError)); } }
  async function addToSpace() {
    if (!selected || copying) return;
    setCopying(true);
    setCopyStatus("");
    try {
      const result = await api<{ copied: string[] }>("/api/resources/copy-to-workspace", { method: "POST", body: { workspaceId: workspace.id, paths: [selected], targetFolder: "From Library" } });
      setCopyStatus(`Added ${result.copied[0] ?? selectedEntry?.name ?? "item"} to ${workspace.name}.`);
    } catch (copyError) {
      onError(errorText(copyError));
    } finally {
      setCopying(false);
    }
  }
  return <div className="pane-layout"><aside className="sidebar-pane"><PaneTitle icon={<LibraryBig size={18} />} title="Library" detail="Reusable materials for every Space" /><div className="pane-toolbar"><label className="search-box"><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search Library" /></label><button className="icon-button" type="button" onClick={() => uploadRef.current?.click()} title={selectedEntry?.kind === "folder" ? `Upload to ${selectedEntry.name}` : "Add to Library"}><Upload size={16} /></button><button className="icon-button" type="button" onClick={() => void createFolder()} title={selectedEntry?.kind === "folder" ? `New folder in ${selectedEntry.name}` : "New Library folder"}><Folder size={16} /></button><input hidden ref={uploadRef} type="file" multiple onChange={(event) => void upload(event)} /></div><div className="tree-scroll"><FileTree entries={query.trim() ? filterTree(tree, query.trim().toLocaleLowerCase()) : tree} selectedPath={selected} onSelect={setSelected} selectFolders /></div></aside><section className="content-pane">{selectedEntry ? <div className="resource-selection"><div className="card-icon large">{selectedEntry.kind === "folder" ? <Folder size={26} /> : <FileText size={26} />}</div><p className="eyebrow">LIBRARY ITEM</p><h2>{selectedEntry.name}</h2><span>{selectedEntry.path}</span><button className="primary-button" type="button" disabled={copying} onClick={() => void addToSpace()}>{copying ? <Loader2 className="spin" size={16} /> : <Copy size={16} />} {copying ? "Adding…" : `Add to ${workspace.name}`}</button>{copyStatus ? <p className="copy-status" role="status"><Check size={15} /> {copyStatus}</p> : null}<p>An independent copy is added to this Space under <strong>From Library</strong>. Your Library original stays unchanged, and nothing is shared with the Assistant automatically.</p></div> : <EmptyState icon={<LibraryBig size={30} />} title="Build your Library" detail="Add templates, references, examples, or anything else you want to reuse across Spaces." />}</section></div>;
}

function HistoryPane({ workspace, onError }: { workspace: WorkspaceSummary; onError: (message: string | null) => void }) {
  const [items, setItems] = useState<WorkspaceCheckpoint[]>([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => { void load(); }, [workspace.id]);
  async function load() { try { setItems((await api<{ checkpoints: WorkspaceCheckpoint[] }>(`/api/workspaces/${workspace.id}/history/checkpoints`)).checkpoints); } catch (loadError) { onError(errorText(loadError)); } }
  async function savePoint() { setBusy(true); try { await api(`/api/workspaces/${workspace.id}/history/checkpoints`, { method: "POST", body: { label: "Manual restore point" } }); await load(); } catch (saveError) { onError(errorText(saveError)); } finally { setBusy(false); } }
  async function restore(item: WorkspaceCheckpoint) { if (!window.confirm(`Restore ${workspace.name} to ${formatDate(item.createdAt)}?`)) return; setBusy(true); try { await api(`/api/workspaces/${workspace.id}/history/checkpoints/${item.checkpointId}/restore`, { method: "POST", body: {} }); await load(); } catch (restoreError) { onError(errorText(restoreError)); } finally { setBusy(false); } }
  return <div className="single-pane history-surface"><div className="library-heading"><div><p className="eyebrow">SPACE HISTORY</p><h1>Restore points</h1><p>Workspace stores restore points separately from this Space.</p></div><button className="primary-button" type="button" onClick={() => void savePoint()} disabled={busy}>{busy ? <Loader2 className="spin" size={15} /> : <Clock3 size={15} />} Save restore point</button></div><div className="history-list">{items.length ? items.map((item) => <article key={item.checkpointId}><div className="history-icon"><History size={17} /></div><div><strong>{item.label || item.reason}</strong><span>{formatDate(item.createdAt)} · {item.fileCount} files</span></div><button className="secondary-button compact" type="button" onClick={() => void restore(item)} disabled={busy}>Restore</button></article>) : <EmptyState icon={<History size={30} />} title="No restore points yet" detail="Create one before a large set of edits when you want a local rollback point." />}</div></div>;
}

function ExtensionDialog({ request, onRespond }: { request: ExtensionUiRequest; onRespond: (value: unknown, cancelled?: boolean) => Promise<void> }) {
  const [value, setValue] = useState(request.initialValue ?? "");
  if (request.method === "notify") return <div className="extension-notice"><Plug size={15} /><span>{request.message}</span><button type="button" onClick={() => void onRespond(true)}><X size={14} /></button></div>;
  return <Modal title={request.title || "Extension request"} subtitle={request.message || "A Pi extension needs your input."} onClose={() => void onRespond(null, true)}>
    <div className="extension-dialog-content">{request.method === "select" ? <div className="select-options">{request.options?.map((option) => <button className="secondary-button" type="button" key={option} onClick={() => void onRespond(option)}>{option}</button>)}</div> : request.method === "confirm" ? <div className="modal-actions"><button className="secondary-button" type="button" onClick={() => void onRespond(false)}>No</button><button className="primary-button" type="button" onClick={() => void onRespond(true)}>Yes</button></div> : <><label>{request.method === "editor" ? "Response" : "Value"}{request.method === "editor" ? <textarea rows={8} value={value} onChange={(event) => setValue(event.target.value)} placeholder={request.placeholder} /> : <input type={request.secret ? "password" : "text"} value={value} onChange={(event) => setValue(event.target.value)} placeholder={request.placeholder} autoComplete={request.secret ? "off" : undefined} />}</label><div className="modal-actions"><button className="secondary-button" type="button" onClick={() => void onRespond(null, true)}>Cancel</button><button className="primary-button" type="button" onClick={() => void onRespond(value)}>Continue</button></div></>}</div>
  </Modal>;
}

function Modal({ title, subtitle, onClose, children }: { title: string; subtitle?: string; onClose: () => void; children: ReactNode }) {
  return <div className="modal-backdrop" role="presentation" onMouseDown={onClose}><section className="modal-card" role="dialog" aria-modal="true" aria-label={title} onMouseDown={(event) => event.stopPropagation()}><header><div><h2>{title}</h2>{subtitle ? <p>{subtitle}</p> : null}</div><button className="icon-button" type="button" onClick={onClose} aria-label="Close"><X size={17} /></button></header><div className="modal-body">{children}</div></section></div>;
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
