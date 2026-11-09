// Read-only list of open Jira issues assigned to me (VERM-21, epic VERM-17).
// A plain wireframe view: no editing, no Priority Desk. A key opens the issue
// in the Jira web UI; everything else is display only.
import React from 'react';
import { Modal, ModalContent, ModalHeader, Button, Text, Loader, AttentionBox } from '@vibe/core';
import { useMyJiraIssues } from './api';
import styles from './JiraListModal.module.css';

interface JiraListModalProps {
  onClose: () => void;
  onOpenSettings: () => void;
}

export function JiraListModal({ onClose, onOpenSettings }: JiraListModalProps) {
  const query = useMyJiraIssues();
  const result = query.data;

  return (
    <Modal id="jira-list-modal" show onClose={onClose} size="large">
      <ModalHeader title="Jira — open issues assigned to me" />
      <ModalContent>
        <div className={styles.body} data-testid="jira-list-body">
          {query.isPending && (
            <div className={styles.loading} data-testid="jira-list-loading">
              <Loader size={40} />
              <Text type="text1">Loading…</Text>
            </div>
          )}

          {query.isError && (
            <AttentionBox data-testid="jira-list-error" type="negative" title="Couldn't load Jira issues" text={String(query.error)} />
          )}

          {result && !result.ok && result.reason === 'not-configured' && (
            <div data-testid="jira-list-not-configured">
              <AttentionBox type="primary" title="Jira is not set up" text={result.message} />
              <div className={styles.actions}>
                <Button
                  data-testid="jira-list-open-settings-btn"
                  size="small"
                  kind="secondary"
                  onClick={() => {
                    onClose();
                    onOpenSettings();
                  }}
                >
                  Open Settings
                </Button>
              </div>
            </div>
          )}

          {result && !result.ok && result.reason === 'error' && (
            <AttentionBox data-testid="jira-list-error" type="negative" title="Couldn't load Jira issues" text={result.message} />
          )}

          {result?.ok && result.issues.length === 0 && (
            <Text type="text1" data-testid="jira-list-empty">No open issues are assigned to you.</Text>
          )}

          {result?.ok && result.issues.length > 0 && (
            <>
              <Text type="text2" className={styles.muted}>
                {result.issues.length} open {result.issues.length === 1 ? 'issue' : 'issues'}, most recently updated first.
              </Text>
              <table className={styles.table} data-testid="jira-list-table">
                <thead>
                  <tr>
                    <th>Key</th>
                    <th>Summary</th>
                    <th>Status</th>
                    <th>Priority</th>
                  </tr>
                </thead>
                <tbody>
                  {result.issues.map((issue) => (
                    <tr key={issue.key} data-testid="jira-list-row" data-issue-key={issue.key}>
                      <td>
                        <button
                          type="button"
                          className={styles.key}
                          title="Open in Jira"
                          onClick={() => void window.vermilian.openExternalUrl(issue.url)}
                        >
                          {issue.key}
                        </button>
                      </td>
                      <td data-testid="jira-list-summary">{issue.summary}</td>
                      <td className={styles.nowrap} data-testid="jira-list-status">{issue.status}</td>
                      <td className={styles.nowrap} data-testid="jira-list-priority">
                        {issue.priority || <span className={styles.muted}>—</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}

          <div className={styles.actions}>
            <Button size="small" kind="tertiary" onClick={() => void query.refetch()} disabled={query.isFetching}>
              Refresh
            </Button>
            <Button size="small" onClick={onClose}>Close</Button>
          </div>
        </div>
      </ModalContent>
    </Modal>
  );
}
