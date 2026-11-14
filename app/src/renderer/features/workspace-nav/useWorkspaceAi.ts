// The active workspace's AI availability, for every AI control (VERM-47).
// It comes from the active-workspace context, so switching workspaces
// switches it in the same render; it never carries a credential value.

import { useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { ActiveWorkspaceContext } from '../../../shared/activeWorkspace';
import { ACTIVE_WORKSPACE_QUERY_KEY, useActiveWorkspace } from './api';

export interface WorkspaceAi {
  /** Whether AI controls are enabled for the active workspace. */
  available: boolean;
  /** Why not, for a tooltip; null when available or still loading. */
  reason: string | null;
  /** The workspace every AI request is made from; '' while loading. */
  workspaceId: string;
  /**
   * Whether `workspaceId` is still the active workspace — checked when an AI
   * answer arrives, so a late answer for a workspace the user has left is
   * dropped instead of shown.
   */
  isStillActive: (workspaceId: string) => boolean;
}

export function useWorkspaceAi(): WorkspaceAi {
  const queryClient = useQueryClient();
  const ctx = useActiveWorkspace().data;
  const isStillActive = useCallback(
    (workspaceId: string) => queryClient.getQueryData<ActiveWorkspaceContext>(ACTIVE_WORKSPACE_QUERY_KEY)?.workspaceId === workspaceId,
    [queryClient],
  );
  return {
    available: ctx?.ai.state === 'available',
    reason: ctx ? ctx.ai.message : null,
    workspaceId: ctx?.workspaceId ?? '',
    isStillActive,
  };
}
