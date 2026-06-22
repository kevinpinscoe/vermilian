import React from 'react';
import { Toast } from '@vibe/core';
import { useToastStore } from '../stores/toast';
import styles from './ToastStack.module.css';

export function ToastStack() {
  const { items, dismiss } = useToastStore();

  if (items.length === 0) return null;

  return (
    <div className={styles.stack}>
      {items.map((t) => (
        <Toast
          key={t.id}
          open
          type={t.type}
          autoHideDuration={0}
          onClose={() => dismiss(t.id)}
        >
          {t.message}
        </Toast>
      ))}
    </div>
  );
}
