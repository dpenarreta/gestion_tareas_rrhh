"use client";

import { useState, useEffect, useCallback } from "react";
import SectionCard from "./SectionCard";
import type { Role } from "@/generated/prisma/client";
import { ROLE_LABEL, ROLE_LEVEL, isExecutorRole } from "@/lib/roles";
import { Spinner } from "@/components/ui/Skeleton";
import { useToast, TOAST_MESSAGES } from "@/components/ui/Toast";

type Matrix = Partial<Record<Role, Role[]>>;

// Solo cargos ejecutores pueden ser origen/destino de una redistribución
// (los de dirección quedan excluidos desde Sprint 0A) — mostrar los demás
// aquí sería una configuración que nunca tiene efecto.
const EXECUTOR_ROLES = (Object.keys(ROLE_LABEL) as Role[]).filter(isExecutorRole);

function peersOf(role: Role): Role[] {
  return EXECUTOR_ROLES.filter((r) => r !== role && ROLE_LEVEL[r] === ROLE_LEVEL[role]);
}

/**
 * Matriz de Compatibilidad Operativa — cargos ADICIONALES (del mismo nivel
 * jerárquico, siempre — nunca configurable entre niveles distintos) con los
 * que un cargo puede redistribuir carga cuando no hay nadie disponible del
 * mismo cargo. Usada únicamente por el motor determinista de recomendaciones
 * (`computeTeamRecommendations`) — no modifica ningún KPI ni cálculo de
 * carga laboral.
 */
export default function RoleCompatibilitySection() {
  const { showToast } = useToast();
  const [matrix, setMatrix] = useState<Matrix | null>(null);
  const [draft, setDraft] = useState<Matrix | null>(null);
  const [savingRole, setSavingRole] = useState<Role | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/settings/role-compatibility");
    if (res.ok) {
      const data = await res.json();
      setMatrix(data.matrix);
      setDraft(data.matrix);
    }
  }, []);

  useEffect(() => {
    queueMicrotask(load);
  }, [load]);

  if (!matrix || !draft) {
    return (
      <SectionCard title="Compatibilidad Operativa">
        <div className="flex justify-center items-center py-8">
          <Spinner className="w-5 h-5" />
        </div>
      </SectionCard>
    );
  }

  function toggle(role: Role, peer: Role) {
    setDraft((prev) => {
      if (!prev) return prev;
      const current = prev[role] ?? [];
      const next = current.includes(peer) ? current.filter((r) => r !== peer) : [...current, peer];
      return { ...prev, [role]: next };
    });
  }

  async function saveRole(role: Role) {
    setSavingRole(role);
    try {
      const res = await fetch("/api/settings/role-compatibility", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role, compatibleRoles: draft![role] ?? [] }),
      });
      const data = await res.json();
      if (!res.ok) {
        showToast(data.error ?? "Error al guardar", "error");
      } else {
        setMatrix(data.matrix);
        showToast(TOAST_MESSAGES.saved, "success");
      }
    } catch {
      showToast("Error de conexión", "error");
    } finally {
      setSavingRole(null);
    }
  }

  const rolesWithPeers = EXECUTOR_ROLES.filter((r) => peersOf(r).length > 0);

  return (
    <SectionCard title="Compatibilidad Operativa">
      <p className="text-xs text-secondary">
        Además del mismo cargo (siempre prioritario), qué otros cargos del <strong>mismo nivel jerárquico</strong> pueden
        recibir redistribución de carga cuando no hay nadie disponible del mismo cargo — usado únicamente por el motor
        determinista de recomendaciones. La redistribución entre niveles jerárquicos distintos nunca está permitida (no es
        configurable). La compatibilidad es direccional: para que dos cargos se apoyen mutuamente, marca la casilla en
        ambos lados. No modifica ningún KPI ni cálculo de carga laboral.
      </p>

      {rolesWithPeers.length === 0 ? (
        <p className="text-sm text-disabled py-4 text-center">Ningún cargo tiene pares del mismo nivel para configurar.</p>
      ) : (
        <div className="space-y-3">
          {rolesWithPeers.map((role) => {
            const peers = peersOf(role);
            const selected = new Set(draft[role] ?? []);
            const dirty = JSON.stringify([...(matrix[role] ?? [])].sort()) !== JSON.stringify([...(draft[role] ?? [])].sort());
            return (
              <div key={role} className="border border-border rounded-xl p-3">
                <div className="flex items-center justify-between mb-2 gap-2">
                  <p className="text-sm font-semibold text-title">{ROLE_LABEL[role]}</p>
                  <button
                    onClick={() => saveRole(role)}
                    disabled={savingRole === role || !dirty}
                    className="shrink-0 px-3 py-1.5 bg-primary text-white font-medium rounded-lg text-xs hover:bg-primary-hover disabled:opacity-50 transition-colors whitespace-nowrap"
                  >
                    {savingRole === role ? "Guardando…" : "Guardar"}
                  </button>
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-1.5">
                  {peers.map((peer) => (
                    <label key={peer} className="flex items-center gap-1.5 text-xs text-main cursor-pointer">
                      <input
                        type="checkbox"
                        checked={selected.has(peer)}
                        onChange={() => toggle(role, peer)}
                        className="rounded border-border"
                      />
                      {ROLE_LABEL[peer]}
                    </label>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </SectionCard>
  );
}
