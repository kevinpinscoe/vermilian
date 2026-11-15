import React, { useEffect, useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { ThemeProvider } from '@vibe/core';
import { useThemeStore, resolveThemeClass } from './stores/theme';
import { applyPalette } from './theme';
import { ToastStack } from './components/ToastStack';
import { useToastStore } from './stores/toast';
import styles from './providers.module.css';

// No cache persistence in MVP — every launch refetches from YouTrack (ADR-0002).
const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: false },
  },
});

export function Providers({ children }: { children: React.ReactNode }) {
  const setting = useThemeStore((s) => s.setting);
  const [themeClass, setThemeClass] = useState(() => {
    const cls = resolveThemeClass(setting);
    applyPalette(cls);
    return cls;
  });

  useEffect(() => {
    const cls = resolveThemeClass(setting);
    setThemeClass(cls);
    applyPalette(cls);
  }, [setting]);

  // When the main process finishes loading the _vermilian-config article, invalidate
  // all workspace and board-config queries so the renderer picks up remote changes.
  useEffect(() => {
    window.vermilian.onConfigSynced(() => {
      void queryClient.invalidateQueries({ queryKey: ['workspace', 'config'] });
      void queryClient.invalidateQueries({ queryKey: ['board-config'] });
    });
  }, []);

  // Surface config-sync lifecycle events as toasts. The write-failure toast is
  // persistent (durationMs 0) and dismissed once the write recovers.
  const showToast = useToastStore((s) => s.show);
  const dismissToast = useToastStore((s) => s.dismiss);
  useEffect(() => {
    let failureToastId: number | null = null;
    // One storage-blocked toast at a time, and not persistent: a refused write
    // can repeat on every save, and a stack of sticky toasts would cover the
    // top-bar Settings gear, which must stay reachable (VERM-53).
    let blockedToastId: number | null = null;
    window.vermilian.onSyncStatus((status) => {
      switch (status.kind) {
        case 'write-failed':
          if (failureToastId === null) {
            failureToastId = showToast('negative', 'Could not sync configuration — retrying.');
          }
          break;
        case 'write-recovered':
          if (failureToastId !== null) {
            dismissToast(failureToastId);
            failureToastId = null;
          }
          showToast('positive', 'Configuration synced.');
          break;
        case 'remote-newer':
          showToast('warning', 'Configuration was updated on another machine — changes merged.');
          break;
        case 'storage-blocked':
          if (blockedToastId !== null) dismissToast(blockedToastId);
          blockedToastId = showToast('negative', status.message, 8000);
          break;
        case 'version-too-high':
          showToast(
            'negative',
            'This Vermilian install is older than the configuration stored in YouTrack. Update Vermilian.',
          );
          break;
      }
    });
  }, [showToast, dismissToast]);

  return (
    <QueryClientProvider client={queryClient}>
      {/* ThemeProvider renders its own wrapping <div> with no height of its own.
          Without `className` it sits between #root and .fill as an auto-height
          ancestor, so every `height: 100%` below it resolves to auto and the
          whole shell becomes content-sized — which collapsed the absolutely
          positioned nav rail to ~22px whenever the board area held nothing but
          the one-line "Select a project" placeholder (i.e. an empty workspace). */}
      <ThemeProvider className={styles.fill}>
        <div className={`${themeClass} ${styles.fill}`}>
          {children}
          <ToastStack />
          <ReactQueryDevtools initialIsOpen={false} />
        </div>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
