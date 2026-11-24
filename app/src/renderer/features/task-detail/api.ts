import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { IssueDetail } from '../../../shared/workspace';
import { useToastStore } from '../../stores/toast';
import { RUNWAY_TICKETS_QUERY_KEY } from '../runway/api';

export function useIssueDetail(issueId: string | null) {
  return useQuery<IssueDetail>({
    queryKey: ['youtrack', 'issue', issueId],
    queryFn: () => window.vermilian.getIssueDetail(issueId as string),
    enabled: Boolean(issueId),
  });
}

/**
 * `runwayWorkspaceId`, when given, is the workspace whose Runway tickets are
 * re-read after a successful status edit (VERM-98): the edited ticket and its
 * dependents then show their new blocker state. The re-read never writes the
 * Runway order.
 */
export function usePatchIssue(issueId: string, projectShortName: string | null, runwayWorkspaceId: string | null = null) {
  const queryClient = useQueryClient();
  const showToast = useToastStore((s) => s.show);

  return useMutation({
    mutationFn: (args: { field: string; value: string | number | null }) =>
      window.vermilian.patchIssue({ issueId, ...args }),
    onSuccess: (result, args) => {
      if (!result.ok) {
        showToast('negative', result.error ?? 'Save failed');
        return;
      }
      showToast('positive', 'Saved.', 2000);
      void queryClient.invalidateQueries({ queryKey: ['youtrack', 'issue', issueId] });
      if (runwayWorkspaceId && args.field === 'status') {
        void queryClient.invalidateQueries({ queryKey: RUNWAY_TICKETS_QUERY_KEY(runwayWorkspaceId) });
      }
      if (projectShortName) {
        void queryClient.invalidateQueries({
          queryKey: ['youtrack', 'issues', projectShortName],
        });
      }
    },
    onError: (err: Error) => {
      showToast('negative', err.message ?? 'Save failed');
    },
  });
}

export function useDeleteIssue(projectShortName: string | null) {
  const queryClient = useQueryClient();
  const showToast = useToastStore((s) => s.show);

  return useMutation({
    mutationFn: (issueId: string) => window.vermilian.deleteIssue(issueId),
    onSuccess: (result, issueId) => {
      if (!result.ok) {
        showToast('negative', result.error ?? 'Delete failed');
        return;
      }
      showToast('positive', 'Task deleted.', 2000);
      void queryClient.removeQueries({ queryKey: ['youtrack', 'issue', issueId] });
      if (projectShortName) {
        void queryClient.invalidateQueries({
          queryKey: ['youtrack', 'issues', projectShortName],
        });
      }
    },
    onError: (err: Error) => {
      showToast('negative', err.message ?? 'Delete failed');
    },
  });
}
