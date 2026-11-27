/**
 * melodyRegionUtils.ts
 * Motor determinista 1:1 entre el Piano Roll (track.notes) y las pistas dedicadas de Melodía en Tracks.
 *
 * INVARIANTE FUNDAMENTAL (Single Source of Truth):
 * - `PianoRollTrack.notes` es SIEMPRE la única fuente de verdad para audio, Piano Roll, Stage y MIDI.
 * - `PianoRollTrack.regions` son únicamente ventanas/límites visuales no superpuestos sobre `track.notes`.
 * - Cualquier operación en Tracks (mover, cortar, recortar, repetir/estirar, copiar/pegar, silenciar, borrar)
 *   muta directamente `track.notes` de forma determinista y reversible (100% simétrica con el Piano Roll).
 */

import type {
  MelodyNote,
  MelodyRegion,
  MelodyRegionClipboardItem,
  PianoRollTrack,
  SelectedMelodyRegionRef
} from '../../utils/typeDefinitions';
import { generateId } from '../../utils/idGenerator';

const EPS = 1e-4;
const MIN_NOTE_DURATION = 0.04;
const MIN_REGION_DURATION = 0.25;

export function roundBeat(value: number): number {
  return Math.round(value * 10000) / 10000;
}

export function isNoteInRegion(
  note: Pick<MelodyNote, 'startBeat'>,
  region: Pick<MelodyRegion, 'startBeat' | 'durationBeats'>
): boolean {
  const start = region.startBeat;
  const end = region.startBeat + region.durationBeats;
  return note.startBeat >= start - EPS && note.startBeat < end - EPS;
}

export function getNotesInRegion(
  notes: MelodyNote[] | undefined,
  region: Pick<MelodyRegion, 'startBeat' | 'durationBeats'>
): MelodyNote[] {
  if (!notes || notes.length === 0) return [];
  const res: MelodyNote[] = [];
  for (let i = 0; i < notes.length; i++) {
    if (isNoteInRegion(notes[i], region)) {
      res.push(notes[i]);
    }
  }
  return res;
}

/**
 * Extrae las notas pertenecientes a una región normalizadas al origen local (0..durationBeats)
 * y recortadas limpiamente al borde derecho de la región.
 */
export function getLocalNormalizedRegionNotes(
  notes: MelodyNote[] | undefined,
  region: Pick<MelodyRegion, 'startBeat' | 'durationBeats'>
): MelodyNote[] {
  if (!notes || notes.length === 0) return [];
  const start = region.startBeat;
  const end = start + region.durationBeats;
  const res: MelodyNote[] = [];

  for (let i = 0; i < notes.length; i++) {
    const n = notes[i];
    if (n.startBeat < start - EPS || n.startBeat >= end - EPS) continue;
    const localStart = Math.max(0, roundBeat(n.startBeat - start));
    const maxDur = Math.max(MIN_NOTE_DURATION, roundBeat(region.durationBeats - localStart));
    const clippedDur = Math.max(MIN_NOTE_DURATION, Math.min(n.durationBeats, maxDur));
    res.push({
      ...n,
      startBeat: localStart,
      durationBeats: roundBeat(clippedDur)
    });
  }
  return res;
}

/**
 * Recorta/extrae el rango [cutStart, cutEnd) de un arreglo de notas sin dejar residuos.
 */
export function punchOutNoteRange(
  notes: MelodyNote[],
  cutStart: number,
  cutEnd: number
): MelodyNote[] {
  if (cutEnd <= cutStart + EPS || notes.length === 0) return notes;
  const out: MelodyNote[] = [];

  for (let i = 0; i < notes.length; i++) {
    const n = notes[i];
    const nStart = n.startBeat;
    const nEnd = n.startBeat + n.durationBeats;

    // Completamente fuera del corte
    if (nEnd <= cutStart + EPS || nStart >= cutEnd - EPS) {
      out.push(n);
      continue;
    }

    // Completamente dentro del corte -> eliminar
    if (nStart >= cutStart - EPS && nEnd <= cutEnd + EPS) {
      continue;
    }

    // Empieza antes y termina dentro -> recortar cola derecha
    if (nStart < cutStart - EPS && nEnd <= cutEnd + EPS) {
      const leftDur = roundBeat(cutStart - nStart);
      if (leftDur >= MIN_NOTE_DURATION) {
        out.push({ ...n, durationBeats: leftDur });
      }
      continue;
    }

    // Empieza dentro y termina después -> recortar cabeza izquierda
    if (nStart >= cutStart - EPS && nEnd > cutEnd + EPS) {
      const rightDur = roundBeat(nEnd - cutEnd);
      if (rightDur >= MIN_NOTE_DURATION) {
        out.push({
          ...n,
          startBeat: roundBeat(cutEnd),
          durationBeats: rightDur
        });
      }
      continue;
    }

    // Atraviesa todo el rango [cutStart, cutEnd) -> dividir en izquierda y derecha
    const leftDur = roundBeat(cutStart - nStart);
    if (leftDur >= MIN_NOTE_DURATION) {
      out.push({ ...n, durationBeats: leftDur });
    }
    const rightDur = roundBeat(nEnd - cutEnd);
    if (rightDur >= MIN_NOTE_DURATION) {
      out.push({
        ...n,
        id: generateId('mn'),
        startBeat: roundBeat(cutEnd),
        durationBeats: rightDur
      });
    }
  }

  return out;
}

/**
 * Recorta/divide cualquier región existente que solape con [cutStart, cutEnd)
 * para mantener particiones estrictamente no superpuestas.
 */
export function punchOutRegionRange(
  regions: MelodyRegion[],
  cutStart: number,
  cutEnd: number,
  excludeIds?: Set<string>
): MelodyRegion[] {
  if (cutEnd <= cutStart + EPS || regions.length === 0) return regions;
  const out: MelodyRegion[] = [];

  for (let i = 0; i < regions.length; i++) {
    const r = regions[i];
    if (excludeIds?.has(r.id)) {
      out.push(r);
      continue;
    }

    const rStart = r.startBeat;
    const rEnd = r.startBeat + r.durationBeats;

    if (rEnd <= cutStart + EPS || rStart >= cutEnd - EPS) {
      out.push(r);
      continue;
    }

    if (rStart >= cutStart - EPS && rEnd <= cutEnd + EPS) {
      continue;
    }

    if (rStart < cutStart - EPS && rEnd <= cutEnd + EPS) {
      const leftDur = roundBeat(cutStart - rStart);
      if (leftDur >= MIN_REGION_DURATION - EPS) {
        out.push({
          ...r,
          durationBeats: leftDur,
          loopLengthBeats:
            r.loopLengthBeats && leftDur > r.loopLengthBeats + EPS ? r.loopLengthBeats : undefined
        });
      }
      continue;
    }

    if (rStart >= cutStart - EPS && rEnd > cutEnd + EPS) {
      const rightDur = roundBeat(rEnd - cutEnd);
      if (rightDur >= MIN_REGION_DURATION - EPS) {
        out.push({
          ...r,
          startBeat: roundBeat(cutEnd),
          durationBeats: rightDur,
          loopLengthBeats: undefined
        });
      }
      continue;
    }

    // Atraviesa todo el rango -> izquierda + derecha
    const leftDur = roundBeat(cutStart - rStart);
    if (leftDur >= MIN_REGION_DURATION - EPS) {
      out.push({
        ...r,
        durationBeats: leftDur,
        loopLengthBeats: undefined
      });
    }
    const rightDur = roundBeat(rEnd - cutEnd);
    if (rightDur >= MIN_REGION_DURATION - EPS) {
      out.push({
        id: generateId('mreg'),
        name: r.name,
        startBeat: roundBeat(cutEnd),
        durationBeats: rightDur
      });
    }
  }

  return out.sort((a, b) => a.startBeat - b.startBeat);
}

/**
 * Reconcilia de forma 100% determinista las regiones visuales de una pista con sus notas reales.
 * - Si no hay notas -> []
 * - Conserva límites explícitos (ej. cortes hechos con Slice) que contengan notas.
 * - Crea regiones automáticas alineadas a compases para cualquier nota dibujada en Piano Roll
 *   fuera de las regiones guardadas, sin superponerse nunca con regiones existentes.
 */
export function reconcileTrackRegions(
  trackId: string,
  notes: MelodyNote[] | undefined,
  storedRegions: MelodyRegion[] | undefined,
  beatsPerMeasure = 4
): MelodyRegion[] {
  const safeNotes = notes || [];
  if (safeNotes.length === 0) return [];

  const bar = Math.max(1, beatsPerMeasure || 4);

  // 1. Sanitizar y ordenar regiones guardadas sin solapamiento
  const sanitizedStored: MelodyRegion[] = [];
  if (Array.isArray(storedRegions) && storedRegions.length > 0) {
    const sorted = [...storedRegions]
      .filter(
        (r) =>
          r &&
          typeof r.startBeat === 'number' &&
          typeof r.durationBeats === 'number' &&
          !Number.isNaN(r.startBeat) &&
          !Number.isNaN(r.durationBeats) &&
          r.durationBeats >= 0.05
      )
      .sort((a, b) => a.startBeat - b.startBeat);

    for (let i = 0; i < sorted.length; i++) {
      const cur = sorted[i];
      const start = Math.max(0, roundBeat(cur.startBeat));
      let dur = Math.max(0.05, roundBeat(cur.durationBeats));
      if (sanitizedStored.length > 0) {
        const prev = sanitizedStored[sanitizedStored.length - 1];
        const prevEnd = roundBeat(prev.startBeat + prev.durationBeats);
        if (start < prevEnd - EPS) {
          const trimPrev = roundBeat(start - prev.startBeat);
          if (trimPrev >= 0.05) {
            prev.durationBeats = trimPrev;
          } else {
            sanitizedStored.pop();
          }
        }
      }
      sanitizedStored.push({
        id: cur.id || generateId('mreg'),
        ...(cur.name ? { name: cur.name } : {}),
        startBeat: start,
        durationBeats: dur,
        ...(typeof cur.loopLengthBeats === 'number' &&
        cur.loopLengthBeats >= MIN_REGION_DURATION - EPS &&
        dur > cur.loopLengthBeats + EPS
          ? { loopLengthBeats: roundBeat(cur.loopLengthBeats) }
          : {})
      });
    }
  }

  // 2. Filtrar regiones guardadas que realmente contengan notas y extender si una nota sobresale hacia espacio vacío
  const keptStored: MelodyRegion[] = [];
  for (let i = 0; i < sanitizedStored.length; i++) {
    const r = sanitizedStored[i];
    const rStart = r.startBeat;
    const rEnd = roundBeat(rStart + r.durationBeats);
    let hasNote = false;
    let maxNoteEnd = rEnd;

    for (let j = 0; j < safeNotes.length; j++) {
      const n = safeNotes[j];
      if (n.startBeat >= rStart - EPS && n.startBeat < rEnd - EPS) {
        hasNote = true;
        const nEnd = n.startBeat + n.durationBeats;
        if (nEnd > maxNoteEnd) maxNoteEnd = nEnd;
      }
    }

    if (!hasNote) continue;

    // Verificar si alguna nota se extendió desde Piano Roll más allá del borde derecho sin chocar con la siguiente región
    let nextDuration = r.durationBeats;
    if (maxNoteEnd > rEnd + EPS) {
      const nextStoredStart =
        i + 1 < sanitizedStored.length ? sanitizedStored[i + 1].startBeat : Infinity;
      const desiredEnd = Math.min(
        nextStoredStart,
        Math.max(rEnd, Math.ceil((maxNoteEnd - EPS) / bar) * bar)
      );
      if (desiredEnd > rEnd + EPS) {
        nextDuration = roundBeat(desiredEnd - rStart);
      }
    }

    keptStored.push({
      ...r,
      durationBeats: nextDuration
    });
  }

  // 3. Encontrar notas no cubiertas por ninguna región guardada
  const uncoveredSpans: Array<{ start: number; end: number }> = [];

  for (let i = 0; i < safeNotes.length; i++) {
    const n = safeNotes[i];
    let covered = false;
    for (let k = 0; k < keptStored.length; k++) {
      if (isNoteInRegion(n, keptStored[k])) {
        covered = true;
        break;
      }
    }
    if (covered) continue;

    const noteStart = Math.max(0, n.startBeat);
    const noteEnd = Math.max(noteStart + MIN_NOTE_DURATION, noteStart + n.durationBeats);

    let spanStart = Math.floor(noteStart / bar) * bar;
    let spanEnd = Math.max(spanStart + bar, Math.ceil((noteEnd - EPS) / bar) * bar);

    // Recortar el span automático contra cualquier región guardada para evitar solapamientos
    for (let k = 0; k < keptStored.length; k++) {
      const kr = keptStored[k];
      const krStart = kr.startBeat;
      const krEnd = roundBeat(kr.startBeat + kr.durationBeats);

      if (krEnd <= noteStart + EPS && krEnd > spanStart) {
        spanStart = krEnd;
      }
      if (krStart >= noteStart - EPS && krStart < spanEnd) {
        spanEnd = Math.max(noteEnd, krStart);
      }
    }

    if (spanEnd <= spanStart + EPS) {
      spanStart = roundBeat(noteStart);
      spanEnd = roundBeat(Math.max(noteStart + MIN_REGION_DURATION, noteEnd));
    }

    uncoveredSpans.push({ start: roundBeat(spanStart), end: roundBeat(spanEnd) });
  }

  if (uncoveredSpans.length === 0) {
    return keptStored;
  }

  // 4. Fusionar spans automáticos contiguos o solapados siempre que no haya una región guardada en medio
  uncoveredSpans.sort((a, b) => a.start - b.start);
  const mergedAuto: Array<{ start: number; end: number }> = [];

  const hasKeptBetween = (aEnd: number, bStart: number): boolean => {
    for (let k = 0; k < keptStored.length; k++) {
      const kr = keptStored[k];
      const krStart = kr.startBeat;
      const krEnd = roundBeat(kr.startBeat + kr.durationBeats);
      if (krEnd > aEnd - EPS && krStart < bStart + EPS) {
        return true;
      }
    }
    return false;
  };

  for (let i = 0; i < uncoveredSpans.length; i++) {
    const cur = uncoveredSpans[i];
    if (mergedAuto.length === 0) {
      mergedAuto.push({ ...cur });
      continue;
    }
    const prev = mergedAuto[mergedAuto.length - 1];
    if (cur.start <= prev.end + EPS && !hasKeptBetween(prev.end, cur.start)) {
      prev.end = Math.max(prev.end, cur.end);
    } else {
      mergedAuto.push({ ...cur });
    }
  }

  // 5. Combinar regiones guardadas + automáticas en orden cronológico
  const autoRegions: MelodyRegion[] = mergedAuto.map((sp) => {
    const dur = Math.max(MIN_REGION_DURATION, roundBeat(sp.end - sp.start));
    return {
      id: `auto_${trackId}_${sp.start}_${dur}`,
      startBeat: sp.start,
      durationBeats: dur
    };
  });

  return [...keptStored, ...autoRegions].sort((a, b) => a.startBeat - b.startBeat);
}

/**
 * Al editar notas directamente desde Piano Roll, elimina `loopLengthBeats` en las regiones
 * afectadas para que la frase editada pase a tratarse como frase única al volver a estirarse.
 */
export function invalidateRegionsAfterPianoRollEdit(
  trackId: string,
  prevNotes: MelodyNote[],
  nextNotes: MelodyNote[],
  storedRegions: MelodyRegion[] | undefined,
  beatsPerMeasure = 4
): MelodyRegion[] | undefined {
  if (!storedRegions || storedRegions.length === 0) return undefined;

  // Identificar si alguna región con loopLengthBeats cambió su conjunto de notas
  const nextRegions = storedRegions.map((r) => {
    if (!r.loopLengthBeats) return r;
    const prevSlice = getNotesInRegion(prevNotes, r);
    const nextSlice = getNotesInRegion(nextNotes, r);
    if (prevSlice.length !== nextSlice.length) {
      const { loopLengthBeats: _removed, ...rest } = r;
      return rest;
    }
    for (let i = 0; i < prevSlice.length; i++) {
      if (prevSlice[i] !== nextSlice[i]) {
        const { loopLengthBeats: _removed, ...rest } = r;
        return rest;
      }
    }
    return r;
  });

  return reconcileTrackRegions(trackId, nextNotes, nextRegions, beatsPerMeasure);
}

/**
 * Divide una región de melodía en `splitBeat`, dividiendo también limpiamente
 * cualquier nota que cruce `splitBeat` dentro de esa región (100% 1:1 con Piano Roll).
 */
export function splitRegionInTrack(
  track: PianoRollTrack,
  regionId: string,
  splitBeat: number,
  beatsPerMeasure = 4
): {
  notes: MelodyNote[];
  regions: MelodyRegion[];
  leftRegionId: string;
  rightRegionId: string | null;
} | null {
  const reconciled = reconcileTrackRegions(track.id, track.notes, track.regions, beatsPerMeasure);
  const target = reconciled.find((r) => r.id === regionId);
  if (!target) return null;

  const rStart = target.startBeat;
  const rEnd = roundBeat(target.startBeat + target.durationBeats);
  const cut = roundBeat(splitBeat);

  if (cut <= rStart + 0.06 || cut >= rEnd - 0.06) {
    return null;
  }

  // Dividir notas que atraviesan `cut` dentro de la región
  const nextNotes: MelodyNote[] = [];
  for (let i = 0; i < (track.notes || []).length; i++) {
    const n = track.notes[i];
    const nStart = n.startBeat;
    const nEnd = nStart + n.durationBeats;
    if (
      nStart >= rStart - EPS &&
      nStart < cut - EPS &&
      nEnd > cut + EPS
    ) {
      const leftDur = roundBeat(cut - nStart);
      const rightDur = roundBeat(nEnd - cut);
      if (leftDur >= MIN_NOTE_DURATION) {
        nextNotes.push({ ...n, durationBeats: leftDur });
      }
      if (rightDur >= MIN_NOTE_DURATION) {
        nextNotes.push({
          ...n,
          id: generateId('mn'),
          startBeat: cut,
          durationBeats: rightDur
        });
      }
    } else {
      nextNotes.push(n);
    }
  }

  const leftId = target.id.startsWith('auto_') ? generateId('mreg') : target.id;
  const rightId = generateId('mreg');
  const leftRegion: MelodyRegion = {
    id: leftId,
    ...(target.name ? { name: target.name } : {}),
    startBeat: rStart,
    durationBeats: roundBeat(cut - rStart)
  };
  const rightRegion: MelodyRegion = {
    id: rightId,
    ...(target.name ? { name: target.name } : {}),
    startBeat: cut,
    durationBeats: roundBeat(rEnd - cut)
  };

  const rawRegions = reconciled
    .filter((r) => r.id !== target.id)
    .concat(leftRegion, rightRegion)
    .sort((a, b) => a.startBeat - b.startBeat);

  const finalRegions = reconcileTrackRegions(track.id, nextNotes, rawRegions, beatsPerMeasure);
  const rightSurvived = finalRegions.some((r) => r.id === rightId);

  return {
    notes: nextNotes.sort((a, b) => a.startBeat - b.startBeat),
    regions: finalRegions,
    leftRegionId: leftId,
    rightRegionId: rightSurvived ? rightId : null
  };
}

export interface MelodyRegionResizeSnapshot {
  trackId: string;
  region: MelodyRegion;
  allNotes: MelodyNote[];
  allRegions: MelodyRegion[];
  outsideNotes: MelodyNote[];
  outsideRegions: MelodyRegion[];
  regionNotes: MelodyNote[];
  sourceTileNotes: MelodyNote[];
  sourceTileLen: number;
}

/**
 * Captura una instantánea inmutable antes de arrastrar el tirador izquierdo o derecho de una región,
 * garantizando previsualización fluida sin pérdida de notas si el usuario vuelve atrás antes de soltar.
 */
export function captureMelodyRegionResizeSnapshot(
  track: PianoRollTrack,
  regionId: string,
  beatsPerMeasure = 4
): MelodyRegionResizeSnapshot | null {
  const allRegions = reconcileTrackRegions(track.id, track.notes, track.regions, beatsPerMeasure);
  const region = allRegions.find((r) => r.id === regionId);
  if (!region) return null;

  const allNotes = track.notes || [];
  const regionNotes: MelodyNote[] = [];
  const outsideNotes: MelodyNote[] = [];

  for (let i = 0; i < allNotes.length; i++) {
    const n = allNotes[i];
    if (isNoteInRegion(n, region)) {
      regionNotes.push(n);
    } else {
      outsideNotes.push(n);
    }
  }

  const stableRegion: MelodyRegion = region.id.startsWith('auto_')
    ? { ...region, id: generateId('mreg') }
    : { ...region };

  const outsideRegions = allRegions.filter((r) => r.id !== region.id);
  const sourceTileLen = Math.max(
    MIN_REGION_DURATION,
    roundBeat(stableRegion.loopLengthBeats || stableRegion.durationBeats)
  );
  const sourceTileNotes = getLocalNormalizedRegionNotes(regionNotes, {
    startBeat: stableRegion.startBeat,
    durationBeats: sourceTileLen
  });

  return {
    trackId: track.id,
    region: stableRegion,
    allNotes,
    allRegions,
    outsideNotes,
    outsideRegions,
    regionNotes,
    sourceTileNotes,
    sourceTileLen
  };
}

/**
 * Aplica recorte derecho (si encoge) o repetición/bucle materializado (si estira)
 * sobre una instantánea de región. Todas las repeticiones se escriben como notas reales
 * en `track.notes` para simetría 1:1 con Piano Roll.
 */
export function applyRightResizeFromSnapshot(
  snapshot: MelodyRegionResizeSnapshot,
  targetDurationBeats: number,
  useFreshIds = false
): { notes: MelodyNote[]; regions: MelodyRegion[]; regionId: string } {
  const initialStart = snapshot.region.startBeat;
  const initialDur = snapshot.region.durationBeats;
  const targetDur = Math.max(MIN_REGION_DURATION, roundBeat(targetDurationBeats));
  const targetEnd = roundBeat(initialStart + targetDur);

  let nextRegionNotes: MelodyNote[] = [];
  let nextLoopLength: number | undefined;
  let nextOutsideNotes = snapshot.outsideNotes;
  let nextOutsideRegions = snapshot.outsideRegions;

  if (targetDur <= initialDur + EPS) {
    // Recorte derecho (shrink)
    for (let i = 0; i < snapshot.regionNotes.length; i++) {
      const n = snapshot.regionNotes[i];
      if (n.startBeat >= targetEnd - EPS) continue;
      const clippedDur = Math.min(n.durationBeats, roundBeat(targetEnd - n.startBeat));
      if (clippedDur >= MIN_NOTE_DURATION) {
        nextRegionNotes.push({
          ...n,
          durationBeats: roundBeat(clippedDur)
        });
      }
    }
    if (
      snapshot.region.loopLengthBeats &&
      targetDur > snapshot.region.loopLengthBeats + EPS
    ) {
      nextLoopLength = snapshot.region.loopLengthBeats;
    }
  } else {
    // Estirar hacia la derecha = repetir/tiling del motivo base directamente en notas reales
    const tileLen = snapshot.sourceTileLen;
    const tileNotes = snapshot.sourceTileNotes;
    const lastCycle = Math.floor((targetDur - EPS) / tileLen);

    for (let cycle = 0; cycle <= lastCycle; cycle++) {
      const cycleOffset = cycle * tileLen;
      for (let i = 0; i < tileNotes.length; i++) {
        const sn = tileNotes[i];
        const localStart = cycleOffset + sn.startBeat;
        if (localStart >= targetDur - EPS) continue;
        const remaining = targetDur - localStart;
        const dur = Math.min(sn.durationBeats, remaining);
        if (dur < MIN_NOTE_DURATION) continue;

        nextRegionNotes.push({
          ...sn,
          id:
            cycle === 0
              ? sn.id
              : useFreshIds
              ? generateId('mn')
              : `${sn.id}_r${cycle}`,
          startBeat: roundBeat(initialStart + localStart),
          durationBeats: roundBeat(dur)
        });
      }
    }

    nextLoopLength = tileLen;
    // Despejar cualquier nota/región cubierta al extender hacia la derecha
    nextOutsideNotes = punchOutNoteRange(snapshot.outsideNotes, initialStart, targetEnd);
    nextOutsideRegions = punchOutRegionRange(snapshot.outsideRegions, initialStart, targetEnd);
  }

  const nextRegion: MelodyRegion = {
    ...snapshot.region,
    durationBeats: targetDur,
    ...(nextLoopLength ? { loopLengthBeats: nextLoopLength } : { loopLengthBeats: undefined })
  };

  const mergedNotes = [...nextOutsideNotes, ...nextRegionNotes].sort(
    (a, b) => a.startBeat - b.startBeat
  );
  const mergedRegions =
    nextRegionNotes.length > 0
      ? [...nextOutsideRegions, nextRegion].sort((a, b) => a.startBeat - b.startBeat)
      : nextOutsideRegions;

  return {
    notes: mergedNotes,
    regions: mergedRegions,
    regionId: nextRegion.id
  };
}

/**
 * Aplica recorte izquierdo (hacia adentro) o extensión izquierda (para alinear al compás)
 * sobre una instantánea de región.
 */
export function applyLeftResizeFromSnapshot(
  snapshot: MelodyRegionResizeSnapshot,
  targetStartBeat: number
): { notes: MelodyNote[]; regions: MelodyRegion[]; regionId: string } {
  const initialStart = snapshot.region.startBeat;
  const initialEnd = roundBeat(initialStart + snapshot.region.durationBeats);
  const newStart = Math.max(0, Math.min(roundBeat(initialEnd - MIN_REGION_DURATION), roundBeat(targetStartBeat)));
  const newDur = Math.max(MIN_REGION_DURATION, roundBeat(initialEnd - newStart));

  let nextRegionNotes: MelodyNote[] = [];
  let nextOutsideNotes = snapshot.outsideNotes;
  let nextOutsideRegions = snapshot.outsideRegions;

  if (newStart >= initialStart - EPS) {
    // Recorte izquierdo hacia adentro: cortar notas anteriores a newStart
    for (let i = 0; i < snapshot.regionNotes.length; i++) {
      const n = snapshot.regionNotes[i];
      const nEnd = n.startBeat + n.durationBeats;
      if (nEnd <= newStart + MIN_NOTE_DURATION) continue;
      if (n.startBeat < newStart - EPS) {
        const trimmedDur = roundBeat(nEnd - newStart);
        if (trimmedDur >= MIN_NOTE_DURATION) {
          nextRegionNotes.push({
            ...n,
            startBeat: newStart,
            durationBeats: trimmedDur
          });
        }
      } else {
        nextRegionNotes.push(n);
      }
    }
  } else {
    // Extender borde izquierdo hacia atrás (útil para alinear anacrusa al inicio del compás)
    nextRegionNotes = snapshot.regionNotes;
    nextOutsideNotes = punchOutNoteRange(snapshot.outsideNotes, newStart, initialStart);
    nextOutsideRegions = punchOutRegionRange(snapshot.outsideRegions, newStart, initialStart);
  }

  const nextRegion: MelodyRegion = {
    ...snapshot.region,
    startBeat: newStart,
    durationBeats: newDur,
    loopLengthBeats: undefined
  };

  const mergedNotes = [...nextOutsideNotes, ...nextRegionNotes].sort(
    (a, b) => a.startBeat - b.startBeat
  );
  const mergedRegions =
    nextRegionNotes.length > 0
      ? [...nextOutsideRegions, nextRegion].sort((a, b) => a.startBeat - b.startBeat)
      : nextOutsideRegions;

  return {
    notes: mergedNotes,
    regions: mergedRegions,
    regionId: nextRegion.id
  };
}

/**
 * Mueve o clona (Shift+Drag) un grupo de regiones de melodía horizontal y/o verticalmente
 * entre pistas del Piano Roll, actualizando `track.notes` y `track.regions` 1:1.
 */
export function moveOrCloneMelodyRegions(
  tracks: PianoRollTrack[],
  selectedRefs: SelectedMelodyRegionRef[],
  deltaBeats: number,
  trackDelta: number,
  isClone: boolean,
  beatsPerMeasure = 4,
  useFreshIds = true
): { tracks: PianoRollTrack[]; nextSelectedRefs: SelectedMelodyRegionRef[] } {
  if (selectedRefs.length === 0 || tracks.length === 0) {
    return { tracks, nextSelectedRefs: selectedRefs };
  }

  const trackIndexMap = new Map(tracks.map((t, idx) => [t.id, idx]));
  const workingNotes = tracks.map((t) => [...(t.notes || [])]);
  const workingRegions = tracks.map((t) =>
    reconcileTrackRegions(t.id, t.notes, t.regions, beatsPerMeasure).map((r) => ({ ...r }))
  );

  interface ExtractedItem {
    srcTrackIdx: number;
    region: MelodyRegion;
    notes: MelodyNote[];
  }

  const extracted: ExtractedItem[] = [];
  const selectedRegionIdsByTrack = new Map<number, Set<string>>();

  for (let i = 0; i < selectedRefs.length; i++) {
    const ref = selectedRefs[i];
    const tIdx = trackIndexMap.get(ref.trackId);
    if (tIdx === undefined) continue;
    const region = workingRegions[tIdx].find((r) => r.id === ref.regionId);
    if (!region) continue;
    const notes = getNotesInRegion(workingNotes[tIdx], region);
    extracted.push({ srcTrackIdx: tIdx, region, notes });
    let set = selectedRegionIdsByTrack.get(tIdx);
    if (!set) {
      set = new Set();
      selectedRegionIdsByTrack.set(tIdx, set);
    }
    set.add(region.id);
  }

  if (extracted.length === 0) {
    return { tracks, nextSelectedRefs: selectedRefs };
  }

  // Si es movimiento (no clonado), retirar primero todas las regiones y notas originales
  if (!isClone) {
    selectedRegionIdsByTrack.forEach((idSet, tIdx) => {
      const removedRegions = workingRegions[tIdx].filter((r) => idSet.has(r.id));
      workingRegions[tIdx] = workingRegions[tIdx].filter((r) => !idSet.has(r.id));
      workingNotes[tIdx] = workingNotes[tIdx].filter(
        (n) => !removedRegions.some((r) => isNoteInRegion(n, r))
      );
    });
  }

  // Calcular destinos y despejar rangos destino en las notas/regiones remanentes
  interface PlacedItem {
    destTrackIdx: number;
    destRegion: MelodyRegion;
    destNotes: MelodyNote[];
  }

  const placed: PlacedItem[] = extracted.map((item, idx) => {
    const destTrackIdx = Math.max(
      0,
      Math.min(tracks.length - 1, item.srcTrackIdx + trackDelta)
    );
    const destStart = Math.max(0, roundBeat(item.region.startBeat + deltaBeats));
    const shift = destStart - item.region.startBeat;

    const nextRegionId = isClone
      ? useFreshIds
        ? generateId('mreg')
        : `clone_mreg_${idx}_${item.region.id}`
      : item.region.id.startsWith('auto_')
      ? useFreshIds
        ? generateId('mreg')
        : `moved_mreg_${idx}_${item.region.id}`
      : item.region.id;

    const destRegion: MelodyRegion = {
      ...item.region,
      id: nextRegionId,
      startBeat: destStart
    };

    const destNotes: MelodyNote[] = item.notes.map((n, nIdx) => ({
      ...n,
      id: isClone
        ? useFreshIds
          ? generateId('mn')
          : `clone_mn_${idx}_${nIdx}_${n.id}`
        : n.id,
      startBeat: Math.max(0, roundBeat(n.startBeat + shift))
    }));

    return { destTrackIdx, destRegion, destNotes };
  });

  // Despejar destinos contra el contenido preexistente (sin pisarse entre sí dentro del mismo grupo)
  for (let i = 0; i < placed.length; i++) {
    const p = placed[i];
    const start = p.destRegion.startBeat;
    const end = roundBeat(start + p.destRegion.durationBeats);
    workingNotes[p.destTrackIdx] = punchOutNoteRange(workingNotes[p.destTrackIdx], start, end);
    workingRegions[p.destTrackIdx] = punchOutRegionRange(
      workingRegions[p.destTrackIdx],
      start,
      end
    );
  }

  // Insertar notas y regiones colocadas
  const nextSelectedRefs: SelectedMelodyRegionRef[] = [];
  for (let i = 0; i < placed.length; i++) {
    const p = placed[i];
    workingNotes[p.destTrackIdx].push(...p.destNotes);
    workingRegions[p.destTrackIdx].push(p.destRegion);
    nextSelectedRefs.push({
      trackId: tracks[p.destTrackIdx].id,
      regionId: p.destRegion.id
    });
  }

  const nextTracks = tracks.map((t, idx) => {
    const sortedNotes = workingNotes[idx].sort((a, b) => a.startBeat - b.startBeat);
    const finalRegions = reconcileTrackRegions(
      t.id,
      sortedNotes,
      workingRegions[idx],
      beatsPerMeasure
    );
    return {
      ...t,
      notes: sortedNotes,
      regions: finalRegions
    };
  });

  return { tracks: nextTracks, nextSelectedRefs };
}

/**
 * Elimina regiones seleccionadas y TODAS sus notas de las pistas del Piano Roll.
 */
export function deleteMelodyRegions(
  tracks: PianoRollTrack[],
  selectedRefs: SelectedMelodyRegionRef[],
  beatsPerMeasure = 4
): PianoRollTrack[] {
  if (selectedRefs.length === 0) return tracks;
  const refsByTrack = new Map<string, Set<string>>();
  for (const ref of selectedRefs) {
    let set = refsByTrack.get(ref.trackId);
    if (!set) {
      set = new Set();
      refsByTrack.set(ref.trackId, set);
    }
    set.add(ref.regionId);
  }

  return tracks.map((track) => {
    const idSet = refsByTrack.get(track.id);
    if (!idSet || idSet.size === 0) return track;

    const reconciled = reconcileTrackRegions(track.id, track.notes, track.regions, beatsPerMeasure);
    const toRemove = reconciled.filter((r) => idSet.has(r.id));
    if (toRemove.length === 0) return track;

    const remainingRegions = reconciled.filter((r) => !idSet.has(r.id));
    const remainingNotes = (track.notes || []).filter(
      (n) => !toRemove.some((r) => isNoteInRegion(n, r))
    );

    return {
      ...track,
      notes: remainingNotes,
      regions: reconcileTrackRegions(track.id, remainingNotes, remainingRegions, beatsPerMeasure)
    };
  });
}

/**
 * Alterna el estado `muted` en las notas dentro de las regiones seleccionadas (100% simétrico con Piano Roll).
 */
export function toggleMuteMelodyRegions(
  tracks: PianoRollTrack[],
  selectedRefs: SelectedMelodyRegionRef[],
  beatsPerMeasure = 4
): PianoRollTrack[] {
  if (selectedRefs.length === 0) return tracks;
  const refsByTrack = new Map<string, Set<string>>();
  for (const ref of selectedRefs) {
    let set = refsByTrack.get(ref.trackId);
    if (!set) {
      set = new Set();
      refsByTrack.set(ref.trackId, set);
    }
    set.add(ref.regionId);
  }

  return tracks.map((track) => {
    const idSet = refsByTrack.get(track.id);
    if (!idSet || idSet.size === 0) return track;

    const reconciled = reconcileTrackRegions(track.id, track.notes, track.regions, beatsPerMeasure);
    const targets = reconciled.filter((r) => idSet.has(r.id));
    if (targets.length === 0) return track;

    // Si todas las notas dentro de las regiones objetivo ya están muteadas -> desmutear; si no -> mutear
    const affectedNotes = (track.notes || []).filter((n) =>
      targets.some((r) => isNoteInRegion(n, r))
    );
    if (affectedNotes.length === 0) return track;

    const allCurrentlyMuted = affectedNotes.every((n) => Boolean(n.muted));
    const nextMuted = !allCurrentlyMuted;

    const nextNotes = (track.notes || []).map((n) => {
      if (!targets.some((r) => isNoteInRegion(n, r))) return n;
      return nextMuted ? { ...n, muted: true } : { ...n, muted: undefined };
    });

    return {
      ...track,
      notes: nextNotes,
      regions: reconciled
    };
  });
}

/**
 * Duplica las regiones seleccionadas inmediatamente a continuación de su rango combinado.
 */
export function duplicateMelodyRegions(
  tracks: PianoRollTrack[],
  selectedRefs: SelectedMelodyRegionRef[],
  beatsPerMeasure = 4,
  customSpanBeats?: number
): { tracks: PianoRollTrack[]; nextSelectedRefs: SelectedMelodyRegionRef[] } {
  if (selectedRefs.length === 0) return { tracks, nextSelectedRefs: [] };

  let minStart = Infinity;
  let maxEnd = -Infinity;

  for (const ref of selectedRefs) {
    const track = tracks.find((t) => t.id === ref.trackId);
    if (!track) continue;
    const regions = reconcileTrackRegions(track.id, track.notes, track.regions, beatsPerMeasure);
    const region = regions.find((r) => r.id === ref.regionId);
    if (!region) continue;
    if (region.startBeat < minStart) minStart = region.startBeat;
    const end = region.startBeat + region.durationBeats;
    if (end > maxEnd) maxEnd = end;
  }

  if (!isFinite(minStart) || !isFinite(maxEnd)) {
    return { tracks, nextSelectedRefs: [] };
  }

  const span = Math.max(MIN_REGION_DURATION, customSpanBeats ?? roundBeat(maxEnd - minStart));
  return moveOrCloneMelodyRegions(tracks, selectedRefs, span, 0, true, beatsPerMeasure, true);
}

/**
 * Extrae las regiones seleccionadas al portapapeles con notas normalizadas localmente.
 */
export function extractMelodyRegionClipboard(
  tracks: PianoRollTrack[],
  selectedRefs: SelectedMelodyRegionRef[],
  beatsPerMeasure = 4
): MelodyRegionClipboardItem[] {
  if (selectedRefs.length === 0) return [];
  const rawItems: Array<{
    trackId: string;
    startBeat: number;
    durationBeats: number;
    loopLengthBeats?: number;
    name?: string;
    notes: MelodyNote[];
  }> = [];

  for (const ref of selectedRefs) {
    const track = tracks.find((t) => t.id === ref.trackId);
    if (!track) continue;
    const regions = reconcileTrackRegions(track.id, track.notes, track.regions, beatsPerMeasure);
    const region = regions.find((r) => r.id === ref.regionId);
    if (!region) continue;
    const localNotes = getLocalNormalizedRegionNotes(track.notes, region);
    if (localNotes.length === 0) continue;
    rawItems.push({
      trackId: track.id,
      startBeat: region.startBeat,
      durationBeats: region.durationBeats,
      loopLengthBeats: region.loopLengthBeats,
      name: region.name,
      notes: localNotes
    });
  }

  if (rawItems.length === 0) return [];
  const minStart = Math.min(...rawItems.map((i) => i.startBeat));

  return rawItems.map((item) => ({
    trackId: item.trackId,
    relativeStartBeat: roundBeat(item.startBeat - minStart),
    originalStartBeat: roundBeat(item.startBeat),
    durationBeats: item.durationBeats,
    ...(item.loopLengthBeats ? { loopLengthBeats: item.loopLengthBeats } : {}),
    ...(item.name ? { name: item.name } : {}),
    notes: item.notes
  }));
}

/**
 * Pega regiones copiadas en `targetBeat` sobre sus pistas originales (o pista de respaldo).
 */
export function pasteMelodyRegions(
  tracks: PianoRollTrack[],
  clipboard: MelodyRegionClipboardItem[],
  targetBeat: number,
  fallbackTrackId?: string | null,
  beatsPerMeasure = 4
): { tracks: PianoRollTrack[]; nextSelectedRefs: SelectedMelodyRegionRef[] } {
  if (!clipboard || clipboard.length === 0 || tracks.length === 0) {
    return { tracks, nextSelectedRefs: [] };
  }

  const baseBeat = Math.max(0, roundBeat(targetBeat));
  const trackIndexMap = new Map(tracks.map((t, idx) => [t.id, idx]));
  const fallbackIdx =
    fallbackTrackId && trackIndexMap.has(fallbackTrackId)
      ? trackIndexMap.get(fallbackTrackId)!
      : 0;

  // Si todos los clips copiados provienen de una misma pista y el usuario seleccionó otra pista de melodía, pegar ahí
  const uniqueSourceTracks = new Set(clipboard.map((c) => c.trackId));
  const useFallbackForSingleTrack =
    uniqueSourceTracks.size === 1 &&
    Boolean(fallbackTrackId && trackIndexMap.has(fallbackTrackId));

  const workingNotes = tracks.map((t) => [...(t.notes || [])]);
  const workingRegions = tracks.map((t) =>
    reconcileTrackRegions(t.id, t.notes, t.regions, beatsPerMeasure).map((r) => ({ ...r }))
  );

  const placed: Array<{
    destIdx: number;
    region: MelodyRegion;
    notes: MelodyNote[];
  }> = clipboard.map((item) => {
    const destIdx = useFallbackForSingleTrack
      ? fallbackIdx
      : (trackIndexMap.get(item.trackId) ?? fallbackIdx);
    const start = roundBeat(baseBeat + item.relativeStartBeat);
    const region: MelodyRegion = {
      id: generateId('mreg'),
      ...(item.name ? { name: item.name } : {}),
      startBeat: start,
      durationBeats: item.durationBeats,
      ...(item.loopLengthBeats ? { loopLengthBeats: item.loopLengthBeats } : {})
    };
    const notes: MelodyNote[] = item.notes.map((n) => ({
      ...n,
      id: generateId('mn'),
      startBeat: roundBeat(start + n.startBeat)
    }));
    return { destIdx, region, notes };
  });

  // Despejar destinos antes de insertar
  for (const p of placed) {
    const s = p.region.startBeat;
    const e = roundBeat(s + p.region.durationBeats);
    workingNotes[p.destIdx] = punchOutNoteRange(workingNotes[p.destIdx], s, e);
    workingRegions[p.destIdx] = punchOutRegionRange(workingRegions[p.destIdx], s, e);
  }

  const nextSelectedRefs: SelectedMelodyRegionRef[] = [];
  for (const p of placed) {
    workingNotes[p.destIdx].push(...p.notes);
    workingRegions[p.destIdx].push(p.region);
    nextSelectedRefs.push({
      trackId: tracks[p.destIdx].id,
      regionId: p.region.id
    });
  }

  const nextTracks = tracks.map((t, idx) => {
    const sortedNotes = workingNotes[idx].sort((a, b) => a.startBeat - b.startBeat);
    return {
      ...t,
      notes: sortedNotes,
      regions: reconcileTrackRegions(t.id, sortedNotes, workingRegions[idx], beatsPerMeasure)
    };
  });

  return { tracks: nextTracks, nextSelectedRefs };
}

/**
 * Repite una región ×2 estirando su duración al doble de su motivo base (acción rápida de menú).
 */
export function repeatMelodyRegionOnce(
  track: PianoRollTrack,
  regionId: string,
  beatsPerMeasure = 4
): { notes: MelodyNote[]; regions: MelodyRegion[]; regionId: string } | null {
  const snapshot = captureMelodyRegionResizeSnapshot(track, regionId, beatsPerMeasure);
  if (!snapshot) return null;
  const targetDur = roundBeat(snapshot.region.durationBeats + snapshot.sourceTileLen);
  return applyRightResizeFromSnapshot(snapshot, targetDur, true);
}
