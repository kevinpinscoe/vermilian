// Each project's select-field values (VERM-117), for the Kanban chip editor,
// board grouping and filters, the Priority Desk and the detail dropdowns.
//
// Read per (workspace, project) through the main process on the workspace's
// own connection (ADR-0011, VERM-47), never another credential. An empty
// workspaceId (legacy single-connection storage) means the active one. An answer
// that names a different workspace or project than the query asked for is
// ignored, so a late answer can never land on the wrong board. There is no
// fallback list: while a project's values are unknown its editors offer
// only the current value, and a failed read offers Retry.

import { useCallback, useMemo } from 'react';
import { useQueries } from '@tanstack/react-query';
import type { ProjectFieldValues } from '../../../shared/projectFieldValues';

export const PROJECT_FIELD_VALUES_QUERY_KEY = ['youtrack', 'project-field-values'] as const;

export function projectFieldValuesQueryKey(workspaceId: string, project: string) {
  return [...PROJECT_FIELD_VALUES_QUERY_KEY, workspaceId, project] as const;
}

export interface ProjectFieldValuesState {
  /** Values per project (short name or id, as asked), once read. */
  byProject: ReadonlyMap<string, ProjectFieldValues>;
  /** Read errors per project. */
  errors: ReadonlyMap<string, string>;
  /** Some project's values are still being read. */
  loading: boolean;
  /** Re-read one project's values, or every project that failed. */
  retry: (project?: string) => void;
}

async function readValues(workspaceId: string, project: string): Promise<ProjectFieldValues> {
  const r = await window.vermilian.getProjectFieldValues({ workspaceId, project });
  if (r.workspaceId !== workspaceId || r.project !== project) throw new Error("Could not read this project's fields.");
  if (!r.ok || !r.values) throw new Error(r.error ?? "Could not read this project's fields.");
  return r.values;
}

export function useProjectFieldValues(workspaceId: string, projects: readonly string[]): ProjectFieldValuesState {
  const unique = useMemo(() => [...new Set(projects.filter(Boolean))], [projects]);
  const results = useQueries({
    queries: unique.map((project) => ({
      queryKey: projectFieldValuesQueryKey(workspaceId, project),
      queryFn: () => readValues(workspaceId, project),
      retry: false,
      staleTime: 60_000,
    })),
  });

  const stamp = results.map((r) => `${r.dataUpdatedAt}:${r.errorUpdatedAt}:${r.fetchStatus}`).join('|');
  const state = useMemo(() => {
    const byProject = new Map<string, ProjectFieldValues>();
    const errors = new Map<string, string>();
    let loading = false;
    unique.forEach((project, i) => {
      const r = results[i];
      if (!r) return;
      if (r.data) byProject.set(project, r.data);
      if (r.isError && !r.isFetching) errors.set(project, (r.error as Error).message);
      if (r.isFetching || r.isPending) loading = true;
    });
    return { byProject, errors, loading };
    // `results` is a new array each render; `stamp` captures what changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unique, stamp, workspaceId]);

  const retry = useCallback((project?: string) => {
    unique.forEach((p, i) => {
      if (project ? p === project : results[i]?.isError) void results[i]?.refetch();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unique, stamp]);

  return { ...state, retry };
}
