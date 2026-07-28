// Duplicado deliberado del default de systemConfig.ts (CONFIG_KEY_RETROACTIVE_WINDOW_DAYS)
// — ese archivo es "server-only" y no puede importarse desde componentes cliente,
// ni siquiera solo por su constante. Debe mantenerse igual al default allí.
const DEFAULT_RETROACTIVE_WINDOW_DAYS = 2;

/** Fetch de la ventana de registro retroactivo configurada — usado por componentes cliente (RetroactiveActivityModal, ProjectActivitiesTab). */
export async function fetchRetroactiveWindowDays(): Promise<number> {
  try {
    const res = await fetch("/api/settings/retroactive-window");
    if (!res.ok) return DEFAULT_RETROACTIVE_WINDOW_DAYS;
    const data = await res.json();
    return typeof data.days === "number" ? data.days : DEFAULT_RETROACTIVE_WINDOW_DAYS;
  } catch {
    return DEFAULT_RETROACTIVE_WINDOW_DAYS;
  }
}
