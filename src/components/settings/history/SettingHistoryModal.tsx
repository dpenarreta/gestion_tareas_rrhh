"use client";

import { useEffect, useState } from "react";
import { Modal, ModalHeader } from "@/components/ui/Modal";
import { SkeletonText } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/ui/EmptyState";
import { History } from "lucide-react";

type HistoryRow = {
  key: string;
  value: string;
  validFrom: string;
  validUntil: string | null;
  updatedByName: string;
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

/** Historial de cambios genérico para cualquier setting respaldado por SystemConfigHistory — agrupado por clave. */
export default function SettingHistoryModal({
  open,
  onClose,
  label,
  configKeys,
}: {
  open: boolean;
  onClose: () => void;
  label: string;
  configKeys: string[];
}) {
  const [rows, setRows] = useState<HistoryRow[] | null>(null);

  useEffect(() => {
    if (!open) return;
    queueMicrotask(() => {
      setRows(null);
      fetch(`/api/settings/config-history?keys=${configKeys.join(",")}`)
        .then((res) => (res.ok ? res.json() : []))
        .then(setRows)
        .catch(() => setRows([]));
    });
  }, [open, configKeys]);

  return (
    <Modal open={open} onClose={onClose} size="lg">
      <ModalHeader title={`Historial — ${label}`} onClose={onClose} />
      <div className="p-6 space-y-4">
        {rows === null ? (
          <SkeletonText lines={4} />
        ) : rows.length === 0 ? (
          <EmptyState icon={History} title="Sin cambios registrados" description="Este valor nunca se modificó desde su valor por defecto." />
        ) : (
          configKeys.map((key) => {
            const keyRows = rows.filter((r) => r.key === key);
            if (keyRows.length === 0) return null;
            return (
              <div key={key} className="space-y-1.5">
                <p className="text-[11px] font-semibold text-secondary uppercase tracking-wider">{key}</p>
                <div className="rounded-lg border border-border divide-y divide-border overflow-hidden">
                  {keyRows.map((r, i) => (
                    <div key={i} className="px-4 py-2.5 flex items-center justify-between gap-3 text-sm">
                      <span className="font-medium text-title truncate">{r.value}</span>
                      <span className="text-xs text-secondary shrink-0">
                        {r.updatedByName} · {formatDate(r.validFrom)}
                        {r.validUntil === null && <span className="text-success ml-1">(vigente)</span>}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })
        )}
      </div>
    </Modal>
  );
}
