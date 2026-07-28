"use client";

import { SETTINGS_CATEGORY_LABEL, SETTINGS_CATEGORY_ORDER, type SettingsCategory } from "@/lib/settingsCategories";

export default function CategoryNav({
  active,
  onChange,
  counts,
}: {
  active: SettingsCategory;
  onChange: (category: SettingsCategory) => void;
  /** Conteo de resultados de búsqueda por categoría — si se provee, se muestra como badge. */
  counts?: Partial<Record<SettingsCategory, number>>;
}) {
  return (
    <nav className="flex flex-col gap-0.5 w-full sm:w-52 shrink-0" aria-label="Categorías de configuración">
      {SETTINGS_CATEGORY_ORDER.map((cat) => {
        const count = counts?.[cat];
        const isActive = active === cat;
        return (
          <button
            key={cat}
            type="button"
            onClick={() => onChange(cat)}
            className={`flex items-center justify-between gap-2 px-3 py-2 rounded-lg text-sm text-left transition-colors ${
              isActive ? "bg-primary-surface text-primary font-semibold" : "text-secondary hover:bg-black/[.03] dark:hover:bg-white/[.04]"
            }`}
          >
            <span>{SETTINGS_CATEGORY_LABEL[cat]}</span>
            {counts !== undefined && (
              <span className={`text-[11px] rounded-full px-1.5 ${count ? "bg-primary text-white" : "text-disabled"}`}>
                {count ?? 0}
              </span>
            )}
          </button>
        );
      })}
    </nav>
  );
}
