import React, { useState, useEffect } from 'react';
import { X } from 'lucide-react';

interface PromptModalProps {
  isOpen: boolean;
  title: string;
  initialValue?: string;
  confirmText?: string;
  cancelText?: string;
  onConfirm: (value: string) => void;
  onCancel: () => void;
}

export const PromptModal: React.FC<PromptModalProps> = ({
  isOpen,
  title,
  initialValue = '',
  confirmText = 'Aceptar',
  cancelText = 'Cancelar',
  onConfirm,
  onCancel,
}) => {
  const [value, setValue] = useState(initialValue);

  useEffect(() => {
    if (isOpen) {
      setValue(initialValue);
    }
  }, [isOpen, initialValue]);

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" style={overlayStyle} onClick={onCancel}>
      <div className="modal-content" style={contentStyle} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header" style={headerStyle}>
          <h3 style={{ margin: 0, color: '#00e5ff', fontSize: '1rem', textTransform: 'uppercase', letterSpacing: '1px' }}>
            {title}
          </h3>
          <button onClick={onCancel} style={closeButtonStyle}>
            <X size={16} />
          </button>
        </div>
        
        <div className="modal-body" style={{ padding: '20px' }}>
          <input
            type="text"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onConfirm(value);
              if (e.key === 'Escape') onCancel();
            }}
            autoFocus
            style={inputStyle}
          />
        </div>
        
        <div className="modal-footer" style={footerStyle}>
          <button onClick={onCancel} className="btn-cancel" style={btnCancelStyle}>
            {cancelText}
          </button>
          <button onClick={() => onConfirm(value)} className="btn-confirm" style={btnPrimaryStyle}>
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
  width: '350px',
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

const inputStyle: React.CSSProperties = {
  width: '100%',
  backgroundColor: 'rgba(0,0,0,0.3)',
  border: '1px solid rgba(255,255,255,0.1)',
  color: '#fff',
  padding: '8px 12px',
  borderRadius: '3px',
  outline: 'none',
  fontFamily: 'inherit',
  fontSize: '0.95rem'
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
