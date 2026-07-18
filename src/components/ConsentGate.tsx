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

        <div className="px-6 py-5 space-y-4 max-h-[50vh] overflow-y-auto">
          <p className="text-sm text-main">
            Nexo recopila y almacena los siguientes datos personales con el fin de
            gestionar los recursos humanos de la organización:
          </p>
          <ul className="text-sm text-main list-disc pl-5 space-y-1">
            <li>Datos de identificación: nombre completo y correo electrónico</li>
            <li>
              Datos de actividad laboral: tareas, horas trabajadas, actividades de
              seguimiento y KPIs de desempeño
            </li>
            <li>
              Datos de asistencia y permisos: registro de vacaciones, permisos
              personales y permisos médicos
            </li>
            <li>
              Datos de condición laboral especial: estados de maternidad o lactancia
              que afectan la jornada laboral
            </li>
          </ul>
          <p className="text-sm text-main">
            Los datos de salud (permisos médicos, maternidad y lactancia) son tratados
            exclusivamente por el Administrador del sistema con la finalidad de
            calcular correctamente la carga laboral y KPIs, conforme al Art. 26 de la
            Ley Orgánica de Protección de Datos Personales del Ecuador.
          </p>
          <p className="text-sm text-main">
            Tus datos no son compartidos con terceros comerciales. El asistente Nova
            utiliza el servicio de IA de Groq Inc. para procesar consultas; las
            preguntas que realices pueden ser enviadas a dicho servicio para generar
            respuestas.
          </p>
          <p className="text-sm text-main">
            Puedes ejercer tus derechos de acceso, rectificación y eliminación desde tu
            perfil en la sección &ldquo;Mis derechos sobre mis datos&rdquo;.
          </p>
        </div>

        <div className="px-6 py-4 border-t border-border space-y-4">
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

          <div className="flex items-center justify-end gap-3">
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
