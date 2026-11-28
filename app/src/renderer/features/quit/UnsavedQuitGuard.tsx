import React, { useEffect, useMemo, useState } from 'react';
import { useIsMutating, useQueryClient } from '@tanstack/react-query';
import { Button, Modal, ModalBasicLayout, ModalContent, ModalHeader } from '@vibe/core';
import { unsavedQuitMessage, type UnsavedQuitRequest } from '../../../shared/quitGuard';
import { useUnsavedStore } from '../../stores/unsaved';
import { waitForSaves } from './waitForSaves';
import modalLayout from '../../components/ModalLayout.module.css';
import styles from './UnsavedQuitGuard.module.css';

/**
 * Quitting with unsaved changes (VERM-123, shared/quitGuard.ts).
 *
 * Tells the main process what a quit would lose — open editors with
 * unsubmitted changes, and saves still in flight — and answers its prompt:
 * Save and quit (each editor's own save, then every in-flight save, then the
 * main process's final flush), Quit without saving, or Cancel. A prompt about
 * closing the window on macOS reads "Save and close" / "Close without saving",
 * and its answer closes the window without quitting the app. Saves that are
 * merely in flight are waited for without asking; only a failure asks.
 *
 * Mounted at the top of the app, so it also covers Settings shown before the
 * app is connected.
 */
export function UnsavedQuitGuard() {
  const queryClient = useQueryClient();
  const drafts = useUnsavedStore((s) => s.drafts);
  const saving = useIsMutating();
  const labels = useMemo(() => [...new Set(Object.values(drafts).map((d) => d.label))], [drafts]);
  const labelsKey = labels.join('\u0000');

  const [request, setRequest] = useState<UnsavedQuitRequest | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    void window.vermilian.quitSetUnsavedState({ drafts: labels, saving });
    // labelsKey stands for labels.
  }, [labelsKey, saving]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    window.vermilian.onUnsavedQuitRequested((r) => {
      setError(null);
      setRequest(r);
      // Saves that are only in flight are waited for without a prompt.
      if (r.kind === 'unsaved' && r.state.drafts.length === 0) {
        setVisible(false);
        void saveAndQuit(false);
      } else {
        setVisible(true);
      }
    });
    // saveAndQuit reads the stores when it runs, not when this subscribes.
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function saveAndQuit(fromPrompt = true) {
    setBusy(true);
    setError(null);
    const failed: string[] = [];
    if (fromPrompt) {
      for (const d of Object.values(useUnsavedStore.getState().drafts)) {
        try {
          if (!(await d.save())) failed.push(d.label);
        } catch {
          failed.push(d.label);
        }
      }
    }
    const settled = await waitForSaves(queryClient);
    setBusy(false);
    if (failed.length) {
      setError(`${failed.join(', ')} could not be saved. Fix it and try again, or continue without saving.`);
      setVisible(true);
      return;
    }
    if (!settled.ok) {
      setError(`${settled.message} Try again, or continue without saving.`);
      setVisible(true);
      return;
    }
    setVisible(false);
    setRequest(null);
    await window.vermilian.quitProceed('save');
  }

  async function quitWithoutSaving() {
    setVisible(false);
    setRequest(null);
    await window.vermilian.quitProceed('discard');
  }

  function cancel() {
    setVisible(false);
    setRequest(null);
    setError(null);
  }

  if (!visible || !request) return null;
  const text = request.kind === 'save-failed' ? request.message : unsavedQuitMessage(request.state);
  // macOS: closing the window leaves the app running, and the answer says so.
  const closing = request.scope === 'window';

  return (
    <Modal id="unsaved-quit-modal" show onClose={busy ? () => undefined : cancel} size="small">
      <ModalBasicLayout className={modalLayout.layout}>
        <ModalHeader title={closing ? 'Save changes before closing?' : 'Save changes before quitting?'} />
        <ModalContent>
          <div data-testid="unsaved-quit-dialog">
            <p className={styles.text} data-testid="unsaved-quit-message">{text}</p>
            {error && <p className={styles.error} role="alert" data-testid="unsaved-quit-error">{error}</p>}
            <div className={styles.actions}>
              <Button kind="tertiary" data-testid="unsaved-quit-cancel" onClick={cancel} disabled={busy}>
                Cancel
              </Button>
              <Button kind="secondary" color="negative" data-testid="unsaved-quit-discard" onClick={() => void quitWithoutSaving()} disabled={busy}>
                {closing ? 'Close without saving' : 'Quit without saving'}
              </Button>
              <Button data-testid="unsaved-quit-save" onClick={() => void saveAndQuit()} loading={busy}>
                {closing ? 'Save and close' : 'Save and quit'}
              </Button>
            </div>
          </div>
        </ModalContent>
      </ModalBasicLayout>
    </Modal>
  );
}
