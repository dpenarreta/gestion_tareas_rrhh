# Reference Report Library

> Biblioteca oficial de ejemplos del Executive Report — referencia de cómo
> se ve cada página y cada sección con contenido real, para que cualquier
> evolución futura pueda compararse contra un ejemplo concreto en vez de
> contra una descripción abstracta. Los ejemplos son ilustrativos (datos
> ficticios, con nombres de ejemplo), pero la ESTRUCTURA de cada uno es
> exactamente la que produce `buildReportPages` (`documentModel.ts`) sobre
> un `ExecutiveReportSnapshotData` real — no hay campos inventados aquí que
> no existan en el tipo.
>
> FPS Parte V, Capítulo 4.

---

## Las 3 variantes de alcance (`SnapshotRosterKind`)

El motor no tiene 3 builders distintos — el mismo builder, invocado con un
roster distinto, produce 3 experiencias:

| Alcance | Cómo se obtiene | Ejemplo de uso |
|---|---|---|
| **CONSOLIDADO** | Sin filtro de `roles`/`areas`/`colaboradores` — todo el roster visible del generador. | "Reporte Ejecutivo — Julio 2026" para todo el equipo de un Coordinador Nacional. |
| **POR_ÁREA** | Con `roles`/`areas` filtrando a un subconjunto de cargos, o con `colaboradores` apuntando a más de una persona. | "Reporte Ejecutivo — Asistentes de Gestión Humana — Julio 2026". |
| **INDIVIDUAL** | `colaboradores` con un único ID. | "Reporte Ejecutivo — Ana Torres — Julio 2026". |

Las 11 páginas son las mismas en los 3 casos — lo que cambia es cuántas filas
tiene la tabla de Detalle por Colaborador y el Ranking (una sola fila en
INDIVIDUAL).

---

## 1. Portada (`CoverPage`)

```
NEXO · Executive Reporting Engine
Informe Mensual
Julio 2026

┌──────────────────────────────┐
│  ESTADO GENERAL              │
│         Bueno                │
│        [82/100]              │
└──────────────────────────────┘

Fecha de corte      31 de julio de 2026
Generado            31/07/2026 18:42
Generado por        Ana Torres
Report ID           NXR-20260731-184230-7KXM
Analytics Engine    v1.5.0
Formula Set         v4.4
```

## 2. Executive Summary

```
Situación General
El equipo mantiene un desempeño estable durante julio, con un cumplimiento
del 82% que se ubica dentro del rango aceptable, aunque aún por debajo del
objetivo institucional del 90%.

Fortalezas
La distribución de carga laboral se mantiene equilibrada en la mayoría del
equipo, y dos colaboradores destacan con Equilibrio Óptimo sostenido durante
todo el mes.

Aspectos de Atención
Un colaborador concentra el 34% de las consultas de Novedades de Pago del
equipo, lo que sugiere una posible sobrecarga administrativa no distribuida.

Conclusión
El equipo se encuentra en una posición operativa saludable, con una
oportunidad concreta de redistribución que evitaría una escalada hacia
sobrecarga en el próximo período.
```

## 3. Estado General del Equipo (`TeamStatusPage`)

Cada indicador se presenta con la estructura obligatoria de 6 elementos
(ver `REPORTING_STANDARDS.md` § Principios de diseño):

```
┌─────────────────────────────────────────────────────────┐
│ Cumplimiento                                    82%      │
│ Meta: 80% · Estado: Óptimo                                │
│ Interpretación: El equipo completa sus tareas dentro del  │
│   plazo esperado en la gran mayoría de los casos.         │
│ Impacto: Sostiene la continuidad operativa sin acumular   │
│   trabajo pendiente entre períodos.                       │
│ Recomendación: Mantener el seguimiento habitual.          │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│ Carga Laboral                                    97%      │
│ Meta: 96h–140h · Estado: Dentro de rango                  │
│ ...                                                        │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│ Equilibrio Operativo (Índice Ejecutivo)          82/100   │
│ Meta: ≥ 85/100 · Estado: Bueno                             │
│ Interpretación: [explicación determinista de              │
│   classifyIndiceEjecutivo]                                │
│ Impacto: Determina si el equipo puede sostener su ritmo   │
│   actual sin riesgo de desgaste.                           │
│ Recomendación: Mantener el seguimiento habitual.           │
└─────────────────────────────────────────────────────────┘
```

*(Solo presente en reportes MENSUAL del mes calendario en curso —
`indiceEjecutivo` es `null` en RANGO_MESES/RANGO_PERSONALIZADO y en meses
históricos ya cerrados.)*

## 4. Indicadores Estratégicos (`StrategicIndicatorsPage`)

```
┌───────────────┬───────────────┬───────────────┬───────────────┐
│ Cumplimiento   │ Carga Laboral │ Consultas     │ Colaboradores │
│    82%         │    97%        │    41         │      9        │
│ 74/90 tareas   │ 97h/100h base │ Seguimiento   │ Equipo        │
│                │               │ atendido      │ consolidado   │
└───────────────┴───────────────┴───────────────┴───────────────┘

Ranking
 1. Ana Torres          ASISTENTE_GH        94/100    96%
 2. Luis Peña           ASISTENTE_SELECCION 88/100    91%
 3. Carla Núñez         TRABAJO_SOCIAL      81/100    85%
 ...
```

## 5. Detalle por Colaborador (`MemberDetailPage`)

```
Nombre       Rol              Cumpl.  Carga         Venc.  Equilibrio          Acción sugerida
Ana Torres   ASISTENTE_GH     96%     [●] Óptimo    0      🟢 Equilibrio Óptimo  —
Luis Peña    ASISTENTE_SEL.   91%     [●] Elevada   1      🟡 Atención Moderada  Redistribuir consultas de...
Carla Núñez  TRABAJO_SOCIAL   85%     [●] Óptimo    0      🟢 Equilibrio Estable —
```

## 6. Distribución Operativa (`OperationalDistributionPage`)

```
Distribución por Motivo

Novedades de pago    ████████████████████░░░░░░░░  34%
Solicitud vacaciones ██████████░░░░░░░░░░░░░░░░░░  18%
Consulta operaciones ███████░░░░░░░░░░░░░░░░░░░░░  12%
...

Novedades de pago — 14 consultas · 210 min totales · tendencia +9%
  El volumen de consultas por novedades de pago aumentó respecto al mes
  anterior, concentrado en un solo colaborador — ver Detalle.

Matriz de Riesgo (Cumplimiento × Carga)
┌───────────┬───┐ ┌──────────────────┬───┐ ┌───────────────────────┬───┐ ┌───────────┬───┐
│ Críticos  │ 0 │ │ Atención (carga) │ 1 │ │ Atención (cumplimiento)│ 0 │ │ Saludables│ 8 │
└───────────┴───┘ └──────────────────┴───┘ └───────────────────────┴───┘ └───────────┴───┘
```

## 7. Executive Insights

```
Patrones
- El equipo mantiene un cumplimiento consistentemente sobre el 75% en los
  últimos 3 meses, sin variaciones abruptas mes a mes.

Cambios
- La carga laboral promedio subió 6 puntos porcentuales respecto a junio,
  coincidiendo con el cierre de un proceso de selección adicional.

Anomalías
- No se detectaron anomalías estadísticamente significativas este período.

Relaciones Cruzadas
- El colaborador con mayor concentración de consultas (Luis Peña) también
  muestra la carga laboral más alta del equipo — la correlación sugiere que
  la sobrecarga administrativa, no la asignación de tareas, es la causa
  principal.
```

## 8. Executive Assessment by NOVA (sección premium)

```
Diagnóstico General
[1 párrafo — diagnóstico integral del período, ver estructura completa en
REPORTING_NOVA_WRITING_GUIDE.md]

Fortalezas Estratégicas
- La distribución equilibrada de tareas en 8 de 9 colaboradores reduce el
  riesgo de rotación por desgaste, y permite absorber picos de demanda sin
  afectar el cumplimiento general.

Riesgos Detectados
- La concentración de consultas de Novedades de Pago en un único
  colaborador representa un riesgo de continuidad operativa si esa persona
  se ausenta — se recomienda documentar el proceso y capacitar un respaldo.

Oportunidades
- Redistribuir el 30% de las consultas de Novedades de Pago hacia el
  colaborador con mayor capacidad disponible liberaría aproximadamente 8
  horas mensuales sin incorporar nuevos recursos.

Prioridades
- Redistribución de consultas de Novedades de Pago (alta).

Perspectiva Estratégica
[1 párrafo]

Opinión Ejecutiva
[1 párrafo — juicio profesional, no resumen]
```

## 9. Recomendaciones (`RecommendationsPage`)

```
PRIORIDAD ALTA

┌────────────────────────────────────────────────────────────────┐
│ Redistribuir las consultas de Novedades de Pago entre los       │
│ asistentes de Gestión Humana para reducir la concentración      │
│ operativa en un solo colaborador.                    [ALTA]     │
│                                                                    │
│ Justificación: ...                                                │
│ Impacto esperado: ...                                             │
│ Área afectada: Gestión Humana — Novedades de Pago                 │
│ Beneficio: ...                                                    │
│ Complejidad estimada: Media — requiere reasignar un proceso ya    │
│   documentado, sin cambios de sistema.                            │
│ Tiempo estimado: 2 semanas                                        │
│ Responsable sugerido: Coordinador de Gestión Humana                │
└────────────────────────────────────────────────────────────────┘

PRIORIDAD MEDIA
...
```

## 10. Analytics Predictivo (`PredictivePage`)

**Disponible** (solo mes calendario en curso):

```
Proyección al 31/07/2026 18:42

┌──────────────────┬───────────────────────────┬─────────────────────────┐
│ Horizonte         │ Cumplimiento esperado al  │ Colaboradores en riesgo  │
│ de proyección      │ cierre                    │ de sobrecarga             │
│    30 días          │        84%                 │           1               │
└──────────────────┴───────────────────────────┴─────────────────────────┘

Ana Torres                                    Sobrecarga: Bajo
  Cumplimiento: se proyecta que mantenga un cumplimiento sobre el 90% al
  cierre del período, en línea con su comportamiento reciente.
  Carga: sin señales de sobrecarga proyectada.
  Subutilización: sin riesgo de subutilización.
```

**No disponible** (rango de meses, rango personalizado, o mes ya cerrado):

```
Analytics Predictivo

Analytics Predictivo solo proyecta hacia adelante para el mes calendario en
curso — este reporte corresponde a un período distinto (o de rango), así
que no aplica. Los 3 escenarios de equipo (Esperado/Preventivo/Optimista)
del FPS quedan además pendientes de una fase posterior: el motor de
predicción existente es por colaborador, todavía no hay una síntesis a
nivel de equipo.
```

## 11. Metadatos (última página)

```
Report ID                          NXR-20260731-184230-7KXM
Generado por                       Ana Torres
Fecha de generación                31/07/2026 18:42
Fecha de corte                     31 de julio de 2026
Período                            Julio 2026
Tipo de reporte                    Informe Mensual
Estado del período                 En curso
Colaboradores incluidos            9
Versión Analytics Engine           v1.5.0
Versión Formula Set                v4.4
Versión Executive Reporting Engine v2.0
Versión NEXO                       v1.23.0
Calidad del dato                   96%
Tiempo de generación                3.4 s
```

---

## Pie de página (en las 11 páginas)

```
NEXO · Executive Reporting Engine · NXR-20260731-184230-7KXM · Página 4 de 11
```

## Reportes LEGACY (`origin: LEGACY_MIGRATION`)

Un reporte migrado desde `MonthlyReport` (antes de v1.22.0) se ve
estructuralmente igual, con estas diferencias reales:

- `integrityFlag: PARTIAL` — visible en el historial del sidebar
  (`MonthlyReports.tsx`) con la etiqueta "Legacy".
- Página 8 (Executive Assessment) y 7 (Insights) muestran "No disponible" en
  los campos narrativos — el `MonthlyReport` original solo tenía un bloque
  de texto libre de IA, no las 4 secciones estructuradas de NOVA.
- Página 10 (Analytics Predictivo) siempre "No disponible" — el motor
  predictivo no existía cuando se generó el reporte original.
- Report ID con formato distinto: `NXR-LEGACY-YYYYMMDD-XXXX` (sin
  componente de hora — el `MonthlyReport` original no registraba la hora
  exacta de generación).

Ver `REPORTING_AUDIT_MANUAL.md` § Reconstrucción histórica para el
procedimiento completo del backfill.
