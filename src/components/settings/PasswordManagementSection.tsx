"use client";

import { useState } from "react";
import { ROLE_LABEL } from "@/lib/roles";
import type { Role } from "@/lib/roles";
import SectionCard from "@/components/settings/SectionCard";
import { Table, TableHead, TableBody, TableRow, Th, Td } from "@/components/ui/Table";
import { SkeletonRow } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";
import { Button } from "@/components/ui/Button";
import { copyToClipboard } from "@/lib/clipboard";

type User = { id: string; name: string; role: Role };

type EnlaceGenerado = { userName: string; url: string };

/** Gestión de contraseñas — extraído 1:1 de SettingsManager.tsx (Sprint O).
 *
 * Desde 2026-09-11 el botón devuelve un enlace de recuperación para
 * entregarle a la persona, en vez de solo marcar que debe cambiar su
 * contraseña. El comportamiento anterior no servía para el único caso que
 * importa: quien olvidó su contraseña no puede iniciar sesión, y era
 * justamente al iniciar sesión cuando se le iba a pedir el cambio. Ver
 * docs/AUDIT_LOG.md § 2026-09-11.
 */
export default function PasswordManagementSection({ users, loading }: { users: User[]; loading: boolean }) {
  const { showToast } = useToast();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [enlace, setEnlace] = useState<EnlaceGenerado | null>(null);
  const [copiado, setCopiado] = useState(false);

  async function handleResetPassword(user: User) {
    setBusyId(user.id);
    try {
      const res = await fetch(`/api/users/${user.id}/reset-password`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        showToast(data.error ?? "Error al resetear", "error");
      } else {
        setEnlace({ userName: data.userName ?? user.name, url: data.resetUrl });
        setCopiado(false);
      }
    } catch {
      showToast("Error de conexión", "error");
    } finally {
      setBusyId(null);
    }
  }

  async function copiarEnlace() {
    if (!enlace) return;
    // `copyToClipboard` resuelve que en http no exista `navigator.clipboard`
    // (ver src/lib/clipboard.ts). El enlace queda visible igual, así que si
    // ni siquiera el camino alternativo funciona, se puede copiar a mano.
    if (await copyToClipboard(enlace.url)) {
      setCopiado(true);
    } else {
      showToast("No se pudo copiar automáticamente. Seleccioná el enlace y copialo.", "error");
    }
  }

  return (
    <SectionCard title="Gestión de contraseñas">
      {enlace && (
        <div className="mb-4 rounded-lg border border-warning/40 bg-warning/[.08] p-4">
          <p className="text-sm font-medium text-title">
            Enlace de recuperación para {enlace.userName}
          </p>
          <p className="mt-1 text-xs text-disabled">
            Entregáselo por un medio seguro. Sirve <strong>una sola vez</strong> y vence en 60
            minutos. Mientras esté vigente, quien lo tenga puede definir la contraseña de esa
            cuenta. Sus sesiones abiertas ya se cerraron.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <code className="flex-1 min-w-0 break-all rounded bg-black/[.06] dark:bg-white/10 px-2 py-1.5 text-xs">
              {enlace.url}
            </code>
            <Button type="button" onClick={copiarEnlace}>
              {copiado ? "Copiado" : "Copiar"}
            </Button>
            <button
              type="button"
              onClick={() => setEnlace(null)}
              className="text-xs text-disabled hover:text-main px-2 py-1"
            >
              Cerrar
            </button>
          </div>
        </div>
      )}

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
                      title="Genera un enlace de un solo uso para que la persona defina una contraseña nueva, y cierra sus sesiones abiertas"
                    >
                      {busyId === u.id ? "Generando…" : "🔑 Generar enlace de recuperación"}
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
