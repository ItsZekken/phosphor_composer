/**
 * melodyGenerator.ts
 * Generador melódico algorítmico musicalmente coherente y expresivo.
 * Reemplaza completamente a Magenta.js con algoritmos de teoría de contorno, notas guía y patrones rítmicos vivos.
 */

import type { ChordBlock, GhostNote, ScaleType } from '../../utils/typeDefinitions';
import type { NoteClass } from './pitchClass';
import { midiToNoteName, noteNameToMidi } from './pitchClass';
import { getChordNotes } from './chordParser';
import { getScaleNotes } from './scaleDefinitions';
import { generateId } from '../../utils/idGenerator';

export type MelodyStyle = 'catchy' | 'lyrical' | 'arpeggiated' | 'bluesy';

export interface MelodyGeneratorOptions {
  key: NoteClass | string;
  scale: ScaleType;
  chordBlocks: ChordBlock[];
  totalBeats?: number;
  style?: MelodyStyle;
  targetOctave?: number; // Por defecto 4 (C4-C5)
  density?: number; // 0.1 a 1.0 (densidad de notas)
}

// Plantillas de patrones rítmicos por compás (4 beats)
const RHYTHMIC_TEMPLATES: Record<MelodyStyle, Array<Array<{ offset: number; duration: number; isDownbeat: boolean }>>> = {
  catchy: [
    // Patrón Pop Sincopado 1 (Negra con puntillo + corchea ligada + corcheas)
    [
      { offset: 0.0, duration: 1.0, isDownbeat: true },
      { offset: 1.0, duration: 0.5, isDownbeat: false },
      { offset: 1.5, duration: 1.0, isDownbeat: false }, // Síncopa
      { offset: 3.0, duration: 0.5, isDownbeat: false },
      { offset: 3.5, duration: 0.5, isDownbeat: false }
    ],
    // Patrón Pop Motívico 2 (Corcheas bailable con silencio en beat 3)
    [
      { offset: 0.0, duration: 0.5, isDownbeat: true },
      { offset: 0.5, duration: 0.5, isDownbeat: false },
      { offset: 1.0, duration: 1.0, isDownbeat: true },
      { offset: 2.5, duration: 0.5, isDownbeat: false },
      { offset: 3.0, duration: 1.0, isDownbeat: true }
    ],
    // Patrón Hook 3 (Anticipación en contratiempo)
    [
      { offset: 0.0, duration: 1.5, isDownbeat: true },
      { offset: 1.5, duration: 0.5, isDownbeat: false },
      { offset: 2.0, duration: 0.75, isDownbeat: true },
      { offset: 2.75, duration: 0.75, isDownbeat: false },
      { offset: 3.5, duration: 0.5, isDownbeat: false }
    ]
  ],
  lyrical: [
    // Frase lírica con notas largas y apoyaturas
    [
      { offset: 0.0, duration: 1.5, isDownbeat: true },
      { offset: 1.5, duration: 0.5, isDownbeat: false },
      { offset: 2.0, duration: 2.0, isDownbeat: true }
    ],
    // Frase suave con paso en tiempo 2
    [
      { offset: 0.0, duration: 2.0, isDownbeat: true },
      { offset: 2.0, duration: 1.0, isDownbeat: true },
      { offset: 3.0, duration: 1.0, isDownbeat: false }
    ],
    // Frase con entrada en anacrusa
    [
      { offset: 0.5, duration: 1.0, isDownbeat: false },
      { offset: 1.5, duration: 0.5, isDownbeat: false },
      { offset: 2.0, duration: 1.5, isDownbeat: true }
    ]
  ],
  arpeggiated: [
    // Fluidez continua de corcheas
    [
      { offset: 0.0, duration: 0.5, isDownbeat: true },
      { offset: 0.5, duration: 0.5, isDownbeat: false },
      { offset: 1.0, duration: 0.5, isDownbeat: true },
      { offset: 1.5, duration: 0.5, isDownbeat: false },
      { offset: 2.0, duration: 0.5, isDownbeat: true },
      { offset: 2.5, duration: 0.5, isDownbeat: false },
      { offset: 3.0, duration: 1.0, isDownbeat: true }
    ],
    // Arpegio con saltos y reposo
    [
      { offset: 0.0, duration: 0.5, isDownbeat: true },
      { offset: 0.5, duration: 0.5, isDownbeat: false },
      { offset: 1.0, duration: 1.0, isDownbeat: true },
      { offset: 2.0, duration: 0.5, isDownbeat: true },
      { offset: 2.5, duration: 0.5, isDownbeat: false },
      { offset: 3.0, duration: 0.5, isDownbeat: false },
      { offset: 3.5, duration: 0.5, isDownbeat: false }
    ]
  ],
  bluesy: [
    // Patrón swing con silencios
    [
      { offset: 0.0, duration: 0.75, isDownbeat: true },
      { offset: 0.75, duration: 0.75, isDownbeat: false },
      { offset: 1.5, duration: 1.5, isDownbeat: true },
      { offset: 3.25, duration: 0.75, isDownbeat: false }
    ],
    [
      { offset: 0.5, duration: 0.5, isDownbeat: false },
      { offset: 1.0, duration: 1.0, isDownbeat: true },
      { offset: 2.25, duration: 0.75, isDownbeat: false },
      { offset: 3.0, duration: 1.0, isDownbeat: true }
    ]
  ]
};

/**
 * Genera una línea melódica coherente basada en la armonía activa, tonalidad y estilo.
 */
export function generateMelody(options: MelodyGeneratorOptions): GhostNote[] {
  const {
    key,
    scale,
    chordBlocks = [],
    totalBeats = 16,
    style = 'catchy',
    targetOctave = 4,
    density = 0.85
  } = options;

  if (totalBeats <= 0) return [];

  // 1. Obtener notas de la escala en el registro objetivo (ej: octavas 4 y 5)
  const baseScaleNotes = getScaleNotes(key, scale);
  const scaleMidis: number[] = [];
  [targetOctave, targetOctave + 1].forEach((oct) => {
    baseScaleNotes.forEach((n) => {
      scaleMidis.push(noteNameToMidi(`${n}${oct}`));
    });
  });
  scaleMidis.sort((a, b) => a - b);

  // 2. Construir mapa de acordes por compás
  const getChordAtBeat = (beat: number): ChordBlock | null => {
    return chordBlocks.find((b) => beat >= b.startBeat && beat < b.startBeat + b.durationBeats) || null;
  };

  const ghostNotes: GhostNote[] = [];
  const numMeasures = Math.ceil(totalBeats / 4);
  const styleTemplates = RHYTHMIC_TEMPLATES[style] || RHYTHMIC_TEMPLATES.catchy;

  let lastMidi = scaleMidis[Math.floor(scaleMidis.length / 2)] || 60;

  for (let m = 0; m < numMeasures; m++) {
    const measureStartBeat = m * 4;
    if (measureStartBeat >= totalBeats) break;

    // Seleccionar plantilla rítmica (manteniendo coherencia motívica en compases alternados)
    const templateIndex = m % 2 === 0 ? m % styleTemplates.length : (m - 1) % styleTemplates.length;
    const template = styleTemplates[templateIndex % styleTemplates.length];

    for (const item of template) {
      const noteStartBeat = measureStartBeat + item.offset;
      if (noteStartBeat >= totalBeats) break;

      // Aplicar filtro de densidad probabilística
      if (Math.random() > density && !item.isDownbeat) {
        continue;
      }

      const activeChord = getChordAtBeat(noteStartBeat);
      let chordMidis: number[] = [];

      if (activeChord) {
        try {
          const cNotes = getChordNotes(activeChord.chord, targetOctave);
          chordMidis = cNotes.map((n) => noteNameToMidi(n));
          // Agregar notas de la octava superior para rango expresivo
          cNotes.forEach((n) => chordMidis.push(noteNameToMidi(n) + 12));
        } catch (_) {}
      }

      let chosenMidi: number;

      if (item.isDownbeat && chordMidis.length > 0) {
        // En tiempos fuertes: seleccionar notas del acorde cercanas a la nota anterior
        const sortedByDistance = [...chordMidis].sort(
          (a, b) => Math.abs(a - lastMidi) - Math.abs(b - lastMidi)
        );
        // Escoger entre las 2 notas más cercanas para suavidad de conducción de voces
        const candidatePool = sortedByDistance.slice(0, 2);
        chosenMidi = candidatePool[Math.floor(Math.random() * candidatePool.length)];
      } else {
        // En tiempos débiles: notas de paso diatónicas por grado conjunto (+-1 o +-2 grados de escala)
        const currentScaleIndex = scaleMidis.findIndex((m) => Math.abs(m - lastMidi) <= 1);
        const validIndex = currentScaleIndex !== -1 ? currentScaleIndex : Math.floor(scaleMidis.length / 2);

        // Movimiento por grado conjunto (-2, -1, +1, +2 posiciones en escala)
        const possibleOffsets = [-2, -1, 1, 2];
        const step = possibleOffsets[Math.floor(Math.random() * possibleOffsets.length)];
        const nextIndex = Math.max(0, Math.min(scaleMidis.length - 1, validIndex + step));
        chosenMidi = scaleMidis[nextIndex];
      }

      // Restricción de rango confortable (C4 a A5: MIDI 60 a 81)
      chosenMidi = Math.max(60, Math.min(81, chosenMidi));
      lastMidi = chosenMidi;

      const duration = Math.min(item.duration, totalBeats - noteStartBeat);
      if (duration <= 0) continue;

      ghostNotes.push({
        id: generateId('gn'),
        note: midiToNoteName(chosenMidi),
        midi: chosenMidi,
        startBeat: noteStartBeat,
        durationBeats: duration
      });
    }
  }

  return ghostNotes;
}
