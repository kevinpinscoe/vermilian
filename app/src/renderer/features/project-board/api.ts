import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { BoardIssue } from '../../../shared/workspace';
import type { CreateIssueArgs } from '../../../shared/ipc';
import { useToastStore } from '../../stores/toast';

export function useIssues(projectShortName: string | null, includeResolved = false) {
  // Open issues use key without suffix (shared with nav count badge).
  // All issues use a distinct key so the two data sets don't overwrite each other.
  const key = includeResolved
    ? ['youtrack', 'issues', projectShortName, 'all']
    : ['youtrack', 'issues', projectShortName];
  return useQuery<BoardIssue[]>({
    queryKey: key,
    queryFn: () =>
      window.vermilian.getIssues({ projectShortName: projectShortName as string, includeResolved }),
    enabled: Boolean(projectShortName),
    staleTime: 60 * 1000,
  });
}

export function usePatchIssueOnBoard(projectShortName: string | null) {
  const qc = useQueryClient();
  const showToast = useToastStore((s) => s.show);
  return useMutation({
    mutationFn: (args: { issueId: string; field: string; value: string | number | null }) =>
      window.vermilian.patchIssue(args),
    onMutate: async (args) => {
      if (!projectShortName) return;
      const baseKey = ['youtrack', 'issues', projectShortName];
      const allKey = [...baseKey, 'all'];
      await qc.cancelQueries({ queryKey: baseKey });
      await qc.cancelQueries({ queryKey: allKey });
      const prevBase = qc.getQueryData<BoardIssue[]>(baseKey);
      const prevAll = qc.getQueryData<BoardIssue[]>(allKey);
      const updater = (old: BoardIssue[] | undefined) =>
        old?.map((issue) =>
          issue.id === args.issueId
            ? { ...issue, fields: { ...issue.fields, [args.field]: args.value } }
            : issue,
        );
      if (prevBase) qc.setQueryData(baseKey, updater);
      if (prevAll) qc.setQueryData(allKey, updater);
      return { prevBase, prevAll };
    },
    onError: (err: Error, _args, ctx) => {
      const context = ctx as { prevBase?: BoardIssue[]; prevAll?: BoardIssue[] } | undefined;
      if (projectShortName) {
        const baseKey = ['youtrack', 'issues', projectShortName];
        if (context?.prevBase) qc.setQueryData(baseKey, context.prevBase);
        if (context?.prevAll) qc.setQueryData([...baseKey, 'all'], context.prevAll);
      }
      showToast('negative', err.message);
    },
    onSuccess: (result, _args, ctx) => {
      const context = ctx as { prevBase?: BoardIssue[]; prevAll?: BoardIssue[] } | undefined;
      if (!result.ok) {
        if (projectShortName) {
          const baseKey = ['youtrack', 'issues', projectShortName];
          if (context?.prevBase) qc.setQueryData(baseKey, context.prevBase);
          if (context?.prevAll) qc.setQueryData([...baseKey, 'all'], context.prevAll);
        }
        showToast('negative', result.error ?? 'Save failed');
        return;
      }
      if (projectShortName) {
        void qc.invalidateQueries({ queryKey: ['youtrack', 'issues', projectShortName] });
      }
    },
  });
}

export function useCreateIssueOnBoard(projectShortName: string | null) {
  const qc = useQueryClient();
  const showToast = useToastStore((s) => s.show);
  return useMutation({
    mutationFn: (args: CreateIssueArgs) => window.vermilian.createIssue(args),
    onSuccess: (result) => {
      if (!result.ok) { showToast('negative', result.error ?? 'Create failed'); return; }
      if (projectShortName) {
        void qc.invalidateQueries({ queryKey: ['youtrack', 'issues', projectShortName] });
      }
    },
    onError: (err: Error) => showToast('negative', err.message),
  });
}
