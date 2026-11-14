import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { VermilianConfig, YouTrackProject } from '../../../shared/workspace';
import type { ActiveWorkspaceContext } from '../../../shared/activeWorkspace';

export const WORKSPACE_CONFIG_QUERY_KEY = ['workspace', 'config'] as const;
// The per-machine active workspace and its backend context (VERM-46).
export const ACTIVE_WORKSPACE_QUERY_KEY = ['workspace', 'active'] as const;

export function useProjects() {
  return useQuery<YouTrackProject[]>({
    queryKey: ['youtrack', 'projects'],
    queryFn: () => window.vermilian.getProjects(),
    staleTime: 5 * 60 * 1000,
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
    mutationFn: (config: VermilianConfig) => window.vermilian.saveWorkspaceConfig(config),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: WORKSPACE_CONFIG_QUERY_KEY });
      void queryClient.invalidateQueries({ queryKey: ACTIVE_WORKSPACE_QUERY_KEY });
    },
  });
}
