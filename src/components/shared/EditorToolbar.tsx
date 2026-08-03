import React from 'react';
import { Sparkles, Trash2 } from 'lucide-react';

interface EditorToolbarProps {
  children?: React.ReactNode;
  onClear?: () => void;
  onGenerate?: () => void;
  isGenerating?: boolean;
}

export const EditorToolbar: React.FC<EditorToolbarProps> = ({ 
  children, 
  onClear, 
  onGenerate, 
  isGenerating 
}) => {
  return (
    <div className="piano-roll-header">
      <div className="header-left">
        {/* Placeholder para controles específicos de la vista (ej. Selector de canal, ScaleFinder) */}
        {children}
      </div>
      
      <div className="header-right">
        {/* Controles comunes */}
        {onGenerate && (
          <button 
            className={`ghost-generate-btn ${isGenerating ? 'loading' : ''}`}
            onClick={onGenerate}
            disabled={isGenerating}
            title="Autocompletar melodía con IA (Shift + Space)"
          >
            <Sparkles size={14} />
            <span>Generar</span>
          </button>
        )}
        {onClear && (
          <button 
            className="clear-btn" 
            onClick={onClear} 
            title="Borrar todas las notas (Delete)"
          >
            <Trash2 size={14} />
            <span>Limpiar</span>
          </button>
        )}
      </div>
    </div>
  );
};
