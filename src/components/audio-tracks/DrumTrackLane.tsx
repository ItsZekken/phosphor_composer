/**
 * DrumTrackLane.tsx
 * Pista dedicada 1:1 de Batería (Drum Sequencer) en Tracks.
 * Lee y muta directamente `state.patternChain` y `channels.drums`:
 * es exactamente la misma secuencia lineal que muestra `PatternChainArranger` en Drum Sequencer.
 */

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  ExternalLink,
  Scissors,
  Copy,
  Sparkles,
  Volume2,
  VolumeX,
  Trash2,
  Grid3X3,
  Repeat
} from 'lucide-react';
import {
  normalizePatternChainToLinear,
  type LinearDrumClip
} from '../../utils/typeDefinitions';
import { useSongStore } from '../../store/songStore';
import { useShallow } from 'zustand/react/shallow';
import {
  getBeatsPerMeasure,
  getDrumPatternColor,
  getDrumPatternName
} from '../../core/audio/arrangementResolver';
import { roundBeat } from '../../core/audio/melodyRegionUtils';
import { liveTelemetryBus } from '../../core/audio/liveTelemetryBus';
import { PatternMiniPreview } from './PatternMiniPreview';
import { ContextMenuContainer } from '../ui/ContextMenuContainer';
import { startPlaylistGroupDrag, snapPlaylistBeat } from './playlistGroupDrag';

export const DRUM_PATTERN_DRAG_MIME = 'application/x-phosphor-drum-pattern';

const DRUM_ACCENT = '#2dd4bf';

interface DrumTrackHeaderProps {
  laneIndex: number;
  laneCount: number;
  onRequestDeleteLane?: (laneIndex: number, clipCount: number) => void;
}

export const DrumTrackHeader: React.FC<DrumTrackHeaderProps> = ({
  laneIndex,
  laneCount,
  onRequestDeleteLane
}) => {
  const {
    patternChain,
    drumChannel,
    drumLaneMuted,
    isPatternRepeatOn,
    currentDrumPatternEdit,
    selectedPlaylistTrack,
    setSelectedPlaylistTrack,
    setPatternRepeatOn,
    toggleMute,
    toggleSolo,
    toggleMuteDrumLane,
    removeDrumLane,
    jumpToDrumEditor
  } = useSongStore(
    useShallow((state) => ({
      patternChain: state.patternChain || [],
      drumChannel: state.channels?.drums,
      drumLaneMuted: state.drumLaneMuted || [],
      isPatternRepeatOn: state.isPatternRepeatOn,
      currentDrumPatternEdit: state.currentDrumPatternEdit || 0,
      selectedPlaylistTrack: state.selectedPlaylistTrack,
      setSelectedPlaylistTrack: state.setSelectedPlaylistTrack,
      setPatternRepeatOn: state.setPatternRepeatOn,
      toggleMute: state.toggleMute,
      toggleSolo: state.toggleSolo,
      toggleMuteDrumLane: state.toggleMuteDrumLane,
      removeDrumLane: state.removeDrumLane,
      jumpToDrumEditor: state.jumpToDrumEditor
    }))
  );

  const laneClipCount = useMemo(
    () =>
      normalizePatternChainToLinear(patternChain).filter((c) => c.laneIndex === laneIndex).length,
    [patternChain, laneIndex]
  );
  const isSelected =
    selectedPlaylistTrack.kind === 'drums' && (selectedPlaylistTrack.laneIndex ?? 0) === laneIndex;
  const isBusMuted = Boolean(drumChannel?.muted);
  const isLaneMuted = Boolean(drumLaneMuted[laneIndex]);
  const isMultiLane = laneCount > 1;
  const isEffectivelyMuted = isBusMuted || isLaneMuted;
  const isSolo = Boolean(drumChannel?.solo);
  const baseName = drumChannel?.name || 'Batería';
  const displayName = isMultiLane ? `${baseName} · C${laneIndex + 1}` : baseName;

  const handleMuteToggle = () => {
    if (isMultiLane) {
      toggleMuteDrumLane(laneIndex);
    } else {
      toggleMute('drums');
    }
  };

  return (
    <div
      className={`audio-track-header midi-track-header drum-track-header ${isSelected ? 'selected' : ''} ${isEffectivelyMuted ? 'is-muted' : ''}`}
      onClick={() => setSelectedPlaylistTrack({ kind: 'drums', laneIndex })}
      onDoubleClick={() => jumpToDrumEditor(currentDrumPatternEdit)}
      style={{ '--channel-color': DRUM_ACCENT } as React.CSSProperties}
      title={`${displayName} · 1:1 con Drum Sequencer · Doble clic para abrir Drum Sequencer`}
    >
      <div className="audio-track-color-strip" style={{ backgroundColor: DRUM_ACCENT }} />

      <div className="audio-track-title-strip midi-title-strip" onClick={(e) => e.stopPropagation()}>
        <span className="midi-track-type-pill" style={{ borderColor: `${DRUM_ACCENT}77`, color: DRUM_ACCENT }}>
          {laneIndex === 0 ? 'DRUMS' : `C${laneIndex + 1}`}
        </span>
        <span className="tracks-fixed-name" onDoubleClick={() => jumpToDrumEditor(currentDrumPatternEdit)}>
          {displayName}
        </span>
        {isMultiLane && isBusMuted && laneIndex === 0 && (
          <button
            type="button"
            className="drum-loop-mode-pill"
            onClick={() => toggleMute('drums')}
            title="Canal global de Batería silenciado en el Mixer · Clic para reactivar"
          >
            BUS M
          </button>
        )}
        {isPatternRepeatOn && laneIndex === 0 && (
          <button
            type="button"
            className="drum-loop-mode-pill"
            onClick={() => setPatternRepeatOn(false)}
            title={`En modo LOOP P${currentDrumPatternEdit + 1} · Clic para activar Timeline Lineal`}
          >
            <Repeat size={9} />
            <span>P{currentDrumPatternEdit + 1}</span>
          </button>
        )}
        <button
          type="button"
          className="tracks-open-editor-btn"
          onClick={(e) => {
            e.stopPropagation();
            jumpToDrumEditor(currentDrumPatternEdit);
          }}
          title="Abrir en Drum Sequencer (Alt+3)"
        >
          <ExternalLink size={11} />
        </button>
        {isMultiLane && (
          <button
            type="button"
            className="audio-track-delete-btn"
            onClick={(e) => {
              e.stopPropagation();
              if (laneClipCount > 0 && onRequestDeleteLane) {
                onRequestDeleteLane(laneIndex, laneClipCount);
              } else {
                removeDrumLane(laneIndex);
              }
            }}
            title={`Eliminar capa de batería C${laneIndex + 1}`}
          >
            <Trash2 size={11} />
          </button>
        )}
      </div>

      <div className="midi-track-right-controls" onClick={(e) => e.stopPropagation()}>
        {laneClipCount > 0 && (
          <span
            className="midi-track-clip-count"
            title={`${laneClipCount} clips en ${displayName}`}
          >
            {laneClipCount}
          </span>
        )}

        <button
          type="button"
          className={`fl-enable-led-btn ${!isEffectivelyMuted ? 'enabled' : ''}`}
          onClick={handleMuteToggle}
          title={
            isMultiLane
              ? isLaneMuted
                ? `Activar capa C${laneIndex + 1}`
                : `Silenciar capa C${laneIndex + 1}`
              : isBusMuted
              ? 'Activar canal de Batería'
              : 'Silenciar canal de Batería'
          }
        >
          <span className="fl-enable-led-dot" />
        </button>

        <div className="drum-mute-solo">
          <button
            type="button"
            className={`ms-btn ${(isMultiLane ? isLaneMuted : isBusMuted) ? 'active-mute' : ''}`}
            onClick={handleMuteToggle}
            title={
              isMultiLane
                ? isLaneMuted
                  ? `Desmutear capa C${laneIndex + 1}`
                  : `Silenciar capa C${laneIndex + 1}`
                : isBusMuted
                ? 'Desmutear Batería'
                : 'Silenciar Batería (Mute)'
            }
          >
            M
          </button>
          <button
            type="button"
            className={`ms-btn ${isSolo ? 'active-solo' : ''}`}
            onClick={() => toggleSolo('drums')}
            title={isSolo ? 'Desactivar Solo de Batería' : 'Aislar Batería (Solo)'}
          >
            S
          </button>
        </div>
      </div>
    </div>
  );
};

interface DrumClipComponentProps {
  clip: LinearDrumClip;
  zoomLevel: number;
  beatsPerMeasure: number;
  isSelected: boolean;
  isPlayingClip: boolean;
}

const DrumClipComponent: React.FC<DrumClipComponentProps> = React.memo(({
  clip,
  zoomLevel,
  beatsPerMeasure,
  isSelected,
  isPlayingClip
}) => {
  const {
    snapGrid,
    playlistTool,
    currentBeat,
    drumChannels,
    patternLengths,
    drumPatternNames,
    isPatternRepeatOn,
    setPatternRepeatOn,
    setCurrentDrumPatternEdit,
    updateChainItem,
    splitChainItem,
    duplicateSelectedChainItems,
    makeChainItemUnique,
    toggleMuteChainItem,
    removeChainItem,
    setSelectedChainIds,
    jumpToDrumEditor
  } = useSongStore(
    useShallow((state) => ({
      snapGrid: state.audioSnapGrid,
      playlistTool: state.playlistTool,
      currentBeat: state.currentBeat,
      drumChannels: state.drumChannels || [],
      patternLengths: state.patternLengths || [],
      drumPatternNames: state.drumPatternNames || [],
      isPatternRepeatOn: state.isPatternRepeatOn,
      setPatternRepeatOn: state.setPatternRepeatOn,
      setCurrentDrumPatternEdit: state.setCurrentDrumPatternEdit,
      updateChainItem: state.updateChainItem,
      splitChainItem: state.splitChainItem,
      duplicateSelectedChainItems: state.duplicateSelectedChainItems,
      makeChainItemUnique: state.makeChainItemUnique,
      toggleMuteChainItem: state.toggleMuteChainItem,
      removeChainItem: state.removeChainItem,
      setSelectedChainIds: state.setSelectedChainIds,
      jumpToDrumEditor: state.jumpToDrumEditor
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

  const totalPatterns = drumChannels[0]?.patterns?.length || 8;
  const color = getDrumPatternColor(clip.patternIndex);
  const title = getDrumPatternName(clip.patternIndex, drumPatternNames);
  const patternSteps = patternLengths[clip.patternIndex] || 16;

  const startBeat = clip.startMeasure * beatsPerMeasure;
  const durationBeats = clip.durationMeasures * beatsPerMeasure;
  const phaseOffsetBeats = (((clip.startMeasure % 1) + 1) % 1) * beatsPerMeasure;

  const leftPx = startBeat * zoomLevel;
  const widthPx = Math.max(16, durationBeats * zoomLevel - 2);
  const barsLabel = `${Math.round(clip.durationMeasures * 10) / 10}c`;

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
        splitChainItem(clip.id, roundBeat(cutBeat / beatsPerMeasure));
      }
      return;
    }

    if (e.button !== 0) return;

    if (playlistTool === 'slice') {
      e.preventDefault();
      const laneEl = e.currentTarget.parentElement;
      if (laneEl) {
        const laneRect = laneEl.getBoundingClientRect();
        const rawBeat = (e.clientX - laneRect.left) / zoomLevel;
        const cutBeat = e.altKey
          ? rawBeat
          : snapPlaylistBeat(rawBeat, snapGrid === 'bar' ? 'beat' : snapGrid, beatsPerMeasure);
        splitChainItem(clip.id, roundBeat(cutBeat / beatsPerMeasure));
      }
      return;
    }

    setCurrentDrumPatternEdit(clip.patternIndex);
    startPlaylistGroupDrag({
      e,
      anchorKind: 'drum',
      anchorClipId: clip.id,
      zoomLevel,
      beatsPerMeasure,
      snapGrid
    });
  };

  // Tirador Izquierdo (ajusta startMeasure y durationMeasures con historial atómico)
  const handleTrimLeftDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    if (e.button !== 0) return;

    const startX = e.clientX;
    const initialStartBeat = startBeat;
    const initialEndBeat = roundBeat(startBeat + durationBeats);
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);

    const initialChain = useSongStore.getState().patternChain;
    useSongStore.temporal.getState().pause();
    let lastUpdates: { startMeasure: number; durationMeasures: number } | null = null;

    const onMove = (me: PointerEvent) => {
      const dx = me.clientX - startX;
      const rawStart = initialStartBeat + dx / zoomLevel;
      const snappedStart = me.altKey
        ? Math.max(0, roundBeat(rawStart))
        : snapPlaylistBeat(rawStart, snapGrid, beatsPerMeasure);
      const minDurBeats = Math.max(0.25 * beatsPerMeasure, 0.25);
      const finalStartBeat = Math.max(0, Math.min(roundBeat(initialEndBeat - minDurBeats), snappedStart));
      lastUpdates = {
        startMeasure: roundBeat(finalStartBeat / beatsPerMeasure),
        durationMeasures: Math.max(0.25, roundBeat((initialEndBeat - finalStartBeat) / beatsPerMeasure))
      };
      updateChainItem(clip.id, lastUpdates);
    };

    const onUp = (ue: PointerEvent) => {
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      try {
        el.releasePointerCapture(ue.pointerId);
      } catch {}

      if (lastUpdates) {
        useSongStore.setState({ patternChain: initialChain });
        useSongStore.temporal.getState().resume();
        updateChainItem(clip.id, lastUpdates);
        if (isPatternRepeatOn) setPatternRepeatOn(false);
      } else {
        useSongStore.temporal.getState().resume();
      }
    };

    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
  };

  // Tirador Derecho (estira para repetir en bucle o acorta)
  const handleTrimRightDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    if (e.button !== 0) return;

    const startX = e.clientX;
    const initialStartBeat = startBeat;
    const initialEndBeat = roundBeat(startBeat + durationBeats);
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);

    const initialChain = useSongStore.getState().patternChain;
    useSongStore.temporal.getState().pause();
    let lastDurMeasures: number | null = null;

    const onMove = (me: PointerEvent) => {
      const dx = me.clientX - startX;
      const rawEnd = initialEndBeat + dx / zoomLevel;
      const minDurBeats = Math.max(0.25 * beatsPerMeasure, 0.25);
      const snappedEnd = me.altKey
        ? Math.max(initialStartBeat + minDurBeats, roundBeat(rawEnd))
        : Math.max(initialStartBeat + minDurBeats, snapPlaylistBeat(rawEnd, snapGrid, beatsPerMeasure));
      lastDurMeasures = Math.max(0.25, roundBeat((snappedEnd - initialStartBeat) / beatsPerMeasure));
      updateChainItem(clip.id, { durationMeasures: lastDurMeasures });
    };

    const onUp = (ue: PointerEvent) => {
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      try {
        el.releasePointerCapture(ue.pointerId);
      } catch {}

      if (lastDurMeasures !== null) {
        useSongStore.setState({ patternChain: initialChain });
        useSongStore.temporal.getState().resume();
        updateChainItem(clip.id, { durationMeasures: lastDurMeasures });
        if (isPatternRepeatOn) setPatternRepeatOn(false);
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
        className={`midi-pattern-clip drum-track-clip ${isSelected ? 'selected' : ''} ${
          clip.isMuted ? 'muted' : ''
        } ${isPlayingClip ? 'playing-live' : ''} ${playlistTool === 'slice' ? 'slice-cursor' : ''}`}
        style={{
          left: leftPx,
          width: widthPx,
          borderColor: isSelected ? '#ffd875' : `${color}88`,
          '--clip-accent': color
        } as React.CSSProperties}
        onPointerDown={handleBodyPointerDown}
        onClick={(e) => e.stopPropagation()}
        onDoubleClick={(e) => {
          e.stopPropagation();
          jumpToDrumEditor(clip.patternIndex);
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          if (e.shiftKey) return;
          if (!isSelected) {
            setSelectedChainIds([clip.id]);
          }
          setCurrentDrumPatternEdit(clip.patternIndex);
          setContextMenu({ x: e.clientX, y: e.clientY });
        }}
        title={`${title} (${barsLabel}) — Doble clic: editar en Drum Sequencer · Estirar borde derecho: repetir · Shift+Arrastrar: clonar`}
      >
        <div
          className="audio-clip-trim-handle left"
          onPointerDown={handleTrimLeftDown}
          title="Recortar inicio (Alt para libre)"
        />

        <div className="midi-clip-header" style={{ backgroundColor: `${color}30` }}>
          <span className="midi-clip-header-left">
            <Grid3X3 size={10} style={{ color, flexShrink: 0 }} />
            <span className="midi-clip-title">{title}</span>
          </span>
          {widthPx > 60 && (
            <span className="midi-clip-bars">{clip.isMuted ? 'MUTE' : barsLabel}</span>
          )}
        </div>

        <div className="midi-clip-body">
          <PatternMiniPreview
            kind="drums"
            drumChannels={drumChannels}
            patternIndex={clip.patternIndex}
            patternSteps={patternSteps}
            beatsPerMeasure={beatsPerMeasure}
            durationBeats={durationBeats}
            offsetBeats={phaseOffsetBeats}
            color={color}
            width={Math.max(12, widthPx - 2)}
            height={36}
            showLoopMarkers
          />
        </div>

        <div
          className="audio-clip-trim-handle right"
          onPointerDown={handleTrimRightDown}
          title="Estirar para repetir patrón o acortar (1:1 con Drum Sequencer)"
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
              jumpToDrumEditor(clip.patternIndex);
              setContextMenu(null);
            }}
          >
            <ExternalLink size={12} />
            <span>Editar en Drum Sequencer</span>
            <span className="shortcut-hint">2×Clic</span>
          </button>
          <button
            type="button"
            className="context-menu-item"
            onClick={() => {
              makeChainItemUnique(clip.id);
              setContextMenu(null);
            }}
          >
            <Sparkles size={12} style={{ color: '#ffd875' }} />
            <span>Hacer único (Crear Fill)</span>
          </button>

          <div className="context-menu-divider" />
          <div style={{ fontSize: '0.6rem', color: 'var(--text-secondary)', padding: '2px 8px', fontWeight: 700, letterSpacing: '0.05em' }}>
            ASIGNAR PATRÓN
          </div>
          <div className="drum-ctx-pattern-grid" style={{ padding: '4px 6px' }}>
            {Array.from({ length: totalPatterns }).map((_, idx) => (
              <button
                key={idx}
                type="button"
                className={`drum-ctx-pat-btn ${clip.patternIndex === idx ? 'active' : ''}`}
                style={{ '--pat-col': getDrumPatternColor(idx) } as React.CSSProperties}
                onClick={() => {
                  updateChainItem(clip.id, { patternIndex: idx });
                  setCurrentDrumPatternEdit(idx);
                  setContextMenu(null);
                }}
              >
                P{idx + 1}
              </button>
            ))}
          </div>

          <div className="context-menu-divider" />
          <button
            type="button"
            className="context-menu-item"
            onClick={() => {
              splitChainItem(clip.id, roundBeat(currentBeat / beatsPerMeasure));
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
              if (!isSelected) setSelectedChainIds([clip.id]);
              duplicateSelectedChainItems();
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
              toggleMuteChainItem(clip.id);
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
              removeChainItem(clip.id);
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

interface DrumTrackLaneProps {
  laneIndex: number;
  zoomLevel: number;
  totalWidth: number;
}

export const DrumTrackLane: React.FC<DrumTrackLaneProps> = ({
  laneIndex,
  zoomLevel,
  totalWidth
}) => {
  const {
    patternChain,
    drumLaneMuted,
    selectedChainIds,
    drumChannel,
    drumPatternNames,
    currentDrumPatternEdit,
    isPatternRepeatOn,
    isPlaying,
    timeSignature,
    snapGrid,
    playlistTool,
    setPatternRepeatOn,
    setCurrentDrumPatternEdit,
    addChainItem,
    addChainItemsBatch,
    setSelectedPlaylistTrack,
    jumpToDrumEditor
  } = useSongStore(
    useShallow((state) => ({
      patternChain: state.patternChain || [],
      drumLaneMuted: state.drumLaneMuted || [],
      selectedChainIds: state.selectedChainIds || [],
      drumChannel: state.channels?.drums,
      drumPatternNames: state.drumPatternNames || [],
      currentDrumPatternEdit: state.currentDrumPatternEdit || 0,
      isPatternRepeatOn: state.isPatternRepeatOn,
      isPlaying: state.isPlaying,
      timeSignature: state.timeSignature || '4/4',
      snapGrid: state.audioSnapGrid,
      playlistTool: state.playlistTool,
      setPatternRepeatOn: state.setPatternRepeatOn,
      setCurrentDrumPatternEdit: state.setCurrentDrumPatternEdit,
      addChainItem: state.addChainItem,
      addChainItemsBatch: state.addChainItemsBatch,
      setSelectedPlaylistTrack: state.setSelectedPlaylistTrack,
      jumpToDrumEditor: state.jumpToDrumEditor
    }))
  );

  const beatsPerMeasure = getBeatsPerMeasure(timeSignature);
  const linearClips = useMemo(
    () => normalizePatternChainToLinear(patternChain).filter((c) => c.laneIndex === laneIndex),
    [patternChain, laneIndex]
  );
  const isMuted = Boolean(drumChannel?.muted) || Boolean(drumLaneMuted[laneIndex]);

  const [paintGhosts, setPaintGhosts] = useState<Array<{ startBeat: number; durationBeats: number }>>([]);
  const [dropGhost, setDropGhost] = useState<{ startBeat: number; durationBeats: number; label: string; color: string } | null>(null);
  const [activePlayingIds, setActivePlayingIds] = useState<string[]>([]);

  useEffect(() => {
    if (!isPlaying || isPatternRepeatOn) {
      setActivePlayingIds([]);
      return;
    }
    return liveTelemetryBus.subscribeDrumStep(({ activeChainItemIds }) => {
      setActivePlayingIds((prev) => {
        if (prev.length === activeChainItemIds.length && prev.every((id, i) => id === activeChainItemIds[i])) {
          return prev;
        }
        return activeChainItemIds;
      });
    });
  }, [isPlaying, isPatternRepeatOn]);

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

    setSelectedPlaylistTrack({ kind: 'drums', laneIndex });

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
    const brushPatternIdx = Math.max(0, currentDrumPatternEdit);
    const patDur = beatsPerMeasure;
    const anchorBeat = getFloorSnappedBeat((e.clientX - laneRect.left) / zoomLevel, e.altKey);

    const paintedMap = new Map<number, { startBeat: number; durationBeats: number }>();
    paintedMap.set(anchorBeat, { startBeat: anchorBeat, durationBeats: patDur });
    setPaintGhosts(Array.from(paintedMap.values()));

    el.setPointerCapture(e.pointerId);

    const onMove = (me: PointerEvent) => {
      const curBeat = Math.max(0, (me.clientX - laneRect.left) / zoomLevel);
      const diff = curBeat - anchorBeat;
      const stepsDelta = diff >= 0 ? Math.floor(diff / patDur) : Math.ceil(diff / patDur);
      const nextMap = new Map<number, { startBeat: number; durationBeats: number }>();
      const s0 = Math.min(0, stepsDelta);
      const s1 = Math.max(0, stepsDelta);
      for (let s = s0; s <= s1; s++) {
        const b = Math.max(0, roundBeat(anchorBeat + s * patDur));
        nextMap.set(b, { startBeat: b, durationBeats: patDur });
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

      if (slots.length > 0) {
        addChainItemsBatch(
          slots.map((sl) => ({
            patternIndex: brushPatternIdx,
            startMeasure: roundBeat(sl.startBeat / beatsPerMeasure),
            durationMeasures: roundBeat(sl.durationBeats / beatsPerMeasure),
            laneIndex
          }))
        );
        if (isPatternRepeatOn) {
          setPatternRepeatOn(false);
        }
      }
    };

    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    if (!e.dataTransfer.types.includes(DRUM_PATTERN_DRAG_MIME)) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'copy';

    const rect = e.currentTarget.getBoundingClientRect();
    const rawBeat = (e.clientX - rect.left) / zoomLevel;
    const snapped = getFloorSnappedBeat(rawBeat, e.altKey);
    const idx = Math.max(0, currentDrumPatternEdit);
    setDropGhost({
      startBeat: snapped,
      durationBeats: beatsPerMeasure,
      label: getDrumPatternName(idx, drumPatternNames),
      color: getDrumPatternColor(idx)
    });
  };

  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    if (e.currentTarget.contains(e.relatedTarget as Node)) return;
    setDropGhost(null);
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    const raw = e.dataTransfer.getData(DRUM_PATTERN_DRAG_MIME);
    if (!raw) return;
    e.preventDefault();
    e.stopPropagation();
    setDropGhost(null);

    const parsedIdx = Number(raw);
    if (Number.isNaN(parsedIdx) || parsedIdx < 0) return;

    const rect = e.currentTarget.getBoundingClientRect();
    const rawBeat = (e.clientX - rect.left) / zoomLevel;
    const snapped = getFloorSnappedBeat(rawBeat, e.altKey);
    setCurrentDrumPatternEdit(parsedIdx);
    addChainItem(parsedIdx, 1, roundBeat(snapped / beatsPerMeasure), laneIndex);
    if (isPatternRepeatOn) setPatternRepeatOn(false);
    setSelectedPlaylistTrack({ kind: 'drums', laneIndex });
  };

  const brushColor = getDrumPatternColor(currentDrumPatternEdit);
  const brushLabel = getDrumPatternName(currentDrumPatternEdit, drumPatternNames);
  const barPx = zoomLevel * beatsPerMeasure;

  return (
    <div
      className={`audio-track-lane midi-track-lane drum-track-lane ${isMuted ? 'lane-muted' : ''} ${
        isPatternRepeatOn ? 'lane-bypassed' : ''
      } ${playlistTool === 'paint' ? 'paint-cursor' : playlistTool === 'slice' ? 'slice-cursor' : ''}`}
      data-drum-lane="true"
      data-drum-lane-index={String(laneIndex)}
      style={{
        width: totalWidth,
        minWidth: totalWidth,
        backgroundSize: `${barPx}px 100%, ${zoomLevel}px 100%`,
        backgroundImage:
          'linear-gradient(to right, rgba(45, 212, 191, 0.22) 1px, transparent 1px), linear-gradient(to right, rgba(255, 255, 255, 0.035) 1px, transparent 1px)'
      }}
      onPointerDown={handleLanePointerDown}
      onDoubleClick={(e) => {
        if (e.target === e.currentTarget) {
          jumpToDrumEditor(currentDrumPatternEdit);
        }
      }}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {linearClips.length === 0 && paintGhosts.length === 0 && !dropGhost && (
        <div className="tracks-empty-lane-hint">
          {laneIndex === 0
            ? 'Clic o arrastra patrones P1..PN para secuenciar la batería (1:1 con Drum Sequencer)'
            : `Capa C${laneIndex + 1} · Superpone patrones/fills en paralelo (1:1 con Drum Sequencer)`}
        </div>
      )}

      {linearClips.map((clip) => (
        <DrumClipComponent
          key={clip.id}
          clip={clip}
          zoomLevel={zoomLevel}
          beatsPerMeasure={beatsPerMeasure}
          isSelected={selectedChainIds.includes(clip.id)}
          isPlayingClip={!isPatternRepeatOn && activePlayingIds.includes(clip.id)}
        />
      ))}

      {paintGhosts.map((g, i) => (
        <div
          key={`drum_paint_${i}`}
          className="midi-pattern-clip paint-ghost"
          style={{
            left: g.startBeat * zoomLevel,
            width: Math.max(16, g.durationBeats * zoomLevel - 2),
            borderColor: brushColor
          }}
        >
          <div className="midi-clip-header" style={{ backgroundColor: `${brushColor}38` }}>
            <span className="midi-clip-title">{brushLabel}</span>
          </div>
        </div>
      ))}

      {dropGhost && (
        <div
          className="midi-pattern-clip paint-ghost"
          style={{
            left: dropGhost.startBeat * zoomLevel,
            width: Math.max(16, dropGhost.durationBeats * zoomLevel - 2),
            borderColor: dropGhost.color
          }}
        >
          <div className="midi-clip-header" style={{ backgroundColor: `${dropGhost.color}38` }}>
            <span className="midi-clip-title">{dropGhost.label}</span>
          </div>
        </div>
      )}
    </div>
  );
};
