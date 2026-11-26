/**
 * MidiClipComponent.tsx
 * Bloque visual e interactivo de un Patrón MIDI (Drum Machine o Melodía) sobre un MIDI Track de la Playlist.
 * Soporta vista previa en miniatura de notas/pasos, bucle al estirar, recorte no destructivo,
 * corte (Slice), arrastre multi-pista, clonado (Shift+Drag), Hacer Único (Make Unique) y doble clic para editar.
 */

import React, { useState, useEffect, useMemo } from 'react';
import {
  Scissors,
  Copy,
  VolumeX,
  Volume2,
  Trash2,
  ExternalLink,
  Sparkles,
  Grid3X3
} from 'lucide-react';
import type { MidiPatternClip } from '../../utils/typeDefinitions';
import { useSongStore } from '../../store/songStore';
import { useShallow } from 'zustand/react/shallow';
import {
  ensureTrackPatterns,
  getBeatsPerMeasure,
  getDrumPatternColor,
  getDrumPatternName,
  getMelodyPatternLengthBeats
} from '../../core/audio/arrangementResolver';
import { PatternMiniPreview } from './PatternMiniPreview';
import { MidiKeysMiniIcon } from './PatternPickerSidebar';
import { ContextMenuContainer } from '../ui/ContextMenuContainer';
import { startPlaylistGroupDrag, snapPlaylistBeat } from './playlistGroupDrag';

interface MidiClipComponentProps {
  clip: MidiPatternClip;
  zoomLevel: number; // Píxeles por beat
  isSelected: boolean;
  onSelect: (e: React.MouseEvent | React.PointerEvent) => void;
}

export const snapBeatByGrid = snapPlaylistBeat;

export const MidiClipComponent: React.FC<MidiClipComponentProps> = ({
  clip,
  zoomLevel,
  isSelected,
  onSelect
}) => {
  const {
    timeSignature,
    snapGrid,
    playlistTool,
    currentBeat,
    drumChannels,
    patternLengths,
    drumPatternNames,
    tracks,
    updateMidiClip,
    splitMidiClip,
    duplicateMidiClip,
    makeMidiClipUnique,
    toggleMidiClipMute,
    removeMidiClip,
    setSelectedPatternRef,
    jumpToPatternEditor
  } = useSongStore(
    useShallow((state) => ({
      timeSignature: state.timeSignature || '4/4',
      snapGrid: state.audioSnapGrid,
      playlistTool: state.playlistTool,
      currentBeat: state.currentBeat,
      drumChannels: state.drumChannels || [],
      patternLengths: state.patternLengths || [],
      drumPatternNames: state.drumPatternNames || [],
      tracks: state.tracks || [],
      updateMidiClip: state.updateMidiClip,
      splitMidiClip: state.splitMidiClip,
      duplicateMidiClip: state.duplicateMidiClip,
      makeMidiClipUnique: state.makeMidiClipUnique,
      toggleMidiClipMute: state.toggleMidiClipMute,
      removeMidiClip: state.removeMidiClip,
      setSelectedPatternRef: state.setSelectedPatternRef,
      jumpToPatternEditor: state.jumpToPatternEditor
    }))
  );

  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);

  const beatsPerMeasure = getBeatsPerMeasure(timeSignature);

  // Resolver metadatos visuales y contenido del patrón referenciado
  const patternInfo = useMemo(() => {
    if (clip.sourceType === 'drums') {
      const idx = Math.max(0, clip.drumPatternIndex ?? 0);
      return {
        kind: 'drums' as const,
        title: getDrumPatternName(idx, drumPatternNames),
        color: getDrumPatternColor(idx),
        patternLengthBeats: beatsPerMeasure,
        drumPatternIndex: idx,
        drumSteps: patternLengths[idx] || 16,
        notes: []
      };
    }

    const melTrack = tracks.find((t) => t.id === clip.melodyTrackId);
    if (!melTrack) {
      return {
        kind: 'melody' as const,
        title: 'Patrón MIDI',
        color: '#a78bfa',
        patternLengthBeats: beatsPerMeasure,
        drumPatternIndex: 0,
        drumSteps: 16,
        notes: []
      };
    }
    const { patterns, activePattern } = ensureTrackPatterns(melTrack);
    const pat = patterns.find((p) => p.id === clip.melodyPatternId) || activePattern;
    const patLen = getMelodyPatternLengthBeats(pat, beatsPerMeasure);

    return {
      kind: 'melody' as const,
      title: `${melTrack.name} · ${pat.name}`,
      color: melTrack.color || '#a78bfa',
      patternLengthBeats: patLen,
      drumPatternIndex: 0,
      drumSteps: 16,
      notes: pat.notes || []
    };
  }, [clip, drumPatternNames, patternLengths, tracks, beatsPerMeasure]);

  const leftPx = clip.startBeat * zoomLevel;
  const widthPx = Math.max(14, clip.durationBeats * zoomLevel);
  const barsLabel = `${Math.round((clip.durationBeats / beatsPerMeasure) * 10) / 10}c`;

  useEffect(() => {
    if (!contextMenu) return;
    const closeMenu = () => setContextMenu(null);
    window.addEventListener('click', closeMenu);
    window.addEventListener('contextmenu', closeMenu);
    return () => {
      window.removeEventListener('click', closeMenu);
      window.removeEventListener('contextmenu', closeMenu);
    };
  }, [contextMenu]);

  const syncBrushToThisClip = () => {
    if (clip.sourceType === 'drums') {
      setSelectedPatternRef({
        sourceType: 'drums',
        drumPatternIndex: Math.max(0, clip.drumPatternIndex ?? 0)
      });
    } else if (clip.melodyTrackId && clip.melodyPatternId) {
      setSelectedPatternRef({
        sourceType: 'melody',
        melodyTrackId: clip.melodyTrackId,
        melodyPatternId: clip.melodyPatternId
      });
    }
  };

  const handleOpenInEditor = () => {
    if (clip.sourceType === 'drums') {
      jumpToPatternEditor({
        sourceType: 'drums',
        drumPatternIndex: Math.max(0, clip.drumPatternIndex ?? 0)
      });
    } else if (clip.melodyTrackId && clip.melodyPatternId) {
      jumpToPatternEditor({
        sourceType: 'melody',
        melodyTrackId: clip.melodyTrackId,
        melodyPatternId: clip.melodyPatternId
      });
    }
  };

  // Arrastre del cuerpo del clip (Move multi-clip, cross-track, Shift+Drag Clone, o Slice tool)
  const handleBodyPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).classList.contains('audio-clip-trim-handle')) return;
    e.stopPropagation();

    // Shift + Click derecho corta rápido al punto del cursor
    if (e.button === 2 && e.shiftKey) {
      e.preventDefault();
      const laneEl = e.currentTarget.parentElement;
      if (laneEl) {
        const laneRect = laneEl.getBoundingClientRect();
        const rawBeat = (e.clientX - laneRect.left) / zoomLevel;
        const cutBeat = e.altKey ? rawBeat : snapBeatByGrid(rawBeat, snapGrid === 'bar' ? 'beat' : snapGrid, beatsPerMeasure);
        splitMidiClip(clip.id, cutBeat);
      }
      return;
    }

    if (e.button !== 0) return;

    // Herramienta Navaja / Corte (Slice Tool)
    if (playlistTool === 'slice') {
      e.preventDefault();
      const laneEl = e.currentTarget.parentElement;
      if (laneEl) {
        const laneRect = laneEl.getBoundingClientRect();
        const rawBeat = (e.clientX - laneRect.left) / zoomLevel;
        const cutBeat = e.altKey
          ? rawBeat
          : snapBeatByGrid(rawBeat, snapGrid === 'bar' ? 'beat' : snapGrid, beatsPerMeasure);
        splitMidiClip(clip.id, cutBeat);
      }
      return;
    }

    syncBrushToThisClip();
    startPlaylistGroupDrag({
      e,
      anchorKind: 'midi',
      anchorClipId: clip.id,
      zoomLevel,
      beatsPerMeasure,
      snapGrid
    });
  };

  // Tirador Izquierdo (Trim Start + Offset no destructivo)
  const handleTrimLeftDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    if (e.button !== 0) return;

    const startX = e.clientX;
    const initialStartBeat = clip.startBeat;
    const initialDuration = clip.durationBeats;
    const initialOffset = clip.offsetBeats || 0;
    const initialEnd = initialStartBeat + initialDuration;
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);

    useSongStore.temporal.getState().pause();
    let lastUpdates: Partial<MidiPatternClip> | null = null;

    const onPointerMove = (moveEvent: PointerEvent) => {
      const dx = moveEvent.clientX - startX;
      const rawStart = initialStartBeat + dx / zoomLevel;
      const snappedStart = moveEvent.altKey
        ? Math.max(0, rawStart)
        : snapBeatByGrid(rawStart, snapGrid, beatsPerMeasure);

      const minStart = Math.max(0, initialStartBeat - initialOffset);
      const maxStart = initialEnd - 0.25;
      const finalStart = Math.max(minStart, Math.min(maxStart, snappedStart));
      const delta = finalStart - initialStartBeat;

      lastUpdates = {
        startBeat: finalStart,
        durationBeats: Math.max(0.25, initialDuration - delta),
        offsetBeats: Math.max(0, initialOffset + delta)
      };
      updateMidiClip(clip.id, lastUpdates);
    };

    const onPointerUp = (upEvent: PointerEvent) => {
      el.removeEventListener('pointermove', onPointerMove);
      el.removeEventListener('pointerup', onPointerUp);
      try {
        el.releasePointerCapture(upEvent.pointerId);
      } catch (_) {}

      useSongStore.temporal.getState().resume();
      if (lastUpdates) {
        updateMidiClip(clip.id, lastUpdates);
      }
    };

    el.addEventListener('pointermove', onPointerMove);
    el.addEventListener('pointerup', onPointerUp);
  };

  // Tirador Derecho (Recortar o estirar en bucle)
  const handleTrimRightDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    if (e.button !== 0) return;

    const startX = e.clientX;
    const initialStartBeat = clip.startBeat;
    const initialDuration = clip.durationBeats;
    const initialEnd = initialStartBeat + initialDuration;
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);

    useSongStore.temporal.getState().pause();
    let lastUpdates: Partial<MidiPatternClip> | null = null;

    const onPointerMove = (moveEvent: PointerEvent) => {
      const dx = moveEvent.clientX - startX;
      const rawEnd = initialEnd + dx / zoomLevel;
      const snappedEnd = moveEvent.altKey
        ? Math.max(initialStartBeat + 0.25, rawEnd)
        : Math.max(
            initialStartBeat + 0.25,
            snapBeatByGrid(rawEnd, snapGrid, beatsPerMeasure)
          );
      const nextDuration = Math.max(0.25, snappedEnd - initialStartBeat);
      lastUpdates = { durationBeats: nextDuration };
      updateMidiClip(clip.id, lastUpdates);
    };

    const onPointerUp = (upEvent: PointerEvent) => {
      el.removeEventListener('pointermove', onPointerMove);
      el.removeEventListener('pointerup', onPointerUp);
      try {
        el.releasePointerCapture(upEvent.pointerId);
      } catch (_) {}

      useSongStore.temporal.getState().resume();
      if (lastUpdates) {
        updateMidiClip(clip.id, lastUpdates);
      }
    };

    el.addEventListener('pointermove', onPointerMove);
    el.addEventListener('pointerup', onPointerUp);
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.shiftKey) return;
    if (!isSelected) {
      onSelect(e);
    }
    syncBrushToThisClip();
    setContextMenu({ x: e.clientX, y: e.clientY });
  };

  return (
    <>
      <div
        className={`midi-pattern-clip ${isSelected ? 'selected' : ''} ${clip.isMuted ? 'muted' : ''} ${
          playlistTool === 'slice' ? 'slice-cursor' : ''
        }`}
        style={{
          left: leftPx,
          width: widthPx,
          borderColor: isSelected ? '#ffd875' : `${patternInfo.color}77`,
          '--clip-accent': patternInfo.color
        } as React.CSSProperties}
        onPointerDown={handleBodyPointerDown}
        onClick={(e) => e.stopPropagation()}
        onDoubleClick={(e) => {
          e.stopPropagation();
          handleOpenInEditor();
        }}
        onContextMenu={handleContextMenu}
        title={`${patternInfo.title} (${barsLabel}) — Doble clic para editar · Arrastra bordes para repetir/recortar · Shift+Arrastrar para clonar`}
      >
        {/* Tirador izquierdo */}
        <div
          className="audio-clip-trim-handle left"
          onPointerDown={handleTrimLeftDown}
          title="Recortar inicio (Mantén Alt para ajuste libre)"
        />

        {/* Cabecera estilo FL Studio Pattern Clip */}
        <div
          className="midi-clip-header"
          style={{ backgroundColor: `${patternInfo.color}2e` }}
        >
          <span className="midi-clip-header-left">
            {patternInfo.kind === 'drums' ? (
              <Grid3X3 size={10} style={{ color: patternInfo.color, flexShrink: 0 }} />
            ) : (
              <MidiKeysMiniIcon color={patternInfo.color} size={11} />
            )}
            <span className="midi-clip-title">{patternInfo.title}</span>
          </span>
          {widthPx > 62 && (
            <span className="midi-clip-bars">
              {clip.isMuted ? 'MUTE' : barsLabel}
            </span>
          )}
        </div>

        {/* Miniatura de notas MIDI o pasos de batería */}
        <div className="midi-clip-body">
          {patternInfo.kind === 'drums' ? (
            <PatternMiniPreview
              kind="drums"
              drumChannels={drumChannels}
              patternIndex={patternInfo.drumPatternIndex}
              patternSteps={patternInfo.drumSteps}
              beatsPerMeasure={beatsPerMeasure}
              durationBeats={clip.durationBeats}
              offsetBeats={clip.offsetBeats}
              color={patternInfo.color}
              width={Math.max(12, widthPx - 2)}
              height={36}
              showLoopMarkers
            />
          ) : (
            <PatternMiniPreview
              kind="melody"
              notes={patternInfo.notes}
              patternLengthBeats={patternInfo.patternLengthBeats}
              durationBeats={clip.durationBeats}
              offsetBeats={clip.offsetBeats}
              color={patternInfo.color}
              width={Math.max(12, widthPx - 2)}
              height={36}
              showLoopMarkers
            />
          )}
        </div>

        {/* Tirador derecho (estirar = repetir patrón en bucle) */}
        <div
          className="audio-clip-trim-handle right"
          onPointerDown={handleTrimRightDown}
          title="Estirar para repetir patrón o recortar final (Mantén Alt para ajuste libre)"
        />
      </div>

      {/* Menú contextual del Clip MIDI */}
      {contextMenu && (
        <ContextMenuContainer
          x={contextMenu.x}
          y={contextMenu.y}
          className="audio-clip-context-menu"
        >
          <button
            type="button"
            className="context-menu-item"
            onClick={() => {
              handleOpenInEditor();
              setContextMenu(null);
            }}
          >
            <ExternalLink size={12} />
            <span>Editar patrón</span>
            <span className="shortcut-hint">2×Clic</span>
          </button>
          <button
            type="button"
            className="context-menu-item"
            onClick={() => {
              makeMidiClipUnique(clip.id);
              setContextMenu(null);
            }}
          >
            <Sparkles size={12} style={{ color: '#ffd875' }} />
            <span>Hacer único (Make Unique)</span>
          </button>
          <div className="context-menu-divider" />
          <button
            type="button"
            className="context-menu-item"
            onClick={() => {
              splitMidiClip(clip.id, currentBeat);
              setContextMenu(null);
            }}
          >
            <Scissors size={12} />
            <span>Dividir en cabezal</span>
            <span className="shortcut-hint">S</span>
          </button>
          <button
            type="button"
            className="context-menu-item"
            onClick={() => {
              duplicateMidiClip(clip.id);
              setContextMenu(null);
            }}
          >
            <Copy size={12} />
            <span>Duplicar</span>
            <span className="shortcut-hint">Ctrl+D</span>
          </button>
          <button
            type="button"
            className="context-menu-item"
            onClick={() => {
              toggleMidiClipMute(clip.id);
              setContextMenu(null);
            }}
          >
            {clip.isMuted ? <Volume2 size={12} /> : <VolumeX size={12} />}
            <span>{clip.isMuted ? 'Activar clip' : 'Silenciar clip'}</span>
            <span className="shortcut-hint">M</span>
          </button>
          <div className="context-menu-divider" />
          <button
            type="button"
            className="context-menu-item danger"
            onClick={() => {
              removeMidiClip(clip.id);
              setContextMenu(null);
            }}
          >
            <Trash2 size={12} />
            <span>Eliminar</span>
            <span className="shortcut-hint">Supr</span>
          </button>
        </ContextMenuContainer>
      )}
    </>
  );
};
