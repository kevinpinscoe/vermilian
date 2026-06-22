import React, { useState } from 'react';
import { Text, Button } from '@vibe/core';
import type { BoardConfig, BoardColors } from '../../../shared/boardConfig';
import { defaultBoardView } from '../../../shared/boardConfig';
import { STATUS_COLORS, PRIORITY_COLORS, CATEGORY_COLORS } from './colors';
import styles from './BoardSettingsPanel.module.css';

// ─── Colour tab ───────────────────────────────────────────────────────────────

const COLOUR_FIELDS: Array<{ field: string; label: string; defaults: Record<string, string> }> = [
  { field: 'Status',   label: 'Status',   defaults: STATUS_COLORS   },
  { field: 'Priority', label: 'Priority', defaults: PRIORITY_COLORS },
  { field: 'Category', label: 'Category', defaults: CATEGORY_COLORS },
];

interface ColourTabProps {
  colors: BoardColors;
  onChange: (colors: BoardColors) => void;
}

function ColourTab({ colors, onChange }: ColourTabProps) {
  function setColor(field: string, value: string, hex: string) {
    const fieldOverrides = { ...(colors[field] ?? {}) };
    fieldOverrides[value] = hex;
    onChange({ ...colors, [field]: fieldOverrides });
  }

  function resetValue(field: string, value: string) {
    const fieldOverrides = { ...(colors[field] ?? {}) };
    delete fieldOverrides[value];
    const next = { ...colors };
    if (Object.keys(fieldOverrides).length === 0) delete next[field];
    else next[field] = fieldOverrides;
    onChange(next);
  }

  return (
    <div className={styles.tabContent}>
      {COLOUR_FIELDS.map(({ field, label, defaults }) => (
        <div key={field} className={styles.colorSection}>
          <Text type="text2" weight="bold" className={styles.sectionLabel}>{label}</Text>
          {Object.entries(defaults).map(([value, defaultHex]) => {
            const overrideHex = colors[field]?.[value];
            const currentHex = overrideHex ?? defaultHex;
            return (
              <div key={value} className={styles.colorRow}>
                <span
                  className={styles.colorSwatch}
                  style={{ background: currentHex }}
                />
                <Text type="text2" className={styles.colorLabel}>{value}</Text>
                <input
                  type="color"
                  value={currentHex}
                  onChange={(e) => setColor(field, value, e.target.value)}
                  className={styles.colorPicker}
                  title={`Override colour for ${value}`}
                />
                {overrideHex && (
                  <button
                    type="button"
                    className={styles.resetValueBtn}
                    onClick={() => resetValue(field, value)}
                    title="Reset to default"
                  >
                    ↺
                  </button>
                )}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

// ─── Views tab ────────────────────────────────────────────────────────────────

interface ViewsTabProps {
  config: BoardConfig;
  onChange: (config: BoardConfig) => void;
}

function ViewsTab({ config, onChange }: ViewsTabProps) {
  function renameView(id: string, name: string) {
    onChange({
      ...config,
      views: config.views.map((v) => (v.id === id ? { ...v, name } : v)),
    });
  }

  function duplicateView(id: string) {
    const src = config.views.find((v) => v.id === id);
    if (!src) return;
    const newId = `view-${Date.now()}`;
    onChange({
      ...config,
      views: [...config.views, { ...src, id: newId, name: `${src.name} (copy)` }],
    });
  }

  function deleteView(id: string) {
    if (config.views.length <= 1) return;
    const views = config.views.filter((v) => v.id !== id);
    onChange({
      ...config,
      views,
      activeViewId: config.activeViewId === id ? views[0].id : config.activeViewId,
    });
  }

  function addView() {
    const newId = `view-${Date.now()}`;
    onChange({
      ...config,
      views: [...config.views, { ...defaultBoardView(), id: newId, name: 'New view' }],
    });
  }

  return (
    <div className={styles.tabContent}>
      {config.views.map((view) => (
        <div key={view.id} className={styles.viewRow}>
          <input
            type="text"
            value={view.name}
            onChange={(e) => renameView(view.id, e.target.value)}
            className={styles.viewNameInput}
          />
          <span className={styles.viewType}>{view.type}</span>
          <button
            type="button"
            className={styles.viewActionBtn}
            onClick={() => duplicateView(view.id)}
            title="Duplicate view"
          >
            ⧉
          </button>
          <button
            type="button"
            className={styles.viewActionBtn}
            onClick={() => deleteView(view.id)}
            disabled={config.views.length <= 1}
            title="Delete view"
          >
            ✕
          </button>
        </div>
      ))}
      <button type="button" className={styles.addViewBtn} onClick={addView}>
        + New view
      </button>
    </div>
  );
}

// ─── Danger zone tab ─────────────────────────────────────────────────────────

interface DangerTabProps {
  projectName: string;
  onReset: () => void;
}

function DangerTab({ projectName, onReset }: DangerTabProps) {
  const [confirming, setConfirming] = useState(false);
  return (
    <div className={styles.tabContent}>
      <Text type="text2">
        Resetting removes all column, colour, and view customisations for{' '}
        <strong>{projectName}</strong>. The board reverts to workspace defaults on the next
        render. This cannot be undone.
      </Text>
      {!confirming ? (
        <Button color="negative" kind="secondary" onClick={() => setConfirming(true)}>
          Reset this board to defaults
        </Button>
      ) : (
        <div className={styles.confirmRow}>
          <Text type="text2">Are you sure?</Text>
          <Button color="negative" onClick={() => { onReset(); setConfirming(false); }}>
            Yes, reset
          </Button>
          <Button kind="secondary" onClick={() => setConfirming(false)}>
            Cancel
          </Button>
        </div>
      )}
    </div>
  );
}

// ─── Main panel ───────────────────────────────────────────────────────────────

type Tab = 'colours' | 'views' | 'danger';

interface BoardSettingsPanelProps {
  config: BoardConfig;
  projectName: string;
  onSave: (config: BoardConfig) => void;
  onReset: () => void;
  onClose: () => void;
}

export function BoardSettingsPanel({
  config,
  projectName,
  onSave,
  onReset,
  onClose,
}: BoardSettingsPanelProps) {
  const [tab, setTab] = useState<Tab>('colours');

  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <Text type="text1" weight="bold">Board settings</Text>
        <button type="button" className={styles.closeBtn} onClick={onClose} aria-label="Close">
          ✕
        </button>
      </div>

      <div className={styles.tabs}>
        {(['colours', 'views', 'danger'] as Tab[]).map((t) => (
          <button
            key={t}
            type="button"
            className={`${styles.tab} ${tab === t ? styles.tabActive : ''}`}
            onClick={() => setTab(t)}
          >
            {t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      {tab === 'colours' && (
        <ColourTab
          colors={config.colors}
          onChange={(colors) => onSave({ ...config, colors })}
        />
      )}
      {tab === 'views' && (
        <ViewsTab config={config} onChange={(c) => onSave(c)} />
      )}
      {tab === 'danger' && (
        <DangerTab projectName={projectName} onReset={onReset} />
      )}
    </div>
  );
}
