import React, { useEffect, useRef, useState } from 'react';
import { Loader } from '@vibe/core';
import { useIssueSearch, SEARCH_MIN_CHARS } from './api';
import styles from './SearchBar.module.css';

interface SearchBarProps {
  // Projects in scope: the active project (one), or every project in the active
  // workspace (many) when no single project is selected.
  projectShortNames: string[];
  scopeLabel: string | null; // project or workspace name, for the placeholder
  onSelectIssue: (issueId: string) => void;
}

// Top-bar issue search. Scoped to the active project when one is selected,
// otherwise to every project in the active workspace. Debounces input, shows a
// results dropdown, and opens the selected issue in the detail panel. Enabled
// whenever there is at least one project in scope.
export function SearchBar({ projectShortNames, scopeLabel, onSelectIssue }: SearchBarProps) {
  const [text, setText] = useState('');
  const [debounced, setDebounced] = useState('');
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const enabled = projectShortNames.length > 0;
  const scopeKey = [...projectShortNames].sort().join(',');

  // Debounce the terms handed to the search hook.
  useEffect(() => {
    const t = setTimeout(() => setDebounced(text), 250);
    return () => clearTimeout(t);
  }, [text]);

  // Clear everything when the scope changes — stale results from a prior scope
  // must never linger under a new one.
  useEffect(() => {
    setText('');
    setDebounced('');
    setOpen(false);
  }, [scopeKey]);

  // Close the dropdown on outside click.
  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  const query = useIssueSearch(projectShortNames, debounced);
  const terms = debounced.trim();
  const showResults = open && enabled && terms.length >= SEARCH_MIN_CHARS;
  const results = query.data ?? [];

  function handleSelect(id: string) {
    onSelectIssue(id);
    setOpen(false);
    setText('');
    setDebounced('');
  }

  return (
    <div className={styles.container} ref={containerRef}>
      <input
        data-testid="issue-search-input"
        className={styles.input}
        type="text"
        value={text}
        disabled={!enabled}
        placeholder={enabled ? `Search ${scopeLabel ?? 'issues'}…` : 'No projects to search'}
        aria-label="Search issues"
        onChange={(e) => {
          setText(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            setOpen(false);
            (e.target as HTMLInputElement).blur();
          }
        }}
      />
      {showResults && (
        <div className={styles.dropdown} data-testid="issue-search-results">
          {query.isLoading ? (
            <div className={styles.state}>
              <Loader size={16} />
              <span>Searching…</span>
            </div>
          ) : query.isError ? (
            <div className={styles.state} data-testid="issue-search-error">
              Search failed. Check your connection and try again.
            </div>
          ) : results.length === 0 ? (
            <div className={styles.state} data-testid="issue-search-empty">
              No issues match “{terms}”.
            </div>
          ) : (
            <ul className={styles.list}>
              {results.map((issue) => (
                <li key={issue.id}>
                  <button
                    type="button"
                    className={styles.result}
                    data-testid="issue-search-result"
                    data-issue-id={issue.id}
                    onClick={() => handleSelect(issue.id)}
                  >
                    <span className={styles.resultId}>{issue.idReadable}</span>
                    <span className={styles.resultSummary}>{issue.summary}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
