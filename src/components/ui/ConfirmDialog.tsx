"use client";

import { Modal, ModalHeader } from "./Modal";
import { Button } from "./Button";

type ConfirmDialogProps = {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

/**
 * Reemplaza `confirm()`/`window.confirm()` nativo (usado hasta ahora en 13
 * archivos) — un diálogo nativo bloquea la pestaña completa del navegador
 * sin poder estilizarse, inconsistente con el resto de la app (que ya usa
 * `Modal`/`ModalHeader` para toda otra confirmación, ver
 * `RolesPermissionsManager.tsx`).
 */
export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = "Confirmar",
  cancelLabel = "Cancelar",
  danger = false,
  loading = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  return (
    <Modal open={open} onClose={onCancel} size="sm">
      <ModalHeader title={title} onClose={onCancel} />
      <div className="px-6 py-5 space-y-4">
        <p className="text-sm text-main">{message}</p>
        <div className="flex items-center justify-end gap-3">
          <Button variant="secondary" onClick={onCancel} disabled={loading}>
            {cancelLabel}
          </Button>
          <Button variant={danger ? "destructive" : "primary"} onClick={onConfirm} loading={loading}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
