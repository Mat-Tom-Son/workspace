import { useEffect, useRef } from "react";

export function useEscapeKeyDismiss(
  onDismiss: (event: KeyboardEvent) => void,
  enabled = true,
  { capture = false }: { capture?: boolean } = {},
): void {
  // The handler reads the latest onDismiss through a ref so guard conditions
  // inside it always see the current render's state without re-subscribing.
  const onDismissRef = useRef(onDismiss);
  useEffect(() => {
    onDismissRef.current = onDismiss;
  });

  useEffect(() => {
    if (!enabled) return;
    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key !== "Escape") return;
      onDismissRef.current(event);
    }
    // capture registers on document ahead of focused-element handlers, so the
    // dismiss wins even when another surface swallows bubbled keydowns.
    if (capture) {
      document.addEventListener("keydown", handleKeyDown, true);
      return () => document.removeEventListener("keydown", handleKeyDown, true);
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [enabled, capture]);
}
