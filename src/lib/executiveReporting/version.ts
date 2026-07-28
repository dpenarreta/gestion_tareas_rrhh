// Versionado mostrado en cada Executive Report (FPS Parte IV §10) — NEXO ·
// Analytics Engine · Formula Set · Executive Reporting Engine. Reexporta las
// versiones ya existentes en vez de duplicarlas (ANALYTICS_ENGINE_VERSION/
// FORMULA_SET_VERSION siguen viviendo únicamente en analytics.ts). NEXO_VERSION
// se lee de package.json — misma fuente que docs/VERSION.md mantiene
// sincronizada manualmente (ver también src/app/api/settings/system-info/route.ts).
import packageJson from "../../../package.json";
import { ANALYTICS_ENGINE_VERSION, FORMULA_SET_VERSION } from "@/lib/analytics";

export const EXECUTIVE_REPORTING_ENGINE_VERSION = "2.0";

export { ANALYTICS_ENGINE_VERSION, FORMULA_SET_VERSION };

export const NEXO_VERSION: string = packageJson.version;

export type ExecutiveReportVersions = {
  nexoVersion: string;
  analyticsEngineVersion: string;
  formulaSetVersion: string;
  reportingEngineVersion: string;
};

export function currentExecutiveReportVersions(): ExecutiveReportVersions {
  return {
    nexoVersion: NEXO_VERSION,
    analyticsEngineVersion: ANALYTICS_ENGINE_VERSION,
    formulaSetVersion: FORMULA_SET_VERSION,
    reportingEngineVersion: EXECUTIVE_REPORTING_ENGINE_VERSION,
  };
}
