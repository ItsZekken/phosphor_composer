import type { PatternDef } from './patternTypes';

let cachedPatterns: PatternDef[] | null = null;

/**
 * Carga los patrones desde /patterns.json (generado por processPatterns.mjs).
 * Cachea el resultado en memoria para evitar múltiples fetches.
 * Devuelve un array vacío si el archivo no existe o hay un error.
 */
export async function loadCustomPatterns(): Promise<PatternDef[]> {
  if (cachedPatterns !== null) return cachedPatterns;

  try {
    const response = await fetch('/patterns.json');
    if (!response.ok) {
      console.warn('[patternLoader] patterns.json no encontrado o error HTTP', response.status);
      cachedPatterns = [];
      return [];
    }
    const data = await response.json();
    if (!Array.isArray(data)) {
      console.warn('[patternLoader] patterns.json no es un array');
      cachedPatterns = [];
      return [];
    }
    cachedPatterns = data as PatternDef[];
    console.log(`[patternLoader] Cargados ${cachedPatterns.length} patrones custom desde patterns.json`);
    return cachedPatterns;
  } catch (e) {
    console.warn('[patternLoader] Error cargando patterns.json:', e);
    cachedPatterns = [];
    return [];
  }
}

/** Invalida el caché en memoria para forzar una nueva carga. */
export function invalidatePatternCache() {
  cachedPatterns = null;
}
