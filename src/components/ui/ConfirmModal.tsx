import React from 'react';
import { X, AlertTriangle } from 'lucide-react';

interface ConfirmModalProps {
  isOpen: boolean;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  onConfirm: () => void;
  onCancel: () => void;
  isDanger?: boolean;
}

export const ConfirmModal: React.FC<ConfirmModalProps> = ({
  isOpen,
  title,
  message,
  confirmText = 'Confirmar',
  cancelText = 'Cancelar',
  onConfirm,
  onCancel,
  isDanger = true
}) => {
  if (!isOpen) return null;

  return (
    <div className="modal-overlay" style={overlayStyle} onClick={onCancel}>
      <div className="modal-content" style={contentStyle} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header" style={headerStyle}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            {isDanger && <AlertTriangle size={18} color="#ff3366" />}
            <h3 style={{ margin: 0, color: isDanger ? '#ff3366' : '#00e5ff', fontSize: '1rem', textTransform: 'uppercase', letterSpacing: '1px' }}>
              {title}
            </h3>
          </div>
          <button onClick={onCancel} style={closeButtonStyle}>
            <X size={16} />
          </button>
        </div>
        
        <div className="modal-body" style={{ padding: '16px 20px', color: '#e0e0e0', fontSize: '0.9rem', lineHeight: '1.5' }}>
          {message}
        </div>
        
        <div className="modal-footer" style={footerStyle}>
          <button onClick={onCancel} className="btn-cancel" style={btnCancelStyle}>
            {cancelText}
          </button>
          <button onClick={onConfirm} className="btn-confirm" style={isDanger ? btnDangerStyle : btnPrimaryStyle}>
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
};

const overlayStyle: React.CSSProperties = {
  position: 'fixed',
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  backgroundColor: 'rgba(0, 0, 0, 0.7)',
  backdropFilter: 'blur(4px)',
  display: 'flex',
  justifyContent: 'center',
  alignItems: 'center',
  zIndex: 9999
};

const contentStyle: React.CSSProperties = {
  backgroundColor: '#1a1a24',
  border: '1px solid rgba(0, 229, 255, 0.3)',
  borderRadius: '4px',
  width: '400px',
  maxWidth: '90vw',
  boxShadow: '0 8px 32px rgba(0, 0, 0, 0.8), 0 0 10px rgba(0, 229, 255, 0.2)'
};

const headerStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  padding: '12px 20px',
  borderBottom: '1px solid rgba(255, 255, 255, 0.05)',
  backgroundColor: 'rgba(0, 0, 0, 0.3)'
};

const closeButtonStyle: React.CSSProperties = {
  background: 'none',
  border: 'none',
  color: 'rgba(255, 255, 255, 0.5)',
  cursor: 'pointer',
  padding: '4px',
  display: 'flex'
};

const footerStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'flex-end',
  gap: '12px',
  padding: '12px 20px',
  borderTop: '1px solid rgba(255, 255, 255, 0.05)',
  backgroundColor: 'rgba(0, 0, 0, 0.2)'
};

const btnCancelStyle: React.CSSProperties = {
  background: 'transparent',
  border: '1px solid rgba(255, 255, 255, 0.2)',
  color: '#aaa',
  padding: '6px 16px',
  borderRadius: '3px',
  cursor: 'pointer',
  fontFamily: 'inherit',
  fontSize: '0.85rem'
};

const btnPrimaryStyle: React.CSSProperties = {
  background: 'rgba(0, 229, 255, 0.1)',
  border: '1px solid #00e5ff',
  color: '#00e5ff',
  padding: '6px 16px',
  borderRadius: '3px',
  cursor: 'pointer',
  fontFamily: 'inherit',
  fontSize: '0.85rem',
  textTransform: 'uppercase'
};

const btnDangerStyle: React.CSSProperties = {
  background: 'rgba(255, 51, 102, 0.1)',
  border: '1px solid #ff3366',
  color: '#ff3366',
  padding: '6px 16px',
  borderRadius: '3px',
  cursor: 'pointer',
  fontFamily: 'inherit',
  fontSize: '0.85rem',
  textTransform: 'uppercase'
};
