import type { LocalEventStream } from "../types";

export async function api<T>(path: string, options: { method?: string; body?: unknown } = {}): Promise<T> {
  const method = options.method ?? "GET";
  const response = await fetch(apiUrl(path), {
    method,
    headers: await apiHeaders(options.body === undefined ? undefined : { "content-type": "application/json" }),
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  if (!response.ok) throw new Error(await readError(response));
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export async function apiForm<T>(path: string, body: FormData): Promise<T> {
  const response = await fetch(apiUrl(path), { method: "POST", headers: await apiHeaders(), body });
  if (!response.ok) throw new Error(await readError(response));
  return response.json() as Promise<T>;
}

export function createEventSource(path: string): LocalEventStream {
  let closed = false;
  let controller: AbortController | null = null;
  let retryTimer: number | null = null;
  let attempt = 0;
  const delays = [250, 750, 1500, 3000, 5000];
  const source: LocalEventStream = {
    onmessage: null,
    onopen: null,
    onerror: null,
    close: () => {
      closed = true;
      controller?.abort();
      if (retryTimer !== null) window.clearTimeout(retryTimer);
    },
  };

  const connect = () => {
    if (closed) return;
    controller = new AbortController();
    void readEventStream(path, controller, source)
      .then(() => reconnect(new Error("Event stream ended.")))
      .catch((error) => {
        if (!closed && !controller?.signal.aborted) reconnect(error);
      });
  };
  const reconnect = (error: unknown) => {
    if (closed) return;
    const delay = delays[Math.min(attempt, delays.length - 1)] ?? 5000;
    attempt += 1;
    source.onerror?.(error);
    retryTimer = window.setTimeout(connect, delay);
  };
  connect();
  return source;
}

async function readEventStream(path: string, controller: AbortController, source: LocalEventStream): Promise<void> {
  const response = await fetch(apiUrl(path), {
    headers: await apiHeaders({ accept: "text/event-stream" }),
    signal: controller.signal,
  });
  if (!response.ok) throw new Error(await readError(response));
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Event stream is not readable.");
  source.onopen?.();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return;
    buffer += decoder.decode(value, { stream: true });
    let boundary = nextBoundary(buffer);
    while (boundary.index >= 0) {
      const frame = buffer.slice(0, boundary.index);
      buffer = buffer.slice(boundary.index + boundary.length);
      const data = frame
        .split(/\r?\n/)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trimStart())
        .join("\n");
      if (data) source.onmessage?.({ data });
      boundary = nextBoundary(buffer);
    }
  }
}

function nextBoundary(buffer: string): { index: number; length: number } {
  const unix = buffer.indexOf("\n\n");
  const windows = buffer.indexOf("\r\n\r\n");
  if (unix < 0) return { index: windows, length: 4 };
  if (windows < 0 || unix < windows) return { index: unix, length: 2 };
  return { index: windows, length: 4 };
}

export function apiUrl(path: string): string {
  const baseUrl = window.workspaceDesktop?.api.baseUrl;
  return baseUrl ? new URL(path, baseUrl).toString() : path;
}

async function apiHeaders(extra: HeadersInit = {}): Promise<HeadersInit> {
  const sessionHeaders = await window.workspaceDesktop?.api.getSessionHeaders?.();
  return { ...extra, ...(sessionHeaders ?? {}) };
}

async function readError(response: Response): Promise<string> {
  try {
    const body = await response.json() as { error?: string };
    return body.error || response.statusText || `Request failed (${response.status}).`;
  } catch {
    return response.statusText || `Request failed (${response.status}).`;
  }
}

export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
