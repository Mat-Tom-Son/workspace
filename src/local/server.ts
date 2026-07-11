import { createHash, randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { createReadStream, existsSync, readFileSync, watch } from "node:fs";
import { stat } from "node:fs/promises";
import { basename, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  PiConversationClient,
  isPiTurnCancelledError,
  type PiChatEvent,
  type PiRuntimeProvider,
} from "./agent/pi-client.js";
import {
  RoutedPiExtensionUiBridge,
  type PiExtensionUiEvent,
  type PiExtensionUiRequest,
  type PiExtensionUiSettled,
} from "./agent/extension-ui.js";
import { appendMessage, createConversation, listConversations, readConversation, renameConversation } from "./agent/chat-store.js";
import { importPiSkillBundle } from "./agent/skill-import.js";
import { loadAgentSkillCatalog, type PiCatalogSource, type PiResourceCatalog } from "./agent/skill-catalog.js";
import {
  getPiSetupStatus,
  installPiPackage,
  listPiPackages,
  listPiModels,
  loginPiOAuth,
  savePiApiKey,
  setPiDefaultModel,
  setPiProjectTrust,
  type PiOAuthHooks,
  type PiSetupStatus,
} from "./agent/pi-runtime-config.js";
import { loadConversationContextAttachmentsForTurn, previewConversationContextAttachment } from "./conversation-context.js";
import {
  createWorkspaceCheckpoint,
  createWorkspaceMutationCheckpoint,
  discardWorkspaceCheckpoint,
  listFileVersions,
  listWorkspaceCheckpoints,
  restoreFileVersion,
  restoreWorkspaceCheckpoint,
} from "./history.js";
import {
  copyResourcesToWorkspace,
  createResourceFolder,
  listResourceTree,
  uploadResourceFiles,
} from "./resources.js";
import { configureWorkspaceStateRoot } from "./state-paths.js";
import { isAlwaysHiddenWorkspaceEntry, isWorkspaceIgnored, readWorkspaceIgnoreState, setWorkspaceIgnoreState } from "./workspace-ignore.js";
import {
  createManagedWorkspace,
  createWorkspaceFolder,
  createWorkspaceTextFile,
  deleteWorkspaceEntry,
  findExistingWorkspaceFilePaths,
  getWorkspace,
  getWorkspaceEntryInfo,
  listWorkspaces,
  moveWorkspaceEntry,
  readWorkspaceTextFile,
  renameWorkspaceEntry,
  registerLinkedWorkspace,
  removeWorkspace,
  renameWorkspace,
  resolveWorkspacePath,
  scanWorkspaceTree,
  writeWorkspaceTextFile,
  writeUploadedFiles,
} from "./workspace.js";

export interface LocalFolderGrantProvider {
  consumeLocalFolderGrant(input: { rootPath: string; grantId: string }): boolean | Promise<boolean>;
}

export interface LocalApiOptions {
  host?: "127.0.0.1";
  port?: number;
  appMode?: "dev" | "desktop";
  /** Root used only for managed workspace content. */
  workspaceBase?: string;
  /** Workspace app data: registry, chats, Pi sessions, resources, history. */
  stateBase?: string;
  allowedOrigins?: string[];
  sessionToken?: string;
  piRuntimeProvider?: PiRuntimeProvider;
  extensionUiBridge?: RoutedPiExtensionUiBridge;
  piOAuthHooks?: PiOAuthHooks;
  localFolderGrantProvider?: LocalFolderGrantProvider;
  maxBodyBytes?: number;
  loadEnv?: boolean;
  onAgentTurnActivity?: (activeTurns: number) => void;
  onHistoryCheckpoint?: (event: {
    workspaceId: string;
    conversationId: string;
    reason: "pre_turn" | "post_turn";
    checkpointId: string;
    skippedLargeFiles: string[];
  }) => void;
}

export interface LocalApiHandle {
  origin: string;
  port: number;
  close: () => Promise<void>;
}

interface LocalApiState {
  appMode: "dev" | "desktop";
  workspaceBase?: string;
  allowedOrigins: string[];
  sessionToken?: string;
  maxBodyBytes: number;
  runtimeProvider: PiRuntimeProvider;
  extensionUi: RoutedPiExtensionUiBridge;
  piOAuthHooks?: PiOAuthHooks;
  localFolderGrantProvider?: LocalFolderGrantProvider;
  chatStreams: Map<string, Set<ServerResponse>>;
  clients: Map<string, PiConversationClient>;
  runningTurns: Set<string>;
  extensionRequests: Map<string, PiExtensionUiRequest>;
  fileStreams: Set<() => void>;
  activeTurns: number;
  onAgentTurnActivity?: (activeTurns: number) => void;
  onHistoryCheckpoint?: LocalApiOptions["onHistoryCheckpoint"];
}

interface MultipartFile {
  fieldName: string;
  fileName: string;
  contentType: string;
  data: Buffer;
}

interface MultipartBody {
  fields: Map<string, string>;
  files: MultipartFile[];
}

const repoRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));

export async function startLocalApi(options: LocalApiOptions = {}): Promise<LocalApiHandle> {
  if (options.loadEnv !== false) loadLocalEnv(join(repoRoot, ".env"));
  configureWorkspaceStateRoot(options.stateBase);
  const host = options.host ?? "127.0.0.1";
  const requestedPort = options.port ?? numberFromEnv("WORKSPACE_LOCAL_API_PORT", 4327);
  const extensionUi = options.extensionUiBridge ?? new RoutedPiExtensionUiBridge();
  const runtimeProvider: PiRuntimeProvider = {
    async resolveRuntime(workspaceRoot) {
      const runtime = await options.piRuntimeProvider?.resolveRuntime(workspaceRoot) ?? {};
      return { ...runtime, extensionUi };
    },
  };
  const state: LocalApiState = {
    appMode: options.appMode ?? "dev",
    workspaceBase: options.workspaceBase ? resolve(options.workspaceBase) : undefined,
    allowedOrigins: options.allowedOrigins ?? ["http://127.0.0.1:5173", "http://localhost:5173"],
    sessionToken: options.sessionToken,
    maxBodyBytes: options.maxBodyBytes ?? numberFromEnv("WORKSPACE_LOCAL_MAX_BODY_BYTES", 100 * 1024 * 1024),
    runtimeProvider,
    extensionUi,
    piOAuthHooks: options.piOAuthHooks,
    localFolderGrantProvider: options.localFolderGrantProvider,
    chatStreams: new Map(),
    clients: new Map(),
    runningTurns: new Set(),
    extensionRequests: new Map(),
    fileStreams: new Set(),
    activeTurns: 0,
    onAgentTurnActivity: options.onAgentTurnActivity,
    onHistoryCheckpoint: options.onHistoryCheckpoint,
  };

  const requestListener = (request: PiExtensionUiRequest) => routeExtensionRequest(state, request);
  const eventListener = (event: PiExtensionUiEvent) => routeExtensionEvent(state, event);
  const settledListener = (event: PiExtensionUiSettled) => state.extensionRequests.delete(event.id);
  extensionUi.on("request", requestListener);
  extensionUi.on("event", eventListener);
  extensionUi.on("settled", settledListener);

  const server = createServer(async (request, response) => {
    try {
      await handleRequest(state, request, response);
    } catch (error) {
      sendError(response, error);
    }
  });
  await listen(server, requestedPort, host);
  const address = server.address() as AddressInfo;
  return {
    origin: `http://${host}:${address.port}`,
    port: address.port,
    close: async () => {
      extensionUi.off("request", requestListener);
      extensionUi.off("event", eventListener);
      extensionUi.off("settled", settledListener);
      extensionUi.cancelAll();
      for (const streams of state.chatStreams.values()) for (const response of streams) response.end();
      for (const close of [...state.fileStreams]) close();
      for (const client of state.clients.values()) await client.stop().catch(() => undefined);
      await closeServer(server);
    },
  };
}

async function handleRequest(state: LocalApiState, req: IncomingMessage, res: ServerResponse): Promise<void> {
  setCorsHeaders(state, req, res);
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }
  authorize(state, req);
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  const method = req.method ?? "GET";

  if (method === "GET" && url.pathname === "/api/health") {
    sendJson(res, { ok: true, app: "Workspace", mode: state.appMode });
    return;
  }

  if (method === "GET" && url.pathname === "/api/bootstrap") {
    const workspaces = await listWorkspaces();
    const agent = workspaces[0] ? await safeAgentStatus(workspaces[0].rootPath, state.runtimeProvider) : emptyAgentStatus();
    sendJson(res, { workspaces, agent });
    return;
  }

  if (method === "POST" && url.pathname === "/api/workspaces") {
    const body = await readJsonBody<{ name?: string }>(state, req);
    const workspace = await createManagedWorkspace(body.name ?? "Personal Space", state.workspaceBase);
    sendJson(res, { workspace }, 201);
    return;
  }

  if (method === "POST" && url.pathname === "/api/workspaces/local-folder") {
    const body = await readJsonBody<{ rootPath?: string; folderGrantId?: string; providerHint?: "google-drive" }>(state, req);
    if (!body.rootPath?.trim()) throw badRequest("Choose a local folder to turn into a Space.");
    if (state.localFolderGrantProvider) {
      if (!body.folderGrantId || !await state.localFolderGrantProvider.consumeLocalFolderGrant({ rootPath: body.rootPath, grantId: body.folderGrantId })) {
        throw forbidden("The folder selection expired. Choose the folder again to create the Space.");
      }
    } else if (state.appMode === "desktop") {
      throw forbidden("A folder must be selected in the desktop app before it can become a Space.");
    }
    const workspace = await registerLinkedWorkspace(body.rootPath, body.providerHint);
    sendJson(res, { workspace }, 201);
    return;
  }

  const workspaceMatch = match(url.pathname, /^\/api\/workspaces\/([^/]+)$/);
  if (workspaceMatch && (method === "PUT" || method === "PATCH")) {
    const body = await readJsonBody<{ name?: string }>(state, req);
    if (!body.name?.trim()) throw badRequest("A Space name is required.");
    sendJson(res, { workspace: await renameWorkspace(workspaceMatch[1], body.name) });
    return;
  }
  if (workspaceMatch && method === "DELETE") {
    const workspace = await getWorkspace(workspaceMatch[1]);
    await invalidateWorkspaceClients(state, workspace.id);
    closeWorkspaceStreams(state, workspace.id);
    for (const request of [...state.extensionRequests.values()]) {
      if (request.workspaceRoot !== workspace.rootPath) continue;
      state.extensionUi.cancel(request.id);
      state.extensionRequests.delete(request.id);
    }
    sendJson(res, await removeWorkspace(workspace.id, state.workspaceBase));
    return;
  }

  const treeMatch = match(url.pathname, /^\/api\/workspaces\/([^/]+)\/tree$/);
  if (method === "GET" && treeMatch) {
    const workspace = await getWorkspace(treeMatch[1]);
    const maxDepthValue = Number(url.searchParams.get("maxDepth") ?? 20);
    const maxDepth = Number.isFinite(maxDepthValue) ? Math.min(Math.max(Math.floor(maxDepthValue), 0), 50) : 20;
    sendJson(res, {
      tree: await scanWorkspaceTree(
        workspace.rootPath,
        maxDepth,
        url.searchParams.get("path") ?? "",
        { includeIgnored: url.searchParams.get("includeIgnored") !== "0" },
      ),
    });
    return;
  }

  const fileMatch = match(url.pathname, /^\/api\/workspaces\/([^/]+)\/file$/);
  if (method === "GET" && fileMatch) {
    const workspace = await getWorkspace(fileMatch[1]);
    const path = url.searchParams.get("path") ?? "";
    if (!path) throw badRequest("File path is required.");
    sendJson(res, await readWorkspaceTextFile(workspace.rootPath, path));
    return;
  }
  if (method === "PUT" && fileMatch) {
    const workspace = await getWorkspace(fileMatch[1]);
    const body = await readJsonBody<{ path?: string; text?: string }>(state, req);
    if (!body.path?.trim() || typeof body.text !== "string") throw badRequest("A file path and text are required.");
    const safety = await createWorkspaceMutationCheckpoint(workspace.rootPath, {
      paths: [body.path],
      reason: "pre_edit",
      label: `Before editing ${body.path}`,
    });
    const file = await runWithHistorySafety(workspace.rootPath, safety.checkpointId, () => writeWorkspaceTextFile(workspace.rootPath, body.path!, body.text!));
    sendJson(res, { file, safetyCheckpointId: safety.checkpointId, historySkippedPaths: safety.skippedLargeFiles });
    return;
  }

  const fileInfoMatch = match(url.pathname, /^\/api\/workspaces\/([^/]+)\/file-info$/);
  if (method === "GET" && fileInfoMatch) {
    const workspace = await getWorkspace(fileInfoMatch[1]);
    const path = url.searchParams.get("path") ?? "";
    if (!path) throw badRequest("Space item path is required.");
    sendJson(res, await getWorkspaceEntryInfo(workspace.rootPath, path));
    return;
  }

  const pathsExistMatch = match(url.pathname, /^\/api\/workspaces\/([^/]+)\/paths-exist$/);
  if (method === "POST" && pathsExistMatch) {
    const workspace = await getWorkspace(pathsExistMatch[1]);
    const body = await readJsonBody<{ paths?: unknown }>(state, req);
    if (!Array.isArray(body.paths) || body.paths.some((path) => typeof path !== "string")) {
      throw badRequest("Space paths must be an array of strings.");
    }
    sendJson(res, { existing: await findExistingWorkspaceFilePaths(workspace.rootPath, body.paths) });
    return;
  }

  const rawFileMatch = match(url.pathname, /^\/api\/workspaces\/([^/]+)\/raw-file$/);
  if (method === "GET" && rawFileMatch) {
    const workspace = await getWorkspace(rawFileMatch[1]);
    const path = url.searchParams.get("path") ?? "";
    if (!path) throw badRequest("File path is required.");
    await sendWorkspaceRawFile(res, workspace.rootPath, path);
    return;
  }

  const moveMatch = match(url.pathname, /^\/api\/workspaces\/([^/]+)\/move-local-entry$/);
  if (method === "POST" && moveMatch) {
    const workspace = await getWorkspace(moveMatch[1]);
    const body = await readJsonBody<{ sourcePath?: string; targetFolderPath?: string }>(state, req);
    if (!body.sourcePath?.trim()) throw badRequest("Select a file or folder to move.");
    const moveSource = normalizeWorkspaceRelativePath(body.sourcePath);
    const moveTargetFolder = normalizeWorkspaceRelativePath(body.targetFolderPath ?? "");
    const moveDestination = [moveTargetFolder, basename(moveSource)].filter(Boolean).join("/");
    const safety = await createWorkspaceMutationCheckpoint(workspace.rootPath, {
      movesOnRestore: [{ fromPath: moveDestination, toPath: moveSource }],
      reason: "pre_move",
      label: `Before moving ${body.sourcePath}`,
    });
    const moved = await runWithHistorySafety(workspace.rootPath, safety.checkpointId, () => moveWorkspaceEntry(workspace.rootPath, {
      sourcePath: moveSource,
      targetFolderPath: body.targetFolderPath ?? "",
    }));
    sendJson(res, { moved, safetyCheckpointId: safety.checkpointId, historySkippedPaths: safety.skippedLargeFiles });
    return;
  }

  const renameMatch = match(url.pathname, /^\/api\/workspaces\/([^/]+)\/rename-local-entry$/);
  if (method === "POST" && renameMatch) {
    const workspace = await getWorkspace(renameMatch[1]);
    const body = await readJsonBody<{ path?: string; newName?: string }>(state, req);
    if (!body.path?.trim() || !body.newName?.trim()) throw badRequest("A Space item and new name are required.");
    const renameSource = normalizeWorkspaceRelativePath(body.path);
    const renameParent = renameSource.includes("/") ? renameSource.slice(0, renameSource.lastIndexOf("/")) : "";
    const renameDestination = [renameParent, body.newName].filter(Boolean).join("/");
    const safety = await createWorkspaceMutationCheckpoint(workspace.rootPath, {
      movesOnRestore: [{ fromPath: renameDestination, toPath: renameSource }],
      reason: "pre_rename",
      label: `Before renaming ${body.path}`,
    });
    const renamed = await runWithHistorySafety(workspace.rootPath, safety.checkpointId, () => renameWorkspaceEntry(workspace.rootPath, { path: body.path!, newName: body.newName! }));
    sendJson(res, { renamed, safetyCheckpointId: safety.checkpointId, historySkippedPaths: safety.skippedLargeFiles });
    return;
  }

  const foldersMatch = match(url.pathname, /^\/api\/workspaces\/([^/]+)\/folders$/);
  if (method === "POST" && foldersMatch) {
    const workspace = await getWorkspace(foldersMatch[1]);
    const body = await readJsonBody<{ parentPath?: string; name?: string }>(state, req);
    if (!body.name?.trim()) throw badRequest("A folder name is required.");
    const folderTarget = [normalizeWorkspaceRelativePath(body.parentPath ?? ""), body.name].filter(Boolean).join("/");
    const safety = await createWorkspaceMutationCheckpoint(workspace.rootPath, {
      deleteOnRestore: [folderTarget],
      reason: "pre_create",
      label: `Before creating ${body.name}`,
    });
    const folder = await runWithHistorySafety(workspace.rootPath, safety.checkpointId, () => createWorkspaceFolder(workspace.rootPath, body.parentPath ?? "", body.name!));
    sendJson(res, { folder, safetyCheckpointId: safety.checkpointId, historySkippedPaths: safety.skippedLargeFiles }, 201);
    return;
  }

  const filesMatch = match(url.pathname, /^\/api\/workspaces\/([^/]+)\/files$/);
  if (method === "POST" && filesMatch) {
    const workspace = await getWorkspace(filesMatch[1]);
    const body = await readJsonBody<{ parentPath?: string; name?: string; text?: string }>(state, req);
    if (!body.name?.trim()) throw badRequest("A file name is required.");
    const fileTarget = [normalizeWorkspaceRelativePath(body.parentPath ?? ""), body.name].filter(Boolean).join("/");
    const safety = await createWorkspaceMutationCheckpoint(workspace.rootPath, {
      deleteOnRestore: [fileTarget],
      reason: "pre_create",
      label: `Before creating ${body.name}`,
    });
    const file = await runWithHistorySafety(workspace.rootPath, safety.checkpointId, () => createWorkspaceTextFile(workspace.rootPath, body.parentPath ?? "", body.name!, body.text ?? ""));
    sendJson(res, { file, safetyCheckpointId: safety.checkpointId, historySkippedPaths: safety.skippedLargeFiles }, 201);
    return;
  }

  const deleteMatch = match(url.pathname, /^\/api\/workspaces\/([^/]+)\/local-file$/);
  if (method === "DELETE" && deleteMatch) {
    const workspace = await getWorkspace(deleteMatch[1]);
    const body = await readJsonBody<{ path?: string }>(state, req);
    if (!body.path?.trim()) throw badRequest("Select a file or folder to delete.");
    const safety = await createWorkspaceMutationCheckpoint(workspace.rootPath, {
      paths: [body.path],
      reason: "pre_delete",
      label: `Before deleting ${body.path}`,
    });
    const deleted = await runWithHistorySafety(workspace.rootPath, safety.checkpointId, () => deleteWorkspaceEntry(workspace.rootPath, body.path!));
    sendJson(res, { ...deleted, safetyCheckpointId: safety.checkpointId, historySkippedPaths: safety.skippedLargeFiles });
    return;
  }

  const ignoreMatch = match(url.pathname, /^\/api\/workspaces\/([^/]+)\/ignore-paths$/);
  if (method === "GET" && ignoreMatch) {
    const workspace = await getWorkspace(ignoreMatch[1]);
    sendJson(res, await readWorkspaceIgnoreState(workspace.rootPath));
    return;
  }
  if (method === "POST" && ignoreMatch) {
    const workspace = await getWorkspace(ignoreMatch[1]);
    const body = await readJsonBody<{ paths?: unknown; ignored?: unknown }>(state, req);
    if (!Array.isArray(body.paths) || body.paths.some((path) => typeof path !== "string") || typeof body.ignored !== "boolean") {
      throw badRequest("Space paths and an ignore decision are required.");
    }
    sendJson(res, await setWorkspaceIgnoreState(workspace.rootPath, body.paths, body.ignored));
    return;
  }

  const fileEventsMatch = match(url.pathname, /^\/api\/workspaces\/([^/]+)\/file-events$/);
  if (method === "GET" && fileEventsMatch) {
    const workspace = await getWorkspace(fileEventsMatch[1]);
    await openWorkspaceFileStream(state, req, res, workspace.rootPath);
    return;
  }

  const uploadMatch = match(url.pathname, /^\/api\/workspaces\/([^/]+)\/upload-local-files$/);
  if (method === "POST" && uploadMatch) {
    const workspace = await getWorkspace(uploadMatch[1]);
    const multipart = await readMultipartBody(state, req);
    const relativePaths = parseRelativePaths(multipart.fields.get("relativePaths"), multipart.files.length);
    const uploaded = await writeUploadedFiles(
      workspace.rootPath,
      multipart.fields.get("targetFolderPath") ?? "",
      multipart.files.map((file, index) => ({ fileName: file.fileName, relativePath: relativePaths[index], data: file.data })),
    );
    sendJson(res, { uploaded }, 201);
    return;
  }

  if (method === "GET" && url.pathname === "/api/resources/tree") {
    sendJson(res, { tree: await listResourceTree() });
    return;
  }
  if (method === "POST" && url.pathname === "/api/resources/folders") {
    const body = await readJsonBody<{ parentPath?: string; name?: string }>(state, req);
    if (!body.name) throw badRequest("Folder name is required.");
    sendJson(res, { folder: await createResourceFolder(body.parentPath ?? "", body.name) }, 201);
    return;
  }
  if (method === "POST" && url.pathname === "/api/resources/upload") {
    const multipart = await readMultipartBody(state, req);
    const relativePaths = parseRelativePaths(multipart.fields.get("relativePaths"), multipart.files.length);
    const uploaded = await uploadResourceFiles(
      multipart.fields.get("targetFolderPath") ?? "",
      multipart.files.map((file, index) => ({ fileName: file.fileName, relativePath: relativePaths[index], data: file.data })),
    );
    sendJson(res, { uploaded }, 201);
    return;
  }
  if (method === "POST" && url.pathname === "/api/resources/copy-to-workspace") {
    const body = await readJsonBody<{ workspaceId?: string; paths?: string[]; targetFolder?: string }>(state, req);
    if (!body.workspaceId || !Array.isArray(body.paths)) throw badRequest("A Space and Library items are required.");
    const workspace = await getWorkspace(body.workspaceId);
    const copied = await copyResourcesToWorkspace(workspace.rootPath, body.paths, body.targetFolder ?? "From Library");
    sendJson(res, { copied });
    return;
  }

  const checkpointCollectionMatch = match(url.pathname, /^\/api\/workspaces\/([^/]+)\/history\/checkpoints$/);
  if (checkpointCollectionMatch && method === "GET") {
    const workspace = await getWorkspace(checkpointCollectionMatch[1]);
    sendJson(res, { checkpoints: await listWorkspaceCheckpoints(workspace.rootPath) });
    return;
  }
  if (checkpointCollectionMatch && method === "POST") {
    const workspace = await getWorkspace(checkpointCollectionMatch[1]);
    const body = await readJsonBody<{ label?: string }>(state, req);
    sendJson(res, { checkpoint: await createWorkspaceCheckpoint(workspace.rootPath, { label: body.label, reason: "manual" }) }, 201);
    return;
  }
  const checkpointRestoreMatch = match(url.pathname, /^\/api\/workspaces\/([^/]+)\/history\/checkpoints\/([^/]+)\/restore$/);
  if (method === "POST" && checkpointRestoreMatch) {
    const workspace = await getWorkspace(checkpointRestoreMatch[1]);
    sendJson(res, await restoreWorkspaceCheckpoint(workspace.rootPath, checkpointRestoreMatch[2]));
    return;
  }

  const fileVersionsMatch = match(url.pathname, /^\/api\/workspaces\/([^/]+)\/history\/file-versions$/);
  if (method === "GET" && fileVersionsMatch) {
    const workspace = await getWorkspace(fileVersionsMatch[1]);
    const path = url.searchParams.get("path")?.trim();
    if (!path) throw badRequest("A Space-relative file path is required.");
    sendJson(res, { path, versions: await listFileVersions(workspace.rootPath, path) });
    return;
  }
  if (method === "POST" && fileVersionsMatch) {
    const workspace = await getWorkspace(fileVersionsMatch[1]);
    const body = await readJsonBody<{ path?: string; hashSha256?: string }>(state, req);
    if (!body.path?.trim() || !body.hashSha256?.trim()) throw badRequest("A file path and version hash are required.");
    sendJson(res, { result: await restoreFileVersion(workspace.rootPath, body.path, body.hashSha256) });
    return;
  }

  if (method === "GET" && url.pathname === "/api/agent/models") {
    const workspaceId = url.searchParams.get("workspaceId");
    if (!workspaceId) throw badRequest("Space id is required.");
    const workspace = await getWorkspace(workspaceId);
    const models = await listPiModels(workspace.rootPath, state.runtimeProvider);
    sendJson(res, {
      models: models.map((model) => ({
        ...model,
        oauthSupported: model.oauthSupported && Boolean(state.piOAuthHooks),
      })),
    });
    return;
  }
  if (method === "GET" && url.pathname === "/api/agent/status") {
    const workspaceId = url.searchParams.get("workspaceId");
    if (!workspaceId) throw badRequest("Space id is required.");
    const workspace = await getWorkspace(workspaceId);
    sendJson(res, { status: await safeAgentStatus(workspace.rootPath, state.runtimeProvider) });
    return;
  }
  if (method === "POST" && url.pathname === "/api/agent/configure") {
    const body = await readJsonBody<{ workspaceId?: string; provider?: string; model?: string; apiKey?: string }>(state, req);
    const workspace = await configuredWorkspace(body.workspaceId, body.provider, body.model);
    const selected = (await listPiModels(workspace.rootPath, state.runtimeProvider))
      .find((model) => model.provider === body.provider && model.id === body.model);
    if (!selected) throw badRequest("The selected Pi model is not available in this Space.");
    if (!body.apiKey?.trim() && !selected.authConfigured) {
      throw badRequest(`Enter an API key for ${selected.providerName}.`);
    }
    if (body.apiKey?.trim()) {
      await savePiApiKey(workspace.rootPath, body.provider!, body.apiKey, { runtimeProvider: state.runtimeProvider });
    }
    await setPiDefaultModel(workspace.rootPath, { provider: body.provider!, id: body.model! }, state.runtimeProvider);
    await invalidateAllClients(state);
    sendJson(res, { status: normalizeStatus(await getPiSetupStatus(workspace.rootPath, state.runtimeProvider)) });
    return;
  }
  if (method === "POST" && url.pathname === "/api/agent/oauth") {
    if (!state.piOAuthHooks) throw unavailable("OAuth sign-in requires the Workspace desktop integration. You can use an API key for this provider instead.");
    const body = await readJsonBody<{ workspaceId?: string; provider?: string; model?: string }>(state, req);
    const workspace = await configuredWorkspace(body.workspaceId, body.provider, body.model);
    await loginPiOAuth(workspace.rootPath, body.provider!, state.piOAuthHooks, state.runtimeProvider);
    await setPiDefaultModel(workspace.rootPath, { provider: body.provider!, id: body.model! }, state.runtimeProvider);
    await invalidateAllClients(state);
    sendJson(res, { status: normalizeStatus(await getPiSetupStatus(workspace.rootPath, state.runtimeProvider)) });
    return;
  }
  if (method === "POST" && url.pathname === "/api/agent/packages/install") {
    const body = await readJsonBody<{ workspaceId?: string; source?: string; scope?: "global" | "project" }>(state, req);
    if (!body.workspaceId || !body.source?.trim()) throw badRequest("A Space and package source are required.");
    const workspace = await getWorkspace(body.workspaceId);
    await installPiPackage(workspace.rootPath, body.source, {
      scope: body.scope === "project" ? "project" : "user",
      runtimeProvider: state.runtimeProvider,
    });
    if (body.scope === "project") await invalidateWorkspaceClients(state, workspace.id);
    else await invalidateAllClients(state);
    sendJson(res, { installed: true }, 201);
    return;
  }
  if (method === "POST" && url.pathname === "/api/agent/skills/import") {
    const multipart = await readMultipartBody(state, req);
    const workspaceId = multipart.fields.get("workspaceId");
    if (!workspaceId || !multipart.files.length) throw badRequest("A Space and Skill files are required.");
    const workspace = await getWorkspace(workspaceId);
    const scope = multipart.fields.get("scope") === "project" ? "project" : "user";
    const imported = [];
    for (const file of multipart.files) {
      imported.push(await importPiSkillBundle(workspace.rootPath, { fileName: file.fileName, bytes: file.data, scope }, state.runtimeProvider));
    }
    if (scope === "project") await invalidateWorkspaceClients(state, workspace.id);
    else await invalidateAllClients(state);
    sendJson(res, { imported }, 201);
    return;
  }

  const catalogMatch = match(url.pathname, /^\/api\/workspaces\/([^/]+)\/agent\/catalog$/);
  if (method === "GET" && catalogMatch) {
    const workspace = await getWorkspace(catalogMatch[1]);
    const [catalog, packages] = await Promise.all([
      loadAgentSkillCatalog(workspace.rootPath, state.runtimeProvider),
      listPiPackages(workspace.rootPath, state.runtimeProvider),
    ]);
    sendJson(res, simplifyCatalog(catalog, packages));
    return;
  }
  const trustMatch = match(url.pathname, /^\/api\/workspaces\/([^/]+)\/agent\/trust$/);
  if (method === "POST" && trustMatch) {
    const workspace = await getWorkspace(trustMatch[1]);
    const body = await readJsonBody<{ trusted?: boolean }>(state, req);
    if (typeof body.trusted !== "boolean") throw badRequest("Trust decision is required.");
    await setPiProjectTrust(workspace.rootPath, body.trusted, state.runtimeProvider);
    await invalidateWorkspaceClients(state, workspace.id);
    const [catalog, packages] = await Promise.all([
      loadAgentSkillCatalog(workspace.rootPath, state.runtimeProvider),
      listPiPackages(workspace.rootPath, state.runtimeProvider),
    ]);
    sendJson(res, { catalog: simplifyCatalog(catalog, packages) });
    return;
  }

  const conversationsMatch = match(url.pathname, /^\/api\/workspaces\/([^/]+)\/conversations$/);
  if (conversationsMatch && method === "GET") {
    const workspace = await getWorkspace(conversationsMatch[1]);
    sendJson(res, { conversations: await listConversations(workspace.rootPath) });
    return;
  }
  if (conversationsMatch && method === "POST") {
    const workspace = await getWorkspace(conversationsMatch[1]);
    sendJson(res, { conversation: await createConversation(workspace.rootPath) }, 201);
    return;
  }

  const conversationMatch = match(url.pathname, /^\/api\/workspaces\/([^/]+)\/conversations\/([^/]+)$/);
  if (conversationMatch && (method === "PUT" || method === "PATCH")) {
    const workspace = await getWorkspace(conversationMatch[1]);
    const body = await readJsonBody<{ title?: string }>(state, req);
    const conversation = await renameConversation(workspace.rootPath, conversationMatch[2], body.title ?? "");
    state.clients.get(clientKey(workspace.id, conversationMatch[2]))?.setSessionName(conversation.title);
    sendJson(res, { conversation });
    return;
  }

  const contextAttachmentMatch = match(url.pathname, /^\/api\/workspaces\/([^/]+)\/context-attachments$/);
  if (contextAttachmentMatch && method === "POST") {
    const workspace = await getWorkspace(contextAttachmentMatch[1]);
    const body = await readJsonBody<{ path?: string }>(state, req);
    if (!body.path?.trim()) throw badRequest("A file path is required.");
    sendJson(res, { attachment: await previewConversationContextAttachment(workspace.rootPath, { path: body.path }) }, 201);
    return;
  }

  const eventsMatch = match(url.pathname, /^\/api\/workspaces\/([^/]+)\/conversations\/([^/]+)\/events$/);
  if (method === "GET" && eventsMatch) {
    await getWorkspace(eventsMatch[1]);
    openChatStream(state, req, res, streamKey(eventsMatch[1], eventsMatch[2]), eventsMatch[2]);
    return;
  }
  const messagesPostMatch = match(url.pathname, /^\/api\/workspaces\/([^/]+)\/conversations\/([^/]+)\/messages$/);
  if (method === "POST" && messagesPostMatch) {
    const workspace = await getWorkspace(messagesPostMatch[1]);
    const conversationId = messagesPostMatch[2];
    const turnKey = clientKey(workspace.id, conversationId);
    const body = await readJsonBody<{ content?: string; contextPaths?: string[]; selectedPath?: string | null }>(state, req);
    const content = body.content?.trim();
    if (!content) throw badRequest("Message content is required.");
    const selectedPath = normalizeSelectedPath(workspace.rootPath, body.selectedPath);
    const contextPaths = normalizeContextPaths(workspace.rootPath, body.contextPaths);
    const existing = await readConversation(workspace.rootPath, conversationId);
    if (!existing.length) throw notFound("Conversation not found.");
    if (state.runningTurns.has(turnKey)) throw httpError(409, "Wait for the current agent turn to finish.");
    state.runningTurns.add(turnKey);
    broadcast(state, turnKey, turnStateEvent(conversationId, true));
    const message = { id: randomUUID(), role: "user" as const, content, createdAt: new Date().toISOString() };
    try {
      await appendMessage(workspace.rootPath, conversationId, message);
    } catch (error) {
      state.runningTurns.delete(turnKey);
      broadcast(state, turnKey, turnStateEvent(conversationId, false));
      throw error;
    }
    void runAgentTurn(state, workspace.id, workspace.rootPath, conversationId, content, contextPaths, selectedPath);
    sendJson(res, { accepted: true, message }, 202);
    return;
  }
  const abortMatch = match(url.pathname, /^\/api\/workspaces\/([^/]+)\/conversations\/([^/]+)\/abort$/);
  if (method === "POST" && abortMatch) {
    const workspace = await getWorkspace(abortMatch[1]);
    const key = clientKey(workspace.id, abortMatch[2]);
    const client = state.clients.get(key);
    sendJson(res, { aborted: client ? await client.abort() : false });
    return;
  }

  const compactMatch = match(url.pathname, /^\/api\/workspaces\/([^/]+)\/conversations\/([^/]+)\/compact$/);
  if (method === "POST" && compactMatch) {
    const workspace = await getWorkspace(compactMatch[1]);
    if (!(await readConversation(workspace.rootPath, compactMatch[2])).length) throw notFound("Conversation not found.");
    if (state.runningTurns.has(clientKey(workspace.id, compactMatch[2]))) throw httpError(409, "Wait for the current agent turn to finish.");
    const body = await readJsonBody<{ customInstructions?: string }>(state, req);
    const client = await getClient(state, workspace.id, workspace.rootPath, compactMatch[2]);
    await client.compact(body.customInstructions?.trim() || undefined);
    broadcast(state, streamKey(workspace.id, compactMatch[2]), { type: "done", conversationId: compactMatch[2] });
    sendJson(res, { compacted: true });
    return;
  }
  const messagesGetMatch = match(url.pathname, /^\/api\/workspaces\/([^/]+)\/conversations\/([^/]+)$/);
  if (method === "GET" && messagesGetMatch) {
    const workspace = await getWorkspace(messagesGetMatch[1]);
    sendJson(res, { messages: await readConversation(workspace.rootPath, messagesGetMatch[2]) });
    return;
  }
  const extensionResponseMatch = match(url.pathname, /^\/api\/workspaces\/([^/]+)\/conversations\/([^/]+)\/extension-ui\/([^/]+)$/);
  if (method === "POST" && extensionResponseMatch) {
    const workspace = await getWorkspace(extensionResponseMatch[1]);
    const request = state.extensionRequests.get(extensionResponseMatch[3]);
    if (!request || request.workspaceRoot !== workspace.rootPath || request.conversationId !== extensionResponseMatch[2]) {
      throw notFound("Extension request not found or already completed.");
    }
    const body = await readJsonBody<{ value?: unknown; cancelled?: boolean }>(state, req);
    const accepted = body.cancelled
      ? state.extensionUi.cancel(request.id)
      : state.extensionUi.respond(request.id, extensionResponse(request, body.value));
    if (accepted) state.extensionRequests.delete(request.id);
    sendJson(res, { accepted });
    return;
  }

  throw notFound("Not found.");
}

async function runAgentTurn(
  state: LocalApiState,
  workspaceId: string,
  workspaceRoot: string,
  conversationId: string,
  content: string,
  contextPaths: string[],
  selectedPath: string | null,
): Promise<void> {
  const key = clientKey(workspaceId, conversationId);
  let client: PiConversationClient | null = null;
  let promptStarted = false;
  changeTurnCount(state, 1);
  try {
    client = await getClient(state, workspaceId, workspaceRoot, conversationId);
    const contextAttachments = await loadConversationContextAttachmentsForTurn(workspaceRoot, contextPaths);
    await captureTurnCheckpointSafe(state, workspaceId, workspaceRoot, conversationId, "pre_turn");
    promptStarted = true;
    const finalText = await client.prompt(content, { contextAttachments, selectedPath });
    await appendMessage(workspaceRoot, conversationId, {
      id: randomUUID(),
      role: "assistant",
      content: finalText,
      createdAt: new Date().toISOString(),
    });
    broadcast(state, streamKey(workspaceId, conversationId), { type: "done", conversationId });
  } catch (error) {
    const message = isPiTurnCancelledError(error) ? "Agent turn cancelled." : errorMessage(error);
    broadcast(state, streamKey(workspaceId, conversationId), { type: "error", conversationId, message });
    await client?.stop().catch(() => undefined);
    state.clients.delete(key);
  } finally {
    if (promptStarted) await captureTurnCheckpointSafe(state, workspaceId, workspaceRoot, conversationId, "post_turn");
    state.runningTurns.delete(key);
    broadcast(state, key, turnStateEvent(conversationId, false));
    changeTurnCount(state, -1);
  }
}

async function getClient(
  state: LocalApiState,
  workspaceId: string,
  workspaceRoot: string,
  conversationId: string,
): Promise<PiConversationClient> {
  const key = clientKey(workspaceId, conversationId);
  const existing = state.clients.get(key);
  if (existing) return existing;
  const client = new PiConversationClient(conversationId, workspaceRoot, state.runtimeProvider);
  client.on("event", (event: PiChatEvent) => {
    const { raw: _raw, ...safeEvent } = event;
    broadcast(state, streamKey(workspaceId, conversationId), safeEvent);
  });
  state.clients.set(key, client);
  return client;
}

async function invalidateWorkspaceClients(state: LocalApiState, workspaceId: string): Promise<void> {
  for (const [key, client] of [...state.clients]) {
    if (!key.startsWith(`${workspaceId}:`)) continue;
    await client.stop().catch(() => undefined);
    state.clients.delete(key);
  }
}

async function invalidateAllClients(state: LocalApiState): Promise<void> {
  for (const [key, client] of [...state.clients]) {
    await client.stop().catch(() => undefined);
    state.clients.delete(key);
  }
}

function closeWorkspaceStreams(state: LocalApiState, workspaceId: string): void {
  const prefix = `${workspaceId}:`;
  for (const [key, streams] of [...state.chatStreams]) {
    if (!key.startsWith(prefix)) continue;
    for (const response of streams) response.end();
    state.chatStreams.delete(key);
  }
}

function routeExtensionRequest(state: LocalApiState, request: PiExtensionUiRequest): void {
  state.extensionRequests.set(request.id, request);
  const workspaceId = workspaceIdForRootSync(request.workspaceRoot);
  if (!workspaceId) {
    state.extensionUi.cancel(request.id);
    state.extensionRequests.delete(request.id);
    return;
  }
  const rendererRequest = {
    id: request.id,
    method: request.method,
    title: request.title,
    ...(request.method === "confirm" ? { message: request.message } : {}),
    ...(request.method === "select" ? { options: request.options } : {}),
    ...(request.method === "input" && request.placeholder ? { placeholder: request.placeholder } : {}),
    ...(request.method === "input" && request.secret ? { secret: true } : {}),
    ...(request.method === "editor" && request.prefill ? { initialValue: request.prefill } : {}),
  };
  broadcast(state, streamKey(workspaceId, request.conversationId), {
    type: "extension_ui_request",
    conversationId: request.conversationId,
    request: rendererRequest,
  });
}

function routeExtensionEvent(state: LocalApiState, event: PiExtensionUiEvent): void {
  const workspaceId = workspaceIdForRootSync(event.workspaceRoot);
  if (!workspaceId) return;
  if (event.method === "notify") {
    broadcast(state, streamKey(workspaceId, event.conversationId), {
      type: "extension_ui_request",
      conversationId: event.conversationId,
      request: { id: event.id, method: "notify", message: event.message },
    });
    return;
  }
  if (event.method === "setEditorText" || event.method === "pasteToEditor") {
    broadcast(state, streamKey(workspaceId, event.conversationId), {
      type: "editor",
      conversationId: event.conversationId,
      editorMode: event.method === "setEditorText" ? "replace" : "append",
      text: event.text,
    });
    return;
  }
  const message = extensionEventMessage(event);
  if (message) broadcast(state, streamKey(workspaceId, event.conversationId), { type: "status", conversationId: event.conversationId, message });
}

function extensionResponse(request: PiExtensionUiRequest, value: unknown): { value: string } | { confirmed: boolean } {
  if (request.method === "confirm") return { confirmed: Boolean(value) };
  return { value: typeof value === "string" ? value : String(value ?? "") };
}

function extensionEventMessage(event: PiExtensionUiEvent): string | null {
  if (event.method === "setStatus") return event.text ?? null;
  if (event.method === "setWorkingMessage") return event.message ?? null;
  if (event.method === "setWorkingVisible") return event.visible ? "Extension is working…" : null;
  if (event.method === "setWorkingIndicator") return event.options ? "Extension is working…" : null;
  if (event.method === "setTitle") return event.title;
  if (event.method === "openExternal") return `Extension requested: ${event.url}`;
  if (event.method === "oauthDeviceCode") return `Open ${event.verificationUri} and enter ${event.userCode}.`;
  if (event.method === "unsupported") return `Extension UI feature is not available here: ${event.feature}`;
  return null;
}

function simplifyCatalog(
  catalog: PiResourceCatalog,
  packages: Array<{ source: string; scope: "user" | "project"; filtered: boolean }>,
): Record<string, unknown> {
  return {
    projectTrusted: catalog.projectTrust.required
      ? catalog.projectTrust.trusted
      : catalog.projectTrust.savedDecision === true,
    packages: packages.map((item) => ({
      source: item.source,
      scope: item.scope === "project" ? "project" : "global",
      enabled: true,
    })),
    skills: catalog.skills.map((skill) => ({
      name: skill.name,
      description: skill.description,
      path: skill.path,
      source: sourceLabel(skill.source),
      enabled: true,
      ...(skill.disableModelInvocation ? { disableModelInvocation: true } : {}),
    })),
    extensions: catalog.extensions.map((extension) => ({
      id: extension.resolvedPath,
      name: basename(extension.resolvedPath).replace(/\.[^.]+$/, ""),
      path: extension.path,
      source: sourceLabel(extension.source),
      enabled: true,
      commands: extension.commands,
      tools: extension.tools,
    })),
    tools: catalog.tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      source: sourceLabel(tool.source),
      active: tool.active,
    })),
    diagnostics: catalog.diagnostics.map((diagnostic) => ({
      type: diagnostic.type === "collision" ? "warning" : diagnostic.type,
      message: diagnostic.message,
      ...(diagnostic.path ? { path: diagnostic.path } : {}),
    })),
  };
}

function sourceLabel(source: PiCatalogSource): string {
  return [source.scope, source.origin === "package" ? "package" : source.source].filter(Boolean).join(" · ");
}

function normalizeStatus(status: PiSetupStatus): Record<string, unknown> {
  return {
    ready: status.ready,
    configured: status.configured,
    provider: status.provider ?? null,
    model: status.model ?? null,
    piVersion: status.piVersion,
    projectTrusted: status.projectTrusted,
    error: status.error,
  };
}

function emptyAgentStatus(): Record<string, unknown> {
  return { ready: true, configured: false, provider: null, model: null, piVersion: null, projectTrusted: false, error: null };
}

async function safeAgentStatus(workspaceRoot: string, provider: PiRuntimeProvider): Promise<Record<string, unknown>> {
  try {
    return normalizeStatus(await getPiSetupStatus(workspaceRoot, provider));
  } catch (error) {
    return { ...emptyAgentStatus(), ready: false, error: errorMessage(error) };
  }
}

async function configuredWorkspace(workspaceId?: string, provider?: string, model?: string) {
  if (!workspaceId || !provider?.trim() || !model?.trim()) throw badRequest("A Space, provider, and model are required.");
  return getWorkspace(workspaceId);
}

function openChatStream(
  state: LocalApiState,
  req: IncomingMessage,
  res: ServerResponse,
  key: string,
  conversationId: string,
): void {
  res.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
    "x-accel-buffering": "no",
  });
  res.write(`data: ${JSON.stringify({ type: "status", conversationId, message: "Connected." })}\n\n`);
  res.write(`data: ${JSON.stringify(turnStateEvent(conversationId, state.runningTurns.has(key)))}\n\n`);
  const streams = state.chatStreams.get(key) ?? new Set<ServerResponse>();
  streams.add(res);
  state.chatStreams.set(key, streams);
  const heartbeat = setInterval(() => {
    try { res.write(": keepalive\n\n"); } catch { /* disconnected */ }
  }, 15_000);
  req.on("close", () => {
    clearInterval(heartbeat);
    streams.delete(res);
    if (!streams.size) state.chatStreams.delete(key);
  });
}

async function openWorkspaceFileStream(
  state: LocalApiState,
  req: IncomingMessage,
  res: ServerResponse,
  workspaceRoot: string,
): Promise<void> {
  res.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
    "x-accel-buffering": "no",
  });
  let recursive = true;
  let watcher: ReturnType<typeof watch>;
  const sendEvent = (event: unknown) => {
    try { res.write(`data: ${JSON.stringify(event)}\n\n`); } catch { /* disconnected */ }
  };
  const onChange = (eventType: string, fileName: string | Buffer | null) => {
    const rawName = Buffer.isBuffer(fileName) ? fileName.toString("utf8") : fileName ?? "";
    if (!rawName) {
      sendEvent({ type: "file_event", eventType, path: null });
      return;
    }
    const path = rawName.replace(/\\/g, "/").replace(/^\/+/, "");
    if (!path || isAlwaysHiddenWorkspaceEntry(basename(path))) return;
    void readWorkspaceIgnoreState(workspaceRoot).then((ignoreState) => {
      if (isWorkspaceIgnored(path, ignoreState.patterns)) return;
      try { resolveWorkspacePath(workspaceRoot, path); } catch { return; }
      sendEvent({ type: "file_event", eventType, path });
    });
  };
  try {
    watcher = watch(workspaceRoot, { recursive: true }, onChange);
  } catch {
    recursive = false;
    watcher = watch(workspaceRoot, onChange);
  }
  sendEvent({ type: "ready", recursive });
  const heartbeat = setInterval(() => {
    try { res.write(": keepalive\n\n"); } catch { /* disconnected */ }
  }, 15_000);
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    clearInterval(heartbeat);
    watcher.close();
    if (!res.writableEnded) res.end();
    state.fileStreams.delete(close);
  };
  state.fileStreams.add(close);
  watcher.on("error", (error) => sendEvent({ type: "error", message: errorMessage(error) }));
  req.on("close", close);
}

async function sendWorkspaceRawFile(res: ServerResponse, workspaceRoot: string, relativePath: string): Promise<void> {
  const path = resolveWorkspacePath(workspaceRoot, relativePath);
  const info = await stat(path).catch(() => null);
  if (!info?.isFile()) throw notFound("File not found.");
  res.writeHead(200, {
    "content-type": contentTypeForPath(path),
    "content-length": info.size,
    "content-disposition": "inline",
  });
  await new Promise<void>((resolvePromise, reject) => {
    const stream = createReadStream(path);
    stream.on("error", reject);
    stream.on("end", resolvePromise);
    stream.pipe(res);
  });
}

function normalizeSelectedPath(workspaceRoot: string, value: string | null | undefined): string | null {
  const path = typeof value === "string" ? normalizeWorkspaceRelativePath(value) : "";
  if (!path) return null;
  let absolutePath: string;
  try {
    absolutePath = resolveWorkspacePath(workspaceRoot, path);
  } catch (error) {
    throw badRequest(errorMessage(error));
  }
  if (!existsSync(absolutePath)) throw badRequest("The selected Space item no longer exists.");
  return path;
}

function normalizeContextPaths(workspaceRoot: string, value: unknown): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) throw badRequest("Chat context paths must be an array of strings.");
  const paths = [...new Set(value.map((item) => normalizeWorkspaceRelativePath(item)).filter(Boolean))].slice(0, 32);
  for (const path of paths) {
    try { resolveWorkspacePath(workspaceRoot, path); } catch (error) { throw badRequest(errorMessage(error)); }
  }
  return paths;
}

async function captureTurnCheckpointSafe(
  state: LocalApiState,
  workspaceId: string,
  workspaceRoot: string,
  conversationId: string,
  reason: "pre_turn" | "post_turn",
): Promise<void> {
  try {
    const checkpoint = await createWorkspaceCheckpoint(workspaceRoot, {
      reason,
      label: reason === "pre_turn" ? "Before Assistant turn" : "After Assistant turn",
    });
    state.onHistoryCheckpoint?.({
      workspaceId,
      conversationId,
      reason,
      checkpointId: checkpoint.checkpointId,
      skippedLargeFiles: checkpoint.skippedLargeFiles,
    });
    if (checkpoint.skippedLargeFiles.length) {
      broadcast(state, streamKey(workspaceId, conversationId), {
        type: "status",
        conversationId,
        message: `History skipped ${checkpoint.skippedLargeFiles.length} oversized file${checkpoint.skippedLargeFiles.length === 1 ? "" : "s"}.`,
      });
    }
  } catch (error) {
    broadcast(state, streamKey(workspaceId, conversationId), {
      type: "status",
      conversationId,
      message: `History checkpoint warning: ${errorMessage(error)}`,
    });
  }
}

async function runWithHistorySafety<T>(workspaceRoot: string, checkpointId: string, operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    await discardWorkspaceCheckpoint(workspaceRoot, checkpointId).catch(() => undefined);
    throw error;
  }
}

function normalizeWorkspaceRelativePath(value: string): string {
  return value.trim().replace(/\\/g, "/").replace(/^(?:\.\/)+/, "").replace(/^\/+|\/+$/g, "");
}

function contentTypeForPath(path: string): string {
  switch (extname(path).toLowerCase()) {
    case ".txt": return "text/plain; charset=utf-8";
    case ".md": case ".markdown": return "text/markdown; charset=utf-8";
    case ".json": return "application/json; charset=utf-8";
    case ".csv": return "text/csv; charset=utf-8";
    case ".html": case ".htm": return "text/html; charset=utf-8";
    case ".pdf": return "application/pdf";
    case ".docx": return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    case ".xlsx": return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    case ".pptx": return "application/vnd.openxmlformats-officedocument.presentationml.presentation";
    case ".png": return "image/png";
    case ".jpg": case ".jpeg": return "image/jpeg";
    case ".gif": return "image/gif";
    case ".svg": return "image/svg+xml";
    default: return "application/octet-stream";
  }
}

function broadcast(state: LocalApiState, key: string, event: unknown): void {
  for (const response of state.chatStreams.get(key) ?? []) {
    try { response.write(`data: ${JSON.stringify(event)}\n\n`); } catch { /* disconnected */ }
  }
}

async function readJsonBody<T>(state: LocalApiState, req: IncomingMessage): Promise<T> {
  const bytes = await readBody(state, req);
  if (!bytes.length) return {} as T;
  try { return JSON.parse(bytes.toString("utf8")) as T; } catch { throw badRequest("Request body must be valid JSON."); }
}

async function readMultipartBody(state: LocalApiState, req: IncomingMessage): Promise<MultipartBody> {
  const contentType = req.headers["content-type"] ?? "";
  const boundary = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType)?.slice(1).find(Boolean)?.trim();
  if (!boundary) throw badRequest("File upload must use multipart/form-data.");
  const body = await readBody(state, req);
  const encoded = body.toString("latin1");
  const fields = new Map<string, string>();
  const files: MultipartFile[] = [];
  for (const rawPart of encoded.split(`--${boundary}`).slice(1)) {
    if (rawPart.startsWith("--")) break;
    const part = rawPart.replace(/^\r\n/, "").replace(/\r\n$/, "");
    const headerEnd = part.indexOf("\r\n\r\n");
    if (headerEnd < 0) continue;
    const headers = part.slice(0, headerEnd);
    const data = Buffer.from(part.slice(headerEnd + 4), "latin1");
    const disposition = /^content-disposition:\s*form-data;([^\r\n]+)$/im.exec(headers)?.[1] ?? "";
    const name = /(?:^|;)\s*name="([^"]*)"/i.exec(disposition)?.[1];
    if (!name) continue;
    const fileName = /(?:^|;)\s*filename="([^"]*)"/i.exec(disposition)?.[1];
    if (fileName !== undefined) {
      files.push({
        fieldName: name,
        fileName: basename(fileName.replace(/\\/g, "/")),
        contentType: /^content-type:\s*([^\r\n]+)/im.exec(headers)?.[1]?.trim() ?? "application/octet-stream",
        data,
      });
    } else {
      fields.set(name, data.toString("utf8"));
    }
  }
  return { fields, files };
}

async function readBody(state: LocalApiState, req: IncomingMessage): Promise<Buffer> {
  const declared = Number(req.headers["content-length"] ?? 0);
  if (Number.isFinite(declared) && declared > state.maxBodyBytes) throw tooLarge("Request body is too large.");
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.length;
    if (size > state.maxBodyBytes) throw tooLarge("Request body is too large.");
    chunks.push(bytes);
  }
  return Buffer.concat(chunks);
}

function parseRelativePaths(value: string | undefined, fileCount: number): Array<string | undefined> {
  if (!value) return Array.from({ length: fileCount }, () => undefined);
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed) || !parsed.every((item) => typeof item === "string")) throw new Error();
    return Array.from({ length: fileCount }, (_, index) => parsed[index] as string | undefined);
  } catch {
    throw badRequest("Upload relative paths are invalid.");
  }
}

function authorize(state: LocalApiState, req: IncomingMessage): void {
  const origin = req.headers.origin;
  if (origin && !state.allowedOrigins.includes(origin)) throw forbidden("Origin is not allowed.");
  if (state.sessionToken && req.headers["x-workspace-session"] !== state.sessionToken) throw unauthorized("Unauthorized.");
}

function setCorsHeaders(state: LocalApiState, req: IncomingMessage, res: ServerResponse): void {
  const origin = req.headers.origin;
  if (origin && state.allowedOrigins.includes(origin)) res.setHeader("access-control-allow-origin", origin);
  res.setHeader("access-control-allow-methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
  res.setHeader("access-control-allow-headers", "content-type,x-workspace-session");
  res.setHeader("vary", "Origin");
  res.setHeader("x-content-type-options", "nosniff");
}

function sendJson(res: ServerResponse, payload: unknown, status = 200): void {
  if (res.headersSent) return;
  const body = JSON.stringify(payload);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "content-length": Buffer.byteLength(body) });
  res.end(body);
}

function sendError(res: ServerResponse, error: unknown): void {
  if (res.headersSent) { res.end(); return; }
  const status = typeof (error as { statusCode?: unknown })?.statusCode === "number" ? (error as { statusCode: number }).statusCode : 500;
  sendJson(res, { error: status >= 500 ? errorMessage(error) : errorMessage(error) }, status);
}

function httpError(statusCode: number, message: string): Error {
  return Object.assign(new Error(message), { statusCode });
}
function badRequest(message: string): Error { return httpError(400, message); }
function unauthorized(message: string): Error { return httpError(401, message); }
function forbidden(message: string): Error { return httpError(403, message); }
function notFound(message: string): Error { return httpError(404, message); }
function tooLarge(message: string): Error { return httpError(413, message); }
function unavailable(message: string): Error { return httpError(503, message); }
function errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error); }

function match(path: string, pattern: RegExp): string[] | null {
  const result = pattern.exec(path);
  return result ? result.map((value) => decodeURIComponent(value)) : null;
}

function streamKey(workspaceId: string, conversationId: string): string { return `${workspaceId}:${conversationId}`; }
function clientKey(workspaceId: string, conversationId: string): string { return streamKey(workspaceId, conversationId); }

function workspaceIdForRootSync(rootPath: string): string | null {
  const normalized = process.platform === "win32" ? resolve(rootPath).toLocaleLowerCase() : resolve(rootPath);
  return `ws-${createHash("sha256").update(normalized).digest("hex").slice(0, 16)}`;
}

function changeTurnCount(state: LocalApiState, delta: number): void {
  state.activeTurns = Math.max(0, state.activeTurns + delta);
  try {
    state.onAgentTurnActivity?.(state.activeTurns);
  } catch {
    // Desktop power/tray integration must never be able to strand a turn in
    // the server's running set if its observer fails.
  }
}

function turnStateEvent(conversationId: string, running: boolean): { type: "turn_state"; conversationId: string; running: boolean } {
  return { type: "turn_state", conversationId, running };
}

function numberFromEnv(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

function loadLocalEnv(path: string): void {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
    if (!match || match[1] in process.env) continue;
    const value = match[2].replace(/^(['"])(.*)\1$/, "$2");
    process.env[match[1]] = value;
  }
}

function listen(server: Server, port: number, host: string): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => { server.off("error", reject); resolvePromise(); });
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolvePromise, reject) => server.close((error) => error ? reject(error) : resolvePromise()));
}
