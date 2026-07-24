"use client";

import { useState, useEffect, useCallback } from "react";
import type { Role } from "@/generated/prisma/client";
import { ROLE_LABEL } from "@/lib/roles";
import SectionCard from "./SectionCard";
import { Table, TableHead, TableBody, TableRow, Th, Td } from "@/components/ui/Table";

type UserRow = {
  id: string;
  name: string;
  email: string;
  role: Role;
  kpiStartDate: string | null;
};

function toDateInputValue(iso: string | null): string {
  if (!iso) return "";
  return iso.slice(0, 10);
}

function UserKpiStartDateRow({ user, onUpdated }: { user: UserRow; onUpdated: (u: UserRow) => void }) {
  const [value, setValue] = useState(toDateInputValue(user.kpiStartDate));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dirty = value !== toDateInputValue(user.kpiStartDate);

  async function save(kpiStartDate: string | null) {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/settings/kpi-start-date", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: user.id, kpiStartDate }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Error al guardar");
      } else {
        onUpdated(data);
        setValue(toDateInputValue(data.kpiStartDate));
      }
    } catch {
      setError("Error de conexión");
    } finally {
      setSaving(false);
    }
  }

  return (
    <TableRow>
      <Td className="text-title font-medium whitespace-nowrap">
        {user.name}
        <span className="ml-2 text-xs text-disabled">{ROLE_LABEL[user.role]}</span>
      </Td>
      <Td>
        <input
          type="date"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="border border-border rounded-lg px-3 py-1.5 text-sm text-title bg-surface focus:outline-none focus:ring-2 focus:ring-primary"
        />
        {error && <p className="text-xs text-danger mt-1">{error}</p>}
      </Td>
      <Td className="text-right whitespace-nowrap">
        <button
          onClick={() => save(value || null)}
          disabled={saving || !dirty}
          className="text-xs text-primary hover:text-primary-hover font-medium px-2 py-1 rounded hover:bg-primary-surface disabled:opacity-40"
        >
          Guardar
        </button>
        {user.kpiStartDate && (
          <button
            onClick={() => save(null)}
            disabled={saving}
            className="text-xs text-secondary hover:text-danger font-medium px-2 py-1 rounded hover:bg-danger/[.09] disabled:opacity-40 ml-1"
          >
            Quitar ajuste
          </button>
        )}
      </Td>
    </TableRow>
  );
}

export default function KpiStartDateSection() {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/settings/kpi-start-date");
      if (res.ok) setUsers(await res.json());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { queueMicrotask(load); }, [load]);

  function handleUpdated(updated: UserRow) {
    setUsers((prev) => prev.map((u) => (u.id === updated.id ? updated : u)));
  }

  return (
    <SectionCard title="Ajuste de período de cálculo por usuario">
      <p className="text-xs text-secondary">
        Por defecto los KPIs mensuales de cada persona se calculan desde el primer día del mes. Si defines una fecha
        de inicio para un usuario, sus KPIs de ese mes se calculan desde esa fecha en adelante — los días anteriores
        no cuentan como subutilización ni afectan su base laboral. Es un ajuste puntual: puedes quitarlo cuando ya no
        sea necesario.
      </p>
      <div className="rounded-lg border border-border overflow-hidden">
        {loading ? (
          <div className="flex justify-center items-center py-8">
            <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <Table>
            <TableHead>
              <TableRow>
                <Th>Usuario</Th>
                <Th>Fecha de inicio de cálculo KPI</Th>
                <Th className="text-right">Acción</Th>
              </TableRow>
            </TableHead>
            <TableBody>
              {users.map((u) => (
                <UserKpiStartDateRow key={u.id} user={u} onUpdated={handleUpdated} />
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </SectionCard>
  );
}
