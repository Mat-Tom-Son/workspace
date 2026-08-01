/**
 * Product metadata and executable Pi configuration are never ordinary Space
 * content. Match case-insensitively on every platform so a legacy build cannot
 * expose or mutate a work-fold metadata tree created on another filesystem.
 */
export function isReservedWorkspacePathSegment(segment: string): boolean {
  const normalized = segment.toLocaleLowerCase("en-US");
  return normalized === ".workspace" || normalized === ".work-fold" || normalized === ".pi";
}

export function containsReservedWorkspacePathSegment(path: string): boolean {
  return path.split(/[\\/]+/u).some(isReservedWorkspacePathSegment);
}

export function assertOrdinaryWorkspacePath(path: string): void {
  if (containsReservedWorkspacePathSegment(path)) {
    throw new Error("Product metadata and Pi configuration are not ordinary Space content.");
  }
}
