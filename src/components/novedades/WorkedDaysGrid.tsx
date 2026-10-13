"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Download, Lock, Save, Undo2, Upload } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { SearchInput } from "@/components/ui/SearchInput";
import { Spinner } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";
import { formatDate, formatDateTime, novedadesApi } from "./api";
import { ErrorBox } from "./fields";
import { PERM, STATUS_LABEL, type MatrixRow, type WorkedDaysMatrix } from "./types";
import type { ModuleContext } from "./NovedadesModule";
import StatusChangeDialog from "./StatusChangeDialog";
import ClosePeriodDialog from "./ClosePeriodDialog";
import ImportDialog from "./ImportDialog";
import CorrectionDialog from "./CorrectionDialog";

type CellError = { collaboratorId: number; date: string; message: string };
const cellKey = (collaboratorId: number, date: string) => `${collaboratorId}|${date}`;
const HOURS_RE = /^\d{0,2}([.,]\d{0,2})?$/;

export default function WorkedDaysGrid({ ctx, supervisorId }: { ctx: ModuleContext; supervisorId: number }) {
  const { showToast } = useToast();
  const [matrix, setMatrix] = useState<WorkedDaysMatrix | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [cellErrors, setCellErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");
  const [statusTarget, setStatusTarget] = useState<MatrixRow | null>(null);
  const [closeOpen, setCloseOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [correction, setCorrection] = useState<{ row: MatrixRow; date: string } | null>(null);
  const tableRef = useRef<HTMLDivElement>(null);

  const dirtyCount = Object.keys(drafts).length;

  const load = useCallback(async () => {
    setLoadError(null);
    const result = await novedadesApi.get<WorkedDaysMatrix>("worked-days", {
      period: ctx.period,
      supervisor: supervisorId,
    });
    if (result.ok) {
      setMatrix(result.data);
      setDrafts({});
      setCellErrors({});
    } else {
      setMatrix(null);
      setLoadError(result.error);
    }
  }, [ctx.period, supervisorId]);

  useEffect(() => {
    queueMicrotask(load);
  }, [load]);

  // Evita perder cambios sin guardar al cerrar o recargar la pestaña, y
  // avisa al módulo para confirmar antes de cambiar de pestaña/período.
  const { setDirty } = ctx;
  useEffect(() => {
    setDirty(dirtyCount > 0);
    if (!dirtyCount) return;
    const handler = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirtyCount, setDirty]);

  const rows = useMemo(() => {
    if (!matrix) return [];
    const q = search.trim().toLowerCase();
    if (!q) return matrix.rows;
    return matrix.rows.filter((r) => r.fullName.toLowerCase().includes(q) || r.cedula.includes(q));
  }, [matrix, search]);

  const canCorrect = ctx.can(PERM.corregir) && ctx.me.nationalWrite && matrix?.period.status === "CLOSED";
  const canManageCollaborators = ctx.can(PERM.colaboradores) && !ctx.me.isAssistant;
  const isOpen = matrix?.period.status === "OPEN";

  function valueOf(row: MatrixRow, date: string): string {
    const key = cellKey(row.collaboratorId, date);
    if (key in drafts) return drafts[key];
    return row.cells[date]?.hours ?? "";
  }

  function onCellChange(row: MatrixRow, date: string, raw: string) {
    if (!HOURS_RE.test(raw)) return;
    const key = cellKey(row.collaboratorId, date);
    const original = row.cells[date]?.hours ?? "";
    setDrafts((prev) => {
      const next = { ...prev };
      if (raw === original) delete next[key];
      else next[key] = raw;
      return next;
    });
    setCellErrors((prev) => {
      if (!(key in prev)) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    const target = e.currentTarget;
    const r = Number(target.dataset.r);
    const c = Number(target.dataset.c);
    const moves: Record<string, [number, number]> = {
      ArrowDown: [1, 0],
      Enter: [1, 0],
      ArrowUp: [-1, 0],
      ArrowRight: [0, 1],
      ArrowLeft: [0, -1],
    };
    const move = moves[e.key];
    if (!move) return;
    if ((e.key === "ArrowLeft" || e.key === "ArrowRight") && target.selectionStart !== target.selectionEnd) return;
    e.preventDefault();
    let [nr, nc] = [r + move[0], c + move[1]];
    // Salta las columnas bloqueadas (sábado/domingo) al moverse en horizontal.
    for (let guard = 0; guard < 60; guard++) {
      const next = tableRef.current?.querySelector<HTMLInputElement>(`input[data-r="${nr}"][data-c="${nc}"]`);
      if (next && !next.disabled) {
        next.focus();
        next.select();
        return;
      }
      if (!next && move[1] === 0) return;
      nr += move[0];
      nc += move[1];
      if (nc < 0 || nc > 400) return;
    }
  }

  async function save() {
    if (!matrix || !dirtyCount) return;
    setSaving(true);
    const cells = Object.entries(drafts).map(([key, hours]) => {
      const [cid, date] = key.split("|");
      const row = matrix.rows.find((r) => r.collaboratorId === Number(cid));
      return {
        collaboratorId: Number(cid),
        date,
        hours: hours.trim() === "" ? null : hours.replace(",", "."),
        version: row?.cells[date]?.version ?? null,
      };
    });
    const result = await novedadesApi.post<{ saved: number }>("worked-days/save", {
      period: matrix.period.code,
      supervisorId: matrix.supervisor.id,
      cells,
    });
    setSaving(false);
    if (result.ok) {
      showToast(`Guardado: ${result.data.saved} celda(s).`, "success");
      await load();
      return;
    }
    const detailCells = (result.details?.cells as CellError[] | undefined) ?? [];
    setCellErrors(Object.fromEntries(detailCells.map((c) => [cellKey(c.collaboratorId, c.date), c.message])));
    showToast(result.error, "error");
  }

  if (loadError) return <ErrorBox message={loadError} />;
  if (!matrix)
    return (
      <div className="flex justify-center py-16">
        <Spinner className="text-primary" />
      </div>
    );

  const firstError = Object.values(cellErrors)[0] ?? null;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="font-semibold text-title">{matrix.supervisor.name}</span>
          <span className="text-secondary">· {matrix.period.label}</span>
          {matrix.period.status === "CLOSED" ? (
            <Badge variant="neutral">
              <Lock className="w-3 h-3" /> Cerrado {formatDateTime(matrix.period.closedAt)} por {matrix.period.closedBy}
            </Badge>
          ) : matrix.period.status === "OPEN" ? (
            <Badge variant="success">Abierto</Badge>
          ) : (
            <Badge variant="warning">No habilitado</Badge>
          )}
          {!matrix.editable && matrix.period.status === "OPEN" && <Badge variant="info">Solo lectura</Badge>}
          <span className="inline-flex items-center gap-1 text-xs text-secondary">
            <span className="inline-block w-3 h-3 rounded-sm bg-yellow-200 border border-yellow-400" /> Sábado/domingo
            (no editable)
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <SearchInput value={search} onChange={setSearch} placeholder="Buscar cédula o nombre…" className="w-56" />
          {ctx.can(PERM.exportar) && (
            <Button
              variant="secondary"
              size="sm"
              onClick={async () => {
                const err = await novedadesApi.download(
                  "worked-days/export",
                  { period: matrix.period.code, supervisor: matrix.supervisor.id },
                  `dias-laborados-${matrix.period.code}.xlsx`,
                );
                if (err) showToast(err, "error");
              }}
            >
              <Download className="w-4 h-4" /> Exportar
            </Button>
          )}
          {matrix.editable && ctx.can(PERM.importar) && (
            <Button variant="secondary" size="sm" onClick={() => setImportOpen(true)}>
              <Upload className="w-4 h-4" /> Importar
            </Button>
          )}
          {(matrix.closable ?? (matrix.editable && ctx.can(PERM.cerrar))) && (
            <Button variant="secondary" size="sm" onClick={() => setCloseOpen(true)} disabled={dirtyCount > 0}>
              <Lock className="w-4 h-4" /> Cerrar período
            </Button>
          )}
        </div>
      </div>

      {matrix.editable && (
        <div
          className={`flex flex-wrap items-center justify-between gap-2 rounded-lg px-3 py-2 text-sm border ${
            dirtyCount ? "border-warning/40 bg-warning/[.08]" : "border-border bg-surface2"
          }`}
        >
          <span className={dirtyCount ? "text-warning font-medium" : "text-secondary"}>
            {dirtyCount
              ? `${dirtyCount} cambio(s) sin guardar`
              : "Sin cambios pendientes · vacío = no reportado, 0 = cero horas reportadas"}
          </span>
          <div className="flex gap-2">
            <Button
              variant="ghost"
              size="sm"
              disabled={!dirtyCount || saving}
              onClick={() => {
                setDrafts({});
                setCellErrors({});
              }}
            >
              <Undo2 className="w-4 h-4" /> Descartar
            </Button>
            <Button size="sm" onClick={save} loading={saving} disabled={!dirtyCount}>
              <Save className="w-4 h-4" /> Guardar
            </Button>
          </div>
        </div>
      )}
      <ErrorBox message={firstError} />

      {matrix.rows.length === 0 ? (
        <p className="text-sm text-secondary py-10 text-center">
          No hay colaboradores en la base de este supervisor. Regístrelos en “Base de colaboradores”.
        </p>
      ) : (
        <div ref={tableRef} className="overflow-auto max-h-[65vh] border border-border rounded-xl bg-surface">
          <table className="border-separate border-spacing-0 text-xs">
            <thead>
              <tr>
                {["Supervisor", "Cargo"].map((h) => (
                  <th key={h} rowSpan={2} className="sticky top-0 z-20 bg-surface2 border-b border-r border-border px-2 py-1.5 text-left font-semibold text-secondary whitespace-nowrap">
                    {h}
                  </th>
                ))}
                <th rowSpan={2} className="sticky top-0 left-0 z-30 bg-surface2 border-b border-r border-border px-2 py-1.5 text-left font-semibold text-secondary w-[96px] min-w-[96px]">
                  Cédula
                </th>
                <th rowSpan={2} className="sticky top-0 left-[96px] z-30 bg-surface2 border-b border-r border-border px-2 py-1.5 text-left font-semibold text-secondary min-w-[240px] whitespace-nowrap">
                  Empleado
                </th>
                {matrix.columns.map((c) => (
                  <th
                    key={c.date}
                    title={`${c.weekday} ${formatDate(c.date)}${c.holiday ? ` · Feriado: ${c.holiday}` : ""}`}
                    className={`sticky top-0 z-20 border-b border-r border-border px-1 py-1 text-center font-semibold min-w-[44px] ${
                      c.isWeekend ? "bg-yellow-200 text-yellow-900" : c.holiday ? "bg-primary-surface text-primary" : "bg-surface2 text-secondary"
                    }`}
                  >
                    <div>{String(c.day).padStart(2, "0")}</div>
                    <div className="font-normal text-[10px]">{c.weekday.slice(0, 3)}</div>
                  </th>
                ))}
                <th rowSpan={2} className="sticky top-0 z-20 bg-surface2 border-b border-border px-2 py-1.5 text-right font-semibold text-secondary">
                  Total
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, r) => {
                const rowEditable = matrix.editable;
                return (
                  <tr key={row.collaboratorId} className="group">
                    <td className="border-b border-r border-border px-2 py-1 whitespace-nowrap text-secondary">{matrix.supervisor.name}</td>
                    <td className="border-b border-r border-border px-2 py-1 whitespace-nowrap">{row.cargo}</td>
                    <td className="sticky left-0 z-10 bg-surface border-b border-r border-border px-2 py-1 font-mono w-[96px] min-w-[96px]">{row.cedula}</td>
                    <td className="sticky left-[96px] z-10 bg-surface border-b border-r border-border px-2 py-1 min-w-[240px]">
                      {/* Nombre completo, sin recortar: la columna crece con el
                          nombre más largo y las fechas se recorren con el
                          desplazamiento horizontal. */}
                      <div className="flex items-center gap-1.5 whitespace-nowrap">
                        <span title={row.fullName}>{row.fullName}</span>
                        {row.status !== "ACTIVE" && (
                          <Badge variant={row.status === "SUSPENDED" ? "warning" : "neutral"}>{STATUS_LABEL[row.status]}</Badge>
                        )}
                        {canManageCollaborators && row.isCurrentMember && isOpen && (
                          <button
                            onClick={() => setStatusTarget(row)}
                            className="ml-auto text-[10px] text-primary hover:underline opacity-0 group-hover:opacity-100 focus:opacity-100"
                            title="Cambiar estado operativo"
                          >
                            Estado
                          </button>
                        )}
                      </div>
                    </td>
                    {matrix.columns.map((c, ci) => {
                      const key = cellKey(row.collaboratorId, c.date);
                      const value = valueOf(row, c.date);
                      const dirty = key in drafts;
                      const error = cellErrors[key];
                      const hasValue = (row.cells[c.date]?.hours ?? null) !== null;
                      const otherTeam = row.cells[c.date]?.otherTeam;
                      const blocked =
                        c.isWeekend || !rowEditable || Boolean(otherTeam) || (row.status !== "ACTIVE" && !hasValue);
                      if (canCorrect && !c.isWeekend) {
                        return (
                          <td key={c.date} className="border-b border-r border-border p-0 text-center">
                            <button
                              className="w-full h-7 hover:bg-primary-surface"
                              title="Corrección autorizada (período cerrado)"
                              onClick={() => setCorrection({ row, date: c.date })}
                            >
                              {value}
                            </button>
                          </td>
                        );
                      }
                      return (
                        <td
                          key={c.date}
                          className={`border-b border-r border-border p-0 ${c.isWeekend ? "bg-yellow-200" : ""} ${
                            error ? "bg-danger/[.15]" : dirty ? "bg-warning/[.18]" : ""
                          }`}
                          title={
                            error ??
                            (c.isWeekend
                              ? "Sábado/domingo: no admite registros"
                              : otherTeam
                                ? `Registrado por el equipo de ${otherTeam} (colaborador reasignado): no se modifica desde aquí`
                                : undefined)
                          }
                        >
                          <input
                            data-r={r}
                            data-c={ci}
                            value={value}
                            disabled={blocked}
                            inputMode="decimal"
                            aria-label={`${row.fullName} ${formatDate(c.date)}`}
                            onChange={(e) => onCellChange(row, c.date, e.target.value)}
                            onKeyDown={onKeyDown}
                            onFocus={(e) => e.target.select()}
                            className={`w-full h-7 px-1 text-center bg-transparent focus:outline-none focus:ring-2 focus:ring-primary focus:ring-inset ${
                              c.isWeekend ? "cursor-not-allowed text-yellow-900" : blocked ? "cursor-not-allowed text-secondary" : "text-title"
                            }`}
                          />
                        </td>
                      );
                    })}
                    <td className="border-b border-border px-2 py-1 text-right font-semibold">{row.totalHours}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {statusTarget && (
        <StatusChangeDialog
          collaborator={{ id: statusTarget.collaboratorId, fullName: statusTarget.fullName, status: statusTarget.status }}
          onClose={() => setStatusTarget(null)}
          onDone={() => {
            setStatusTarget(null);
            load();
          }}
        />
      )}
      {closeOpen && (
        <ClosePeriodDialog
          period={matrix.period.code}
          supervisorId={matrix.supervisor.id}
          onClose={() => setCloseOpen(false)}
          onClosed={() => {
            setCloseOpen(false);
            ctx.refreshPeriods();
            load();
          }}
        />
      )}
      {importOpen && (
        <ImportDialog
          kind="WORKED_DAYS"
          period={matrix.period.code}
          supervisorId={matrix.supervisor.id}
          periodRange={{ startDate: matrix.period.startDate, endDate: matrix.period.endDate, label: matrix.period.label }}
          onClose={() => setImportOpen(false)}
          onImported={() => {
            setImportOpen(false);
            load();
          }}
        />
      )}
      {correction && (
        <CorrectionDialog
          target="WORKED_DAY"
          title={`${correction.row.fullName} · ${formatDate(correction.date)}`}
          currentValue={correction.row.cells[correction.date]?.hours ?? ""}
          payload={{
            collaboratorId: correction.row.collaboratorId,
            supervisorId: matrix.supervisor.id,
            date: correction.date,
          }}
          onClose={() => setCorrection(null)}
          onDone={() => {
            setCorrection(null);
            load();
          }}
        />
      )}
    </div>
  );
}
