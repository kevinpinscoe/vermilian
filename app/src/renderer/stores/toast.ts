import { create } from 'zustand';

export type ToastType = 'positive' | 'negative' | 'warning' | 'normal';

export interface ToastItem {
  id: number;
  type: ToastType;
  message: string;
}

interface ToastState {
  items: ToastItem[];
  // Returns the new toast's id so callers can dismiss it later (e.g. clear a
  // persistent error toast once the underlying condition recovers).
  show(type: ToastType, message: string, durationMs?: number): number;
  dismiss(id: number): void;
}

let seq = 0;

export const useToastStore = create<ToastState>((set) => ({
  items: [],

  show(type, message, durationMs = type === 'negative' ? 0 : 3000) {
    const id = ++seq;
    set((s) => ({ items: [...s.items, { id, type, message }] }));
    if (durationMs > 0) {
      setTimeout(() => {
        set((s) => ({ items: s.items.filter((t) => t.id !== id) }));
      }, durationMs);
    }
    return id;
  },

  dismiss(id) {
    set((s) => ({ items: s.items.filter((t) => t.id !== id) }));
  },
}));
