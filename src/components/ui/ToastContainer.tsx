import React, { useEffect, useState } from 'react';
import { CheckCircle2, Info, AlertTriangle, XCircle, X } from 'lucide-react';
import { subscribeToasts, dismissToast, type ToastItem } from '../../core/ui/toastBus';

const ICON_BY_TYPE = {
  success: CheckCircle2,
  info: Info,
  warning: AlertTriangle,
  error: XCircle
} as const;

export const ToastContainer: React.FC = () => {
  const [items, setItems] = useState<ToastItem[]>([]);

  useEffect(() => {
    return subscribeToasts(setItems);
  }, []);

  if (items.length === 0) return null;

  return (
    <div className="toast-container" role="status" aria-live="polite">
      {items.map((item) => {
        const Icon = ICON_BY_TYPE[item.type];
        return (
          <div key={item.id} className={`phosphor-toast toast-${item.type}`}>
            <Icon size={15} className="toast-icon" />
            <div className="toast-body">
              <span className="toast-message">{item.message}</span>
              {item.detail && <span className="toast-detail">{item.detail}</span>}
            </div>
            <button
              type="button"
              className="toast-close"
              onClick={() => dismissToast(item.id)}
              aria-label="Cerrar notificación"
            >
              <X size={13} />
            </button>
          </div>
        );
      })}
    </div>
  );
};
