// The selected project's create options, applied to a create form (VERM-115).
//
// Options are read per (workspace, project) through the main process, on the
// active workspace's own connection. Two guards keep a late answer for one
// project out of another project's form: the query is keyed by project, and
// the apply step only touches the form while its projectId still equals the
// project the answer names. A failed read keeps the draft and offers Retry.

import { useCallback, useEffect, useState } from 'react';
import type React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { CreateFieldKey, CreateFieldOptions } from '../../../shared/createFieldOptions';
import type { YouTrackProject } from '../../../shared/workspace';
import { applyCreateFieldOptions, type FieldFlags } from './formOptions';
import type { FormState } from './TaskForm';

export const CREATE_FIELD_OPTIONS_QUERY_KEY = ['youtrack', 'create-field-options'] as const;

export interface TaskFormOptions {
  /** Options for the form's current project, once applied; null otherwise. */
  options: CreateFieldOptions | null;
  /** The current project's options have been read and applied to the form. */
  ready: boolean;
  loading: boolean;
  error: string | null;
  retry: () => void;
  /** Re-read the project's options and re-apply them (clears stale values). */
  refresh: () => void;
  flags: FieldFlags;
  inboxNote: boolean;
  /** Record a user's own choice for a field. */
  touch: (key: CreateFieldKey) => void;
}

export function useTaskFormOptions(
  workspaceId: string,
  projects: YouTrackProject[],
  form: FormState,
  setForm: React.Dispatch<React.SetStateAction<FormState>>,
  initial: { touched?: CreateFieldKey[]; fromAi?: CreateFieldKey[]; flags?: FieldFlags } = {},
): TaskFormOptions {
  const queryClient = useQueryClient();
  const projectId = form.projectId;
  const [touched, setTouched] = useState<Set<CreateFieldKey>>(() => new Set(initial.touched ?? []));
  const [fromAi, setFromAi] = useState<Set<CreateFieldKey>>(() => new Set(initial.fromAi ?? []));
  const [flags, setFlags] = useState<FieldFlags>(() => ({ ...(initial.flags ?? {}) }));
  const [inboxNote, setInboxNote] = useState(false);
  // The (project, read) last applied; a new project or a refresh re-applies.
  const [applied, setApplied] = useState<{ projectId: string; at: number } | null>(null);

  const query = useQuery({
    queryKey: [...CREATE_FIELD_OPTIONS_QUERY_KEY, workspaceId, projectId],
    enabled: Boolean(projectId),
    retry: false,
    staleTime: 60_000,
    queryFn: async () => {
      const r = await window.vermilian.getCreateFieldOptions({ workspaceId, projectId });
      if (!r.ok || !r.options) throw new Error(r.error ?? "Could not read this project's fields.");
      return r;
    },
  });

  const data = query.data;
  useEffect(() => {
    if (!data || data.projectId !== projectId || data.workspaceId !== workspaceId) return;
    if (applied && applied.projectId === projectId && applied.at === query.dataUpdatedAt) return;
    const options = data.options as CreateFieldOptions;
    const inbox = Boolean(projects.find((p) => p.id === projectId)?.name.toLowerCase().includes('inbox'));
    // Flags come from the form as rendered; the write re-applies to the
    // latest state, and does nothing if the form has moved to another project.
    if (form.projectId !== data.projectId) return;
    const r = applyCreateFieldOptions(form, options, touched, fromAi, inbox);
    setForm((prev) => (prev.projectId === data.projectId ? applyCreateFieldOptions(prev, options, touched, fromAi, inbox).form : prev));
    // A different project starts its flags afresh; the first apply keeps the
    // flags the AI review arrived with.
    const switched = applied !== null && applied.projectId !== projectId;
    setFlags((prev) => (switched ? r.flags : { ...prev, ...r.flags }));
    setInboxNote(r.inboxApplied);
    setApplied({ projectId, at: query.dataUpdatedAt });
  }, [data, form, projectId, workspaceId, query.dataUpdatedAt, applied, projects, setForm, touched, fromAi]);

  const touch = useCallback((key: CreateFieldKey) => {
    setTouched((prev) => (prev.has(key) ? prev : new Set(prev).add(key)));
    setFromAi((prev) => {
      if (!prev.has(key)) return prev;
      const next = new Set(prev);
      next.delete(key);
      return next;
    });
    setFlags((prev) => {
      if (!(key in prev)) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
    if (key === 'category') setInboxNote(false);
  }, []);

  const retry = useCallback(() => { void query.refetch(); }, [query]);
  const refresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: [...CREATE_FIELD_OPTIONS_QUERY_KEY, workspaceId, projectId] });
  }, [queryClient, workspaceId, projectId]);

  const ready = Boolean(
    projectId && data && data.projectId === projectId && applied?.projectId === projectId && applied.at === query.dataUpdatedAt,
  );
  return {
    options: ready ? (data?.options as CreateFieldOptions) : null,
    ready,
    loading: Boolean(projectId) && (query.isFetching || (!ready && !query.isError)),
    error: query.isError && !query.isFetching ? (query.error as Error).message : null,
    retry,
    refresh,
    flags,
    inboxNote,
    touch,
  };
}
