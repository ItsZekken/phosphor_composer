/**
 * HarmonyTrackLane.tsx
 * Pista dedicada 1:1 de Armonía (Chord Palette) en Tracks.
 * Lee y muta directamente `state.chordBlocks` y `channels.chords`:
 * cualquier cambio aquí o en Chord Palette es exactamente la misma fuente de verdad.
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  ExternalLink,
  Scissors,
  Copy,
  Trash2,
  Volume2,
  VolumeX,
  ArrowUp,
  ArrowDown,
  LayoutGrid
} from 'lucide-react';
import type { ChordBlock, NoteClass, ScaleType } from '../../utils/typeDefinitions';
import { useSongStore } from '../../store/songStore';
import { useShallow } from 'zustand/react/shallow';
import { isChordInScale, getChordRomanDegree } from '../../core/music';
import { getChordRole } from '../chord-player/chordRoleUtils';
import { getBeatsPerMeasure } from '../../core/audio/arrangementResolver';
import { roundBeat } from '../../core/audio/melodyRegionUtils';
import { toneEngine } from '../../audio/toneEngine';
import { ContextMenuContainer } from '../ui/ContextMenuContainer';
import { startPlaylistGroupDrag, snapPlaylistBeat } from './playlistGroupDrag';

export const CHORD_DRAG_MIME = 'application/x-phosphor-chord';

const HARMONY_ACCENT = '#60a5fa';

export const HarmonyTrackHeader: React.FC = () => {
  const {
    chordBlocks,
    chordChannel,
    selectedPlaylistTrack,
    setSelectedPlaylistTrack,
    toggleMute,
    toggleSolo,
    jumpToHarmonyEditor
  } = useSongStore(
    useShallow((state) => ({
      chordBlocks: state.chordBlocks || [],
      chordChannel: state.channels?.chords,
      selectedPlaylistTrack: state.selectedPlaylistTrack,
      setSelectedPlaylistTrack: state.setSelectedPlaylistTrack,
      toggleMute: state.toggleMute,
      toggleSolo: state.toggleSolo,
      jumpToHarmonyEditor: state.jumpToHarmonyEditor
    }))
  );

  const isSelected = selectedPlaylistTrack.kind === 'harmony';
  const isMuted = Boolean(chordChannel?.muted);
  const isSolo = Boolean(chordChannel?.solo);
  const accent = HARMONY_ACCENT;

  return (
    <div
      className={`audio-track-header midi-track-header harmony-track-header ${isSelected ? 'selected' : ''} ${isMuted ? 'is-muted' : ''}`}
      onClick={() => setSelectedPlaylistTrack({ kind: 'harmony' })}
      onDoubleClick={() => jumpToHarmonyEditor()}
      style={{ '--channel-color': accent } as React.CSSProperties}
      title="Pista 1:1 con Chord Palette · Doble clic para abrir Chord Palette"
    >
      <div className="audio-track-color-strip" style={{ backgroundColor: accent }} />

      <div className="audio-track-title-strip midi-title-strip" onClick={(e) => e.stopPropagation()}>
        <span className="midi-track-type-pill" style={{ borderColor: `${accent}77`, color: accent }}>
          CHORDS
        </span>
        <span className="tracks-fixed-name" onDoubleClick={() => jumpToHarmonyEditor()}>
          {chordChannel?.name || 'Acordes'}
        </span>
        <button
          type="button"
          className="tracks-open-editor-btn"
          onClick={(e) => {
            e.stopPropagation();
            jumpToHarmonyEditor();
          }}
          title="Abrir en Chord Palette (Alt+1)"
        >
          <ExternalLink size={11} />
        </button>
      </div>

      <div className="midi-track-right-controls" onClick={(e) => e.stopPropagation()}>
        {chordBlocks.length > 0 && (
          <span className="midi-track-clip-count" title={`${chordBlocks.length} bloques de acorde`}>
            {chordBlocks.length}
          </span>
        )}

        <button
          type="button"
          className={`fl-enable-led-btn ${!isMuted ? 'enabled' : ''}`}
          onClick={() => toggleMute('chords')}
          title={isMuted ? 'Activar canal de Acordes' : 'Silenciar canal de Acordes'}
        >
          <span className="fl-enable-led-dot" />
        </button>

        <div className="drum-mute-solo">
          <button
            type="button"
            className={`ms-btn ${isMuted ? 'active-mute' : ''}`}
            onClick={() => toggleMute('chords')}
            title={isMuted ? 'Desmutear Acordes' : 'Silenciar Acordes (Mute)'}
          >
            M
          </button>
          <button
            type="button"
            className={`ms-btn ${isSolo ? 'active-solo' : ''}`}
            onClick={() => toggleSolo('chords')}
            title={isSolo ? 'Desactivar Solo' : 'Aislar Acordes (Solo)'}
          >
            S
          </button>
        </div>
      </div>
    </div>
  );
};

interface ChordTrackClipProps {
  block: ChordBlock;
  zoomLevel: number;
  beatsPerMeasure: number;
  currentKey: NoteClass;
  scale: ScaleType;
  isSelected: boolean;
}

const ChordTrackClip: React.FC<ChordTrackClipProps> = React.memo(({
  block,
  zoomLevel,
  beatsPerMeasure,
  currentKey,
  scale,
  isSelected
}) => {
  const {
    snapGrid,
    playlistTool,
    currentBeat,
    chordOctaveShift,
    updateChordBlock,
    splitChordBlock,
    duplicateSelectedChords,
    transposeChordBlocks,
    removeChordBlock,
    setSelectedChordIds,
    jumpToHarmonyEditor
  } = useSongStore(
    useShallow((state) => ({
      snapGrid: state.audioSnapGrid,
      playlistTool: state.playlistTool,
      currentBeat: state.currentBeat,
      chordOctaveShift: state.chordOctaveShift,
      updateChordBlock: state.updateChordBlock,
      splitChordBlock: state.splitChordBlock,
      duplicateSelectedChords: state.duplicateSelectedChords,
      transposeChordBlocks: state.transposeChordBlocks,
      removeChordBlock: state.removeChordBlock,
      setSelectedChordIds: state.setSelectedChordIds,
      jumpToHarmonyEditor: state.jumpToHarmonyEditor
    }))
  );

  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);

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

  const isDiad = isChordInScale(block.chord, currentKey, scale);
  const romanDegree = isDiad ? getChordRomanDegree(block.chord, currentKey, scale) : '';
  const role = getChordRole(block.chord, currentKey, scale);
  const isMuted = block.type === 'silence' || block.type === 'break';

  const leftPx = block.startBeat * zoomLevel;
  const widthPx = Math.max(16, block.durationBeats * zoomLevel - 2);
  const barsLabel = `${Math.round((block.durationBeats / beatsPerMeasure) * 10) / 10}c`;

  const handleBodyPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).classList.contains('audio-clip-trim-handle')) return;
    e.stopPropagation();

    // Shift + Click derecho corta rápido
    if (e.button === 2 && e.shiftKey) {
      e.preventDefault();
      const laneEl = e.currentTarget.parentElement;
      if (laneEl) {
        const laneRect = laneEl.getBoundingClientRect();
        const rawBeat = (e.clientX - laneRect.left) / zoomLevel;
        const cutBeat = e.altKey
          ? rawBeat
          : snapPlaylistBeat(rawBeat, snapGrid === 'bar' ? 'beat' : snapGrid, beatsPerMeasure);
        splitChordBlock(block.id, cutBeat);
      }
      return;
    }

    if (e.button !== 0) return;

    // Herramienta Navaja (Slice Tool)
    if (playlistTool === 'slice') {
      e.preventDefault();
      const laneEl = e.currentTarget.parentElement;
      if (laneEl) {
        const laneRect = laneEl.getBoundingClientRect();
        const rawBeat = (e.clientX - laneRect.left) / zoomLevel;
        const cutBeat = e.altKey
          ? rawBeat
          : snapPlaylistBeat(rawBeat, snapGrid === 'bar' ? 'beat' : snapGrid, beatsPerMeasure);
        splitChordBlock(block.id, cutBeat);
      }
      return;
    }

    if (!isMuted) {
      toneEngine.playChordPreview(block.chord, chordOctaveShift);
    }

    startPlaylistGroupDrag({
      e,
      anchorKind: 'chord',
      anchorClipId: block.id,
      zoomLevel,
      beatsPerMeasure,
      snapGrid
    });
  };

  // Tirador Izquierdo (ajusta inicio y duración con historial atómico)
  const handleTrimLeftDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    if (e.button !== 0) return;

    const startX = e.clientX;
    const initialStart = block.startBeat;
    const initialDur = block.durationBeats;
    const initialEnd = roundBeat(initialStart + initialDur);
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);

    const initialBlocks = useSongStore.getState().chordBlocks;
    useSongStore.temporal.getState().pause();
    let lastUpdate: { startBeat: number; durationBeats: number } | null = null;

    const onMove = (me: PointerEvent) => {
      const dx = me.clientX - startX;
      const rawStart = initialStart + dx / zoomLevel;
      const snappedStart = me.altKey
        ? Math.max(0, roundBeat(rawStart))
        : snapPlaylistBeat(rawStart, snapGrid, beatsPerMeasure);
      const finalStart = Math.max(0, Math.min(roundBeat(initialEnd - 0.25), snappedStart));
      lastUpdate = {
        startBeat: finalStart,
        durationBeats: Math.max(0.25, roundBeat(initialEnd - finalStart))
      };
      updateChordBlock(block.id, lastUpdate);
    };

    const onUp = (ue: PointerEvent) => {
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      try {
        el.releasePointerCapture(ue.pointerId);
      } catch {}

      if (lastUpdate) {
        useSongStore.setState({ chordBlocks: initialBlocks });
        useSongStore.temporal.getState().resume();
        updateChordBlock(block.id, lastUpdate);
      } else {
        useSongStore.temporal.getState().resume();
      }
    };

    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
  };

  // Tirador Derecho (ajusta duración con historial atómico)
  const handleTrimRightDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    if (e.button !== 0) return;

    const startX = e.clientX;
    const initialStart = block.startBeat;
    const initialEnd = roundBeat(initialStart + block.durationBeats);
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);

    const initialBlocks = useSongStore.getState().chordBlocks;
    useSongStore.temporal.getState().pause();
    let lastDur: number | null = null;

    const onMove = (me: PointerEvent) => {
      const dx = me.clientX - startX;
      const rawEnd = initialEnd + dx / zoomLevel;
      const snappedEnd = me.altKey
        ? Math.max(initialStart + 0.25, roundBeat(rawEnd))
        : Math.max(initialStart + 0.25, snapPlaylistBeat(rawEnd, snapGrid, beatsPerMeasure));
      lastDur = Math.max(0.25, roundBeat(snappedEnd - initialStart));
      updateChordBlock(block.id, { durationBeats: lastDur });
    };

    const onUp = (ue: PointerEvent) => {
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      try {
        el.releasePointerCapture(ue.pointerId);
      } catch {}

      if (lastDur !== null) {
        useSongStore.setState({ chordBlocks: initialBlocks });
        useSongStore.temporal.getState().resume();
        updateChordBlock(block.id, { durationBeats: lastDur });
      } else {
        useSongStore.temporal.getState().resume();
      }
    };

    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
  };

  return (
    <>
      <div
        className={`midi-pattern-clip chord-track-clip ${isSelected ? 'selected' : ''} ${isMuted ? 'muted' : ''} ${
          playlistTool === 'slice' ? 'slice-cursor' : ''
        }`}
        style={{
          left: leftPx,
          width: widthPx,
          borderColor: isSelected ? '#ffd875' : `${HARMONY_ACCENT}77`,
          '--clip-accent': HARMONY_ACCENT
        } as React.CSSProperties}
        onPointerDown={handleBodyPointerDown}
        onClick={(e) => e.stopPropagation()}
        onDoubleClick={(e) => {
          e.stopPropagation();
          jumpToHarmonyEditor(block.id);
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          if (e.shiftKey) return;
          if (!isSelected) {
            setSelectedChordIds([block.id]);
          }
          setContextMenu({ x: e.clientX, y: e.clientY });
        }}
        title={`${block.chord}${romanDegree ? ` (${romanDegree})` : ''} · ${barsLabel} — Doble clic: editar en Chord Palette · Shift+Arrastrar: clonar`}
      >
        <div
          className="audio-clip-trim-handle left"
          onPointerDown={handleTrimLeftDown}
          title="Ajustar inicio del acorde (Alt para libre)"
        />

        <div className="midi-clip-header" style={{ backgroundColor: 'rgba(96, 165, 250, 0.22)' }}>
          <span className="midi-clip-header-left">
            <LayoutGrid size={10} style={{ color: HARMONY_ACCENT, flexShrink: 0 }} />
            <span className="midi-clip-title">{block.chord}</span>
            {!isDiad && widthPx > 50 && (
              <span title="Fuera de la escala actual" style={{ fontSize: '0.58rem' }}>
                ⚠
              </span>
            )}
          </span>
          {widthPx > 58 && (
            <span className="midi-clip-bars">{isMuted ? 'MUTE' : romanDegree || barsLabel}</span>
          )}
        </div>

        <div className="chord-track-clip-body">
          <span className="chord-track-clip-symbol">{block.chord}</span>
          {widthPx > 86 && (
            <span className="chord-track-clip-sub">
              {block.voicing && block.voicing !== 'default' ? block.voicing.toUpperCase() : barsLabel}
            </span>
          )}
          <div
            className="chord-track-role-bar"
            style={{ backgroundColor: `var(--role-${role})` }}
          />
        </div>

        <div
          className="audio-clip-trim-handle right"
          onPointerDown={handleTrimRightDown}
          title="Ajustar duración del acorde (Alt para libre)"
        />
      </div>

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
              jumpToHarmonyEditor(block.id);
              setContextMenu(null);
            }}
          >
            <ExternalLink size={12} />
            <span>Editar en Chord Palette</span>
            <span className="shortcut-hint">2×Clic</span>
          </button>
          <div className="context-menu-divider" />
          <button
            type="button"
            className="context-menu-item"
            onClick={() => {
              splitChordBlock(block.id, currentBeat);
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
              if (!isSelected) setSelectedChordIds([block.id]);
              duplicateSelectedChords();
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
              transposeChordBlocks([block.id], 1);
              setContextMenu(null);
            }}
          >
            <ArrowUp size={12} />
            <span>Transponer +1 semitono</span>
          </button>
          <button
            type="button"
            className="context-menu-item"
            onClick={() => {
              transposeChordBlocks([block.id], -1);
              setContextMenu(null);
            }}
          >
            <ArrowDown size={12} />
            <span>Transponer -1 semitono</span>
          </button>
          <button
            type="button"
            className="context-menu-item"
            onClick={() => {
              updateChordBlock(block.id, { type: isMuted ? 'play' : 'silence' });
              setContextMenu(null);
            }}
          >
            {isMuted ? <Volume2 size={12} /> : <VolumeX size={12} />}
            <span>{isMuted ? 'Activar acorde' : 'Silenciar acorde'}</span>
            <span className="shortcut-hint">M</span>
          </button>
          <div className="context-menu-divider" />
          <button
            type="button"
            className="context-menu-item danger"
            onClick={() => {
              removeChordBlock(block.id);
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
});

interface HarmonyTrackLaneProps {
  zoomLevel: number;
  totalWidth: number;
}

export const HarmonyTrackLane: React.FC<HarmonyTrackLaneProps> = ({ zoomLevel, totalWidth }) => {
  const {
    chordBlocks,
    selectedChordIds,
    chordChannel,
    key,
    scale,
    timeSignature,
    snapGrid,
    playlistTool,
    selectedHarmonyBrushChord,
    chordOctaveShift,
    addChordBlock,
    addChordBlocksBatch,
    setSelectedPlaylistTrack,
    setSelectedHarmonyBrushChord,
    jumpToHarmonyEditor
  } = useSongStore(
    useShallow((state) => ({
      chordBlocks: state.chordBlocks || [],
      selectedChordIds: state.selectedChordIds || [],
      chordChannel: state.channels?.chords,
      key: state.key || 'C',
      scale: state.scale || 'major',
      timeSignature: state.timeSignature || '4/4',
      snapGrid: state.audioSnapGrid,
      playlistTool: state.playlistTool,
      selectedHarmonyBrushChord: state.selectedHarmonyBrushChord || 'C',
      chordOctaveShift: state.chordOctaveShift || 0,
      addChordBlock: state.addChordBlock,
      addChordBlocksBatch: state.addChordBlocksBatch,
      setSelectedPlaylistTrack: state.setSelectedPlaylistTrack,
      setSelectedHarmonyBrushChord: state.setSelectedHarmonyBrushChord,
      jumpToHarmonyEditor: state.jumpToHarmonyEditor
    }))
  );

  const beatsPerMeasure = getBeatsPerMeasure(timeSignature);
  const isMuted = Boolean(chordChannel?.muted);
  const [paintGhosts, setPaintGhosts] = useState<Array<{ startBeat: number; durationBeats: number }>>([]);
  const [dropGhost, setDropGhost] = useState<{ startBeat: number; durationBeats: number; chord: string } | null>(null);

  const getFloorSnappedBeat = useCallback(
    (rawBeat: number, bypassSnap: boolean): number => {
      if (bypassSnap || snapGrid === 'off') return Math.max(0, Math.round(rawBeat * 4) / 4);
      let step = beatsPerMeasure;
      if (snapGrid === 'bar') step = beatsPerMeasure;
      else if (snapGrid === 'beat') step = 1;
      else if (snapGrid === '1/2') step = 0.5;
      else if (snapGrid === '1/4') step = 0.25;
      else if (snapGrid === '1/8') step = 0.125;
      else if (snapGrid === '1/16') step = 0.0625;
      return Math.max(0, roundBeat(Math.floor(rawBeat / step) * step));
    },
    [snapGrid, beatsPerMeasure]
  );

  const handleLanePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return;
    if (e.button !== 0) return;

    setSelectedPlaylistTrack({ kind: 'harmony' });

    if (playlistTool === 'select' || e.ctrlKey || e.metaKey) {
      return;
    }
    if (playlistTool === 'slice') {
      return;
    }

    e.preventDefault();
    e.stopPropagation();

    const el = e.currentTarget;
    const laneRect = el.getBoundingClientRect();
    const brushChord = selectedHarmonyBrushChord || key;
    const blockDur = beatsPerMeasure;
    const anchorBeat = getFloorSnappedBeat((e.clientX - laneRect.left) / zoomLevel, e.altKey);

    const paintedMap = new Map<number, { startBeat: number; durationBeats: number }>();
    paintedMap.set(anchorBeat, { startBeat: anchorBeat, durationBeats: blockDur });
    setPaintGhosts(Array.from(paintedMap.values()));

    toneEngine.playChordPreview(brushChord, chordOctaveShift);
    el.setPointerCapture(e.pointerId);

    const onMove = (me: PointerEvent) => {
      const curBeat = Math.max(0, (me.clientX - laneRect.left) / zoomLevel);
      const diff = curBeat - anchorBeat;
      const stepsDelta = diff >= 0 ? Math.floor(diff / blockDur) : Math.ceil(diff / blockDur);
      const nextMap = new Map<number, { startBeat: number; durationBeats: number }>();
      const s0 = Math.min(0, stepsDelta);
      const s1 = Math.max(0, stepsDelta);
      for (let s = s0; s <= s1; s++) {
        const b = Math.max(0, roundBeat(anchorBeat + s * blockDur));
        nextMap.set(b, { startBeat: b, durationBeats: blockDur });
      }
      paintedMap.clear();
      nextMap.forEach((v, k) => paintedMap.set(k, v));
      setPaintGhosts(Array.from(nextMap.values()));
    };

    const onUp = (ue: PointerEvent) => {
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      try {
        el.releasePointerCapture(ue.pointerId);
      } catch {}

      const slots = Array.from(paintedMap.values()).sort((a, b) => a.startBeat - b.startBeat);
      setPaintGhosts([]);

      if (slots.length === 1) {
        addChordBlock(brushChord, slots[0].startBeat, slots[0].durationBeats);
      } else if (slots.length > 1) {
        addChordBlocksBatch(
          slots.map((sl) => ({
            chord: brushChord,
            startBeat: sl.startBeat,
            durationBeats: sl.durationBeats
          }))
        );
      }
    };

    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    if (!e.dataTransfer.types.includes(CHORD_DRAG_MIME)) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'copy';

    const rect = e.currentTarget.getBoundingClientRect();
    const rawBeat = (e.clientX - rect.left) / zoomLevel;
    const snapped = getFloorSnappedBeat(rawBeat, e.altKey);
    setDropGhost({
      startBeat: snapped,
      durationBeats: beatsPerMeasure,
      chord: selectedHarmonyBrushChord || key
    });
  };

  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    if (e.currentTarget.contains(e.relatedTarget as Node)) return;
    setDropGhost(null);
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    const chord = e.dataTransfer.getData(CHORD_DRAG_MIME);
    if (!chord) return;
    e.preventDefault();
    e.stopPropagation();
    setDropGhost(null);

    const rect = e.currentTarget.getBoundingClientRect();
    const rawBeat = (e.clientX - rect.left) / zoomLevel;
    const snapped = getFloorSnappedBeat(rawBeat, e.altKey);
    setSelectedHarmonyBrushChord(chord);
    addChordBlock(chord, snapped, beatsPerMeasure);
    setSelectedPlaylistTrack({ kind: 'harmony' });
  };

  const barPx = zoomLevel * beatsPerMeasure;

  return (
    <div
      className={`audio-track-lane midi-track-lane harmony-track-lane ${isMuted ? 'lane-muted' : ''} ${
        playlistTool === 'paint' ? 'paint-cursor' : playlistTool === 'slice' ? 'slice-cursor' : ''
      }`}
      data-harmony-lane="true"
      style={{
        width: totalWidth,
        minWidth: totalWidth,
        backgroundSize: `${barPx}px 100%, ${zoomLevel}px 100%`,
        backgroundImage:
          'linear-gradient(to right, rgba(96, 165, 250, 0.22) 1px, transparent 1px), linear-gradient(to right, rgba(255, 255, 255, 0.035) 1px, transparent 1px)'
      }}
      onPointerDown={handleLanePointerDown}
      onDoubleClick={(e) => {
        if (e.target === e.currentTarget) {
          jumpToHarmonyEditor();
        }
      }}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {chordBlocks.length === 0 && paintGhosts.length === 0 && !dropGhost && (
        <div className="tracks-empty-lane-hint">
          Clic o arrastra acordes del panel izquierdo para construir la progresión (1:1 con Chord Palette)
        </div>
      )}

      {chordBlocks.map((block) => (
        <ChordTrackClip
          key={block.id}
          block={block}
          zoomLevel={zoomLevel}
          beatsPerMeasure={beatsPerMeasure}
          currentKey={key}
          scale={scale}
          isSelected={selectedChordIds.includes(block.id)}
        />
      ))}

      {paintGhosts.map((g, i) => (
        <div
          key={`chord_paint_${i}`}
          className="midi-pattern-clip paint-ghost"
          style={{
            left: g.startBeat * zoomLevel,
            width: Math.max(16, g.durationBeats * zoomLevel - 2),
            borderColor: HARMONY_ACCENT
          }}
        >
          <div className="midi-clip-header" style={{ backgroundColor: 'rgba(96, 165, 250, 0.3)' }}>
            <span className="midi-clip-title">{selectedHarmonyBrushChord || key}</span>
          </div>
        </div>
      ))}

      {dropGhost && (
        <div
          className="midi-pattern-clip paint-ghost"
          style={{
            left: dropGhost.startBeat * zoomLevel,
            width: Math.max(16, dropGhost.durationBeats * zoomLevel - 2),
            borderColor: HARMONY_ACCENT
          }}
        >
          <div className="midi-clip-header" style={{ backgroundColor: 'rgba(96, 165, 250, 0.3)' }}>
            <span className="midi-clip-title">{dropGhost.chord}</span>
          </div>
        </div>
      )}
    </div>
  );
};
