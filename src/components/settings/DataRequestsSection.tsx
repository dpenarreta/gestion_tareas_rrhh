"use client";

import { useState, useEffect, useCallback } from "react";
import { ROLE_LABEL } from "@/lib/roles";
import type { Role, DataRequestType, DataRequestStatus } from "@/generated/prisma/client";
import SectionCard from "@/components/settings/SectionCard";
import { Table, TableHead, TableBody, TableRow, Th, Td } from "@/components/ui/Table";
import { SkeletonRow } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/ui/EmptyState";
import { ClipboardList } from "lucide-react";

type DataRequestRow = {
  id: string;
  type: DataRequestType;
  status: DataRequestStatus;
  description: string | null;
  createdAt: string;
  resolvedAt: string | null;
  user: { id: string; name: string; role: Role };
  resolver: { id: string; name: string } | null;
};

const REQUEST_TYPE_LABEL: Record<DataRequestType, string> = {
  ACCESO: "Acceso a datos",
  RECTIFICACION: "Rectificación",
  ELIMINACION: "Eliminación de cuenta",
};

const REQUEST_STATUS_LABEL: Record<DataRequestStatus, string> = {
  PENDIENTE: "Pendiente",
  EN_PROCESO: "En proceso",
  RESUELTA: "Resuelta",
};

const REQUEST_STATUS_CLASS: Record<DataRequestStatus, string> = {
  PENDIENTE: "text-warning bg-warning/[.15]",
  EN_PROCESO: "text-primary bg-primary-surface",
  RESUELTA: "text-success bg-success/[.13]",
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

/** Solicitudes de titulares de datos (LOPDP) — extraído 1:1 de SettingsManager.tsx (Sprint O), sin cambios de lógica. */
export default function DataRequestsSection() {
  const [dataRequests, setDataRequests] = useState<DataRequestRow[]>([]);
  const [dataRequestsLoading, setDataRequestsLoading] = useState(true);
  const [dataRequestBusyId, setDataRequestBusyId] = useState<string | null>(null);

  const loadDataRequests = useCallback(async () => {
    setDataRequestsLoading(true);
    try {
      const res = await fetch("/api/data-requests");
      if (res.ok) setDataRequests(await res.json());
    } finally {
      setDataRequestsLoading(false);
    }
  }, []);

  useEffect(() => {
    queueMicrotask(loadDataRequests);
  }, [loadDataRequests]);

  async function handleUpdateRequestStatus(request: DataRequestRow, status: DataRequestStatus) {
    setDataRequestBusyId(request.id);
    try {
      const res = await fetch(`/api/data-requests/${request.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (res.ok) {
        const updated = await res.json();
        setDataRequests((prev) => prev.map((r) => (r.id === request.id ? updated : r)));
      }
    } finally {
      setDataRequestBusyId(null);
    }
  }

  return (
    <SectionCard title="Solicitudes de titulares">
      <p className="text-xs text-secondary">
        Solicitudes de acceso, rectificación y eliminación enviadas por los usuarios desde su perfil.
      </p>
      <div className="rounded-lg border border-border overflow-hidden">
        {dataRequestsLoading ? (
          <div>
            <SkeletonRow columns={5} />
            <SkeletonRow columns={5} />
            <SkeletonRow columns={5} />
          </div>
        ) : dataRequests.length === 0 ? (
          <EmptyState icon={ClipboardList} title="Sin solicitudes registradas" description="No hay solicitudes de titulares registradas." />
        ) : (
          <Table>
            <TableHead>
              <TableRow>
                <Th>Usuario</Th>
                <Th>Tipo</Th>
                <Th>Fecha</Th>
                <Th>Estado</Th>
                <Th className="text-right">Acción</Th>
              </TableRow>
            </TableHead>
            <TableBody>
              {dataRequests.map((r) => (
                <TableRow key={r.id}>
                  <Td className="text-title font-medium">
                    {r.user.name}
                    <span className="ml-2 text-xs text-disabled">{ROLE_LABEL[r.user.role]}</span>
                    {r.description && (
                      <span className="block text-xs text-secondary mt-0.5 max-w-xs truncate" title={r.description}>
                        {r.description}
                      </span>
                    )}
                  </Td>
                  <Td className="text-secondary">{REQUEST_TYPE_LABEL[r.type]}</Td>
                  <Td className="text-secondary">{formatDate(r.createdAt)}</Td>
                  <Td>
                    <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${REQUEST_STATUS_CLASS[r.status]}`}>
                      {REQUEST_STATUS_LABEL[r.status]}
                    </span>
                  </Td>
                  <Td className="text-right">
                    {r.status !== "RESUELTA" ? (
                      <button
                        onClick={() => handleUpdateRequestStatus(r, "RESUELTA")}
                        disabled={dataRequestBusyId === r.id}
                        className="text-xs text-success hover:brightness-90 font-medium px-2 py-1 rounded hover:bg-success/[.13] transition-colors disabled:opacity-50"
                      >
                        ✓ Marcar resuelta
                      </button>
                    ) : (
                      <span className="text-xs text-disabled">
                        {r.resolver ? `Resuelta por ${r.resolver.name}` : "Resuelta"}
                      </span>
                    )}
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
