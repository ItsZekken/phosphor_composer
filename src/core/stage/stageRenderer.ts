/**
 * stageRenderer.ts
 * Motor de renderizado visual unificado para el Stage de Phosphor Composer.
 * 
 * ÚNICA FUENTE DE VERDAD para el renderizado del Stage:
 * Compartido al 100% entre la vista en pantalla (StageCanvas.tsx @ 60 FPS)
 * y el exportador de video (stageVideoExporter.ts).
 */

import type { StageRenderNote } from '../../components/visualizer/hooks/useStageTimelineNotes';
import type { DrumChannel, PatternChainItem, ChordBlock } from '../../utils/typeDefinitions';
import { flattenPatternChain } from '../../utils/typeDefinitions';

export interface StageParticle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  color: string;
  alpha: number;
  size: number;
  decay: number;
}

export interface KeyLuminanceEntry {
  color: string;
  alpha: number;
}

export interface StageRenderFrameParams {
  beat: number;
  t?: number;
  totalDurationSeconds?: number;
  totalBeats?: number;
  waveform: Float32Array;
  notes: StageRenderNote[];
  drumChannels: DrumChannel[];
  patternChain: PatternChainItem[];
  isPatternRepeatOn: boolean;
  currentDrumPatternEdit: number;
  chordBlocks: ChordBlock[];
  visualizerMode: 'oscilloscope' | 'spectrum' | 'lissajous';
  isCrtEnabled: boolean;
  isPlaying?: boolean;
  particles: StageParticle[];
  keyLuminanceMap: Map<number, KeyLuminanceEntry>;
  bgCanvas: HTMLCanvasElement | OffscreenCanvas;
  bgCtx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
  isFirstFrame?: boolean;
}

const DRUM_ROW_COLORS = [
  '#d49d50', // Warm Amber (Kick)
  '#c75c79', // Rose Ruby (Snare)
  '#4eb0a2', // Soft Cyan-Teal (HiHat C)
  '#558c6b', // Sage Moss (HiHat O)
  '#9377b5', // Radiant Lavender (Clap)
  '#6890c4'  // Periwinkle Sky (Perc)
];

const MIN_MIDI = 24;  // C1
const MAX_MIDI = 108; // C8
const TOTAL_PITCHES = MAX_MIDI - MIN_MIDI + 1; // 85 pitches

/**
 * Función central de dibujo: ejecuta la composición gráfica completa del Stage.
 */
export function renderStageFrame(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  width: number,
  height: number,
  params: StageRenderFrameParams
) {
  const {
    beat,
    waveform,
    notes,
    drumChannels,
    patternChain,
    isPatternRepeatOn,
    currentDrumPatternEdit,
    chordBlocks,
    visualizerMode,
    isCrtEnabled,
    isPlaying = true,
    particles,
    keyLuminanceMap,
    bgCanvas,
    bgCtx,
    isFirstFrame
  } = params;

  // 1. CAPA 0: Renderizado del fondo y osciloscopio con persistencia analógica de fósforo
  renderBackgroundVisualizer(bgCtx, width, height, waveform, visualizerMode, Boolean(isFirstFrame));

  // Volcar fondo con estela al lienzo principal
  ctx.drawImage(bgCanvas, 0, 0);

  // 2. CAPA 1: Matriz de Luces de Percusión (1:1 con espaciado de compás y destello)
  renderDrumSwitchesDeck(
    ctx,
    width,
    drumChannels,
    patternChain,
    isPatternRepeatOn,
    currentDrumPatternEdit,
    beat,
    isPlaying
  );

  // 3. CAPA 2: Cascada MIDI + Mini Teclado en la base con luminancia reactiva
  renderMidiWaterfallAndKeyboard(ctx, width, height, notes, beat, isPlaying, particles, keyLuminanceMap);

  // 4. CAPA 3: Cinta de Progresión Armónica Flotante (con scroll y aguja láser)
  renderFloatingChordStream(ctx, width, height, chordBlocks, beat);

  // 5. CAPA 4: Filtro CRT Analógico opcional
  if (isCrtEnabled) {
    renderCRTOverlay(ctx, width, height);
  }
}

/**
 * Capa 0: Fondo orgánico con estela analógica de fósforo
 */
function renderBackgroundVisualizer(
  bgCtx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  width: number,
  height: number,
  waveform: Float32Array,
  mode: 'oscilloscope' | 'spectrum' | 'lissajous',
  isFirstFrame: boolean
) {
  if (isFirstFrame) {
    bgCtx.fillStyle = '#120f18';
    bgCtx.fillRect(0, 0, width, height);
  }

  // Estela de persistencia de fósforo: difuminar gradualmente el fotograma anterior
  bgCtx.fillStyle = mode === 'oscilloscope' ? 'rgba(18, 15, 24, 0.32)' : '#120f18';
  bgCtx.fillRect(0, 0, width, height);

  const centerY = height * 0.48;

  if (mode === 'oscilloscope') {
    bgCtx.beginPath();
    const sliceWidth = width / waveform.length;
    let x = 0;

    for (let i = 0; i < waveform.length; i++) {
      const v = waveform[i];
      const y = centerY + v * (height * 0.35);
      if (i === 0) {
        bgCtx.moveTo(x, y);
      } else {
        bgCtx.lineTo(x, y);
      }
      x += sliceWidth;
    }

    // 1. Halo ambiental difuso (verde fósforo)
    bgCtx.lineWidth = 4.0;
    bgCtx.strokeStyle = 'rgba(77, 130, 102, 0.35)';
    bgCtx.stroke();

    // 2. Haz intermedio fósforo
    bgCtx.lineWidth = 2.0;
    bgCtx.strokeStyle = 'rgba(90, 158, 122, 0.7)';
    bgCtx.stroke();

    // 3. Haz central fino brillante
    bgCtx.lineWidth = 0.9;
    bgCtx.strokeStyle = '#d5f5e4';
    bgCtx.stroke();
  } else if (mode === 'spectrum') {
    const numBars = Math.min(48, waveform.length);
    const padding = 3;
    const barWidth = (width / numBars) - padding;

    const gradient = bgCtx.createLinearGradient(0, height, 0, height * 0.2);
    gradient.addColorStop(0, 'rgba(80, 114, 168, 0.15)');
    gradient.addColorStop(0.5, 'rgba(90, 158, 122, 0.35)');
    gradient.addColorStop(0.85, 'rgba(176, 144, 64, 0.45)');
    gradient.addColorStop(1, 'rgba(232, 140, 66, 0.6)');

    for (let i = 0; i < numBars; i++) {
      const sampleIdx = Math.floor((i / numBars) * (waveform.length - 1));
      const val = Math.abs(waveform[sampleIdx]) * 1.6;
      const barHeight = Math.min(height * 0.6, val * (height * 0.55));
      const x = i * (barWidth + padding);
      const y = height - barHeight;

      bgCtx.fillStyle = gradient;
      bgCtx.fillRect(x, y, barWidth, barHeight);
    }
  } else {
    // Lissajous
    const centerX = width / 2;
    const centerY = height * 0.46;
    const radius = Math.min(width, height) * 0.32;

    bgCtx.beginPath();
    const len = waveform.length;
    for (let i = 0; i < len; i++) {
      const angle = (i / len) * Math.PI * 2;
      const waveOffset = waveform[i] * (radius * 0.45);
      const r = radius + waveOffset;

      const px = centerX + Math.cos(angle) * r;
      const py = centerY + Math.sin(angle) * r;

      if (i === 0) bgCtx.moveTo(px, py);
      else bgCtx.lineTo(px, py);
    }
    bgCtx.closePath();

    bgCtx.strokeStyle = 'rgba(104, 128, 173, 0.35)';
    bgCtx.lineWidth = 3.5;
    bgCtx.stroke();

    bgCtx.strokeStyle = '#c4b5fd';
    bgCtx.lineWidth = 1.2;
    bgCtx.stroke();
  }
}

/**
 * Capa 1: Deck de Luces de Percusión
 */
function renderDrumSwitchesDeck(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  width: number,
  drumChannels: DrumChannel[],
  patternChain: PatternChainItem[],
  isPatternRepeatOn: boolean,
  currentDrumPatternEdit: number,
  beat: number,
  isPlaying: boolean
) {
  if (!drumChannels || drumChannels.length === 0) return;

  let activePatternIdx = currentDrumPatternEdit;
  const globalStepIndex = Math.floor(beat * 4);
  let localStep = globalStepIndex % 16;

  if (!isPatternRepeatOn && patternChain && patternChain.length > 0) {
    const flatChain = flattenPatternChain(patternChain);
    const totalChainSteps = flatChain.length * 16;
    if (totalChainSteps > 0) {
      const wrappedStep = globalStepIndex % totalChainSteps;
      const flatIdx = Math.floor(wrappedStep / 16);
      const step = flatChain[flatIdx];
      if (step) {
        activePatternIdx = step.patternIndex;
        localStep = wrappedStep % 16;
      }
    }
  }

  const isSilencedPattern = activePatternIdx === -1;
  const activeChannels = drumChannels.slice(0, 6);

  const deckMaxWidth = Math.min(1050, width * 0.78);
  const rowHeight = 30;
  const gapY = 5;
  const baseGapX = 5;
  const quarterGap = 10;
  const totalQuarterExtra = 3 * quarterGap;
  const pillWidth = Math.min(20, (deckMaxWidth - (15 * baseGapX) - totalQuarterExtra) / 16);
  const totalDeckWidth = 16 * pillWidth + 15 * baseGapX + totalQuarterExtra;
  const startX = (width - totalDeckWidth) / 2;
  const startY = 56;

  ctx.save();

  for (let r = 0; r < activeChannels.length; r++) {
    const channel = activeChannels[r];
    const lightColor = DRUM_ROW_COLORS[r % DRUM_ROW_COLORS.length];
    const rowY = startY + r * (rowHeight + gapY);

    const patterns = channel.patterns || [];
    const patternSteps = !isSilencedPattern && patterns[activePatternIdx] ? patterns[activePatternIdx] : [];

    let currentX = startX;

    for (let s = 0; s < 16; s++) {
      if (s > 0) {
        currentX += baseGapX;
        if (s % 4 === 0) {
          currentX += quarterGap;
        }
      }

      const step = patternSteps[s];
      const isActive = Boolean(step?.isActive);
      const isTriggered = isPlaying && isActive && localStep === s;

      if (isTriggered) {
        const scaledH = rowHeight * 1.22;
        const offsetY = (scaledH - rowHeight) / 2;
        ctx.save();
        ctx.shadowColor = lightColor;
        ctx.shadowBlur = 24;
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.roundRect(currentX, rowY - offsetY, pillWidth, scaledH, 3);
        ctx.fill();
        ctx.restore();
      } else if (isActive) {
        ctx.save();
        ctx.shadowColor = lightColor;
        ctx.shadowBlur = 10;
        ctx.fillStyle = lightColor;
        ctx.beginPath();
        ctx.roundRect(currentX, rowY, pillWidth, rowHeight, 3);
        ctx.fill();
        ctx.restore();
      } else {
        ctx.fillStyle = 'rgba(255, 255, 255, 0.025)';
        ctx.beginPath();
        ctx.roundRect(currentX, rowY, pillWidth, rowHeight, 3);
        ctx.fill();
      }

      currentX += pillWidth;
    }
  }

  // Fila inferior de cursor de pasos
  const cursorRowY = startY + activeChannels.length * (rowHeight + gapY) + 4;
  let cursorX = startX;

  for (let s = 0; s < 16; s++) {
    if (s > 0) {
      cursorX += baseGapX;
      if (s % 4 === 0) cursorX += quarterGap;
    }

    if (isPlaying && localStep === s) {
      ctx.save();
      ctx.shadowColor = '#ffffff';
      ctx.shadowBlur = 8;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(cursorX + pillWidth * 0.2, cursorRowY, pillWidth * 0.6, 2);
      ctx.restore();
    }

    cursorX += pillWidth;
  }

  ctx.restore();
}

/**
 * Capa 2: Cascada MIDI + Mini Teclado en la base
 */
function renderMidiWaterfallAndKeyboard(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  width: number,
  height: number,
  notes: StageRenderNote[],
  beat: number,
  isPlaying: boolean,
  particles: StageParticle[],
  keyLuminanceMap: Map<number, KeyLuminanceEntry>
) {
  const kbHeight = 22;
  const impactY = height - kbHeight;
  const lookAheadBeats = 7;
  const lookBehindBeats = 1.2;
  const noteSpeed = (impactY - 40) / lookAheadBeats;
  const keyWidth = width / TOTAL_PITCHES;

  ctx.save();

  // 1. Líneas verticales sutiles de referencia de pitch
  ctx.lineWidth = 1;
  for (let m = MIN_MIDI; m <= MAX_MIDI; m++) {
    const isOctaveC = m % 12 === 0;
    ctx.strokeStyle = isOctaveC ? 'rgba(130, 165, 245, 0.07)' : 'rgba(255, 255, 255, 0.015)';
    const x = (m - MIN_MIDI) * keyWidth;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, impactY);
    ctx.stroke();
  }

  // 2. Horizonte de impacto sutil
  ctx.strokeStyle = 'rgba(130, 165, 245, 0.25)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, impactY);
  ctx.lineTo(width, impactY);
  ctx.stroke();

  // 3. Renderizar notas visibles
  const visibleMinBeat = beat - lookBehindBeats;
  const visibleMaxBeat = beat + lookAheadBeats;
  const activeStrikes: { x: number; color: string; width: number }[] = [];
  const activeFrameMidi = new Set<number>();

  for (let i = 0; i < notes.length; i++) {
    const note = notes[i];
    const noteEndBeat = note.startBeat + note.durationBeats;
    if (noteEndBeat < visibleMinBeat || note.startBeat > visibleMaxBeat) continue;

    const clampedMidi = Math.max(MIN_MIDI, Math.min(MAX_MIDI, note.midi));
    const noteX = (clampedMidi - MIN_MIDI) * keyWidth + 0.5;
    const noteW = Math.max(3, keyWidth - 1);

    const beatsFromImpactHead = note.startBeat - beat;
    const beatsFromImpactTail = noteEndBeat - beat;

    const bottomY = impactY - beatsFromImpactHead * noteSpeed;
    const topY = impactY - beatsFromImpactTail * noteSpeed;
    const noteH = Math.max(5, bottomY - topY);

    const isActive = beat >= note.startBeat && beat <= noteEndBeat;
    const baseColor = note.color || '#6880ad';

    // A. Cuerpo de la nota
    ctx.fillStyle = baseColor;
    ctx.beginPath();
    ctx.roundRect(noteX, topY, noteW, noteH, 2.5);
    ctx.fill();

    // B. Estela de desvanecimiento suave (afterglow)
    if (isPlaying && beat > noteEndBeat && (beat - noteEndBeat) < 0.55) {
      const trailProgress = (beat - noteEndBeat) / 0.55;
      const trailAlpha = Math.max(0, (1 - trailProgress) ** 2);
      ctx.save();
      ctx.globalAlpha = trailAlpha * 0.7;
      ctx.fillStyle = baseColor;
      const trailH = Math.max(2, (0.55 - (beat - noteEndBeat)) * noteSpeed * 0.4);
      ctx.fillRect(noteX, impactY - trailH, noteW, trailH);
      ctx.restore();
    }

    // C. Nota activa en el impacto
    if (isActive && isPlaying) {
      activeFrameMidi.add(clampedMidi);
      keyLuminanceMap.set(clampedMidi, { color: baseColor, alpha: 1.0 });
      activeStrikes.push({ x: noteX + noteW / 2, color: baseColor, width: noteW });

      if (Math.random() < 0.25) {
        particles.push({
          x: noteX + noteW / 2 + (Math.random() - 0.5) * noteW,
          y: impactY,
          vx: (Math.random() - 0.5) * 3,
          vy: -Math.random() * 3 - 1,
          color: baseColor,
          alpha: 0.85,
          size: Math.random() * 2 + 1,
          decay: 0.035 + Math.random() * 0.02
        });
      }
    }
  }

  // 4. Destellos en el horizonte de impacto
  for (const strike of activeStrikes) {
    const grad = ctx.createRadialGradient(
      strike.x, impactY, 0,
      strike.x, impactY, strike.width * 2.5
    );
    grad.addColorStop(0, strike.color);
    grad.addColorStop(1, 'transparent');

    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(strike.x, impactY, strike.width * 2.5, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(strike.x - strike.width / 2, impactY - 1, strike.width, 2);
  }

  // 5. Partículas
  for (let p = particles.length - 1; p >= 0; p--) {
    const pt = particles[p];
    pt.x += pt.vx;
    pt.y += pt.vy;
    pt.alpha -= pt.decay;

    if (pt.alpha <= 0) {
      particles.splice(p, 1);
      continue;
    }

    ctx.save();
    ctx.globalAlpha = pt.alpha;
    ctx.fillStyle = pt.color;
    ctx.beginPath();
    ctx.arc(pt.x, pt.y, pt.size, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // 6. Decaimiento de luminancia de teclas
  keyLuminanceMap.forEach((item, midi) => {
    if (!activeFrameMidi.has(midi)) {
      item.alpha -= 0.045;
      if (item.alpha <= 0.01) {
        keyLuminanceMap.delete(midi);
      }
    }
  });

  // 7. Mini Teclado Inferior en la Base
  const kbY = height - kbHeight;
  ctx.fillStyle = 'rgba(15, 12, 20, 0.75)';
  ctx.fillRect(0, kbY, width, kbHeight);

  for (let m = MIN_MIDI; m <= MAX_MIDI; m++) {
    const isBlack = [1, 3, 6, 8, 10].includes(m % 12);
    const x = (m - MIN_MIDI) * keyWidth;
    const activeEntry = keyLuminanceMap.get(m);

    if (activeEntry && activeEntry.alpha > 0.01) {
      ctx.save();
      ctx.globalAlpha = activeEntry.alpha;
      ctx.fillStyle = activeEntry.color;
      ctx.fillRect(x + 0.5, kbY, keyWidth - 1, kbHeight);
      ctx.restore();
    } else {
      ctx.fillStyle = isBlack ? 'rgba(24, 19, 32, 0.8)' : 'rgba(42, 34, 56, 0.6)';
      ctx.fillRect(x + 0.5, kbY, keyWidth - 1, kbHeight);
    }
  }

  ctx.restore();
}

/**
 * Capa 3: Cinta de Progresión Armónica Flotante
 */
function renderFloatingChordStream(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  width: number,
  height: number,
  chordBlocks: ChordBlock[],
  beat: number
) {
  if (!chordBlocks || chordBlocks.length === 0) return;

  const kbHeight = 22;
  const ribbonHeight = 32;
  const ribbonY = height - kbHeight - 24 - ribbonHeight;
  const ribbonMarginX = 12;
  const ribbonWidth = width - ribbonMarginX * 2;
  const ribbonX = ribbonMarginX;

  ctx.save();

  // Contenedor de la cinta
  ctx.save();
  ctx.shadowColor = 'rgba(0, 0, 0, 0.5)';
  ctx.shadowBlur = 18;
  ctx.fillStyle = 'rgba(16, 12, 22, 0.92)';
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(ribbonX, ribbonY, ribbonWidth, ribbonHeight, 16);
  ctx.fill();
  ctx.stroke();
  ctx.restore();

  // Scroll horizontal adaptativo centrado en el 35%
  const beatWidth = 40;
  const songStartBeat = chordBlocks[0]?.startBeat ?? 0;
  const lastBlock = chordBlocks[chordBlocks.length - 1];
  const songTotalBeats = lastBlock ? (lastBlock.startBeat + lastBlock.durationBeats) - songStartBeat : 16;
  const totalTrackWidth = songTotalBeats * beatWidth;

  const playheadRelX = (beat - songStartBeat) * beatWidth;
  let scrollX = 0;
  if (totalTrackWidth > ribbonWidth) {
    const focalOffset = ribbonWidth * 0.35;
    const maxScroll = totalTrackWidth - ribbonWidth;
    scrollX = Math.max(0, Math.min(maxScroll, playheadRelX - focalOffset));
  }

  const visiblePlayheadX = ribbonX + playheadRelX - scrollX;

  // Clip dentro de la cinta
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(ribbonX, ribbonY, ribbonWidth, ribbonHeight, 16);
  ctx.clip();

  const pillY = ribbonY + 2.5;
  const pillH = ribbonHeight - 5;

  for (const block of chordBlocks) {
    const blockRelStart = (block.startBeat - songStartBeat) * beatWidth;
    const blockX = ribbonX + blockRelStart - scrollX;
    const blockW = Math.max(16, block.durationBeats * beatWidth);

    if (blockX + blockW < ribbonX || blockX > ribbonX + ribbonWidth) continue;

    const isActive = beat >= block.startBeat && beat < block.startBeat + block.durationBeats;
    const isPassed = beat >= block.startBeat + block.durationBeats;

    if (isActive) {
      ctx.fillStyle = 'rgba(68, 100, 84, 0.2)';
      ctx.strokeStyle = 'rgba(110, 165, 135, 0.9)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.roundRect(blockX, pillY, blockW, pillH, 4);
      ctx.fill();
      ctx.stroke();

      const progress = Math.min(1, Math.max(0, (beat - block.startBeat) / block.durationBeats));
      const fillW = blockW * progress;
      ctx.fillStyle = 'rgba(68, 100, 84, 0.42)';
      ctx.beginPath();
      ctx.roundRect(blockX, pillY, fillW, pillH, 4);
      ctx.fill();

      ctx.strokeStyle = 'rgba(110, 165, 135, 0.9)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(blockX + fillW, pillY);
      ctx.lineTo(blockX + fillW, pillY + pillH);
      ctx.stroke();
    } else if (isPassed) {
      ctx.fillStyle = 'rgba(30, 24, 40, 0.3)';
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.06)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.roundRect(blockX, pillY, blockW, pillH, 4);
      ctx.fill();
      ctx.stroke();
    } else {
      ctx.fillStyle = 'rgba(255, 255, 255, 0.03)';
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.roundRect(blockX, pillY, blockW, pillH, 4);
      ctx.fill();
      ctx.stroke();
    }

    const chordLabel = block.type === 'silence' ? '🔇' : block.chord || 'C';
    ctx.font = 'bold 12px "Share Tech Mono", monospace';
    ctx.fillStyle = isActive ? '#ffffff' : isPassed ? '#a395b8' : '#c2b5d4';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(chordLabel, blockX + blockW / 2, pillY + pillH / 2);
  }

  // Aguja láser del playhead
  if (visiblePlayheadX >= ribbonX && visiblePlayheadX <= ribbonX + ribbonWidth) {
    ctx.strokeStyle = 'rgba(110, 165, 135, 0.9)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(visiblePlayheadX, ribbonY);
    ctx.lineTo(visiblePlayheadX, ribbonY + ribbonHeight);
    ctx.stroke();
  }

  ctx.restore();
  ctx.restore();
}

/**
 * Capa 4: Filtro CRT
 */
function renderCRTOverlay(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  width: number,
  height: number
) {
  ctx.save();

  ctx.fillStyle = 'rgba(0, 0, 0, 0.16)';
  for (let y = 0; y < height; y += 4) {
    ctx.fillRect(0, y, width, 1.5);
  }

  const grad = ctx.createRadialGradient(
    width / 2,
    height / 2,
    width * 0.40,
    width / 2,
    height / 2,
    width * 0.72
  );
  grad.addColorStop(0, 'rgba(0, 0, 0, 0)');
  grad.addColorStop(1, 'rgba(0, 0, 0, 0.60)');

  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, width, height);

  ctx.restore();
}
