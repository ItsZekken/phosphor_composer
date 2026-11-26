/**
 * MidiTrackLane.tsx
 * Cabecera (MidiTrackHeader) y Carril de Patrones (MidiTrackLane) para la Playlist estilo FL Studio.
 * Soporta pintado continuo con pincel (Brush/Paint de múltiples compases), Drag & Drop desde el Pattern Picker,
 * LED de activación estilo FL Studio + controles hardware M/S, y cuadrícula dinámica alineada al zoom.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Trash2 } from 'lucide-react';
import type { MidiTrack, MidiPatternClip, SelectedPatternRef } from '../../utils/typeDefinitions';
import { useSongStore } from '../../store/songStore';
import { useShallow } from 'zustand/react/shallow';
import { MidiClipComponent } from './MidiClipComponent';
import { PATTERN_DRAG_MIME } from './PatternPickerSidebar';
import {
  ensureTrackPatterns,
  getBeatsPerMeasure,
  getDrumPatternColor,
  getDrumPatternName,
  getMelodyPatternLengthBeats
} from '../../core/audio/arrangementResolver';

interface MidiTrackHeaderProps {
  track: MidiTrack;
  clipCount: number;
}

export const MidiTrackHeader: React.FC<MidiTrackHeaderProps> = ({ track, clipCount }) => {
  const {
    selectedMidiTrackId,
    selectedPlaylistTrackKind,
    setSelectedMidiTrackId,
    updateMidiTrack,
    removeMidiTrack
  } = useSongStore(
    useShallow((state) => ({
      selectedMidiTrackId: state.selectedMidiTrackId,
      selectedPlaylistTrackKind: state.selectedPlaylistTrackKind,
      setSelectedMidiTrackId: state.setSelectedMidiTrackId,
      updateMidiTrack: state.updateMidiTrack,
      removeMidiTrack: state.removeMidiTrack
    }))
  );

  const [trackName, setTrackName] = useState(track.name);
  const isSelected = selectedPlaylistTrackKind === 'midi' && selectedMidiTrackId === track.id;

  useEffect(() => {
    setTrackName(track.name);
  }, [track.name]);

  const handleNameBlur = () => {
    if (trackName.trim()) {
      updateMidiTrack(track.id, { name: trackName.trim() });
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
      className={`audio-track-header midi-track-header ${isSelected ? 'selected' : ''} ${track.muted ? 'is-muted' : ''}`}
      onClick={() => setSelectedMidiTrackId(track.id)}
      style={{ '--channel-color': track.color } as React.CSSProperties}
    >
      <div className="audio-track-color-strip" style={{ backgroundColor: track.color }} />

      <div className="audio-track-title-strip midi-title-strip" onClick={(e) => e.stopPropagation()}>
        <span className="midi-track-type-pill" style={{ borderColor: `${track.color}66`, color: track.color }}>
          MIDI
        </span>
        <input
          className="audio-track-name-input midi-track-name-input"
          value={trackName}
          onChange={(e) => setTrackName(e.target.value)}
          onBlur={handleNameBlur}
          onKeyDown={handleNameKeyDown}
          title="Haz clic o escribe para renombrar pista MIDI"
        />
        <button
          type="button"
          className="audio-track-delete-btn"
          onClick={(e) => {
            e.stopPropagation();
            removeMidiTrack(track.id);
          }}
          title="Eliminar pista MIDI"
        >
          <Trash2 size={12} />
        </button>
      </div>

      <div className="midi-track-right-controls" onClick={(e) => e.stopPropagation()}>
        {clipCount > 0 && (
          <span className="midi-track-clip-count" title={`${clipCount} patrones en esta pista`}>
            {clipCount}
          </span>
        )}

        {/* LED verde estilo FL Studio Playlist Track Enable/Mute */}
        <button
          type="button"
          className={`fl-enable-led-btn ${!track.muted ? 'enabled' : ''}`}
          onClick={() => updateMidiTrack(track.id, { muted: !track.muted })}
          title={track.muted ? 'Activar pista MIDI' : 'Desactivar / silenciar pista MIDI'}
          aria-label={track.muted ? 'Activar pista MIDI' : 'Silenciar pista MIDI'}
        >
          <span className="fl-enable-led-dot" />
        </button>

        {/* Botones M / S alineados con las pistas de audio */}
        <div className="drum-mute-solo">
          <button
            type="button"
            className={`ms-btn ${track.muted ? 'active-mute' : ''}`}
            onClick={() => updateMidiTrack(track.id, { muted: !track.muted })}
            title={track.muted ? 'Desmutear pista MIDI' : 'Silenciar pista MIDI (Mute)'}
          >
            M
          </button>
          <button
            type="button"
            className={`ms-btn ${track.solo ? 'active-solo' : ''}`}
            onClick={() => updateMidiTrack(track.id, { solo: !track.solo })}
            title={track.solo ? 'Desactivar Solo' : 'Aislar pista MIDI (Solo)'}
          >
            S
          </button>
        </div>
      </div>
    </div>
  );
};

interface MidiTrackLaneProps {
  track: MidiTrack;
  clips: MidiPatternClip[];
  zoomLevel: number;
  totalWidth: number;
}

export const MidiTrackLane: React.FC<MidiTrackLaneProps> = ({
  track,
  clips,
  zoomLevel,
  totalWidth
}) => {
  const {
    selectedMidiClipIds,
    selectMidiClip,
    setSelectedMidiTrackId,
    selectedPatternRef,
    playlistTool,
    snapGrid,
    timeSignature,
    tracks,
    drumPatternNames,
    addMidiClip,
    addMidiClipsBatch
  } = useSongStore(
    useShallow((state) => ({
      selectedMidiClipIds: state.selectedMidiClipIds || [],
      selectMidiClip: state.selectMidiClip,
      setSelectedMidiTrackId: state.setSelectedMidiTrackId,
      selectedPatternRef: state.selectedPatternRef,
      playlistTool: state.playlistTool,
      snapGrid: state.audioSnapGrid,
      timeSignature: state.timeSignature || '4/4',
      tracks: state.tracks || [],
      drumPatternNames: state.drumPatternNames || [],
      addMidiClip: state.addMidiClip,
      addMidiClipsBatch: state.addMidiClipsBatch
    }))
  );

  const beatsPerMeasure = getBeatsPerMeasure(timeSignature);

  // Fantasmas de pintado (Brush drag) y Drop desde Picker
  const [paintGhosts, setPaintGhosts] = useState<Array<{ startBeat: number; durationBeats: number }>>([]);
  const [dropGhost, setDropGhost] = useState<{ startBeat: number; durationBeats: number; label: string; color: string } | null>(null);

  const resolvePatternMeta = useCallback(
    (ref: SelectedPatternRef) => {
      if (ref.sourceType === 'drums') {
        const idx = Math.max(0, ref.drumPatternIndex);
        return {
          durationBeats: beatsPerMeasure,
          label: getDrumPatternName(idx, drumPatternNames),
          color: getDrumPatternColor(idx)
        };
      }
      const melTrack = tracks.find((t) => t.id === ref.melodyTrackId) || tracks[0];
      if (!melTrack) {
        return {
          durationBeats: beatsPerMeasure,
          label: 'Patrón 1',
          color: '#a78bfa'
        };
      }
      const { patterns, activePattern } = ensureTrackPatterns(melTrack);
      const pat = patterns.find((p) => p.id === ref.melodyPatternId) || activePattern;
      return {
        durationBeats: getMelodyPatternLengthBeats(pat, beatsPerMeasure),
        label: `${melTrack.name} · ${pat.name}`,
        color: melTrack.color || '#a78bfa'
      };
    },
    [beatsPerMeasure, drumPatternNames, tracks]
  );

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
      return Math.max(0, Math.floor(rawBeat / step) * step);
    },
    [snapGrid, beatsPerMeasure]
  );

  // Pintado estilo FL Studio Brush: clic pinta 1 patrón, arrastrar horizontalmente pinta copias consecutivas
  const handleLanePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return;
    if (e.button !== 0) return;

    setSelectedMidiTrackId(track.id);

    // En modo Selección o con Ctrl/Meta, dejar burbujear al marquee del contenedor
    if (playlistTool === 'select' || e.ctrlKey || e.metaKey) {
      return;
    }

    // En modo Navaja sobre espacio vacío, no pintar
    if (playlistTool === 'slice') {
      return;
    }

    e.preventDefault();
    e.stopPropagation();

    const el = e.currentTarget;
    const laneRect = el.getBoundingClientRect();
    const brushRef = selectedPatternRef;
    const meta = resolvePatternMeta(brushRef);
    const patDur = Math.max(0.25, meta.durationBeats);

    const anchorBeat = getFloorSnappedBeat((e.clientX - laneRect.left) / zoomLevel, e.altKey);
    const paintedMap = new Map<number, { startBeat: number; durationBeats: number }>();
    paintedMap.set(anchorBeat, { startBeat: anchorBeat, durationBeats: patDur });
    setPaintGhosts(Array.from(paintedMap.values()));

    el.setPointerCapture(e.pointerId);

    const onPointerMove = (me: PointerEvent) => {
      const curBeat = Math.max(0, (me.clientX - laneRect.left) / zoomLevel);
      const diff = curBeat - anchorBeat;
      const stepsDelta = diff >= 0 ? Math.floor(diff / patDur) : Math.ceil(diff / patDur);

      const nextMap = new Map<number, { startBeat: number; durationBeats: number }>();
      const startStep = Math.min(0, stepsDelta);
      const endStep = Math.max(0, stepsDelta);
      for (let s = startStep; s <= endStep; s++) {
        const b = Math.max(0, anchorBeat + s * patDur);
        nextMap.set(b, { startBeat: b, durationBeats: patDur });
      }
      paintedMap.clear();
      nextMap.forEach((v, k) => paintedMap.set(k, v));
      setPaintGhosts(Array.from(nextMap.values()));
    };

    const onPointerUp = (ue: PointerEvent) => {
      el.removeEventListener('pointermove', onPointerMove);
      el.removeEventListener('pointerup', onPointerUp);
      try {
        el.releasePointerCapture(ue.pointerId);
      } catch (_) {}

      const toInsert = Array.from(paintedMap.values()).sort((a, b) => a.startBeat - b.startBeat);
      setPaintGhosts([]);

      if (toInsert.length > 0) {
        const createdIds = addMidiClipsBatch(
          toInsert.map((slot) => ({
            midiTrackId: track.id,
            sourceType: brushRef.sourceType,
            ...(brushRef.sourceType === 'drums'
              ? { drumPatternIndex: brushRef.drumPatternIndex }
              : {
                  melodyTrackId: brushRef.melodyTrackId,
                  melodyPatternId: brushRef.melodyPatternId
                }),
            startBeat: slot.startBeat,
            durationBeats: slot.durationBeats,
            offsetBeats: 0,
            isMuted: false
          }))
        );
        if (createdIds.length > 0) {
          useSongStore.getState().setSelectedMidiClipIds(createdIds);
        }
      }
    };

    el.addEventListener('pointermove', onPointerMove);
    el.addEventListener('pointerup', onPointerUp);
  };

  // Drag & Drop de Patrones desde PatternPickerSidebar
  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    if (!e.dataTransfer.types.includes(PATTERN_DRAG_MIME)) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'copy';

    const rect = e.currentTarget.getBoundingClientRect();
    const rawBeat = (e.clientX - rect.left) / zoomLevel;
    const snapped = getFloorSnappedBeat(rawBeat, e.altKey);
    const meta = resolvePatternMeta(selectedPatternRef);
    setDropGhost({
      startBeat: snapped,
      durationBeats: meta.durationBeats,
      label: meta.label,
      color: meta.color
    });
  };

  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    if (e.currentTarget.contains(e.relatedTarget as Node)) return;
    setDropGhost(null);
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    const raw = e.dataTransfer.getData(PATTERN_DRAG_MIME);
    if (!raw) return;
    e.preventDefault();
    e.stopPropagation();
    setDropGhost(null);

    try {
      const ref = JSON.parse(raw) as SelectedPatternRef;
      const rect = e.currentTarget.getBoundingClientRect();
      const rawBeat = (e.clientX - rect.left) / zoomLevel;
      const snapped = getFloorSnappedBeat(rawBeat, e.altKey);
      const meta = resolvePatternMeta(ref);

      const newId = addMidiClip({
        midiTrackId: track.id,
        sourceType: ref.sourceType,
        ...(ref.sourceType === 'drums'
          ? { drumPatternIndex: ref.drumPatternIndex }
          : {
              melodyTrackId: ref.melodyTrackId,
              melodyPatternId: ref.melodyPatternId
            }),
        startBeat: snapped,
        durationBeats: meta.durationBeats,
        offsetBeats: 0,
        isMuted: false
      });
      setSelectedMidiTrackId(track.id);
      useSongStore.getState().setSelectedMidiClipIds([newId]);
    } catch (err) {
      console.warn('[MidiTrackLane] Error al soltar patrón:', err);
    }
  };

  const activeBrushMeta = resolvePatternMeta(selectedPatternRef);
  const barPx = zoomLevel * beatsPerMeasure;

  return (
    <div
      className={`audio-track-lane midi-track-lane ${track.muted ? 'lane-muted' : ''} ${
        playlistTool === 'paint' ? 'paint-cursor' : playlistTool === 'slice' ? 'slice-cursor' : ''
      }`}
      data-midi-track-id={track.id}
      style={{
        width: totalWidth,
        minWidth: totalWidth,
        backgroundSize: `${barPx}px 100%, ${zoomLevel}px 100%`,
        backgroundImage:
          'linear-gradient(to right, rgba(132, 112, 204, 0.2) 1px, transparent 1px), linear-gradient(to right, rgba(255, 255, 255, 0.035) 1px, transparent 1px)'
      }}
      onPointerDown={handleLanePointerDown}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Clips MIDI colocados en esta pista */}
      {clips.map((clip) => (
        <MidiClipComponent
          key={clip.id}
          clip={clip}
          zoomLevel={zoomLevel}
          isSelected={selectedMidiClipIds.includes(clip.id)}
          onSelect={(e) => selectMidiClip(clip.id, e.shiftKey || e.ctrlKey || e.metaKey)}
        />
      ))}

      {/* Previsualización en vivo durante pintado con pincel */}
      {paintGhosts.map((g, i) => (
        <div
          key={`paint_ghost_${i}`}
          className="midi-pattern-clip paint-ghost"
          style={{
            left: g.startBeat * zoomLevel,
            width: Math.max(14, g.durationBeats * zoomLevel),
            borderColor: activeBrushMeta.color
          }}
        >
          <div className="midi-clip-header" style={{ backgroundColor: `${activeBrushMeta.color}38` }}>
            <span className="midi-clip-title">{activeBrushMeta.label}</span>
          </div>
        </div>
      ))}

      {/* Previsualización al arrastrar patrón desde el Picker */}
      {dropGhost && (
        <div
          className="midi-pattern-clip paint-ghost"
          style={{
            left: dropGhost.startBeat * zoomLevel,
            width: Math.max(14, dropGhost.durationBeats * zoomLevel),
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
