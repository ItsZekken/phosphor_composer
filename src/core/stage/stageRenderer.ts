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
  frequency?: Float32Array;
  notes: StageRenderNote[];
  drumChannels: DrumChannel[];
  patternChain: PatternChainItem[];
  isPatternRepeatOn: boolean;
  currentDrumPatternEdit: number;
  patternLengths?: number[];
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
const BLACK_KEY_TABLE = new Uint8Array([0, 1, 0, 1, 0, 0, 1, 0, 1, 0, 1, 0]);
const MAX_STAGE_PARTICLES = 80;

// Caches de alto rendimiento para 60 FPS sin asignación por frame
const hexRgbCache = new Map<string, [number, number, number]>();
const patternChainCache = new WeakMap<PatternChainItem[], ReturnType<typeof flattenPatternChain>>();
const sortedNotesCache = new WeakMap<StageRenderNote[], { sorted: StageRenderNote[]; maxDur: number }>();
const sortedChordsCache = new WeakMap<ChordBlock[], { sorted: ChordBlock[]; maxDur: number; firstStart: number; maxEnd: number }>();

const spectrumGradCache = new WeakMap<
  CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  { height: number; gradient: CanvasGradient }
>();

let crtCacheCanvas: HTMLCanvasElement | OffscreenCanvas | null = null;
let crtCacheW = 0;
let crtCacheH = 0;

// Pools reutilizables por frame
const activeStrikesPool: Array<{ x: number; color: string; width: number }> = [];
const activeFrameMidiPool = new Set<number>();

function getFlattenedPatternChainCached(patternChain: PatternChainItem[]): ReturnType<typeof flattenPatternChain> {
  let cached = patternChainCache.get(patternChain);
  if (!cached) {
    cached = flattenPatternChain(patternChain);
    patternChainCache.set(patternChain, cached);
  }
  return cached;
}

function getSortedNotesCached(notes: StageRenderNote[]): { sorted: StageRenderNote[]; maxDur: number } {
  let cached = sortedNotesCache.get(notes);
  if (!cached) {
    let maxDur = 0.25;
    for (let i = 0; i < notes.length; i++) {
      if (notes[i].durationBeats > maxDur) maxDur = notes[i].durationBeats;
    }
    const sorted = notes.slice().sort((a, b) => a.startBeat - b.startBeat);
    cached = { sorted, maxDur };
    sortedNotesCache.set(notes, cached);
  }
  return cached;
}

function getSortedChordsCached(
  chordBlocks: ChordBlock[]
): { sorted: ChordBlock[]; maxDur: number; firstStart: number; maxEnd: number } {
  let cached = sortedChordsCache.get(chordBlocks);
  if (!cached) {
    const sorted = chordBlocks.slice().sort((a, b) => a.startBeat - b.startBeat);
    let maxDur = 4;
    let maxEnd = 16;
    for (let i = 0; i < sorted.length; i++) {
      const b = sorted[i];
      if (b.durationBeats > maxDur) maxDur = b.durationBeats;
      const end = b.startBeat + b.durationBeats;
      if (end > maxEnd) maxEnd = end;
    }
    const firstStart = sorted[0]?.startBeat ?? 0;
    cached = { sorted, maxDur, firstStart, maxEnd };
    sortedChordsCache.set(chordBlocks, cached);
  }
  return cached;
}

function lowerBoundByBeat<T extends { startBeat: number }>(arr: T[], targetBeat: number): number {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (arr[mid].startBeat < targetBeat) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

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

  // 1. CAPA 0: Renderizado del fondo y osciloscopio con persistencia analógica de fósforo (Al fondo)
  renderBackgroundVisualizer(bgCtx, width, height, waveform, params.frequency, visualizerMode, Boolean(isFirstFrame));

  // Volcar fondo con estela al lienzo principal
  ctx.drawImage(bgCanvas, 0, 0);

  // 2. CAPA 1: Cascada MIDI + Mini Teclado en la base (por debajo del drum pattern)
  renderMidiWaterfallAndKeyboard(ctx, width, height, notes, beat, isPlaying, particles, keyLuminanceMap);

  // 3. CAPA 2: Matriz de Luces de Percusión (POR ENCIMA de las notas del piano)
  renderDrumSwitchesDeck(
    ctx,
    width,
    drumChannels,
    patternChain,
    isPatternRepeatOn,
    currentDrumPatternEdit,
    beat,
    isPlaying,
    params.patternLengths
  );

  // 4. CAPA 3: Cinta de Progresión Armónica Flotante (en la parte superior del Stage)
  renderFloatingChordStream(ctx, width, height, chordBlocks, beat);

  // 5. CAPA 4: Filtro CRT Analógico opcional
  if (isCrtEnabled) {
    renderCRTOverlay(ctx, width, height);
  }
}

const SPECTRUM_BINS = 48;
const fallbackSpectrumBins = new Float32Array(SPECTRUM_BINS);

/**
 * Calcula un espectro de magnitudes logarítmico (60 Hz - 12 kHz) a partir de una ventana de waveform.
 * Utilizado en renderizado offline (exportación MP4) o cuando no hay datos FFT de Web Audio.
 */
function computeSpectrumFromWaveform(waveform: Float32Array, numBins = SPECTRUM_BINS): Float32Array {
  const n = waveform.length;
  if (n === 0) {
    fallbackSpectrumBins.fill(0);
    return fallbackSpectrumBins;
  }

  const sampleRate = 44100;
  const minFreq = 60;
  const maxFreq = 12000;
  const ratio = maxFreq / minFreq;

  for (let b = 0; b < numBins; b++) {
    const freq = minFreq * Math.pow(ratio, b / Math.max(1, numBins - 1));
    const omega = (2 * Math.PI * freq) / sampleRate;
    let re = 0;
    let im = 0;

    for (let i = 0; i < n; i++) {
      // Ventana Hann para reducir fuga espectral
      const hann = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (n - 1)));
      const sample = waveform[i] * hann;
      const angle = omega * i;
      re += sample * Math.cos(angle);
      im -= sample * Math.sin(angle);
    }

    const mag = Math.sqrt(re * re + im * im) / (n * 0.25);
    fallbackSpectrumBins[b] = Math.min(1, Math.tanh(mag * 1.4));
  }

  return fallbackSpectrumBins;
}

/**
 * Capa 0: Fondo orgánico con estela analógica de fósforo
 */
function renderBackgroundVisualizer(
  bgCtx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  width: number,
  height: number,
  waveform: Float32Array,
  frequency: Float32Array | undefined,
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
      // Escala balanceada con saturación suave analógica
      const y = centerY + Math.tanh(v * 0.9) * (height * 0.15);
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
    const numBars = SPECTRUM_BINS;
    const padding = 3;
    const barWidth = (width / numBars) - padding;

    let cachedSpec = spectrumGradCache.get(bgCtx);
    if (!cachedSpec || cachedSpec.height !== height) {
      const gradient = bgCtx.createLinearGradient(0, height, 0, height * 0.4);
      gradient.addColorStop(0, 'rgba(80, 114, 168, 0.15)');
      gradient.addColorStop(0.5, 'rgba(90, 158, 122, 0.35)');
      gradient.addColorStop(0.85, 'rgba(176, 144, 64, 0.45)');
      gradient.addColorStop(1, 'rgba(232, 140, 66, 0.6)');
      cachedSpec = { height, gradient };
      spectrumGradCache.set(bgCtx, cachedSpec);
    }
    const gradient = cachedSpec.gradient;

    // Determinar si el buffer FFT real de Web Audio contiene mediciones válidas en dB (< 0)
    let hasLiveFft = false;
    if (frequency && frequency.length > 0) {
      for (let k = 0; k < frequency.length; k++) {
        if (frequency[k] < -0.001) {
          hasLiveFft = true;
          break;
        }
      }
    }

    const computedBins = hasLiveFft ? null : computeSpectrumFromWaveform(waveform, numBars);

    for (let i = 0; i < numBars; i++) {
      let norm = 0;
      if (hasLiveFft && frequency) {
        // Mapeo logarítmico sobre los bins FFT (descartando DC bin 0 para mejor respuesta visual)
        const maxBin = Math.max(1, frequency.length - 1);
        const logPos = Math.pow(i / Math.max(1, numBars - 1), 1.45);
        const binPos = 1 + logPos * (maxBin - 1);
        const b0 = Math.min(maxBin, Math.floor(binPos));
        const b1 = Math.min(maxBin, b0 + 1);
        const frac = binPos - b0;
        const db0 = Number.isFinite(frequency[b0]) ? frequency[b0] : -100;
        const db1 = Number.isFinite(frequency[b1]) ? frequency[b1] : -100;
        const db = db0 + (db1 - db0) * frac;
        norm = Math.max(0, Math.min(1, (db + 85) / 70));
      } else if (computedBins) {
        norm = computedBins[i] || 0;
      }

      const barHeight = Math.min(height * 0.36, norm * (height * 0.32));
      const x = i * (barWidth + padding);
      const y = height - barHeight;

      bgCtx.fillStyle = gradient;
      bgCtx.fillRect(x, y, barWidth, barHeight);
    }
  } else {
    // Lissajous / Phase Scope
    const centerX = width / 2;
    const centerY = height * 0.46;
    const radius = Math.min(width, height) * 0.24;

    bgCtx.beginPath();
    const len = waveform.length;
    for (let i = 0; i < len; i++) {
      const angle = (i / len) * Math.PI * 2;
      const waveOffset = Math.tanh(waveform[i] * 0.9) * (radius * 0.2);
      const r = Math.max(8, radius + waveOffset);

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
  isPlaying: boolean,
  patternLengths?: number[]
) {
  if (!drumChannels || drumChannels.length === 0) return;

  let activePatternIdx = currentDrumPatternEdit;
  let beatInMeasure = ((beat % 4) + 4) % 4;

  if (!isPatternRepeatOn && patternChain && patternChain.length > 0) {
    const flatChain = getFlattenedPatternChainCached(patternChain);
    const totalChainBeats = flatChain.length * 4;
    if (totalChainBeats > 0) {
      const chainPos = ((beat % totalChainBeats) + totalChainBeats) % totalChainBeats;
      const flatIdx = Math.floor(chainPos / 4);
      const step = flatChain[flatIdx];
      if (step) {
        activePatternIdx = step.patternIndex;
        beatInMeasure = chainPos % 4;
      }
    }
  }

  const isSilencedPattern = activePatternIdx === -1;
  const activeChannels = drumChannels.slice(0, 6);
  const patternLen = !isSilencedPattern ? (patternLengths?.[activePatternIdx] || 16) : 16;
  const wrappedStep = (beatInMeasure / 4) * patternLen;

  const deckMaxWidth = Math.min(1050, width * 0.78);
  const rowHeight = 30;
  const gapY = 5;
  const baseGapX = 5;
  const hasQuarters = patternLen % 4 === 0 && patternLen >= 8;
  const quarterGap = hasQuarters ? 10 : 0;
  const totalQuarterExtra = hasQuarters ? 3 * quarterGap : 0;
  const pillWidth = Math.min(20, (deckMaxWidth - ((patternLen - 1) * baseGapX) - totalQuarterExtra) / patternLen);
  const totalDeckWidth = patternLen * pillWidth + (patternLen - 1) * baseGapX + totalQuarterExtra;
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

    for (let s = 0; s < patternLen; s++) {
      if (s > 0) {
        currentX += baseGapX;
        if (hasQuarters && s % (patternLen / 4) === 0) {
          currentX += quarterGap;
        }
      }

      const step = patternSteps[s];
      const isActive = Boolean(step?.isActive);

      // Distancia de reproducción desde que se disparó el paso s
      let stepDist = wrappedStep - s;
      if (stepDist < 0) {
        stepDist += patternLen;
      }

      // Envolvente analógica: fade-in (~30ms) y fade-out exponencial (~120ms)
      let env = 0;
      if (isPlaying && isActive && stepDist < 1.35) {
        if (stepDist < 0.18) {
          env = Math.sin((stepDist / 0.18) * (Math.PI / 2));
        } else {
          const decayRatio = (stepDist - 0.18) / (1.35 - 0.18);
          env = Math.pow(1 - decayRatio, 2.2);
        }
      }

      if (isActive) {
        if (env > 0.01) {
          // Destello incandescente por doble capa sin shadowBlur (0 stall de blur en GPU)
          const currentScaleY = 1.0 + (0.22 * env);
          const scaledH = rowHeight * currentScaleY;
          const offsetY = (scaledH - rowHeight) / 2;
          const blendedColor = interpolateRgb(lightColor, '#ffffff', env * 0.95);
          const haloExpand = 2.5 + 3.5 * env;

          ctx.globalAlpha = 0.18 + 0.25 * env;
          ctx.fillStyle = lightColor;
          ctx.beginPath();
          ctx.roundRect(currentX - haloExpand * 0.5, rowY - offsetY - haloExpand * 0.5, pillWidth + haloExpand, scaledH + haloExpand, 4);
          ctx.fill();

          ctx.globalAlpha = 1.0;
          ctx.fillStyle = blendedColor;
          ctx.beginPath();
          ctx.roundRect(currentX, rowY - offsetY, pillWidth, scaledH, 3);
          ctx.fill();
        } else {
          // Luz activa cálida en reposo con halo sutil
          ctx.globalAlpha = 0.22;
          ctx.fillStyle = lightColor;
          ctx.beginPath();
          ctx.roundRect(currentX - 1, rowY - 1, pillWidth + 2, rowHeight + 2, 4);
          ctx.fill();

          ctx.globalAlpha = 1.0;
          ctx.fillStyle = lightColor;
          ctx.beginPath();
          ctx.roundRect(currentX, rowY, pillWidth, rowHeight, 3);
          ctx.fill();
        }
      } else {
        // Barra inactiva: casi imperceptible en reposo
        ctx.fillStyle = 'rgba(255, 255, 255, 0.025)';
        ctx.beginPath();
        ctx.roundRect(currentX, rowY, pillWidth, rowHeight, 3);
        ctx.fill();
      }

      currentX += pillWidth;
    }
  }

  // Fila inferior de cursor de pasos (con desvanecimiento continuo)
  const cursorRowY = startY + activeChannels.length * (rowHeight + gapY) + 4;
  let cursorX = startX;

  for (let s = 0; s < patternLen; s++) {
    if (s > 0) {
      cursorX += baseGapX;
      if (hasQuarters && s % (patternLen / 4) === 0) cursorX += quarterGap;
    }

    let cursorDist = wrappedStep - s;
    if (cursorDist < 0) cursorDist += patternLen;

    if (isPlaying && cursorDist < 1.0) {
      const cursorAlpha = Math.pow(1 - cursorDist, 1.8);
      ctx.globalAlpha = cursorAlpha * 0.3;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(cursorX + pillWidth * 0.1, cursorRowY - 1, pillWidth * 0.8, 4);
      ctx.globalAlpha = cursorAlpha;
      ctx.fillRect(cursorX + pillWidth * 0.2, cursorRowY, pillWidth * 0.6, 2);
      ctx.globalAlpha = 1.0;
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

  // 1. Líneas verticales sutiles de referencia de pitch (en 2 batch strokes en lugar de 85 draw calls)
  ctx.lineWidth = 1;
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.015)';
  ctx.beginPath();
  for (let m = MIN_MIDI; m <= MAX_MIDI; m++) {
    if (m % 12 === 0) continue;
    const x = (m - MIN_MIDI) * keyWidth;
    ctx.moveTo(x, 0);
    ctx.lineTo(x, impactY);
  }
  ctx.stroke();

  ctx.strokeStyle = 'rgba(130, 165, 245, 0.07)';
  ctx.beginPath();
  for (let m = MIN_MIDI; m <= MAX_MIDI; m++) {
    if (m % 12 !== 0) continue;
    const x = (m - MIN_MIDI) * keyWidth;
    ctx.moveTo(x, 0);
    ctx.lineTo(x, impactY);
  }
  ctx.stroke();

  // 2. Horizonte de impacto sutil
  ctx.strokeStyle = 'rgba(130, 165, 245, 0.25)';
  ctx.beginPath();
  ctx.moveTo(0, impactY);
  ctx.lineTo(width, impactY);
  ctx.stroke();

  // 3. Renderizar únicamente las notas visibles mediante búsqueda binaria O(log N)
  const visibleMinBeat = beat - lookBehindBeats;
  const visibleMaxBeat = beat + lookAheadBeats;
  activeStrikesPool.length = 0;
  activeFrameMidiPool.clear();

  if (notes.length > 0) {
    const { sorted, maxDur } = getSortedNotesCached(notes);
    let idx = lowerBoundByBeat(sorted, visibleMinBeat - maxDur);
    for (; idx < sorted.length; idx++) {
      const note = sorted[idx];
      if (note.startBeat > visibleMaxBeat) break;
      const noteEndBeat = note.startBeat + note.durationBeats;
      if (noteEndBeat < visibleMinBeat) continue;

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
        ctx.globalAlpha = trailAlpha * 0.7;
        ctx.fillStyle = baseColor;
        const trailH = Math.max(2, (0.55 - (beat - noteEndBeat)) * noteSpeed * 0.4);
        ctx.fillRect(noteX, impactY - trailH, noteW, trailH);
        ctx.globalAlpha = 1.0;
      }

      // C. Nota activa en el impacto
      if (isActive && isPlaying) {
        activeFrameMidiPool.add(clampedMidi);
        keyLuminanceMap.set(clampedMidi, { color: baseColor, alpha: 1.0 });
        activeStrikesPool.push({ x: noteX + noteW / 2, color: baseColor, width: noteW });

        if (particles.length < MAX_STAGE_PARTICLES && Math.random() < 0.25) {
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
  }

  // 4. Destellos en el horizonte de impacto (glow layering rápido sin gradient allocations)
  for (let i = 0; i < activeStrikesPool.length; i++) {
    const strike = activeStrikesPool[i];
    ctx.globalAlpha = 0.28;
    ctx.fillStyle = strike.color;
    ctx.beginPath();
    ctx.arc(strike.x, impactY, strike.width * 2.1, 0, Math.PI * 2);
    ctx.fill();

    ctx.globalAlpha = 0.65;
    ctx.beginPath();
    ctx.arc(strike.x, impactY, strike.width * 1.1, 0, Math.PI * 2);
    ctx.fill();

    ctx.globalAlpha = 1.0;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(strike.x - strike.width / 2, impactY - 1, strike.width, 2);
  }

  // 5. Partículas con swap-and-pop O(1)
  for (let p = particles.length - 1; p >= 0; p--) {
    const pt = particles[p];
    pt.x += pt.vx;
    pt.y += pt.vy;
    pt.alpha -= pt.decay;

    if (pt.alpha <= 0) {
      const last = particles.length - 1;
      if (p !== last) particles[p] = particles[last];
      particles.pop();
      continue;
    }

    ctx.globalAlpha = pt.alpha;
    ctx.fillStyle = pt.color;
    ctx.beginPath();
    ctx.arc(pt.x, pt.y, pt.size, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1.0;

  // 6. Decaimiento de luminancia de teclas
  keyLuminanceMap.forEach((item, midi) => {
    if (!activeFrameMidiPool.has(midi)) {
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
    const isBlack = BLACK_KEY_TABLE[m % 12] === 1;
    const x = (m - MIN_MIDI) * keyWidth;
    const activeEntry = keyLuminanceMap.get(m);

    if (activeEntry && activeEntry.alpha > 0.01) {
      ctx.globalAlpha = activeEntry.alpha;
      ctx.fillStyle = activeEntry.color;
      ctx.fillRect(x + 0.5, kbY, keyWidth - 1, kbHeight);
      ctx.globalAlpha = 1.0;
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
  _height: number,
  chordBlocks: ChordBlock[],
  beat: number
) {
  if (!chordBlocks || chordBlocks.length === 0) return;

  const ribbonHeight = 32;
  const ribbonY = 14; // En la parte superior del stage
  const ribbonMarginX = 12;
  const ribbonWidth = width - ribbonMarginX * 2;
  const ribbonX = ribbonMarginX;

  ctx.save();

  // Contenedor de la cinta (halo limpio sin shadowBlur en GPU)
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.42)';
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.roundRect(ribbonX, ribbonY, ribbonWidth, ribbonHeight, 16);
  ctx.stroke();

  ctx.fillStyle = 'rgba(16, 12, 22, 0.92)';
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(ribbonX, ribbonY, ribbonWidth, ribbonHeight, 16);
  ctx.fill();
  ctx.stroke();

  // Scroll horizontal adaptativo centrado en el 35% usando acorde caché ordenado
  const beatWidth = 40;
  const { sorted: sortedChords, maxDur: maxChordDur, firstStart: songStartBeat, maxEnd } = getSortedChordsCached(chordBlocks);
  const songTotalBeats = Math.max(16, maxEnd - songStartBeat);
  const totalTrackWidth = songTotalBeats * beatWidth;

  const playheadRelX = (beat - songStartBeat) * beatWidth;
  let scrollX = 0;
  if (totalTrackWidth > ribbonWidth) {
    const focalOffset = ribbonWidth * 0.35;
    const maxScroll = totalTrackWidth - ribbonWidth;
    scrollX = Math.max(0, Math.min(maxScroll, playheadRelX - focalOffset));
  }

  const visiblePlayheadX = ribbonX + playheadRelX - scrollX;
  const visibleMinChordBeat = songStartBeat + (scrollX / beatWidth) - maxChordDur;
  const visibleMaxChordBeat = songStartBeat + ((scrollX + ribbonWidth) / beatWidth);

  // Clip dentro de la cinta
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(ribbonX, ribbonY, ribbonWidth, ribbonHeight, 16);
  ctx.clip();

  const pillY = ribbonY + 2.5;
  const pillH = ribbonHeight - 5;

  ctx.font = 'bold 12px "Share Tech Mono", monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  let cIdx = lowerBoundByBeat(sortedChords, visibleMinChordBeat);
  for (; cIdx < sortedChords.length; cIdx++) {
    const block = sortedChords[cIdx];
    if (block.startBeat > visibleMaxChordBeat) break;
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
    ctx.fillStyle = isActive ? '#ffffff' : isPassed ? '#a395b8' : '#c2b5d4';
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

function ensureCrtOverlayCache(width: number, height: number): HTMLCanvasElement | OffscreenCanvas | null {
  if (crtCacheCanvas && crtCacheW === width && crtCacheH === height) {
    return crtCacheCanvas;
  }

  let canvas: HTMLCanvasElement | OffscreenCanvas | null = null;
  if (typeof OffscreenCanvas !== 'undefined') {
    canvas = new OffscreenCanvas(width, height);
  } else if (typeof document !== 'undefined') {
    const el = document.createElement('canvas');
    el.width = width;
    el.height = height;
    canvas = el;
  }
  if (!canvas) return null;

  const cctx = canvas.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
  if (!cctx) return null;

  cctx.fillStyle = 'rgba(0, 0, 0, 0.16)';
  for (let y = 0; y < height; y += 4) {
    cctx.fillRect(0, y, width, 1.5);
  }

  const grad = cctx.createRadialGradient(
    width / 2,
    height / 2,
    width * 0.40,
    width / 2,
    height / 2,
    width * 0.72
  );
  grad.addColorStop(0, 'rgba(0, 0, 0, 0)');
  grad.addColorStop(1, 'rgba(0, 0, 0, 0.60)');

  cctx.fillStyle = grad;
  cctx.fillRect(0, 0, width, height);

  crtCacheCanvas = canvas;
  crtCacheW = width;
  crtCacheH = height;
  return crtCacheCanvas;
}

/**
 * Capa 4: Filtro CRT (blit instantáneo desde offscreen cache)
 */
function renderCRTOverlay(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  width: number,
  height: number
) {
  const cached = ensureCrtOverlayCache(width, height);
  if (cached) {
    ctx.drawImage(cached, 0, 0);
  }
}

/**
 * Helpers de interpolación de color con caché para transiciones analógicas en lienzo
 */
function hexToRgb(hex: string): [number, number, number] {
  const hit = hexRgbCache.get(hex);
  if (hit) return hit;

  const clean = hex.replace('#', '');
  const rgb: [number, number, number] = clean.length === 3
    ? [
        parseInt(clean[0] + clean[0], 16),
        parseInt(clean[1] + clean[1], 16),
        parseInt(clean[2] + clean[2], 16)
      ]
    : [
        parseInt(clean.slice(0, 2), 16),
        parseInt(clean.slice(2, 4), 16),
        parseInt(clean.slice(4, 6), 16)
      ];
  hexRgbCache.set(hex, rgb);
  return rgb;
}

function interpolateRgb(hexColor: string, targetHex: string, factor: number): string {
  const [r1, g1, b1] = hexToRgb(hexColor);
  const [r2, g2, b2] = hexToRgb(targetHex);
  const clampedFactor = Math.max(0, Math.min(1, factor));
  const r = Math.round(r1 + (r2 - r1) * clampedFactor);
  const g = Math.round(g1 + (g2 - g1) * clampedFactor);
  const b = Math.round(b1 + (b2 - b1) * clampedFactor);
  return `rgb(${r}, ${g}, ${b})`;
}

