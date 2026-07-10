import {
  app,
  dialog,
  type BrowserWindow,
  type MessageBoxOptions,
  type MessageBoxReturnValue,
} from "electron";
import electronUpdater, {
  type AppUpdater,
  type ProgressInfo,
  type UpdateDownloadedEvent,
  type UpdateInfo,
} from "electron-updater";

const { autoUpdater } = electronUpdater;

const startupDelayMs = 15_000;
const updateIntervalMs = 4 * 60 * 60 * 1_000;

type UpdatePhase = "idle" | "checking" | "downloading" | "downloaded";

export type WorkspaceUpdateCheckResult =
  | { status: "unsupported" }
  | { status: "busy"; phase: Exclude<UpdatePhase, "idle"> }
  | { status: "started"; updateAvailable: boolean; version?: string }
  | { status: "error" };

interface WorkspaceUpdaterOptions {
  getWindow: () => BrowserWindow | null;
  prepareToInstall: () => Promise<void>;
  updater?: AppUpdater;
}

/**
 * Owns the installed Windows update lifecycle. The provider always comes from
 * electron-builder's packaged app-update.yml; this class never overrides the
 * feed or supplies credentials at runtime.
 */
export class WorkspaceUpdater {
  private readonly updater: AppUpdater;
  private readonly getWindow: () => BrowserWindow | null;
  private readonly prepareToInstall: () => Promise<void>;
  private phase: UpdatePhase = "idle";
  private interactiveCycle = false;
  private disposed = false;
  private promptingForRestart = false;
  private startupTimer: NodeJS.Timeout | null = null;
  private intervalTimer: NodeJS.Timeout | null = null;

  constructor(options: WorkspaceUpdaterOptions) {
    this.updater = options.updater ?? autoUpdater;
    this.getWindow = options.getWindow;
    this.prepareToInstall = options.prepareToInstall;
  }

  get supported(): boolean {
    return app.isPackaged && process.platform === "win32";
  }

  start(): void {
    if (!this.supported || this.disposed || this.startupTimer || this.intervalTimer) return;

    this.updater.autoDownload = true;
    this.updater.autoInstallOnAppQuit = true;
    this.updater.on("checking-for-update", this.onCheckingForUpdate);
    this.updater.on("update-available", this.onUpdateAvailable);
    this.updater.on("update-not-available", this.onUpdateNotAvailable);
    this.updater.on("download-progress", this.onDownloadProgress);
    this.updater.on("update-downloaded", this.onUpdateDownloaded);
    this.updater.on("update-cancelled", this.onUpdateCancelled);
    this.updater.on("error", this.onError);

    this.startupTimer = setTimeout(() => {
      this.startupTimer = null;
      void this.check(false);
    }, startupDelayMs);
    this.startupTimer.unref();

    this.intervalTimer = setInterval(() => void this.check(false), updateIntervalMs);
    this.intervalTimer.unref();
  }

  async check(interactive = true): Promise<WorkspaceUpdateCheckResult> {
    if (!this.supported || this.disposed) {
      if (interactive) {
        await this.showMessage({
          type: "info",
          title: "Workspace Updates",
          message: "Updates are available in the installed Windows app.",
          detail: "Package and install Workspace before checking its public update feed.",
        });
      }
      return { status: "unsupported" };
    }

    if (this.phase !== "idle") {
      if (interactive) await this.showBusyMessage();
      return { status: "busy", phase: this.phase };
    }

    this.phase = "checking";
    this.interactiveCycle = interactive;
    this.setProgress(2);

    try {
      const result = await this.updater.checkForUpdates();
      if (!result) {
        this.resetCycle();
        return { status: "unsupported" };
      }

      // electron-updater returns the download promise separately. Observe it so
      // a failed automatic download cannot become an unhandled rejection; its
      // error event owns user-visible reporting and phase cleanup.
      void result.downloadPromise?.catch(() => undefined);
      return {
        status: "started",
        updateAvailable: result.isUpdateAvailable,
        version: result.updateInfo.version,
      };
    } catch (error) {
      // checkForUpdates normally emits the same failure through its error event.
      // If a provider ever rejects without emitting, preserve the manual error UX.
      const interactive = this.interactiveCycle;
      this.resetCycle();
      if (interactive && !this.disposed) await this.showUpdateError(error);
      return { status: "error" };
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.startupTimer) clearTimeout(this.startupTimer);
    if (this.intervalTimer) clearInterval(this.intervalTimer);
    this.startupTimer = null;
    this.intervalTimer = null;
    this.updater.off("checking-for-update", this.onCheckingForUpdate);
    this.updater.off("update-available", this.onUpdateAvailable);
    this.updater.off("update-not-available", this.onUpdateNotAvailable);
    this.updater.off("download-progress", this.onDownloadProgress);
    this.updater.off("update-downloaded", this.onUpdateDownloaded);
    this.updater.off("update-cancelled", this.onUpdateCancelled);
    this.updater.off("error", this.onError);
    this.setProgress(-1);
  }

  private readonly onCheckingForUpdate = (): void => {
    this.phase = "checking";
    this.setProgress(2);
  };

  private readonly onUpdateAvailable = (): void => {
    this.phase = "downloading";
    this.setProgress(0);
  };

  private readonly onUpdateNotAvailable = (info: UpdateInfo): void => {
    const interactive = this.interactiveCycle;
    this.resetCycle();
    if (!interactive || this.disposed) return;
    void this.showMessage({
      type: "info",
      title: "Workspace Updates",
      message: "Workspace is up to date.",
      detail: `You are running Workspace ${app.getVersion()}. The latest published version is ${info.version}.`,
    });
  };

  private readonly onDownloadProgress = (progress: ProgressInfo): void => {
    this.phase = "downloading";
    this.setProgress(Math.max(0, Math.min(1, progress.percent / 100)));
  };

  private readonly onUpdateDownloaded = (event: UpdateDownloadedEvent): void => {
    this.phase = "downloaded";
    this.interactiveCycle = false;
    this.setProgress(-1);
    if (!this.disposed) void this.promptToRestart(event.version);
  };

  private readonly onUpdateCancelled = (): void => {
    const interactive = this.interactiveCycle;
    this.resetCycle();
    if (!interactive || this.disposed) return;
    void this.showMessage({
      type: "info",
      title: "Workspace Updates",
      message: "The Workspace update download was cancelled.",
    });
  };

  private readonly onError = (error: Error): void => {
    const interactive = this.interactiveCycle;
    this.resetCycle();
    console.error("Workspace updater error", error);
    if (!interactive || this.disposed) return;
    void this.showUpdateError(error);
  };

  private async showBusyMessage(): Promise<void> {
    if (this.phase === "downloaded") {
      await this.promptToRestart();
      return;
    }
    await this.showMessage({
      type: "info",
      title: "Workspace Updates",
      message: this.phase === "downloading"
        ? "Workspace is already downloading an update."
        : "Workspace is already checking for updates.",
    });
  }

  private async promptToRestart(version?: string): Promise<void> {
    if (this.promptingForRestart || this.disposed) return;
    this.promptingForRestart = true;
    try {
      const result = await this.showMessage({
        type: "info",
        title: "Workspace Updates",
        message: version ? `Workspace ${version} is ready to install.` : "A Workspace update is ready to install.",
        detail: "Restart now to finish updating, or choose Later to install automatically when Workspace next exits.",
        buttons: ["Restart now", "Later"],
        defaultId: 0,
        cancelId: 1,
        noLink: true,
      });
      if (result.response !== 0 || this.disposed) return;
      await this.prepareToInstall();
      this.updater.quitAndInstall(false, true);
    } finally {
      this.promptingForRestart = false;
    }
  }

  private resetCycle(): void {
    this.phase = "idle";
    this.interactiveCycle = false;
    this.setProgress(-1);
  }

  private setProgress(value: number): void {
    const window = this.getWindow();
    if (window && !window.isDestroyed()) window.setProgressBar(value);
  }

  private showMessage(options: MessageBoxOptions): Promise<MessageBoxReturnValue> {
    const window = this.getWindow();
    return window && !window.isDestroyed()
      ? dialog.showMessageBox(window, options)
      : dialog.showMessageBox(options);
  }

  private showUpdateError(error: unknown): Promise<MessageBoxReturnValue> {
    return this.showMessage({
      type: "error",
      title: "Workspace Updates",
      message: "Workspace could not check for updates.",
      detail: error instanceof Error ? error.message : String(error),
    });
  }
}
