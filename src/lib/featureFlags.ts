/**
 * Feature flags internas del motor Analytics (§Sprint 4 S4-C). Mientras una
 * funcionalidad no esté validada en producción, debe poder desactivarse sin
 * afectar el resto del sistema — cada flag aquí controla exclusivamente su
 * propia sección de UI, nunca el cálculo subyacente (los datos siempre se
 * calculan; la flag solo decide si se muestran).
 *
 * Override sin redeploy: variable de entorno `NEXT_PUBLIC_FF_<NOMBRE>` en
 * MAYÚSCULA_SERPIENTE (ej. NEXT_PUBLIC_FF_ENABLE_EXECUTIVE_SUMMARY=false).
 * Deben ser NEXT_PUBLIC_ porque algunas flags se leen en componentes cliente.
 */

export type FeatureFlagName =
  | "enableExecutiveSummary"
  | "enableExecutiveMode"
  | "enablePredictionV2"
  | "enableConsistencyV2"
  | "enableRecommendationEngine"
  | "enableOperationalRisk";

const DEFAULTS: Record<FeatureFlagName, boolean> = {
  enableExecutiveSummary: true,
  enableExecutiveMode: true,
  enablePredictionV2: true,
  enableConsistencyV2: true,
  enableRecommendationEngine: true,
  enableOperationalRisk: true,
};

function envKeyFor(name: FeatureFlagName): string {
  const snake = name.replace(/[A-Z]/g, (c) => `_${c}`).toUpperCase();
  return `NEXT_PUBLIC_FF${snake}`;
}

export function isFeatureEnabled(name: FeatureFlagName): boolean {
  const raw = process.env[envKeyFor(name)];
  if (raw === "true") return true;
  if (raw === "false") return false;
  return DEFAULTS[name];
}

/** Snapshot de todas las flags — usado por el panel de Diagnóstico del Motor (solo Administrador). */
export function getAllFeatureFlags(): Record<FeatureFlagName, boolean> {
  const names = Object.keys(DEFAULTS) as FeatureFlagName[];
  return Object.fromEntries(names.map((n) => [n, isFeatureEnabled(n)])) as Record<FeatureFlagName, boolean>;
}
