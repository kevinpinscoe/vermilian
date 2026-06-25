import React, { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Heading, Button, Loader, AttentionBox, Toast, Modal, ModalContent, ModalHeader } from '@vibe/core';
import type { AppConfig } from '../../../shared/config';
import { DEFAULT_CONFIG } from '../../../shared/config';
import { useConfig, useCredentialStatus, CONFIG_QUERY_KEY, CRED_STATUS_QUERY_KEY } from './api';
import type { SettingsDraft, TestState } from './types';
import { friendlyYouTrackError, friendlyClaudeError } from './errors';
import { ConnectionSection } from './sections/ConnectionSection';
import { AISection } from './sections/AISection';
import { TimerPomodoroSection } from './sections/TimerPomodoroSection';
import { DailyNotesSection } from './sections/DailyNotesSection';
import { AppearanceSection } from './sections/AppearanceSection';
import { AdvancedSection } from './sections/AdvancedSection';
import styles from './SettingsView.module.css';

interface Props {
  canCancel: boolean;
  onClose: () => void;
}

function draftFromConfig(c: AppConfig): SettingsDraft {
  return {
    youtrackUrl: c.youtrackUrl,
    youtrackLogin: c.youtrackLogin,
    youtrackToken: '',
    youtrackTokenCommand: c.youtrackTokenCommand,
    youtrackTokenFile: c.youtrackTokenFile,
    claudeKey: '',
    claudeKeyCommand: c.claudeKeyCommand,
    claudeKeyFile: c.claudeKeyFile,
    modelForCreate: c.modelForCreate,
    modelForStandup: c.modelForStandup,
    pomodoro: { ...c.pomodoro },
    soundOnBlockEnd: c.soundOnBlockEnd,
    osNotifications: c.osNotifications,
    defaultWorklogType: c.defaultWorklogType,
    dailyNotesFolder: c.dailyNotesFolder,
  };
}

const FAIL_CLOSED_MSG =
  'Vermilian could not store your credentials. On Linux, install gnome-keyring or kwallet. On macOS, try restarting the app.';

const PLAINTEXT_SAVE_MSG =
  'Credentials saved, but system encryption is unavailable — tokens are stored as plain text with owner-only file permissions in your app data folder.';

export function SettingsView({ canCancel, onClose }: Props) {
  const { data: config } = useConfig();
  const { data: cred } = useCredentialStatus();
  const qc = useQueryClient();

  const [draft, setDraft] = useState<SettingsDraft | null>(null);
  const [saving, setSaving] = useState(false);
  const [failClosed, setFailClosed] = useState<string | null>(null);
  const [plaintextWarn, setPlaintextWarn] = useState(false);
  const [savedToast, setSavedToast] = useState(false);
  const [worklogTypes, setWorklogTypes] = useState<string[]>(['Development']);
  const [ytTest, setYtTest] = useState<TestState>({ status: 'idle' });
  const [claudeTest, setClaudeTest] = useState<TestState>({ status: 'idle' });
  const [confirmCancel, setConfirmCancel] = useState(false);

  useEffect(() => {
    if (config && !draft) setDraft(draftFromConfig(config));
  }, [config, draft]);

  useEffect(() => {
    void window.vermilian
      .getWorklogTypes({})
      .then((types) => setWorklogTypes(types.length ? types : ['Development']));
  }, []);

  if (!draft || !config || !cred) {
    return (
      <div className={styles.view}>
        <div className={styles.scroll}>
          <Loader size={32} />
        </div>
      </div>
    );
  }

  const update = (patch: Partial<SettingsDraft>) =>
    setDraft((d) => (d ? { ...d, ...patch } : d));

  async function testYouTrack() {
    if (!draft) return;
    setYtTest({ status: 'testing' });
    const res = await window.vermilian.testYouTrack({
      url: draft.youtrackUrl.trim(),
      token: draft.youtrackToken || undefined,
    });
    if (res.ok) {
      setYtTest({
        status: 'success',
        message: `Connected — logged in as ${res.displayName ?? 'user'}.`,
      });
    } else {
      setYtTest({ status: 'error', message: friendlyYouTrackError(res, draft.youtrackUrl.trim()) });
    }
  }

  async function testClaude() {
    if (!draft) return;
    setClaudeTest({ status: 'testing' });
    const res = await window.vermilian.testClaude({
      key: draft.claudeKey || undefined,
      model: draft.modelForCreate,
    });
    if (res.ok) {
      setClaudeTest({ status: 'success', message: 'Claude API key is valid.' });
    } else {
      setClaudeTest({ status: 'error', message: friendlyClaudeError(res.error) });
    }
  }

  async function handleSave() {
    if (!draft) return;
    setSaving(true);
    setFailClosed(null);
    setPlaintextWarn(false);

    try {
      await window.vermilian.saveConfig({
        youtrackUrl: draft.youtrackUrl.trim().replace(/\/+$/, ''),
        youtrackLogin: draft.youtrackLogin.trim(),
        youtrackTokenCommand: draft.youtrackTokenCommand.trim(),
        youtrackTokenFile: draft.youtrackTokenFile.trim(),
        claudeKeyCommand: draft.claudeKeyCommand.trim(),
        claudeKeyFile: draft.claudeKeyFile.trim(),
        modelForCreate: draft.modelForCreate,
        modelForStandup: draft.modelForStandup,
        pomodoro: draft.pomodoro,
        soundOnBlockEnd: draft.soundOnBlockEnd,
        osNotifications: draft.osNotifications,
        defaultWorklogType: draft.defaultWorklogType,
        dailyNotesFolder: draft.dailyNotesFolder,
      });

      let saveFailed = false;
      let usedPlaintext = false;
      if (draft.youtrackToken) {
        const r = await window.vermilian.saveYouTrackToken(draft.youtrackToken);
        if (!r.ok) saveFailed = true;
        else if (r.secure === false) usedPlaintext = true;
      }
      if (draft.claudeKey) {
        const r = await window.vermilian.saveClaudeKey(draft.claudeKey);
        if (!r.ok) saveFailed = true;
        else if (r.secure === false) usedPlaintext = true;
      }

      await qc.invalidateQueries({ queryKey: CONFIG_QUERY_KEY });
      await qc.invalidateQueries({ queryKey: CRED_STATUS_QUERY_KEY });
      setSaving(false);

      if (saveFailed) {
        setFailClosed(FAIL_CLOSED_MSG);
        return;
      }
      setDraft((d) => (d ? { ...d, youtrackToken: '', claudeKey: '' } : d));
      if (usedPlaintext) {
        setPlaintextWarn(true);
      } else {
        setSavedToast(true);
      }
      onClose();
    } catch {
      setSaving(false);
      setFailClosed('Save failed unexpectedly. Please try again.');
    }
  }

  async function handleReset() {
    await window.vermilian.saveConfig({
      modelForCreate: DEFAULT_CONFIG.modelForCreate,
      modelForStandup: DEFAULT_CONFIG.modelForStandup,
      pomodoro: { ...DEFAULT_CONFIG.pomodoro },
      soundOnBlockEnd: DEFAULT_CONFIG.soundOnBlockEnd,
      osNotifications: DEFAULT_CONFIG.osNotifications,
      defaultWorklogType: DEFAULT_CONFIG.defaultWorklogType,
      dailyNotesFolder: DEFAULT_CONFIG.dailyNotesFolder,
      theme: DEFAULT_CONFIG.theme,
    });
    await qc.invalidateQueries({ queryKey: ['config'] });
    setDraft((d) =>
      d
        ? {
            ...d,
            modelForCreate: DEFAULT_CONFIG.modelForCreate,
            modelForStandup: DEFAULT_CONFIG.modelForStandup,
            pomodoro: { ...DEFAULT_CONFIG.pomodoro },
            soundOnBlockEnd: DEFAULT_CONFIG.soundOnBlockEnd,
            osNotifications: DEFAULT_CONFIG.osNotifications,
            defaultWorklogType: DEFAULT_CONFIG.defaultWorklogType,
            dailyNotesFolder: DEFAULT_CONFIG.dailyNotesFolder,
          }
        : d,
    );
  }

  return (
    <div className={styles.view}>
      <div className={styles.scroll}>
        <Heading className={styles.header}>Settings</Heading>

        {!canCancel && (
          <AttentionBox
            type="informative"
            title="Connect your YouTrack instance to get started"
            text="Enter your YouTrack URL and a permanent token below, then click Save."
          />
        )}

        {failClosed && <AttentionBox type="negative" title="Credentials not saved" text={failClosed} />}

        <ConnectionSection draft={draft} update={update} hasToken={cred.hasYouTrackToken} onTest={testYouTrack} test={ytTest} />
        <AISection draft={draft} update={update} hasKey={cred.hasClaudeKey} onTest={testClaude} test={claudeTest} />
        <TimerPomodoroSection draft={draft} update={update} worklogTypes={worklogTypes} />
        <DailyNotesSection draft={draft} update={update} />
        <AppearanceSection />
        <AdvancedSection onReset={handleReset} />
      </div>

      <div className={styles.footer}>
        <Button kind="tertiary" color="negative" onClick={() => window.vermilian.quitApp()} disabled={saving}>
          {canCancel ? 'Exit' : 'Quit Vermilian'}
        </Button>
        <span className={styles.version}>v{__APP_VERSION__}</span>
        <div className={styles.footerActions}>
          {canCancel && (
            <Button
              kind="tertiary"
              onClick={() => {
                // Guard against silently dropping a typed-but-unsaved token/key.
                if (draft.youtrackToken || draft.claudeKey) setConfirmCancel(true);
                else onClose();
              }}
              disabled={saving}
            >
              Cancel
            </Button>
          )}
          <Button data-testid="settings-save-btn" kind="primary" onClick={handleSave} loading={saving}>
            Save
          </Button>
        </div>
      </div>

      {savedToast && (
        <Toast open={savedToast} type="positive" autoHideDuration={3000} onClose={() => setSavedToast(false)}>
          Settings saved.
        </Toast>
      )}

      {plaintextWarn && (
        <Toast open={plaintextWarn} type="warning" autoHideDuration={8000} onClose={() => setPlaintextWarn(false)}>
          {PLAINTEXT_SAVE_MSG}
        </Toast>
      )}

      {confirmCancel && (
        <Modal id="discard-credentials-modal" show onClose={() => setConfirmCancel(false)} size="small">
          <ModalHeader title="Discard unsaved changes?" />
          <ModalContent>
            <p className={styles.confirmText}>
              You’ve typed an API token or key that hasn’t been saved. Closing Settings will discard it.
            </p>
            <div className={styles.confirmActions}>
              <Button kind="tertiary" onClick={() => setConfirmCancel(false)}>Keep editing</Button>
              <Button color="negative" onClick={() => { setConfirmCancel(false); onClose(); }}>
                Discard changes
              </Button>
            </div>
          </ModalContent>
        </Modal>
      )}
    </div>
  );
}
