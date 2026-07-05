"use client";

import type { ReactNode } from "react";
import { X } from "lucide-react";

type ModalProps = {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  size?: "sm" | "md" | "lg";
  variant?: "center" | "drawer";
};

const SIZE_CLASSES = {
  sm: "max-w-sm",
  md: "max-w-lg",
  lg: "max-w-2xl",
};

export function Modal({ open, onClose, children, size = "md", variant = "center" }: ModalProps) {
  if (!open) return null;

  if (variant === "drawer") {
    return (
      <div className="fixed inset-0 z-50">
        <div className="fixed inset-0 bg-black/50" onClick={onClose} aria-hidden="true" />
        <div className="fixed inset-y-0 right-0 z-10 w-full max-w-[460px] bg-surface border-l border-border shadow-2xl overflow-y-auto animate-pop">
          {children}
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/50" onClick={onClose} aria-hidden="true" />
      <div
        className={`relative z-10 w-full ${SIZE_CLASSES[size]} bg-surface border border-border rounded-2xl shadow-2xl max-h-[90vh] overflow-y-auto animate-pop`}
      >
        {children}
      </div>
    </div>
  );
}

type ModalHeaderProps = {
  title: string;
  onClose: () => void;
};

export function ModalHeader({ title, onClose }: ModalHeaderProps) {
  return (
    <div className="px-6 py-4 border-b border-border flex items-center justify-between sticky top-0 bg-surface z-10">
      <h2 className="text-[16px] font-bold text-title">{title}</h2>
      <button
        onClick={onClose}
        className="p-2 text-disabled hover:text-main rounded-[9px] hover:bg-surface2 transition-colors"
        aria-label="Cerrar"
      >
        <X className="w-5 h-5" strokeWidth={1.8} />
      </button>
    </div>
  );
}
