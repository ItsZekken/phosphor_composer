import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Sliders, Sparkles, Scissors, ArrowUpDown, ArrowLeftRight, X, Check, RotateCcw } from 'lucide-react';
import type { MelodyNote } from '../../../utils/typeDefinitions';
import {
  applyStrumTransform,
  applyHumanizeTransform,
  applyQuickChopTransform,
  applyFlipTransform,
  type EphemeralDragState
} from '../utils/pianoRollUtils';

export type TransformTab = 'strum' | 'humanize' | 'chop';

interface PianoRollTransformsPopoverProps {
  isOpen: boolean;
  activeTab: TransformTab;
  onChangeTab: (tab: TransformTab) => void;
  onClose: () => void;
  melodyNotes: MelodyNote[];
  selectedNoteIds: string[];
  setSelectedNoteIds: React.Dispatch<React.SetStateAction<string[]>>;
  ephemeralDragRef: React.RefObject<EphemeralDragState | null>;
  triggerNotesRedraw: () => void;
  updateMelodyNotesBatch: (updates: Array<{ id: string; changes: Partial<MelodyNote> }>) => void;
  setMelodyNotes: (notes: MelodyNote[]) => void;
}

export const PianoRollTransformsPopover: React.FC<PianoRollTransformsPopoverProps> = ({
  isOpen,
  activeTab,
  onChangeTab,
  onClose,
  melodyNotes,
  selectedNoteIds,
  setSelectedNoteIds,
  ephemeralDragRef,
  triggerNotesRedraw,
  updateMelodyNotesBatch,
  setMelodyNotes
}) => {
  // Parámetros Strum
  const [strumSpread, setStrumSpread] = useState(0.12);
  const [strumDir, setStrumDir] = useState<'up' | 'down' | 'alternate'>('up');
  const [strumVelSlope, setStrumVelSlope] = useState(-0.12);

  // Parámetros Humanize
  const [humanTime, setHumanTime] = useState(0.03);
  const [humanVel, setHumanVel] = useState(0.14);
  const [humanSeed, setHumanSeed] = useState(1337);

  // Parámetros Chop
  const [chopStep, setChopStep] = useState(0.25);

  const targetNotes = useMemo(() => {
    if (selectedNoteIds.length > 0) {
      const sel = new Set(selectedNoteIds);
      return (melodyNotes || []).filter(n => sel.has(n.id));
    }
    return melodyNotes || [];
  }, [melodyNotes, selectedNoteIds]);

  const clearPreview = useCallback(() => {
    (ephemeralDragRef as { current: EphemeralDragState | null }).current = null;
    triggerNotesRedraw();
  }, [ephemeralDragRef, triggerNotesRedraw]);

  // Actualizar preview en vivo a 120 FPS sin tocar el store hasta pulsar Aplicar
  useEffect(() => {
    if (!isOpen) return;

    if (activeTab === 'strum') {
      const overrides = applyStrumTransform(targetNotes, {
        spreadBeats: strumSpread,
        direction: strumDir,
        velocitySlope: strumVelSlope
      });
      (ephemeralDragRef as { current: EphemeralDragState | null }).current = { overrides };
      triggerNotesRedraw();
    } else if (activeTab === 'humanize') {
      const overrides = applyHumanizeTransform(targetNotes, {
        timingJitterBeats: humanTime,
        velocityVariance: humanVel,
        seed: humanSeed
      });
      (ephemeralDragRef as { current: EphemeralDragState | null }).current = { overrides };
      triggerNotesRedraw();
    } else {
      clearPreview();
    }
  }, [
    isOpen,
    activeTab,
    targetNotes,
    strumSpread,
    strumDir,
    strumVelSlope,
    humanTime,
    humanVel,
    humanSeed,
    ephemeralDragRef,
    triggerNotesRedraw,
    clearPreview
  ]);

  useEffect(() => {
    if (!isOpen) {
      clearPreview();
    }
  }, [isOpen, clearPreview]);

  if (!isOpen) return null;

  const handleApplyOverrides = () => {
    const overrides = ephemeralDragRef.current?.overrides;
    if (overrides && overrides.size > 0) {
      const updates: Array<{ id: string; changes: Partial<MelodyNote> }> = [];
      overrides.forEach((changes, id) => updates.push({ id, changes }));
      updateMelodyNotesBatch(updates);
    }
    clearPreview();
    onClose();
  };

  const handleApplyChop = () => {
    if (targetNotes.length === 0) return;
    const targetSet = new Set(targetNotes.map(n => n.id));
    const { nextNotes, createdIds } = applyQuickChopTransform(melodyNotes, targetSet, chopStep);
    setMelodyNotes(nextNotes);
    if (selectedNoteIds.length > 0 && createdIds.length > 0) {
      setSelectedNoteIds(createdIds);
    }
    clearPreview();
    onClose();
  };

  const handleApplyFlip = (mode: 'vertical' | 'horizontal') => {
    if (targetNotes.length === 0) return;
    const overrides = applyFlipTransform(targetNotes, mode);
    const updates: Array<{ id: string; changes: Partial<MelodyNote> }> = [];
    overrides.forEach((changes, id) => updates.push({ id, changes }));
    if (updates.length > 0) {
      updateMelodyNotesBatch(updates);
    }
    clearPreview();
    onClose();
  };

  const scopeLabel = selectedNoteIds.length > 0
    ? `${selectedNoteIds.length} SELECCIONADAS`
    : `TODAS (${targetNotes.length})`;

  return (
    <div className="pr-transforms-popover" onMouseDown={e => e.stopPropagation()}>
      <div className="pr-transforms-header">
        <div className="pr-transforms-tabs">
          <button
            type="button"
            className={`pr-transform-tab ${activeTab === 'strum' ? 'active' : ''}`}
            onClick={() => onChangeTab('strum')}
          >
            <Sliders size={12} /> Strum
          </button>
          <button
            type="button"
            className={`pr-transform-tab ${activeTab === 'humanize' ? 'active' : ''}`}
            onClick={() => onChangeTab('humanize')}
          >
            <Sparkles size={12} /> Humanize
          </button>
          <button
            type="button"
            className={`pr-transform-tab ${activeTab === 'chop' ? 'active' : ''}`}
            onClick={() => onChangeTab('chop')}
          >
            <Scissors size={12} /> Chop / Flip
          </button>
        </div>

        <div className="pr-transforms-meta">
          <span className="pr-scope-pill">{scopeLabel}</span>
          <button
            type="button"
            className="pr-close-btn"
            onClick={() => { clearPreview(); onClose(); }}
            title="Cerrar (Esc)"
          >
            <X size={13} />
          </button>
        </div>
      </div>

      <div className="pr-transforms-body">
        {activeTab === 'strum' && (
          <>
            <div className="pr-slider-row">
              <label>Desfase temporal</label>
              <input
                type="range"
                min={0}
                max={0.5}
                step={0.01}
                value={strumSpread}
                onChange={e => setStrumSpread(parseFloat(e.target.value))}
              />
              <span>{Math.round(strumSpread * 100)}%</span>
            </div>
            <div className="pr-slider-row">
              <label>Curva de Velocity</label>
              <input
                type="range"
                min={-0.5}
                max={0.5}
                step={0.02}
                value={strumVelSlope}
                onChange={e => setStrumVelSlope(parseFloat(e.target.value))}
              />
              <span>{strumVelSlope >= 0 ? '+' : ''}{Math.round(strumVelSlope * 100)}%</span>
            </div>
            <div className="pr-dir-row">
              <label>Dirección</label>
              <div className="physical-segment-tray">
                {(['up', 'down', 'alternate'] as const).map(dir => (
                  <button
                    key={dir}
                    type="button"
                    className={`physical-segment-btn ${strumDir === dir ? 'active' : ''}`}
                    onClick={() => setStrumDir(dir)}
                  >
                    {dir === 'up' ? '↑ Arriba' : dir === 'down' ? '↓ Abajo' : '⇅ Alt'}
                  </button>
                ))}
              </div>
            </div>
            <div className="pr-transforms-actions">
              <button type="button" className="physical-btn" onClick={() => { clearPreview(); onClose(); }}>
                Cancelar
              </button>
              <button type="button" className="physical-btn active" onClick={handleApplyOverrides} disabled={targetNotes.length === 0}>
                <Check size={12} /> Aplicar Strum
              </button>
            </div>
          </>
        )}

        {activeTab === 'humanize' && (
          <>
            <div className="pr-slider-row">
              <label>Micro-timing (±beats)</label>
              <input
                type="range"
                min={0}
                max={0.12}
                step={0.005}
                value={humanTime}
                onChange={e => setHumanTime(parseFloat(e.target.value))}
              />
              <span>±{humanTime.toFixed(3)}</span>
            </div>
            <div className="pr-slider-row">
              <label>Dinámica Velocity</label>
              <input
                type="range"
                min={0}
                max={0.4}
                step={0.01}
                value={humanVel}
                onChange={e => setHumanVel(parseFloat(e.target.value))}
              />
              <span>±{Math.round(humanVel * 100)}%</span>
            </div>
            <div className="pr-transforms-actions">
              <button
                type="button"
                className="physical-btn"
                onClick={() => setHumanSeed(prev => (prev + 97) % 99991)}
                title="Generar nueva variación orgánica"
              >
                <RotateCcw size={12} /> Re-sembrar
              </button>
              <div style={{ display: 'flex', gap: '6px' }}>
                <button type="button" className="physical-btn" onClick={() => { clearPreview(); onClose(); }}>
                  Cancelar
                </button>
                <button type="button" className="physical-btn active" onClick={handleApplyOverrides} disabled={targetNotes.length === 0}>
                  <Check size={12} /> Aplicar Humanize
                </button>
              </div>
            </div>
          </>
        )}

        {activeTab === 'chop' && (
          <>
            <div className="pr-dir-row">
              <label>Subdivisión Chop</label>
              <div className="physical-segment-tray">
                {[
                  { label: '1/2', val: 0.5 },
                  { label: '1/3', val: 1 / 3 },
                  { label: '1/4', val: 0.25 },
                  { label: '1/6', val: 1 / 6 },
                  { label: '1/8', val: 0.125 },
                  { label: '1/16', val: 0.0625 }
                ].map(opt => (
                  <button
                    key={opt.label}
                    type="button"
                    className={`physical-segment-btn ${Math.abs(chopStep - opt.val) < 0.002 ? 'active' : ''}`}
                    onClick={() => setChopStep(opt.val)}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="pr-dir-row">
              <label>Espejo (Flip)</label>
              <div style={{ display: 'flex', gap: '6px' }}>
                <button type="button" className="physical-btn" onClick={() => handleApplyFlip('vertical')} disabled={targetNotes.length === 0}>
                  <ArrowUpDown size={12} /> Flip Pitch
                </button>
                <button type="button" className="physical-btn" onClick={() => handleApplyFlip('horizontal')} disabled={targetNotes.length === 0}>
                  <ArrowLeftRight size={12} /> Flip Tiempo
                </button>
              </div>
            </div>

            <div className="pr-transforms-actions">
              <button type="button" className="physical-btn" onClick={() => { clearPreview(); onClose(); }}>
                Cerrar
              </button>
              <button type="button" className="physical-btn active" onClick={handleApplyChop} disabled={targetNotes.length === 0}>
                <Scissors size={12} /> Ejecutar Chop
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};
