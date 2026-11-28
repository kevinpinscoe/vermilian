import type { QueryClient } from '@tanstack/react-query';

export type SavesSettled = { ok: true } | { ok: false; message: string };

/**
 * Waits for every in-flight save (React Query mutation) to finish, and
 * reports whether any of them failed while it waited (VERM-123).
 */
export async function waitForSaves(queryClient: QueryClient, timeoutMs = 15_000): Promise<SavesSettled> {
  let failures = 0;
  const unsubscribe = queryClient.getMutationCache().subscribe((event) => {
    if (event.type === 'updated' && event.action.type === 'error') failures += 1;
  });
  try {
    const started = Date.now();
    while (queryClient.isMutating() > 0 && Date.now() - started < timeoutMs) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  } finally {
    unsubscribe();
  }
  if (queryClient.isMutating() > 0) return { ok: false, message: 'Some changes are still being saved.' };
  if (failures === 1) return { ok: false, message: 'A change could not be saved.' };
  if (failures > 1) return { ok: false, message: `${failures} changes could not be saved.` };
  return { ok: true };
}
