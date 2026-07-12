export type MenuNavigationKey = "ArrowDown" | "ArrowUp" | "Home" | "End";

export function nextMenuItemIndex(currentIndex: number, itemCount: number, key: MenuNavigationKey): number | null {
  if (itemCount <= 0) return null;
  if (key === "Home") return 0;
  if (key === "End") return itemCount - 1;
  if (currentIndex < 0) return key === "ArrowUp" ? itemCount - 1 : 0;
  return key === "ArrowUp"
    ? (currentIndex - 1 + itemCount) % itemCount
    : (currentIndex + 1) % itemCount;
}
