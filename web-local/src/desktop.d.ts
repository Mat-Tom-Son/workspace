export {};

type WorkspaceUpdateCheckResult =
  | { status: "unsupported" }
  | { status: "busy"; phase: "checking" | "downloading" | "downloaded" }
  | { status: "started"; updateAvailable: boolean; version?: string }
  | { status: "error" };

declare global {
  interface Window {
    workspaceDesktop?: {
      desktop: true;
      api: {
        baseUrl: string;
        getSessionHeaders?: () => Promise<Record<string, string>>;
      };
      app: {
        name: string;
        version: string;
        platform: string;
      };
      workspace: {
        chooseFolder: () => Promise<{ path: string; folderGrantId: string } | null>;
        onOpenFolder?: (callback: () => void) => () => void;
      };
      agent: {
        onOpenSettings?: (callback: () => void) => () => void;
      };
      shell: {
        openExternal: (url: string) => Promise<void>;
      };
      updates: {
        check: () => Promise<WorkspaceUpdateCheckResult>;
      };
    };
  }
}
