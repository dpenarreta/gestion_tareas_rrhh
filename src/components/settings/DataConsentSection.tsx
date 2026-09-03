"use client";

import { useState } from "react";
import { ROLE_LABEL } from "@/lib/roles";
import type { Role } from "@/lib/roles";
import SectionCard from "@/components/settings/SectionCard";
import { Button } from "@/components/ui/Button";
import { Table, TableHead, TableBody, TableRow, Th, Td } from "@/components/ui/Table";
import { SkeletonRow, Spinner } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";
import { Modal, ModalHeader } from "@/components/ui/Modal";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";

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

/** Consentimiento de datos (LOPDP) — originalmente extraído 1:1 de SettingsManager.tsx (Sprint O). */
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
  const [editOpen, setEditOpen] = useState(false);
  const [editText, setEditText] = useState("");
  const [editLoading, setEditLoading] = useState(false);
  const [editSaving, setEditSaving] = useState(false);
  const [pendingResetUser, setPendingResetUser] = useState<User | null>(null);
  const [resettingOne, setResettingOne] = useState(false);
  const [pendingResetAll, setPendingResetAll] = useState(false);
  const [resettingAll, setResettingAll] = useState(false);

  async function openEditContent() {
    setEditOpen(true);
    setEditLoading(true);
    try {
      const res = await fetch("/api/settings/consent-text");
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        showToast(data?.error ?? "No se pudo cargar el contenido actual", "error");
        setEditOpen(false);
        return;
      }
      setEditText(data.text);
    } catch {
      showToast("Error de conexión", "error");
      setEditOpen(false);
    } finally {
      setEditLoading(false);
    }
  }

  async function handleSaveContent() {
    if (!editText.trim()) {
      showToast("El texto no puede quedar vacío", "error");
      return;
    }
    setEditSaving(true);
    try {
      const res = await fetch("/api/settings/consent-text", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: editText }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        showToast(data?.error ?? "Error al guardar el contenido", "error");
      } else {
        showToast("Contenido del tratamiento de datos actualizado.", "success");
        setEditOpen(false);
      }
    } catch {
      showToast("Error de conexión", "error");
    } finally {
      setEditSaving(false);
    }
  }

  async function handleResetConsent(user: User) {
    setBusyId(user.id);
    setResettingOne(true);
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
      setPendingResetUser(null);
      setResettingOne(false);
    }
  }

  async function handleResetConsentAll() {
    setResettingAll(true);
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
    } finally {
      setResettingAll(false);
      setPendingResetAll(false);
    }
  }

  return (
    <SectionCard title="Consentimiento de datos">
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={openEditContent}>
          ✏️ Editar contenido
        </Button>
        <Button variant="secondary" onClick={() => setPendingResetAll(true)}>
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
                      onClick={() => setPendingResetUser(u)}
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

      <Modal open={editOpen} onClose={() => setEditOpen(false)} size="lg">
        <ModalHeader title="Editar tratamiento de datos personales" onClose={() => setEditOpen(false)} />
        <div className="p-6 space-y-3">
          {editLoading ? (
            <div className="flex justify-center items-center py-8">
              <Spinner className="w-5 h-5" />
            </div>
          ) : (
            <>
              <p className="text-xs text-secondary">
                Este es el contenido (Markdown) que se muestra en el aviso de Tratamiento de Datos Personales antes
                de que un usuario acepte el consentimiento.
              </p>
              <textarea
                value={editText}
                onChange={(e) => setEditText(e.target.value)}
                rows={16}
                className="w-full border border-border rounded-lg px-3 py-2 text-sm text-title bg-surface focus:outline-none focus:ring-2 focus:ring-primary font-mono"
              />
              <div className="flex justify-end gap-2">
                <Button variant="secondary" onClick={() => setEditOpen(false)} disabled={editSaving}>
                  Cancelar
                </Button>
                <Button onClick={handleSaveContent} loading={editSaving}>
                  {editSaving ? "Guardando…" : "Guardar"}
                </Button>
              </div>
            </>
          )}
        </div>
      </Modal>

      <ConfirmDialog
        open={pendingResetUser !== null}
        title="Restablecer consentimiento"
        message={
          pendingResetUser
            ? `¿Deseas que ${pendingResetUser.name} vea nuevamente el aviso de protección de datos en su próximo login?`
            : ""
        }
        confirmLabel="Restablecer"
        loading={resettingOne}
        onConfirm={() => pendingResetUser && handleResetConsent(pendingResetUser)}
        onCancel={() => setPendingResetUser(null)}
      />

      <ConfirmDialog
        open={pendingResetAll}
        title="Restablecer todos"
        message="¿Deseas restablecer el consentimiento de protección de datos de TODOS los usuarios? Todos verán nuevamente el aviso en su próximo login — esta acción no se puede deshacer."
        confirmLabel="Restablecer todos"
        danger
        loading={resettingAll}
        onConfirm={handleResetConsentAll}
        onCancel={() => setPendingResetAll(false)}
      />
    </SectionCard>
  );
}
