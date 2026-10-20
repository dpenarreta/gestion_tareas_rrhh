"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Table, TableBody, TableHead, TableRow, Td, Th } from "@/components/ui/Table";
import { Spinner } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";
import { formatDateTime, novedadesApi } from "@/components/novedades/api";
import { ErrorBox } from "@/components/novedades/fields";
import SectionCard from "@/components/settings/SectionCard";
import type { OvertimeDayKind } from "@/lib/novedadesAutosave";

type Row = {
  supervisor: { id: number; name: string; isActive: boolean };
  permissions: Record<OvertimeDayKind, boolean>;
  configured: boolean;
  updatedBy: string;
  updatedAt: string | null;
};

const KINDS: [OvertimeDayKind, string][] = [
  ["weekday", "Días laborables"],
  ["saturday", "Sábados"],
  ["sunday", "Domingos"],
  ["holiday", "Feriados"],
];

// Matriz Supervisor × tipo de día para Horas extras. Cada cambio se guarda al
// momento, queda auditado (antes/después, quién y cuándo) y rige para los
// registros siguientes: lo ya registrado no se modifica. Django revalida en
// cada guardado e importación; el Asistente de Operaciones no se ve afectado.
export default function OvertimeDayPermissionsSection() {
  const { showToast } = useToast();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => {
    novedadesApi.get<Row[]>("permissions/overtime-days").then((r) => (r.ok ? setRows(r.data) : setError(r.error)));
  }, []);
  useEffect(load, [load]);

  async function toggle(row: Row, kind: OvertimeDayKind, value: boolean) {
    const key = `${row.supervisor.id}:${kind}`;
    setBusy(key);
    const r = await novedadesApi.patch<Row>(`permissions/overtime-days/${row.supervisor.id}`, { [kind]: value });
    setBusy(null);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    setError(null);
    setRows((list) => list?.map((x) => (x.supervisor.id === row.supervisor.id ? r.data : x)) ?? null);
    showToast(`${row.supervisor.name}: ${KINDS.find(([k]) => k === kind)?.[1].toLowerCase()} ${value ? "habilitados" : "deshabilitados"}.`, "success");
  }

  return (
    <SectionCard title="Horas extras por tipo de día — Supervisores">
      <div className="space-y-3 text-sm">
        <p className="text-secondary">
          Defina en qué tipos de día puede registrar horas extras cada Supervisor de Operaciones. Un feriado que cae en
          sábado o domingo exige ambos permisos. Un supervisor nuevo empieza con todo en No hasta que lo configure. Los
          cambios aplican a los registros siguientes; lo ya registrado no se modifica y se sigue pudiendo consultar.
        </p>
        <ErrorBox message={error} />
        {!rows ? (
          !error && <Spinner />
        ) : rows.length === 0 ? (
          <p className="text-secondary">No hay usuarios con el rol Supervisor de Operaciones.</p>
        ) : (
          <Table>
            <TableHead>
              <TableRow>
                <Th>Supervisor</Th>
                {KINDS.map(([kind, label]) => (
                  <Th key={kind} className="text-center">
                    {label}
                  </Th>
                ))}
                <Th>Último cambio</Th>
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.supervisor.id}>
                  <Td>
                    <span className="text-title font-medium">{row.supervisor.name}</span>
                    {!row.supervisor.isActive && <Badge className="ml-1">Inactivo</Badge>}
                    {!row.configured && (
                      <Badge variant="warning" className="ml-1">
                        Sin configurar
                      </Badge>
                    )}
                  </Td>
                  {KINDS.map(([kind, label]) => (
                    <Td key={kind} className="text-center">
                      <select
                        aria-label={`${label} — ${row.supervisor.name}`}
                        value={row.permissions[kind] ? "1" : "0"}
                        disabled={busy === `${row.supervisor.id}:${kind}`}
                        onChange={(e) => toggle(row, kind, e.target.value === "1")}
                        className={`border border-border rounded-lg px-2 py-1 text-sm bg-surface ${
                          row.permissions[kind] ? "text-success" : "text-danger"
                        }`}
                      >
                        <option value="1">Sí</option>
                        <option value="0">No</option>
                      </select>
                    </Td>
                  ))}
                  <Td className="text-xs text-secondary">
                    {row.updatedBy ? `${row.updatedBy} · ${formatDateTime(row.updatedAt)}` : "—"}
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
