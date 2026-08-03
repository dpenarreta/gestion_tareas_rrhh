"use client";

import { useState } from "react";
import RegularizeTargetTimeManager from "./RegularizeTargetTimeManager";
import RegularizeEndDateManager from "./RegularizeEndDateManager";

type Tab = "tiempo-objetivo" | "fecha-fin";

const TAB_LABEL: Record<Tab, string> = {
  "tiempo-objetivo": "Tiempo Objetivo",
  "fecha-fin": "Fecha Fin",
};

const TAB_DESCRIPTION: Record<Tab, string> = {
  "tiempo-objetivo":
    "Regularización de Tiempo Objetivo (§Sprint 6) — valida el estándar operativo de tareas activas o recientes que aún no tienen un Tiempo Objetivo validado. Nunca modifica horas reales ni recalcula automáticamente desde el historial; la decisión siempre es humana.",
  "fecha-fin":
    "Validación de Fecha Fin — aprueba, modifica o rechaza la fecha fin propuesta por el colaborador en tareas activas o recientes. Una fecha rechazada o el simple hecho de reeditarla la vuelve a dejar Pendiente automáticamente.",
};

/** Selector de 2 pestañas sobre las 2 herramientas de regularización de líder — mismo patrón de botones activo/inactivo que ReportWizardModal.tsx usa para sus presets de período (no existe un componente Tabs compartido en el design system). */
export default function RegularizeValidationsTabs({ currentUserId }: { currentUserId: string }) {
  const [tab, setTab] = useState<Tab>("tiempo-objetivo");

  return (
    <div className="space-y-6">
      <div className="flex gap-2">
        {(Object.keys(TAB_LABEL) as Tab[]).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`text-sm px-4 py-2 rounded-xl border transition-colors font-medium ${
              tab === t ? "border-primary bg-primary-surface text-primary" : "border-border text-secondary hover:bg-surface2"
            }`}
          >
            {TAB_LABEL[t]}
          </button>
        ))}
      </div>
      <p className="text-secondary">{TAB_DESCRIPTION[tab]}</p>
      {tab === "tiempo-objetivo" ? (
        <RegularizeTargetTimeManager currentUserId={currentUserId} />
      ) : (
        <RegularizeEndDateManager currentUserId={currentUserId} />
      )}
    </div>
  );
}
