import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { AppConfig } from '../../../shared/config';

export function useConfig() {
  return useQuery({
    queryKey: ['config'],
    queryFn: () => window.vermilian.getConfig(),
  });
}

export function useCredentialStatus() {
  return useQuery({
    queryKey: ['cred-status'],
    queryFn: () => window.vermilian.credentialStatus(),
  });
}

export function useSaveConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: Partial<AppConfig>) => window.vermilian.saveConfig(patch),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['config'] });
    },
  });
}
