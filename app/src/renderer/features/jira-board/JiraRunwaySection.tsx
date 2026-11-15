// The Priority Desk section of a Jira issue's detail panel (VERM-38): its
// Focus star and rank, and its Why now. These are Vermilian's own Runway
// metadata, kept in the local store for this workspace; the panel's Jira
// fields above stay read-only and nothing here is written to Jira.
import React, { useState } from 'react';
import { Button } from '@vibe/core';
import { JiraFocusControl } from './JiraFocusControl';
import { runwayEntryFor, useJiraRunway, useJiraRunwayMutations } from './jiraRunway';
import styles from './JiraIssueDetailPanel.module.css';

interface JiraRunwaySectionProps {
  workspaceId: string;
  issueKey: string;
}

export function JiraRunwaySection({ workspaceId, issueKey }: JiraRunwaySectionProps) {
  const { index, isLoading } = useJiraRunway(workspaceId);
  const saved = runwayEntryFor(index, issueKey).whyNow ?? '';

  return (
    <section className={styles.section} data-testid="jira-runway-section">
      <h4 className={styles.sectionTitle}>Priority Desk</h4>
      <p className={styles.runwayNote}>Kept in Vermilian on this computer, not in Jira.</p>
      <div className={styles.runwayFocusRow}>
        <JiraFocusControl workspaceId={workspaceId} issueKey={issueKey} size="medium" />
      </div>
      {/* Keyed on the stored value, so a save (or another surface's change)
          resets the draft to what the store now holds. */}
      {!isLoading && <WhyNowEditor key={saved} workspaceId={workspaceId} issueKey={issueKey} saved={saved} />}
    </section>
  );
}

function WhyNowEditor({ workspaceId, issueKey, saved }: JiraRunwaySectionProps & { saved: string }) {
  const { update } = useJiraRunwayMutations(workspaceId);
  const [draft, setDraft] = useState(saved);
  const [busy, setBusy] = useState(false);
  const changed = draft.trim() !== saved;

  async function save() {
    setBusy(true);
    try {
      // An empty Why now is stored as none (shared/runway.ts).
      await update(issueKey, { whyNow: draft.trim() });
    } catch {
      // Toasted by the mutation; the draft stays for another try.
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.runwayWhyNow}>
      <label className={styles.fieldLabel} htmlFor={`jira-why-now-${issueKey}`}>Why now</label>
      <textarea
        id={`jira-why-now-${issueKey}`}
        className={styles.runwayWhyNowInput}
        value={draft}
        rows={2}
        placeholder="Why this matters now"
        onChange={(e) => setDraft(e.target.value)}
        data-testid="jira-why-now-input"
      />
      <div>
        <Button size="small" onClick={() => void save()} disabled={!changed || busy} data-testid="jira-why-now-save">
          Save
        </Button>
      </div>
    </div>
  );
}
