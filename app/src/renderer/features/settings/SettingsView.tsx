import React, { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Heading, Button, Loader, AttentionBox, Toast, Modal, ModalContent, ModalHeader } from '@vibe/core';
import type { AppConfig } from '../../../shared/config';
import type { CredentialKind } from '../../../shared/ipc';
import { DEFAULT_CONFIG } from '../../../shared/config';
import {
  useConfig,
  useCredentialStatus,
  useJiraProfile,
  CONFIG_QUERY_KEY,
  CRED_STATUS_QUERY_KEY,
  JIRA_PROFILE_QUERY_KEY,
} from './api';
import type { JiraProfile } from '../../../shared/jiraProfile';
import type { SettingsDraft, TestState } from './types';
import { friendlyYouTrackError, friendlyClaudeError, describeJiraTest } from './errors';
import { ConnectionSection } from './sections/ConnectionSection';
import { AISection } from './sections/AISection';
import { JiraSection } from './sections/JiraSection';
import { TimerPomodoroSection } from './sections/TimerPomodoroSection';
import { DailyNotesSection } from './sections/DailyNotesSection';
import { AppearanceSection } from './sections/AppearanceSection';
import { AdvancedSection } from './sections/AdvancedSection';
import { WorkspaceStorageSection } from './sections/WorkspaceStorageSection';
import { ACTIVE_WORKSPACE_QUERY_KEY } from '../workspace-nav/api';
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
    jiraSiteUrl: '',
    jiraEmail: '',
    jiraCloudId: '',
    jiraToken: '',
    jiraTokenCommand: c.jiraTokenCommand,
    jiraTokenFile: c.jiraTokenFile,
    modelForCreate: c.modelForCreate,
    modelForStandup: c.modelForStandup,
    pomodoro: { ...c.pomodoro },
    soundOnBlockEnd: c.soundOnBlockEnd,
    osNotifications: c.osNotifications,
    defaultWorklogType: c.defaultWorklogType,
    dailyNotesFolder: c.dailyNotesFolder,
  };
}

// True when the Jira fields differ from the profile loaded from YouTrack, so
// Save writes the shared Article only when there is something to write.
function jiraProfileChanged(d: SettingsDraft, loaded: JiraProfile | null): boolean {
  return (
    d.jiraSiteUrl.trim() !== (loaded?.siteUrl ?? '') ||
    d.jiraEmail.trim() !== (loaded?.email ?? '') ||
    d.jiraCloudId.trim() !== (loaded?.cloudId ?? '')
  );
}

// Vermilian never stores a pasted credential unencrypted (VERM-57).
const FAIL_CLOSED_MSG =
  'Vermilian could not encrypt your credentials with the system keychain, so it did not store them. Use a shell command or a file as the source instead. On Linux, installing gnome-keyring or kwallet also fixes this; on macOS, try restarting the app.';

const CREDENTIAL_LABEL: Record<CredentialKind, string> = {
  youtrack: 'YouTrack token',
  claude: 'Claude API key',
  jira: 'Jira API token',
};

function credentialList(kinds: CredentialKind[]): string {
  return kinds.map((k) => CREDENTIAL_LABEL[k]).join(', ');
}

export function SettingsView({ canCancel, onClose }: Props) {
  const { data: config } = useConfig();
  const { data: cred } = useCredentialStatus();
  const { data: jiraProfile, isFetched: jiraProfileFetched } = useJiraProfile();
  const qc = useQueryClient();

  const [draft, setDraft] = useState<SettingsDraft | null>(null);
  const [saving, setSaving] = useState(false);
  const [failClosed, setFailClosed] = useState<string | null>(null);
  const [encrypting, setEncrypting] = useState(false);
  const [encryptFailed, setEncryptFailed] = useState(false);
  const [savedToast, setSavedToast] = useState(false);
  const [worklogTypes, setWorklogTypes] = useState<string[]>(['Development']);
  const [ytTest, setYtTest] = useState<TestState>({ status: 'idle' });
  const [claudeTest, setClaudeTest] = useState<TestState>({ status: 'idle' });
  const [jiraTest, setJiraTest] = useState<TestState>({ status: 'idle' });
  const [jiraLoaded, setJiraLoaded] = useState(false);
  const [jiraSaveError, setJiraSaveError] = useState<string | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);

  useEffect(() => {
    if (config && !draft) setDraft(draftFromConfig(config));
  }, [config, draft]);

  // The Jira profile arrives from YouTrack after the draft is built; fill it
  // in once, so a later refetch never overwrites what the user has typed.
  useEffect(() => {
    if (!draft || jiraLoaded || !jiraProfileFetched) return;
    setDraft((d) =>
      d
        ? {
            ...d,
            jiraSiteUrl: jiraProfile?.siteUrl ?? '',
            jiraEmail: jiraProfile?.email ?? '',
            jiraCloudId: jiraProfile?.cloudId ?? '',
          }
        : d,
    );
    setJiraLoaded(true);
  }, [draft, jiraLoaded, jiraProfileFetched, jiraProfile]);

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

  async function testJira() {
    if (!draft) return;
    setJiraTest({ status: 'testing' });
    const res = await window.vermilian.testJira({
      profile: { siteUrl: draft.jiraSiteUrl, email: draft.jiraEmail, cloudId: draft.jiraCloudId },
      token: draft.jiraToken || undefined,
    });
    // Fill in a detected cloudId; it is saved with the profile on Save.
    if (res.cloudId && !draft.jiraCloudId.trim()) update({ jiraCloudId: res.cloudId });
    setJiraTest({ status: res.ok ? 'success' : 'error', message: describeJiraTest(res) });
  }

  async function handleSave() {
    if (!draft) return;
    setSaving(true);
    setFailClosed(null);
    setJiraSaveError(null);

    try {
      await window.vermilian.saveConfig({
        youtrackUrl: draft.youtrackUrl.trim().replace(/\/+$/, ''),
        youtrackLogin: draft.youtrackLogin.trim(),
        youtrackTokenCommand: draft.youtrackTokenCommand.trim(),
        youtrackTokenFile: draft.youtrackTokenFile.trim(),
        claudeKeyCommand: draft.claudeKeyCommand.trim(),
        claudeKeyFile: draft.claudeKeyFile.trim(),
        jiraTokenCommand: draft.jiraTokenCommand.trim(),
        jiraTokenFile: draft.jiraTokenFile.trim(),
        modelForCreate: draft.modelForCreate,
        modelForStandup: draft.modelForStandup,
        pomodoro: draft.pomodoro,
        soundOnBlockEnd: draft.soundOnBlockEnd,
        osNotifications: draft.osNotifications,
        defaultWorklogType: draft.defaultWorklogType,
        dailyNotesFolder: draft.dailyNotesFolder,
      });

      let saveFailed = false;
      if (draft.youtrackToken) {
        const r = await window.vermilian.saveYouTrackToken(draft.youtrackToken);
        if (!r.ok) saveFailed = true;
      }
      if (draft.claudeKey) {
        const r = await window.vermilian.saveClaudeKey(draft.claudeKey);
        if (!r.ok) saveFailed = true;
      }
      if (draft.jiraToken) {
        const r = await window.vermilian.saveJiraToken(draft.jiraToken);
        if (!r.ok) saveFailed = true;
      }

      // Blank Jira fields mean "not set up": never write an empty profile.
      let jiraError: string | null = null;
      const jiraAnyField = Boolean(draft.jiraSiteUrl.trim() || draft.jiraEmail.trim() || draft.jiraCloudId.trim());
      if (jiraLoaded && jiraAnyField && jiraProfileChanged(draft, jiraProfile ?? null)) {
        const r = await window.vermilian.saveJiraProfile({
          siteUrl: draft.jiraSiteUrl,
          email: draft.jiraEmail,
          cloudId: draft.jiraCloudId,
        });
        if (r.ok) {
          qc.setQueryData(JIRA_PROFILE_QUERY_KEY, r.profile);
        } else {
          jiraError = r.message;
        }
      }

      await qc.invalidateQueries({ queryKey: CONFIG_QUERY_KEY });
      await qc.invalidateQueries({ queryKey: CRED_STATUS_QUERY_KEY });
      // The active workspace's AI availability depends on the keys just saved (VERM-47).
      await qc.invalidateQueries({ queryKey: ACTIVE_WORKSPACE_QUERY_KEY });
      setSaving(false);

      if (saveFailed) {
        setFailClosed(FAIL_CLOSED_MSG);
        return;
      }
      setDraft((d) => (d ? { ...d, youtrackToken: '', claudeKey: '', jiraToken: '' } : d));
      // Stay open so the user can fix the profile; everything else is saved.
      if (jiraError) {
        setJiraSaveError(jiraError);
        return;
      }
      setSavedToast(true);
      onClose();
    } catch {
      setSaving(false);
      setFailClosed('Save failed unexpectedly. Please try again.');
    }
  }

  async function handleEncryptPlaintext() {
    setEncrypting(true);
    try {
      const r = await window.vermilian.encryptPlaintextCredentials();
      setEncryptFailed(r.failed > 0);
    } catch {
      setEncryptFailed(true);
    }
    await qc.invalidateQueries({ queryKey: CRED_STATUS_QUERY_KEY });
    setEncrypting(false);
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
            type="primary"
            title="Connect your YouTrack instance to get started"
            text="Enter your YouTrack URL and a permanent token below, then click Save."
          />
        )}

        {failClosed && <AttentionBox type="negative" title="Credentials not saved" text={failClosed} />}
        {cred.plaintext.length > 0 && (
          <div data-testid="plaintext-credentials">
            <AttentionBox
              type="warning"
              title="Credentials stored as plain text"
              text={
                cred.secure
                  ? `${credentialList(cred.plaintext)} ${cred.plaintext.length === 1 ? 'is' : 'are'} saved unencrypted by an earlier version of Vermilian. Encrypt ${cred.plaintext.length === 1 ? 'it' : 'them'} with the system keychain now.${encryptFailed ? ' The last attempt failed — paste and save the credential again.' : ''}`
                  : `${credentialList(cred.plaintext)} ${cred.plaintext.length === 1 ? 'is' : 'are'} saved unencrypted, and system encryption is unavailable. Switch to a shell command or file source, or fix the system keychain; Vermilian encrypts ${cred.plaintext.length === 1 ? 'it' : 'them'} at the next start once it works.`
              }
            />
            {cred.secure && (
              <Button size="small" onClick={handleEncryptPlaintext} loading={encrypting}>
                Encrypt now
              </Button>
            )}
          </div>
        )}
        {cred.undecryptable.length > 0 && (
          <AttentionBox
            data-testid="undecryptable-credentials"
            type="negative"
            title="Saved credentials cannot be decrypted"
            text={`The saved ${credentialList(cred.undecryptable)} can no longer be decrypted on this machine (the system keychain key may have changed). Paste and save ${cred.undecryptable.length === 1 ? 'it' : 'them'} again, or use a shell command or file source.`}
          />
        )}
        {jiraSaveError && (
          <AttentionBox
            data-testid="jira-save-error"
            type="negative"
            title="Jira profile not saved"
            text={`${jiraSaveError} Your other settings were saved.`}
          />
        )}

        <ConnectionSection draft={draft} update={update} hasToken={cred.hasYouTrackToken} onTest={testYouTrack} test={ytTest} />
        <AISection draft={draft} update={update} hasKey={cred.hasClaudeKey} onTest={testClaude} test={claudeTest} />
        <JiraSection draft={draft} update={update} hasToken={cred.hasJiraToken} onTest={testJira} test={jiraTest} />
        <TimerPomodoroSection draft={draft} update={update} worklogTypes={worklogTypes} />
        <DailyNotesSection draft={draft} update={update} />
        <AppearanceSection />
        {canCancel && <WorkspaceStorageSection />}
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
                if (draft.youtrackToken || draft.claudeKey || draft.jiraToken) setConfirmCancel(true);
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
