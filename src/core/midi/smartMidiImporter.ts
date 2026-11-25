/**
 * smartMidiImporter.ts
 * Motor inteligente de importación MIDI (SMF Tipo 0 y Tipo 1) para Phosphor Composer.
 *
 * Características:
 * - Tiempos musicales exactos basados en `ticks / ppq` (preserva tresillos, adornos y cambios de tempo sin deriva).
 * - Conservación fiel de velocidades MIDI (0.05..1.0) y soporte de pedal sustain (CC64).
 * - Adaptación automática de cada pista a canales de Phosphor (Piano muestreado o Preset de Synth curado + CC7 Volumen + CC10 Pan).
 * - Análisis armónico multi-pista por ventanas ponderadas por duración (detecta arpegios, slash chords, 7mas sin 5ta y dim7).
 * - Detección musical real de tonalidad y escala (acordes + perfil tonal Krumhansl-Schmuckler + armadura MIDI).
 * - Conversión inteligente de percusión GM (Canal 10) a patrones de batería y cadena lineal de Phosphor.
 */

import * as ToneMidi from '@tonejs/midi';
import {
  NOTE_CLASSES,
  midiToNote,
  normalizePitchClass,
  detectKey,
  type NoteClass,
  type ScaleType
} from '../music';
import {
  SYNTH_PRESETS,
  DEFAULT_SYNTH_SETTINGS,
  normalizeSynthSettings
} from '../audio/engine/synthPresets';
import {
  DEFAULT_CHANNELS,
  DEFAULT_DRUM_CHANNELS,
  createEmptyPatterns
} from '../session/sessionSerializer';
import type {
  ChannelConfig,
  ChannelInstrument,
  ChordBlock,
  DrumChannel,
  MelodyNote,
  PatternChainItem,
  PianoRollTrack,
  StyleMarker,
  SynthSettings,
  TempoMarker,
  TimeSignature
} from '../../utils/typeDefinitions';
import type { PatternDef } from '../../patterns/patternTypes';

const Midi = (ToneMidi as any).Midi || (ToneMidi as any).default?.Midi || (ToneMidi as any).default;

export interface SmartMidiImportResult {
  success: boolean;
  isProject: boolean;
  bpm: number;
  tempoMarkers?: TempoMarker[];
  key: NoteClass;
  scale: ScaleType;
  pattern: string;
  timeSignature: TimeSignature;
  chordBlocks: ChordBlock[];
  styleMarkers?: StyleMarker[];
  tracks?: PianoRollTrack[];
  melodyNotes: MelodyNote[];
  channels?: Record<string, ChannelConfig>;
  drumChannels?: DrumChannel[];
  patternChain?: PatternChainItem[];
  isPatternRepeatOn?: boolean;
  activeDrumKitId?: string;
  chordOctaveShift?: number;
  currentDrumPatternEdit?: number;
  patternLengths?: number[];
  summary?: {
    tracksCount: number;
    notesCount: number;
    chordsCount: number;
    drumPatternsCount: number;
    chordsMutedForFidelity: boolean;
  };
  message: string;
}

interface InternalNote {
  midi: number;
  startBeat: number;
  durationBeats: number;
  velocity: number;
}

interface ParsedMidiTrack {
  rawTrack: any;
  rawName: string;
  displayName: string;
  notes: InternalNote[];
  medianMidi: number;
  avgMidi: number;
  volume: number;
  pan: number;
  gmProgram: number;
  gmFamily: string;
}

const TRACK_COLORS = [
  '#60a5fa',
  '#a78bfa',
  '#2dd4bf',
  '#f59e0b',
  '#f472b6',
  '#5fab82',
  '#fb923c',
  '#38bdf8'
];

// Perfiles tonales Krumhansl-Schmuckler (para respaldo en MIDI monofónicos o ambiguos)
const KS_MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const KS_MINOR = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

// Plantillas de acordes ordenadas con prioridad musical (sin fallbacks de 2 notas que fuercen menor)
const HARMONY_TEMPLATES: Array<{
  suffix: string;
  intervals: number[];
  optionalFifth?: boolean;
  parsimonyBonus: number;
}> = [
  { suffix: '', intervals: [0, 4, 7], parsimonyBonus: 0.24 },
  { suffix: 'm', intervals: [0, 3, 7], parsimonyBonus: 0.24 },
  { suffix: '7', intervals: [0, 4, 7, 10], optionalFifth: true, parsimonyBonus: 0.14 },
  { suffix: 'maj7', intervals: [0, 4, 7, 11], optionalFifth: true, parsimonyBonus: 0.10 },
  { suffix: 'm7', intervals: [0, 3, 7, 10], optionalFifth: true, parsimonyBonus: 0.12 },
  { suffix: 'dim', intervals: [0, 3, 6], parsimonyBonus: 0.14 },
  { suffix: 'dim7', intervals: [0, 3, 6, 9], parsimonyBonus: 0.12 },
  { suffix: 'm7b5', intervals: [0, 3, 6, 10], parsimonyBonus: 0.10 },
  { suffix: 'aug', intervals: [0, 4, 8], parsimonyBonus: 0.08 },
  { suffix: 'sus4', intervals: [0, 5, 7], parsimonyBonus: 0.04 },
  { suffix: 'sus2', intervals: [0, 2, 7], parsimonyBonus: 0.04 }
];

function getPresetSettingsById(presetId: string): SynthSettings {
  const found = SYNTH_PRESETS.find((p) => p.id === presetId);
  if (found) {
    return normalizeSynthSettings({ ...found.settings, presetName: found.name });
  }
  return normalizeSynthSettings({ ...DEFAULT_SYNTH_SETTINGS, presetName: 'Init Synth' });
}

function roundBeat(beats: number): number {
  return Math.round(beats * 10000) / 10000;
}

function clampVelocity(vel: unknown): number {
  const v = typeof vel === 'number' && Number.isFinite(vel) ? vel : 0.8;
  return Math.round(Math.max(0.05, Math.min(1.0, v)) * 1000) / 1000;
}

/**
 * Extrae las notas de una pista MIDI usando tiempos musicales exactos (`ticks / ppq`)
 * y aplica opcionalmente extensión por pedal sustain (CC64).
 */
function extractTrackNotes(track: any, ppq: number, fallbackBpm: number): InternalNote[] {
  const rawNotes: any[] = Array.isArray(track.notes) ? track.notes : [];
  if (rawNotes.length === 0) return [];

  const notes: InternalNote[] = rawNotes.map((n) => {
    const startBeat =
      typeof n.ticks === 'number' && ppq > 0
        ? roundBeat(n.ticks / ppq)
        : roundBeat((n.time || 0) * (fallbackBpm / 60));

    const durBeatRaw =
      typeof n.durationTicks === 'number' && ppq > 0
        ? n.durationTicks / ppq
        : (n.duration || 0.25) * (fallbackBpm / 60);

    return {
      midi: Math.max(0, Math.min(127, Math.round(n.midi ?? 60))),
      startBeat: Math.max(0, startBeat),
      durationBeats: Math.max(0.0625, roundBeat(durBeatRaw)),
      velocity: clampVelocity(n.velocity)
    };
  });

  notes.sort((a, b) => a.startBeat - b.startBeat || a.midi - b.midi);

  // Soporte de pedal sustain (CC64) si la pista lo usa
  const cc64: Array<{ ticks?: number; time?: number; value: number }> | undefined =
    track.controlChanges?.[64];

  if (Array.isArray(cc64) && cc64.length > 0 && ppq > 0) {
    const pedalSpans: Array<{ startBeat: number; endBeat: number }> = [];
    let pedalDownBeat: number | null = null;

    const sortedCc = [...cc64].sort((a, b) => (a.ticks ?? 0) - (b.ticks ?? 0));
    for (const evt of sortedCc) {
      const evtBeat =
        typeof evt.ticks === 'number'
          ? evt.ticks / ppq
          : (evt.time || 0) * (fallbackBpm / 60);
      const isDown = evt.value >= 0.5;
      if (isDown && pedalDownBeat === null) {
        pedalDownBeat = evtBeat;
      } else if (!isDown && pedalDownBeat !== null) {
        if (evtBeat > pedalDownBeat + 0.02) {
          pedalSpans.push({ startBeat: pedalDownBeat, endBeat: evtBeat });
        }
        pedalDownBeat = null;
      }
    }

    if (pedalSpans.length > 0) {
      // Índice rápido de siguiente ataque de la misma nota MIDI para evitar solapamientos
      const nextSameMidiStart = new Float64Array(notes.length).fill(Infinity);
      const lastSeenByMidi = new Map<number, number>();
      for (let i = notes.length - 1; i >= 0; i--) {
        const nextIdx = lastSeenByMidi.get(notes[i].midi);
        if (nextIdx !== undefined) {
          nextSameMidiStart[i] = notes[nextIdx].startBeat;
        }
        lastSeenByMidi.set(notes[i].midi, i);
      }

      for (let i = 0; i < notes.length; i++) {
        const note = notes[i];
        const noteEnd = note.startBeat + note.durationBeats;
        for (let s = 0; s < pedalSpans.length; s++) {
          const span = pedalSpans[s];
          if (span.startBeat > noteEnd) break;
          if (noteEnd >= span.startBeat && noteEnd < span.endBeat) {
            const maxEnd = Math.min(span.endBeat, nextSameMidiStart[i] - 0.02, note.startBeat + 8);
            if (maxEnd > noteEnd + 0.02) {
              note.durationBeats = roundBeat(maxEnd - note.startBeat);
            }
            break;
          }
        }
      }
    }
  }

  return notes;
}

/**
 * Extrae volumen (0..100, 80 = nominal 0dB) y paneo (-1..+1) desde CC7 y CC10 del track MIDI.
 */
function extractTrackMixerCC(track: any): { volume: number; pan: number } {
  let volume = 80;
  let pan = 0;

  const cc7 = track.controlChanges?.[7];
  if (Array.isArray(cc7) && cc7.length > 0) {
    // CC7 en @tonejs/midi viene normalizado 0..1 (100/127 ≈ 0.79 -> ~80 en Phosphor)
    const firstVal = cc7[0].value;
    if (typeof firstVal === 'number' && Number.isFinite(firstVal)) {
      const clamped = Math.max(0.15, Math.min(1.0, firstVal));
      // Escalar suavemente para que 0.78..1.0 quede en el rango dulce 76..86 (sin clipear)
      volume = Math.round(Math.max(35, Math.min(88, clamped * 90)));
    }
  }

  const cc10 = track.controlChanges?.[10];
  if (Array.isArray(cc10) && cc10.length > 0) {
    const firstPan = cc10[0].value;
    if (typeof firstPan === 'number' && Number.isFinite(firstPan)) {
      // @tonejs/midi CC10 viene normalizado 0..1 (0.5 = centro)
      pan = Math.round(Math.max(-1, Math.min(1, (firstPan - 0.5) * 2)) * 100) / 100;
    }
  }

  return { volume, pan };
}

/**
 * Limpia nombres técnicos comunes de archivos MIDI (ej: "up:", "dn:", nombres vacíos).
 */
function normalizeTrackDisplayName(rawName: string, instrumentName: string, index: number, avgMidi: number): string {
  const cleaned = (rawName || '').replace(/[\0\r\n]+/g, ' ').replace(/:+$/, '').trim();
  const lower = cleaned.toLowerCase();

  if (lower === 'up' || lower === 'rh' || lower === 'right' || lower === 'right hand' || lower === 'treble') {
    return 'Piano (Mano Der.)';
  }
  if (lower === 'dn' || lower === 'down' || lower === 'lh' || lower === 'left' || lower === 'left hand' || lower === 'bass clef') {
    return 'Piano (Mano Izq.)';
  }
  if (cleaned.length > 0) {
    return cleaned.slice(0, 28);
  }
  if (instrumentName && instrumentName.trim().length > 0) {
    const pretty = instrumentName
      .trim()
      .replace(/\b\w/g, (c) => c.toUpperCase());
    return pretty.slice(0, 28);
  }
  return avgMidi < 48 ? `Bass ${index + 1}` : `Pista ${index + 1}`;
}

/**
 * Mapea nombre de pista, programa General MIDI (0..127) y registro tonal
 * al mejor instrumento y preset de Phosphor Composer.
 */
function resolvePhosphorInstrument(
  trackName: string,
  gmProgram: number,
  gmFamily: string,
  avgMidi: number
): {
  instrument: ChannelInstrument;
  channelType: ChannelConfig['type'];
  synthSettings?: SynthSettings;
} {
  const name = `${trackName || ''}`.toLowerCase();
  const family = `${gmFamily || ''}`.toLowerCase();

  // 1. Palabras clave explícitas en el nombre de la pista (tienen máxima prioridad porque muchos DAWs exportan prog=0)
  if (/\b(808|sub\s*boom|boom)\b/.test(name)) {
    return { instrument: 'synth', channelType: 'bass', synthSettings: getPresetSettingsById('sub_808_boom') };
  }
  if (/\b(acid|303|tb303)\b/.test(name)) {
    return { instrument: 'synth', channelType: 'bass', synthSettings: getPresetSettingsById('acid_303') };
  }
  if (/\b(reese)\b/.test(name)) {
    return { instrument: 'synth', channelType: 'bass', synthSettings: getPresetSettingsById('reese_cyber') };
  }
  if (/\b(moog|sub|bass|bajo|contra)\b/.test(name)) {
    return { instrument: 'synth', channelType: 'bass', synthSettings: getPresetSettingsById('moog_bass') };
  }
  if (/\b(rhodes|wurlitzer|electric\s*piano|e\.?\s*p\.?|epiano|clavi)\b/.test(name)) {
    return { instrument: 'synth', channelType: 'synth', synthSettings: getPresetSettingsById('neo_soul_ep') };
  }
  if (/\b(organs?|juno|keys|teclados?|harpsi)\b/.test(name)) {
    return { instrument: 'synth', channelType: 'synth', synthSettings: getPresetSettingsById('vintage_juno') };
  }
  if (/\b(bells?|glock|marimba|vibra|celesta|kalimba|music\s*box|plucks?|harps?|arpas?|pizz)\b/.test(name)) {
    return { instrument: 'synth', channelType: 'synth', synthSettings: getPresetSettingsById('crystal_pluck') };
  }
  if (/\b(guitars?|gtr|nylon|acoustic\s*g|electric\s*g|ukulele|banjo)\b/.test(name)) {
    return { instrument: 'synth', channelType: 'synth', synthSettings: getPresetSettingsById('tokyo_neon') };
  }
  if (/\b(brass|trumpets?|horns?|tromb|sax|tuba)\b/.test(name)) {
    return { instrument: 'synth', channelType: 'synth', synthSettings: getPresetSettingsById('jupiter_brass') };
  }
  if (/\b(flutes?|flautas?|oboe|clarinet|recorder|ocarina|pipes?|whistle)\b/.test(name)) {
    return { instrument: 'synth', channelType: 'melody', synthSettings: getPresetSettingsById('analog_flute') };
  }
  if (/\b(8-?bit|chip|nes|gameboy|square|pulse)\b/.test(name)) {
    return { instrument: 'synth', channelType: 'melody', synthSettings: getPresetSettingsById('retro_chiptune') };
  }
  if (/\b(supersaw|saw|anthem|trance|edm)\b/.test(name)) {
    return { instrument: 'synth', channelType: 'melody', synthSettings: getPresetSettingsById('supersaw_titan') };
  }
  if (/\b(ondes|martenot|theremin|vapor|solo|leads?|melody|melod[ií]a|vocals?|voices?|sing)\b/.test(name)) {
    return { instrument: 'synth', channelType: 'melody', synthSettings: getPresetSettingsById('vapor_lead') };
  }
  if (/\b(pads?|strings?|violins?|violas?|cellos?|orchestra|choirs?|coros?|ambient|atmos|drones?|synth\s*str)\b/.test(name)) {
    return { instrument: 'synth', channelType: 'synth', synthSettings: getPresetSettingsById('warm_pad') };
  }
  if (/\b(pianos?|grand|upright|up|dn|down|rh|lh|right\s*hand|left\s*hand|treble)\b/.test(name)) {
    return { instrument: 'piano', channelType: 'melody' };
  }

  // 2. Programa General MIDI (0..127)
  if (gmProgram >= 0 && gmProgram <= 3) {
    return { instrument: 'piano', channelType: 'melody' };
  }
  if (gmProgram >= 4 && gmProgram <= 7) {
    return { instrument: 'synth', channelType: 'synth', synthSettings: getPresetSettingsById('neo_soul_ep') };
  }
  if (gmProgram >= 8 && gmProgram <= 15) {
    return { instrument: 'synth', channelType: 'synth', synthSettings: getPresetSettingsById('crystal_pluck') };
  }
  if (gmProgram >= 16 && gmProgram <= 23) {
    return { instrument: 'synth', channelType: 'synth', synthSettings: getPresetSettingsById('vintage_juno') };
  }
  if (gmProgram >= 24 && gmProgram <= 31) {
    return { instrument: 'synth', channelType: 'synth', synthSettings: getPresetSettingsById('tokyo_neon') };
  }
  if (gmProgram >= 32 && gmProgram <= 39) {
    return { instrument: 'synth', channelType: 'bass', synthSettings: getPresetSettingsById('moog_bass') };
  }
  if (gmProgram >= 40 && gmProgram <= 55) {
    const preset = gmProgram >= 52 ? 'astral_silk' : 'warm_pad';
    return { instrument: 'synth', channelType: 'synth', synthSettings: getPresetSettingsById(preset) };
  }
  if (gmProgram >= 56 && gmProgram <= 63) {
    return { instrument: 'synth', channelType: 'synth', synthSettings: getPresetSettingsById('jupiter_brass') };
  }
  if (gmProgram >= 64 && gmProgram <= 79) {
    return { instrument: 'synth', channelType: 'melody', synthSettings: getPresetSettingsById('analog_flute') };
  }
  if (gmProgram >= 80 && gmProgram <= 87) {
    const leadPreset =
      gmProgram === 80 ? 'retro_chiptune' :
      gmProgram === 81 ? 'supersaw_titan' :
      gmProgram === 82 ? 'analog_flute' :
      'cyber_lead';
    return { instrument: 'synth', channelType: 'melody', synthSettings: getPresetSettingsById(leadPreset) };
  }
  if (gmProgram >= 88 && gmProgram <= 95) {
    const padPreset =
      gmProgram === 89 ? 'warm_pad' :
      gmProgram === 92 ? 'blade_runner' :
      gmProgram === 95 ? 'aurora_ambient' :
      'astral_silk';
    return { instrument: 'synth', channelType: 'synth', synthSettings: getPresetSettingsById(padPreset) };
  }
  if (gmProgram >= 96 && gmProgram <= 103) {
    return { instrument: 'synth', channelType: 'synth', synthSettings: getPresetSettingsById('crystal_pluck') };
  }

  // 3. Fallback por familia GM o registro tonal
  if (family.includes('piano')) {
    return { instrument: 'piano', channelType: 'melody' };
  }
  if (family.includes('bass') || avgMidi < 46) {
    return { instrument: 'synth', channelType: 'bass', synthSettings: getPresetSettingsById('moog_bass') };
  }
  return { instrument: 'synth', channelType: 'melody', synthSettings: getPresetSettingsById('neo_soul_ep') };
}

/**
 * Reconoce el acorde más fiel dada una distribución ponderada de clases de pitch (0..11)
 * y la nota más grave del compás/ventana.
 */
function detectWeightedChord(
  pcWeights: Float64Array,
  bassMidi: number | null,
  previousChord: string | null
): { chord: string; inversion: number } | null {
  let totalWeight = 0;
  const activePCs: number[] = [];
  for (let pc = 0; pc < 12; pc++) {
    if (pcWeights[pc] > 0.001) {
      totalWeight += pcWeights[pc];
      activePCs.push(pc);
    }
  }

  if (activePCs.length === 0 || totalWeight <= 0) return null;

  const bassPC = bassMidi !== null ? ((bassMidi % 12) + 12) % 12 : activePCs[0];

  // Si solo suena 1 clase de pitch (nota aislada/pedal), no inventar un acorde menor arbitrario:
  // mantener el acorde previo si lo contiene, o dejar una tríada neutra sólo si no hay previo.
  if (activePCs.length === 1) {
    if (previousChord) {
      return { chord: previousChord, inversion: 0 };
    }
    return { chord: NOTE_CLASSES[activePCs[0]], inversion: 0 };
  }

  let bestRoot = bassPC;
  let bestSuffix = '';
  let bestScore = -Infinity;

  for (let root = 0; root < 12; root++) {
    // La tónica debería existir en la ventana (o estar muy cerca en peso)
    if (pcWeights[root] <= 0.001) continue;

    for (const tpl of HARMONY_TEMPLATES) {
      let matchedWeight = 0;
      let missingPenalty = 0;
      let coveredPCs = 0;

      for (const iv of tpl.intervals) {
        const pc = (root + iv) % 12;
        const w = pcWeights[pc];
        if (w > 0.001) {
          matchedWeight += w;
          coveredPCs++;
        } else {
          // La 5ta justa (intervalo 7) se omite frecuentemente en 7mas clásicas/jazz (ej: A-C#-G = A7)
          if (tpl.optionalFifth && iv === 7) {
            missingPenalty += 0.08;
          } else if (iv === 3 || iv === 4) {
            // La tercera define mayor vs menor: penalizar fuerte si falta
            missingPenalty += 0.55;
          } else {
            missingPenalty += 0.32;
          }
        }
      }

      if (coveredPCs < 2) continue;

      const extraWeight = totalWeight - matchedWeight;
      const coverageRatio = matchedWeight / totalWeight;
      const extraRatio = extraWeight / totalWeight;

      let score =
        coverageRatio * 2.2 -
        extraRatio * 1.15 -
        missingPenalty +
        tpl.parsimonyBonus;

      // Bonificación cuando el bajo real es la tónica del acorde
      if (root === bassPC) {
        score += 0.28;
      } else {
        // Si el bajo es una nota estructural del acorde (inversión válida), pequeña bonificación
        const bassRel = (bassPC - root + 12) % 12;
        if (tpl.intervals.includes(bassRel)) {
          score += 0.10;
        }
      }

      // Ligera continuidad armónica para evitar parpadeos en notas de paso breves
      const candidateBase = `${NOTE_CLASSES[root]}${tpl.suffix}`;
      if (previousChord && previousChord.split('/')[0] === candidateBase) {
        score += 0.07;
      }

      if (score > bestScore) {
        bestScore = score;
        bestRoot = root;
        bestSuffix = tpl.suffix;
      }
    }
  }

  const baseChord = `${NOTE_CLASSES[bestRoot]}${bestSuffix}`;

  // Emitir slash chord limpio cuando el bajo real difiere de la tónica y tiene peso real
  // (inversion: 0 para evitar doble inversión en voicingEngine cuando ya existe "/Bajo")
  if (bassMidi !== null && bassPC !== bestRoot && pcWeights[bassPC] / totalWeight >= 0.12) {
    return {
      chord: `${baseChord}/${NOTE_CLASSES[bassPC]}`,
      inversion: 0
    };
  }

  return { chord: baseChord, inversion: 0 };
}

/**
 * Analiza la progresión armónica a partir de todas las notas melódicas/armónicas
 * integrando arpegios y bajos por ventanas musicales.
 */
function analyzeHarmonyFromNotes(
  notes: InternalNote[],
  beatsPerMeasure: number
): ChordBlock[] {
  if (notes.length === 0) return [];

  let maxBeat = 0;
  for (const n of notes) {
    const end = n.startBeat + n.durationBeats;
    if (end > maxBeat) maxBeat = end;
  }
  if (maxBeat <= 0) return [];

  // Ventana de 1 beat (o 1.5 en 6/8) para capturar tanto arpegios de tresillos como cambios por tiempo
  const stepBeats = beatsPerMeasure === 6 ? 1.5 : 1;
  const totalSteps = Math.ceil(maxBeat / stepBeats);
  const rawSteps: Array<{ beat: number; chord: string; inversion: number }> = [];

  let prevChord: string | null = null;

  for (let s = 0; s < totalSteps; s++) {
    const wStart = s * stepBeats;
    const wEnd = wStart + stepBeats;

    const pcWeights = new Float64Array(12);
    let bassMidi: number | null = null;
    let lowestSustainedMidi: number | null = null;
    let activeCount = 0;

    for (let i = 0; i < notes.length; i++) {
      const n = notes[i];
      if (n.startBeat >= wEnd - 0.005) break;
      const nEnd = n.startBeat + n.durationBeats;
      if (nEnd <= wStart + 0.005) continue;

      const overlap = Math.min(nEnd, wEnd) - Math.max(n.startBeat, wStart);
      if (overlap <= 0.005) continue;

      activeCount++;
      const pc = ((n.midi % 12) + 12) % 12;
      const bassBoost = n.midi < 55 ? 1.25 : 1.0;
      pcWeights[pc] += overlap * (0.65 + 0.35 * n.velocity) * bassBoost;

      if (bassMidi === null || n.midi < bassMidi) {
        bassMidi = n.midi;
      }
      if (overlap >= stepBeats * 0.28 && (lowestSustainedMidi === null || n.midi < lowestSustainedMidi)) {
        lowestSustainedMidi = n.midi;
      }
    }

    if (activeCount === 0) {
      rawSteps.push({ beat: wStart, chord: '', inversion: 0 });
      continue;
    }

    // Si en 1 beat solo hubo 1 pitch class (ej. arpegio muy lento), ampliar contexto a 2 beats
    let distinctPCs = 0;
    for (let pc = 0; pc < 12; pc++) {
      if (pcWeights[pc] > 0.001) distinctPCs++;
    }
    if (distinctPCs < 2) {
      const extEnd = Math.min(maxBeat, wStart + stepBeats * 2);
      for (let i = 0; i < notes.length; i++) {
        const n = notes[i];
        if (n.startBeat >= extEnd - 0.005) break;
        const nEnd = n.startBeat + n.durationBeats;
        if (nEnd <= wStart + 0.005) continue;
        const overlap = Math.min(nEnd, extEnd) - Math.max(n.startBeat, wStart);
        if (overlap <= 0.005) continue;
        const pc = ((n.midi % 12) + 12) % 12;
        pcWeights[pc] += overlap * 0.5;
      }
    }

    const detected = detectWeightedChord(pcWeights, lowestSustainedMidi ?? bassMidi, prevChord);
    if (detected) {
      rawSteps.push({ beat: wStart, chord: detected.chord, inversion: detected.inversion });
      prevChord = detected.chord;
    } else {
      rawSteps.push({ beat: wStart, chord: '', inversion: 0 });
    }
  }

  // Agrupar pasos consecutivos idénticos en ChordBlocks limpios
  const blocks: ChordBlock[] = [];
  let current: { chord: string; inversion: number; startBeat: number; durationBeats: number } | null = null;

  for (const step of rawSteps) {
    if (current && current.chord === step.chord && current.inversion === step.inversion) {
      current.durationBeats = roundBeat(current.durationBeats + stepBeats);
    } else {
      if (current && current.chord !== '') {
        blocks.push({
          id: `cb_midi_${blocks.length}_${Math.random().toString(36).slice(2, 7)}`,
          chord: current.chord,
          startBeat: current.startBeat,
          durationBeats: current.durationBeats,
          inversion: current.inversion,
          voicing: 'default'
        });
      }
      current = {
        chord: step.chord,
        inversion: step.inversion,
        startBeat: step.beat,
        durationBeats: stepBeats
      };
    }
  }

  if (current && current.chord !== '') {
    blocks.push({
      id: `cb_midi_${blocks.length}_${Math.random().toString(36).slice(2, 7)}`,
      chord: current.chord,
      startBeat: current.startBeat,
      durationBeats: current.durationBeats,
      inversion: current.inversion,
      voicing: 'default'
    });
  }

  return blocks;
}

/**
 * Correlación de Pearson contra perfiles tonales Krumhansl-Schmuckler
 * ponderando cada nota por duración y registro.
 */
function detectKeyByPitchHistogram(notes: InternalNote[]): { key: NoteClass; scale: ScaleType } | null {
  if (notes.length === 0) return null;

  const hist = new Float64Array(12);
  let total = 0;
  for (const n of notes) {
    const pc = ((n.midi % 12) + 12) % 12;
    const weight = n.durationBeats * (n.midi < 55 ? 1.35 : 1.0);
    hist[pc] += weight;
    total += weight;
  }
  if (total <= 0) return null;

  const meanH = total / 12;
  let bestScore = -Infinity;
  let bestKey: NoteClass = 'C';
  let bestScale: ScaleType = 'major';

  const evalProfile = (profile: number[], scale: ScaleType) => {
    const meanP = profile.reduce((a, b) => a + b, 0) / 12;
    for (let root = 0; root < 12; root++) {
      let num = 0;
      let denH = 0;
      let denP = 0;
      for (let i = 0; i < 12; i++) {
        const dh = hist[(root + i) % 12] - meanH;
        const dp = profile[i] - meanP;
        num += dh * dp;
        denH += dh * dh;
        denP += dp * dp;
      }
      const corr = denH > 0 && denP > 0 ? num / Math.sqrt(denH * denP) : 0;
      if (corr > bestScore) {
        bestScore = corr;
        bestKey = NOTE_CLASSES[root];
        bestScale = scale;
      }
    }
  };

  evalProfile(KS_MAJOR, 'major');
  evalProfile(KS_MINOR, 'minor');

  return { key: bestKey, scale: bestScale };
}

/**
 * Detecta la tonalidad real combinando los acordes analizados, el histograma de notas
 * y (solo como respaldo/desempate) la armadura declarada en el header MIDI.
 */
function resolveMidiKeyAndScale(
  chordBlocks: ChordBlock[],
  allNotes: InternalNote[],
  headerKeySignatures: any[]
): { key: NoteClass; scale: ScaleType } {
  // 1. Análisis armónico sobre los bloques de acordes detectados (considera tónica inicial, cadencia final y encaje diatónico)
  if (chordBlocks.length > 0) {
    const fromChords = detectKey(chordBlocks.map((b) => b.chord));
    if (fromChords) {
      return fromChords;
    }
  }

  // 2. Correlación tonal por duración de todas las notas MIDI (Krumhansl-Schmuckler)
  const fromNotes = detectKeyByPitchHistogram(allNotes);
  if (fromNotes) {
    return fromNotes;
  }

  // 3. Fallback a la armadura del header MIDI si no hubo notas analizables
  if (Array.isArray(headerKeySignatures) && headerKeySignatures.length > 0) {
    const ks = headerKeySignatures[0];
    if (ks && typeof ks.key === 'string') {
      const normKey = normalizePitchClass(ks.key);
      const normScale: ScaleType = ks.scale === 'minor' ? 'minor' : 'major';
      return { key: normKey, scale: normScale };
    }
  }

  return { key: 'C', scale: 'major' };
}

/**
 * Mapea una nota MIDI de percusión General MIDI (Canal 10) a uno de los 6 canales de batería de Phosphor.
 */
function mapGmDrumNoteToChannelId(midiNote: number): string | null {
  if (midiNote === 35 || midiNote === 36) return 'kick_1';
  if (midiNote === 37 || midiNote === 38 || midiNote === 40) return 'snare_1';
  if (midiNote === 39) return 'clap_1';
  if (midiNote === 42 || midiNote === 44 || midiNote === 54 || midiNote === 70 || midiNote === 82) {
    return 'hihat_closed';
  }
  if (midiNote === 46) return 'hihat_open';
  if (
    midiNote === 49 ||
    midiNote === 51 ||
    midiNote === 52 ||
    midiNote === 53 ||
    midiNote === 55 ||
    midiNote === 57 ||
    midiNote === 59
  ) {
    return 'crash_1';
  }
  // Toms graves -> kick suave, toms medios/agudos -> snare
  if (midiNote === 41 || midiNote === 43) return 'kick_1';
  if (midiNote === 45 || midiNote === 47 || midiNote === 48 || midiNote === 50) return 'snare_1';
  return null;
}

/**
 * Convierte pistas de percusión GM (Canal 10) en patrones de batería de Phosphor
 * + cadena lineal acoplada al timeline preservando velocidades por paso.
 */
function importDrumTracksFromMidi(
  percussionTracks: any[],
  ppq: number,
  fallbackBpm: number,
  beatsPerMeasure: number
): {
  drumChannels: DrumChannel[];
  patternChain: PatternChainItem[];
  patternLengths: number[];
  isPatternRepeatOn: boolean;
  uniquePatternCount: number;
  volume: number;
  pan: number;
} | null {
  const allDrumHits: Array<{ channelId: string; startBeat: number; velocity: number }> = [];
  let volume = 80;
  let pan = 0;

  for (const track of percussionTracks) {
    const cc = extractTrackMixerCC(track);
    volume = cc.volume;
    pan = cc.pan;
    const rawNotes: any[] = Array.isArray(track.notes) ? track.notes : [];
    for (const n of rawNotes) {
      const chId = mapGmDrumNoteToChannelId(Math.round(n.midi ?? 36));
      if (!chId) continue;
      const startBeat =
        typeof n.ticks === 'number' && ppq > 0
          ? n.ticks / ppq
          : (n.time || 0) * (fallbackBpm / 60);
      allDrumHits.push({
        channelId: chId,
        startBeat: Math.max(0, startBeat),
        velocity: clampVelocity(n.velocity)
      });
    }
  }

  if (allDrumHits.length === 0) return null;

  const stepsPerMeasure = 16;
  const stepBeats = beatsPerMeasure / stepsPerMeasure;

  // Agrupar golpes por compás
  const maxBeat = allDrumHits.reduce((m, h) => Math.max(m, h.startBeat), 0);
  const totalMeasures = Math.max(1, Math.floor(maxBeat / beatsPerMeasure) + 1);

  type MeasureGrid = Map<string, Array<{ isActive: boolean; velocity: number }>>;
  const measureGrids: Array<{ measureIdx: number; grid: MeasureGrid; signature: string }> = [];

  for (let m = 0; m < totalMeasures; m++) {
    const mStart = m * beatsPerMeasure;
    const mEnd = mStart + beatsPerMeasure;
    const hitsInMeasure = allDrumHits.filter((h) => h.startBeat >= mStart - 0.001 && h.startBeat < mEnd - 0.001);
    if (hitsInMeasure.length === 0) continue;

    const grid: MeasureGrid = new Map();
    for (const def of DEFAULT_DRUM_CHANNELS) {
      grid.set(
        def.id,
        Array.from({ length: stepsPerMeasure }, () => ({ isActive: false, velocity: 0.8 }))
      );
    }

    for (const hit of hitsInMeasure) {
      const relBeat = Math.max(0, hit.startBeat - mStart);
      const stepIdx = Math.min(stepsPerMeasure - 1, Math.max(0, Math.round(relBeat / stepBeats)));
      const row = grid.get(hit.channelId);
      if (row) {
        if (!row[stepIdx].isActive || hit.velocity > row[stepIdx].velocity) {
          row[stepIdx] = { isActive: true, velocity: hit.velocity };
        }
      }
    }

    // Firma estructural para deduplicar compases idénticos (agrupando velocidades en cubetas de 0.15)
    const sigParts: string[] = [];
    for (const def of DEFAULT_DRUM_CHANNELS) {
      const row = grid.get(def.id)!;
      const activeStr = row
        .map((s, idx) => (s.isActive ? `${idx}:${Math.round(s.velocity * 6)}` : ''))
        .filter(Boolean)
        .join(',');
      if (activeStr) sigParts.push(`${def.id}[${activeStr}]`);
    }

    measureGrids.push({ measureIdx: m, grid, signature: sigParts.join('|') });
  }

  if (measureGrids.length === 0) return null;

  // Contar frecuencia de cada patrón único y seleccionar hasta los 8 más representativos
  const freqMap = new Map<string, { count: number; grid: MeasureGrid }>();
  for (const mg of measureGrids) {
    const entry = freqMap.get(mg.signature);
    if (entry) {
      entry.count++;
    } else {
      freqMap.set(mg.signature, { count: 1, grid: mg.grid });
    }
  }

  const MAX_PATTERNS = 8;
  const topSignatures = Array.from(freqMap.entries())
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, MAX_PATTERNS);

  const signatureToPatternIdx = new Map<string, number>();
  topSignatures.forEach(([sig], idx) => {
    signatureToPatternIdx.set(sig, idx);
  });

  // Fallback para compases raros (>8 patrones únicos): elegir el patrón más parecido por coincidencia de pasos activos
  const findClosestPatternIndex = (grid: MeasureGrid): number => {
    let bestIdx = 0;
    let bestOverlap = -Infinity;
    topSignatures.forEach(([, { grid: candGrid }], idx) => {
      let score = 0;
      for (const def of DEFAULT_DRUM_CHANNELS) {
        const a = grid.get(def.id)!;
        const b = candGrid.get(def.id)!;
        for (let s = 0; s < stepsPerMeasure; s++) {
          if (a[s].isActive && b[s].isActive) score += 2;
          else if (a[s].isActive !== b[s].isActive) score -= 1;
        }
      }
      if (score > bestOverlap) {
        bestOverlap = score;
        bestIdx = idx;
      }
    });
    return bestIdx;
  };

  // Construir DrumChannels con los patrones deduplicados (preservando velocidades exactas)
  const drumChannels: DrumChannel[] = DEFAULT_DRUM_CHANNELS.map((def) => {
    const patterns = createEmptyPatterns(MAX_PATTERNS, stepsPerMeasure);
    topSignatures.forEach(([, { grid }], pIdx) => {
      const row = grid.get(def.id);
      if (row) {
        patterns[pIdx] = row.map((step) => ({ isActive: step.isActive, velocity: step.velocity }));
      }
    });
    return {
      ...def,
      patterns
    };
  });

  // Construir cadena lineal de clips fusionando compases consecutivos con el mismo patrón
  const patternChain: PatternChainItem[] = [];
  let activeClip: { patternIndex: number; startMeasure: number; durationMeasures: number } | null = null;

  for (const mg of measureGrids) {
    const patIdx = signatureToPatternIdx.get(mg.signature) ?? findClosestPatternIndex(mg.grid);
    if (
      activeClip &&
      activeClip.patternIndex === patIdx &&
      activeClip.startMeasure + activeClip.durationMeasures === mg.measureIdx
    ) {
      activeClip.durationMeasures += 1;
    } else {
      if (activeClip) {
        patternChain.push({
          id: `dclip_midi_${patternChain.length}_${Math.random().toString(36).slice(2, 6)}`,
          type: 'pattern',
          patternIndex: activeClip.patternIndex,
          repeatCount: activeClip.durationMeasures,
          startMeasure: activeClip.startMeasure,
          durationMeasures: activeClip.durationMeasures
        });
      }
      activeClip = {
        patternIndex: patIdx,
        startMeasure: mg.measureIdx,
        durationMeasures: 1
      };
    }
  }

  if (activeClip) {
    patternChain.push({
      id: `dclip_midi_${patternChain.length}_${Math.random().toString(36).slice(2, 6)}`,
      type: 'pattern',
      patternIndex: activeClip.patternIndex,
      repeatCount: activeClip.durationMeasures,
      startMeasure: activeClip.startMeasure,
      durationMeasures: activeClip.durationMeasures
    });
  }

  return {
    drumChannels,
    patternChain,
    patternLengths: Array.from({ length: MAX_PATTERNS }, () => stepsPerMeasure),
    isPatternRepeatOn: false,
    uniquePatternCount: topSignatures.length,
    volume,
    pan
  };
}

/**
 * Punto de entrada principal del importador MIDI inteligente.
 */
export function importMidiSmart(
  midiData: ArrayBuffer,
  customPatterns: PatternDef[],
  identifyPatternFn: (
    harmonyNotes: { startBeat: number; durationBeats: number }[],
    chordBlocks: { startBeat: number; durationBeats: number }[],
    customPatterns: PatternDef[]
  ) => string
): SmartMidiImportResult {
  const midi = new Midi(midiData);
  const ppq = midi.header.ppq || 480;
  const rawFirstBpm = midi.header.tempos.length > 0 ? Math.round(midi.header.tempos[0].bpm) : 120;
  const bpm = Math.max(30, Math.min(360, rawFirstBpm || 120));

  // 1. Restauración íntegra si el archivo trae metadatos incrustados de proyecto Phosphor
  if (midi.header.meta && midi.header.meta.length > 0) {
    const metaEvent = midi.header.meta.find((e: any) =>
      typeof e.text === 'string' && e.text.startsWith('ComposerSessionMetadata:')
    );
    if (metaEvent) {
      try {
        const jsonStr = metaEvent.text.substring('ComposerSessionMetadata:'.length);
        const state = JSON.parse(jsonStr);
        return {
          success: true,
          isProject: true,
          bpm: state.bpm ?? bpm,
          tempoMarkers: state.tempoMarkers ?? [],
          key: normalizePitchClass(state.key ?? 'C'),
          scale: (state.scale ?? 'major') as ScaleType,
          pattern: state.pattern ?? 'hold',
          timeSignature: state.timeSignature ?? '4/4',
          chordBlocks: state.chordBlocks ?? [],
          styleMarkers: state.styleMarkers ?? [],
          tracks: state.tracks,
          melodyNotes: state.melodyNotes ?? [],
          channels: state.channels,
          drumChannels: state.drumChannels,
          patternChain: state.patternChain,
          isPatternRepeatOn: state.isPatternRepeatOn,
          activeDrumKitId: state.activeDrumKitId,
          chordOctaveShift: state.chordOctaveShift,
          currentDrumPatternEdit: state.currentDrumPatternEdit,
          patternLengths: state.patternLengths,
          message: 'Sesión de proyecto restaurada al 100% desde metadatos.'
        };
      } catch (e) {
        console.warn('[smartMidiImporter] Falló el parseo de metadatos incrustados:', e);
      }
    }
  }

  // 2. Compás (Time Signature) y Marcadores de Tempo exactos por ticks/ppq
  let timeSignature: TimeSignature = '4/4';
  if (midi.header.timeSignatures && midi.header.timeSignatures.length > 0) {
    const ts = midi.header.timeSignatures[0].timeSignature;
    const tsStr = `${ts[0]}/${ts[1]}`;
    if (tsStr === '4/4' || tsStr === '3/4' || tsStr === '6/8') {
      timeSignature = tsStr;
    }
  }
  const beatsPerMeasure = timeSignature === '3/4' ? 3 : timeSignature === '6/8' ? 6 : 4;

  const tempoMarkers: TempoMarker[] = [];
  if (Array.isArray(midi.header.tempos) && midi.header.tempos.length > 1) {
    let lastBpm = bpm;
    let lastBeat = 0;
    midi.header.tempos
      .filter((t: any) => typeof t.ticks === 'number' && t.ticks > 0)
      .forEach((t: any, idx: number) => {
        const tmBeat = roundBeat(t.ticks / ppq);
        const tmBpm = Math.max(30, Math.min(360, Math.round(t.bpm)));
        if (tmBpm === lastBpm) return;
        if (tmBeat - lastBeat < 0.05 && tempoMarkers.length > 0) {
          tempoMarkers[tempoMarkers.length - 1].bpm = tmBpm;
        } else {
          tempoMarkers.push({ id: `tm_midi_${idx}`, beat: tmBeat, bpm: tmBpm });
        }
        lastBpm = tmBpm;
        lastBeat = tmBeat;
      });
  }

  // 3. Separar pistas no vacías en Melódicas/Armónicas vs Percusión (Canal 10)
  const nonEmptyTracks = (midi.tracks || []).filter((t: any) => Array.isArray(t.notes) && t.notes.length > 0);
  const percussionTracks = nonEmptyTracks.filter((t: any) => t.instrument?.percussion || t.channel === 9);
  const melodicRawTracks = nonEmptyTracks.filter((t: any) => !t.instrument?.percussion && t.channel !== 9);

  if (melodicRawTracks.length === 0 && percussionTracks.length === 0) {
    return {
      success: false,
      isProject: false,
      bpm,
      key: 'C',
      scale: 'major',
      pattern: 'hold',
      timeSignature,
      chordBlocks: [],
      melodyNotes: [],
      message: 'El archivo MIDI no contiene pistas de notas legibles.'
    };
  }

  // 4. Extraer notas exactas por cada pista melódica/armónica
  const parsedMelodicTracks: ParsedMidiTrack[] = melodicRawTracks.map((rawTrack: any, idx: number): ParsedMidiTrack => {
    const notes = extractTrackNotes(rawTrack, ppq, bpm);
    const sortedMidis = notes.map((n) => n.midi).sort((a, b) => a - b);
    const medianMidi = sortedMidis.length > 0 ? sortedMidis[Math.floor(sortedMidis.length / 2)] : 60;
    const avgMidi =
      notes.length > 0 ? notes.reduce((sum, n) => sum + n.midi, 0) / notes.length : 60;
    const cc = extractTrackMixerCC(rawTrack);
    const gmProgram = typeof rawTrack.instrument?.number === 'number' ? rawTrack.instrument.number : 0;
    const gmFamily = rawTrack.instrument?.family || '';
    const gmName = rawTrack.instrument?.name || '';
    const displayName = normalizeTrackDisplayName(rawTrack.name || '', gmName, idx, avgMidi);

    return {
      rawTrack,
      rawName: (rawTrack.name || '').trim(),
      displayName,
      notes,
      medianMidi,
      avgMidi,
      volume: cc.volume,
      pan: cc.pan,
      gmProgram,
      gmFamily
    };
  });

  // 5. Detectar si existe una pista dedicada explícita de "Chords" (ej: exportación Phosphor/DAW)
  const explicitChordsIdx =
    parsedMelodicTracks.length > 1
      ? parsedMelodicTracks.findIndex((t) =>
          /^(chords?|acordes?|harmony|armon[ií]a)$/i.test(t.rawName)
        )
      : -1;

  const hasExplicitChordsTrack = explicitChordsIdx !== -1;

  // 6. Análisis armónico multi-pista (si hay pista explícita de Chords se analiza esa;
  //    si no, se combinan TODAS las pistas para capturar arpegios + bajos completos)
  const harmonySourceNotes: InternalNote[] = hasExplicitChordsTrack
    ? parsedMelodicTracks[explicitChordsIdx].notes
    : parsedMelodicTracks
        .flatMap((t) => t.notes)
        .sort((a, b) => a.startBeat - b.startBeat || a.midi - b.midi);

  const chordBlocks = analyzeHarmonyFromNotes(harmonySourceNotes, beatsPerMeasure);
  const pattern = hasExplicitChordsTrack
    ? identifyPatternFn(harmonySourceNotes, chordBlocks, customPatterns)
    : 'hold';

  // 7. Detectar tonalidad y escala reales (nunca forzar C major)
  const allMelodicNotesFlat = parsedMelodicTracks.flatMap((t) => t.notes);
  const { key, scale } = resolveMidiKeyAndScale(
    chordBlocks,
    allMelodicNotesFlat,
    midi.header.keySignatures || []
  );

  // 8. Construir pistas de Piano Roll + canales adaptados en el Mixer
  const tracksForPianoRoll = hasExplicitChordsTrack
    ? parsedMelodicTracks.filter((_, idx) => idx !== explicitChordsIdx)
    : parsedMelodicTracks;

  const channels: Record<string, ChannelConfig> = {
    master: { ...DEFAULT_CHANNELS.master },
    chords: { ...DEFAULT_CHANNELS.chords },
    melody: { ...DEFAULT_CHANNELS.melody },
    drums: { ...DEFAULT_CHANNELS.drums }
  };

  // Si todas las notas originales se conservan fielmente en pistas de Piano Roll (no hubo pista explícita de Chords),
  // mutear el canal sintético de Acordes por defecto para que suene 100% fiel al MIDI sin duplicaciones ni choques,
  // manteniendo los bloques armónicos listos en el timeline para editar o desmutear en 1 clic.
  const chordsMutedForFidelity = !hasExplicitChordsTrack && tracksForPianoRoll.length > 0;

  if (hasExplicitChordsTrack) {
    const chordsMeta = parsedMelodicTracks[explicitChordsIdx];
    const chordsInstr = resolvePhosphorInstrument(
      chordsMeta.rawName,
      chordsMeta.gmProgram,
      chordsMeta.gmFamily,
      chordsMeta.avgMidi
    );
    channels.chords = {
      ...channels.chords,
      volume: chordsMeta.volume,
      pan: chordsMeta.pan,
      muted: false,
      instrument: chordsInstr.instrument,
      synthSettings: chordsInstr.synthSettings
    };
  } else {
    // Alinear el timbre del canal Acordes con el carácter del MIDI (piano si predominan pistas de piano)
    const mostlyPiano =
      tracksForPianoRoll.length > 0 &&
      tracksForPianoRoll.every((t) => {
        const resolved = resolvePhosphorInstrument(t.rawName, t.gmProgram, t.gmFamily, t.avgMidi);
        return resolved.instrument === 'piano';
      });
    channels.chords = {
      ...channels.chords,
      muted: chordsMutedForFidelity,
      instrument: mostlyPiano ? 'piano' : 'synth',
      synthSettings: mostlyPiano ? undefined : getPresetSettingsById('warm_pad')
    };
  }

  const pianoRollTracks: PianoRollTrack[] = tracksForPianoRoll.map((t, idx) => {
    const channelId = idx === 0 ? 'melody' : `ch_midi_${idx + 1}`;
    const color = TRACK_COLORS[idx % TRACK_COLORS.length];
    const resolved = resolvePhosphorInstrument(t.rawName, t.gmProgram, t.gmFamily, t.avgMidi);

    const melodyNotes: MelodyNote[] = t.notes.map((n, nIdx) => ({
      id: `mn_${idx}_${nIdx}_${Math.random().toString(36).slice(2, 6)}`,
      note: midiToNote(n.midi),
      midi: n.midi,
      startBeat: n.startBeat,
      durationBeats: n.durationBeats,
      velocity: n.velocity
    }));

    channels[channelId] = {
      id: channelId,
      name: t.displayName,
      type: resolved.channelType,
      instrument: resolved.instrument,
      volume: t.volume,
      pan: t.pan,
      muted: false,
      solo: false,
      color,
      synthSettings: resolved.synthSettings
    };

    const centeredScrollTop = Math.max(0, Math.min(1100, (96 - t.medianMidi - 8) * 20));

    return {
      id: idx === 0 ? 'track_melody_1' : `track_midi_${idx + 1}`,
      name: t.displayName,
      color,
      channelId,
      notes: melodyNotes,
      synthSettings: resolved.synthSettings,
      viewport: {
        scrollLeft: 0,
        scrollTop: centeredScrollTop,
        beatWidth: 40,
        rowHeight: 20
      }
    };
  });

  // 9. Importar pistas de Percusión GM (Canal 10) si existen
  const importedDrums = importDrumTracksFromMidi(percussionTracks, ppq, bpm, beatsPerMeasure);
  if (importedDrums) {
    channels.drums = {
      ...channels.drums,
      volume: importedDrums.volume,
      pan: importedDrums.pan
    };
  }

  const primaryMelodyNotes = pianoRollTracks.length > 0 ? pianoRollTracks[0].notes : [];
  const totalNotesImported = pianoRollTracks.reduce((acc, tr) => acc + tr.notes.length, 0);

  return {
    success: true,
    isProject: false,
    bpm,
    tempoMarkers,
    key,
    scale,
    pattern,
    timeSignature,
    chordBlocks,
    tracks: pianoRollTracks.length > 0 ? pianoRollTracks : undefined,
    melodyNotes: primaryMelodyNotes,
    channels,
    ...(importedDrums && {
      drumChannels: importedDrums.drumChannels,
      patternChain: importedDrums.patternChain,
      patternLengths: importedDrums.patternLengths,
      isPatternRepeatOn: importedDrums.isPatternRepeatOn
    }),
    summary: {
      tracksCount: pianoRollTracks.length,
      notesCount: totalNotesImported,
      chordsCount: chordBlocks.length,
      drumPatternsCount: importedDrums?.uniquePatternCount ?? 0,
      chordsMutedForFidelity
    },
    message: `MIDI importado: ${key} ${scale} · ${bpm} BPM · ${pianoRollTracks.length} pista(s) · ${chordBlocks.length} acordes.`
  };
}
