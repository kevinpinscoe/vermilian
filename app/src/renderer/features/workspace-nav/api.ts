import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { VermilianConfig, YouTrackProject } from '../../../shared/workspace';
import type { ActiveWorkspaceContext } from '../../../shared/activeWorkspace';
import { useToastStore } from '../../stores/toast';

export const WORKSPACE_CONFIG_QUERY_KEY = ['workspace', 'config'] as const;
// The per-machine active workspace and its backend context (VERM-46).
export const ACTIVE_WORKSPACE_QUERY_KEY = ['workspace', 'active'] as const;

// The YouTrack project list. Import this rather than writing the array inline,
// so every invalidation names the key the hook registers.
export const PROJECTS_QUERY_KEY = ['youtrack', 'projects'] as const;

export function useProjects() {
  return useQuery<YouTrackProject[]>({
    queryKey: PROJECTS_QUERY_KEY,
    queryFn: () => window.vermilian.getProjects(),
    // The rail that holds this query never unmounts, so before VERM-120 a
    // project renamed in YouTrack kept its old name until Force resync or a
    // restart. Coming back to the window now refetches once the list is a
    // minute old; the Add projects dialog also refetches whenever it opens.
    staleTime: 60 * 1000,
    refetchOnWindowFocus: true,
  });
}

export function useWorkspaceConfig() {
  return useQuery<VermilianConfig | null>({
    queryKey: WORKSPACE_CONFIG_QUERY_KEY,
    queryFn: () => window.vermilian.getWorkspaceConfig(),
  });
}

export function useActiveWorkspace() {
  return useQuery<ActiveWorkspaceContext>({
    queryKey: ACTIVE_WORKSPACE_QUERY_KEY,
    queryFn: () => window.vermilian.getActiveWorkspace(),
  });
}

export function useSaveWorkspaceConfig() {
  const queryClient = useQueryClient();
  return useMutation({
    // A refusal resolves with ok: false, so it has to be raised here or the
    // user never learns the change was not saved (VERM-72).
    mutationFn: async (config: VermilianConfig) => {
      const result = await window.vermilian.saveWorkspaceConfig(config);
      if (!result.ok) throw new Error(result.error ?? 'The workspace change could not be saved.');
      return result;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: WORKSPACE_CONFIG_QUERY_KEY });
      void queryClient.invalidateQueries({ queryKey: ACTIVE_WORKSPACE_QUERY_KEY });
    },
    onError: (error) => {
      useToastStore.getState().show('negative', error.message);
      void queryClient.invalidateQueries({ queryKey: WORKSPACE_CONFIG_QUERY_KEY });
    },
  });
}
