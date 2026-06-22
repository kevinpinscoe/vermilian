import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { BoardConfig } from '../../../shared/boardConfig';
import { defaultBoardConfig, defaultKanbanView } from '../../../shared/boardConfig';

export function useBoardConfig(projectId: string | null) {
  return useQuery<BoardConfig>({
    queryKey: ['board-config', projectId],
    queryFn: async () => {
      if (!projectId) return defaultBoardConfig('');
      const config = await window.vermilian.getBoardConfig(projectId);
      // Migrate: silently add kanban view to configs that predate it
      if (!config.views.find((v) => v.type === 'kanban')) {
        const migrated = { ...config, views: [...config.views, defaultKanbanView()] };
        await window.vermilian.saveBoardConfig(migrated);
        return migrated;
      }
      return config;
    },
    enabled: Boolean(projectId),
    staleTime: 30_000,
  });
}

export function useSaveBoardConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (config: BoardConfig) => window.vermilian.saveBoardConfig(config),
    onMutate: async (config) => {
      // Optimistic update
      await qc.cancelQueries({ queryKey: ['board-config', config.boardId] });
      qc.setQueryData(['board-config', config.boardId], config);
    },
  });
}

export function useResetBoardConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (projectId: string) => window.vermilian.resetBoardConfig(projectId),
    onSuccess: (_r, projectId) => {
      void qc.invalidateQueries({ queryKey: ['board-config', projectId] });
    },
  });
}
