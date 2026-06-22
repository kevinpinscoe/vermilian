import React from 'react';
import { Text } from '@vibe/core';
import type { BoardColumnConfig } from '../../../shared/boardConfig';
import { COLUMN_LABELS, DEFAULT_COLUMNS } from '../../../shared/boardConfig';
import styles from './ColumnsPanel.module.css';

interface ColumnsPanelProps {
  columns: BoardColumnConfig[];
  onChange: (cols: BoardColumnConfig[]) => void;
  onClose: () => void;
}

export function ColumnsPanel({ columns, onChange, onClose }: ColumnsPanelProps) {
  function toggleVisible(idx: number) {
    const next = columns.map((c, i) => (i === idx ? { ...c, visible: !c.visible } : c));
    onChange(next);
  }

  function moveUp(idx: number) {
    if (idx === 0) return;
    const next = [...columns];
    [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
    onChange(next);
  }

  function moveDown(idx: number) {
    if (idx === columns.length - 1) return;
    const next = [...columns];
    [next[idx], next[idx + 1]] = [next[idx + 1], next[idx]];
    onChange(next);
  }

  function setWidth(idx: number, raw: string) {
    const width = Math.max(0, parseInt(raw, 10) || 0);
    onChange(columns.map((c, i) => (i === idx ? { ...c, width } : c)));
  }

  function resetToDefault() {
    onChange(DEFAULT_COLUMNS.map((c) => ({ ...c })));
  }

  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <Text type="text1" weight="bold">Columns</Text>
        <button type="button" className={styles.closeBtn} onClick={onClose} aria-label="Close">
          ✕
        </button>
      </div>

      <div className={styles.list}>
        {columns.map((col, idx) => (
          <div key={col.field} data-testid="column-visibility-toggle" data-col={col.field} className={styles.row}>
            <input
              type="checkbox"
              checked={col.visible}
              onChange={() => toggleVisible(idx)}
              className={styles.checkbox}
              id={`col-${col.field}`}
            />
            <label htmlFor={`col-${col.field}`} className={styles.label}>
              {COLUMN_LABELS[col.field] ?? col.field}
            </label>
            <input
              type="number"
              min={0}
              max={800}
              value={col.width}
              onChange={(e) => setWidth(idx, e.target.value)}
              className={styles.widthInput}
              title="Column width (px; 0 = auto)"
            />
            <div className={styles.orderBtns}>
              <button
                type="button"
                className={styles.orderBtn}
                onClick={() => moveUp(idx)}
                disabled={idx === 0}
                title="Move up"
              >
                ↑
              </button>
              <button
                type="button"
                className={styles.orderBtn}
                onClick={() => moveDown(idx)}
                disabled={idx === columns.length - 1}
                title="Move down"
              >
                ↓
              </button>
            </div>
          </div>
        ))}
      </div>

      <div className={styles.footer}>
        <button type="button" className={styles.resetLink} onClick={resetToDefault}>
          Reset to workspace default
        </button>
      </div>
    </div>
  );
}
