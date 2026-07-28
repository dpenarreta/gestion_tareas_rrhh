"use client";

import { useState } from "react";
import { ROLE_LABEL } from "@/lib/roles";
import type { Role } from "@/generated/prisma/client";
import SectionCard from "@/components/settings/SectionCard";
import { Button } from "@/components/ui/Button";
import { Table, TableHead, TableBody, TableRow, Th, Td } from "@/components/ui/Table";
import { SkeletonRow } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";

type User = {
  id: string;
  name: string;
  role: Role;
  dataConsentAccepted: boolean;
  dataConsentAcceptedAt: string | null;
};

function formatDate(iso: string) {
  return new Date(iso).toLocaleString("es-EC", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

/** Consentimiento de datos (LOPDP) — extraído 1:1 de SettingsManager.tsx (Sprint O), sin cambios de lógica. */
export default function DataConsentSection({
  users,
  loading,
  onUsersChanged,
}: {
  users: User[];
  loading: boolean;
  onUsersChanged: () => void;
}) {
  const { showToast } = useToast();
  const [busyId, setBusyId] = useState<string | null>(null);

  async function handleResetConsent(user: User) {
    if (
      !confirm(
        `¿Deseas que ${user.name} vea nuevamente el aviso de protección de datos en su próximo login?`
      )
    )
      return;
    setBusyId(user.id);
    try {
      const res = await fetch(`/api/users/${user.id}/reset-consent`, { method: "PATCH" });
      const data = await res.json();
      if (!res.ok) {
        showToast(data.error ?? "Error al restablecer el consentimiento", "error");
      } else {
        showToast(`Se restableció el aviso de protección de datos para ${user.name}.`, "success");
        onUsersChanged();
      }
    } catch {
      showToast("Error de conexión", "error");
    } finally {
      setBusyId(null);
    }
  }

  async function handleResetConsentAll() {
    if (
      !confirm(
        "¿Deseas restablecer el consentimiento de protección de datos de TODOS los usuarios? Todos verán nuevamente el aviso en su próximo login."
      )
    )
      return;
    if (
      !confirm(
        "Esta acción afecta a todos los usuarios del sistema y no se puede deshacer. ¿Confirmas que deseas continuar?"
      )
    )
      return;
    try {
      const res = await fetch("/api/users/reset-consent-all", { method: "PATCH" });
      const data = await res.json();
      if (!res.ok) {
        showToast(data.error ?? "Error al restablecer el consentimiento", "error");
      } else {
        showToast(`Se restableció el consentimiento de ${data.count} usuario(s).`, "success");
        onUsersChanged();
      }
    } catch {
      showToast("Error de conexión", "error");
    }
  }

  return (
    <SectionCard title="Consentimiento de datos">
      <div className="flex justify-end">
        <Button variant="secondary" onClick={handleResetConsentAll}>
          🔄 Restablecer todos
        </Button>
      </div>
      <div className="rounded-lg border border-border overflow-hidden">
        {loading ? (
          <div>
            <SkeletonRow columns={3} />
            <SkeletonRow columns={3} />
            <SkeletonRow columns={3} />
          </div>
        ) : (
          <Table>
            <TableHead>
              <TableRow>
                <Th>Usuario</Th>
                <Th>Estado</Th>
                <Th className="text-right">Acción</Th>
              </TableRow>
            </TableHead>
            <TableBody>
              {users.map((u) => (
                <TableRow key={u.id}>
                  <Td className="text-title font-medium">
                    {u.name}
                    <span className="ml-2 text-xs text-disabled">{ROLE_LABEL[u.role]}</span>
                  </Td>
                  <Td>
                    {u.dataConsentAccepted ? (
                      <span className="px-2.5 py-1 bg-success/[.13] text-success rounded-full text-xs font-medium">
                        Aceptado
                        {u.dataConsentAcceptedAt && ` · ${formatDate(u.dataConsentAcceptedAt)}`}
                      </span>
                    ) : (
                      <span className="px-2.5 py-1 bg-surface2 text-secondary rounded-full text-xs font-medium">
                        Pendiente
                      </span>
                    )}
                  </Td>
                  <Td className="text-right">
                    <button
                      onClick={() => handleResetConsent(u)}
                      disabled={busyId === u.id}
                      className="text-xs text-primary hover:text-primary-hover font-medium px-2 py-1 rounded hover:bg-primary-surface transition-colors disabled:opacity-50"
                    >
                      🔄 Restablecer
                    </button>
                  </Td>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </SectionCard>
  );
}
