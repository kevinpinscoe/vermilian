// A workspace's remembered sort on this computer (VERM-92, VERM-93), kept in
// app-config.json by workspace ID: `allTasksSorts` for All tasks (YouTrack's
// table and Jira's board), `kanbanSorts` for the Kanban view of YouTrack
// project boards. A local view setting only — never in a Runway snapshot,
// never written to the tracker — and saving it is the only write a sort
// change makes.

import { useQueryClient } from '@tanstack/react-query';
import type { AppConfig } from '../../../shared/config';
import { withRunwaySort, type RunwaySort } from '../../../shared/runwaySort';
import { CONFIG_QUERY_KEY, useConfig, useSaveConfig } from '../settings/api';

export type RememberedSortSetting = 'allTasksSorts' | 'kanbanSorts';

export function useRememberedSort(workspaceId: string, setting: RememberedSortSetting) {
  const config = useConfig();
  const saveConfig = useSaveConfig();
  const queryClient = useQueryClient();
  const saved: RunwaySort | null = (workspaceId && config.data?.[setting]?.[workspaceId]) || null;

  /** Saves this workspace's entry, or removes it with null. The cache follows at once. */
  function save(sort: RunwaySort | null) {
    if (!workspaceId || !config.data) return;
    const next = withRunwaySort(config.data[setting] ?? {}, workspaceId, sort);
    queryClient.setQueryData<AppConfig>(CONFIG_QUERY_KEY, (cur) => (cur ? { ...cur, [setting]: next } : cur));
    saveConfig.mutate({ [setting]: next });
  }

  return { saved, save, ready: Boolean(config.data) };
}
