// Persistent, signature-scoped diagnostic banner for _vermilian-master-plan
// discovery/parse problems — an ambiguous set of articles, a failed or
// incomplete discovery, or malformed/partial article content. Mirrors
// FocusRankRepairBanner's shape (an AttentionBox plus a dismiss action).
//
// Dismissal is scoped to the *current* diagnostic's signature, for this
// renderer session only (no persistence): a different problem, or the same
// kind of problem against a changed article revision, reopens the banner
// even if the previous one was dismissed — a dismissal never permanently
// hides a newly detected or changed problem (VERM-7 review correction,
// 2026-09-16). A missing article ('none') and a cleanly-loaded article with
// no diagnostics both render nothing — this is a diagnostic surface, not a
// status indicator.
import React, { useState } from 'react';
import { AttentionBox, Button } from '@vibe/core';
import { masterPlanDiagnosticSignature } from '../../../shared/masterPlan';
import { useMasterPlan } from './masterPlanApi';
import { masterPlanBannerCopy } from './masterPlanBanner';
import styles from './MasterPlanDiagnosticBanner.module.css';

export function MasterPlanDiagnosticBanner() {
  const { data } = useMasterPlan();
  const [dismissedSignature, setDismissedSignature] = useState<string | null>(null);

  if (!data) return null;

  const signature = masterPlanDiagnosticSignature(data);
  if (signature === null) return null;
  if (signature === dismissedSignature) return null;

  const copy = masterPlanBannerCopy(data);
  if (!copy) return null;

  return (
    <div className={styles.wrap} data-testid="master-plan-diagnostic-banner">
      <AttentionBox type="warning" title={copy.title} text={copy.text} />
      <div className={styles.actions}>
        <Button
          size="small"
          kind="tertiary"
          onClick={() => setDismissedSignature(signature)}
          data-testid="master-plan-diagnostic-dismiss"
        >
          Dismiss
        </Button>
      </div>
    </div>
  );
}
