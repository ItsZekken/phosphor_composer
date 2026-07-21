/**
 * Tipos para el sistema de patrones rítmicos extraídos de MIDI.
 * Los patrones se normalizan respecto a la raíz del acorde activo,
 * por lo que son independientes de la tonalidad.
 */

export interface PatternNote {
  /** Offset en beats desde el inicio del ciclo del patrón */
  beatOffset: number;
  /** Duración en beats */
  durationBeats: number;
  /**
   * Intervalo en semitonos desde la tónica del acorde (0–11).
   * 0 = tónica, 4 = 3ª M, 7 = 5ª justa, etc.
   */
  semitoneFromRoot: number;
  /**
   * Desplazamiento de octava relativo a la octava de referencia del rol.
   * Bajo: ref = octava 2. Acorde: ref = octava 3.
   */
  octaveOffset: number;
  /** Velocidad normalizada 0..1 */
  velocity: number;
  /** Origen: línea de bajo o voicings de acorde */
  voice: 'bass' | 'chord';
}

export interface PatternDef {
  /** Nombre legible del patrón, ej. "Bossa Nova 1" */
  name: string;
  /** Duración total del ciclo en beats (16 = 4 compases de 4/4) */
  totalBeats: number;
  /** BPM del MIDI original */
  bpm: number;
  /** Si el patrón tiene línea de bajo */
  hasBass: boolean;
  /** Si el patrón tiene voicings de acorde */
  hasChords: boolean;
  /** Todas las notas normalizadas */
  notes: PatternNote[];
}
