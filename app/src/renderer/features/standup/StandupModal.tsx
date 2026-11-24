import React, { useState } from 'react';
import { Modal, ModalBasicLayout, ModalContent, ModalHeader, Button, Text, Loader, Tooltip } from '@vibe/core';
import type { StandupWindow } from '../../../shared/config';
import { useToastStore } from '../../stores/toast';
import { useWorkspaceAi } from '../workspace-nav/useWorkspaceAi';
import styles from './StandupModal.module.css';

// Minimal markdown-to-HTML renderer for Claude's structured stand-up output.
// Only handles ## headings and - bullets (all Claude produces for this prompt).
function renderMarkdown(md: string): string {
  const lines = md.split('\n');
  const html: string[] = [];
  let inList = false;

  function esc(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  for (const line of lines) {
    if (line.startsWith('## ')) {
      if (inList) { html.push('</ul>'); inList = false; }
      html.push(`<h2>${esc(line.slice(3))}</h2>`);
    } else if (line.startsWith('- ')) {
      if (!inList) { html.push('<ul>'); inList = true; }
      html.push(`<li>${esc(line.slice(2))}</li>`);
    } else if (line.trim() === '') {
      if (inList) { html.push('</ul>'); inList = false; }
    } else if (line.trim()) {
      if (inList) { html.push('</ul>'); inList = false; }
      html.push(`<p>${esc(line)}</p>`);
    }
  }
  if (inList) html.push('</ul>');
  return html.join('');
}

function formatDate(d: Date): string {
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

function isoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function isoTime(d: Date): string {
  return d.toTimeString().slice(0, 5);
}

interface StandupModalProps {
  /** The active workspace — the only one a stand-up covers (VERM-48). */
  workspaceName: string;
  dailyNotesFolder: string;
  initialWindow: StandupWindow;
  onClose: () => void;
  onWindowChange: (window: StandupWindow) => void;
}

type Step = 'config' | 'loading' | 'report';

export function StandupModal({
  workspaceName,
  dailyNotesFolder,
  initialWindow,
  onClose,
  onWindowChange,
}: StandupModalProps) {
  const ai = useWorkspaceAi();
  const showToast = useToastStore((s) => s.show);

  const [window_, setWindow] = useState<StandupWindow>(initialWindow);
  const [customWindowHours, setCustomWindowHours] = useState(48);

  const [step, setStep] = useState<Step>('config');
  const [markdown, setMarkdown] = useState('');
  const [genError, setGenError] = useState<string | null>(null);
  const [noTasks, setNoTasks] = useState(false);
  // Incomplete status mappings from the last generate (VERM-114).
  const [mappingWarnings, setMappingWarnings] = useState<string[]>([]);

  const [copyLabel, setCopyLabel] = useState('Copy to clipboard');
  const [saveLabel, setSaveLabel] = useState('Save to daily notes');
  const [saving, setSaving] = useState(false);
  const [regenerating, setRegenerating] = useState(false);

  function handleWindowChange(w: StandupWindow) {
    setWindow(w);
    onWindowChange(w);
  }

  async function generate() {
    setGenError(null);
    setNoTasks(false);
    setStep('loading');

    const askedFrom = ai.workspaceId;
    const result = await window.vermilian.standupGenerate({
      window: window_,
      customWindowHours: window_ === 'custom' ? customWindowHours : undefined,
      workspaceId: askedFrom,
    });
    // Asked from a workspace the user has since left: drop the answer (VERM-47).
    if (!ai.isStillActive(askedFrom)) return;

    if (!result.ok) {
      setGenError(result.error ?? 'Stand-up generation failed.');
      setStep('config');
      return;
    }
    setMappingWarnings(result.warnings ?? []);

    if (result.taskCount === 0 || !result.markdown) {
      setNoTasks(true);
      setStep('config');
      return;
    }

    setMarkdown(result.markdown);
    setStep('report');
  }

  async function handleRegenerate() {
    setRegenerating(true);
    setGenError(null);
    setNoTasks(false);

    const askedFrom = ai.workspaceId;
    const result = await window.vermilian.standupGenerate({
      window: window_,
      customWindowHours: window_ === 'custom' ? customWindowHours : undefined,
      workspaceId: askedFrom,
    });
    // Asked from a workspace the user has since left: drop the answer (VERM-47).
    if (!ai.isStillActive(askedFrom)) return;

    setRegenerating(false);

    if (!result.ok) {
      setGenError(result.error ?? 'Regeneration failed.');
      return;
    }
    setMappingWarnings(result.warnings ?? []);
    if (result.taskCount === 0 || !result.markdown) {
      setNoTasks(true);
      return;
    }
    setMarkdown(result.markdown);
  }

  function handleCopy() {
    void navigator.clipboard.writeText(markdown);
    setCopyLabel('Copied ✓');
    setTimeout(() => setCopyLabel('Copy to clipboard'), 2000);
  }

  async function handleSave() {
    if (!dailyNotesFolder || saving) return;
    setSaving(true);
    const now = new Date();
    const result = await window.vermilian.standupSave({
      markdown,
      folder: dailyNotesFolder,
      dateStr: isoDate(now),
      timeStr: isoTime(now),
    });
    setSaving(false);
    if (!result.ok) {
      showToast('negative', result.error ?? 'Failed to save report.', 5000);
      return;
    }
    setSaveLabel('Saved ✓');
    setTimeout(() => setSaveLabel('Save to daily notes'), 2000);
  }

  const hasDailyFolder = Boolean(dailyNotesFolder);

  // ─── Config step ────────────────────────────────────────────────────────────

  if (step === 'config') {
    return (
      <Modal id="standup-modal" show onClose={onClose} size="medium">
        <ModalBasicLayout className={styles.layout}>
          <ModalHeader title="Daily Stand-Up" />
          <ModalContent>
            <div className={styles.configStep}>
              {genError && (
                <div className={styles.banner} data-kind="danger">
                  <Text type="text2">{genError}</Text>
                </div>
              )}
              {noTasks && (
                <div className={styles.banner} data-kind="info">
                  <Text type="text2">
                    No recent activity to report in this workspace. Try a longer window, or check that
                    tasks are up to date in YouTrack.
                  </Text>
                </div>
              )}
              <MappingWarnings warnings={mappingWarnings} />

              {/* Covers the active workspace only (VERM-48). */}
              <div className={styles.fieldset} data-testid="standup-workspace">
                <span className={styles.legend}>Workspace</span>
                <Text type="text2">
                  This stand-up covers <strong>{workspaceName || 'the current workspace'}</strong> only.
                </Text>
              </div>

              {/* Window */}
              <fieldset className={styles.fieldset}>
                <legend className={styles.legend}>Window for "Done"</legend>
                <div className={styles.windowButtons}>
                  {(
                    [
                      ['24h', '24h'],
                      ['48h', '48h'],
                      ['7d', '7d'],
                      ['custom', 'Custom'],
                    ] as [StandupWindow, string][]
                  ).map(([val, label]) => (
                    <button
                      key={val}
                      type="button"
                      className={`${styles.windowBtn} ${window_ === val ? styles.windowBtnActive : ''}`}
                      onClick={() => handleWindowChange(val)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                {window_ === 'custom' && (
                  <div className={styles.customWindowRow}>
                    <input
                      type="number"
                      min={1}
                      max={720}
                      value={customWindowHours}
                      onChange={(e) => setCustomWindowHours(Number(e.target.value))}
                      className={styles.customWindowInput}
                    />
                    <Text type="text2">hours</Text>
                  </div>
                )}
              </fieldset>

              <div className={styles.actions}>
                <Button kind="secondary" onClick={onClose} type="button">
                  Cancel
                </Button>
                <Button data-testid="standup-generate-btn" onClick={generate}>Generate</Button>
              </div>
            </div>
          </ModalContent>
        </ModalBasicLayout>
      </Modal>
    );
  }

  // ─── Loading step ────────────────────────────────────────────────────────────

  if (step === 'loading') {
    return (
      <Modal id="standup-modal" show onClose={onClose} size="medium">
        <ModalBasicLayout className={styles.layout}>
          <ModalHeader title="Daily Stand-Up" />
          <ModalContent>
            <div className={styles.loadingStep}>
              <Loader size={40} />
              <Text type="text1" className={styles.loadingText}>
                Generating report…
              </Text>
            </div>
          </ModalContent>
        </ModalBasicLayout>
      </Modal>
    );
  }

  // ─── Report step ─────────────────────────────────────────────────────────────

  const now = new Date();

  return (
    <Modal id="standup-modal" show onClose={onClose} size="large">
      <ModalBasicLayout className={styles.layout}>
        <ModalHeader
          title={`Daily Stand-Up — ${formatDate(now)}`}
        />
        <ModalContent>
          <div className={styles.reportStep}>
            {genError && (
              <div className={styles.banner} data-kind="danger">
                <Text type="text2">{genError}</Text>
                <Button size="small" kind="secondary" onClick={handleRegenerate} loading={regenerating}>
                  Retry
                </Button>
              </div>
            )}
            {noTasks && (
              <div className={styles.banner} data-kind="info">
                <Text type="text2">No recent activity found. The previous report is shown.</Text>
              </div>
            )}
            <MappingWarnings warnings={mappingWarnings} />

            <div
              data-testid="standup-report-body"
              className={styles.markdownBody}
                dangerouslySetInnerHTML={{ __html: renderMarkdown(markdown) }}
            />

            <div className={styles.reportActions}>
              <Button kind="secondary" onClick={handleRegenerate} loading={regenerating} size="small">
                Regenerate
              </Button>
              <div className={styles.actionsSpacer} />
              <Button kind="secondary" onClick={handleCopy} size="small">
                {copyLabel}
              </Button>
              <Tooltip
                content={
                  hasDailyFolder
                    ? 'Save to your daily notes folder'
                    : 'Configure a daily-notes folder in Settings to save reports.'
                }
              >
                <Button
                  kind="secondary"
                  onClick={handleSave}
                  disabled={!hasDailyFolder || saving}
                  loading={saving}
                  size="small"
                >
                  {saveLabel}
                </Button>
              </Tooltip>
              <Button onClick={onClose} size="small">
                Close
              </Button>
            </div>
          </div>
        </ModalContent>
      </ModalBasicLayout>
    </Modal>
  );
}

// Projects whose status mapping leaves a group empty (VERM-114). The groups
// that do have valid states are still reported; this says which are missing.
function MappingWarnings({ warnings }: { warnings: readonly string[] }) {
  if (warnings.length === 0) return null;
  return (
    <div className={styles.banner} data-kind="warning" data-testid="standup-mapping-warnings">
      <div>
        <Text type="text2">Some status mappings are incomplete, so part of this stand-up is missing:</Text>
        <ul className={styles.warningList}>
          {warnings.map((w) => (
            <li key={w}>
              <Text type="text2">{w}</Text>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
