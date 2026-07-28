# Benchmark de Calidad — Executive Reporting Engine

> Criterios para considerar un Executive Report aceptable, y el estado real
> del motor contra cada uno al 2026-07-28 (v1.23.0). Sirve como criterio de
> aceptación para futuras versiones — un cambio que degrade cualquiera de
> estos criterios sin compensación explícita no debería aprobarse sin
> registrar la razón en `docs/AUDIT_LOG.md`.
>
> FPS Parte V, Capítulo 8.

---

| Criterio | Qué se mide | Estado actual (v1.23.0) |
|---|---|---|
| **Claridad** | ¿Un lector sin contexto previo entiende cada afirmación sin releer? | Cumplido por diseño — NOVA prohíbe descripción sin interpretación y toda muletilla de ambigüedad (`REPORTING_NOVA_WRITING_GUIDE.md`). No hay una medición automática de legibilidad textual (p. ej. un score tipo Flesch) — el control es la disciplina del prompt, no una validación posterior. |
| **Legibilidad** | ¿El documento se puede escanear visualmente, no solo leer palabra por palabra? | Cumplido — jerarquía tipográfica de 3 niveles (eyebrow/h2/cuerpo), tarjetas KPI, badges de color, tablas con encabezados fijos (`REPORTING_DESIGN_SYSTEM.md`). |
| **Consistencia** | ¿El mismo período, regenerado, produce los mismos números? ¿Pantalla y PDF coinciden siempre? | Cumplido estructuralmente — un solo Builder canónico, un solo render HTML compartido entre pantalla y PDF (`docs/AUDIT_LOG.md` § Decisión 10a). La narrativa de NOVA sí puede variar entre llamadas a Groq (no determinista) — los NÚMEROS nunca varían, el TEXTO puede reformularse. |
| **Exactitud** | ¿Los valores coinciden con Dashboard/Analytics para la misma fecha de corte? | Cumplido por construcción — mismas funciones de `analytics.ts`. Sin validación activa de re-verificación en runtime (Sprint R, diferido — ver `REPORTING_AUDIT_MANUAL.md` § 2.1). |
| **Auditoría** | ¿Todo reporte es identificable, trazable y reconstruible? | Cumplido para generación/degradación/lectura (`generated`/`generation_failed`/`nova_degraded`/`viewed`). Brecha conocida: exportación a PDF/Excel no se audita todavía (`exported_pdf`/`exported_excel` declaradas, no emitidas — `REPORTING_AUDIT_MANUAL.md` § 8). |
| **Calidad visual** | ¿El documento se ve como un producto de consultoría, no como una exportación de sistema? | Cumplido — paleta azul corporativo, espaciado generoso, sin librería de iconos externa que pueda fallar al exportar (`REPORTING_DESIGN_SYSTEM.md`). |
| **Tiempo de generación** | ¿Se genera dentro de un presupuesto razonable? | **Parcialmente cumplido, limitación conocida y documentada.** Presupuesto original del FPS: 15s para un reporte consolidado. Medido en producción (`scripts/bench-executive-report.ts`): reporte MENSUAL del mes en curso, 9 colaboradores — **~22s en frío** (primera generación del proceso), **~3.3s en caché** (regeneración dentro de la ventana TTL). Causa raíz identificada y parcialmente mitigada sin tocar `analytics.ts`/`predictionEngine.ts` (paralelización + `cached()`, v1.22.3). Corrección completa (variantes batch) registrada como Sprint Q, pendiente — ver `ROADMAP.md`. |
| **Navegación** | ¿Es fácil ubicar un reporte pasado y volver a él? | Cumplido — historial paginado (`GET /api/reports/executive/list`), sidebar con selección directa en `MonthlyReports.tsx`, lectura inmutable por Report ID. |
| **Interpretación** | ¿Cada indicador explica qué significa, no solo cuánto vale? | Cumplido por diseño — estructura obligatoria de 6 elementos por indicador (`REPORTING_STANDARDS.md` § Principios de diseño), reglas de cadena Datos→Interpretación→Impacto→Consecuencia→Recomendación→Prioridad para toda narrativa de NOVA. |
| **Experiencia ejecutiva** | ¿Un Director puede leer solo Portada + Resumen + Assessment y entender el estado del equipo? | **Criterio de aceptación explícito del FPS original (Parte II §15), cumplido por diseño** — esas 3 secciones concentran el Estado General, el Score, y el diagnóstico estratégico completo; el resto del documento es profundización opcional. No verificado con lectores reales fuera de esta sesión de desarrollo (no se realizó una prueba de usuario formal). |

## Cómo se usa este benchmark

Antes de aprobar un cambio al Executive Reporting Engine, verificar contra
esta tabla si el cambio:

1. **Mejora** un criterio sin afectar los demás → aprobar sin más trámite.
2. **Mejora** un criterio a costa de otro (el caso más común: rendimiento
   vs. no tocar Analytics, ya ocurrido en v1.22.3) → requiere una entrada en
   `docs/AUDIT_LOG.md` documentando el trade-off explícitamente, siguiendo
   el precedente de las Decisiones 8 y 9 del 2026-07-28.
3. **Degrada** un criterio sin compensación → no cumple la Definition of
   Product Excellence (`REPORTING_STANDARDS.md` § Capítulo 10) — no debería
   aprobarse sin una razón de negocio explícita y documentada.

## Brechas conocidas al 2026-07-28 (no acciones pendientes de esta Parte V — solo transparencia)

- Tiempo de generación en frío del mes en curso, sobre presupuesto (ver fila
  arriba) — Sprint Q registrado.
- `exported_pdf`/`exported_excel` no auditados — brecha declarada, no
  priorizada (`REPORTING_AUDIT_MANUAL.md` § 8).
- Sin validación activa de integridad en runtime — Sprint R registrado.
- Sin medición automatizada de legibilidad textual ni prueba de usuario
  formal para "Claridad"/"Experiencia ejecutiva" — el cumplimiento hoy se
  apoya en el diseño del prompt y del documento, no en una métrica medida.
