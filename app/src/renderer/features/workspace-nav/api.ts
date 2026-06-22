import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { VermilianConfig, YouTrackProject } from '../../../shared/workspace';

export function useProjects() {
  return useQuery<YouTrackProject[]>({
    queryKey: ['youtrack', 'projects'],
    queryFn: () => window.vermilian.getProjects(),
    staleTime: 5 * 60 * 1000,
  });
}

export function useWorkspaceConfig() {
  return useQuery<VermilianConfig | null>({
    queryKey: ['workspace', 'config'],
    queryFn: () => window.vermilian.getWorkspaceConfig(),
  });
}

export function useSaveWorkspaceConfig() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (config: VermilianConfig) => window.vermilian.saveWorkspaceConfig(config),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['workspace', 'config'] });
    },
  });
}
