/**
 * MelodyTrackLane.tsx
 * Pista dedicada 1:1 para cada canal de Piano Roll (`PianoRollTrack`) en Tracks.
 * - Cabecera sincronizada 1:1 con nombre, color, instrumento y Mute/Solo del Mixer.
 * - Carril renderiza regiones sincronizadas directamente sobre `track.notes`:
 *   mover, recortar (izquierda/derecha), estirar/repetir un motivo, dividir (Slice),
 *   copiar/pegar, duplicar, silenciar y borrar modifican `track.notes` al instante,
 *   reproduciéndose y viéndose 100% igual en la vista de Piano Roll.
 */

import React, { useState, useEffect, useMemo } from 'react';
import {
  Trash2,
  ExternalLink,
  Scissors,
  Copy,
  Repeat,
  Volume2,
  VolumeX
} from 'lucide-react';
import type { MelodyRegion, PianoRollTrack } from '../../utils/typeDefinitions';
import { useSongStore } from '../../store/songStore';
import { useShallow } from 'zustand/react/shallow';
import { getBeatsPerMeasure } from '../../core/audio/arrangementResolver';
import {
  applyLeftResizeFromSnapshot,
  applyRightResizeFromSnapshot,
  captureMelodyRegionResizeSnapshot,
  getLocalNormalizedRegionNotes,
  reconcileTrackRegions,
  roundBeat
} from '../../core/audio/melodyRegionUtils';
import { toneEngine } from '../../audio/toneEngine';
import { PatternMiniPreview } from './PatternMiniPreview';
import { MidiKeysMiniIcon } from './PatternPickerSidebar';
import { ContextMenuContainer } from '../ui/ContextMenuContainer';
import { startPlaylistGroupDrag, snapPlaylistBeat } from './playlistGroupDrag';

interface MelodyTrackHeaderProps {
  track: PianoRollTrack;
  canDelete: boolean;
  onRequestDeleteTrack: (trackId: string, trackName: string) => void;
}

export const MelodyTrackHeader: React.FC<MelodyTrackHeaderProps> = ({
  track,
  canDelete,
  onRequestDeleteTrack
}) => {
  const {
    channel,
    selectedPlaylistTrack,
    setSelectedPlaylistTrack,
    renamePianoRollTrack,
    removePianoRollTrack,
    toggleMute,
    toggleSolo,
    openSynthConfigForChannel,
    jumpToMelodyEditor
  } = useSongStore(
    useShallow((state) => ({
      channel: state.channels?.[track.channelId],
      selectedPlaylistTrack: state.selectedPlaylistTrack,
      setSelectedPlaylistTrack: state.setSelectedPlaylistTrack,
      renamePianoRollTrack: state.renamePianoRollTrack,
      removePianoRollTrack: state.removePianoRollTrack,
      toggleMute: state.toggleMute,
      toggleSolo: state.toggleSolo,
      openSynthConfigForChannel: state.openSynthConfigForChannel,
      jumpToMelodyEditor: state.jumpToMelodyEditor
    }))
  );

  const [trackName, setTrackName] = useState(track.name);
  const isSelected =
    selectedPlaylistTrack.kind === 'melody' && selectedPlaylistTrack.trackId === track.id;
  const isMuted = Boolean(channel?.muted);
  const isSolo = Boolean(channel?.solo);
  const instLabel = channel?.instrument === 'piano' ? 'PIANO' : 'SYNTH';
  const noteCount = track.notes?.length || 0;
  const accent = track.color || '#a78bfa';

  useEffect(() => {
    setTrackName(track.name);
  }, [track.name]);

  const handleNameBlur = () => {
    if (trackName.trim()) {
      renamePianoRollTrack(track.id, trackName.trim());
    } else {
      setTrackName(track.name);
    }
  };

  const handleNameKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      handleNameBlur();
      e.currentTarget.blur();
    } else if (e.key === 'Escape') {
      setTrackName(track.name);
      e.currentTarget.blur();
    }
  };

  return (
    <div
      className={`audio-track-header midi-track-header melody-track-header ${isSelected ? 'selected' : ''} ${isMuted ? 'is-muted' : ''}`}
      onClick={() => setSelectedPlaylistTrack({ kind: 'melody', trackId: track.id })}
      onDoubleClick={() => jumpToMelodyEditor(track.id)}
      style={{ '--channel-color': accent } as React.CSSProperties}
      title={`Pista 1:1 con Piano Roll (${track.name}) · Doble clic para abrir en Piano Roll`}
    >
      <div className="audio-track-color-strip" style={{ backgroundColor: accent }} />

      <div className="audio-track-title-strip midi-title-strip" onClick={(e) => e.stopPropagation()}>
        <button
          type="button"
          className="midi-track-type-pill clickable-pill"
          style={{ borderColor: `${accent}77`, color: accent }}
          onClick={() => {
            if (channel?.instrument !== 'piano') {
              openSynthConfigForChannel(track.channelId);
            } else {
              jumpToMelodyEditor(track.id);
            }
          }}
          title={
            channel?.instrument === 'piano'
              ? 'Instrumento: Piano (Clic para abrir Piano Roll)'
              : 'Instrumento: Sintetizador (Clic para configurar Synth)'
          }
        >
          {instLabel}
        </button>

        <input
          className="audio-track-name-input midi-track-name-input"
          value={trackName}
          onChange={(e) => setTrackName(e.target.value)}
          onBlur={handleNameBlur}
          onKeyDown={handleNameKeyDown}
          title="Renombrar pista de Piano Roll"
        />

        <button
          type="button"
          className="tracks-open-editor-btn"
          onClick={(e) => {
            e.stopPropagation();
            jumpToMelodyEditor(track.id);
          }}
          title={`Abrir ${track.name} en Piano Roll`}
        >
          <ExternalLink size={11} />
        </button>

        {canDelete && (
          <button
            type="button"
            className="audio-track-delete-btn"
            onClick={(e) => {
              e.stopPropagation();
              if (noteCount === 0) {
                removePianoRollTrack(track.id);
              } else {
                onRequestDeleteTrack(track.id, track.name);
              }
            }}
            title={`Eliminar pista ${track.name}`}
          >
            <Trash2 size={12} />
          </button>
        )}
      </div>

      <div className="midi-track-right-controls" onClick={(e) => e.stopPropagation()}>
        {noteCount > 0 && (
          <span className="midi-track-clip-count" title={`${noteCount} notas en Piano Roll`}>
            {noteCount}
          </span>
        )}

        <button
          type="button"
          className={`fl-enable-led-btn ${!isMuted ? 'enabled' : ''}`}
          onClick={() => toggleMute(track.channelId)}
          title={isMuted ? `Activar ${track.name}` : `Silenciar ${track.name}`}
        >
          <span className="fl-enable-led-dot" />
        </button>

        <div className="drum-mute-solo">
          <button
            type="button"
            className={`ms-btn ${isMuted ? 'active-mute' : ''}`}
            onClick={() => toggleMute(track.channelId)}
            title={isMuted ? 'Desmutear pista' : 'Silenciar pista (Mute)'}
          >
            M
          </button>
          <button
            type="button"
            className={`ms-btn ${isSolo ? 'active-solo' : ''}`}
            onClick={() => toggleSolo(track.channelId)}
            title={isSolo ? 'Desactivar Solo' : 'Aislar pista (Solo)'}
          >
            S
          </button>
        </div>
      </div>
    </div>
  );
};

interface MelodyClipComponentProps {
  track: PianoRollTrack;
  region: MelodyRegion;
  zoomLevel: number;
  beatsPerMeasure: number;
  isSelected: boolean;
}

const MelodyClipComponent: React.FC<MelodyClipComponentProps> = React.memo(({
  track,
  region,
  zoomLevel,
  beatsPerMeasure,
  isSelected
}) => {
  const {
    snapGrid,
    playlistTool,
    currentBeat,
    splitMelodyRegion,
    repeatMelodyRegion,
    duplicateSelectedMelodyRegions,
    toggleMuteSelectedMelodyRegions,
    deleteSelectedMelodyRegions,
    selectMelodyRegion,
    jumpToMelodyEditor
  } = useSongStore(
    useShallow((state) => ({
      snapGrid: state.audioSnapGrid,
      playlistTool: state.playlistTool,
      currentBeat: state.currentBeat,
      splitMelodyRegion: state.splitMelodyRegion,
      repeatMelodyRegion: state.repeatMelodyRegion,
      duplicateSelectedMelodyRegions: state.duplicateSelectedMelodyRegions,
      toggleMuteSelectedMelodyRegions: state.toggleMuteSelectedMelodyRegions,
      deleteSelectedMelodyRegions: state.deleteSelectedMelodyRegions,
      selectMelodyRegion: state.selectMelodyRegion,
      jumpToMelodyEditor: state.jumpToMelodyEditor
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

  const localNotes = useMemo(
    () => getLocalNormalizedRegionNotes(track.notes, region),
    [track.notes, region]
  );

  const isRegionMuted = useMemo(
    () => localNotes.length > 0 && localNotes.every((n) => Boolean(n.muted)),
    [localNotes]
  );

  const accent = track.color || '#a78bfa';
  const leftPx = region.startBeat * zoomLevel;
  const widthPx = Math.max(16, region.durationBeats * zoomLevel - 2);
  const barsLabel = `${Math.round((region.durationBeats / beatsPerMeasure) * 10) / 10}c`;
  const isLooped = Boolean(
    region.loopLengthBeats && region.durationBeats > region.loopLengthBeats + 0.01
  );

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
        splitMelodyRegion(track.id, region.id, cutBeat);
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
        splitMelodyRegion(track.id, region.id, cutBeat);
      }
      return;
    }

    startPlaylistGroupDrag({
      e,
      anchorKind: 'melody',
      anchorTrackId: track.id,
      anchorClipId: region.id,
      zoomLevel,
      beatsPerMeasure,
      snapGrid
    });
  };

  // Tirador Izquierdo: recorta inicio o extiende hacia atrás (1:1 con Piano Roll + Zundo atómico)
  const handleTrimLeftDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    if (e.button !== 0) return;

    const initialState = useSongStore.getState();
    const initialTracks = initialState.tracks;
    const initialMelodyNotes = initialState.melodyNotes;
    const currentTrack = initialTracks.find((t) => t.id === track.id);
    if (!currentTrack) return;

    const snapshot = captureMelodyRegionResizeSnapshot(currentTrack, region.id, beatsPerMeasure);
    if (!snapshot) return;

    const startX = e.clientX;
    const initialStart = snapshot.region.startBeat;
    const initialEnd = roundBeat(initialStart + snapshot.region.durationBeats);
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);

    useSongStore.temporal.getState().pause();
    let lastTargetStart: number | null = null;

    const applyToStore = (targetStart: number) => {
      const res = applyLeftResizeFromSnapshot(snapshot, targetStart);
      const nextTracks = initialTracks.map((t) =>
        t.id === track.id ? { ...t, notes: res.notes, regions: res.regions } : t
      );
      const activeTrack = nextTracks.find((t) => t.id === initialState.activeTrackId);
      useSongStore.setState({
        tracks: nextTracks,
        melodyNotes: activeTrack ? activeTrack.notes : initialMelodyNotes,
        selectedMelodyRegionRefs: [{ trackId: track.id, regionId: res.regionId }]
      });
    };

    const onMove = (me: PointerEvent) => {
      const dx = me.clientX - startX;
      const rawStart = initialStart + dx / zoomLevel;
      const snappedStart = me.altKey
        ? Math.max(0, roundBeat(rawStart))
        : snapPlaylistBeat(rawStart, snapGrid, beatsPerMeasure);
      const clampedStart = Math.max(0, Math.min(roundBeat(initialEnd - 0.25), snappedStart));
      lastTargetStart = clampedStart;
      applyToStore(clampedStart);
    };

    const onUp = (ue: PointerEvent) => {
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      try {
        el.releasePointerCapture(ue.pointerId);
      } catch {}

      if (lastTargetStart !== null && Math.abs(lastTargetStart - initialStart) > 1e-4) {
        useSongStore.setState({ tracks: initialTracks, melodyNotes: initialMelodyNotes });
        useSongStore.temporal.getState().resume();
        applyToStore(lastTargetStart);
      } else {
        useSongStore.temporal.getState().resume();
      }
    };

    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
  };

  // Tirador Derecho: encoger = recorta notas; estirar = REPITE/BUCLEA el motivo en notas reales (1:1 Piano Roll!)
  const handleTrimRightDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    if (e.button !== 0) return;

    const initialState = useSongStore.getState();
    const initialTracks = initialState.tracks;
    const initialMelodyNotes = initialState.melodyNotes;
    const currentTrack = initialTracks.find((t) => t.id === track.id);
    if (!currentTrack) return;

    const snapshot = captureMelodyRegionResizeSnapshot(currentTrack, region.id, beatsPerMeasure);
    if (!snapshot) return;

    const startX = e.clientX;
    const initialStart = snapshot.region.startBeat;
    const initialDur = snapshot.region.durationBeats;
    const initialEnd = roundBeat(initialStart + initialDur);
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);

    useSongStore.temporal.getState().pause();
    let lastTargetDur: number | null = null;

    const applyToStore = (targetDur: number, isFinal: boolean) => {
      const res = applyRightResizeFromSnapshot(snapshot, targetDur, isFinal);
      const nextTracks = initialTracks.map((t) =>
        t.id === track.id ? { ...t, notes: res.notes, regions: res.regions } : t
      );
      const activeTrack = nextTracks.find((t) => t.id === initialState.activeTrackId);
      useSongStore.setState({
        tracks: nextTracks,
        melodyNotes: activeTrack ? activeTrack.notes : initialMelodyNotes,
        selectedMelodyRegionRefs: [{ trackId: track.id, regionId: res.regionId }]
      });
    };

    const onMove = (me: PointerEvent) => {
      const dx = me.clientX - startX;
      const rawEnd = initialEnd + dx / zoomLevel;
      const snappedEnd = me.altKey
        ? Math.max(initialStart + 0.25, roundBeat(rawEnd))
        : Math.max(initialStart + 0.25, snapPlaylistBeat(rawEnd, snapGrid, beatsPerMeasure));
      const nextDur = Math.max(0.25, roundBeat(snappedEnd - initialStart));
      lastTargetDur = nextDur;
      applyToStore(nextDur, false);
    };

    const onUp = (ue: PointerEvent) => {
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      try {
        el.releasePointerCapture(ue.pointerId);
      } catch {}

      if (lastTargetDur !== null && Math.abs(lastTargetDur - initialDur) > 1e-4) {
        useSongStore.setState({ tracks: initialTracks, melodyNotes: initialMelodyNotes });
        useSongStore.temporal.getState().resume();
        applyToStore(lastTargetDur, true);
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
        className={`midi-pattern-clip melody-region-clip ${isSelected ? 'selected' : ''} ${
          isRegionMuted ? 'muted' : ''
        } ${playlistTool === 'slice' ? 'slice-cursor' : ''}`}
        style={{
          left: leftPx,
          width: widthPx,
          borderColor: isSelected ? '#ffd875' : `${accent}88`,
          '--clip-accent': accent
        } as React.CSSProperties}
        onPointerDown={handleBodyPointerDown}
        onClick={(e) => e.stopPropagation()}
        onDoubleClick={(e) => {
          e.stopPropagation();
          jumpToMelodyEditor(track.id, region.startBeat);
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          if (e.shiftKey) return;
          if (!isSelected) {
            selectMelodyRegion(track.id, region.id, false);
          }
          setContextMenu({ x: e.clientX, y: e.clientY });
        }}
        title={`${region.name || track.name} (${barsLabel} · ${localNotes.length} notas) — Doble clic: editar en Piano Roll · Estirar borde derecho: repetir motivo · Shift+Arrastrar: clonar`}
      >
        <div
          className="audio-clip-trim-handle left"
          onPointerDown={handleTrimLeftDown}
          title="Recortar inicio o extender hacia atrás (Alt para libre)"
        />

        <div className="midi-clip-header" style={{ backgroundColor: `${accent}30` }}>
          <span className="midi-clip-header-left">
            <MidiKeysMiniIcon color={accent} size={11} />
            <span className="midi-clip-title">{region.name || track.name}</span>
          </span>
          {widthPx > 60 && (
            <span className="midi-clip-bars">
              {isRegionMuted ? 'MUTE' : isLooped ? `↻ ${barsLabel}` : barsLabel}
            </span>
          )}
        </div>

        <div className="midi-clip-body">
          <PatternMiniPreview
            kind="melody"
            notes={localNotes}
            durationBeats={region.durationBeats}
            loopLengthBeats={region.loopLengthBeats}
            color={accent}
            width={Math.max(12, widthPx - 2)}
            height={36}
            showLoopMarkers
          />
        </div>

        <div
          className="audio-clip-trim-handle right"
          onPointerDown={handleTrimRightDown}
          title="Estirar hacia la derecha para repetir este fragmento en bucle · Encoger para recortar (1:1 con Piano Roll)"
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
              jumpToMelodyEditor(track.id, region.startBeat);
              setContextMenu(null);
            }}
          >
            <ExternalLink size={12} />
            <span>Editar en Piano Roll</span>
            <span className="shortcut-hint">2×Clic</span>
          </button>
          <button
            type="button"
            className="context-menu-item"
            onClick={() => {
              repeatMelodyRegion(track.id, region.id);
              setContextMenu(null);
            }}
          >
            <Repeat size={12} style={{ color: '#ffd875' }} />
            <span>Repetir motivo (×2)</span>
          </button>
          <div className="context-menu-divider" />
          <button
            type="button"
            className="context-menu-item"
            onClick={() => {
              splitMelodyRegion(track.id, region.id, currentBeat);
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
              if (!isSelected) selectMelodyRegion(track.id, region.id, false);
              duplicateSelectedMelodyRegions();
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
              if (!isSelected) selectMelodyRegion(track.id, region.id, false);
              toggleMuteSelectedMelodyRegions();
              setContextMenu(null);
            }}
          >
            {isRegionMuted ? <Volume2 size={12} /> : <VolumeX size={12} />}
            <span>{isRegionMuted ? 'Activar notas' : 'Silenciar notas'}</span>
            <span className="shortcut-hint">M</span>
          </button>
          <div className="context-menu-divider" />
          <button
            type="button"
            className="context-menu-item danger"
            onClick={() => {
              if (!isSelected) selectMelodyRegion(track.id, region.id, false);
              deleteSelectedMelodyRegions();
              setContextMenu(null);
            }}
          >
            <Trash2 size={12} />
            <span>Eliminar fragmento</span>
            <span className="shortcut-hint">Supr</span>
          </button>
        </ContextMenuContainer>
      )}
    </>
  );
});

interface MelodyTrackLaneProps {
  track: PianoRollTrack;
  zoomLevel: number;
  totalWidth: number;
}

export const MelodyTrackLane: React.FC<MelodyTrackLaneProps> = ({
  track,
  zoomLevel,
  totalWidth
}) => {
  const {
    channel,
    selectedMelodyRegionRefs,
    timeSignature,
    snapGrid,
    playlistTool,
    setSelectedPlaylistTrack,
    jumpToMelodyEditor
  } = useSongStore(
    useShallow((state) => ({
      channel: state.channels?.[track.channelId],
      selectedMelodyRegionRefs: state.selectedMelodyRegionRefs || [],
      timeSignature: state.timeSignature || '4/4',
      snapGrid: state.audioSnapGrid,
      playlistTool: state.playlistTool,
      setSelectedPlaylistTrack: state.setSelectedPlaylistTrack,
      jumpToMelodyEditor: state.jumpToMelodyEditor
    }))
  );

  const beatsPerMeasure = getBeatsPerMeasure(timeSignature);
  const isMuted = Boolean(channel?.muted);

  const regions = useMemo(
    () => reconcileTrackRegions(track.id, track.notes, track.regions, beatsPerMeasure),
    [track.id, track.notes, track.regions, beatsPerMeasure]
  );

  const selectedIdsForTrack = useMemo(() => {
    const set = new Set<string>();
    for (const ref of selectedMelodyRegionRefs) {
      if (ref.trackId === track.id) set.add(ref.regionId);
    }
    return set;
  }, [selectedMelodyRegionRefs, track.id]);

  const handleLaneClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return;
    setSelectedPlaylistTrack({ kind: 'melody', trackId: track.id });
    if (playlistTool === 'select' || e.ctrlKey || e.metaKey) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const rawBeat = (e.clientX - rect.left) / zoomLevel;
    const targetBeat = e.altKey ? Math.max(0, rawBeat) : snapPlaylistBeat(rawBeat, snapGrid, beatsPerMeasure);
    toneEngine.seekToBeat(targetBeat);
  };

  const handleLaneDoubleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const rawBeat = Math.max(0, (e.clientX - rect.left) / zoomLevel);
    const snapped = snapPlaylistBeat(rawBeat, 'bar', beatsPerMeasure);
    jumpToMelodyEditor(track.id, snapped);
  };

  const barPx = zoomLevel * beatsPerMeasure;

  return (
    <div
      className={`audio-track-lane midi-track-lane melody-track-lane ${isMuted ? 'lane-muted' : ''} ${
        playlistTool === 'slice' ? 'slice-cursor' : ''
      }`}
      data-melody-track-id={track.id}
      style={{
        width: totalWidth,
        minWidth: totalWidth,
        backgroundSize: `${barPx}px 100%, ${zoomLevel}px 100%`,
        backgroundImage:
          'linear-gradient(to right, rgba(167, 139, 250, 0.2) 1px, transparent 1px), linear-gradient(to right, rgba(255, 255, 255, 0.035) 1px, transparent 1px)'
      }}
      onClick={handleLaneClick}
      onDoubleClick={handleLaneDoubleClick}
    >
      {regions.length === 0 && (
        <div className="tracks-empty-lane-hint">
          Sin notas en {track.name} · Doble clic para escribir en Piano Roll
        </div>
      )}

      {regions.map((region) => (
        <MelodyClipComponent
          key={region.id}
          track={track}
          region={region}
          zoomLevel={zoomLevel}
          beatsPerMeasure={beatsPerMeasure}
          isSelected={selectedIdsForTrack.has(region.id)}
        />
      ))}
    </div>
  );
};
