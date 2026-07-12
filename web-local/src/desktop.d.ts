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
      window: {
        setTheme: (theme: "light" | "dark") => void;
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
