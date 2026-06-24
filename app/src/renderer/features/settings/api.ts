import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { AppConfig } from '../../../shared/config';

// Shared cache keys — every component that reads or invalidates these queries
// must import from here so there is never a key mismatch.
export const CONFIG_QUERY_KEY = ['config'] as const;
export const CRED_STATUS_QUERY_KEY = ['cred-status'] as const;

export function useConfig() {
  return useQuery({
    queryKey: CONFIG_QUERY_KEY,
    queryFn: () => window.vermilian.getConfig(),
  });
}

export function useCredentialStatus() {
  return useQuery({
    queryKey: CRED_STATUS_QUERY_KEY,
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
