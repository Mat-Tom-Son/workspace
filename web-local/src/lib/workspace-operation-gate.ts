export interface WorkspaceOperationToken {
  workspaceId: string;
  generation: number;
}

export interface WorkspaceOperationGate {
  activate: (workspaceId: string) => void;
  capture: () => WorkspaceOperationToken;
  isCurrent: (token: WorkspaceOperationToken) => boolean;
}

/** Invalidates pending UI completions whenever the active Space changes. */
export function createWorkspaceOperationGate(initialWorkspaceId: string): WorkspaceOperationGate {
  let workspaceId = initialWorkspaceId;
  let generation = 0;
  return {
    activate(nextWorkspaceId) {
      if (workspaceId === nextWorkspaceId) return;
      workspaceId = nextWorkspaceId;
      generation += 1;
    },
    capture() {
      return { workspaceId, generation };
    },
    isCurrent(token) {
      return token.workspaceId === workspaceId && token.generation === generation;
    },
  };
}
