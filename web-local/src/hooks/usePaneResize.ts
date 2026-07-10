import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";

import {
  workspaceChatPreferredMinWidth,
  workspacePaneKeyboardLargeStep,
  workspacePaneKeyboardStep,
  workspacePaneResizeHandleWidth,
  workspaceSidebarPreferredMaxWidth,
  workspaceSidebarPreferredMinWidth,
  workspaceSidebarWidthPreferenceKey,
} from "../constants";
import { readStoredValue, writeStoredValue } from "../lib/storage";
import type { WorkspacePaneBounds } from "../types";

function readStoredWorkspaceSidebarWidth(): number | null {
  const stored = readStoredValue(workspaceSidebarWidthPreferenceKey);
  if (!stored) return null;
  const width = Number.parseInt(stored, 10);
  return Number.isFinite(width) ? width : null;
}

function writeStoredWorkspaceSidebarWidth(width: number | null) {
  writeStoredValue(workspaceSidebarWidthPreferenceKey, width === null ? null : String(Math.round(width)));
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function usePaneResize(deterministic = false) {
  const [sidebarWidth, setSidebarWidth] = useState<number | null>(() => deterministic ? null : readStoredWorkspaceSidebarWidth());
  const [sidebarResizing, setSidebarResizing] = useState(false);
  const workspaceLayoutRef = useRef<HTMLElement | null>(null);
  const preferredSidebarWidthRef = useRef<number | null>(sidebarWidth);
  const renderedSidebarWidthRef = useRef<number | null>(sidebarWidth);
  const pendingSidebarWidthRef = useRef<number | null>(null);
  const sidebarResizeFrameRef = useRef<number | null>(null);
  const sidebarResizeCleanupRef = useRef<(() => void) | null>(null);
  // Pane bounds are stable for the duration of a pointer drag; cache them so
  // per-frame renders skip getComputedStyle.
  const dragBoundsRef = useRef<WorkspacePaneBounds | null>(null);

  useEffect(() => () => {
    sidebarResizeCleanupRef.current?.();
    sidebarResizeCleanupRef.current = null;
    if (sidebarResizeFrameRef.current !== null) window.cancelAnimationFrame(sidebarResizeFrameRef.current);
    document.body.classList.remove("workspace-pane-resizing");
  }, []);

  useEffect(() => {
    const layout = workspaceLayoutRef.current;
    if (!layout) return;
    const initialWidth = preferredSidebarWidthRef.current ?? defaultWorkspaceSidebarWidth(layout);
    renderWorkspaceSidebarWidth(initialWidth);
  }, []);

  useEffect(() => {
    const layout = workspaceLayoutRef.current;
    if (!layout || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      renderWorkspaceSidebarWidth(preferredSidebarWidthRef.current ?? defaultWorkspaceSidebarWidth(layout));
    });
    observer.observe(layout);
    return () => observer.disconnect();
  }, []);

  function workspacePaneBounds(layout = workspaceLayoutRef.current): WorkspacePaneBounds {
    if (!layout) {
      return {
        min: workspaceSidebarPreferredMinWidth,
        max: workspaceSidebarPreferredMaxWidth,
        fallback: 420,
      };
    }
    const styles = window.getComputedStyle(layout);
    const horizontalPadding = Number.parseFloat(styles.paddingLeft) + Number.parseFloat(styles.paddingRight);
    const availableWidth = Math.max(0, layout.clientWidth - horizontalPadding);
    const minimumByChat = Math.max(220, availableWidth - workspacePaneResizeHandleWidth - workspaceChatPreferredMinWidth);
    const min = Math.min(workspaceSidebarPreferredMinWidth, minimumByChat);
    const max = Math.max(min, Math.min(workspaceSidebarPreferredMaxWidth, availableWidth - workspacePaneResizeHandleWidth - workspaceChatPreferredMinWidth));
    const fallback = clampNumber(Math.round(availableWidth * 0.34), min, max);
    return { min, max, fallback };
  }

  function defaultWorkspaceSidebarWidth(layout = workspaceLayoutRef.current): number {
    return workspacePaneBounds(layout).fallback;
  }

  function renderWorkspaceSidebarWidth(width: number): number {
    const bounds = dragBoundsRef.current ?? workspacePaneBounds();
    const nextWidth = Math.round(clampNumber(width, bounds.min, bounds.max));
    renderedSidebarWidthRef.current = nextWidth;
    setSidebarWidth(nextWidth);
    workspaceLayoutRef.current?.style.setProperty("--workspace-sidebar-width", `${nextWidth}px`);
    return nextWidth;
  }

  function queueWorkspaceSidebarWidth(width: number) {
    pendingSidebarWidthRef.current = width;
    if (sidebarResizeFrameRef.current !== null) return;
    sidebarResizeFrameRef.current = window.requestAnimationFrame(() => {
      sidebarResizeFrameRef.current = null;
      const pendingWidth = pendingSidebarWidthRef.current;
      if (pendingWidth !== null) renderWorkspaceSidebarWidth(pendingWidth);
    });
  }

  function commitWorkspaceSidebarWidth(width: number | null = renderedSidebarWidthRef.current) {
    if (width === null) return;
    const nextWidth = renderWorkspaceSidebarWidth(width);
    preferredSidebarWidthRef.current = nextWidth;
    if (!deterministic) writeStoredWorkspaceSidebarWidth(nextWidth);
  }

  function resetWorkspaceSidebarWidth() {
    preferredSidebarWidthRef.current = null;
    if (!deterministic) writeStoredWorkspaceSidebarWidth(null);
    renderWorkspaceSidebarWidth(defaultWorkspaceSidebarWidth());
  }

  function startSidebarResize(event: ReactPointerEvent<HTMLButtonElement>) {
    if (event.button !== 0) return;
    const layout = workspaceLayoutRef.current;
    if (!layout) return;
    event.preventDefault();
    const resizeHandle = event.currentTarget;
    const pointerId = event.pointerId;
    try {
      resizeHandle.setPointerCapture(pointerId);
    } catch {
      // Pointer capture can fail for synthetic or already-cancelled events; window listeners still cover normal drags.
    }
    setSidebarResizing(true);
    document.body.classList.add("workspace-pane-resizing");
    const pane = document.getElementById("workspace-file-panel");
    const dragStartClientX = event.clientX;
    dragBoundsRef.current = workspacePaneBounds(layout);
    const dragStartWidth = pane?.getBoundingClientRect().width ?? renderedSidebarWidthRef.current ?? defaultWorkspaceSidebarWidth(layout);
    const widthFromPointer = (clientX: number) => dragStartWidth + clientX - dragStartClientX;
    let stopped = false;

    const handlePointerMove = (pointerEvent: PointerEvent) => {
      pointerEvent.preventDefault();
      queueWorkspaceSidebarWidth(widthFromPointer(pointerEvent.clientX));
    };
    const stopResize = (pointerEvent?: PointerEvent | Event) => {
      if (stopped) return;
      stopped = true;
      dragBoundsRef.current = null;
      if (pointerEvent) pointerEvent.preventDefault();
      sidebarResizeCleanupRef.current?.();
      sidebarResizeCleanupRef.current = null;
      try {
        if (resizeHandle.hasPointerCapture(pointerId)) resizeHandle.releasePointerCapture(pointerId);
      } catch {
        // The pointer may already be released by the browser.
      }
      if (sidebarResizeFrameRef.current !== null) {
        window.cancelAnimationFrame(sidebarResizeFrameRef.current);
        sidebarResizeFrameRef.current = null;
      }
      if (pendingSidebarWidthRef.current !== null) renderWorkspaceSidebarWidth(pendingSidebarWidthRef.current);
      pendingSidebarWidthRef.current = null;
      commitWorkspaceSidebarWidth();
      setSidebarResizing(false);
      document.body.classList.remove("workspace-pane-resizing");
    };

    window.addEventListener("pointermove", handlePointerMove, { passive: false });
    window.addEventListener("pointerup", stopResize, { passive: false });
    window.addEventListener("pointercancel", stopResize, { passive: false });
    window.addEventListener("blur", stopResize);
    resizeHandle.addEventListener("lostpointercapture", stopResize);
    sidebarResizeCleanupRef.current = () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", stopResize);
      window.removeEventListener("pointercancel", stopResize);
      window.removeEventListener("blur", stopResize);
      resizeHandle.removeEventListener("lostpointercapture", stopResize);
    };
  }

  function handleSidebarResizeKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>) {
    const bounds = workspacePaneBounds();
    const currentWidth = renderedSidebarWidthRef.current ?? bounds.fallback;
    const step = event.shiftKey ? workspacePaneKeyboardLargeStep : workspacePaneKeyboardStep;
    let nextWidth: number | null = null;
    if (event.key === "ArrowLeft") nextWidth = currentWidth - step;
    else if (event.key === "ArrowRight") nextWidth = currentWidth + step;
    else if (event.key === "Home") nextWidth = bounds.min;
    else if (event.key === "End") nextWidth = bounds.max;
    else if (event.key === "Enter") {
      event.preventDefault();
      resetWorkspaceSidebarWidth();
      return;
    }
    if (nextWidth === null) return;
    event.preventDefault();
    commitWorkspaceSidebarWidth(nextWidth);
  }

  const sidebarResizeBounds = workspacePaneBounds();
  const sidebarResizeValue = Math.round(clampNumber(sidebarWidth ?? sidebarResizeBounds.fallback, sidebarResizeBounds.min, sidebarResizeBounds.max));

  return {
    sidebarWidth,
    sidebarResizing,
    workspaceLayoutRef,
    resetWorkspaceSidebarWidth,
    startSidebarResize,
    handleSidebarResizeKeyDown,
    sidebarResizeBounds,
    sidebarResizeValue,
  };
}
