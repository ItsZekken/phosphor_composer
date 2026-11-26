import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useSongStore } from '../../store/songStore';
import { toneEngine } from '../../audio/toneEngine';
import { createTempoMap } from '../../core/music';
import { normalizePatternChainToLinear } from '../../utils/typeDefinitions';

interface StructuralTick {
  pct: number;
  kind: 'chord' | 'tempo';
}

function formatClock(secondsTotal: number): string {
  const safe = Math.max(0, Math.floor(secondsTotal));
  const mins = Math.floor(safe / 60);
  const secs = safe % 60;
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

export const GlobalScrubber: React.FC = () => {
  const {
    isPlaying,
    bpm,
    tempoMarkers,
    timeSignature,
    chordBlocks,
    tracks,
    melodyNotes,
    patternChain,
    audioClips,
    midiClips,
    activeView
  } = useSongStore(
    useShallow((state) => ({
      isPlaying: state.isPlaying,
      bpm: state.bpm || 120,
      tempoMarkers: state.tempoMarkers || [],
      timeSignature: state.timeSignature || '4/4',
      chordBlocks: state.chordBlocks || [],
      tracks: state.tracks || [],
      melodyNotes: state.melodyNotes || [],
      patternChain: state.patternChain || [],
      audioClips: state.audioClips || [],
      midiClips: state.midiClips || [],
      activeView: state.activeView
    }))
  );

  const [isFullscreen, setIsFullscreen] = useState(false);
  const [stageHudVisible, setStageHudVisible] = useState(true);
  const [isHoveredOrDragging, setIsHoveredOrDragging] = useState(false);

  const trackRef = useRef<HTMLDivElement>(null);
  const fillRef = useRef<HTMLDivElement>(null);
  const thumbLayerRef = useRef<HTMLDivElement>(null);
  const hoverLineRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const tooltipBarRef = useRef<HTMLSpanElement>(null);
  const tooltipTimeRef = useRef<HTMLSpanElement>(null);
  const tooltipChordRef = useRef<HTMLSpanElement>(null);

  const isDraggingRef = useRef(false);
  const fineAnchorRef = useRef<{ clientX: number; beat: number } | null>(null);

  const beatsPerMeasure = timeSignature === '3/4' ? 3 : timeSignature === '6/8' ? 6 : 4;

  const tempoMap = useMemo(() => createTempoMap(bpm, tempoMarkers), [bpm, tempoMarkers]);

  const sortedChords = useMemo(
    () => [...chordBlocks].sort((a, b) => a.startBeat - b.startBeat),
    [chordBlocks]
  );

  const totalBeats = useMemo(() => {
    let maxBeat = 0;

    for (let i = 0; i < chordBlocks.length; i++) {
      const end = chordBlocks[i].startBeat + chordBlocks[i].durationBeats;
      if (end > maxBeat) maxBeat = end;
    }

    for (let i = 0; i < tracks.length; i++) {
      const notes = tracks[i].notes || [];
      for (let j = 0; j < notes.length; j++) {
        const end = notes[j].startBeat + notes[j].durationBeats;
        if (end > maxBeat) maxBeat = end;
      }
    }

    for (let i = 0; i < melodyNotes.length; i++) {
      const end = melodyNotes[i].startBeat + melodyNotes[i].durationBeats;
      if (end > maxBeat) maxBeat = end;
    }

    if (patternChain.length > 0) {
      const linear = normalizePatternChainToLinear(patternChain);
      for (let i = 0; i < linear.length; i++) {
        const end = (linear[i].startMeasure + linear[i].durationMeasures) * beatsPerMeasure;
        if (end > maxBeat) maxBeat = end;
      }
    }

    for (let i = 0; i < audioClips.length; i++) {
      const end = audioClips[i].startBeat + (audioClips[i].durationSeconds * bpm) / 60;
      if (end > maxBeat) maxBeat = end;
    }

    for (let i = 0; i < midiClips.length; i++) {
      const end = midiClips[i].startBeat + midiClips[i].durationBeats;
      if (end > maxBeat) maxBeat = end;
    }

    const engineMax = toneEngine.getMaxBeat();
    if (engineMax > maxBeat) maxBeat = engineMax;

    const minBeats = Math.max(16, beatsPerMeasure * 4);
    const padded = Math.max(minBeats, Math.ceil(maxBeat / beatsPerMeasure) * beatsPerMeasure);
    return padded;
  }, [chordBlocks, tracks, melodyNotes, patternChain, audioClips, midiClips, bpm, beatsPerMeasure]);

  const ticks = useMemo<StructuralTick[]>(() => {
    if (totalBeats <= 0) return [];
    const list: StructuralTick[] = [];

    // Marcas de tempo (submuestreadas para acelerandos extremos con cientos de marcadores)
    if (tempoMarkers.length > 0) {
      let lastTempoPct = -1;
      for (let i = 0; i < tempoMarkers.length; i++) {
        const b = tempoMarkers[i].beat;
        if (b <= 0 || b >= totalBeats) continue;
        const pct = (b / totalBeats) * 100;
        if (lastTempoPct >= 0 && pct - lastTempoPct < 0.9) continue;
        list.push({ pct, kind: 'tempo' });
        lastTempoPct = pct;
      }
    }

    // Marcas estructurales de acordes (submuestreadas para mantener DOM liviano)
    if (sortedChords.length > 0) {
      const step = Math.max(1, Math.ceil(sortedChords.length / 64));
      for (let i = 0; i < sortedChords.length; i += step) {
        const b = sortedChords[i].startBeat;
        if (b > 0 && b < totalBeats) {
          list.push({ pct: (b / totalBeats) * 100, kind: 'chord' });
        }
      }
    }

    return list;
  }, [sortedChords, tempoMarkers, totalBeats]);

  // Escuchar modo Zen / pantalla completa y visibilidad del HUD en Stage
  useEffect(() => {
    const onFullscreen = () => setIsFullscreen(Boolean(document.fullscreenElement));
    const onHudVis = (e: Event) => {
      const visible = (e as CustomEvent<{ visible?: boolean }>).detail?.visible;
      if (typeof visible === 'boolean') setStageHudVisible(visible);
    };
    document.addEventListener('fullscreenchange', onFullscreen);
    window.addEventListener('phosphor-stage-hud-visibility', onHudVis);
    return () => {
      document.removeEventListener('fullscreenchange', onFullscreen);
      window.removeEventListener('phosphor-stage-hud-visibility', onHudVis);
    };
  }, []);

  const applyVisualProgress = (beat: number) => {
    const ratio = totalBeats > 0 ? Math.max(0, Math.min(1, beat / totalBeats)) : 0;
    if (fillRef.current) {
      fillRef.current.style.transform = `scaleX(${ratio.toFixed(5)})`;
    }
    if (thumbLayerRef.current) {
      thumbLayerRef.current.style.transform = `translate3d(${(ratio * 100).toFixed(4)}%, 0, 0)`;
    }
  };

  // Bucle 60 FPS GPU-only durante reproducción + suscripción imperativa en reposo
  useEffect(() => {
    let rafId = 0;

    if (!isPlaying) {
      applyVisualProgress(useSongStore.getState().currentBeat || 0);
      const unsub = useSongStore.subscribe((state, prev) => {
        if (!state.isPlaying && state.currentBeat !== prev.currentBeat && !isDraggingRef.current) {
          applyVisualProgress(state.currentBeat || 0);
        }
      });
      return () => unsub();
    }

    const tick = () => {
      if (!isDraggingRef.current) {
        applyVisualProgress(toneEngine.getLiveBeat());
      }
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [isPlaying, totalBeats]);

  const findChordAtBeat = (beat: number): string | null => {
    let lo = 0;
    let hi = sortedChords.length - 1;
    let idx = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (sortedChords[mid].startBeat <= beat + 1e-4) {
        idx = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    if (idx < 0) return null;
    const block = sortedChords[idx];
    if (beat <= block.startBeat + block.durationBeats) {
      return block.chord;
    }
    return null;
  };

  const computeBeatFromClientX = (clientX: number, shiftKey: boolean): { beat: number; ratio: number } => {
    const el = trackRef.current;
    if (!el) return { beat: 0, ratio: 0 };
    const rect = el.getBoundingClientRect();
    const width = Math.max(1, rect.width);

    if (shiftKey && isDraggingRef.current && fineAnchorRef.current) {
      const deltaRatio = ((clientX - fineAnchorRef.current.clientX) / width) * 0.2;
      const beat = Math.max(0, Math.min(totalBeats, fineAnchorRef.current.beat + deltaRatio * totalBeats));
      return { beat, ratio: beat / totalBeats };
    }

    const rawRatio = Math.max(0, Math.min(1, (clientX - rect.left) / width));
    const beat = rawRatio * totalBeats;
    if (isDraggingRef.current) {
      fineAnchorRef.current = { clientX, beat };
    }
    return { beat, ratio: rawRatio };
  };

  const updateHoverOverlay = (beat: number, ratio: number) => {
    if (hoverLineRef.current) {
      hoverLineRef.current.style.transform = `translate3d(${(ratio * 100).toFixed(4)}%, 0, 0)`;
    }
    if (tooltipRef.current) {
      const clampedPct = Math.max(4, Math.min(96, ratio * 100));
      tooltipRef.current.style.left = `${clampedPct.toFixed(3)}%`;
    }
    if (tooltipBarRef.current) {
      const bar = Math.floor(beat / beatsPerMeasure) + 1;
      const beatInBar = Math.floor(beat % beatsPerMeasure) + 1;
      tooltipBarRef.current.textContent = `${bar}.${beatInBar}`;
    }
    if (tooltipTimeRef.current) {
      tooltipTimeRef.current.textContent = formatClock(tempoMap.beatToSeconds(beat));
    }
    if (tooltipChordRef.current) {
      const chord = findChordAtBeat(beat);
      tooltipChordRef.current.textContent = chord || '';
      tooltipChordRef.current.style.display = chord ? 'inline' : 'none';
    }
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    isDraggingRef.current = true;
    setIsHoveredOrDragging(true);

    const { beat, ratio } = computeBeatFromClientX(e.clientX, false);
    fineAnchorRef.current = { clientX: e.clientX, beat };
    applyVisualProgress(beat);
    updateHoverOverlay(beat, ratio);
    toneEngine.seekToBeat(beat);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const { beat, ratio } = computeBeatFromClientX(e.clientX, e.shiftKey);
    updateHoverOverlay(beat, ratio);

    if (isDraggingRef.current) {
      applyVisualProgress(beat);
      toneEngine.seekToBeat(beat);
    }
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDraggingRef.current) return;
    isDraggingRef.current = false;
    fineAnchorRef.current = null;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // ignore if already released
    }
  };

  const handleDoubleClick = () => {
    applyVisualProgress(0);
    toneEngine.seekToBeat(0);
  };

  const isZenOverlay = activeView === 'visualizer' && isFullscreen;
  const isIdleHidden = isZenOverlay && !stageHudVisible && !isHoveredOrDragging;

  return (
    <div
      ref={trackRef}
      className={`global-scrubber ${isHoveredOrDragging ? 'active' : ''} ${isZenOverlay ? 'zen-floating' : ''} ${isIdleHidden ? 'idle-hidden' : ''}`}
      role="slider"
      aria-label="Línea de tiempo global"
      aria-valuemin={0}
      aria-valuemax={Math.round(totalBeats)}
      tabIndex={0}
      onPointerEnter={() => setIsHoveredOrDragging(true)}
      onPointerLeave={() => {
        if (!isDraggingRef.current) setIsHoveredOrDragging(false);
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onDoubleClick={handleDoubleClick}
      onKeyDown={(e) => {
        const cur = isPlaying ? toneEngine.getLiveBeat() : useSongStore.getState().currentBeat || 0;
        const step = e.shiftKey ? 1 : beatsPerMeasure;
        if (e.key === 'ArrowRight') {
          e.preventDefault();
          const next = Math.min(totalBeats, cur + step);
          applyVisualProgress(next);
          toneEngine.seekToBeat(next);
        } else if (e.key === 'ArrowLeft') {
          e.preventDefault();
          const next = Math.max(0, cur - step);
          applyVisualProgress(next);
          toneEngine.seekToBeat(next);
        }
      }}
    >
      {/* Tooltip flotante con compás, tiempo y acorde (actualizado por DOM refs) */}
      <div ref={tooltipRef} className="global-scrubber-tooltip" aria-hidden="true">
        <span ref={tooltipBarRef} className="scrubber-tip-bar">1.1</span>
        <span className="scrubber-tip-sep">·</span>
        <span ref={tooltipTimeRef} className="scrubber-tip-time">00:00</span>
        <span ref={tooltipChordRef} className="scrubber-tip-chord" style={{ display: 'none' }} />
      </div>

      {/* Carril físico minimalista */}
      <div className="global-scrubber-rail">
        {/* Marcas estructurales de acordes y tempo */}
        <div className="global-scrubber-ticks" aria-hidden="true">
          {ticks.map((t, idx) => (
            <span
              key={idx}
              className={`global-scrubber-tick tick-${t.kind}`}
              style={{ left: `${t.pct.toFixed(3)}%` }}
            />
          ))}
        </div>

        {/* Relleno de progreso GPU */}
        <div ref={fillRef} className="global-scrubber-fill" />

        {/* Guía fantasma del cursor al hacer hover */}
        <div ref={hoverLineRef} className="global-scrubber-hover-layer">
          <div className="global-scrubber-hover-pip" />
        </div>

        {/* Cabezal luminoso GPU */}
        <div ref={thumbLayerRef} className="global-scrubber-thumb-layer">
          <div className="global-scrubber-thumb" />
        </div>
      </div>
    </div>
  );
};
