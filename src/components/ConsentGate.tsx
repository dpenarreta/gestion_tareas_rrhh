"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { marked } from "marked";
import DOMPurify from "dompurify";
import { useToast } from "@/components/ui/Toast";

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

// Pedido explícito del usuario (ver docs/AUDIT_LOG.md § 2026-09-02,
// "Consentimiento de datos editable desde Ajustes"): réplica EXACTA del
// texto que estaba hardcodeado acá — se usa como respaldo si
// `GET /api/settings/consent-text` falla, para no dejar el modal sin
// contenido legible por un problema de red transitorio.
const FALLBACK_CONSENT_TEXT = `Nexo recopila y almacena los siguientes datos personales con el fin de gestionar los recursos humanos de la organización:

- Datos de identificación: nombre completo y correo electrónico
- Datos de actividad laboral: tareas, horas trabajadas, actividades de seguimiento y KPIs de desempeño
- Datos de asistencia y permisos: registro de vacaciones, permisos personales y permisos médicos
- Datos de condición laboral especial: estados de maternidad o lactancia que afectan la jornada laboral

Los datos de salud (permisos médicos, maternidad y lactancia) son tratados exclusivamente por el Administrador del sistema con la finalidad de calcular correctamente la carga laboral y KPIs, conforme al Art. 26 de la Ley Orgánica de Protección de Datos Personales del Ecuador.

Tus datos no son compartidos con terceros comerciales. El asistente utiliza el servicio de IA Gemini de Google LLC para procesar consultas; las preguntas que realices pueden ser enviadas a dicho servicio para generar respuestas.

Puedes ejercer tus derechos de acceso, rectificación y eliminación desde tu perfil en la sección "Mis derechos sobre mis datos".`;

function ConsentModal({ onAccept }: { onAccept: () => void }) {
  const router = useRouter();
  const { showToast } = useToast();
  const [checked, setChecked] = useState(false);
  const [loading, setLoading] = useState(false);
  const [reachedEnd, setReachedEnd] = useState(false);
  const [html, setHtml] = useState("");
  const [textLoading, setTextLoading] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Pedido explícito del usuario (ver docs/AUDIT_LOG.md § 2026-09-02): el
  // checkbox marcado por sí solo no alcanza como consentimiento real — hay
  // que haber llegado al final del texto. `checked` y `reachedEnd` son
  // condiciones independientes, ambas obligatorias (ver `disabled` del
  // botón más abajo).
  function checkReachedEnd(el: HTMLDivElement) {
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 4) setReachedEnd(true);
  }

  // El contenido ahora es editable desde Ajustes (ver
  // `DataConsentSection.tsx` → "Editar contenido") en vez de estar
  // hardcodeado — se trae como Markdown y se sanitiza con DOMPurify antes
  // de `dangerouslySetInnerHTML`, mismo criterio ya establecido en
  // `DocumentationSection.tsx` (ver docs/AUDIT_LOG.md § 2026-09-01, NEXO-03).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      let text = FALLBACK_CONSENT_TEXT;
      try {
        const res = await fetch("/api/settings/consent-text");
        const data = await res.json().catch(() => null);
        if (res.ok && typeof data?.text === "string" && data.text.trim()) {
          text = data.text;
        }
      } catch {
        // sin conexión — se queda con FALLBACK_CONSENT_TEXT.
      }
      try {
        const rawHtml = await marked.parse(text);
        if (!cancelled) setHtml(DOMPurify.sanitize(rawHtml));
      } catch {
        // Si el parseo de Markdown falla por cualquier motivo, se muestra
        // el texto plano sin formato en vez de dejar `textLoading` en
        // `true` para siempre (modal cargando eternamente).
        if (!cancelled) setHtml(`<p>${text.replace(/</g, "&lt;")}</p>`);
      } finally {
        if (!cancelled) setTextLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Si el texto (ya cargado) entra completo sin necesidad de scroll
  // (pantalla alta, texto corto), `onScroll` nunca se dispara — se
  // verifica también acá, DESPUÉS de que el contenido real ya está en el
  // DOM (chequearlo antes, con el contenedor todavía vacío mientras
  // carga, daría un falso positivo: "ya se ve todo" cuando en realidad no
  // hay nada que ver todavía).
  useEffect(() => {
    if (!textLoading && scrollRef.current) checkReachedEnd(scrollRef.current);
  }, [textLoading]);

  // Hallazgo real (ver docs/AUDIT_LOG.md § 2026-09-02, "ConsentGate no
  // mostraba ningún error si el PATCH fallaba"): antes de este fix, un
  // fallo acá (ej. sesión de Django todavía sin refrescar) dejaba al
  // usuario sin ninguna señal — el botón volvía a "Aceptar y continuar"
  // en silencio, indistinguible de no haber hecho clic. Ahora se muestra
  // el error real y se reintenta la llamada una vez automáticamente,
  // porque el caso más común es justo el token de Django recién
  // refrescándose en el primer intento tras el login.
  async function handleAccept() {
    setLoading(true);
    try {
      let res = await fetch("/api/auth/consent", { method: "PATCH" });
      if (!res.ok && res.status === 401) {
        res = await fetch("/api/auth/consent", { method: "PATCH" });
      }
      if (res.ok) {
        onAccept();
        return;
      }
      const data = await res.json().catch(() => null);
      showToast(data?.error ?? "No se pudo registrar el consentimiento. Intenta de nuevo.", "error");
    } catch {
      showToast("Error de conexión. Intenta de nuevo.", "error");
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

        <div
          ref={scrollRef}
          onScroll={(e) => checkReachedEnd(e.currentTarget)}
          className="px-6 py-5 max-h-[50vh] overflow-y-auto [&_p]:text-sm [&_p]:text-main [&_p]:mb-4 [&_p:last-child]:mb-0 [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:mb-4 [&_ul]:space-y-1 [&_li]:text-sm [&_li]:text-main [&_strong]:font-semibold [&_strong]:text-title"
        >
          {textLoading ? (
            <div className="space-y-2 animate-pulse">
              <div className="h-3 bg-surface2 rounded" />
              <div className="h-3 bg-surface2 rounded w-5/6" />
              <div className="h-3 bg-surface2 rounded w-4/6" />
            </div>
          ) : (
            <div dangerouslySetInnerHTML={{ __html: html }} />
          )}
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

          {!reachedEnd && (
            <p className="text-xs text-disabled">
              Desplázate hasta el final del texto para poder aceptar.
            </p>
          )}

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
              disabled={!checked || !reachedEnd || loading}
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
