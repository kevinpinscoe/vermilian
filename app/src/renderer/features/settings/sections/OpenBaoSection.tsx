// Settings → OpenBao credential storage (VERM-64): one scope at a time, either
// this machine's Settings credentials or the active workspace. Secrets never
// reach this component except a value the user types to store; everything else
// is status from the main process.

import { useEffect, useState } from 'react';
import { Heading, Button, AttentionBox, Modal, ModalContent, ModalHeader, TextField } from '@vibe/core';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  DEFAULT_OPENBAO_CONNECTION,
  type OpenBaoConnection,
  type OpenBaoScope,
  type OpenBaoTestResult,
} from '../../../../shared/openbao';
import { OPENBAO_STATE_QUERY_KEY, CRED_STATUS_QUERY_KEY } from '../api';
import styles from '../SettingsView.module.css';

type Outcome = { tone: 'positive' | 'negative'; text: string } | null;
type Confirm = { kind: 'deactivate' | 'delete' | 'cleanup'; ref: string } | null;

const CONFIRM_TEXT: Record<NonNullable<Confirm>['kind'], { title: string; text: string; action: string }> = {
  deactivate: {
    title: 'Stop using OpenBao for this credential?',
    text: 'Vermilian goes back to this credential’s command, file or saved value. The copy in OpenBao is kept.',
    action: 'Stop using OpenBao',
  },
  delete: {
    title: 'Delete this credential from OpenBao?',
    text: 'The field is removed from OpenBao. If it is the only field, the secret version is soft-deleted.',
    action: 'Delete from OpenBao',
  },
  cleanup: {
    title: 'Remove the saved local copy?',
    text: 'The encrypted copy on this machine is deleted. A configured command or file is left as it is.',
    action: 'Remove local copy',
  },
};

export function OpenBaoSection() {
  const qc = useQueryClient();
  const [scope, setScope] = useState<OpenBaoScope>('settings');
  const state = useQuery({
    queryKey: [...OPENBAO_STATE_QUERY_KEY, scope],
    queryFn: () => window.vermilian.openbaoGetState(scope),
  });
  const [draft, setDraft] = useState<OpenBaoConnection>(DEFAULT_OPENBAO_CONNECTION);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome>(null);
  const [test, setTest] = useState<OpenBaoTestResult | null>(null);
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [values, setValues] = useState<Record<string, string>>({});

  const loaded = state.data?.connection ?? null;
  useEffect(() => {
    setDraft(loaded ?? DEFAULT_OPENBAO_CONNECTION);
  }, [loaded, scope]);

  useEffect(() => {
    setTest(null);
    setOutcome(null);
  }, [scope]);

  const setAuth = (patch: Partial<OpenBaoConnection['auth']>) => setDraft((d) => ({ ...d, auth: { ...d.auth, ...patch } }));

  async function refresh() {
    await qc.invalidateQueries({ queryKey: OPENBAO_STATE_QUERY_KEY });
    await qc.invalidateQueries({ queryKey: CRED_STATUS_QUERY_KEY });
  }

  async function run(action: () => Promise<{ ok: boolean; message: string }>) {
    setBusy(true);
    setOutcome(null);
    try {
      const r = await action();
      setOutcome({ tone: r.ok ? 'positive' : 'negative', text: r.message });
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  async function handleTest() {
    setBusy(true);
    setOutcome(null);
    try {
      setTest(await window.vermilian.openbaoTest(scope));
    } finally {
      setBusy(false);
    }
  }

  async function handleConfirm() {
    if (!confirm) return;
    const { kind, ref } = confirm;
    setConfirm(null);
    await run(() =>
      kind === 'deactivate'
        ? window.vermilian.openbaoDeactivate(scope, ref)
        : kind === 'delete'
          ? window.vermilian.openbaoDeleteSecret(scope, ref, { confirmed: true })
          : window.vermilian.openbaoCleanupOriginal(scope, ref, { confirmed: true }),
    );
  }

  async function handleStore(ref: string) {
    const value = values[ref] ?? '';
    await run(() => window.vermilian.openbaoSaveSecret(scope, ref, value));
    setValues((v) => ({ ...v, [ref]: '' }));
  }

  const v = state.data;
  const pending = v?.references.filter((r) => !r.active && r.original !== null).map((r) => r.credentialRef) ?? [];

  return (
    <section className={styles.card} data-testid="openbao-section">
      <Heading>OpenBao credential storage</Heading>
      <p className={styles.hint}>
        Keeps credentials in your own OpenBao server, so they do not depend on this build’s access to the system keychain.
        If OpenBao is unavailable, operations that need a credential stop; Vermilian never switches to another store.
      </p>

      <label className={styles.hint}>
        Applies to{' '}
        <select data-testid="openbao-scope" value={scope} onChange={(e) => setScope(e.target.value as OpenBaoScope)}>
          <option value="settings">This machine’s Settings credentials</option>
          <option value="workspace">The active workspace</option>
        </select>
      </label>

      {v && !v.available && <AttentionBox type="warning" title="Not available" text={v.label} />}
      {outcome && <AttentionBox data-testid="openbao-outcome" type={outcome.tone} title={outcome.tone === 'positive' ? 'Done' : 'Not completed'} text={outcome.text} />}
      {test && (
        <div data-testid="openbao-test-result" data-status={test.status}>
          <AttentionBox
            type={test.status === 'connected' ? 'positive' : 'negative'}
            title={test.status === 'connected' ? 'Connection works' : 'Connection problem'}
            text={test.message}
          />
        </div>
      )}

      {v?.available && (
        <>
          <p className={styles.hint} data-testid="openbao-scope-label">{v.label}</p>
          <TextField data-testid="openbao-url" title="Server address" placeholder="https://openbao.example.com" value={draft.url} onChange={(x) => setDraft((d) => ({ ...d, url: x }))} />
          <TextField data-testid="openbao-namespace" title="Namespace (optional)" value={draft.namespace} onChange={(x) => setDraft((d) => ({ ...d, namespace: x }))} />
          <TextField data-testid="openbao-mount" title="KV v2 mount" value={draft.kvMount} onChange={(x) => setDraft((d) => ({ ...d, kvMount: x }))} />
          <TextField data-testid="openbao-prefix" title="Secret path" value={draft.pathPrefix} onChange={(x) => setDraft((d) => ({ ...d, pathPrefix: x }))} />
          <label className={styles.hint}>
            Sign in with{' '}
            <select
              data-testid="openbao-auth-method"
              value={draft.auth.method}
              onChange={(e) => setAuth({ method: e.target.value === 'token' ? 'token' : 'approle' })}
            >
              <option value="approle">AppRole</option>
              <option value="token">Short-lived token</option>
            </select>
          </label>
          {draft.auth.method === 'approle' && (
            <>
              <TextField data-testid="openbao-approle-mount" title="AppRole mount" value={draft.auth.approleMount} onChange={(x) => setAuth({ approleMount: x })} />
              <TextField data-testid="openbao-role-id" title="RoleID" value={draft.auth.roleId} onChange={(x) => setAuth({ roleId: x })} />
            </>
          )}
          <TextField
            data-testid="openbao-secret-command"
            title={draft.auth.method === 'approle' ? 'Command that prints the SecretID' : 'Command that prints the token'}
            value={draft.auth.secretCommand}
            onChange={(x) => setAuth({ secretCommand: x })}
          />
          <TextField
            data-testid="openbao-secret-file"
            title={draft.auth.method === 'approle' ? 'Or a file holding the SecretID' : 'Or a file holding the token'}
            value={draft.auth.secretFile}
            onChange={(x) => setAuth({ secretFile: x })}
          />
          <div className={styles.inline}>
            <Button data-testid="openbao-save" kind="secondary" disabled={busy} onClick={() => void run(() => window.vermilian.openbaoSaveConnection(scope, draft))}>
              Use this connection
            </Button>
            <Button data-testid="openbao-test" kind="tertiary" disabled={busy || !loaded} onClick={() => void handleTest()}>
              Test connection
            </Button>
            <Button data-testid="openbao-migrate" kind="tertiary" disabled={busy || !loaded || pending.length === 0} onClick={() => void run(() => window.vermilian.openbaoMigrate(scope, pending))}>
              Move credentials to OpenBao
            </Button>
          </div>

          {v.references.map((r) => (
            <div key={r.credentialRef} data-testid={`openbao-ref-${r.credentialRef}`} data-active={r.active}>
              <p className={styles.hint}>
                <strong>{r.credentialRef}</strong>: {r.active ? 'using OpenBao' : 'not using OpenBao'}
                {r.original ? ` (local source: ${r.original})` : ' (no local source)'}
              </p>
              <div className={styles.inline}>
                <TextField
                  data-testid={`openbao-value-${r.credentialRef}`}
                  type="password"
                  placeholder="Paste a value to store in OpenBao"
                  value={values[r.credentialRef] ?? ''}
                  onChange={(x) => setValues((m) => ({ ...m, [r.credentialRef]: x }))}
                />
                <Button kind="tertiary" disabled={busy || !loaded || !(values[r.credentialRef] ?? '').trim()} onClick={() => void handleStore(r.credentialRef)}>
                  Store
                </Button>
                {r.active && (
                  <Button kind="tertiary" disabled={busy} onClick={() => setConfirm({ kind: 'deactivate', ref: r.credentialRef })}>
                    Stop using OpenBao
                  </Button>
                )}
                {r.active && r.original === 'safeStorage' && (
                  <Button kind="tertiary" disabled={busy} onClick={() => setConfirm({ kind: 'cleanup', ref: r.credentialRef })}>
                    Remove local copy
                  </Button>
                )}
                {!r.active && loaded && (
                  <Button kind="tertiary" disabled={busy} onClick={() => setConfirm({ kind: 'delete', ref: r.credentialRef })}>
                    Delete from OpenBao
                  </Button>
                )}
              </div>
            </div>
          ))}
        </>
      )}

      {confirm && (
        <Modal id="openbao-confirm" show onClose={() => setConfirm(null)}>
          <ModalHeader title={CONFIRM_TEXT[confirm.kind].title} />
          <ModalContent>
            <p>{CONFIRM_TEXT[confirm.kind].text}</p>
            <div className={styles.inline}>
              <Button kind="tertiary" onClick={() => setConfirm(null)}>Cancel</Button>
              <Button data-testid="openbao-confirm-btn" color="negative" onClick={() => void handleConfirm()}>
                {CONFIRM_TEXT[confirm.kind].action}
              </Button>
            </div>
          </ModalContent>
        </Modal>
      )}
    </section>
  );
}
