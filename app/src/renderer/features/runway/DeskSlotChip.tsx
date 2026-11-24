// The Desk slot chip on Runway and All tasks rows (VERM-99): Now, Next or
// Then, read-only, beside the Runway #. Nothing when the ticket has no slot.

import React from 'react';
import { deskSlotTitle, type DeskSlot } from './deskSlot';
import styles from './DeskSlotChip.module.css';

export function DeskSlotChip({ slot }: { slot: DeskSlot | null }) {
  if (!slot) return null;
  const title = deskSlotTitle(slot);
  return (
    <span
      className={`${styles.chip} ${slot.rank === 1 ? styles.now : ''} ${slot.shared ? styles.shared : ''}`}
      title={title}
      aria-label={title}
      data-testid="desk-slot"
      data-desk-slot={slot.label.toLowerCase()}
      data-shared={slot.shared ? 'true' : undefined}
    >
      {slot.label}
      {slot.shared && ' ⚠'}
    </span>
  );
}
