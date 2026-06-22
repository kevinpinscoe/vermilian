import React, { useEffect, useState } from 'react';
import { Loader } from '@vibe/core';
import { useConfig, useCredentialStatus } from './features/settings/api';
import { SettingsView } from './features/settings/SettingsView';
import { AppShell } from './AppShell';
import { useThemeStore } from './stores/theme';
import styles from './App.module.css';

export function App() {
  const config = useConfig();
  const credStatus = useCredentialStatus();
  const initTheme = useThemeStore((s) => s.init);
  const [showSettings, setShowSettings] = useState(false);

  useEffect(() => {
    if (config.data) initTheme(config.data.theme);
  }, [config.data, initTheme]);

  if (config.isLoading || credStatus.isLoading) {
    return (
      <div className={styles.center}>
        <Loader size={40} />
      </div>
    );
  }

  const connected =
    Boolean(config.data?.youtrackUrl) && Boolean(credStatus.data?.hasYouTrackToken);

  if (!connected || showSettings) {
    return <SettingsView canCancel={connected} onClose={() => setShowSettings(false)} />;
  }

  return <AppShell onOpenSettings={() => setShowSettings(true)} />;
}
