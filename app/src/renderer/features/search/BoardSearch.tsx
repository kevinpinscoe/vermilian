import React, { useEffect, useRef, useState } from 'react';
import { Loader } from '@vibe/core';
import type { BoardIssue } from '../../../shared/workspace';
import { SEARCH_MIN_CHARS, searchScopeEnabled, useScopedIssueSearch, type SearchScope } from './api';
import { isSearchShortcut } from './shortcut';
import barStyles from './SearchBar.module.css';
import styles from './BoardSearch.module.css';

interface BoardSearchProps {
  // The text, owned by the board: it filters the loaded cards as it changes.
  value: string;
  onChange: (value: string) => void;
  // How many loaded cards the text matches. With none, the backend is asked
  // without waiting for Enter.
  localMatchCount: number;
  scope: SearchScope;
  onSelectIssue: (issue: BoardIssue) => void;
  placeholder: string;
}

// The search box above a board (VERM-61). Typing filters the loaded cards at
// once (the board applies `value`); Enter, or a term no loaded card matches,
// searches the backend for issues not on the board, Done included, and lists
// them under the box. "/" focuses it from anywhere on the page.
export function BoardSearch({ value, onChange, localMatchCount, scope, onSelectIssue, placeholder }: BoardSearchProps) {
  const [submitted, setSubmitted] = useState<string | null>(null);
  const [debounced, setDebounced] = useState('');
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), 250);
    return () => clearTimeout(t);
  }, [value]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!isSearchShortcut(e as unknown as Parameters<typeof isSearchShortcut>[0])) return;
      e.preventDefault();
      inputRef.current?.focus();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  const trimmed = value.trim();
  // An Enter search lasts while the text is unchanged.
  const explicit = submitted !== null && submitted === trimmed ? submitted : null;
  const auto = localMatchCount === 0 && debounced.trim() === trimmed ? trimmed : '';
  const term = explicit ?? auto;
  const enabled = searchScopeEnabled(scope);
  const query = useScopedIssueSearch(scope, enabled ? term : '');
  const showResults = open && enabled && term.length >= SEARCH_MIN_CHARS;
  const results = query.data ?? [];

  function clear() {
    onChange('');
    setSubmitted(null);
    setOpen(false);
  }

  return (
    <div className={styles.container} ref={containerRef} data-testid="board-search">
      <input
        ref={inputRef}
        data-testid="board-search-input"
        className={barStyles.input}
        type="search"
        value={value}
        placeholder={placeholder}
        aria-label="Search this board"
        aria-keyshortcuts="/"
        onChange={(e) => { onChange(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            setSubmitted(trimmed);
            setOpen(true);
          } else if (e.key === 'Escape') {
            clear();
            (e.target as HTMLInputElement).blur();
          }
        }}
      />
      {trimmed.length >= SEARCH_MIN_CHARS && !showResults && (
        <div className={styles.hint} data-testid="board-search-hint">
          {localMatchCount} on this board · Enter searches all issues, including Done
        </div>
      )}
      {showResults && (
        <div className={barStyles.dropdown} data-testid="board-search-results">
          {query.isLoading ? (
            <div className={barStyles.state}><Loader size={16} /><span>Searching…</span></div>
          ) : query.isError ? (
            <div className={barStyles.state} data-testid="board-search-error">
              {(query.error as Error)?.message || 'Search failed. Check your connection and try again.'}
            </div>
          ) : results.length === 0 ? (
            <div className={barStyles.state} data-testid="board-search-empty">No issues match “{term}”.</div>
          ) : (
            <ul className={barStyles.list}>
              {results.map((issue) => (
                <li key={issue.id}>
                  <button
                    type="button"
                    className={barStyles.result}
                    data-testid="board-search-result"
                    data-issue-key={issue.idReadable}
                    onClick={() => { onSelectIssue(issue); setOpen(false); }}
                  >
                    <span className={barStyles.resultId}>{issue.idReadable}</span>
                    <span className={barStyles.resultSummary}>{issue.summary}</span>
                    {issue.resolved !== null && <span className={barStyles.resultId}>Done</span>}
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
