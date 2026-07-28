"use client";

import { useState } from "react";
import { ROLE_LABEL } from "@/lib/roles";
import type { Role } from "@/generated/prisma/client";
import SectionCard from "@/components/settings/SectionCard";
import { Table, TableHead, TableBody, TableRow, Th, Td } from "@/components/ui/Table";
import { SkeletonRow } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";

type User = { id: string; name: string; role: Role };

/** Gestión de contraseñas — extraído 1:1 de SettingsManager.tsx (Sprint O), sin cambios de lógica. */
export default function PasswordManagementSection({ users, loading }: { users: User[]; loading: boolean }) {
  const { showToast } = useToast();
  const [busyId, setBusyId] = useState<string | null>(null);

  async function handleResetPassword(user: User) {
    setBusyId(user.id);
    try {
      const res = await fetch(`/api/users/${user.id}/reset-password`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        showToast(data.error ?? "Error al resetear", "error");
      } else {
        showToast(data.message, "success");
      }
    } catch {
      showToast("Error de conexión", "error");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <SectionCard title="Gestión de contraseñas">
      <div className="rounded-lg border border-border overflow-hidden">
        {loading ? (
          <div>
            <SkeletonRow columns={2} />
            <SkeletonRow columns={2} />
            <SkeletonRow columns={2} />
          </div>
        ) : (
          <Table>
            <TableHead>
              <TableRow>
                <Th>Usuario</Th>
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
                  <Td className="text-right">
                    <button
                      onClick={() => handleResetPassword(u)}
                      disabled={busyId === u.id}
                      className="text-xs text-warning hover:brightness-90 font-medium px-2 py-1 rounded hover:bg-warning/[.15] transition-colors disabled:opacity-50"
                      title="Resetear contraseña a 123456"
                    >
                      🔑 Resetear contraseña
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
