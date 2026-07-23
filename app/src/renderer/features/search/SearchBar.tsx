import React, { useEffect, useRef, useState } from 'react';
import { Loader } from '@vibe/core';
import { useIssueSearch, SEARCH_MIN_CHARS } from './api';
import styles from './SearchBar.module.css';

interface SearchBarProps {
  projectShortName: string | null;
  projectName: string | null;
  onSelectIssue: (issueId: string) => void;
}

// Top-bar issue search, scoped to the active project. Debounces input, shows a
// results dropdown, and opens the selected issue in the detail panel. Disabled
// when no project is active (search has no scope on the workspace board).
export function SearchBar({ projectShortName, projectName, onSelectIssue }: SearchBarProps) {
  const [text, setText] = useState('');
  const [debounced, setDebounced] = useState('');
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const enabled = Boolean(projectShortName);

  // Debounce the terms handed to the search hook.
  useEffect(() => {
    const t = setTimeout(() => setDebounced(text), 250);
    return () => clearTimeout(t);
  }, [text]);

  // Clear everything when the active project changes — stale results from a
  // prior project must never linger under a new scope.
  useEffect(() => {
    setText('');
    setDebounced('');
    setOpen(false);
  }, [projectShortName]);

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

  const query = useIssueSearch(projectShortName, debounced);
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
        placeholder={enabled ? `Search ${projectName ?? 'project'}…` : 'Select a project to search'}
        aria-label="Search issues in the active project"
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
