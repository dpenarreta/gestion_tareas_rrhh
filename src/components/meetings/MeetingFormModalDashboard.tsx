"use client";

import { useState, useEffect } from "react";
import type { Role } from "@/generated/prisma/client";
import { ROLE_LABEL } from "@/lib/roles";
import TimeInput24 from "@/components/ui/TimeInput24";

type AssignableUser = { id: string; name: string; email: string; role: Role };

export default function MeetingFormModalDashboard({
  onClose,
  onSaved,
  currentUserId,
}: {
  onClose: () => void;
  onSaved: () => void;
  currentUserId: string;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [time, setTime] = useState("09:00");
  const [duration, setDuration] = useState(40);
  const [users, setUsers] = useState<AssignableUser[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/users/assignable")
      .then((r) => r.json())
      .then((all: AssignableUser[]) => setUsers(all.filter((u) => u.id !== currentUserId)));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function toggle(id: string) {
    setSelectedIds((p) => p.includes(id) ? p.filter((x) => x !== id) : [...p, id]);
  }

  function toggleAll() {
    setSelectedIds((p) => (p.length === users.length ? [] : users.map((u) => u.id)));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!title.trim()) { setError("El título es obligatorio"); return; }
    setSaving(true);
    try {
      const res = await fetch("/api/meetings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim() || null,
          meetingDate: new Date(`${date}T${time}:00`).toISOString(),
          duration,
          inviteeIds: selectedIds,
        }),
      });
      const data = await res.json();
      if (!res.ok) setError(data.error ?? "Error al crear reunión");
      else {
        if (data.zoomWarning) alert(data.zoomWarning);
        onSaved();
      }
    } catch { setError("Error de conexión"); }
    finally { setSaving(false); }
  }

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-surface rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <h2 className="text-base font-semibold text-title">Nueva reunión</h2>
          <button onClick={onClose} className="p-1.5 hover:bg-black/5 dark:hover:bg-white/5 rounded-lg transition-colors">
            <svg className="w-4 h-4 text-secondary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
          <div>
            <label className="block text-xs font-semibold text-main mb-1.5">Título *</label>
            <input required value={title} onChange={(e) => setTitle(e.target.value)}
              placeholder="Ej. Reunión de seguimiento"
              className="w-full px-3 py-2 text-sm text-title bg-surface border border-border rounded-xl focus:outline-none focus:ring-2 focus:ring-primary" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-main mb-1.5">Descripción</label>
            <textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)}
              placeholder="Agenda u objetivo (opcional)"
              className="w-full px-3 py-2 text-sm text-title bg-surface border border-border rounded-xl focus:outline-none focus:ring-2 focus:ring-primary resize-none" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-main mb-1.5">Fecha *</label>
              <input required type="date" value={date} onChange={(e) => setDate(e.target.value)}
                className="w-full px-3 py-2 text-sm text-title bg-surface border border-border rounded-xl focus:outline-none focus:ring-2 focus:ring-primary" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-main mb-1.5">Hora *</label>
              <TimeInput24 required value={time} onChange={setTime}
                selectClassName="w-full px-3 py-2 text-sm text-title bg-surface border border-border rounded-xl focus:outline-none focus:ring-2 focus:ring-primary" />
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold text-main mb-1.5">Duración</label>
            <div className="flex gap-2">
              {([
                { value: 30, label: "30 min" },
                { value: 40, label: "40 min (máx. recomendado)" },
              ] as { value: number; label: string }[]).map(({ value, label }) => (
                <button key={value} type="button" onClick={() => setDuration(value)}
                  className={`flex-1 py-2 text-xs font-medium rounded-xl border transition-colors ${duration === value ? "bg-primary text-white border-primary" : "text-main border-border hover:border-primary/40"}`}>
                  {label}
                </button>
              ))}
            </div>
            <p className="mt-1.5 text-[11px] text-warning">⚠️ Plan Zoom gratuito: máximo 40 minutos con más de 2 participantes</p>
          </div>
          <div>
            <label className="block text-xs font-semibold text-main mb-1.5">Invitados ({selectedIds.length})</label>
            <div className="border border-border rounded-xl overflow-hidden max-h-36 overflow-y-auto">
              {users.length > 0 && (
                <label className="flex items-center gap-3 px-3 py-2 hover:bg-black/5 dark:hover:bg-white/5 cursor-pointer border-b border-border bg-background/50">
                  <input
                    type="checkbox"
                    checked={selectedIds.length === users.length}
                    onChange={toggleAll}
                    className="rounded"
                  />
                  <p className="text-sm font-medium text-title">Invitar a todos</p>
                </label>
              )}
              {users.map((u) => (
                <label key={u.id} className="flex items-center gap-3 px-3 py-2 hover:bg-black/5 dark:hover:bg-white/5 cursor-pointer border-b border-border last:border-0">
                  <input type="checkbox" checked={selectedIds.includes(u.id)} onChange={() => toggle(u.id)} className="rounded" />
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-title truncate">{u.name}</p>
                    <p className="text-[10px] text-disabled">{ROLE_LABEL[u.role]}</p>
                  </div>
                </label>
              ))}
            </div>
          </div>
          {error && <p className="text-sm text-danger bg-danger/[.09] px-3 py-2 rounded-xl">{error}</p>}
          <div className="flex gap-3 pt-1">
            <button type="submit" disabled={saving}
              className="flex-1 py-2.5 bg-primary hover:bg-primary-hover disabled:opacity-50 text-white text-sm font-medium rounded-xl transition-colors">
              {saving ? "Creando…" : "Crear reunión"}
            </button>
            <button type="button" onClick={onClose}
              className="px-4 py-2.5 text-sm font-medium text-main hover:bg-black/5 dark:hover:bg-white/5 rounded-xl transition-colors">
              Cancelar
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
