// Local-storage access can fail outside the browser or when storage is blocked
// (privacy modes, quota); preference reads fall back and writes become no-ops so
// the UI keeps working from in-memory state.

export function readStoredValue(key: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeStoredValue(key: string, value: string | null): void {
  if (typeof window === "undefined") return;
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    // Ignore blocked storage; the in-memory value still applies for this session.
  }
}

export function readStoredJsonValue<T>(key: string, normalize: (parsed: unknown) => T, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    return normalize(JSON.parse(raw));
  } catch {
    return fallback;
  }
}

export function writeStoredJsonValue(key: string, value: unknown): void {
  writeStoredValue(key, JSON.stringify(value));
}
