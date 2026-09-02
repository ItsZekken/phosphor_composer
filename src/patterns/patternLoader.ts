import type { PatternDef } from './patternTypes';
import defaultPatternsJson from '../../public/patterns.json';

const defaultPatterns: PatternDef[] = Array.isArray(defaultPatternsJson) ? (defaultPatternsJson as PatternDef[]) : [];

let cachedPatterns: PatternDef[] = defaultPatterns;

/**
 * Devuelve los patrones por defecto empaquetados estáticamente en la aplicación.
 */
export function getDefaultCustomPatterns(): PatternDef[] {
  return defaultPatterns;
}

/**
 * Carga los patrones desde /patterns.json (generado por processPatterns.mjs).
 * Inicializa de inmediato con los patrones estáticos para disponibilidad síncrona,
 * y luego refresca dinámicamente si hay nuevos patrones generados.
 */
export async function loadCustomPatterns(): Promise<PatternDef[]> {
  try {
    const response = await fetch(`/patterns.json?t=${Date.now()}`);
    if (!response.ok) {
      return cachedPatterns;
    }
    const data = await response.json();
    if (!Array.isArray(data)) {
      return cachedPatterns;
    }
    cachedPatterns = data as PatternDef[];
    return cachedPatterns;
  } catch (e) {
    console.warn('[patternLoader] Usando patrones estáticos por defecto:', e);
    return cachedPatterns;
  }
}

/** Invalida el caché en memoria para forzar una nueva carga. */
export function invalidatePatternCache() {
  cachedPatterns = defaultPatterns;
}
