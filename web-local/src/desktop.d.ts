export {};

interface WorkspaceDesktopUpdateStatus {
  supported: boolean;
  phase: "unsupported" | "idle" | "checking" | "available" | "not_available" | "downloading" | "ready" | "installing" | "error";
  currentVersion: string;
  availableVersion: string | null;
  progressPercent: number | null;
  checkedAt: string | null;
  message: string;
  error: string | null;
}

type WorkspaceDesktopMenuCommand =
  | "new-space"
  | "open-local-folder"
  | "new-chat"
  | "reload-workspace-state"
  | "check-for-updates"
  | "open-settings"
  | "open-about"
  | "open-capabilities"
  | "open-skills"
  | "open-extensions"
  | "open-command-palette"
  | "open-keyboard-shortcuts";

type WorkspaceDesktopMenuId = "file" | "edit" | "view" | "help";
type WorkspaceDesktopPathAction = "open" | "open-native" | "reveal";

interface WorkspaceRestrictedAppViewRequest {
  workspaceId: string;
  appId: string;
  digest: string;
  mountId: string;
  placement: "navigator" | "tab";
  appTabId?: string;
  route: string;
  state?: unknown;
  sequence: number;
  bounds: { x: number; y: number; width: number; height: number };
  active: boolean;
  occluded: boolean;
  theme: "light" | "dark";
}

interface WorkspaceRestrictedAppTabCommand {
  type: "open" | "update" | "close";
  workspaceId: string;
  appId: string;
  digest: string;
  sourceMountId: string;
  sourcePlacement: "navigator" | "tab";
  sourceAppTabId?: string;
  tab?: { appTabId: string; title: string; route: string; state?: unknown };
}

interface WorkspaceRestrictedAppViewState {
  mountId: string;
  state: "loading" | "ready" | "crashed" | "stopped";
  message?: string;
}

interface WorkspaceRestrictedAppOwner {
  workspaceId: string;
  appId: string;
  digest: string;
  permissionId: string;
}

declare global {
  interface Window {
    workspaceDesktop?: {
      desktop: true;
      api: {
        baseUrl: string;
        getSessionHeaders: () => Promise<Record<string, string>>;
      };
      app: {
        name: string;
        version: string;
        platform: NodeJS.Platform;
        iconUrl: string;
      };
      runtime: {
        getHealth: () => Promise<{
          pi: { ok: boolean; configured?: boolean; version?: string; message?: string };
          settings: { encryptionAvailable: boolean; configuredProviders: string[] };
        }>;
        onRendererRecovered: (listener: () => void) => () => void;
      };
      workspace: {
        chooseFolder: () => Promise<{ path: string; folderGrantId: string } | null>;
        revealFolder: (workspaceId: string) => Promise<void>;
        openPath: (workspaceId: string, path: string, action?: WorkspaceDesktopPathAction) => Promise<void>;
        startDrag: (workspaceId: string, path: string) => Promise<void>;
        onOpenFolder: (listener: () => void) => () => void;
      };
      agent: {
        onOpenSettings: (listener: () => void) => () => void;
      };
      restrictedApps: {
        mountView: (request: WorkspaceRestrictedAppViewRequest) => Promise<{ mounted: true; digest: string }>;
        layoutView: (request: WorkspaceRestrictedAppViewRequest) => void;
        unmountView: (mountId: string) => Promise<void>;
        onTabCommand: (listener: (command: WorkspaceRestrictedAppTabCommand) => void) => () => void;
        onViewState: (listener: (state: WorkspaceRestrictedAppViewState) => void) => () => void;
        onOpenRequest: (listener: (owner: WorkspaceRestrictedAppOwner) => void) => () => void;
      };
      window: {
        material: "mica" | "none";
        setTheme: (theme: "light" | "dark", source?: "light" | "dark" | "system") => void;
        getAccentColor: () => Promise<string | null>;
        onAccentColorChanged: (listener: (accent: string | null) => void) => () => void;
        getCloseToTray: () => Promise<{ supported: boolean; enabled: boolean }>;
        setCloseToTray: (enabled: boolean) => Promise<{ supported: boolean; enabled: boolean }>;
      };
      shell: {
        openExternal: (url: string) => Promise<void>;
      };
      updates: {
        getStatus: () => Promise<WorkspaceDesktopUpdateStatus>;
        check: () => Promise<WorkspaceDesktopUpdateStatus>;
        install: () => Promise<WorkspaceDesktopUpdateStatus>;
        updateNow: () => Promise<WorkspaceDesktopUpdateStatus>;
        onStatusChanged: (listener: (status: WorkspaceDesktopUpdateStatus) => void) => () => void;
      };
      settings: {
        getStatus: () => Promise<{ encryptionAvailable: boolean; configuredProviders: string[] }>;
      };
      menu: {
        setState: (state: { spaceOpen: boolean }) => void;
        popup: (menuId: WorkspaceDesktopMenuId, bounds: { x: number; y: number }) => Promise<void>;
        onCommand: (listener: (command: WorkspaceDesktopMenuCommand) => void) => () => void;
      };
    };
  }
}
