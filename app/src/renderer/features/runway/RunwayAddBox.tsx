// The Runway view's Add box (VERM-86): add a ticket to the active
// workspace's Runway by key, by link, or by picking a search result, at the
// end or at a chosen Runway #.
//
// Submitting (Add, or Enter) sends what was typed to the main process, which
// checks a link's host against the workspace's own tracker before any
// request, reads the exact key once on the workspace's own connection, and
// adds it through the write gate (runwayItemsAddByReference). The search is
// the workspace's ordinary scoped search (VERM-61): its projects, and a Jira
// workspace's boards. A pick from it is added the same way, by its key.
//
// The box belongs to one workspace: it is remounted when the workspace
// changes, and an answer that arrives for a workspace it no longer shows is
// ignored. The main process cancels such an add as well.

import React, { useEffect, useRef, useState } from 'react';
import { Button } from '@vibe/core';
import { useQueryClient } from '@tanstack/react-query';
import type { TrackerKind } from '../../../shared/tracker';
import type { RunwayAddByReferenceArgs, RunwayAddResult } from '../../../shared/runwayAdd';
import { looksLikeRunwayReference } from '../../../shared/runwayReference';
import { SEARCH_MIN_CHARS, searchScopeEnabled, useScopedIssueSearch, type SearchScope } from '../search/api';
import { RUNWAY_ITEMS_QUERY_KEY, RUNWAY_TICKETS_QUERY_KEY } from './api';
import { parseRunwayNumber } from './rows';
import styles from './RunwayView.module.css';

export interface RunwayAddBoxProps {
  workspaceId: string;
  tracker: TrackerKind;
  searchScope: SearchScope;
}

type Status =
  | { kind: 'idle' }
  | { kind: 'checking'; reference: string }
  | { kind: 'added'; message: string }
  | { kind: 'error'; message: string; retry: RunwayAddByReferenceArgs | null };

const MAX_RESULTS = 8;

export function RunwayAddBox({ workspaceId, tracker, searchScope }: RunwayAddBoxProps) {
  const queryClient = useQueryClient();
  const [text, setText] = useState('');
  const [numberText, setNumberText] = useState('');
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const [debounced, setDebounced] = useState('');
  const current = useRef(workspaceId);
  current.current = workspaceId;

  useEffect(() => {
    const t = setTimeout(() => setDebounced(text), 250);
    return () => clearTimeout(t);
  }, [text]);

  const term = debounced.trim();
  const searching = term.length >= SEARCH_MIN_CHARS && !looksLikeRunwayReference(term, tracker) && searchScopeEnabled(searchScope);
  const search = useScopedIssueSearch(searchScope, searching ? term : '');
  const results = searching ? (search.data ?? []).slice(0, MAX_RESULTS) : [];

  async function submit(args: RunwayAddByReferenceArgs) {
    setStatus({ kind: 'checking', reference: args.reference.trim() });
    let r: RunwayAddResult;
    try {
      r = await window.vermilian.runwayItemsAddByReference(args);
    } catch (e) {
      r = { ok: false, code: 'refresh-failed', error: String((e as { message?: unknown })?.message ?? e), retryable: true };
    }
    // The workspace changed while the check ran: this answer is not for the box on screen.
    if (current.current !== args.workspaceId) return;
    if (r.ok) {
      const added = r.items.find((i) => i.itemId === r.itemId);
      const key = r.itemId.slice(r.itemId.indexOf(':') + 1);
      setText('');
      setNumberText('');
      setStatus({ kind: 'added', message: `Added ${key}${added?.runwayNumber ? ` as #${added.runwayNumber}` : ''}.` });
      void queryClient.invalidateQueries({ queryKey: RUNWAY_ITEMS_QUERY_KEY(args.workspaceId) });
      void queryClient.invalidateQueries({ queryKey: RUNWAY_TICKETS_QUERY_KEY(args.workspaceId) });
    } else {
      setStatus({ kind: 'error', message: r.error, retry: r.retryable ? args : null });
    }
  }

  function addReference(reference: string) {
    const runwayNumber = parseRunwayNumber(numberText);
    if (runwayNumber === null) {
      setStatus({ kind: 'error', message: 'The Runway # must be a whole number of 1 or more.', retry: null });
      return;
    }
    void submit({ workspaceId, reference, ...(runwayNumber === undefined ? {} : { runwayNumber }) });
  }

  const checking = status.kind === 'checking';

  return (
    <div className={styles.addBox} data-testid="runway-add">
      <form
        className={styles.addForm}
        onSubmit={(e) => {
          e.preventDefault();
          if (!checking) addReference(text);
        }}
      >
        <input
          className={styles.addInput}
          data-testid="runway-add-input"
          aria-label="Ticket key, link or search"
          placeholder={tracker === 'jira' ? 'Add a ticket: key (OPS-7), Jira link, or search' : 'Add a ticket: key (READ-12), YouTrack link, or search'}
          value={text}
          disabled={checking}
          onChange={(e) => setText(e.target.value)}
        />
        <label className={styles.addAt}>
          at #
          <input
            className={styles.addNumber}
            data-testid="runway-add-number"
            aria-label="Runway number to add at (empty for the end)"
            inputMode="numeric"
            placeholder="end"
            value={numberText}
            disabled={checking}
            onChange={(e) => setNumberText(e.target.value)}
          />
        </label>
        <Button type="submit" size="small" disabled={checking || text.trim() === ''} data-testid="runway-add-submit">
          Add
        </Button>
      </form>

      {results.length > 0 && !checking && (
        <ul className={styles.addResults} data-testid="runway-add-results">
          {results.map((issue) => (
            <li key={issue.id}>
              <button
                type="button"
                className={styles.addResult}
                data-testid="runway-add-result"
                data-issue-key={issue.idReadable}
                onClick={() => addReference(issue.idReadable)}
              >
                <span className={styles.ticketId}>{issue.idReadable}</span>
                <span className={styles.summary}>{issue.summary}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {status.kind === 'checking' && (
        <div className={styles.addStatus} role="status" data-testid="runway-add-checking">
          Checking {status.reference}…
        </div>
      )}
      {status.kind === 'added' && (
        <div className={styles.addStatus} role="status" data-testid="runway-add-added">
          {status.message}
        </div>
      )}
      {status.kind === 'error' && (
        <div className={`${styles.addStatus} ${styles.addError}`} role="alert" data-testid="runway-add-error">
          <span>{status.message}</span>
          {status.retry && (
            <Button size="small" kind="tertiary" data-testid="runway-add-retry" onClick={() => void submit(status.retry!)}>
              Try again
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
