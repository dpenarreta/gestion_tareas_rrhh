// Report ID del Executive Reporting Engine 2.0 (FPS Parte IV §4) — formato
// NXR-YYYYMMDD-HHMMSS-XXXX, único por reporte generado, nunca se reutiliza.
// El timestamp se toma en huso de negocio (UTC-5, ver businessTime.ts), no en
// huso local del servidor, para que el Report ID de la portada coincida con
// la hora que el usuario reconoce como "cuándo lo generé".
import { randomInt } from "node:crypto";
import { BUSINESS_TZ_OFFSET_HOURS } from "@/lib/businessTime";

// Alfabeto sin 0/O/1/I — evita ambigüedad al leer el Report ID impreso en la
// portada o el pie de página del documento.
const SUFFIX_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
const SUFFIX_LENGTH = 4;

function randomSuffix(length: number = SUFFIX_LENGTH): string {
  let out = "";
  for (let i = 0; i < length; i++) {
    out += SUFFIX_ALPHABET[randomInt(SUFFIX_ALPHABET.length)];
  }
  return out;
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function toBusinessParts(date: Date) {
  const shifted = new Date(date.getTime() - BUSINESS_TZ_OFFSET_HOURS * 3600000);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
    second: shifted.getUTCSeconds(),
  };
}

/** YYYYMMDD-HHMMSS de `date` en huso de negocio. */
function businessStamp(date: Date): string {
  const p = toBusinessParts(date);
  return `${p.year}${pad2(p.month)}${pad2(p.day)}-${pad2(p.hour)}${pad2(p.minute)}${pad2(p.second)}`;
}

/** YYYYMMDD de `date` en huso de negocio (sin componente de hora). */
function businessDateStamp(date: Date): string {
  const p = toBusinessParts(date);
  return `${p.year}${pad2(p.month)}${pad2(p.day)}`;
}

const REPORT_ID_PATTERN = /^NXR-\d{8}-\d{6}-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{4}$/;
const LEGACY_REPORT_ID_PATTERN = /^NXR-LEGACY-\d{8}-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{4}$/;

/**
 * Report ID de un reporte generado en vivo — NXR-YYYYMMDD-HHMMSS-XXXX. La
 * unicidad real la garantiza el constraint `@unique` en BD, no este generador
 * (ver `snapshotStore.createSnapshot`, que reintenta ante colisión) — el
 * timestamp a nivel de segundo más el sufijo aleatorio solo hacen la
 * colisión estadísticamente improbable.
 */
export function generateReportId(now: Date = new Date()): string {
  return `NXR-${businessStamp(now)}-${randomSuffix()}`;
}

/**
 * Report ID para filas migradas desde `MonthlyReport` en el backfill de una
 * sola corrida (ver `scripts/backfill-executive-report-snapshots.ts`).
 * Formato NXR-LEGACY-YYYYMMDD-XXXX — sin componente de hora porque
 * `MonthlyReport` no registra la hora exacta de generación; el prefijo
 * `LEGACY` evita que se confunda con un reportId nativo.
 */
export function generateLegacyReportId(originalDate: Date): string {
  return `NXR-LEGACY-${businessDateStamp(originalDate)}-${randomSuffix()}`;
}

export function isValidReportIdFormat(id: string): boolean {
  return REPORT_ID_PATTERN.test(id) || LEGACY_REPORT_ID_PATTERN.test(id);
}
