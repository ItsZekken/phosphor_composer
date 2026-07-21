/**
 * processPatterns.mjs
 *
 * Script de Node.js para parsear todos los MIDI en public/patterns/
 * y generar public/patterns.json con los PatternDef normalizados.
 *
 * Uso: node scripts/processPatterns.mjs
 *
 * La progresión de referencia de onemotion.com es C-Em7-Am-F,
 * cada acorde ocupa exactamente 4 beats (16 beats totales por ciclo).
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PATTERNS_DIR = path.join(__dirname, '..', 'public', 'patterns');
const OUTPUT_FILE = path.join(__dirname, '..', 'public', 'patterns.json');

// ─── Progresión de referencia ──────────────────────────────────────────────

// Cada acorde ocupa 4 beats. Estos son los MIDI roots en la progresión.
const REFERENCE_CHORDS = [
  { startBeat: 0,  rootMidi: 60, bassRootMidi: 36 },  // C  (C4 / C2)
  { startBeat: 4,  rootMidi: 64, bassRootMidi: 40 },  // Em7 (E4 / E2)
  { startBeat: 8,  rootMidi: 69, bassRootMidi: 45 },  // Am  (A4 / A2) — A3=57 en algunos MIDIs
  { startBeat: 12, rootMidi: 65, bassRootMidi: 41 },  // F   (F4 / F2)
];
const TOTAL_BEATS = 4;

// ─── Parser MIDI (puro, sin dependencias) ─────────────────────────────────

function readVarLen(buf, pos) {
  let val = 0;
  while (true) {
    const b = buf[pos++];
    val = (val << 7) | (b & 0x7f);
    if (!(b & 0x80)) break;
  }
  return { val, pos };
}

function parseMidi(buf) {
  // Header
  const tpq = buf.readUInt16BE(12);
  let pos = 14;

  const trackMagic = buf.slice(pos, pos + 4).toString('ascii');
  if (trackMagic !== 'MTrk') throw new Error('No es un fichero MIDI válido');
  const trackLen = buf.readUInt32BE(pos + 4);
  pos += 8;
  const end = pos + trackLen;

  let absoluteTick = 0;
  let tempo = 500000; // microsegundos/beat — default 120 BPM
  const events = [];

  while (pos < end) {
    const dt = readVarLen(buf, pos); pos = dt.pos;
    absoluteTick += dt.val;
    const status = buf[pos++];

    if (status === 0xff) {
      // Meta event
      const type = buf[pos++];
      const lenR = readVarLen(buf, pos); pos = lenR.pos;
      if (type === 0x51 && lenR.val === 3) {
        tempo = (buf[pos] << 16) | (buf[pos + 1] << 8) | buf[pos + 2];
      }
      pos += lenR.val;
    } else if ((status & 0xf0) === 0x90) {
      const note = buf[pos++];
      const vel = buf[pos++];
      events.push({ tick: absoluteTick, type: vel > 0 ? 'on' : 'off', note, vel });
    } else if ((status & 0xf0) === 0x80) {
      const note = buf[pos++];
      const vel = buf[pos++];
      events.push({ tick: absoluteTick, type: 'off', note, vel });
    } else if ((status & 0xf0) === 0xb0 || (status & 0xf0) === 0xa0 ||
               (status & 0xf0) === 0xe0 || (status & 0xf0) === 0xc0 ||
               (status & 0xf0) === 0xd0) {
      // Canal con 1 o 2 bytes de datos
      if ((status & 0xf0) === 0xc0 || (status & 0xf0) === 0xd0) pos++;
      else pos += 2;
    }
  }

  return { tpq, bpm: Math.round(60_000_000 / tempo), events };
}

// ─── Normalización ────────────────────────────────────────────────────────

function getChordAtBeat(beat) {
  // El patrón se repite cíclicamente
  const beatInCycle = beat % TOTAL_BEATS;
  for (let i = REFERENCE_CHORDS.length - 1; i >= 0; i--) {
    if (beatInCycle >= REFERENCE_CHORDS[i].startBeat) return REFERENCE_CHORDS[i];
  }
  return REFERENCE_CHORDS[0];
}

function normalizeSemitone(s) {
  return ((s % 12) + 12) % 12;
}

function extractNotes(events, tpq, voice) {
  const noteOns = {};
  const patternNotes = [];

  for (const evt of events) {
    const beat = evt.tick / tpq;

    if (evt.type === 'on') {
      noteOns[evt.note] = { beat, vel: evt.vel / 127 };
    } else if (evt.type === 'off' && noteOns[evt.note]) {
      const on = noteOns[evt.note];
      delete noteOns[evt.note];

      const durationBeats = beat - on.beat;
      if (durationBeats < 0.01) continue; // ignorar notas fantasma

      // Quedarse únicamente con las notas del primer compás (de 0 a 4 beats)
      // para extraer el patrón rítmico puro de 1 compás (4 beats) en C major.
      if (on.beat >= 4.0) continue;

      const beatOffset = on.beat; // al ser < 4.0, ya es el offset relativo al compás
      const chord = REFERENCE_CHORDS[0]; // C Major siempre es el primer acorde

      // Raíz de referencia según el rol (bajo vs acorde)
      const refRoot = voice === 'bass' ? chord.bassRootMidi : chord.rootMidi;
      const semitoneFromRoot = normalizeSemitone(evt.note - refRoot);
      // Octava relativa: (midi - refRoot - semitoneFromRoot) / 12 redondeado
      const octaveOffset = Math.round((evt.note - refRoot - semitoneFromRoot) / 12) + 1;

      patternNotes.push({
        beatOffset: Math.round(beatOffset * 100) / 100,
        durationBeats: Math.round(durationBeats * 100) / 100,
        semitoneFromRoot,
        octaveOffset,
        velocity: Math.round(on.vel * 100) / 100,
        voice,
      });
    }
  }

  return patternNotes;
}

// ─── Carga de existentes para caché ──────────────────────────────────────

let existingPatterns = [];
if (fs.existsSync(OUTPUT_FILE)) {
  try {
    existingPatterns = JSON.parse(fs.readFileSync(OUTPUT_FILE, 'utf8'));
  } catch (_) {}
}
const existingMap = Object.fromEntries(existingPatterns.map(p => [p.name, p]));

// ─── Encontrar y agrupar archivos MIDI ───────────────────────────────────

const files = fs.readdirSync(PATTERNS_DIR).filter(f => f.endsWith('.mid'));

const groups = {};
for (const file of files) {
  const bassMatch = file.match(/^(.+) \[Bass\]\.mid$/);
  const chordsMatch = file.match(/^(.+) \[Chords\]\.mid$/);
  const name = bassMatch?.[1] ?? chordsMatch?.[1];
  if (!name) continue;
  if (!groups[name]) groups[name] = {};
  if (bassMatch) groups[name].bass = file;
  if (chordsMatch) groups[name].chords = file;
}

// ─── Procesar cada grupo ──────────────────────────────────────────────────

const results = [];
let processed = 0, cached = 0;

for (const [name, group] of Object.entries(groups)) {
  // Calcular mtime más reciente del par
  const mtimes = [];
  if (group.bass) mtimes.push(fs.statSync(path.join(PATTERNS_DIR, group.bass)).mtimeMs);
  if (group.chords) mtimes.push(fs.statSync(path.join(PATTERNS_DIR, group.chords)).mtimeMs);
  const latestMtime = Math.max(...mtimes);

  // Usar caché si existe y el JSON es más reciente que los MIDIs
  if (existingMap[name]) {
    const jsonMtime = fs.statSync(OUTPUT_FILE).mtimeMs;
    if (jsonMtime >= latestMtime) {
      results.push(existingMap[name]);
      cached++;
      continue;
    }
  }

  // Parsear Bass
  let bassNotes = [];
  let bpm = 120;
  if (group.bass) {
    const buf = fs.readFileSync(path.join(PATTERNS_DIR, group.bass));
    const midi = parseMidi(buf);
    bpm = midi.bpm;
    bassNotes = extractNotes(midi.events, midi.tpq, 'bass');
  }

  // Parsear Chords
  let chordNotes = [];
  if (group.chords) {
    const buf = fs.readFileSync(path.join(PATTERNS_DIR, group.chords));
    const midi = parseMidi(buf);
    if (!group.bass) bpm = midi.bpm; // usar BPM de Chords si no hay Bass
    chordNotes = extractNotes(midi.events, midi.tpq, 'chord');
  }

  const allNotes = [...bassNotes, ...chordNotes].sort((a, b) => a.beatOffset - b.beatOffset);

  results.push({
    name,
    totalBeats: TOTAL_BEATS,
    bpm,
    hasBass: !!group.bass,
    hasChords: !!group.chords,
    notes: allNotes,
  });
  processed++;
  console.log(`  ✓ ${name} (bajo: ${bassNotes.length} notas, acordes: ${chordNotes.length} notas)`);
}

// ─── Escribir JSON ────────────────────────────────────────────────────────

fs.writeFileSync(OUTPUT_FILE, JSON.stringify(results, null, 2), 'utf8');
console.log(`\n✅ patterns.json generado: ${processed} nuevos, ${cached} en caché, ${results.length} total.`);
