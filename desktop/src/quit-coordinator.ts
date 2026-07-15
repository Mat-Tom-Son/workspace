export type QuitPreparationOutcome = "quit" | "handoff";

export interface GracefulQuitCoordinatorOptions {
  prepare: () => Promise<QuitPreparationOutcome>;
  quit: () => void;
  defer?: (callback: () => void) => void;
  onError?: (error: unknown) => void;
}

/**
 * Serializes graceful shutdown and resumes Electron termination on a fresh
 * event-loop turn. In particular, this avoids re-entering `app.quit()` while
 * a native macOS Quit menu role is still unwinding its first termination
 * request.
 */
export class GracefulQuitCoordinator {
  private nativeQuitAllowed = false;
  private preparation: Promise<void> | null = null;
  private quitScheduled = false;
  private readonly defer: (callback: () => void) => void;

  constructor(private readonly options: GracefulQuitCoordinatorOptions) {
    this.defer = options.defer ?? ((callback) => { setImmediate(callback); });
  }

  shouldPreventNativeQuit(): boolean {
    return !this.nativeQuitAllowed;
  }

  allowNativeQuit(): void {
    this.nativeQuitAllowed = true;
  }

  requestQuit(): void {
    if (this.nativeQuitAllowed) {
      this.scheduleQuit();
      return;
    }
    if (this.preparation) return;
    this.preparation = this.prepareAndContinue().finally(() => {
      this.preparation = null;
    });
  }

  private async prepareAndContinue(): Promise<void> {
    let outcome: QuitPreparationOutcome = "quit";
    try {
      outcome = await this.options.prepare();
    } catch (error) {
      this.options.onError?.(error);
    }
    this.nativeQuitAllowed = true;
    if (outcome === "quit") this.scheduleQuit();
  }

  private scheduleQuit(): void {
    if (this.quitScheduled) return;
    this.quitScheduled = true;
    this.defer(() => {
      this.quitScheduled = false;
      this.options.quit();
    });
  }
}
