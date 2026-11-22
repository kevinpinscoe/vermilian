import React, { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AttentionBox, IconButton, Loader, Text } from '@vibe/core';
import { CloseSmall } from '@vibe/icons';
import Markdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { commentTimeLabel, jiraDetailRows } from './jiraDetail';
import { needsJiraReconnect } from '../../../shared/jiraConnection';
import { applyJiraDirectRead, boardIssueOf } from './jiraBoardSync';
import { JiraRunwaySection } from './JiraRunwaySection';
import { RunwayNumberControl } from '../runway/RunwayNumberControl';
import styles from './JiraIssueDetailPanel.module.css';

interface JiraIssueDetailPanelProps {
  workspaceId: string;
  issueKey: string;
  onClose: () => void;
}

export const workspaceJiraIssueDetailQueryKey = (workspaceId: string, issueKey: string) =>
  ['workspace', 'jira-issue-detail', workspaceId, issueKey] as const;

// The Markdown is remote content (shared/adf.ts escapes it, but it is still
// untrusted): raw HTML is skipped, images are never loaded, and a link opens
// in the system browser (http(s) only, enforced in main) rather than
// navigating the app window.
const MARKDOWN_COMPONENTS: Components = {
  a: ({ href, children }) => (
    <a
      href={href}
      onClick={(e) => {
        e.preventDefault();
        if (href) void window.vermilian.openExternalUrl(href);
      }}
      rel="noreferrer"
    >
      {children}
    </a>
  ),
  img: ({ alt }) => <span>{alt ? `[${alt}]` : '[image]'}</span>,
};

function JiraMarkdown({ text, testId }: { text: string; testId: string }) {
  return (
    <div className={styles.markdown} data-testid={testId}>
      <Markdown remarkPlugins={[remarkGfm]} skipHtml components={MARKDOWN_COMPONENTS}>
        {text}
      </Markdown>
    </div>
  );
}

/**
 * A Jira issue's detail, read-only (VERM-35): its Jira fields, description and
 * comments. YouTrack-only fields (Category, Notes, …) are not shown, and
 * there is no edit, delete or timer control, because nothing in Phase 1
 * writes to Jira. The one editable part is the Priority Desk section
 * (VERM-38): Focus, rank and Why now, kept in Vermilian's local store.
 */
export function JiraIssueDetailPanel({ workspaceId, issueKey, onClose }: JiraIssueDetailPanelProps) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: workspaceJiraIssueDetailQueryKey(workspaceId, issueKey),
    queryFn: async ({ signal }) => {
      const res = await window.vermilian.getWorkspaceJiraIssueDetail({ workspaceId, issueKey });
      // A direct read is the issue itself, not the search index, so it also
      // freshens the board's card; an older poll result cannot undo it, nor
      // a full read whose index lags it, for a bounded grace period
      // (VERM-39, shared/jiraPoll.ts). Never applied once abandoned.
      if (res.ok && !signal.aborted) applyJiraDirectRead(queryClient, workspaceId, boardIssueOf(res.issue));
      return res;
    },
    staleTime: 60 * 1000,
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const result = query.data;
  const loaded = result?.ok ? result : null;
  const failure = result && !result.ok ? result.message : query.error ? (query.error as Error).message : null;

  return (
    <aside className={styles.panel} data-testid="jira-issue-detail-panel" aria-label={`Jira issue ${issueKey}, read-only`}>
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <div className={styles.idRow}>
            {loaded ? (
              // Opens in the system browser rather than navigating the app window (VERM-66).
              <a
                className={`${styles.issueKey} ${styles.issueKeyLink}`}
                href={loaded.issueUrl}
                onClick={(e) => {
                  e.preventDefault();
                  void window.vermilian.openExternalUrl(loaded.issueUrl);
                }}
                onAuxClick={(e) => {
                  if (e.button !== 1) return;
                  e.preventDefault();
                  void window.vermilian.openExternalUrl(loaded.issueUrl);
                }}
                rel="noreferrer"
                title="Open in Jira"
                aria-label={`Open ${loaded.issue.idReadable} in Jira`}
                data-testid="jira-detail-issue-key"
              >
                {loaded.issue.idReadable}
              </a>
            ) : (
              <span className={styles.issueKey} data-testid="jira-detail-issue-key">{issueKey}</span>
            )}
            <span className={styles.readOnly} title="Nothing in this version changes Jira issues.">Jira · read-only</span>
          </div>
          {loaded && <span className={styles.projectName} data-testid="jira-detail-project">{loaded.issue.project.name}</span>}
        </div>
        <IconButton icon={CloseSmall} size="small" kind="tertiary" aria-label="Close panel" data-testid="jira-detail-close" onClick={onClose} />
      </div>

      {query.isLoading && (
        <div className={styles.loaderWrap}><Loader size={32} /></div>
      )}

      {failure && (
        <div className={styles.errorWrap}>
          <AttentionBox
            data-testid="jira-detail-error"
            type="negative"
            title={needsJiraReconnect(result) ? 'Reconnect Jira to see this issue' : "Couldn't load this Jira issue"}
            text={failure}
          />
        </div>
      )}

      {loaded && (
        <div className={styles.body}>
          <Text type="text1" weight="bold" className={styles.summary}>
            <span data-testid="jira-detail-summary">{loaded.issue.summary}</span>
          </Text>

          <dl className={styles.fields}>
            {jiraDetailRows(loaded.issue).map((row) => (
              <div key={row.key} className={styles.fieldRow} data-testid="jira-detail-field" data-field={row.key}>
                <dt className={styles.fieldLabel}>{row.label}</dt>
                <dd className={styles.fieldValue}>{row.value}</dd>
              </div>
            ))}
          </dl>

          {/* The Runway # (VERM-88): independent of the Priority Desk below — a
              ticket can be on the Runway with no Desk slot. Matched by the key
              it was opened with as well as the key Jira answered with. */}
          <RunwayNumberControl
            key={workspaceId}
            workspaceId={workspaceId}
            ticket={{ tracker: 'jira', keys: [loaded.issue.idReadable, issueKey], entityId: null }}
            displayKey={loaded.issue.idReadable}
          />

          <JiraRunwaySection workspaceId={workspaceId} issueKey={loaded.issue.idReadable} />

          <section className={styles.section}>
            <h4 className={styles.sectionTitle}>Description</h4>
            {loaded.content.description ? (
              <JiraMarkdown text={loaded.content.description} testId="jira-detail-description" />
            ) : (
              <p className={styles.empty} data-testid="jira-detail-description-empty">No description.</p>
            )}
          </section>

          <section className={styles.section}>
            <h4 className={styles.sectionTitle}>
              Comments <span className={styles.count} data-testid="jira-detail-comment-count">{loaded.content.comments.length}</span>
            </h4>
            {loaded.content.comments.length === 0 && <p className={styles.empty}>No comments.</p>}
            {loaded.content.comments.map((c) => (
              <article key={c.id} className={styles.comment} data-testid="jira-detail-comment" data-comment-id={c.id}>
                <div className={styles.commentMeta}>
                  <span className={styles.commentAuthor}>{c.author || 'Unknown'}</span>
                  <span className={styles.commentTime}>{commentTimeLabel(c.created, c.updated)}</span>
                </div>
                <JiraMarkdown text={c.markdown} testId="jira-detail-comment-body" />
              </article>
            ))}
          </section>
        </div>
      )}
    </aside>
  );
}
