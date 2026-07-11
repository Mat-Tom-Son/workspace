// Local-storage access can fail outside the browser or when storage is blocked
// (privacy modes, quota); preference reads fall back and writes return false so
// callers can keep the in-memory state while surfacing durability failures.

export function readStoredValue(key: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeStoredValue(key: string, value: string | null): boolean {
  if (typeof window === "undefined") return false;
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
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

export function writeStoredJsonValue(key: string, value: unknown): boolean {
  return writeStoredValue(key, JSON.stringify(value));
}
