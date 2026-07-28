"use client";

import { slugify } from "@/lib/textSearch";
import type { SettingDescriptor } from "@/components/settings/registry";
import { FavoriteStarButton } from "@/components/settings/FavoritesSection";
import SettingHistoryModal from "@/components/settings/history/SettingHistoryModal";
import RestoreDefaultButton from "@/components/settings/history/RestoreDefaultButton";
import { useState } from "react";

/**
 * Envuelve cada sección existente con la "cromática" transversal del Centro de
 * Configuración (ancla para búsqueda/favoritos, estrella de favorito, ver
 * historial, restaurar predeterminado) SIN tocar el interior de la sección —
 * cada sección sigue renderizando su propio <SectionCard> internamente.
 */
export default function ConfigSectionCard({
  descriptor,
  children,
}: {
  descriptor: SettingDescriptor;
  children: React.ReactNode;
}) {
  const [historyOpen, setHistoryOpen] = useState(false);
  const hasConfigKeys = descriptor.configKeys.length > 0;

  return (
    <div id={slugify(descriptor.id)} className="scroll-mt-20">
      <div className="flex items-center justify-end gap-1 mb-1 px-1">
        {descriptor.isHighImpact && (
          <span className="text-[10px] font-medium text-warning bg-warning/[.15] px-2 py-0.5 rounded-full mr-auto">
            Alto impacto
          </span>
        )}
        <FavoriteStarButton settingId={descriptor.id} />
        {hasConfigKeys && (
          <>
            <button
              type="button"
              onClick={() => setHistoryOpen(true)}
              className="text-[11px] text-secondary hover:text-primary px-2 py-1 rounded hover:bg-primary-surface transition-colors"
            >
              Ver historial
            </button>
            <RestoreDefaultButton descriptor={descriptor} />
          </>
        )}
      </div>
      {children}
      {hasConfigKeys && (
        <SettingHistoryModal
          open={historyOpen}
          onClose={() => setHistoryOpen(false)}
          label={descriptor.label}
          configKeys={descriptor.configKeys}
        />
      )}
    </div>
  );
}
