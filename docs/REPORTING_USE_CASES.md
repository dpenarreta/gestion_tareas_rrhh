# Casos de Uso Oficiales — Executive Reporting Engine

> Escenarios reales de utilización del Executive Report dentro de NEXO. Nota
> de alcance: solo 3 roles pueden generar/leer reportes hoy
> (`CAN_ACCESS_REPORTS`, `src/lib/roles.ts`): `ADMINISTRADOR`,
> `JEFE_NACIONAL`, `COORDINADOR_NACIONAL`. Los 6 casos de uso que pide el FPS
> no son 6 roles distintos de NEXO — son 6 **propósitos** con los que esos 3
> roles usan el mismo motor. Se documentan así para no inventar roles o
> permisos que no existen en el sistema.
>
> FPS Parte V, Capítulo 5.

---

## 1. Gerencia General

**Rol que lo ejecuta:** `ADMINISTRADOR` / `JEFE_NACIONAL`.

**Objetivo:** entender, en una sola lectura, el estado operativo de toda la
organización sin necesitar contexto adicional de ningún coordinador.

**Información consultada:** Reporte Ejecutivo Consolidado (`SnapshotRosterKind:
CONSOLIDADO`, todo el roster visible), tipo MENSUAL del mes en curso — Portada
+ Executive Summary + Executive Assessment cubren el 100% de la necesidad
informativa en el caso típico.

**Decisiones que soporta:** priorización de foco directivo entre áreas,
identificación temprana de riesgo de sobrecarga o incumplimiento antes de
que escale, validación de que la organización opera dentro de rango.

**Valor agregado:** reemplaza la necesidad de pedir un resumen manual a cada
coordinador — el Índice Ejecutivo del Equipo (Portada) y el Executive
Assessment (página 8) sintetizan lo que antes requería una reunión.

---

## 2. Dirección Nacional

**Rol que lo ejecuta:** `JEFE_NACIONAL`.

**Objetivo:** supervisar el desempeño consolidado nacional y compararlo en
el tiempo (tendencia mes a mes, trimestre, semestre).

**Información consultada:** Reporte Mensual (tendencias mes anterior/
trimestre/semestre, panel complementario en `MonthlyReports.tsx`) y Reporte
de Rango de Meses (evolución mensual con gráfico de línea, `rangeTrend`,
`problematicMonths`) — el caso de uso que más se apoya en la comparación
temporal, no solo en la foto de un mes.

**Decisiones que soporta:** ajuste de metas/objetivos institucionales,
identificación de meses problemáticos recurrentes, evaluación de si una
intervención anterior tuvo el efecto esperado (comparando el período previo
contra el actual).

**Valor agregado:** el gráfico de evolución y el banner de tendencia
(`RangeEvolutionPanel`) hacen visible en segundos un patrón que, leído mes a
mes en informes separados, tomaría mucho más tiempo detectar.

---

## 3. Coordinación Nacional

**Rol que lo ejecuta:** `COORDINADOR_NACIONAL`.

**Objetivo:** gestionar directamente el desempeño del equipo bajo su
coordinación, con el nivel de detalle suficiente para actuar sobre
colaboradores específicos.

**Información consultada:** Reporte por Área o Individual
(`SnapshotRosterKind: POR_ÁREA`/`INDIVIDUAL`, vía filtros de rol o
colaboradores específicos, o el Generador Inteligente de Reportes/
`ReportWizardModal.tsx`) — página 5 (Detalle por Colaborador) y página 9
(Recomendaciones) son las de mayor uso en este caso.

**Decisiones que soporta:** conversaciones de desempeño 1:1 respaldadas en
datos objetivos, redistribución de carga entre colaboradores del mismo
cargo (ver `docs/AUDIT_LOG.md` § Compatibilidad Organizacional —
`computeTeamRecommendations` nunca sugiere redistribución vertical),
seguimiento de un colaborador puntual marcado en Alertas de Gestión.

**Valor agregado:** el mismo motor que genera el reporte consolidado de
Gerencia General produce, con un filtro distinto, el nivel de detalle
operativo que necesita un coordinador — sin una segunda herramienta ni un
segundo cálculo.

---

## 4. Auditoría

**Rol que lo ejecuta:** cualquiera de los 3 roles habilitados, típicamente
`ADMINISTRADOR`.

**Objetivo:** verificar que un reporte específico, generado en el pasado,
sea reconstruible y trazable — quién lo generó, con qué versión del motor,
sobre qué datos.

**Información consultada:** página 11 (Metadatos) de un reporte específico
identificado por Report ID, más el historial de `ExecutiveReportAuditLog`
asociado (acciones `generated`/`viewed`/`nova_degraded`/`generation_failed`)
— ver `REPORTING_AUDIT_MANUAL.md` para el procedimiento completo.

**Decisiones que soporta:** validación de cumplimiento de un proceso
(¿se generó el informe del mes X a tiempo?), investigación de una
discrepancia reportada, verificación de que un reporte histórico no fue
alterado (inmutabilidad — un `ExecutiveReportSnapshot` nunca se actualiza).

**Valor agregado:** el Report ID único y la fecha de corte real permiten
responder "¿qué vio exactamente esta persona en este reporte, en este
momento?" sin ambigüedad — algo que una tabla `MonthlyReport` sobrescribible
(el modelo legacy) no podía garantizar.

---

## 5. Gestión Humana

**Rol que lo ejecuta:** típicamente `COORDINADOR_NACIONAL` con foco en
áreas de Gestión Humana, o `JEFE_NACIONAL` consolidando esa área.

**Objetivo:** monitorear indicadores propios de la función de RRHH dentro
del equipo operativo — distribución de consultas, carga administrativa,
equilibrio operativo.

**Información consultada:** página 6 (Distribución Operativa — Distribución
por Motivo, con motivos como "Novedades de pago", "Solicitud de vacaciones",
"Reclutamiento/Selección") y página 3 (Estado General — Equilibrio
Operativo).

**Decisiones que soporta:** identificación de picos de demanda por tipo de
consulta, evaluación de si la carga administrativa está concentrada en pocas
personas (riesgo de continuidad), input para decisiones de dotación.

**Valor agregado:** la interpretación automática de cada motivo
(`explainMotivoDistribution`, `reportInsights.ts`) ya incluye tendencia
respecto al período anterior — Gestión Humana no necesita cruzar manualmente
dos informes para ver si un tipo de consulta está creciendo.

---

## 6. Planeación

**Rol que lo ejecuta:** cualquiera de los 3 roles habilitados, usando el
Reporte de Rango o el Analytics Predictivo.

**Objetivo:** proyectar hacia adelante y planificar con base en tendencia,
no solo en el estado actual.

**Información consultada:** página 10 (Analytics Predictivo — proyección de
cumplimiento, probabilidad de sobrecarga, subutilización por colaborador,
disponible solo para el mes calendario en curso) y Reporte de Rango de
Meses para la tendencia histórica que sustenta esa proyección.

**Decisiones que soporta:** anticipación de riesgo de sobrecarga antes de
que ocurra (colaboradores marcados con "Sobrecarga: Alto" en la proyección),
planificación de capacidad para el cierre del período, priorización de
intervenciones preventivas en vez de reactivas.

**Valor agregado:** integra visualmente el motor de predicción por
colaborador ya existente (`predictionEngine.ts`) directamente en el
documento ejecutivo — antes de v1.22.1 esta información solo vivía en
`/inteligencia-preventiva`, separada del flujo de reportes. Nota de alcance
vigente: los 3 escenarios de equipo (Esperado/Preventivo/Optimista) que
describe el FPS siguen pendientes — no existe aún una síntesis a nivel de
equipo, solo por colaborador (ver `ROADMAP.md` § En desarrollo).
