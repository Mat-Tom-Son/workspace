export interface CloseableAppResource {
  close: () => Promise<void>;
}

/**
 * Owns one lazily-created resource for the lifetime of the Electron app.
 * Window recreation must not recreate host services such as the local API.
 */
export class AppLifetimeResource<T extends CloseableAppResource> {
  private value: T | null = null;
  private creating: Promise<T> | null = null;
  private closing: Promise<void> | null = null;

  ensure(create: () => Promise<T>): Promise<T> {
    if (this.value) return Promise.resolve(this.value);
    if (this.creating) return this.creating;
    if (this.closing) return Promise.reject(new Error("The app resource is shutting down."));

    this.creating = create()
      .then((value) => {
        this.value = value;
        return value;
      })
      .finally(() => {
        this.creating = null;
      });
    return this.creating;
  }

  close(): Promise<void> {
    if (this.closing) return this.closing;
    this.closing = (async () => {
      const value = this.value ?? await this.creating?.catch(() => null) ?? null;
      this.value = null;
      if (value) await value.close();
    })();
    return this.closing;
  }
}
