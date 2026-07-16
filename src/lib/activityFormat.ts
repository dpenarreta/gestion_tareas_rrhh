// User.viewPreferences es un String[] (no JSON), reutilizado para varias
// preferencias mediante claves codificadas como prefijo, igual que
// "DASHBOARD_CARDS:" en src/app/api/dashboard/card-order/route.ts.
const ACTIVITY_FORMAT_PREFIX = "ACTIVITY_FORMAT:";

export type ActivityFormat = "duration" | "timerange";

export function getActivityFormat(viewPreferences: string[] | null | undefined): ActivityFormat {
  const pref = viewPreferences?.find((v) => v.startsWith(ACTIVITY_FORMAT_PREFIX));
  const value = pref?.slice(ACTIVITY_FORMAT_PREFIX.length);
  return value === "timerange" ? "timerange" : "duration";
}

export function withActivityFormat(viewPreferences: string[] | null | undefined, format: ActivityFormat): string[] {
  const existing = (viewPreferences ?? []).filter((v) => !v.startsWith(ACTIVITY_FORMAT_PREFIX));
  return [...existing, `${ACTIVITY_FORMAT_PREFIX}${format}`];
}
