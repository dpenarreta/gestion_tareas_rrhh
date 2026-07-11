"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function ConsentGate({
  initialAccepted,
  children,
}: {
  initialAccepted: boolean;
  children: React.ReactNode;
}) {
  const [accepted, setAccepted] = useState(initialAccepted);

  // Mientras no se acepte el consentimiento, no se renderiza el resto de la
  // aplicación: evita que se disparen llamadas a APIs de datos y que quede
  // contenido visible detrás del modal.
  if (!accepted) {
    return <ConsentModal onAccept={() => setAccepted(true)} />;
  }

  return <>{children}</>;
}

function ConsentModal({ onAccept }: { onAccept: () => void }) {
  const router = useRouter();
  const [checked, setChecked] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleAccept() {
    setLoading(true);
    try {
      const res = await fetch("/api/auth/consent", { method: "PATCH" });
      if (res.ok) {
        onAccept();
      }
    } finally {
      setLoading(false);
    }
  }

  async function handleReject() {
    setLoading(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } finally {
      router.push("/login?consentRejected=1");
      router.refresh();
    }
  }

  return (
    <div className="fixed inset-0 z-[70] bg-background flex items-center justify-center p-4">
      <div className="bg-surface rounded-2xl shadow-xl w-full max-w-lg border border-border">
        <div className="px-6 py-4 border-b border-border">
          <h2 className="text-base font-semibold text-title">
            Tratamiento de Datos Personales
          </h2>
        </div>

        <div className="px-6 py-5 space-y-4">
          <p className="text-sm text-main">
            Nexo recopila y almacena datos personales (nombre, correo electrónico y
            actividad laboral) con el fin de gestionar los recursos humanos de la
            organización, conforme a lo establecido en la Ley Orgánica de Protección de
            Datos Personales del Ecuador. Tus datos son procesados internamente. El
            asistente Nova utiliza el servicio de IA de Groq Inc. para procesar consultas;
            las preguntas que realices pueden ser enviadas a dicho servicio para generar
            respuestas. Tus datos se conservan mientras mantengas una cuenta activa en el
            sistema.
          </p>

          <label className="flex items-start gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={checked}
              onChange={(e) => setChecked(e.target.checked)}
              className="w-4 h-4 mt-0.5 rounded border-border text-primary accent-primary"
            />
            <span className="text-sm text-main">
              He leído y acepto el tratamiento de mis datos personales
            </span>
          </label>

          <div className="flex items-center justify-end gap-3 pt-1">
            <button
              type="button"
              onClick={handleReject}
              disabled={loading}
              className="px-4 py-2 text-sm font-medium text-main border border-border rounded-lg hover:bg-black/5 dark:hover:bg-white/5 disabled:opacity-50 transition-colors"
            >
              Rechazar y salir
            </button>
            <button
              type="button"
              onClick={handleAccept}
              disabled={!checked || loading}
              className="px-4 py-2 text-sm font-medium text-white bg-primary rounded-lg hover:bg-primary-hover disabled:opacity-50 transition-colors"
            >
              {loading ? "Procesando..." : "Aceptar y continuar"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
