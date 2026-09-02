/**
 * processPatterns.mjs
 *
 * Script de Node.js para parsear todos los MIDI en public/patterns/
 * y generar public/patterns.json con los PatternDef normalizados.
 *
 * Uso: node scripts/processPatterns.mjs
 *
 * La progresión de referencia de onemotion.com es C-Em7-Am-F,
 * cada compás de 4/4 ocupa 4 beats (o 3 beats en estilos Waltz 3/4).
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PATTERNS_DIR = path.join(__dirname, '..', 'public', 'patterns');
const OUTPUT_FILE = path.join(__dirname, '..', 'public', 'patterns.json');

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
    } else if ((status & 0xf0) >= 0x80 && (status & 0xf0) <= 0xe0) {
      if ((status & 0xf0) === 0xc0 || (status & 0xf0) === 0xd0) pos++;
      else pos += 2;
    }
  }

  return { tpq, bpm: Math.round(60_000_000 / tempo), events };
}

// ─── Normalización ────────────────────────────────────────────────────────

function normalizeSemitone(s) {
  return ((s % 12) + 12) % 12;
}

function extractNotes(events, tpq, voice, totalBeats = 4) {
  const noteOns = {};
  const patternNotes = [];

  for (const evt of events) {
    const beat = evt.tick / tpq;

    if (evt.type === 'on') {
      noteOns[evt.note] = { beat, vel: evt.vel / 127 };
    } else if (evt.type === 'off' && noteOns[evt.note]) {
      const on = noteOns[evt.note];
      delete noteOns[evt.note];

      const rawDuration = beat - on.beat;
      if (rawDuration < 0.01) continue; // ignorar notas fantasma

      // Quedarse únicamente con las notas que inician en el primer compás [0, totalBeats)
      if (on.beat >= totalBeats - 0.02) continue;

      const beatOffset = Math.round(on.beat * 100) / 100;
      
      // Preservar la duración musical sin cortes artificiales en la barra de compás
      let durationBeats = Math.round(rawDuration * 100) / 100;
      // Si la nota finaliza casi exactamente al final del compás (ej. 3.96/3.97), extenderla a la frontera exacta para legato perfecto
      if (Math.abs((beatOffset + durationBeats) - totalBeats) < 0.08) {
        durationBeats = Math.round((totalBeats - beatOffset) * 100) / 100;
      }
      durationBeats = Math.max(0.1, durationBeats);

      // Raíz de referencia según el rol (C1=24 para bajo transpuerto, C3=48 para acordes transpuestos)
      const refRoot = voice === 'bass' ? 24 : 48;
      const semitoneFromRoot = normalizeSemitone(evt.note - refRoot);
      const octaveOffset = Math.round((evt.note - refRoot - semitoneFromRoot) / 12);

      patternNotes.push({
        beatOffset,
        durationBeats,
        semitoneFromRoot,
        octaveOffset,
        velocity: Math.round(on.vel * 100) / 100,
        voice,
      });
    }
  }

  return patternNotes;
}

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
let processed = 0;

for (const [name, group] of Object.entries(groups)) {
  const is34Time = name.toLowerCase().includes('waltz') || name.toLowerCase().includes('polyrhythm');
  const totalBeats = is34Time ? 3 : 4;

  // Parsear Bass
  let bassNotes = [];
  let bpm = 120;
  if (group.bass) {
    const buf = fs.readFileSync(path.join(PATTERNS_DIR, group.bass));
    const midi = parseMidi(buf);
    bpm = midi.bpm;
    bassNotes = extractNotes(midi.events, midi.tpq, 'bass', totalBeats);
  }

  // Parsear Chords
  let chordNotes = [];
  if (group.chords) {
    const buf = fs.readFileSync(path.join(PATTERNS_DIR, group.chords));
    const midi = parseMidi(buf);
    if (!group.bass) bpm = midi.bpm;
    chordNotes = extractNotes(midi.events, midi.tpq, 'chord', totalBeats);
  }

  const allNotes = [...bassNotes, ...chordNotes].sort((a, b) => a.beatOffset - b.beatOffset);

  results.push({
    name,
    totalBeats,
    bpm,
    hasBass: !!group.bass,
    hasChords: !!group.chords,
    notes: allNotes,
  });
  processed++;
  console.log(`  ✓ ${name} (compás: ${totalBeats} beats, bajo: ${bassNotes.length} notas, acordes: ${chordNotes.length} notas)`);
}

// ─── Escribir JSON ────────────────────────────────────────────────────────

fs.writeFileSync(OUTPUT_FILE, JSON.stringify(results, null, 2), 'utf8');
console.log(`\n✅ patterns.json generado con legato perfecto y 1 octava abajo: ${processed} patrones procesados.`);
