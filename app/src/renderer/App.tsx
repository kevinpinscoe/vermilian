import React, { useEffect, useState } from 'react';
import { Loader } from '@vibe/core';
import { useConfig, useCredentialStatus } from './features/settings/api';
import { SettingsView } from './features/settings/SettingsView';
import { AppShell } from './AppShell';
import { useThemeStore } from './stores/theme';
import styles from './App.module.css';

export function App() {
  const { data: configData, isLoading: configLoading } = useConfig();
  const { data: credData, isLoading: credLoading } = useCredentialStatus();
  const initTheme = useThemeStore((s) => s.init);
  const [showSettings, setShowSettings] = useState(false);

  useEffect(() => {
    if (configData) initTheme(configData.theme);
  }, [configData, initTheme]);

  if (configLoading || credLoading) {
    return (
      <div className={styles.center}>
        <Loader size={40} />
      </div>
    );
  }

  const connected =
    Boolean(configData?.youtrackUrl) && Boolean(credData?.hasYouTrackToken);

  if (!connected || showSettings) {
    return <SettingsView canCancel={connected} onClose={() => setShowSettings(false)} />;
  }

  return <AppShell onOpenSettings={() => setShowSettings(true)} />;
}
