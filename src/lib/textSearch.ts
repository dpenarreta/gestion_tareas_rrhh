// Normalización de texto compartida — extraída de SectionCard.tsx (slugify
// para las claves de localStorage) para que la búsqueda global del Centro de
// Configuración use exactamente la misma normalización, sin duplicar el regex.

const DIACRITIC_RANGE = new RegExp("[\\u0300-\\u036f]", "g");

/** Minúsculas, sin acentos, solo [a-z0-9-]. Usado para slugs de localStorage y para comparar en búsquedas. */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(DIACRITIC_RANGE, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

/** Minúsculas, sin acentos, espacios conservados — para matching de substring insensible a mayúsculas/acentos. */
export function normalizeForSearch(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(DIACRITIC_RANGE, "")
    .trim();
}

/** true si `haystack` contiene `needle`, ignorando mayúsculas/acentos. Cadena vacía siempre coincide. */
export function matchesSearch(haystack: string, needle: string): boolean {
  const q = normalizeForSearch(needle);
  if (!q) return true;
  return normalizeForSearch(haystack).includes(q);
}
