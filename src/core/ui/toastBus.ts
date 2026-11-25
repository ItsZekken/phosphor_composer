/**
 * toastBus.ts
 * Bus de notificaciones ligero fuera de Zustand (cero re-renders globales, cero impacto en historial Undo/Redo).
 */

export type ToastType = 'success' | 'info' | 'warning' | 'error';

export interface ToastItem {
  id: string;
  type: ToastType;
  message: string;
  detail?: string;
  durationMs: number;
  createdAt: number;
}

type ToastListener = (toasts: ToastItem[]) => void;

const MAX_VISIBLE_TOASTS = 3;
let toasts: ToastItem[] = [];
const listeners = new Set<ToastListener>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();
let seq = 0;

function emit() {
  const snapshot = toasts.slice();
  listeners.forEach((listener) => {
    try {
      listener(snapshot);
    } catch {
      // ignore subscriber errors
    }
  });
}

export function dismissToast(id: string): void {
  const timer = timers.get(id);
  if (timer) {
    clearTimeout(timer);
    timers.delete(id);
  }
  const prevLen = toasts.length;
  toasts = toasts.filter((t) => t.id !== id);
  if (toasts.length !== prevLen) {
    emit();
  }
}

export function pushToast(
  type: ToastType,
  message: string,
  options?: { detail?: string; durationMs?: number }
): string {
  const id = `toast_${Date.now()}_${++seq}`;
  const defaultDuration = type === 'error' ? 4800 : type === 'warning' ? 4000 : 3400;
  const durationMs = options?.durationMs ?? defaultDuration;

  const item: ToastItem = {
    id,
    type,
    message,
    detail: options?.detail,
    durationMs,
    createdAt: Date.now()
  };

  // Evitar duplicados idénticos consecutivos en menos de 600ms
  const last = toasts[toasts.length - 1];
  if (last && last.message === message && last.type === type && Date.now() - last.createdAt < 600) {
    return last.id;
  }

  toasts = [...toasts, item];
  while (toasts.length > MAX_VISIBLE_TOASTS) {
    const oldest = toasts.shift();
    if (oldest) {
      const oldTimer = timers.get(oldest.id);
      if (oldTimer) {
        clearTimeout(oldTimer);
        timers.delete(oldest.id);
      }
    }
  }

  if (durationMs > 0 && typeof window !== 'undefined') {
    const timer = setTimeout(() => dismissToast(id), durationMs);
    timers.set(id, timer);
  }

  emit();
  return id;
}

export function subscribeToasts(listener: ToastListener): () => void {
  listeners.add(listener);
  listener(toasts.slice());
  return () => {
    listeners.delete(listener);
  };
}

export const notify = {
  success: (message: string, detail?: string, durationMs?: number) =>
    pushToast('success', message, { detail, durationMs }),
  info: (message: string, detail?: string, durationMs?: number) =>
    pushToast('info', message, { detail, durationMs }),
  warning: (message: string, detail?: string, durationMs?: number) =>
    pushToast('warning', message, { detail, durationMs }),
  error: (message: string, detail?: string, durationMs?: number) =>
    pushToast('error', message, { detail, durationMs })
};
