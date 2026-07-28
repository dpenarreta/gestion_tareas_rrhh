# Executive Reporting Standards

> Estándar oficial del Executive Reporting Engine de NEXO — define QUÉ es
> este producto, para QUIÉN existe y bajo QUÉ principios se diseña,
> interpreta y audita. No es documentación de código (ver `ARCHITECTURE.md`
> § Reportes para eso) — es el contrato de calidad que cualquier evolución
> futura del motor debe preservar.
>
> FPS Parte V, Capítulo 1. No introduce ni modifica funcionalidad — describe
> el sistema construido en las Partes I-IV (Executive Reporting Engine 2.0,
> `docs/CHANGELOG.md` v1.22.0-v1.23.0).

---

## Filosofía del reporte

**"El reporte deberá evolucionar. Nunca reiniciarse."** — regla de oro del
FPS original, y principio rector de este estándar. Cada Executive Report es
un documento que un Director puede leer sin contexto previo y entender, en
minutos, el estado de un equipo — no una exportación de tablas ni un volcado
de KPIs.

El motor sigue un principio arquitectónico único, no negociable:
**"Analytics calcula una vez. Executive Reporting consume una vez."** Un solo
Builder canónico (`buildSnapshotData.ts`) llama a las mismas funciones que
usan Dashboard y Analytics (`computeHealthScore`, `computePerformanceScore`,
`computeDataQuality`, etc.), produce un único objeto congelado
(`ExecutiveReportSnapshotData`), y todo lo demás — NOVA, el documento en
pantalla, el PDF, el Excel, la auditoría — solo **lee** ese objeto. Ningún
consumidor recalcula nada. Esto no es una preferencia de implementación: es
lo que garantiza que un reporte generado hoy sea exactamente reproducible, y
que dos vistas del mismo período nunca puedan divergir.

## Público objetivo

El Executive Report está diseñado para **una sola persona a la vez leyendo
sin ayuda**: un Director, Gerente o Coordinador que necesita una decisión o
una confirmación, no un analista con tiempo para interpretar una hoja de
cálculo. Los tres roles habilitados a generarlo son `ADMINISTRADOR`,
`JEFE_NACIONAL` y `COORDINADOR_NACIONAL` (`CAN_ACCESS_REPORTS`,
`src/lib/roles.ts`) — ninguno de los tres es, por diseño, un rol de
ejecución operativa (`isLeadershipRole`); todos dirigen equipos, no
gestionan sus propias tareas dentro del reporte.

## Nivel ejecutivo esperado

Un lector debe poder detenerse después de la Portada + Executive Summary (2
páginas) y ya saber si el equipo está bien, en riesgo o en crisis, y por qué.
Ese es el criterio de aceptación explícito del FPS original (Parte II §15):
**"un Director debe poder leer solo Portada + Resumen + Assessment y
entender el estado del equipo."** Todo lo que sigue (Estado General,
Indicadores, Detalle, Distribución, Insights, Assessment, Recomendaciones,
Predictivo, Metadatos) es profundización progresiva para quien necesite
sustentar una decisión, nunca información obligatoria para el primer nivel
de lectura.

## Estilo de comunicación

Ver `REPORTING_NOVA_WRITING_GUIDE.md` para las reglas obligatorias de
redacción de NOVA (la única voz narrativa del reporte). En una frase: directo,
objetivo, basado en evidencia, sin jerga, sin lenguaje emocional o de venta,
nunca alarmista. El estilo no cambia según quién genere el reporte ni contra
quién se compare — es constante en las 4 secciones de NOVA (Executive
Summary, Executive Insights, Executive Assessment, enriquecimiento de
Recomendaciones).

## Principios de diseño

1. **Documento fijo, no configurable en estructura.** Las 11 páginas
   (`documentModel.ts` → `buildReportPages`) tienen un orden único que nunca
   cambia entre reportes — la personalización vive en el **contenido**
   (colaboradores/período incluidos), nunca en el **orden o la presencia**
   de una página.
2. **Una sola implementación visual.** La vista en pantalla y el PDF
   comparten el mismo render a HTML (`renderReportHtml.ts`,
   `buildExecutiveReportHtml`) — no existen dos sistemas de presentación
   para el mismo contenido. Ver `REPORTING_DESIGN_SYSTEM.md`.
3. **Todo indicador se interpreta, nunca se expone en crudo.** Un número
   sin Valor/Meta/Estado/Interpretación/Impacto/Recomendación no es un
   Executive Report — es una tabla. Esa estructura de 6 elementos
   (`IndicatorExplanation`, `reportInsights.ts`) es obligatoria para todo
   indicador nuevo que se agregue al documento en el futuro.
4. **Degradación con gracia, nunca en blanco.** Si NOVA falla, hay
   fallback determinista. Si Analytics Predictivo no aplica al período, hay
   un mensaje explicando por qué. Si el snapshot es `LEGACY_MIGRATION`, se
   marca `PARTIAL` en vez de simular datos que no existen. El documento
   nunca oculta una ausencia — la explica.

## Principios de interpretación

Todo hallazgo, insight o recomendación que el reporte muestra debe poder
responder, en orden, la cadena que exige `NOVA_BASE_RULES`
(`nova/prompts.ts`): **Datos → Interpretación → Impacto → Consecuencia →
Recomendación → Prioridad.** Un dato aislado ("cumplimiento 74%") nunca es
suficiente — el reporte siempre debe decir qué significa, por qué importa y
qué hacer. Cuando dos indicadores se relacionan (cumplimiento alto + carga
excesiva, consultas elevadas + capacidad negativa, carga baja + cumplimiento
bajo), el reporte los cruza explícitamente en vez de presentarlos aislados —
ver ejemplos completos en `REPORTING_NOVA_WRITING_GUIDE.md`.

## Principios de auditoría

Todo reporte generado debe ser, sin excepción: **identificable** (Report ID
único, formato `NXR-YYYYMMDD-HHMMSS-XXXX`), **inmutable** (una vez creado,
un `ExecutiveReportSnapshot` nunca se actualiza — congelado en runtime con
`Object.freeze` profundo y append-only en base de datos), **trazable**
(versiones de Analytics Engine/Formula Set/Reporting Engine/NEXO grabadas
dentro del propio snapshot) y **reconstruible** (el snapshot completo, no un
resumen, es lo que se persiste — ningún dato mostrado en el documento vive
solo en memoria). Ver el detalle operativo completo en
`REPORTING_AUDIT_MANUAL.md`.

---

## Definition of Product Excellence

*(FPS Parte V, Capítulo 10 — criterio de madurez del producto; toda futura
evolución del Executive Reporting Engine debe preservar estos 10 principios
simultáneamente, no solo agregar funcionalidad.)*

| Principio | Qué significa para este motor | Cómo se verifica hoy |
|---|---|---|
| **Exactitud** | Los números del reporte son exactamente los de Dashboard/Analytics para la misma fecha de corte. | Mismo Builder canónico llama a las mismas funciones de `analytics.ts` — no hay una segunda ruta de cálculo que pueda divergir. |
| **Consistencia** | El mismo período, generado dos veces con los mismos filtros, produce los mismos números (no necesariamente el mismo Report ID ni la misma narrativa NOVA, que puede variar entre llamadas a Groq). | Cero aleatoriedad en el cálculo determinista; solo NOVA tiene una superficie no determinista, y está delimitada a 4 campos narrativos, nunca a un número. |
| **Auditoría** | Todo reporte puede rastrearse: quién lo generó, cuándo, con qué filtros, con qué versión del motor. | `ExecutiveReportAuditLog` + `SnapshotMeta` — ver `REPORTING_AUDIT_MANUAL.md`. |
| **Reproducibilidad** | Un reporte leído hoy es idéntico al que se generó en su momento — nunca se recalcula al abrirlo. | `GET /api/reports/executive/[reportId]` lee `data` tal cual se persistió, nunca reconstruye. |
| **Escalabilidad** | El motor sirve tanto un reporte individual (1 colaborador) como uno consolidado (equipo completo) sin cambiar de builder. | `SnapshotRosterKind` (CONSOLIDADO/POR_AREA/INDIVIDUAL) es el mismo builder con distinto roster — ver `resolveRoster.ts`. |
| **Legibilidad** | Un Director entiende el estado del equipo en la Portada + Resumen, sin ayuda. | Criterio de aceptación explícito del FPS original — ver § Nivel ejecutivo esperado arriba. |
| **Trazabilidad** | Cada dato mostrado puede rastrearse a la versión exacta de Analytics/Fórmulas que lo produjo. | 4 campos de versión en `SnapshotMeta.versions`, visibles en Portada y Metadatos. |
| **Rendimiento** | Un reporte se genera dentro de un presupuesto de tiempo razonable. | Documentado como limitación conocida en v1.22.3 (mes en curso ~22s en frío, ~3.3s en caché) — ver `docs/AUDIT_LOG.md` § Decisión 8 y Sprint Q (`ROADMAP.md`). |
| **Mantenibilidad** | Agregar una página o un indicador no exige tocar Analytics ni duplicar lógica de render. | `documentModel.ts` es el único lugar donde vive el orden de páginas; `renderReportHtml.ts`/`renderReportExcel.ts` son las únicas implementaciones de presentación. |
| **Experiencia Ejecutiva** | El reporte se siente como un documento de consultoría, no como una exportación de sistema. | Ver `REPORTING_DESIGN_SYSTEM.md` — paleta, tipografía, espaciado y tono deliberadamente "consultora", no "panel de admin". |

Un cambio que mejora uno de estos 10 principios a costa de otro (por ejemplo,
agregar una funcionalidad que compromete la reproducibilidad, o un ajuste de
rendimiento que sacrifica exactitud) no cumple esta definición de excelencia
— debe documentarse explícitamente el trade-off en `docs/AUDIT_LOG.md`, como
ya ocurrió con la Decisión 8 (rendimiento vs. no tocar Analytics) y la
Decisión 9 (Snapshot Integrity Validation diferida) del 2026-07-28.
