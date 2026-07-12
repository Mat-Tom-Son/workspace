export type MessageImageResolution =
  | { kind: "embed"; src: string }
  | { kind: "external-link"; href: string }
  | { kind: "blocked" };

const embeddableDataImage = /^data:image\/(?:png|jpeg|gif|webp);base64,/i;

/** Keep Markdown image rendering aligned with the renderer CSP. */
export function resolveMessageImageSource(source: string | undefined, baseHref: string): MessageImageResolution {
  const value = source?.trim();
  if (!value) return { kind: "blocked" };
  if (embeddableDataImage.test(value)) return { kind: "embed", src: value };

  try {
    const base = new URL(baseHref);
    const url = new URL(value, base);
    if (url.protocol === "blob:" && url.origin === base.origin) return { kind: "embed", src: url.toString() };
    if ((url.protocol === "http:" || url.protocol === "https:") && url.origin === base.origin) {
      return isExplicitSameOriginSource(value, base)
        ? { kind: "embed", src: url.toString() }
        : { kind: "blocked" };
    }
    if (url.protocol === "https:") return { kind: "external-link", href: url.toString() };
  } catch {
    return { kind: "blocked" };
  }
  return { kind: "blocked" };
}

function isExplicitSameOriginSource(value: string, base: URL): boolean {
  return value.startsWith("/") || value.startsWith(`${base.origin}/`);
}
