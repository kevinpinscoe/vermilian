import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { IssueDetail } from '../../../shared/workspace';
import { useToastStore } from '../../stores/toast';

export function useIssueDetail(issueId: string | null) {
  return useQuery<IssueDetail>({
    queryKey: ['youtrack', 'issue', issueId],
    queryFn: () => window.vermilian.getIssueDetail(issueId as string),
    enabled: Boolean(issueId),
  });
}

export function usePatchIssue(issueId: string, projectShortName: string | null) {
  const queryClient = useQueryClient();
  const showToast = useToastStore((s) => s.show);

  return useMutation({
    mutationFn: (args: { field: string; value: string | number | null }) =>
      window.vermilian.patchIssue({ issueId, ...args }),
    onSuccess: (result) => {
      if (!result.ok) {
        showToast('negative', result.error ?? 'Save failed');
        return;
      }
      showToast('positive', 'Saved.', 2000);
      void queryClient.invalidateQueries({ queryKey: ['youtrack', 'issue', issueId] });
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
