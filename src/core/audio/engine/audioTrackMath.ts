/**
 * audioTrackMath.ts
 * Utilidades matemáticas y conversiones analógicas para faders de pista en decibeles (-∞ a +24 dB).
 * Mapea la escala logarítmica/piecewise con 0 dB (ganancia unitaria) en el 75% del recorrido del fader.
 */

/**
 * Convierte una posición porcentual de fader (0 a 1) a decibeles (-∞ a +24 dB).
 * - 0.00 a 0.02: -∞ dB (silencio)
 * - 0.75: 0.0 dB (ganancia unitaria)
 * - 1.00: +24.0 dB (headroom boost máximo)
 */
export function faderPosToDb(pos: number): number {
  if (pos <= 0.02) return -Infinity;
  if (pos >= 0.75) {
    // Rango superior [0.75, 1.0] -> [0 dB, +24 dB]
    const ratio = (pos - 0.75) / 0.25;
    return Math.round(ratio * 24 * 10) / 10;
  }
  // Rango inferior [0.02, 0.75] -> [-60 dB, 0 dB] con curva analógica suave
  const t = (pos - 0.02) / 0.73;
  const db = -60 * Math.pow(1 - t, 1.5);
  return Math.round(db * 10) / 10;
}

/**
 * Convierte un valor en decibeles (-∞ a +24 dB) a una posición porcentual de fader (0 a 1).
 */
export function dbToFaderPos(db: number): number {
  if (!isFinite(db) || db <= -59) return 0;
  if (db >= 0) {
    return Math.min(1, 0.75 + (db / 24) * 0.25);
  }
  const clampedDb = Math.max(-60, db);
  const ratio = Math.pow(-clampedDb / 60, 1 / 1.5);
  const t = 1 - ratio;
  return Math.max(0.02, Math.min(0.75, 0.02 + t * 0.73));
}

/**
 * Normaliza valores de volumen almacenados para compatibilidad hacia atrás:
 * En sesiones anteriores, 80 representaba ganancia unitaria (0 dB) en la escala 0-100.
 */
export function normalizeTrackDb(volume: number | undefined): number {
  if (volume === undefined) return 0;
  if (volume === 80 || volume > 24) return 0;
  return volume;
}

/**
 * Convierte decibeles a factor de ganancia lineal para Web Audio GainNode.
 */
export function dbToLinearGain(db: number): number {
  if (!isFinite(db) || db <= -59) return 0;
  return Math.pow(10, db / 20);
}

/**
 * Formato visual estándar de decibeles estilo consola analógica.
 * Muestra "-∞", "0.0", "+3.5", etc.
 */
export function formatDb(db: number): string {
  if (!isFinite(db) || db <= -59) return '-∞';
  if (Math.abs(db) < 0.05) return '0.0';
  const sign = db > 0 ? '+' : '';
  return `${sign}${db.toFixed(1)}`;
}
