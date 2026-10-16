"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";
import { novedadesApi } from "@/components/novedades/api";
import { ErrorBox, TextInput } from "@/components/novedades/fields";
import { ROLE_LABEL, type Role } from "@/lib/roles";
import SectionCard from "@/components/settings/SectionCard";

type Grant = { direct: boolean; byRole: boolean };
type UserPerms = {
  id: number;
  name: string;
  username: string;
  email: string;
  role: string;
  isActive: boolean;
  entries: Grant;
  exits: Grant;
};
type Kind = "entries" | "exits";

const KIND_LABEL: Record<Kind, string> = { entries: "Ingresos", exits: "Salidas" };

// Permisos de visibilidad de Ingresos y Salidas: individuales e independientes
// por pestaña, sin cambiar el rol de nadie. Solo el Administrador; Django lo
// valida en cada llamada y audita cada cambio.
export default function MovementPermissionsSection() {
  const { showToast } = useToast();
  const [users, setUsers] = useState<UserPerms[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [draft, setDraft] = useState<Record<number, Partial<Record<Kind, boolean>>>>({});
  const [savingId, setSavingId] = useState<number | null>(null);

  const load = useCallback(async () => {
    const result = await novedadesApi.get<UserPerms[]>("movements/permissions");
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setUsers(result.data);
  }, []);

  useEffect(() => {
    queueMicrotask(load);
  }, [load]);

  async function save(u: UserPerms) {
    const changes = draft[u.id];
    if (!changes) return;
    setSavingId(u.id);
    setError(null);
    const result = await novedadesApi.post<UserPerms>(`movements/permissions/${u.id}`, changes);
    setSavingId(null);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setUsers((list) => list?.map((x) => (x.id === u.id ? result.data : x)) ?? null);
    setDraft(({ [u.id]: _, ...rest }) => rest);
    showToast(`Permisos de ${u.name} guardados.`, "success");
  }

  const term = search.trim().toLowerCase();
  const visible = (users ?? []).filter(
    (u) => !term || [u.name, u.username, u.email].some((v) => v.toLowerCase().includes(term)),
  );
  const withAccess = (users ?? []).filter((u) => u.entries.direct || u.exits.direct || u.entries.byRole || u.exits.byRole);

  return (
    <SectionCard title="Permisos de visibilidad — Ingresos y Salidas">
      {users === null ? (
        error ? (
          <ErrorBox message={error} />
        ) : (
          <div className="flex justify-center py-8">
            <Spinner className="text-primary" />
          </div>
        )
      ) : (
        <div className="space-y-4">
          <p className="text-xs text-secondary">
            Habilite la consulta de <strong>Ingresos</strong> y de <strong>Salidas</strong> a personas específicas, por
            separado y sin cambiar su rol. El Administrador ve ambas pestañas siempre. Estos permisos solo dan acceso a la
            consulta consolidada (y su exportación); no amplían ningún otro permiso de NEXO.
          </p>
          <p className="text-xs text-secondary">
            Vigentes: {withAccess.length} persona(s) con acceso a alguna pestaña.
          </p>
          <ErrorBox message={error} />
          <TextInput
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por nombre, usuario o correo"
            aria-label="Buscar usuario"
          />
          <div className="overflow-x-auto border border-border rounded-lg max-h-[480px]">
            <table className="w-full text-sm">
              <thead className="bg-surface2 text-secondary text-xs sticky top-0">
                <tr>
                  <th className="text-left px-3 py-2">Usuario</th>
                  <th className="text-left px-3 py-2">Rol</th>
                  {(["entries", "exits"] as Kind[]).map((k) => (
                    <th key={k} className="text-center px-3 py-2">
                      {KIND_LABEL[k]}
                    </th>
                  ))}
                  <th />
                </tr>
              </thead>
              <tbody>
                {visible.map((u) => {
                  const pending = draft[u.id] ?? {};
                  const dirty = Object.keys(pending).length > 0;
                  return (
                    <tr key={u.id} className="border-t border-border">
                      <td className="px-3 py-2">
                        <div className="text-title">{u.name}</div>
                        <div className="text-xs text-secondary">
                          {u.email || u.username}
                          {!u.isActive && " · deshabilitado"}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-xs text-secondary">{ROLE_LABEL[u.role as Role] ?? (u.role || "—")}</td>
                      {(["entries", "exits"] as Kind[]).map((k) => {
                        const checked = pending[k] ?? u[k].direct;
                        return (
                          <td key={k} className="px-3 py-2 text-center">
                            <input
                              type="checkbox"
                              checked={checked}
                              aria-label={`${KIND_LABEL[k]} para ${u.name}`}
                              onChange={(e) => {
                                const value = e.target.checked;
                                setDraft((d) => {
                                  const next = { ...(d[u.id] ?? {}) };
                                  if (value === u[k].direct) delete next[k];
                                  else next[k] = value;
                                  const { [u.id]: _, ...rest } = d;
                                  return Object.keys(next).length ? { ...rest, [u.id]: next } : rest;
                                });
                              }}
                            />
                            {u[k].byRole && (
                              <div>
                                <Badge variant="info">por su rol</Badge>
                              </div>
                            )}
                          </td>
                        );
                      })}
                      <td className="px-3 py-2 text-right">
                        {dirty && (
                          <Button size="sm" loading={savingId === u.id} onClick={() => save(u)}>
                            Guardar
                          </Button>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {visible.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-3 py-6 text-center text-secondary text-sm">
                      Ningún usuario coincide con la búsqueda.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <p className="text-[11px] text-secondary">
            Al retirar un permiso, Django corta el acceso en la siguiente solicitud de esa persona; el enlace del menú
            desaparece cuando vuelve a iniciar sesión.
          </p>
        </div>
      )}
    </SectionCard>
  );
}
