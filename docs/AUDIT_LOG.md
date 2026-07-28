# Audit Log — Decisiones Arquitectónicas de Nexo

> Este documento **no registra código** — registra decisiones funcionales y
> arquitectónicas: el problema que las motivó, las alternativas consideradas
> y por qué se eligió una sobre otra. Para el detalle de QUÉ se implementó,
> ver `docs/CHANGELOG.md`; para el POR QUÉ de decisiones puntuales de diseño
> (no necesariamente arquitectónicas), ver también `docs/DECISIONS.md`.
>
> **Nota sobre "Aprobado por" en las entradas reconstruidas (anteriores a
> 2026-07-22):** Nexo se desarrolla mediante sesiones de Claude Code dirigidas
> por Anthony Jácome, dueño del producto. Salvo que se indique lo contrario,
> "Aprobado por" refleja esa dirección general de producto, no un proceso de
> aprobación formal documentado en su momento (ese proceso nace con este
> mismo sistema de documentación).

---

## 2026-07-28 — Executive Reporting Engine 2.0

**Problema:** el usuario entregó una Especificación Funcional de Producto
(FPS) de 4 partes pidiendo evolucionar el Informe Mensual/de Rango de
"exportación de tablas con un bloque de IA" a un motor de reportes
ejecutivos: documentos inmutables con Report ID, fecha de corte real, una
arquitectura de razonamiento obligatoria para NOVA, y una estructura fija de
11 páginas. Regla explícita del propio FPS: "el reporte deberá evolucionar,
nunca reiniciarse" — toda funcionalidad existente debía conservarse.

Exploración previa (agente Explore + lectura directa de los 3 endpoints)
confirmó: lógica duplicada 3 veces entre `generate`/`range`/`custom-range`;
`MonthlyReport` se sobrescribe por `upsert` (sin historial); `computeDataQuality`
nunca se llamaba desde el reporte de equipo (violación real, no solo
teórica, del FPS §11); no había bug de scoping de roles (verificado
comparando `getVisibleRoles` contra el filtro inline existente — coincidían
exactamente para los 3 roles habilitados a generar reportes).

### Decisión 1 — `ExecutiveReportSnapshot` como modelo nuevo, no extensión de `MonthlyReport`

**Alternativas:** (a) modelo nuevo en paralelo; (b) quitar el `@@unique([month,year,scope])` de `MonthlyReport` y convertirlo en append-only.

**Decisión:** (a). El principio de inmutabilidad (una fila nueva por generación) es estructuralmente incompatible con la semántica actual de "el informe del mes X" como una sola fila que se actualiza — cambiarla habría roto el contrato que `MonthlyReport.upsert` ya tiene con sus llamadores. Un modelo nuevo además permite dar Snapshot+Report ID+auditoría a los reportes de rango/personalizado, que hoy no persisten en absoluto.

### Decisión 2 — Backfill certificado, confirmado explícitamente por el usuario antes de ejecutar

**Decisión:** `MonthlyReport` permanece intacta e inmutable para siempre; un script de una sola corrida (`--dry-run` por defecto) migra cada fila a `ExecutiveReportSnapshot` con `origin=LEGACY_MIGRATION`, Report ID propio (`NXR-LEGACY-YYYYMMDD-XXXX`) e `integrityFlag=PARTIAL` — **siempre** `PARTIAL`, nunca `FULL`, porque ningún `MonthlyReport` histórico registró calidad de dato, versión de motor/fórmulas ni narrativa NOVA estructurada; no hay forma de reconstruir esos campos 1:1 desde datos que nunca existieron. Ejecutado en producción con confirmación explícita del usuario tras revisar el dry-run: 4 migrados, 0 fallidos, verificado idempotente en una segunda corrida.

### Decisión 3 — Fecha de corte real vía reconstrucción `completedAt`, con límite documentado

**Problema:** el FPS exige que "fecha de corte" filtre datos de verdad, no sea solo una etiqueta — pedido explícitamente para esta fase (no diferido a una fase posterior como el plan original proponía).

**Decisión:** las 3 fórmulas de builder acotan `TaskActivity.createdAt`/`Task.completedAt` (FIJA) al corte directamente (campos con marca de tiempo real, sin ambigüedad), y reconstruyen el cumplimiento "a la fecha de corte": una tarea `COMPLETADA` con `completedAt` posterior al corte se trata como no completada para ese snapshot — NEXO no lleva historial de `status` por tarea, así que esto es una aproximación conservadora explícitamente documentada, no una reconstrucción exacta. `computeHealthScore`/`computePerformanceScore` reciben el corte vía su parámetro `now` ya existente (sin tocar `analytics.ts`). **Límite aceptado:** `computeDataQuality` y las tendencias multi-mes no aceptan un parámetro de corte hoy — extenderlas exigiría modificar `analytics.ts`/`reportInsights.ts`, fuera de alcance de este sprint; quedan evaluadas sobre el estado actual, no "a la fecha de corte".

### Decisión 4 — NOVA reutiliza `ExecutiveReportContext` (Fase B) en vez de un `groundingContext.ts` separado

**Decisión:** el plan original de la Fase C proponía un módulo `groundingContext.ts` propio. Al llegar a la Fase C, `ExecutiveReportContext`/`deriveExecutiveReportContext` (creados en una ampliación de la Fase B pedida por el usuario) ya cumplían exactamente esa función — un segundo módulo habría sido duplicar la misma derivación sin ningún beneficio.

### Decisión 5 — Escenarios predictivos (5ª sección de NOVA) diferidos, no implementados

**Decisión:** el FPS condiciona los 3 escenarios (Esperado/Preventivo/Optimista) a que "Analytics Predictivo esté disponible". `ExecutiveReportSnapshotData.predictivo` sigue en `null` — no existe un motor de predicción a nivel de EQUIPO (`predictionEngine.ts` es por colaborador). Implementar el prompt de todas formas habría obligado a NOVA a narrar sobre datos inexistentes, violando la propia regla antialucinación del FPS Parte III.

### Decisión 6 — Vista en pantalla y PDF comparten un solo render a HTML, no dos sistemas paralelos

**Decisión:** el plan original de la Fase E pedía 11 componentes React (`pages/*.tsx`) para pantalla, más un renderer HTML separado para PDF — el mismo patrón que ya existe hoy en `MonthlyReports.tsx` (duplicación reconocida, no nueva). Se decidió que ambos formatos consuman el mismo `renderReportHtml.ts`, eliminando esa duplicación en el motor nuevo en vez de repetirla.

### Decisión 7 — Fase E se integra de forma aditiva; NO se retiran los renderers antiguos todavía

**Alternativas:** (a) integración aditiva (botones nuevos, flujo antiguo intacto); (b) repuntar `MonthlyReports.tsx`/`ReportWizardModal.tsx`/`wizardExport.ts` al endpoint unificado y retirar `downloadReportPDF`/`downloadReportExcel`/etc. en el mismo sprint.

**Decisión:** (a). Reescribir ~1600 líneas de UI con funcionalidad en uso activo, sin poder verificar visualmente en navegador (ver nota de verificación abajo), es un riesgo que amerita su propio checkpoint — no empaquetarlo silenciosamente junto con la construcción del motor. Queda registrado en `docs/ROADMAP.md` § En desarrollo.

### Decisión 8 — Rendimiento del mes en curso: limitación conocida, aceptada explícitamente por el usuario, sin tocar `predictionEngine.ts`/`analytics.ts`

**Problema:** el benchmark real (`scripts/bench-executive-report.ts`, corrido contra datos de producción — 9 colaboradores) midió ~22s para generar un reporte MENSUAL del mes calendario en curso, sobre el presupuesto de 15s del FPS Parte IV §8. Se descartó a NOVA como causa (el mismo benchmark corrido sin `GROQ_API_KEY` — cero llamadas de red — dio el mismo tiempo). Causa raíz aislada: `computeHealthScore`/`computePerformanceScore`/`computeCumplimientoProjection`/`computeSobrecargaProbability` se llaman una vez POR COLABORADOR (36 llamadas para 9 personas) — diseñadas para uso individual (KPIs personales), nunca antes invocadas en lote para un equipo completo en una sola solicitud.

**Alternativas presentadas:** (a) aceptar como limitación conocida y documentada, registrando un sprint futuro de optimización; (b) autorizar puntualmente modificar `predictionEngine.ts`/`analytics.ts` en esta misma versión para agregar variantes batch (mismo patrón que `computeTeamCapacityForecast`/`computeSubutilizacionPredictions`, que ya existen para otros cálculos).

**Decisión:** (a), confirmado explícitamente por el usuario — "Mantén `predictionEngine.ts` y `analytics.ts` completamente intactos." Se documenta como limitación conocida de v2.0: no afecta la exactitud de los resultados (son las mismas funciones, mismos valores, solo ejecutadas en serie por colaborador). Las regeneraciones dentro de la ventana de caché ya son rápidas: se agregó `cached()` (mismo patrón/TTL que ya usa el resto del motor) a las 2 llamadas de predicción que no lo tenían, y una 2ª generación del mismo reporte en el mismo proceso bajó de ~22s a ~3.3s, dentro de presupuesto — medido en el mismo benchmark. El único cambio de código de esta decisión fue paralelizar Índice Ejecutivo y Analytics Predictivo (antes se esperaban en secuencia, sin necesidad real) y agregar ese caché — ninguno de los dos toca `predictionEngine.ts`/`analytics.ts`. La corrección real de la generación fría queda como Sprint futuro (ver `docs/ROADMAP.md` § Planificado), con alcance explícitamente acotado: variantes batch, cero cambio de fórmulas/resultados/comportamiento funcional.

### Decisión 9 — Snapshot Integrity Validation queda como mejora futura; integridad estructural ya se considera cumplida

**Problema:** el FPS Parte IV §15 exige que los valores del reporte coincidan exactamente con Dashboard/Analytics para la misma fecha de corte, y que una discrepancia se registre como incidente — lo que implica, leído literalmente, un mecanismo de validación ACTIVO en tiempo de ejecución (volver a consultar y comparar al momento de generar).

**Decisión, confirmada explícitamente por el usuario:** no se implementa esa validación activa en esta versión. La integridad ESTRUCTURAL ya se considera cumplida por diseño: el Executive Reporting Engine usa un único Builder canónico (`buildSnapshotData.ts`) que llama a las mismas funciones de `analytics.ts` que Dashboard/Analytics ya usan (esto fue, de hecho, la corrección de la causa raíz real hecha en la Fase B — antes de eso, el reporte de equipo SÍ recalculaba KPIs con consultas propias, la fuente real de discrepancias históricas), y un único objeto `ExecutiveReportSnapshotData` del que se derivan todas las vistas (pantalla/PDF/Excel). Dos superficies no pueden divergir si comparten la misma función y el mismo objeto — por eso no se considera necesaria una verificación adicional de re-consulta/comparación en esta versión. Queda registrada como mejora futura (capa de monitoreo, no una corrección pendiente) en `docs/ROADMAP.md` § Planificado.

**Nota de verificación:** todas las fases se verificaron con `tsc`/`lint`/suite completa de Vitest (1142/1142) en verde, y el backfill se ejecutó realmente contra la base compartida. La integración de UI de la Fase E NO se verificó visualmente en navegador — no había credenciales de sesión disponibles para esta sesión (la base compartida tiene datos reales de personal, no cuentas semilla; ver nota de "Shared dev DB" en la memoria del proyecto) y no se intentó adivinar credenciales.

---

## 2026-07-28 — Sprint O: Centro de Configuración NEXO

**Problema:** el pedido original pedía un módulo único que centralizara TODA la configuración de la plataforma en 10 categorías (Organización, Analytics, Trabajo, Proyectos, Escritorio Digital, Reportes, NOVA, Seguridad, Notificaciones, Parámetros Globales), con historial, restauración, búsqueda, favoritos y vista previa de impacto.

**Exploración previa a cualquier código (Fase 1 del skill de planificación):** se auditó qué de esto ya existía antes de diseñar nada nuevo. Hallazgos clave:
1. `src/lib/systemConfig.ts` ya era un almacén genérico clave/valor (`SystemConfigHistory`, con `validFrom`/`validUntil`/`updatedBy`) reutilizado por ~10 dominios (Analytics, curvas, objetivos de cargo, compatibilidad operativa, carga laboral, retenciones, mensaje de bienvenida, ventana predictiva) — ya daba auditoría completa gratis, solo sin UI para verla.
2. `/settings` (`SettingsManager.tsx`) ya agrupaba ~21 secciones en un acordeón — el pedido de "centralizar" en gran parte ya estaba centralizado, solo disperso visualmente y sin capas transversales (búsqueda/favoritos/historial navegable/restaurar).
3. Varias categorías del pedido NO existen como funcionalidad real: plantillas/logo/firmas/programación automática de Reportes (sin scheduler ni infraestructura de email en todo el repo), SLA/nivel de riesgo de Proyectos (no existe el campo), permisos especiales por usuario en Seguridad (toda la autorización es por `Role`, sin excepciones individuales), e idioma/moneda en Parámetros Globales (app 100% español hardcodeado, sin librería i18n, sin concepto de moneda en un sistema de RRHH). El propio pedido nombraba "Sprint K" y "Sprint F" para Proyectos/Reportes, confirmando que ya se sabía que eran sprints aparte.

Dado el tamaño real (semanas de trabajo si se construyera todo, incluyendo subsistemas nuevos que ninguna restricción del pedido pedía realmente construir — "no modificar la seguridad existente" explícitamente contradice construir permisos especiales), se presentó un plan por fases al usuario con 3 preguntas de alcance antes de escribir código.

### Decisión 1 — "Shell ahora, greenfield después" (confirmado por el usuario, opción recomendada)

**Alternativas presentadas:** (a) shell completo + centralizar lo existente + agregar solo los valores hardcodeados de bajo riesgo, marcando lo demás "Próximamente"; (b) construir todo, incluyendo los subsistemas nuevos; (c) solo el shell, sin ningún valor nuevo.

**Decisión:** (a). Se construyó el Centro de Configuración completo (categorías/búsqueda/favoritos/historial/restaurar) + se migraron las ~21+6 secciones existentes + se agregaron los 9 valores de bajo riesgo identificados en la exploración. Proyectos-SLA, Reportes-plantillas/programación y Seguridad-permisos-especiales quedaron como tarjetas "Próximamente" con entrada en `docs/ROADMAP.md`, en vez de UI editable sin ningún efecto real (configuración muerta).

### Decisión 2 — Idioma/moneda fuera de Parámetros Globales (confirmado por el usuario)

**Decisión:** solo se expone lo que ya tiene un consumidor real y bajo riesgo de exponer (nada, en este caso — ver Decisión 4). Idioma y moneda no se agregaron ni como campos "para el futuro", porque no hay ninguna pantalla que fuera a leerlos — habría sido, en palabras del usuario, "trabajo muerto".

### Decisión 3 — Enums de Trabajo (prioridad/estado/tipo de tarea, días laborables) fuera de alcance (confirmado por el usuario)

**Decisión:** se descartó migrar `TaskPriority`/`TaskStatus`/`TaskType` (enums de Prisma) y `isBusinessDay` (constante síncrona usada en decenas de sitios del motor de carga laboral/Analytics) a listas editables — el primero exige migración de esquema + tocar cada switch/chip/filtro/fórmula que depende de esos valores literales; el segundo exige un cambio de arquitectura sync→async en todo el núcleo de Analytics. Solo los MAPAS DE COLOR ya son técnicamente de bajo riesgo (`chipConfig.ts`), pero no se tocaron tampoco en este sprint por no haber sido parte de lo confirmado.

### Decisión 4 — Parámetros Globales queda de solo lectura, no editable

**Hallazgo durante la implementación (no una pregunta separada, una consecuencia directa de la Decisión 3):** zona horaria de negocio (`BUSINESS_TZ_OFFSET_HOURS`) y primer día de semana (`utcWeekStart` en `workload.ts`) se consultaron y resultaron tener EXACTAMENTE el mismo perfil de riesgo que "días laborables" — consumidas de forma síncrona en `analytics.ts`/`trendEngine.ts`/`workload.ts`/`insightsEngine.ts`/`capacityForecast.ts`. Por consistencia con la Decisión 3 (ya rechazada por el usuario para el mismo tipo de riesgo), `GlobalParamsSection.tsx` se implementó como solo-lectura (muestra los 3 valores fijos como hechos informativos), no como formulario editable — evita fabricar un control que aparentaría funcionar pero compartiría el mismo riesgo arquitectónico ya diferido.

### Decisión 5 — Fix del role-gate de `/settings`: corregir `page.tsx`, no ampliar `SettingsManager`

**Hallazgo:** `page.tsx` permitía `ADMINISTRADOR` y `COORDINADOR_NACIONAL` en el gate de ruta, pero `SettingsManager.tsx:141` (`isAdmin = role === "ADMINISTRADOR"`) escondía absolutamente todo el contenido detrás de un gate más estricto — Coordinador Nacional veía una página vacía. El link de navegación (`navLinks.ts:65`) también era Administrador-only.

**Decisión:** 2 de 3 fuentes ya coincidían en Administrador-only — se corrigió la tercera (`page.tsx`) a ese mismo criterio, en vez de ampliar las otras dos para dar a Coordinador Nacional un acceso que nunca tuvo realmente (el contenido siempre estuvo oculto para ese rol en la práctica).

### Decisión 6 — Vista previa de impacto: reutilizar el flujo existente, no construir un componente nuevo genérico

**Decisión:** el único flujo hoy genuinamente destructivo (purga de retención, `RetentionPolicySection.tsx`) ya tenía un patrón preview→confirm→ejecutar (`GET` cuenta candidatos, dos `confirm()`, `POST {confirm:true}` ejecuta) — se conservó tal cual en la extracción, sin envolverlo en un componente `ImpactPreviewDialog` genérico nuevo. El campo `isHighImpact` sí se anotó en `registry.ts` para los settings que afectan cálculos ya en producción (pesos de Analytics, curvas, carga laboral, política de contraseña/sesión), mostrando una insignia visual, sin retrofit del diálogo de confirmación dentro de los `PUT` handlers de esas ~21 secciones existentes — hacerlo habría exigido tocar los internals de cada sección, contradiciendo el alcance de "reorganizar sin romper lógica de negocio".

### Decisión 7 — Los 9 valores nuevos, uno por uno: mismo patrón exacto ya usado 10 veces

Cada uno (`CONFIG_KEY_*`/`DEFAULT_*`/`getEffective*`/`set*`) sigue el ejemplo más limpio ya presente en `systemConfig.ts` (`CONFIG_KEY_RECOVERY_RETENTION_HOURS`/`getEffectiveRecoveryRetentionHours`/`setRecoveryRetentionHours`), sin inventar un mecanismo nuevo. Casos que requirieron una decisión puntual:
- **Ventana de registro retroactivo y presets de posposición**, consumidos por componentes CLIENTE (`RetroactiveActivityModal.tsx`, `ProjectActivitiesTab.tsx`, `ReminderCard.tsx`) que no pueden importar `systemConfig.ts` (`"server-only"`) — se agregaron 2 endpoints `GET` alcanzables por CUALQUIER usuario autenticado (no solo Administrador), ya que Seguimiento/Proyectos/Escritorio Digital los usa cualquier rol.
- **Longitud mínima de contraseña** en `profile/page.tsx`: el chequeo duplicado del lado cliente se ELIMINÓ (no se reemplazó por un fetch a un endpoint nuevo) — el servidor ya revalida y ya muestra el error vía `showToast`, así que exponer un endpoint público solo para ese pre-chequeo habría sido plumbing sin beneficio real.
- **Retención de intentos de login**: `expiredAttemptsWhere()` (antes síncrona) se mantuvo síncrona, recibiendo `maxAgeMs` ya calculado por cada caller (`countExpiredLoginAttempts`/`cleanupExpiredLoginAttempts`), en vez de volverla `async` — evita empujar la resolución de config más profundo de lo necesario.
- **TTL de caché de NOVA**: se creó un par dedicado (`nova_cache_ttl_minutes`) en vez de sumarlo a `ANALYTICS_CONFIG_DEFAULTS` — NOVA no es el motor de Analytics, aunque el patrón (`cacheTtlMinutes`) sea el mismo.

**Verificación:** `npx tsc --noEmit` (2 errores preexistentes no relacionados, confirmados por `git diff --stat`), `npm run lint` (0 errores tras corregir 2 hallazgos propios: comillas sin escapar en JSX, `setState` síncrono dentro de un efecto — ambos con el mismo patrón `queueMicrotask` ya usado en el resto del código base), `npx vitest run` (suite completa, incluye tests nuevos para los 10 getters/setters de `systemConfig.ts`, `configFavorites.ts`, el registro de búsqueda y las 9 rutas API nuevas — más los ajustes de mocks de Prisma en 4 archivos de test existentes que ahora ejercitan `systemConfigHistory` indirectamente).

**Aprobado por:** Anthony Jácome (pedido de alcance muy amplio; se presentó un plan por fases con 3 preguntas de alcance explícitas antes de implementar, todas respondidas con la opción recomendada).

---

## 2026-07-28 — Fix: indicador "Carga Laboral" con fuente de datos distinta al resto de Analytics

**Problema (reportado por el usuario):** en la misma pantalla de Analytics/KPIs, WorkloadCard mostraba "135.49h reales, rango óptimo 140-165h, Moderado" (validado, correcto) mientras el indicador "Carga Laboral" (SummaryCard + Donut + exportables) mostraba "113.28h reales, 206.18h base, 55%" para el mismo colaborador y el mismo mes — dos números incompatibles del mismo concepto.

**Fase 1/2/3 (localización, comparación, causa) — antes de tocar código:**
`cargaLaboral` (`/api/kpis/[userId]` y `/api/kpis/me`) se construía con `totalEstimated`/`totalReal` = suma cruda de `Task.estimatedHours`/`Task.realHours` de las tareas cuyo `endDate` cae en el mes, pasada por `computeEstimatedVsRealRatio` (`analytics.ts`) — un ratio de precisión de estimación (¿qué tan bien se estimó una tarea vs. lo que tomó en realidad?), sin relación conceptual con "carga laboral" en el sentido de WorkloadCard (horas trabajadas vs. capacidad esperada del período). WorkloadCard usa `cargaTiempo.mensual`, calculado por `computeCargaTiempo` (`workload.ts`) con la Base Horaria Efectiva (Sprint Analytics 2.1: días hábiles × horas efectivas configuradas, ajustada por permisos/estado especial/`kpiStartDate`). Ambos cálculos coexistían en el mismo endpoint, alimentando dos componentes distintos de la misma pantalla bajo el mismo nombre "Carga laboral" — no una duplicación intencional documentada, sino una indicador que quedó desactualizado cuando Sprint Analytics 2.1 introdujo la Base Horaria Efectiva sin migrar este indicador específico a la nueva fuente.

**Restricciones explícitas del pedido:** no modificar el Analytics Engine, Equilibrio Operativo, Analytics Predictivo, Reportes ni Dashboard; no refactorizar de forma general; documentar la causa antes de corregir; limitar la corrección al indicador de Carga Laboral.

### Decisión 1 — Reusar `cargaTiempo.mensual` ya calculado, no reimplementar el cálculo

**Alternativas consideradas:**
1. Reimplementar en el route handler una fórmula propia de "carga laboral" para el indicador.
2. Leer directamente `cargaTiempoBase.mensual` — el mismo objeto que el endpoint ya calcula (vía `computeCargaTiempo`) y ya envía al frontend como `cargaTiempo` para WorkloadCard.

**Decisión:** opción 2. Garantiza igualdad byte-a-byte con WorkloadCard (misma pantalla) sin coste de cálculo adicional — ambos leen el mismo `cargaTiempoBase.mensual` ya presente en el handler. Cero cambios a `workload.ts`/`analytics.ts`.

### Decisión 2 — El ratio estimado-vs-real se conserva, pero solo como input del Score básico

`cargaRatio` (`computeEstimatedVsRealRatio`) seguía siendo necesario para `computeSimpleScore` (Score básico /100, no es el indicador reportado como roto). Se dejó sin cambios — ni su fórmula, ni su uso en el Score — y se documentó en el código que ya no alimenta `cargaLaboral`. La inconsistencia ya documentada en `docs/ROADMAP.md` entre `computeEstimatedVsRealRatio` y `computeTargetTimePrecision` sigue pendiente de una decisión de negocio propia — no se resolvió aquí para no exceder el alcance del pedido.

### Decisión 3 — Mapeo de color `WorkloadColor` (5 zonas) → `KpiColor` (3 zonas)

**Problema:** `cargaTiempo.mensual.color` es `WorkloadColor` (`green`/`yellow`/`orange`/`red`, 5 zonas: Subutilización/Moderado/Óptimo/Carga elevada/Sobrecarga), pero el campo `cargaLaboral.color` está tipado `KpiColor` (solo `green`/`yellow`/`red`) y así lo consumen `SummaryCard`/`DonutChart` en 2 componentes.

**Decisión:** `orange` (Carga elevada) colapsa a `yellow` — evita clasificar una carga ya elevada como "green" (subestimar) o como "red" (igualarla a Sobrecarga real, sobreestimar). No se amplió `KpiColor` a 4 valores por ser un cambio de tipo compartido fuera del alcance de "corregir el indicador".

### Decisión 4 — Recalcular también el delta de mes anterior (`prevMonth.cargaRatio`)

**Problema:** si solo se corregía el mes actual, el badge de tendencia habría comparado el nuevo % (Base Horaria Efectiva) contra el ratio antiguo (estimado-vs-real) de un mes distinto — un delta sin sentido, introducido como efecto secundario directo de este mismo fix (no una funcionalidad nueva fuera de alcance).

**Decisión:** recalcular el mes anterior con el mismo criterio, usando `businessBaseForRange` + horas reales de tareas FIJA/`TaskActivity` del mes anterior — mismo patrón ya usado en `reports/custom-range/route.ts` para rangos arbitrarios (no una fórmula nueva, una reutilización de un patrón ya establecido). Se aceptó como simplificación consciente que este cálculo no pondera por permisos/estado especial día a día como sí hace `computeCargaTiempo` para el mes actual (esa granularidad exigiría replicar consultas de `getLeaveMinutesByDay`/`getSpecialStatusDayMap` solo para un badge de tendencia secundario) — el ratio antiguo tampoco lo hacía, así que no es una regresión de precisión, sí una corrección de qué concepto se compara.

**Verificación:** `npx tsc --noEmit` (2 errores preexistentes no relacionados, en `tasks-correct-import-template.test.ts`/`tasks-crud.test.ts`, confirmados sin relación por `git diff --stat`), `npx vitest run src/__tests__/api/kpis-me-userid.test.ts` (14/14, incluye 1 test nuevo de regresión que fija `estimatedHours`/`realHours` de tareas en valores deliberadamente distintos de `cargaTiempo.mensual` mockeado y confirma que `cargaLaboral` refleja este último).

**Aprobado por:** Anthony Jácome (pedido con fases explícitas: localizar → comparar → causa → corregir → validar, y criterio de aceptación claro).

---

## 2026-07-26 — Compatibilidad Organizacional en el Motor Determinista de Recomendaciones

**Problema:** `computeTeamRecommendations` (`analytics.ts`, §S3-A) sugiere redistribuir horas de un colaborador sobrecargado hacia colaboradores con capacidad disponible, pero solo cruzaba números de capacidad — sin ningún conocimiento de a qué cargo pertenece cada persona. Podía (y en la práctica probablemente lo hacía) sugerir mover trabajo de un Asistente a un Coordinador, o de un Analista a un Jefe Nacional — redistribuciones jerárquicamente incompatibles y operativamente inviables.

**Restricciones explícitas del pedido:** no modificar cálculos de carga laboral, KPIs, ni el Analytics Engine — aplicar la validación únicamente al motor de recomendaciones.

### Decisión 1 — Modificar `computeTeamRecommendations` en `analytics.ts` no viola "no modificar el Analytics Engine"

**Aparente conflicto:** la función que había que corregir vive físicamente en `analytics.ts`, el mismo archivo que las restricciones dicen no tocar.

**Resolución:** `computeTeamRecommendations` no tiene entrada en `FORMULA_VERSIONS` — no es un score/KPI (Performance Score, Equilibrio Operativo, Riesgo Operativo, Cumplimiento, Consistencia, Predicción), es la capa de sugerencias que consume esos cálculos ya hechos. La propia UI la etiqueta "motor determinista" (`TeamWorkloadCards.tsx`), literalmente el nombre del pedido. Se interpretó la restricción como "no tocar fórmulas de KPI", no "no tocar un solo byte del archivo" — mismo criterio ya aplicado en Sprint E al extender `systemConfig.ts` (infraestructura compartida, no una fórmula). Ningún peso, umbral o fórmula de score cambió — solo QUÉ candidatos son elegibles como destino.

### Decisión 2 — Regla 4 (nunca vertical) es un filtro absoluto en código, no solo una validación de configuración

**Alternativas consideradas:**
1. Confiar en que la Matriz de Compatibilidad Operativa (configurable) nunca permita pares de niveles distintos, validado solo al guardar.
2. Además de validar al guardar, filtrar por `ROLE_LEVEL` (roles.ts) dentro de `computeTeamRecommendations` mismo, antes de mirar la matriz — defensa en profundidad.

**Decisión:** opción 2. El pedido dice "estas recomendaciones deberán descartarse automáticamente" — lenguaje de invariante del motor, no de validación de formulario. Si en el futuro la matriz se edita directamente en la base de datos, se importa desde otro sistema, o un bug de UI permite guardar un par inválido, el motor igual nunca produce una recomendación vertical. `analytics.ts` importa `ROLE_LEVEL` de `roles.ts` (import nuevo, de un módulo sin dependencias propias, de solo lectura) específicamente para este propósito.

### Decisión 3 — Matriz direccional, no auto-simétrica

**Alternativas consideradas:**
1. Simétrica: marcar A compatible con B automáticamente marca B compatible con A.
2. Direccional: cada cargo guarda su propia lista de cargos adicionales aceptados; para compatibilidad mutua, configurar ambos lados.

**Decisión:** opción 2 — mismo patrón de almacenamiento que `getEffectiveRoleTarget`/`setRoleTarget` (un valor JSON por cargo en `SystemConfigHistory`, sin acoplar `systemConfig.ts` a `roles.ts`). Más simple de implementar y auditar (el historial de cambios de `setConfigValue` queda por cargo, no por par), a costa de que el Administrador debe pensar en ambas direcciones si quiere compatibilidad mutua — documentado explícitamente en la UI (`RoleCompatibilitySection.tsx`).

### Decisión 4 — Regla 5: mensaje explícito como una "recomendación" más, no un estado de error aparte

**Decisión:** cuando no hay candidato compatible con capacidad, `computeTeamRecommendations` sigue devolviendo un objeto `TeamRecommendation` (nuevo campo `hasCandidate: false`) con el mensaje pedido como `text`, en vez de omitir a esa persona silenciosamente o lanzar un error. Mantiene la forma de la lista (consumida por `prioritizeRecommendations`, `TeamWorkloadCards.tsx`) sin necesitar un tipo de respuesta paralelo — el consumidor solo necesita una rama condicional (`hasCandidate === false` → sin línea de impacto, ver `RecommendationItem`).

### Decisión 5 — Validación duplicada de nivel en el API route (`/api/settings/role-compatibility`)

Además del filtro absoluto en `computeTeamRecommendations` (Decisión 2), `PATCH /api/settings/role-compatibility` rechaza con 400 cualquier intento de guardar un cargo compatible de otro nivel — no por desconfianza del filtro de motor, sino para que el Administrador reciba el error inmediatamente al configurar, en vez de guardar silenciosamente algo que el motor simplemente ignorará después.

**Verificación:** `npx tsc --noEmit` (2 errores preexistentes no relacionados), `npm run lint` (0 errores), `npx vitest run` (1039/1039 — 1026 preexistentes + 13 nuevos: `team-recommendations-compatibility.test.ts` cubre las 5 Reglas explícitamente, `api/role-compatibility.test.ts` cubre auth/validación del endpoint), `npm run build` limpio (`/api/settings/role-compatibility` y `/api/analytics/recommendations/team` registradas).

**Aprobado por:** Anthony Jácome (pedido con reglas explícitas y criterio de aceptación claro — sin ambigüedad que ameritara una pregunta antes de implementar).

---

## 2026-07-26 — Sprint E: Analytics Predictivo e Inteligencia Preventiva

**Problema:** el pedido de Sprint E pedía un motor predictivo de 17 bloques (Trend Engine, 4 predicciones explicables, alertas preventivas, simulador de escenarios, gráficos de tendencia, ventana histórica configurable, 2 nuevos indicadores) — determinístico, sin IA generativa, sin tocar KPIs/fórmulas/historial/auditoría existentes. El pedido, sin embargo, chocaba en varios puntos con el estado real del código, y una de sus técnicas propuestas resultó tener un bug real detectado antes de implementar. Esta entrada documenta las 7 decisiones de alcance/diseño más significativas.

**Restricción explícita del sprint:** cero IA generativa; no modificar `analytics.ts`/`capacityForecast.ts`/`workload.ts`/`computeAlerts`/`riskAlerts.ts` ni ninguna UI de Dashboard/Analytics(KPIs)/Reportes/Proyectos/Equipo; toda predicción debe derivarse solo del histórico ya existente en NEXO.

### Decisión 1 — "Consultas" (consultas a Nova) queda fuera de alcance

**Hallazgo:** Bloque 1 pedía que el Trend Engine analizara 9 indicadores, incluyendo "Consultas" — pero no existe ninguna tabla en el schema que registre preguntas hechas a Nova (el asistente es stateless por diseño, sin historial de conversación).

**Alternativas consideradas:**
1. Agregar una tabla nueva de logging (timestamp + userId, sin contenido del mensaje, para no comprometer LOPDP) solo para que "Consultas" tuviera un dato real.
2. Omitir "Consultas" del Trend Engine v1, implementar los otros 8 indicadores completos, documentar el hueco.

**Decisión:** opción 2, confirmada explícitamente con el usuario antes de tocar código. Agregar logging de conversaciones es una pieza de producto en sí misma (con implicaciones de privacidad reales) — no algo a decidir de forma unilateral dentro de un sprint que pedía "no usar IA ni tocar historial/auditoría", no "agregar una tabla de auditoría nueva".

**Impacto:** el Trend Engine cubre 8/9 indicadores. Ver `docs/ROADMAP.md` para el hueco documentado.

### Decisión 2 — Módulo nuevo y autónomo, no integración en pantallas existentes

**Hallazgo:** Bloque 15 dice explícitamente "no modificar todavía" Dashboard/Analytics/Reportes/Proyectos/Equipo, pero varios bloques (7, 8, 9) describen funcionalidad claramente visual ("crear un nuevo apartado", "agregar un simulador", "crear gráficos"). Los propios criterios de aceptación resuelven la aparente contradicción: "el motor predictivo quedará preparado para ser consumido... en los siguientes Sprints" — es decir, la UI de ESTE sprint debe existir, pero vivir aparte.

**Decisión:** ruta nueva (`/inteligencia-preventiva`), entrada de navegación nueva (sección "Inteligencia" ya existente, junto a Nova), árbol de componentes nuevo (`src/components/inteligencia-preventiva/`). Cero archivos de Dashboard/KPIs(`AdvancedAnalytics.tsx`)/Reportes/Proyectos/Equipo tocados.

**Confirmado explícitamente con el usuario** antes de implementar (ver también Decisión 1, misma ronda de preguntas).

### Decisión 3 — Bug real detectado antes de implementar: Capacidad Disponible NO puede reconstruirse "retrocediendo `now`"

**Hallazgo (durante la fase de diseño, antes de escribir código):** la técnica originalmente propuesta para reconstruir un histórico de Capacidad Disponible era llamar `computeCapacityForecast(userId, now)` con un `now` retrocedido N semanas, replicando cómo `computeConsistency` ya construye comparaciones "ventana actual vs. anterior". Para Consistencia esto es seguro: toda consulta subyacente (`TaskActivity.createdAt`, `Task.completedAt`/`endDate`, `LeaveRecord.date`) está acotada por un timestamp inmutable. Para Capacidad Disponible NO lo es: su cálculo de "comprometido futuro" filtra por `Task.status` — un campo **mutable, sin tabla de historial propia** (`TaskStatusHistory` no existe). Retroceder `now` solo desplaza la matemática de días hábiles/festivos, pero la consulta de "qué tareas están abiertas" sigue reflejando el estado de HOY: una tarea cerrada hace 2 semanas desaparecería de la "foto" de hace 2 semanas, y una tarea creada ayer aparecería como si ya existiera entonces.

**Decisión:** en vez de la técnica de backdating, Capacidad Disponible en el Trend Engine usa `getFactorAuditHistory(userId, "health_score", now, windowDays)` filtrado al factor `"Capacidad futura"` — un dato genuinamente histórico, porque es lo que el motor realmente capturó en cada corrida pasada de `computeHealthScore`. Trade-off aceptado: granularidad oportunista (un punto por corrida no cacheada, no garantizado semanal) — para usuarios poco activos en la ventana, el indicador reporta `available: false` en vez de sintetizar un valor.

**Por qué importa documentarlo:** de no haberse detectado, el sistema habría mostrado un "histórico" de Capacidad Disponible plausible pero silenciosamente incorrecto — el tipo de bug que pasa revisión visual sin problema.

### Decisión 4 — Simulador: 3 rutas nuevas, no una extensión de la ruta protegida

**Hallazgo:** de los 5 escenarios pedidos en Bloque 8, "agregar horas" y "cerrar tareas" ya existen tal cual en `/api/analytics/simulate/[userId]` (`register_hours`/`complete_task`). Los otros 3 ("redistribuir carga", "modificar tiempo objetivo", "agregar participantes") no encajan en el contrato de esa ruta: 2 son bi-usuario/proyecto (esa ruta es de un solo usuario), y extenderla habría significado cambiar la forma de respuesta para sus 2 consumidores existentes (`WhatIfSimulator.tsx`, `TeamWorkloadCards.tsx`), protegidos este sprint.

**Decisión:** 3 rutas nuevas (`/api/predictive/simulate/[userId]` — tiempo objetivo; `/api/predictive/simulate/redistribute` — bi-usuario; `/api/predictive/simulate/project/[projectId]` — proyecto), todas reutilizando las funciones puras ya exportadas por el motor (`computeWorkloadRange`, `classifyCapacity`, `capacityToScore`, `weightedPoints`, `cargaHealthScore`) en vez de reimplementarlas. La UI nueva (`ScenarioSimulatorPanel.tsx`) llama a la ruta protegida existente SIN modificarla para los 2 escenarios que ya cubre, y a las 3 rutas nuevas para el resto — consumir una ruta protegida está permitido; modificarla no.

**Llamada de alcance sobre "modificar tiempo objetivo":** el pedido no aclara si se refiere al Tiempo Objetivo de una Tarea o de un Proyecto (ambos existen en el modelo de datos). Se optó por **nivel de Tarea** — es el término más establecido de la plataforma (Sprint 6) y encaja en el contrato de usuario único junto a los otros 2 escenarios de Tarea, dejando "agregar participantes" (claramente de Proyecto) como el único escenario de ese nivel. Reversible sin gran esfuerzo si la intención real era a nivel de Proyecto.

### Decisión 5 — "Ejecución en segundo plano" (Bloque 16) se interpreta como cálculo cacheado bajo demanda, no una cola de trabajos

**Hallazgo:** Nexo no tiene infraestructura de cola de trabajos/jobs en segundo plano en ningún módulo — el motor central (`analytics.ts`) resuelve "rendimiento" con caché en memoria (`cached()`, TTL configurable) y computación bajo demanda en la ruta de API, nunca con un worker separado.

**Decisión:** la capa predictiva sigue exactamente ese mismo patrón — cada ruta nueva envuelve su cálculo en `cached()` (TTL de 15 min por defecto para vistas individuales, igual que el resto del motor; TTL corto de 5 min para vistas de equipo/proyecto, ver Decisión 6). Construir una cola de jobs real habría sido una pieza de infraestructura nueva y no solicitada explícitamente, fuera de proporción para lo que el bloque realmente pedía (evitar bloquear al usuario con cálculos repetidos).

### Decisión 6 — Caché de equipo/proyecto: TTL corto en vez de invalidación por evento

**Hallazgo:** `invalidateAnalyticsCache(userId)` (motor central) borra únicamente claves de caché que terminan en `:${userId}`. Las cachés nuevas de equipo (`subutilization-team:${leaderId}`) y de proyecto (`project-delay:${projectId}`) están indexadas por un id que NO es el usuario cuyo dato cambió — cuando un miembro del equipo o participante de un proyecto crea/completa una tarea, esa mutación no invalida la caché del líder ni la del proyecto. Conectar esa invalidación real habría requerido tocar `src/app/api/tasks/**`/`src/app/api/projects/**`, fuera de alcance (Decisión 2).

**Decisión:** TTL deliberadamente corto (5 min, vs. los 15 min por defecto) en las 2 cachés de equipo/proyecto — consistencia eventual aceptada y documentada, no un descuido.

### Decisión 7 — Definiciones operativas para "Proyectos" y "Actividades" (Trend Engine)

El pedido nombra estos 2 indicadores sin definirlos. Se optó por: **Actividades** = conteo semanal de `TaskActivity` (frecuencia de registro, distinto de "Horas registradas" que es por duración); **Proyectos** = suma semanal de `ProjectActivity.duration` (horas dedicadas a proyectos). Ambas son agregaciones nuevas pero simples (sin fórmula de negocio propia, sin pesos ni umbrales) — fácilmente ajustables si la intención real era otra.

**Verificación:** `npx tsc --noEmit` (2 errores preexistentes no relacionados), `npm run lint` (0 errores), `npx vitest run` (1026/1026 — 971 preexistentes + 55 nuevos: `trendEngine.test.ts`, `predictionEngine.test.ts`, `predictiveConfig.test.ts`, `predictive-settings.test.ts`, `predictive-auth.test.ts`, `predictive-simulate.test.ts`, extensión de `navLinks.test.ts`), `npm run build` limpio (todas las rutas nuevas registradas). Smoke test con servidor de desarrollo real: `/inteligencia-preventiva` y las rutas `/api/predictive/**`/`/api/settings/prediction-window` responden 307 (redirect a login) sin sesión, sin errores 500 en el log del servidor. No se intentó una verificación visual autenticada — la base de datos de desarrollo de este proyecto ES la de producción con datos reales de personal (ver memoria de sesión), y las credenciales semilla documentadas ya no son válidas; forzar credenciales quedó descartado.

**Un bug real fue encontrado y corregido durante la propia escritura de tests de este sprint** (no en producción): `hasAbruptChange` en `trendEngine.ts` originalmente comparaba el último punto contra la media PLANA de los anteriores, lo que clasificaba cualquier tendencia fuerte y perfectamente lineal como "cambio_brusco" (falso positivo). Corregido para comparar contra el residuo respecto a la recta de regresión — ver `docs/ANALYTICS_FORMULAS.md` §16 para el detalle. Esto también reveló que el CV debía calcularse sobre residuos (ruido tras remover la tendencia), no sobre el valor crudo alrededor de la media plana — de lo contrario cualquier tendencia fuerte se clasificaba como "variable" en vez de "positiva"/"negativa".

**Aprobado por:** Anthony Jácome (confirmó explícitamente las Decisiones 1 y 2 antes de implementar).

---

## 2026-07-26 — Ventana de registro retroactivo: excepción de fin de semana

**Problema:** la regla de registro retroactivo (48 horas hábiles / últimos 2
días laborables, `previousBusinessDays()` en `src/lib/businessTime.ts`)
nunca incluía sábado ni domingo, porque solo cuenta días lun-vie. Un
colaborador que trabajó el fin de semana no tenía forma de registrar esas
horas una vez pasado el lunes siguiente, salvo pedir una edición manual a un
Administrador.

**Restricción explícita del pedido:** mantener intacta la regla de 2 días
laborables; no crear una lógica paralela de fechas; reutilizar el mismo
componente/motor existente en todos los puntos de la plataforma que lo usan;
no tocar Analytics/KPIs/Auditoría/Historial/Registro de horas.

### Decisión 1 — Alcance real: Seguimiento y Proyectos, no Tareas Fijas

**Hallazgo durante la exploración previa a implementar:** el pedido
enumeraba "Tareas Fijas" como parte del alcance, pero Fija nunca tuvo
registro retroactivo — fue una decisión explícita del sprint de unificación
de registro de actividades (2026-07-21, commit `11e9886`): `ActivityPanel`
(usado por Fija) solo registra "hoy", sin selector de fecha, y `POST /api/
tasks/[id]/activities/retroactive` rechaza con 400 cualquier tarea que no
sea `SEGUIMIENTO`. Ese sprint documentó la exclusión como alcance
deliberado, no un olvido (ver `docs/DECISIONS.md`).

**Alternativas consideradas:**
1. Interpretar "Tareas Fijas" literalmente y construir registro retroactivo
   nuevo para Fija (UI + API), además de la excepción de fin de semana.
2. Tratar la mención de Fija como una imprecisión del pedido — Fija no tenía
   retroactivo antes de este cambio, así que no puede "ganar" la excepción
   de fin de semana sobre una capacidad que no existe — y aplicar el cambio
   solo donde el retroactivo ya existe (Seguimiento, Proyectos).

**Decisión:** opción 2, confirmada explícitamente con el usuario antes de
tocar código (no se asumió). Construir retroactivo nuevo para Fija habría
sido una expansión de alcance no pedida por este cambio en particular —
además de chocar con el límite de 2 registros máximo de Fija, una interacción
que el pedido original no contemplaba y que ameritaría su propio diseño.

**Impacto:** Fija sigue exactamente igual (solo "hoy"). Si en el futuro se
pide extender retroactivo a Fija, el motor `retroactiveValidDates()`
construido aquí ya queda listo para reutilizarse sin cambios.

### Decisión 2 — Motor único: `weekendGraceDays()` + `retroactiveValidDates()` en `businessTime.ts`, no tocar `previousBusinessDays()`

**Alternativas consideradas:**
1. Modificar `previousBusinessDays()` para que cuente sábado/domingo como
   "días laborables" condicionalmente — descartada: esa función se usa
   también fuera del contexto retroactivo (p. ej. cálculo de carga laboral)
   y redefinir qué es un "día laborable" ahí habría sido un cambio de mucho
   mayor blast radius que lo pedido.
2. Duplicar el cálculo de fechas válidas en cada uno de los 4 call sites
   (2 componentes de cliente + 2 rutas de API) — descartada explícitamente
   por el pedido ("no crear lógica paralela", "un único motor de
   validación").
3. **Elegida:** dos funciones nuevas y puras en `businessTime.ts` —
   `weekendGraceDays(today)` (sábado/domingo del fin de semana inmediato
   anterior, solo si `today` es lunes o martes; vacío el resto de la
   semana) y `retroactiveValidDates(today, count)` (combina
   `previousBusinessDays` + `weekendGraceDays`, ordenado más reciente
   primero) — y todos los call sites migran de `previousBusinessDays` a
   `retroactiveValidDates`. `previousBusinessDays()` queda sin cambios,
   preservando cualquier otro consumidor.

**Por qué el corte es "disponible hasta el martes, no más":** el pedido fue
explícito ("no deberán mantenerse disponibles más allá de esa ventana") — la
regla de negocio subyacente es que el fin de semana es una extensión
temporal ligada a los 2 días hábiles siguientes (lunes y martes), no una
ventana propia de fecha calendario. Se implementó comparando
`today.getUTCDay()` contra lunes(1)/martes(2) en vez de una resta de días
calendario, para que el corte del miércoles sea exacto sin casos borde
alrededor de feriados o fin de mes.

**Verificación:** `npx vitest run` (970/970, incluye 9 tests nuevos en
`businessTime.test.ts` cubriendo los 7 días de la semana según la tabla del
pedido), `npx tsc --noEmit` (2 errores preexistentes no relacionados),
`npm run lint` (0 errores).

**Aprobado por:** Anthony Jácome (confirmó explícitamente excluir Fija del
alcance antes de implementar).

---

## 2026-07-24 — Sprint Analytics 2.1: Mejora del Reporte Ejecutivo y Calidad de la Comparabilidad

**Problema:** el Informe Ejecutivo (construido en Sprint Reportes Ejecutivos
2.0) comparaba a todos los colaboradores contra la base mensual **completa**,
sin importar cuándo empezaron a tener disponibilidad real para registrar en
NEXO — un colaborador incorporado a mitad de mes salía con un % de
utilización artificialmente bajo. Además, generar el informe no ofrecía
ninguna personalización (siempre todo el equipo, todas las secciones, un
solo formato de PDF), y no había forma de identificar de un vistazo el
estado operativo ni el hallazgo principal de cada colaborador sin leer fila
por fila.

**Restricción explícita del sprint:** no modificar fórmulas/pesos/KPIs
existentes del Analytics Engine (`src/lib/analytics.ts`), ni el historial,
la auditoría o los roles/permisos — toda la información nueva debía
derivarse del motor actual, sin duplicar cálculos.

### Decisión 1 — Base Horaria Efectiva: reutilizar `computeEffectiveHistoryStart`, no crear un cálculo paralelo

**Alternativas consideradas:**
1. Crear una nueva noción de "fecha de incorporación a NEXO" específica para
   reportes (p. ej. leer solo `User.createdAt`).
2. Reutilizar `computeEffectiveHistoryStart` (`analytics.ts`), ya construido
   en el Analytics Engine v1.3.1 para el mismo problema conceptual
   (excluir de Consistencia las semanas anteriores al historial real de un
   colaborador) — cruza `kpiStartDate`, primera actividad, primera tarea
   completada, primera imputación de horas y `createdAt`, quedándose con la
   señal más reciente.

**Decisión:** opción 2. **Justificación:** `computeEffectiveHistoryStart` ya
resuelve exactamente "¿desde cuándo hay historial real de este colaborador?"
con más señales que solo `createdAt` (un Administrador puede fijar
`kpiStartDate` manualmente, o un colaborador puede tener su cuenta creada
mucho antes de empezar a usar NEXO activamente) — crear un cálculo paralelo
habría sido una duplicación explícitamente prohibida por el sprint.
**Impacto:** la Base Horaria Efectiva y la exclusión de historial de
Consistencia usan ahora, literalmente, la misma función — un cambio futuro a
esa lógica se refleja automáticamente en ambos lugares.

**Decisión derivada — proration por rango, no mes a mes, en informes
multi-mes:** `range/route.ts` calcula la base compartida del equipo mes a
mes (para que un cambio de configuración a mitad del rango se refleje
correctamente en el TOTAL del equipo). Extender esa misma granularidad a la
proration individual por colaborador habría duplicado ese recorrido mensual
solo para un caso adicional (alguien que se incorpora a mitad de un rango
de varios meses). Se optó por una tarifa única (la vigente al inicio del
rango completo) para la proration individual — un colaborador que se
incorpora a mitad de un rango de 6 meses obtiene su base correctamente
recortada, aunque la tarifa horas/día usada sea la del inicio del rango en
vez de la vigente mes a mes. Edge case documentado, no resuelto con
complejidad adicional (ver `docs/DECISIONS.md`).

### Decisión 2 — Estado Operativo/Principal Hallazgo fuera del mes en curso: aproximación, no el motor completo

**Alternativas consideradas:**
1. Invocar `computeHealthScore(userId, now)` con `now` = fecha de cierre del
   período del informe, para CUALQUIER período (mes pasado, rango), no solo
   el mes en curso — daría el Equilibrio Operativo "real" de ese período.
2. Reutilizar el Equilibrio Operativo real solo cuando el informe es del mes
   calendario en curso (igual que el Índice Ejecutivo, Sprint Reportes
   Ejecutivos 2.0); para cualquier otro período, derivar una aproximación
   0-100 a partir de datos que el informe ya calcula (cumplimiento, zona de
   carga, vencidas) y clasificarla con los mismos 5 tramos de
   `classifyEstadoOperativo`.

**Decisión:** opción 2. **Justificación:** Equilibrio Operativo incluye
Capacidad Futura, una proyección **hacia adelante desde `now`**
(`capacityForecast.ts`) — invocarla con un `now` histórico no es un uso
validado de esa función en ningún otro punto del sistema, y el sprint pide
explícitamente no tocar el Analytics Engine ni introducir usos nuevos no
probados de sus piezas. Mantener el mismo criterio que el Índice Ejecutivo
(ya documentado y aceptado en Sprint Reportes Ejecutivos 2.0) evita crear un
segundo precedente distinto para el mismo problema. **Impacto:** todo
informe muestra Estado y Hallazgo para el 100% de los colaboradores (nunca
"—"), pero el significado exacto de "Estado" difiere ligeramente entre el
mes en curso (Equilibrio Operativo real) y cualquier otro período
(aproximación) — diferencia documentada en el código y en
`docs/DECISIONS.md`, no expuesta como ambigüedad silenciosa.

### Decisión 3 — Generador Inteligente: un endpoint nuevo solo para fechas que no calzan con meses

**Alternativas consideradas:**
1. Construir un motor de reportes completamente nuevo, de granularidad
   diaria, y migrar los 7 presets de período a él (incluyendo mes
   actual/anterior/trimestre/semestre/año).
2. Detectar qué presets calzan exactamente con límites de mes calendario
   (mes actual, mes anterior, trimestre, semestre, año — los 5 primeros) y
   reutilizar `/api/reports/generate`/`/api/reports/range` ya existentes
   para esos; construir un endpoint nuevo (`/api/reports/custom-range`) SOLO
   para los 2 presets que sí necesitan granularidad de día ("Últimos 30
   días", "Rango personalizado").

**Decisión:** opción 2. **Justificación:** el sprint exige explícitamente
"reutilizar componentes existentes siempre que sea posible" y "no duplicar
cálculos" — reescribir un motor ya probado (con sus queries, agregaciones y
casos borde ya cubiertos por tests) para presets que YA funcionan
perfectamente con la granularidad de mes existente habría sido trabajo
puramente redundante y un riesgo de regresión innecesario en rutas
estables. **Impacto:** `custom-range/route.ts` es deliberadamente más
pequeño de lo que un "motor unificado" habría sido — cubre exactamente el
gap real (fechas arbitrarias), nada más.

### Decisión 4 — PDF Ejecutivo vs. PDF Completo: un set de secciones fijo, no negociable por checkboxes

**Decisión:** el PDF Ejecutivo siempre incluye exactamente Resumen, KPIs,
Equilibrio Operativo, Ranking, Hallazgos y Recomendaciones — intersección
con lo tildado por el usuario, nunca una sección fuera de ese set, sin
importar qué se haya marcado en el asistente. El PDF Completo sí respeta
la selección de secciones tal cual. **Justificación:** el propósito
declarado de tener dos variantes de PDF es que una sea "ejecutiva" (rápida
de leer, predecible para dirección) y la otra "completa" (todo lo que el
usuario pidió) — si el Ejecutivo pudiera terminar con 10 secciones según lo
que alguien tildó, dejaría de cumplir su propósito y ambas variantes
colapsarían en una sola. **Impacto:** dirección siempre recibe el mismo
formato condensado sin importar quién generó el informe ni qué olvidó
destildar.

### Alcance no implementado (documentado, no una omisión silenciosa)

- **Comparación de Equipos (Bloque 12):** solo arquitectura
  (`src/lib/teamComparison.ts`, tipos + función placeholder) — el bloque lo
  pide explícitamente ("no mostrar todavía esta funcionalidad"). Sin cambios
  de schema: NEXO no tiene hoy un campo de área/equipo/coordinación/zona en
  `User`.
- **"Capacidad limitada" como Principal Hallazgo:** el catálogo de
  hallazgos del Bloque 10 lo menciona, pero requeriría invocar
  `computeCapacityForecast` (forward-looking) para cada colaborador en
  cualquier período — mismo problema que Decisión 2. Se omitió esa regla
  específica en vez de forzar el mismo compromiso ya documentado una
  tercera vez; el resto del catálogo (Sobrecarga/Subutilización/Retrasos
  recurrentes/Consistencia baja/Sin tareas vencidas/Carga equilibrada) sí
  está implementado.
- **Filtro rápido "Solo colaboradores activos":** NEXO no tiene un concepto
  de colaborador inactivo/desactivado (la baja de un usuario es eliminación
  física, ver `UsersManager.tsx`) — el filtro existe en la UI (pedido
  explícito del Bloque 5) pero equivale a "Seleccionar todos".

**Verificación:** `npx tsc --noEmit` sin errores nuevos, `npx eslint` limpio
en los 10 archivos tocados/nuevos, suite completa de Vitest en verde (962
tests, incluyendo `reports.test.ts` con mocks ampliados para las nuevas
dependencias de Prisma que introduce `computeEffectiveMemberBases`).

**Aprobado por:** Anthony Jácome (dueño de producto).

---

## 2026-07-24 — Sprint Reportes Ejecutivos 2.0: Inteligencia Organizacional en el Informe Consolidado

**Problema:** el Informe Mensual Consolidado (`MonthlyReports.tsx` +
`reports/{generate,range}/route.ts`) era, en esencia, una exportación de
tablas — tarjetas de resumen, tabla de detalle, barras CSS de ranking/
motivo, y un bloque de prosa de Groq. Un Coordinador/Jefe Nacional no podía
entender el estado del equipo en 5 minutos sin leer tabla por tabla, y
ningún indicador se auto-explicaba (qué significa/por qué/impacto/acción).

**Restricción explícita del sprint:** no tocar `src/lib/analytics.ts` (el
Analytics Engine) ni sus fórmulas/pesos — todo lo nuevo debía ser una capa
de composición/interpretación sobre datos ya calculados.

### Decisión 1 — El "Análisis IA" (Groq) existente se mantiene, las secciones nuevas son reglas

**Alternativas consideradas:**
1. Reemplazar por completo el bloque de Groq por el nuevo motor
   determinístico, alineado estrictamente con el "no usar IA" del Bloque 3.
2. Mantener el Análisis IA intacto y agregar las nuevas secciones
   deterministas (Resumen Ejecutivo, Hallazgos, Recomendaciones) como el
   nuevo cuerpo principal, con el análisis de IA más abajo, como lectura
   complementaria.

**Decisión:** opción 2 (confirmada con el usuario). **Justificación:** el
Bloque 3 exige explícitamente reglas (no IA) para las *recomendaciones
nuevas* que ese bloque pide — no pide eliminar una funcionalidad existente
que nadie señaló como problema. Quitar el Análisis IA habría sido un
cambio de alcance mayor al pedido. **Impacto:** el usuario ve ambos: una
lectura ejecutiva basada en reglas fijas (auditable, reproducible) y,
debajo, la narrativa de Groq como complemento — sin perder funcionalidad.

### Decisión 2 — Índice Ejecutivo del Equipo: motor completo, pero solo para el mes en curso

**Alternativas consideradas:**
1. Basar el nuevo "Índice Ejecutivo del Equipo" (Bloque 11) en
   `computeSimpleScore`, el score que el reporte ya usaba (liviano, sin
   llamadas nuevas al motor).
2. Promediar Performance Score + Equilibrio Operativo por miembro
   (`computeHealthScore`), reutilizando el patrón `cached(perf-bench:/
   equilibrio-bench:)` ya construido en `/api/kpis/executive`.

**Decisión:** opción 2 (confirmada con el usuario). **Justificación:**
`computeSimpleScore` (cumplimiento + ratio horas + progreso) no incluye
carga laboral, salud operativa ni consistencia — el Bloque 11 pide
explícitamente que el índice resuma esas 5 dimensiones. Solo el motor
completo las cubre honestamente.

**Restricción derivada:** Equilibrio Operativo incluye Capacidad Futura,
una proyección **hacia adelante desde "ahora"** (`capacityForecast.ts`) —
no es representativa si se recalcula para un mes pasado, y el generador de
informes permite regenerar cualquier mes, no solo el actual. Por eso el
Índice Ejecutivo (y las dimensiones que dependen de él: `equilibrioScore`
por miembro, el insight "mantiene el mayor Equilibrio Operativo",
variaciones de consistencia) se calculan **únicamente cuando el mes del
informe es el mes calendario en curso** — en informes históricos se
muestra una nota explicativa en su lugar (`indiceEjecutivo: null`). La
"variación vs. período anterior" del índice se resuelve comparando contra
el valor ya persistido en el `MonthlyReport` del mes anterior (mismo
scope) — no recalculando el motor para un mes pasado.

Performance Score (cumplimiento/vencidas/consistencia/trazabilidad,
ninguno forward-looking) es seguro para cualquier mes — por eso las
Tendencias (Bloque 9, mes anterior/trimestre/semestre) se basan en
`computeTeamMonthlySnapshots`, un helper nuevo que usa
`computeSimpleScore`/`computeCompletedPctAny` (mismos cálculos ya
validados en `reports/range`), no el motor completo — seguro para
cualquier ventana de meses pasados, sin las 6+ llamadas extra por miembro
que el motor completo habría requerido.

### Decisión 3 — Alcance de Bloques 1/9/11 en el informe de Rango

El Índice Ejecutivo y las tarjetas de tendencia mes/trimestre/semestre
**no se agregaron** a `reports/range` (informe de rango personalizado):
un rango de N meses no tiene un "mes en curso" al cual gatear el índice, y
el informe de rango ya expone su propia evolución mes a mes (`months[]` +
`trends.cumplimientoTrend`), que cubre el mismo propósito del Bloque 9 sin
datos adicionales. Sí se agregaron a `reports/range`: Hallazgos,
Recomendaciones, Insights, Mapa de Riesgo y Distribución por Motivo con %
(sin tendencia — un rango de N meses no tiene un "período anterior
equivalente" sin ambigüedad, a diferencia de un solo mes).

### Decisión 4 — `computeTeamMonthlySnapshots` no reemplaza la lógica ya existente en `kpis/executive`

`src/app/api/kpis/executive/route.ts` ya construye snapshots mensuales
muy similares (líneas 82-190) para su propio propósito (dashboard
ejecutivo de 6 meses). Se evaluó extraer un helper único compartido entre
los 3 call sites, pero se decidió **no tocar `kpis/executive/route.ts`**
en este sprint — es una ruta ya estable y probada, fuera del alcance
declarado (Informe Consolidado), y refactorizarla como efecto colateral
introduce riesgo de regresión no solicitado. `computeTeamMonthlySnapshots`
(nuevo, en `reportInsights.ts`) deduplica la lógica dentro del alcance de
este sprint (usado por `reports/generate`); la unificación completa con
`kpis/executive` queda documentada como oportunidad en `docs/ROADMAP.md`.

**Verificación:** `tsc --noEmit` (2 errores preexistentes sin relación),
`eslint .` (0 errores, 3 warnings preexistentes sin relación), `vitest run`
(962/962 — 936 previos + 26 nuevos para `classifyIndiceEjecutivo`/
`computeRiskQuadrant`/`explainMotivoDistribution`/`computeTrendComparisons`/
`computeFindings`/`computeRecommendations`/`computeTeamInsights`), `next
build` exitoso. `git diff -- src/lib/analytics.ts` confirma **diff
vacío** — ninguna fórmula, peso, KPI ni clasificación del Analytics Engine
se tocó.

**Aprobado por:** Anthony Jácome (plan revisado y aprobado explícitamente
antes de implementar, incluyendo las decisiones 1 y 2 vía pregunta directa).
Pendiente de aprobación expresa para commit/push.

---

## 2026-07-24 — Sprint Analytics 2.0: Inteligencia Explicable e Interpretación Ejecutiva

**Problema:** `computeHealthScore` (Score de Salud Laboral) llevaba congelado
desde Sprint 5 §S5-A — candidato a retiro, sin ninguna capa de explicación
propia, mientras Performance Score y Riesgo Operativo ya habían ganado
interpretación automática (fortalezas/oportunidades/tendencias) en Sprint A y
Sprint 6. Además, ninguno de los indicadores actuales respondía
automáticamente 4 preguntas ejecutivas básicas (¿qué significa?/¿por
qué?/¿qué impacto tiene?/¿qué hacer?), y `capacityToScore` tenía un salto
abrupto real: cualquier sobrecarga proyectada, desde -1% hasta -90%, caía
igual a 0 puntos.

### Decisión 1 — Alcance del rename "Salud Laboral" → "Equilibrio Operativo"

**Alternativas consideradas:**
1. Renombrar todo, incluidos los símbolos de código
   (`computeHealthScore`/`HealthScoreResult`) y el valor persistido
   `AnalyticsAuditLog.kind = "health_score"`.
2. Renombrar solo texto visible al usuario y prosa de documentación,
   dejando intactos los símbolos de código y el valor persistido.

**Decisión:** opción 2. **Justificación:** `AnalyticsAuditLog.kind =
"health_score"` está escrito en miles de filas históricas y es leído por
`getResolvedAlertsHistory`/`computeRecommendationReevaluation`/
`getScoreTrendExplanation` — renombrarlo rompería esas lecturas contra
historial ya persistido, y las restricciones explícitas de este sprint
prohibían tocar "historial"/"auditoría". Los símbolos TypeScript son
identificadores internos sin costo de negocio en mantenerlos; renombrarlos
habría sido un refactor mecánico grande sin beneficio funcional. La única
excepción: la clave `FORMULA_VERSIONS.scoreSalud` → `equilibrioOperativo` sí
se renombró, porque es solo una clave de lookup en código (usada por
`AUDIT_KIND_FORMULAS` para versionar auditorías *futuras*), nunca un dato ya
escrito en BD.

**Impacto:** cero riesgo de romper lecturas de historial; el usuario nunca
ve "Score de Salud"/"scoreSalud" en ninguna pantalla, tooltip, reporte o
narrativa de Nova.

### Decisión 2 — Normalización progresiva de Capacidad Futura (único cambio matemático autorizado)

**Problema:** `capacityToScore` mapeaba cualquier sobrecarga proyectada
(`disponible < 0` horas) directo a 0 puntos, sin gradación — -1% de
sobrecarga puntuaba igual que -90%.

**Decisión:** reemplazar esa rama por una curva lineal
`score = clamp(round(100 + 2×disponiblePct), 0, 100)`, activada por
`estado === "sobrecarga"` (no por el signo de `disponiblePct`). Reproduce
los 7 anclajes exactos pedidos: 0%→100, -5%→90, -10%→80, -20%→60, -30%→40,
-40%→20, -50%→0 (y más allá, acotado en 0).

**Corrección encontrada durante la implementación:** la primera versión
condicionaba por `disponiblePct < 0` en vez de `estado === "sobrecarga"`. Una
sobrecarga leve puede redondear a `disponiblePct = 0` exacto (ej. `-0.4h`
sobre una base grande — `classifyCapacity` ya la clasifica `"sobrecarga"`
porque mira `disponible < 0` en horas crudas, no el porcentaje redondeado).
Con la condición original, ese caso caía al valor plano `40` en vez de la
curva progresiva — recreando exactamente el mismo salto abrupto que el
Bloque 9 buscaba eliminar, solo desplazado al borde 0%. Se corrigió antes de
cerrar el sprint (test agregado: `capacityToScore("sobrecarga", 0)` →
`100`).

**Por qué no se migró todo `capacityToScore` al `NormalizationEngine`
existente:** ya existe una curva `capacidad` configurable en Ajustes, pero
es código muerto (ningún cálculo real la consume) y sus puntos de control no
coinciden con los anclajes de este sprint. Migrar el lado positivo
(`alta`/`limitada`/`sin-planificacion` → 100/70/70) habría ampliado el único
cambio matemático autorizado más allá de lo pedido — diferido a
`docs/ROADMAP.md`.

**Impacto numérico (ejemplo real, ver `docs/ANALYTICS_FORMULAS.md` §3):** un
colaborador con `estado="sobrecarga"`, `disponiblePct=-30` pasa de
`capacityToScore=0` (score total Equilibrio Operativo: 69.00) a
`capacityToScore=40` (score total: 75.00) — cambia su Estado Operativo de
"Requiere Atención" a "Equilibrio Estable" en el ejemplo dado. Afecta
únicamente a usuarios con capacidad futura negativa proyectada.
`FORMULA_VERSIONS.capacidadDisponible`/`equilibrioOperativo` suben a `"1.1"`;
`FORMULA_SET_VERSION` sube de `4.3` a `4.4` (de paso corrige una
desincronización preexistente: el código ya estaba en 4.3 desde el fix de
`isCompletedOnTime`, 2026-07-24, pero `docs/ANALYTICS_FORMULAS.md` seguía
documentando 4.2).

### Decisión 3 — Alcance del Bloque 13 ("aplicar el estándar a todos los KPIs")

Confirmado explícitamente con el usuario (`AskUserQuestion`): esta pasada
cubre **Equilibrio Operativo completo**, cuyas 5 dimensiones ya explican
Cumplimiento/Carga/Consistencia/Capacidad como parte de su propia tarjeta.
Extender el mismo patrón a las tarjetas standalone (Cumplimiento, Carga
Laboral, Capacidad Disponible, Trazabilidad, Predicción, Smart Benchmark)
queda como backlog priorizado en `docs/ROADMAP.md`, con el patrón ya
construido (`computeEquilibrioInsights`/`explainEquilibrioFactor` en
`insightsEngine.ts`) como plantilla reutilizable — no se tocó su código en
esta pasada.

### Motor de interpretación nuevo

`insightsEngine.ts` gana `computeEquilibrioInsights`/`explainEquilibrioFactor`/
`explainEquilibrioMeaning`/`explainEquilibrioImpact`, mismo patrón
100% determinístico (sin IA) que ya regía `computePerformanceInsights` —
plantillas fijas por Estado Operativo/dimensión, nunca texto generado. Nuevo
clasificador `classifyEstadoOperativo` (5 niveles: 🟢 Equilibrio Óptimo
90-100 / 🔵 Equilibrio Estable 75-89 / 🟡 Requiere Atención 60-74 / 🟠 Riesgo
Operativo 40-59 / 🔴 Desequilibrio Crítico 0-39) es una capa de presentación
**adicional** sobre `HealthScoreResult.score` — no reemplaza la
clasificación inline de 4 niveles (`classification`/`classificationColor`)
que `WhatIfSimulator`/`TeamWorkloadCards`/nova-insights siguen leyendo sin
cambios.

**Verificación:** `tsc --noEmit` (2 errores preexistentes sin relación),
`eslint .` (0 errores, 3 warnings preexistentes sin relación), `vitest run`
(936/936 — 919 previos + 17 nuevos para `capacityToScore`/
`classifyEstadoOperativo`/`computeEquilibrioInsights`/
`explainEquilibrioMeaning`/`explainEquilibrioImpact`), `next build`
exitoso (incluye la nueva ruta `/api/analytics/equilibrio/[userId]`).

**Aprobado por:** Anthony Jácome (autorización explícita: "proceed sprint
analytics 2.0"). Pendiente de aprobación expresa para commit/push.

---

## 2026-07-24 — Sprint D (continuación): UX, Calidad del Dato ampliada, validación de efectos secundarios

Versión más detallada del mismo Sprint D (entrada siguiente, v1.15.0) —
cubre bloques que esa primera pasada dejó acotados o pendientes: un
Bloque 7 (UX) con hallazgos reales (la primera pasada lo había dejado
fuera "por falta de hallazgos concretos"), un Bloque 5 ampliado con 2
verificaciones nuevas de Calidad del Dato, y un Bloque 11 nuevo
(validación de efectos secundarios) que no existía en el pedido original.
Mismas restricciones de siempre, ahora explícitas por escrito: sin módulos
nuevos, sin tocar fórmulas/KPIs/pesos, sin cambiar reglas de negocio sin
aprobación (documentar en su lugar), y sin commit/push hasta aprobación
expresa.

### Bloque 7 — UX

Auditoría dedicada (agente de solo lectura) sobre spacing/iconografía/
loaders/skeletons/mensajes/formularios/accesibilidad/responsive, con cita
archivo:línea. 10 hallazgos calificados como "solo markup, cero cambio de
comportamiento" se implementaron:

1. 18 spinners `animate-spin` sueltos → componente `Spinner` compartido
   (`src/components/ui/Skeleton.tsx`), en Reuniones, Perfil, Nova, y 13
   archivos de KPIs/Desk/Ajustes que Sprint B había dejado sin migrar pese
   a listarse como "módulo adoptado".
2. `aria-label="Cerrar"` en ~19 modales sin `Modal`/`ModalHeader`
   compartido (Ideas, Reuniones, Desk, Proyectos, Tareas) — el shell
   compartido ya lo incluye gratis, estos lo habían perdido al no usarlo.
3. `aria-label="Enviar"` + `aria-label` en el textarea del chat de Nova
   (`AssistantModule.tsx`), espejo de `NovaFab.tsx` que ya lo tenía bien.
4. `ProjectActivitiesTab.tsx` y `AssistantModule.tsx` migrados a
   `EmptyState` — en ambos casos existía una copia idéntica en otro
   archivo ya usando el componente compartido (`ActivityPanel.tsx`,
   `SettingsManager.tsx`), confirmando la intención.
5. Tabla LOPDP de `profile/page.tsx` (única tabla cruda de la app fuera
   de plantillas de exportación) envuelta en `overflow-x-auto`.
6. Migración a `Button` compartido en Ideas (`IdeasModule.tsx`,
   `NewIdeaFormModal.tsx`, `IdeaDetailModal.tsx` — 8 botones), Reuniones
   (`MeetingsModule.tsx` — 5 botones), Proyectos
   (`CreateProjectModal.tsx`, `ProjectCommentsTab.tsx`,
   `ProjectDocumentsTab.tsx`, `ProjectActivitiesTab.tsx`).
7. Normalización de radio de banners de error a `rounded-lg` (mayoría) en
   Login (antes `rounded-[10px]`, un tercer valor que no coincidía con
   ninguno de los dos documentados) y en los `rounded-xl` sueltos de
   Ideas/Desk/Tareas/Reuniones.
8. Normalización de ícono de cierre a `w-4 h-4` (mayoría) en modales de
   Ideas/KPIs/Tareas que usaban `w-5 h-5`; normalización de padding de
   tarjeta a `p-4` en `IdeaCard`/`MeetingCard` (antes `p-3`/`p-5`).

**Diferido a `docs/ROADMAP.md` (toca comportamiento, no solo markup):**
primitivo `Input`/`FormField` compartido para Login/Perfil (no existe hoy,
crearlo es una decisión de alcance mayor); unificar el color de los
banners "info/confirmación" (dos colores usados hoy para el mismo tipo de
mensaje); manejo de tecla Espacio en `IdeaCard.tsx` (toca interacción de
teclado).

### Bloque 5 (ampliado) — Calidad del Dato

Se agregaron 2 verificaciones reales nuevas (no defensivas) a
`src/app/api/settings/data-quality/route.ts`:

- **Motivo huérfano**: `TaskActivity.reason` es un `String` libre
  resuelto por convención contra `ActivityReason.key` — no es una FK
  real. Un motivo eliminado o mal escrito puede quedar "colgado" sin que
  el schema lo impida; este chequeo lo detecta (`ProjectActivity` no
  tiene campo de motivo, no aplica ahí).
- **Registros retroactivos inconsistentes**: dos chequeos de consistencia
  interna, deliberadamente no relativos a "hoy" (para no generar falsos
  positivos con datos históricos legítimos): `isRetroactive=true` sin
  `activityDate` (contradicción), y `isRetroactive=false` con
  `activityDate` en un día calendario distinto al de `createdAt`
  (sugiere un backdateo manual sin marcar el flag).
- Se extendió el chequeo ya existente "sin propietario" para incluir
  `ProjectParticipant.userId` vacío (mismo criterio defensivo que ya
  cubría `Task.assignedToId`/`Project.responsibleId` — ambos con FK
  real, se espera 0).

Las consultas de actividades se acotaron a los últimos 90 días
(`ACTIVITY_LOOKBACK_DAYS`, mismo valor que ya usaba el chequeo de
solapamiento) para mantener acotado un click bajo demanda de
Administrador — las tablas de Tarea/Proyecto/Fase sí se consultan
completas, dado su volumen mucho menor.

### Bloque 11 (nuevo) — Validación de efectos secundarios

No es código nuevo — es una revisión escrita de los cambios ya pusheados
en v1.15.0 más los de este mismo día, verificando cada categoría pedida:

- **Duplicación de horas**: `git diff` confirma que `recalcTaskRealHours`/
  `recalcProjectRealHours` (`src/lib/recalcHours.ts`) son una extracción
  literal (mismas líneas, mismo `reduce`/`Math.round`) de las funciones
  locales que reemplazaron — cero cambio de fórmula.
- **Cambios históricos en KPIs / alteraciones en Analytics**:
  `git diff dabac92 -- src/lib/analytics.ts src/lib/capacityForecast.ts
  src/lib/workload.ts src/lib/priorityCompliance.ts
  src/lib/normalizationEngine.ts prisma/schema.prisma` (dabac92 = último
  commit antes de Sprint D) devuelve **diff vacío** — ninguno de estos
  archivos protegidos se tocó, ni en la primera pasada ni en esta.
- **Modificación del Timeline**: `git diff dabac92 -- src/lib/projectHistory.ts`
  igualmente vacío; el único archivo que invoca `logProjectHistory`
  (`projects/[id]/activities/route.ts`) tiene un diff acotado a los
  imports de `parseDateOnly`/`recalcProjectRealHours` — la línea que
  llama a `logProjectHistory` no cambió.
- **Recálculos automáticos no previstos**: diff de `dashboard/route.ts`
  confirma que cada consulta agrupada en el nuevo `Promise.all` mantiene
  el mismo `where`/`select`/`orderBy`/`take` que tenía antes — solo se
  reordenaron y agruparon. Única diferencia real: `announcements`/
  `upcomingMeetings` pasaron de filtrar contra `now_` a `now` (dos
  `new Date()` separados por microsegundos en el código original) —
  diferencia de submilisegundos, sin efecto práctico.
- **Registros retroactivos inesperados / recreación de actividades**:
  Fase 1 (IDOR) solo agrega un chequeo de autorización (`canAccessTask`)
  antes de las rutas de creación existentes — no toca la lógica de
  creación en sí. Los 919 tests actuales (incluidos los de
  `tasks-activities-comments.test.ts`/`activities-retroactive-overlap.test.ts`)
  siguen en verde sin haber sido relajados para pasar.
- **Pérdida de trazabilidad**: se listaron y compararon uno a uno los 22
  call sites de `invalidateAnalyticsCache()` en `src/app/api/**` de antes
  de Sprint D contra los 24 de ahora — los 22 originales están todos
  presentes sin cambios; los 2 nuevos son los agregados deliberadamente en
  `activity-reasons` (Fase 2). Cero remociones.

**Conclusión:** ninguno de los riesgos listados en el Bloque 11 se
materializó. No se encontró ningún caso que requiriera documentarse como
riesgo residual.

### Informe final (Bloque 12, de esta continuación)

**Bugs corregidos:** ninguno nuevo en esta pasada (los de seguridad/
consistencia ya se corrigieron en v1.15.0) — esta pasada es refinamiento
UX + ampliación de un panel + validación, no corrección de bugs.

**Mejoras de UX:** 10 categorías, ~40 archivos (spinners, aria-labels,
EmptyState, tabla responsive, botones compartidos, radios/íconos/padding
normalizados).

**Calidad del dato:** 2 verificaciones nuevas + 1 extendida.

**Backlog generado:** 3 ítems UX que tocan comportamiento (Input/FormField
compartido, color de banner info/confirmación, tecla Espacio en
`IdeaCard`) — ver `docs/ROADMAP.md`.

**Verificación:** `tsc --noEmit` (2 errores preexistentes, sin relación),
`eslint` (0 errores, 3 warnings preexistentes), `vitest run` (919/919, +6
nuevas), `next build` exitoso.

**Aprobado por:** Anthony Jácome. Pendiente de aprobación expresa para
commit/push (instrucción explícita de este pedido).

---

## 2026-07-24 — Sprint D: Auditoría integral y refinamiento

**Objetivo del sprint:** consolidar NEXO como plataforma estable — sin
módulos nuevos, sin tocar fórmulas del Analytics Engine — reduciendo deuda
técnica, cerrando huecos de seguridad, mejorando performance y dejando la
documentación al día.

### Metodología (Bloque 1 — auditoría previa obligatoria)

Se ejecutaron 3 agentes de investigación de solo lectura en paralelo, cada
uno cubriendo un grupo de módulos, con instrucción explícita de citar
archivo:línea para cada hallazgo y clasificarlo como `[INCONSISTENCIA]`
(brecha no documentada), `[DUPLICACIÓN]` (código repetido) o
`[INTENCIONAL/DOCUMENTADO]` (divergencia ya explicada en el propio código):

1. Trabajo/Seguimiento/Proyectos — comparó las implementaciones paralelas
   de registro de actividad, retroactivo, comentarios, eliminación,
   documentos y participantes entre el dominio Task y el dominio Project.
2. Escritorio Digital/Reuniones/Equipo/Usuarios/Ajustes — auditó
   notificaciones (todo sitio que crea una `Notification`), archivado/
   retención, y consistencia operativa transversal.
3. Analytics/Dashboard/Seguridad/Calidad del dato — auditó duplicación de
   cálculos, N+1/caché, un barrido exhaustivo de control de acceso sobre
   las ~124 rutas de `src/app/api/**`, IDOR, y nulabilidad/`onDelete` del
   schema.

Resultado: ~40 hallazgos concretos. Ninguno reveló duplicación de fórmulas
de Analytics no documentada (Bloque 4 — auditoría limpia, sin cambios de
código necesarios ahí).

### Decisión de alcance

De los ~40 hallazgos, un subconjunto de ~8 cambiaba comportamiento de
negocio existente (notificaciones nuevas, capacidades nuevas, validaciones
más estrictas). El propio Sprint D exige aprobación explícita para ese tipo
de cambio ("No cambiar reglas de negocio sin aprobación"). Se presentó el
listado completo al usuario, que eligió **"Solo lo seguro"**: implementar
únicamente lo que es bug/seguridad/deuda técnica/performance sin tocar
comportamiento de negocio; el resto queda documentado como backlog en
`docs/DECISIONS.md`/`docs/ROADMAP.md`, no implementado este sprint.

**Corrección a un hallazgo de la auditoría:** el agente 2 marcó
`[INCONSISTENCIA]` que `PersonalReminder` se elimine sin papelera (hard
delete) mientras `DeskNote` sí pasa por `recoveryCenter`. Al revisar
`docs/DECISIONS.md` antes de escribir el backlog se encontró que esto **ya
es una decisión deliberada de un sprint anterior** (fila "`PersonalReminder`
no se integra al Centro de Recuperación", 2026-07-23: "ítem de
productividad personal de alta rotación — someterlo a retención/
restauración es sobre-ingeniería no pedida"). Se corrige la clasificación a
`[INTENCIONAL/DOCUMENTADO]` — no entra al backlog de este sprint como
"pendiente de corregir", solo como "revisar si cambian los requisitos".

### Hallazgos de seguridad (Bloque 8) — implementados

- **[CRÍTICO]** `tasks/[id]/comments/route.ts` (GET/POST),
  `tasks/[id]/activities/route.ts` (GET/POST),
  `tasks/[id]/activities/[activityId]/comments/route.ts` (GET/POST) y
  `tasks/[id]/activities/retroactive/route.ts` (POST, encontrado durante la
  implementación — no estaba en el listado original de 4 archivos del
  agente, mismo patrón) — ninguno verificaba que la tarea fuera visible/
  propia del solicitante antes de leer o escribir. Cualquier usuario
  autenticado podía comentar o registrar horas en cualquier tarea del
  sistema por ID, corrompiendo `realHours`/carga laboral de otra persona
  vía `recalcTaskRealHours`. `tasks/[id]/route.ts` (PATCH) sí tenía el
  chequeo correcto — nunca se propagó a los subrecursos.
  **Corrección:** `src/lib/taskAccess.ts` (`canAccessTask`), mismo patrón
  que el ya existente `src/lib/projectAccess.ts`, aplicado a los 5
  archivos y reutilizado en `tasks/[id]/route.ts` para eliminar también su
  propia duplicación inline del mismo chequeo.
- **[CRÍTICO]** `DELETE /api/users/[id]` llamaba `prisma.user.delete()` sin
  `try/catch`. Casi todas las FK hacia `User` en el schema no tienen
  `onDelete` explícito (default `NO ACTION` en Postgres) → eliminar
  cualquier usuario con historial (prácticamente cualquiera) lanzaba una
  excepción P2003 no controlada → 500 crudo sin explicación para el
  Administrador. **Corrección:** `try/catch` detectando `code === "P2003"`,
  respondiendo 409 con mensaje explicativo — no cambia el camino feliz
  (usuarios sin registros asociados se siguen eliminando igual).
- El resto de la superficie (~124 rutas revisadas exhaustivamente para
  `settings/**`, `users/**`, `analytics/**`; muestreo amplio del resto) no
  arrojó hallazgos adicionales de severidad alta — control de rol
  server-side consistente en toda la plataforma.

### Deuda técnica y consistencia (Bloques 3, 6, 11) — implementados

Consolidación segura sin cambio de comportamiento: `recalcRealHours` (4
copias idénticas → `src/lib/recalcHours.ts`), `parseDateOnly` (2 copias →
`src/lib/businessTime.ts`), `formatRelative` (2 copias → `src/lib/utils.ts`),
`formatDuration` (4 copias, **con inconsistencia real** — la de Tareas
nunca omitía unidades en cero, "0h 30min", las 3 de Proyectos sí, "30min";
se estandarizó al formato mayoritario), `taskSelect` (2 copias byte-a-byte
→ una sola, importada), el chequeo de jerarquía de Usuarios repetido 4-5
veces (`src/lib/roles.ts` → `canManageTargetUser`).

Bugs de comportamiento respecto a su propia intención documentada (no
reglas nuevas, correcciones): `ideas/route.ts` hardcodeaba el array de
roles revisores en vez de importar `CAN_REVIEW_IDEAS` (ya usado
correctamente en 2 rutas hermanas); `analytics/operational-risk/team/route.ts`
notificaba con la tabla estática `NOTIFICATION_TARGETS` en vez de
`getNotificationRules()`, pese a que su propio comentario decía "mismo
criterio que las notificaciones de comentarios de tarea" (que sí usa
`getNotificationRules()`) — un Administrador que reconfigurara los
destinos de comentario desde Ajustes no veía ese cambio reflejado en las
alertas de riesgo operativo; `settings/activity-reasons` (POST/PATCH) no
invalidaba la caché de Analytics al cambiar `assignedRoles`, a diferencia
de sus pares (`special-status`, `role-targets`, `workload-config`).

UX: `ProjectCard.tsx` nunca migró al sistema de Chips de Sprint B (clases
Tailwind literales en vez de `StatusChip`/`PriorityChip`) mientras
`TaskCard.tsx` sí lo usa; `CommentPanel.tsx` (Tareas) todavía tenía el
fallo silencioso al comentar que Sprint C §7 ya había corregido en
`ProjectCommentsTab.tsx` (nunca se aplicó de vuelta) — se hizo el mismo
backport de `useToast()` + "Reintentar"; `meetings/[id]/route.ts`
(GET/PATCH/DELETE) no tenía ningún manejo de errores, a diferencia de
`POST /api/meetings` en el mismo módulo — se agregó `try/catch` con
fallback genérico (solo endurece el camino de error, no agrega
notificaciones nuevas ni cambia ningún comportamiento de éxito).

### Performance (Bloque 2) — implementado (subconjunto seguro)

`dashboard/route.ts` agrupó en un solo `Promise.all` las ~9 consultas que
no dependían entre sí (antes secuenciales, una espera tras otra en cada
carga del Dashboard). Gráficos de KPIs (`KpiCharts.tsx`,
`ScoreHistoryChart.tsx`, `ExecutiveDashboard.tsx`) memoizan con `useMemo`
sus transformaciones de datos, que antes se recalculaban en cada render.
`UsersManager.tsx` ganó un buscador client-side (sin techo antes, la lista
completa se renderizaba siempre).

**Diferido (documentado, no implementado):** `kpis/executive` y
`operational-risk/team` recorren el equipo usuario-por-usuario para Riesgo
Operativo/Performance Score en vez de una versión "batched" como la que ya
existe para Capacidad Proyectada (`computeTeamCapacityForecast`). No es una
emergencia de performance hoy (el `cached()` existente mitiga vistas
repetidas), y tocar el interior de `computeOperationalRisk`/
`computePerformanceScore` para batchearlas implica un riesgo real de
introducir un bug en funciones de cálculo frágiles — se prefirió no
arriesgarlo dentro del alcance "solo lo seguro" de este sprint. Ver
`docs/ROADMAP.md`.

### Calidad del dato (Bloque 9) — implementado

No existía ninguna verificación automática. Se agregó `GET /api/settings/data-quality`
(solo Administrador, bajo demanda vía botón, sin cron — mismo patrón que
`EngineDiagnosticsSection`) y una sección nueva dentro del Ajustes
existente (no un módulo nuevo): fechas inválidas (`endDate < startDate` en
Tarea/Proyecto/Fase), progreso u horas fuera de rango, registros sin
propietario (defensivo — ambos campos son `NOT NULL` en el schema, se
espera 0), horas con horario solapado del mismo autor el mismo día
**cruzando Tarea↔Proyecto** (evidencia práctica, sin corregirlo, del hueco
ya conocido de `findOverlappingActivity`, que solo cubre Tarea↔Tarea), y
registros huérfanos (reportado como confirmación estructural vía llaves
foráneas, no como resultado de una búsqueda — el schema no permite crear
un huérfano vía el ORM).

### Bloque 5 (UX) y Bloques 6/7 (revisión Proyectos/Escritorio Digital)

Bloque 5 no tuvo hallazgos concretos propios más allá de los ya cubiertos
en Consistencia (migración de Chips de `ProjectCard`, fix de
`CommentPanel`) — un barrido visual sin hallazgos concretos que lo
justificaran habría sido alcance abierto e innecesariamente riesgoso para
este sprint; se documenta la decisión de acotarlo en vez de ejecutarlo sin
guía. Los hallazgos propios de Proyectos (Bloque 6) y Escritorio Digital
(Bloque 7) — paridad `ProjectActivity`/`TaskActivity`, papelera de
Recordatorios (ver corrección arriba), UI de restauración de Notas,
`estimatedHours` inconsistente en el pipeline Nota→Recordatorio→Tarea —
son todos cambios de comportamiento de negocio → quedan en backlog
documentado, no se tocan este sprint.

### Informe final (Bloque 12)

**Incidencias corregidas:** 2 hallazgos de seguridad críticos (IDOR en 5
rutas, crash al eliminar usuarios), ~10 de deuda técnica/consistencia
segura, 4 de performance, 1 funcionalidad nueva (Calidad del Dato).

**Deuda técnica restante (backlog documentado, no implementado):**
`docs/DECISIONS.md` y `docs/ROADMAP.md` listan cada ítem con su
justificación. En resumen: paridad de edición/eliminación de
`ProjectActivity` con `TaskActivity`; notificar a invitados de una reunión
al reprogramarla/cancelarla; UI de restauración de Notas archivadas
(el adaptador ya existe en `recoveryCenter`); extender el detector de
solapamiento (`findOverlappingActivity`) a cruzar Tarea↔Proyecto (el nuevo
panel de Calidad del Dato ya evidencia el hueco); unificar la validación de
`estimatedHours` entre `POST /api/tasks` y el pipeline de conversión
Recordatorio→Tarea; batchear `computeTeamOperationalRisk`/
`computeTeamPerformanceScore`.

**Oportunidades de mejora identificadas pero fuera de alcance:**
`docs/ROADMAP.md` no se actualizó desde 2026-07-23 (faltan las entradas de
v1.9.0 en adelante) — reconciliarlo por completo es una tarea propia, no se
hizo como efecto secundario de este sprint para no inflarlo; se agrega como
ítem del propio backlog.

**Recomendaciones para el siguiente sprint:** priorizar los ítems de
backlog que requieren una decisión de producto (papelera de
`ProjectActivity`/Notas, notificación de Reuniones) antes de Trabajo de
integraciones/escalabilidad, ya que varios de ellos tocan superficies que
un sprint de integraciones probablemente vuelva a rozar (Reuniones,
notificaciones).

**Verificación:** `tsc --noEmit` (2 errores preexistentes en tests, sin
relación), `eslint` (0 errores, 3 warnings preexistentes), `vitest run`
(913/913, +7 nuevas), `next build` exitoso.

**Aprobado por:** Anthony Jácome (definió el alcance "solo lo seguro" tras
revisar el listado de hallazgos de negocio diferidos).

---

## 2026-07-24 — Cierre de la ventana de condición de carrera en `migrateFijaHistoryIfNeeded`

**Problema detectado:** la auditoría crítica solicitada sobre registros
retroactivos y duplicación de horas (entrada de este mismo día, "Escritorio
Digital..." — ver más abajo la de duplicación) revisó en detalle
`migrateFijaHistoryIfNeeded` (`src/app/api/tasks/[id]/activities/route.ts`),
la migración perezosa que crea una `TaskActivity` sintética la primera vez
que se listan las actividades de una tarea Fija con `realHours > 0` y cero
actividades. La implementación original hacía `count()` y, si el resultado
era `0`, un `create()` — dos llamadas separadas, sin ninguna garantía
transaccional entre ellas. Eso deja una **ventana teórica de condición de
carrera**: dos peticiones `GET /api/tasks/[id]/activities` concurrentes para
la misma tarea podían leer `existingCount = 0` antes de que cualquiera de
las dos terminara de escribir, y ambas crear su propia actividad migrada —
duplicando esas horas históricas.

**Nunca se observó en producción:** la auditoría de duplicación (ver entrada
de este mismo día) inspeccionó los datos reales y no encontró ningún caso
de dos actividades con `reason = "migracion_automatica_registro_historico"`
para la misma tarea. El riesgo es real pero de baja probabilidad — requiere
dos peticiones casi simultáneas a la misma tarea Fija recién migrada, un
escenario poco común dado que cada tarea solo pasa por esta migración una
vez en su historia. Aun así, se propuso cerrar el hueco por completo en vez
de dejarlo documentado como riesgo residual aceptado.

**Alternativas consideradas:**
1. Dejarlo como está y documentarlo como riesgo residual aceptado (dado que
   nunca se observó en producción) — descartada: existe una solución
   correcta y de bajo riesgo, no hay razón para no cerrarla.
2. Agregar una restricción `UNIQUE` a nivel de base de datos (ej.
   `@@unique([taskId, reason])` en `TaskActivity`) — descartada: cambia el
   schema de Prisma (requiere migración), y una tarea Fija con múltiples
   registros legítimos del mismo motivo en el futuro (fuera del caso de
   migración) rompería la restricción; el motivo de migración ya está
   protegido por convención (nunca asignado a ningún rol), no es necesario
   forzarlo a nivel de columna.
3. **Elegida — envolver `count()` + `upsert()` + `create()` en una única
   transacción de Prisma con nivel de aislamiento `Serializable`**
   (`prisma.$transaction(async (tx) => {...}, { isolationLevel:
   Prisma.TransactionIsolationLevel.Serializable })`). Bajo `Serializable`,
   Postgres garantiza que si dos transacciones concurrentes leen el mismo
   estado y ambas intentan escribir de forma que el resultado no sería
   equivalente a ejecutarlas una tras otra, una de las dos falla por
   conflicto de serialización — nunca ambas tienen éxito. La transacción
   perdedora se captura en un `try/catch` alrededor de todo el
   `$transaction(...)` y se ignora (solo se deja un `console.error` para
   diagnóstico): la otra transacción ya completó la migración, así que no
   hay ninguna acción de recuperación que tomar, y la función seguirá
   siendo un no-op en la próxima apertura del panel (ya habrá una actividad
   registrada). No se propaga el error al handler `GET` — este es un efecto
   secundario de idempotencia, no debe poder romper la carga normal de
   actividades.

**Por qué `Serializable` y no `ReadCommitted`/`RepeatableRead`:** el
patrón "leer conteo, decidir, escribir" es exactamente el caso clásico que
`Serializable` protege y que niveles más bajos no garantizan (bajo
`RepeatableRead`, dos transacciones podrían leer `count = 0` cada una sin
ver la escritura de la otra, si no hay una dependencia de escritura directa
entre ambas filas). Es la primera vez que este codebase usa una transacción
interactiva con nivel de aislamiento explícito — no existe otro precedente
similar (revisado por búsqueda exhaustiva de `$transaction` con
`isolationLevel` antes de implementar).

**Alcance del cambio:** exclusivamente `migrateFijaHistoryIfNeeded` en
`src/app/api/tasks/[id]/activities/route.ts`. No cambia su comportamiento
observable en el caso normal (sin condición de carrera): mismo resultado,
misma actividad creada, mismos campos. No toca ninguna otra ruta, la
lógica de `POST /api/tasks/[id]/activities` (que también usa
`taskActivity.count` para el límite de 2 registros de tareas Fijas) queda
sin modificar — ese conteo no tiene el mismo patrón de "migración
automática de una sola vez", es una validación normal en cada creación, sin
el mismo riesgo de duplicación.

**Verificación:** `tsc --noEmit` limpio (solo los 2 errores preexistentes y
no relacionados ya conocidos), `eslint` limpio, suite completa de pruebas
(900/900) pasando incluyendo los 2 casos de `migrateFijaHistoryIfNeeded` en
`src/__tests__/api/tasks-activities-comments.test.ts` (mock de
`$transaction` actualizado para invocar el callback con el mismo cliente
mockeado), `next build` exitoso.

**Naturaleza del cambio:** corrección de robustez/concurrencia sobre una
migración de datos ya existente — no modifica ninguna fórmula, el Analytics
Engine, KPIs, permisos ni reglas de negocio. No es una migración de datos
nueva ni repite la migración histórica de `completedAt` (entrada siguiente).

**Aprobado por:** Anthony Jácome (solicitó explícitamente implementar la
corrección propuesta en la auditoría de duplicación de horas).

---

## 2026-07-24 — Migración histórica única (backfill): `completedAt` para 33 tareas sin fecha de finalización registrada

**Problema detectado:** la auditoría y corrección previas de `isCompletedOnTime`
(entrada anterior de este mismo día) identificaron, además del bug de
comparación de fechas, un problema de **datos históricos faltantes**: 33
tareas con `status = COMPLETADA` tenían `completedAt = NULL` — todas
anteriores a la migración `20260707004617_add_administrador_role_and_task_completed_at`,
que agregó la columna `Task.completedAt` **sin backfill**. No es un error
del usuario: en el momento en que esas tareas se completaron, el sistema
todavía no registraba automáticamente esa fecha. Mientras `completedAt` sea
`null`, `isCompletedOnTime` las excluye explícitamente de "completadas a
tiempo" (aunque genuinamente se hayan completado), penalizando el indicador
de Cumplimiento personal sin ninguna razón real de negocio.

**Alcance, verificado antes de escribir nada:** se volvió a consultar
`status = COMPLETADA AND completedAt IS NULL` en el momento de ejecutar la
migración (no se reutilizó ciegamente el número de la auditoría anterior) —
el resultado fue exactamente **33 tareas**, coincidiendo con la auditoría.
Solo esas 33 filas, identificadas por `id`, se tocaron.

**Decisión tomada:** para cada una de esas 33 tareas, `completedAt = endDate`
(dentro de una única transacción de Prisma — todo o nada). Ningún otro campo
de esas tareas se modificó, y ninguna otra tarea (con `completedAt` ya
poblado, pendiente, en progreso, o de cualquier otro estado) fue tocada.

**Justificación de `completedAt = endDate` (y no otro valor):** no existe
ningún registro del instante real en que esas tareas se completaron — fue
literalmente el motivo del problema. Asignar la fecha objetivo como
aproximación es la única opción que no inventa un dato inexistente y que,
de forma consistente con la intención original de quien las completó (se
crearon y cerraron antes de que el sistema pudiera medir la puntualidad),
las trata como cumplidas en la fecha prevista. Se descartó "dejarlas sin
clasificar" (crear una tercera categoría "sin dato" en Cumplimiento) por
ser un cambio de fórmula, explícitamente fuera de alcance de esta
migración — el pedido fue completar el dato faltante, no cambiar cómo se
interpreta su ausencia.

**Validación post-migración (script de una sola ejecución, ya eliminado del repositorio):**
- Total de tareas actualizadas: **33**.
- Tareas `COMPLETADA` con `completedAt = NULL` después de la migración: **0**.
- Las 33 quedaron con `completedAt` exactamente igual a su `endDate`: confirmado.
- Total de tareas `COMPLETADA` antes vs. después (debe ser igual — confirma que no se creó ni eliminó ninguna tarea): **121 → 121**.
- "Completadas a tiempo" (Definición B, `isCompletedOnTime`, ya con la
  comparación por día calendario corregida) antes: **57 de 121** (33 con
  `completedAt` nulo, excluidas). Después: **90 de 121**. Cambio neto: **+33**
  — exactamente las 33 tareas regularizadas, ninguna otra cambió de
  clasificación.

**Prevención futura (verificada, no solo asumida):** se confirmó que
`PATCH /api/tasks/[id]` ya fija `completedAt = new Date()` automáticamente
al mover una tarea a `COMPLETADA` (desde 2026-07-07), y que
`POST /api/tasks/import` nunca acepta un `status` inicial (siempre crea en
`PENDIENTE`) — ninguno de los dos podía reproducir este problema. Sí se
encontró un tercer camino con el mismo gap: `POST /api/tasks` (crear una
tarea nueva ya con estado inicial `COMPLETADA`, ej. para registrar trabajo
ya realizado) no fijaba `completedAt`. Corregido en el mismo cambio
(`src/app/api/tasks/route.ts`): ahora fija `completedAt = new Date()` cuando
`initialStatus === "COMPLETADA"`, igual que el resto de los caminos. A
partir de esta versión, los tres caminos que pueden dejar una tarea en
`COMPLETADA` (crear, editar, corregir) registran `completedAt`
automáticamente — no debería volver a aparecer una tarea completada sin
fecha de finalización.

**Naturaleza del cambio:** migración de datos histórica, de ejecución
única — **no** modifica la fórmula de Cumplimiento, el Analytics Engine, el
NormalizationEngine, Performance Score, Riesgo Operativo, pesos, curvas ni
benchmarks. El fix de prevención en `POST /api/tasks` es una corrección de
comportamiento normal (mismo tipo que el fix de `isCompletedOnTime`), no un
cambio de fórmula. Esta migración no se repetirá — no existe ningún
mecanismo ni intención de volver a ejecutarla; futuras tareas sin
`completedAt` (si llegaran a existir por una vía no contemplada aquí)
requerirían su propia investigación, no un re-uso automático de este script.

**Aprobado por:** Anthony Jácome (especificó el alcance exacto — 33 tareas,
`completedAt = endDate`, sin tocar ninguna otra — y autorizó la ejecución).

---

## 2026-07-24 — Corrección de `isCompletedOnTime`: comparación por día calendario en huso de negocio, no por instante UTC crudo

**Problema detectado:** auditoría solicitada explícitamente (sin tocar
fórmulas hasta confirmar el diagnóstico) sobre la clasificación "completada
a tiempo" (`isCompletedOnTime`, `src/lib/priorityCompliance.ts`), usada por
`/api/kpis/[userId]` y `/api/kpis/me` (vista personal de Cumplimiento —
Definición B, distinta de la Definición A del motor central, ya documentada
en §D1 del Registro de Auditoría). La función comparaba
`t.completedAt.getTime() <= t.endDate.getTime()` directamente. `endDate` se
guarda como medianoche UTC del día objetivo (fecha pura, sin hora);
`completedAt` es un instante real (`new Date()` al momento del PATCH que
cierra la tarea). Como medianoche UTC del día de vencimiento equivale a las
7pm del día ANTERIOR en huso de negocio (Ecuador/Colombia, UTC-5), cualquier
tarea cerrada durante el horario laboral real del propio día de vencimiento
quedaba mal clasificada como tardía.

**Verificación empírica sobre datos de producción antes de corregir**
(consulta de solo lectura, sin escrituras): de 121 tareas `COMPLETADA`, 88
tenían `completedAt` poblado; de esas, 65 estaban clasificadas como "fuera
de tiempo" bajo la lógica anterior. **33 de esas 65 (51%) se habían
completado el mismo día calendario** en huso de negocio — mal clasificadas
por el bug, no genuinamente tardías. El "cumplimiento a tiempo" real sobre
esas 88 tareas pasaba de 26% (23/88, cifra reportada antes de la corrección)
a 64% (56/88) con la clasificación correcta — una diferencia material, no
cosmética. (Hallazgo aparte, no corregido aquí: 33 tareas `COMPLETADA`
adicionales tienen `completedAt = NULL` — anteriores a la migración
`20260707004617_add_administrador_role_and_task_completed_at`, que agregó la
columna sin backfill; quedan fuera de este cambio porque no es un problema
de fórmula sino de datos históricos faltantes, y backfillear un timestamp de
completado que nunca se registró requeriría inventar un valor.)

**Alternativas evaluadas:**
1. Dejar la comparación por instante exacto, documentando la limitación —
   descartada: el propio código ya resuelve este mismo problema
   correctamente en otro lugar (`isTaskOverdue`, `src/lib/utils.ts`, usa
   `businessCalendarDay`/`utcCalendarDay`) para la clasificación "vencida" —
   mantener una comparación cruda en `isCompletedOnTime` sería una
   inconsistencia interna conocida y evitable, no una limitación real del
   dominio.
2. Normalizar `completedAt` a medianoche UTC del mismo modo que `endDate` —
   descartada: `completedAt` es y debe seguir siendo un instante real (se
   usa también, sin este problema, en otros lugares que sí necesitan la hora
   exacta); normalizarlo perdería esa información para todo el sistema, no
   solo para esta comparación.
3. **(Elegida)** Comparar por día calendario sin modificar el dato
   almacenado: `businessCalendarDay(completedAt) <= utcCalendarDay(endDate)`
   — mismo patrón que `isTaskOverdue`, reutilizando `businessCalendarDay`
   (`src/lib/businessTime.ts`, ya existente) y exportando `utcCalendarDay`
   (`src/lib/utils.ts`, antes privado) para que ambas funciones compartan una
   sola fuente de la lógica de "día calendario en huso de negocio".

**Decisión tomada:** opción 3. `isCompletedOnTime` corregida; `completadoATiempo`
agregado a `FORMULA_VERSIONS` (`src/lib/analytics.ts`) como `"1.0"` — primera
vez que esta fórmula se versiona, la v1.0 es ya la forma corregida.
`FORMULA_SET_VERSION` 4.2 → 4.3. 3 tests nuevos en
`src/__tests__/analytics-formulas.test.ts` cubren explícitamente el
escenario del bug (completado el mismo día calendario con timestamp
posterior a medianoche UTC) para evitar una regresión futura.

**Justificación:** el cálculo debe reflejar cómo un humano razona sobre
"a tiempo" (día calendario, huso de negocio), no un artefacto de cómo se
almacena `endDate` en UTC. Reutilizar el patrón ya validado de
`isTaskOverdue` (en vez de inventar uno nuevo) mantiene una sola forma de
razonar sobre "qué día es esto" en toda la base de código.

**Impacto:** cambia el resultado real de `isCompletedOnTime` /
`computePriorityCompliance` — el "Cumplimiento" (Definición B) mostrado en
`/api/kpis/[userId]` y `/api/kpis/me` sube para la mayoría de los
colaboradores, reflejando ahora correctamente las tareas cerradas el mismo
día de vencimiento. No afecta la Definición A (Health Score, Performance
Score, panel ejecutivo/equipo, informes) — esa función nunca usó
`completedAt`/`endDate`. No se tocó ningún otro cálculo, permiso, ni el
schema de base de datos.

**Aprobado por:** Anthony Jácome (confirmó explícitamente proceder con la
corrección tras revisar el informe de auditoría).

---

## 2026-07-23 — Escritorio Digital: pipeline Nota→Recordatorio→Tarea reemplaza el puente directo Nota→Tarea, verificado sobre datos reales de producción

**Problema detectado:** el refinamiento pidió lectura automática (sin
botón), confirmación de lectura, respuestas cortas acotadas, retención de
15 días para el archivo, y — el cambio más profundo — que "Convertir en
tarea" deje de ser una acción directa sobre la nota: ahora una nota se
convierte en Recordatorio (§5) y es el Recordatorio el que opcionalmente se
convierte en Tarea (§6). Esto reemplaza por completo el puente
`DeskNote.convertedToTaskId` construido apenas un sprint antes (ver entrada
"Escritorio Digital: evolución a centro personal de trabajo").

**Verificación de seguridad de datos antes de migrar:** dado que
Escritorio Digital ya tenía usuarios reales activos en producción (11
notas reales de personal real al momento de este sprint, con nombres/roles
reconocibles), se consultó `SELECT * FROM "DeskNote" WHERE
"convertedToTaskId" IS NOT NULL` antes de tocar el schema — **0 filas**. La
funcionalidad de conversión directa nunca llegó a usarse en producción, así
que eliminar la columna y su relación no perdió ningún dato real. De haber
existido filas, la migración habría requerido un paso de preservación
(similar a la migración de `FollowUpReminder`) antes del `DROP COLUMN`.

**Alternativas evaluadas (adjunto en la cadena de conversión):** el adjunto
de una nota debe sobrevivir hasta convertirse en tarea, pero la nota
original puede archivarse y purgarse automáticamente a los 15 días (§8) —
si el Recordatorio solo *referenciara* el adjunto de la nota (por id), el
archivo se perdería en cuanto la nota se purgara, incluso si el Recordatorio
seguía vivo.
1. Referencia suelta (`sourceNoteId`) desde `PersonalReminder` hacia
   `DeskNote.attachmentData` — más simple, pero el adjunto desaparece si la
   nota se purga antes de convertirse en tarea.
2. Copiar el adjunto (base64 completo) a `PersonalReminder` en el momento
   de la conversión Nota→Recordatorio.

**Decisión tomada:** opción 2. `PersonalReminder` gana sus propios
`attachmentName`/`attachmentMime`/`attachmentData` (mismo patrón que
`DeskNote`), poblados por copia en `POST
/api/desk-notes/[id]/convert-to-reminder`. Costo: duplica el blob base64 en
la base de datos si se convierte; beneficio: el adjunto sigue disponible
para la conversión a Tarea (§6) sin importar qué le pase a la nota
original después.

**Decisión — eliminación definitiva desde Archivadas es una vía nueva,
distinta de la papelera del remitente:** el Centro de Recuperación
(`recoveryCenter.moveToTrash`) ya cubre "el remitente elimina la nota que
envió" desde el sprint anterior. El refinamiento agrega una segunda vía —
"el destinatario elimina definitivamente desde Archivadas" (§7) — que es
un borrado directo, no una papelera con período de retención propio (la
nota archivada YA tiene su propio reloj de 15 días, agregar una segunda
capa de retención sobre la misma acción habría sido redundante). `DELETE
/api/desk-notes/[id]` ahora bifurca según quién llama: remitente →
`moveToTrash`; destinatario con la nota ya archivada → borrado directo
(409 si intenta eliminar una nota activa, no archivada). Ambas vías
auditan `DELETED` con `metadata.origin`/`metadata.actor` para distinguirlas.

**Bug real encontrado y corregido durante la verificación funcional:** al
probar el pipeline completo con cuentas descartables, `GET
/api/desk-reminders` no devolvía `convertedToTaskId` ni los campos de
adjunto — el `select` de Prisma de esa ruta (y de `PATCH
/api/desk-reminders/[id]`) no se había actualizado al agregar esos campos
al modelo. Se corrigió centralizando `reminderSelect`/`serializeReminder`
en `src/lib/personalReminders.ts` (mismo patrón que `deskNotes.ts` para
notas) para que ambas rutas usen la misma fuente de verdad y no puedan
volver a desincronizarse.

**Impacto:** `DeskNote.convertedToTaskId` ya no existe (renombrado
conceptualmente a `convertedToReminderId`, apunta a `PersonalReminder`).
`PersonalReminder` gana la mitad del puente hacia Trabajo que antes tenía
`DeskNote`. Verificado en vivo sobre la base de datos compartida con
producción: pipeline completo nota→recordatorio→tarea con ambos
intermedios preservados y marcados, doble conversión bloqueada (409) en
cada paso, y los 11 registros reales de `DeskNote` confirmados intactos
antes y después de la migración.

**Aprobado por:** Anthony Jácome (dirección de producto).

---

## 2026-07-23 — Recordatorios: "Completado" deja de ser terminal, reabrir nunca crea una fila nueva

**Problema detectado:** el ciclo de vida original de `PersonalReminder`
(Sprint de evolución de Escritorio Digital, mismo día) trataba `COMPLETADO`
como un estado final — no había forma de deshacer una compleción accidental
sin crear un recordatorio nuevo, perdiendo el `id` y el historial de
auditoría acumulado hasta ese punto. El pedido de refinamiento es explícito:
"un recordatorio nunca debe perder su historial" y "el sistema debe
priorizar la recuperación frente a la recreación de información".

**Alternativas evaluadas (reapertura):**
1. Al "reabrir", crear un nuevo `PersonalReminder` con los mismos datos y
   marcar el original como referencia histórica — preserva el registro
   viejo intacto, pero rompe la continuidad de identidad ("el mismo
   recordatorio") y complica cualquier vista que liste por `id`.
2. Actualizar la fila existente in-place (`status: PENDIENTE`,
   `completedAt: null`), conservando `id`/`createdAt`/todo el
   `DeskAuditLog` acumulado, y agregar el evento `REOPENED`.

**Decisión tomada:** opción 2 — literal con el pedido ("No se creará un
nuevo registro", "Se conservará el mismo identificador"). `reopen` además
limpia `archived`/`archivedAt` incondicionalmente: un recordatorio
archivado-y-completado que se reabre vuelve a estar activo en todos los
sentidos, no solo en `status` — dejarlo archivado-pero-pendiente habría sido
un estado confuso sin ningún caso de uso real que lo pidiera.

**Decisión — reapertura con nueva fecha genera DOS eventos de auditoría, no
uno:** el pedido ejemplifica el historial mostrando "Reabierto." y "Nueva
fecha programada: …" como dos líneas separadas con timestamps distintos
(11:42 y 11:43). Se replicó ese comportamiento literalmente: `reopen` con
`dueAt` registra `REOPENED` y luego `POSTPONED` (reutilizando la acción ya
existente para reprogramar, con `metadata.from`/`to`) en vez de inventar un
tercer valor de enum solo para este caso — semánticamente "reabrir con
nueva fecha" y "posponer" describen el mismo cambio de campo.

**Decisión — recordatorios recurrentes NO se tocan al reabrir el original:**
completar un recordatorio con `repeat != UNA_VEZ` ya crea automáticamente
la siguiente ocurrencia (fila independiente, con su propio `id`). Reabrir
el original después no elimina ni fusiona esa ocurrencia ya generada — el
usuario puede terminar con dos filas activas (el original reabierto + la
ocurrencia automática). El pedido no contempla este cruce y no se inventó
una regla de fusión no solicitada; queda documentado aquí como
comportamiento aceptado, no como bug pendiente.

**Impacto:** `PersonalReminder` gana `archived`/`archivedAt`;
`DeskAuditAction` gana `REOPENED`. Sin cambios en notificaciones (la
bandera `notified` se reinicia igual que en cualquier cambio de `dueAt`),
recordatorios recurrentes (comportamiento ya descrito arriba), conversión
de notas, Analytics ni KPIs. Verificado en vivo: un mismo recordatorio
pasó por 9 transiciones de estado consecutivas (creado → completado →
reabierto → completado → reabierto con nueva fecha → completado →
archivado → reabierto) conservando siempre el mismo `id`, con las 9 filas
correspondientes en `DeskAuditLog` en orden cronológico y sin ninguna
pérdida.

**Aprobado por:** Anthony Jácome (dirección de producto).

---

## 2026-07-23 — Escritorio Digital: evolución a "centro personal de trabajo" — migración de recordatorios, notificación perezosa y límites del alcance

**Problema detectado:** el sprint de evolución pidió absorber por completo
el sistema de recordatorios ligados a tareas (`FollowUpReminder`,
popup `ReminderNotifier`) dentro de Escritorio Digital como recordatorios
personales independientes (`PersonalReminder`), además de agregar color de
Post-it, adjuntos, confirmación de lectura, conversión a tarea, calendario,
búsqueda y una "Bandeja Hoy". Varias de estas piezas requerían decisiones
no especificadas en el pedido.

**Decisión 1 — Migración de datos, no coexistencia temporal:** en vez de
dejar ambos sistemas vivos un tiempo (flag de feature, tabla duplicada), se
migraron los 18 `FollowUpReminder` activos en producción a
`PersonalReminder` en un solo paso (script de un uso, ver commit) y luego
se eliminó la tabla `FollowUpReminder` del schema. Motivo: el pedido dice
"Eliminar completamente" — mantener el sistema viejo en paralelo
contradice eso y duplica superficie de mantenimiento sin necesidad real.
- **Título/descripción:** `FollowUpReminder` no tenía prioridad propia (el
  modelo nuevo sí, `ReminderPriority`) — se asignó `MEDIA` por defecto a
  todos los migrados, documentado aquí porque es un dato que **no existía**
  en el origen, no una migración 1:1.
- **Contexto de la tarea:** cada recordatorio migrado perdía su tabla padre
  (`Task`) al independizarse — se preservó el título de la tarea origen
  dentro de la descripción ("Migrado desde la tarea…") en vez de
  descartarlo, para no perder contexto histórico.
- **`notified: true` en todos los migrados:** para que el corte no generara
  una tormenta de notificaciones por recordatorios ya vencidos que el
  sistema anterior (popup) ya le había mostrado al usuario en su momento.
- El script de migración (`scripts/migrate-followup-reminders-to-desk.ts`)
  se ejecutó una sola vez, se verificó (18 filas migradas, conteo
  confirmado tras el `DROP TABLE`) y se eliminó del repositorio — dejarlo
  no aportaba valor una vez que el modelo `FollowUpReminder` que referencia
  ya no existe en el schema (rompería `tsc` para siempre). El historial de
  qué se migró y desde qué fila original queda en `DeskAuditLog`
  (`metadata.migratedFrom = "FollowUpReminder"`, `originalId`), no en el
  script.

**Decisión 2 — Notificación perezosa reemplaza el popup invasivo:** el
`ReminderNotifier` anterior era una ventana flotante persistente que
sondeaba cada 10 minutos y se autoexhibía sobre cualquier pantalla. El
pedido no prohíbe explícitamente los popups para recordatorios (solo para
notas nuevas, §2), pero mantenerlo contradice el espíritu de consolidar
todo en un "centro personal" calmado y pide explícitamente "reutilizar el
sistema existente de notificaciones" (§15). Se reemplazó por un barrido
perezoso (`notifyDueReminders()`, disparado al consultar recordatorios o
la Bandeja Hoy) que crea una fila `Notification` normal (la misma campana
del Topbar) la primera vez que un recordatorio vence, usando la bandera
`notified` para no repetirla. Sin cron dedicado, mismo criterio que
`purgeExpiredItems()` del Centro de Recuperación.

**Decisión 3 — Adjunto de la nota NO se copia al convertir a tarea:** el
pedido dice "Copiar automáticamente: título, descripción, prioridad,
adjuntos" pero también, en la misma sección de restricciones, "No modificar
el módulo Trabajo salvo la eliminación del sistema anterior de
recordatorios" (§15) — y `Task` no tiene ningún campo de adjunto.
Agregarlo habría violado la restricción explícita. Se optó por referenciar
el nombre del archivo dentro de la descripción de la tarea nueva
("Adjunto en la nota original: …") en vez de duplicar el archivo — la nota
original (con el adjunto real) permanece intacta y accesible, tal como
pide el mismo párrafo ("La nota original permanecerá disponible").

**Decisión 4 — `PersonalReminder` NO se integra al Centro de Recuperación:**
a diferencia de `DeskNote` (ver entrada de abajo), eliminar un recordatorio
personal es un borrado físico directo, con una fila `DeskAuditLog` (acción
`DELETED`) como único rastro. Los recordatorios son ítems de productividad
personal de alta rotación (se crean/completan/eliminan constantemente,
como un todo-list) — someterlos a retención/restauración habría sido
sobre-ingeniería no pedida y ajena al patrón habitual de este tipo de
funcionalidad en cualquier producto comparable. Las notas sí se integraron
porque representan comunicación entre dos personas, con mayor costo si se
pierden por error.

**Decisión 5 — "Proyectos con actividad reciente" usa una ventana fija, no
la última visita real:** la Bandeja Hoy (mejora adoptada, no pedida
explícitamente) pide proyectos con actividad "desde la última vez que
ingresó" el usuario. `User` no tiene un timestamp de última visita al
Escritorio y agregarlo quedaba fuera del alcance ya extenso de este sprint
(además de ser un campo que crecería para cualquier futura pantalla
similar, no solo esta). Se usó una ventana fija de 7 días
(`RECENT_PROJECT_DAYS`) como aproximación razonable, documentada en el
código (`src/app/api/desk/today/route.ts`) y aquí — no se presenta como
"desde tu última visita" en la interfaz para no prometer algo que no mide.

**Impacto:** `FollowUpReminder` ya no existe (tabla eliminada); toda
funcionalidad de seguimiento planificado vive ahora en `PersonalReminder`.
Verificado en vivo: los 18 registros migrados sobrevivieron intactos al
`DROP TABLE` (conteo confirmado antes y después), el widget del Dashboard
y el panel de actividades de Trabajo ya no referencian el sistema viejo.

**Aprobado por:** Anthony Jácome (dirección de producto).

---

## 2026-07-23 — Escritorio Digital: segundo módulo integrado al Centro de Recuperación, sin construir su propia papelera

**Problema detectado:** el Sprint 1 pidió un módulo nuevo ("Escritorio
Digital") con una acción de eliminar notas ("Eliminar únicamente si el
remitente es quien creó la nota"), sin pedir explícitamente una papelera o
un flujo de restauración para ese módulo. El propio código, sin embargo, ya
anticipaba este módulo por nombre en el registro del Centro de Recuperación
(`ENTITY_REGISTRY`, comentario de `src/lib/recoveryCenter.ts`) como uno de
los módulos "compatibles, no implementados todavía", y la regla explícita
de esa arquitectura es que "ningún módulo nuevo debe implementar su propia
papelera — debe llamar a las funciones de este archivo".

**Alternativas evaluadas:**
1. Borrado físico directo (`prisma.deskNote.delete`) en `DELETE
   /api/desk-notes/[id]`, ignorando el Centro de Recuperación — más simple,
   pero repite exactamente el patrón que la arquitectura de Proyectos
   (v1.6.0) se creó para evitar, y deja Escritorio Digital fuera de la
   auditoría central (`RecoveryAuditLog`) sin ninguna razón funcional.
2. Registrar el adaptador `DESK_NOTE` en `ENTITY_REGISTRY` (con
   `DeskNote.deletedAt` como bandera espejo, mismo criterio que
   `Project.deletedAt`) y hacer que `DELETE` llame a
   `recoveryCenter.moveToTrash()`, **sin** construir todavía una pantalla de
   papelera/restauración/eliminación definitiva dedicada para este módulo
   (el pedido no la pidió y el propio Roadmap ya trata esa pantalla como
   pendiente transversal, no por módulo).

**Decisión tomada:** opción 2. La nota eliminada por su remitente pasa a
`RecoveryItem` (estado `ACTIVE`, con retención) en vez de desaparecer sin
rastro, y queda auditada en `RecoveryAuditLog` igual que cualquier otra
operación del Centro de Recuperación — pero no se construyó UI de
restauración/purga específica para notas en este sprint (ninguna otra
ruta llama a `recoveryCenter.restore()`/`deletePermanently()` con
`entityType: "DESK_NOTE"` todavía). Es una integración parcial intencional,
no una limitación descubierta después.

**Justificación técnica:** cumple la regla arquitectónica explícita del
Centro de Recuperación (costo marginal real: un adaptador de ~10 líneas y
un campo `deletedAt`) sin inflar el alcance del sprint con una pantalla que
nadie pidió. Construir la papelera/restauración de Escritorio Digital queda
como trabajo futuro acotado (ver `docs/ROADMAP.md`), igual que para
Trabajo, Documentos, Repositorios y Plantillas.

**Impacto:** `DELETE /api/desk-notes/[id]` ya no es un borrado físico —
mueve la nota a la papelera (soft-delete vía `deletedAt` + `RecoveryItem`).
Ningún otro comportamiento del módulo (crear, leer, fijar, archivar) pasa
por el Centro de Recuperación. Verificado en vivo: eliminar una nota la
retira de todas las vistas (`desk`/`archive`/`sent`) sin lanzar error, y un
segundo intento de eliminar la misma nota devuelve 404 ("Nota no
encontrada"), como corresponde a una fila ya marcada `deletedAt`.

**Aprobado por:** Anthony Jácome (dirección de producto).

---

## 2026-07-23 — Sprint 2.1: "participante" derivado por actividad, y eliminación acotada al creador

**Problema detectado:** el Sprint 2.1 pidió separar conceptualmente
"responsable" de "participante" (antes el responsable se agregaba
automáticamente como participante al crear el proyecto) y restringir la
eliminación/restauración de un proyecto únicamente a su creador (antes
cualquier responsable o liderazgo de nivel ≥ 3 también podía, vía
`isProjectManager`).

**Alternativas evaluadas (participantes):**
1. Requerir que el creador asigne explícitamente cada participante, sin
   ninguna vía automática — un responsable/colaborador que registra tiempo
   sin haber sido agregado antes quedaría "huérfano" (su actividad existe,
   pero no aparece en la pestaña Participantes).
2. Auto-alta como participante en el momento de registrar la primera
   actividad, además de la asignación explícita — tal como lo describe el
   pedido ("participante... por asignación explícita o por registrar
   actividades").

**Decisión tomada (participantes):** opción 2. `POST
/api/projects/[id]/activities` verifica si el autor ya es participante y,
si no, crea la fila `ProjectParticipant` en el mismo request y dejando un
evento `PARTICIPANTE_AGREGADO` en el historial (marcado `auto: true` en
`newValue`) — no es un caso especial silencioso, queda auditado igual que
un alta manual.

**Alternativas evaluadas (eliminación):**
1. Mantener `isProjectManager` (responsable/creador/liderazgo) para
   papelera/restaurar/eliminar, tal como ya regía cambio de estado y
   gestión de fases/participantes.
2. Nueva función `isProjectCreator`, exclusiva para las 3 operaciones de
   eliminación, dejando `isProjectManager` sin cambios para el resto.

**Decisión tomada (eliminación):** opción 2 — el pedido fue literal
("Solo el creador del proyecto puede"), sin excepción para liderazgo. La
Papelera (`GET /api/projects/trash`) conserva visibilidad total para
liderazgo (supervisión), pero el listado ahora devuelve `canDelete`
(`createdBy.id === session.userId`) para que la interfaz oculte las
acciones a quien no sea el creador, en vez de dejar botones que fallarían
con 403.

**Justificación técnica:** ambas decisiones se tomaron siguiendo el texto
del pedido de forma literal en vez de inventar una excepción (ej. permitir
que Administrador siempre pueda eliminar) — de necesitarse una vía de
emergencia para liderazgo/Administrador, es una decisión de producto
explícita pendiente, no asumida por esta implementación.

**Impacto:** cambio de comportamiento intencional, sin afectar
`isProjectManager` para status/fases/participantes (sigue vigente para
esas 3 operaciones). Verificado en vivo: un responsable con permisos
previos de eliminación ahora recibe 403 en las 3 rutas; el creador
conserva acceso completo.

**Aprobado por:** Anthony Jácome (dirección de producto).

---

## 2026-07-23 — Centro de Recuperación: servicio central con registro de adaptadores, en vez de una papelera por módulo

**Problema detectado:** se pidió una "Papelera" para Proyectos, pero con el
requisito explícito de que la implementación sea una arquitectura
corporativa reutilizable ("Centro de Recuperación") capaz de absorber
futuros módulos (Trabajo, Escritorio Digital, Documentos, Repositorios,
Plantillas, Comunicados) **sin modificar el servicio central** al agregar
cada uno.

**Alternativas evaluadas:**
1. Papelera independiente por módulo (un `deletedAt` + su propia lógica de
   restaurar/purgar en cada dominio), repetida cada vez que un módulo la
   necesite.
2. Un enum de Prisma `RecoveryEntityType` con un valor por módulo
   (`PROJECT`, `TASK`, ...), requiriendo una migración de schema
   (`ALTER TYPE ... ADD VALUE`) cada vez que se agrega un módulo nuevo.
3. Servicio central (`src/lib/recoveryCenter.ts`) con un registro de
   adaptadores en código (`ENTITY_REGISTRY: Record<string, EntityAdapter>`)
   — `entityType` como `String` libre en `RecoveryItem`/`RecoveryAuditLog`,
   no un enum.

**Decisión tomada:** opción 3. Cada adaptador expone 3 funciones puente
(`getDisplayName`, `setTrashed`, `hardDelete`) hacia la tabla propia del
módulo; las funciones exportadas del servicio (`moveToTrash`, `restore`,
`deletePermanently`, `purgeExpiredItems`, `getRemainingRetentionTime`,
`registerAuditEvent`) nunca cambian de firma ni de lógica al integrar un
módulo nuevo — solo se agrega una entrada de datos al registro.

**Justificación técnica:** la opción 1 es exactamente lo que el pedido
prohíbe explícitamente ("ningún módulo nuevo deberá implementar su propia
papelera"). La opción 2 sí sería centralizada, pero cada módulo nuevo
seguiría exigiendo una migración de base de datos solo para registrar su
existencia — contradice "agregar un módulo... deberá requerir únicamente
registrar un nuevo tipo de entidad. No deberá ser necesario modificar el
servicio principal", que se interpretó en sentido amplio (ni el servicio
NI el schema deberían tocarse). La opción 3 logra verdadero costo-cero de
integración: Proyectos es el primer y único módulo dado de alta este
sprint, dejando el resto como "compatibles, no implementados todavía"
(pedido explícito: preparar la arquitectura, no migrar todos los módulos
ahora). El costo es que cada módulo SÍ necesita su propia bandera de
conveniencia (`Project.deletedAt`) para filtrar sus propias listas sin un
join contra `RecoveryItem` — una integración local del módulo, no del
servicio central, y coherente con el patrón ya usado por
`Task.archivedMonth`/`archivedAt` para su propio archivado por mes.

**Impacto:** `RecoveryItem`/`RecoveryAuditLog` son tablas nuevas,
transversales, sin FK hacia las tablas de cada módulo (referencia suelta
por `entityId`, mismo criterio que `ActivityAuditLog`/`TargetTimeAuditLog`)
— sobreviven aunque la entidad original se purgue definitivamente. Cero
cambios en Task, Analytics o cualquier módulo fuera de Proyectos.

**Aprobado por:** Anthony Jácome (dirección de producto).

---

## 2026-07-23 — Módulo Proyectos: dominio independiente en vez de extender Task

**Problema detectado:** se pidió un sistema para gestionar iniciativas
transversales de mediana/larga duración (múltiples colaboradores, fases,
ciclo de vida propio, sin cierre por mes) que conviva con las tareas
actuales sin reemplazarlas.

**Alternativas evaluadas:**
1. Extender `Task`/`TaskActivity` con un campo de "tipo" adicional
   (`PROYECTO`) y una tabla de fases opcional colgando de `Task`.
2. Modelo de "proyecto padre" con tareas existentes como hijas (un
   `Task.projectId` opcional).
3. Dominio completamente nuevo e independiente (`Project` y modelos
   satélite), sin ninguna relación con `Task`.

**Decisión tomada:** opción 3 — `Project`, `ProjectParticipant`,
`ProjectPhase`, `ProjectActivity`, `ProjectComment`, `ProjectDocument` y
`ProjectHistory` como modelos Prisma nuevos, sin FK hacia `Task`/
`TaskActivity` ni viceversa.

**Justificación técnica:** el pedido explícito era que "un proyecto NO
finaliza al terminar el mes" y que "no existe un único registro colectivo"
— ambas reglas contradicen invariantes ya asumidos en el módulo Trabajo
(`archivedMonth`, `TaskActivity` ligada a un único `assignedToId`). Forzar
esas reglas dentro de `Task` habría requerido ramas condicionales en cada
consulta/reporte existente (`archivedMonth`, cierre de mes, Analytics) para
distinguir "tarea real" de "tarea-proyecto", con alto riesgo de romper
código que ya asume la semántica actual de `Task`. Un dominio independiente
cumple "no modificar el módulo Trabajo" y "no romper APIs existentes" de
forma literal, al costo de cierta duplicación estructural (un
`ProjectActivity` que se parece a `TaskActivity`) — duplicación considerada
aceptable frente al riesgo de acoplar dos ciclos de vida incompatibles.
Los campos `Project.realHours`/`targetTimeHours` sí reutilizan la misma
convención de nombres y unidades que `Task.realHours`/`estimatedHours`
para que una futura integración con Analytics (pedida explícitamente como
"solo preparar el modelo, no recalcular todavía") sea un mapeo directo en
vez de una reinterpretación.

**Impacto:** módulo nuevo, aislado; cero cambios en `Task`, `TaskActivity`,
`src/lib/analytics.ts` o cualquier ruta de `/api/tasks`. Migración Prisma
puramente aditiva (`prisma/migrations/20260723024646_add_projects_module`),
sin alterar ninguna tabla existente.

**Aprobado por:** Anthony Jácome (dirección de producto).

---

## 2026-07-21 — Registro de historial de tareas Fijas: migración perezosa en vez de script masivo

**Problema detectado:** al unificar el modelo de registro de actividades
entre tareas Fijas y Seguimiento, las tareas Fijas existentes tenían
`Task.realHours` con datos reales pero sin ningún `TaskActivity` que los
respaldara — un backfill ingenuo requeriría un script que escribiera contra
TODAS las tareas Fijas de la base de datos de una sola vez.

**Alternativas evaluadas:**
1. Script `tsx`/Prisma de una sola corrida contra la base de datos completa.
2. Migración perezosa e idempotente ejecutada bajo demanda, tarea por tarea.

**Decisión tomada:** migración perezosa (opción 2) — se ejecuta la primera
vez que alguien abre el panel de actividades de una tarea Fija con horas
reales y cero actividades.

**Justificación técnica:** la base de datos configurada en `.env` **es la
de producción** (no existe un entorno de desarrollo separado — ver la
entrada del 2026-07-10 más abajo). Un script masivo de una sola corrida
against esa base es una escritura global e irreversible sin necesidad real
de serlo: la migración perezosa logra el mismo resultado (ningún dato se
pierde) sin el riesgo de una corrida masiva mal calibrada, y se auto-verifica
en producción real a medida que los usuarios abren sus tareas.

**Impacto:** cero riesgo de corrupción masiva de datos; el historial se
completa gradualmente en vez de todo de una vez, pero de forma
indistinguible para el usuario final (la tarea muestra su historial
correctamente en el momento en que la consulta).

**Aprobado por:** Anthony Jácome (dirección de producto)
**Implementado por:** Claude Code

---

## 2026-07-21 — Modelo de Analytics diferenciado para roles de dirección (Sprint 0A)

**Problema detectado:** el motor de Analytics trataba a todo usuario como
ejecutor de tareas operativas, incluyendo a Jefe Nacional y Administrador —
mostrándoles 0 horas registradas, subutilización, carga laboral 0% y
recomendaciones de redistribuir tareas hacia ellos. Esto no representa su
responsabilidad real (dirigir, no ejecutar) y distorsionaba promedios y
recomendaciones del equipo.

**Alternativas evaluadas:**
1. Ocultar solo las tarjetas con valores en 0 (parche superficial).
2. Clasificar roles por "Operativo/Táctico/Estratégico" (taxonomía nueva).
3. Derivar la distinción únicamente de `ROLE_LEVEL`, ya existente
   (`isLeadershipRole`/`isExecutorRole`, umbral nivel ≥ 4).

**Decisión tomada:** opción 3 — sin taxonomía nueva, sin cambios de
permisos ni de visibilidad (`VISIBLE_ROLES` intacto), solo una función
derivada que decide qué módulos de Analytics son representativos para un
rol y quién puede ser destino de redistribución de trabajo.

**Justificación técnica:** una taxonomía nueva (opción 2) habría requerido
tocar Prisma y duplicar una clasificación que `ROLE_LEVEL` ya expresaba
implícitamente; ocultar solo ceros (opción 1) no resolvía el problema de
fondo (las recomendaciones seguían siendo conceptualmente incorrectas).

**Impacto:** Administrador y Jefe Nacional ven un Dashboard Ejecutivo del
equipo en vez de KPIs personales sin sentido; Coordinador Nacional (nivel 3)
conserva Analytics personal + de equipo sin cambios. Esta decisión se aplicó
en 3 rondas de la misma sesión de trabajo (Analytics, Dashboard Home +
mensaje de Nova, y finalmente la pestaña "Mi actividad" misma) porque cada
ronda reveló una superficie adicional donde el problema original persistía.

**Aprobado por:** Anthony Jácome
**Implementado por:** Claude Code

---

## 2026-07-21 — Evolución de "Horas Estimadas" a "Tiempo Objetivo"

**Problema detectado:** "Horas estimadas" se interpretaba como una
predicción subjetiva del propio colaborador, sin ningún mecanismo para que
un líder la convirtiera en un estándar oficial de referencia — mezclando
estimación personal con objetivo de gestión.

**Alternativas evaluadas:**
1. Renombrar el campo `estimatedHours` en Prisma a `targetTime` (requiere
   migración).
2. Mantener `estimatedHours` como valor inicial y agregar un campo opcional
   `targetTimeValidated` que un líder autorizado puede fijar explícitamente,
   con `getOfficialTargetTime()` como accesor único (`validado ?? inicial`).

**Decisión tomada:** opción 2.

**Justificación técnica:** renombrar la columna (opción 1) habría requerido
una migración de Prisma y tocado toda la superficie de la API sin necesidad
— el mismo resultado conceptual se logra con un campo aditivo y un accessor
centralizado, sin romper compatibilidad con datos existentes.

**Impacto:** "Tiempo Objetivo" (`getOfficialTargetTime()`) se convirtió en
el término y el valor oficial en toda la plataforma (Trabajo, Analytics,
Dashboard, KPIs, Reportes, Modales, Tooltips, Exportaciones), reemplazando
"Horas estimadas" en el lenguaje de negocio sin tocar el nombre físico de
la columna en la base de datos. Solo el colaborador asignado no puede
validar el Tiempo Objetivo de su propia tarea (regla de negocio explícita).

**Aprobado por:** Anthony Jácome
**Implementado por:** Claude Code

---

## 2026-07-20 — Separación de Performance Score y Operational Risk Score

**Problema detectado:** un único "Score" mezclaba desempeño (qué tan bien
ejecuta el colaborador) y capacidad/riesgo (cuánta exposición operativa
representa su situación actual) en un solo número, dificultando la lectura
ejecutiva — un score bajo podía deberse a bajo desempeño o a sobrecarga,
sin forma de distinguir la causa desde el número solo.

**Alternativas evaluadas:**
1. Mantener un único Score combinado.
2. Separar en dos índices independientes: Performance Score y Operational
   Risk Score, cada uno con su propia fórmula y clasificación.

**Decisión tomada:** opción 2.

**Justificación técnica:** mayor claridad ejecutiva — un líder necesita
saber si debe intervenir por desempeño o por riesgo operativo, y son
acciones distintas. Fusionar ambas señales en un número oculta cuál de las
dos está fallando.

**Impacto:** el motor de Analytics gana dos indicadores independientes,
cada uno versionado por separado (`FORMULA_VERSIONS.performanceScore`,
`.riesgoOperativo`), auditados en `AnalyticsAuditLog`. El Índice de Riesgo
Operativo quedó además **congelado** por decisión de producto (Sprint 5
§S5-C prohíbe modificar sus reglas/pesos/alertas sin una decisión explícita
posterior) — ver `docs/ANALYTICS_FORMULAS.md`.

**Aprobado por:** Anthony Jácome
**Implementado por:** Claude Code

---

## 2026-07-20 — Cero IA para cálculos de negocio en el Decision Intelligence Engine

**Problema detectado:** Analytics necesitaba explicar "qué ocurrió / por
qué / qué puede ocurrir / qué acción tiene mayor impacto", no solo mostrar
números — pero delegar ese razonamiento a un LLM (Groq/Nova) arriesgaba que
un cálculo de negocio (KPI, alerta, priorización) dependiera de una llamada
de IA no determinista, con el riesgo adicional de que el panel dejara de
funcionar si `GROQ_API_KEY` no está configurada.

**Alternativas evaluadas:**
1. Delegar el análisis completo a Groq (insights, relaciones, priorización).
2. Motor 100% determinista en `insightsEngine.ts` que solo compone sobre lo
   que `analytics.ts` ya calculó, sin invocar IA en ningún punto.

**Decisión tomada:** opción 2.

**Justificación técnica:** un motor determinista es auditable, reproducible
y no depende de una clave de API externa para funcionar — crítico para un
sistema que se usa como respaldo en reuniones de dirección. Nova (Groq)
sigue existiendo para narración en lenguaje natural en OTRAS partes de la
app, pero nunca para calcular un KPI, una alerta o una priorización.

**Impacto:** el panel de Insights funciona incluso sin `GROQ_API_KEY`
configurada; toda relación/priorización mostrada es reproducible y
explicable con el modal "Ver cálculo".

**Aprobado por:** Anthony Jácome
**Implementado por:** Claude Code

---

## 2026-07-20 — Motor de Benchmarks Inteligente de 3 niveles

**Problema detectado:** el benchmark de pares (Sprint 5) mostraba "Sin
compañeros del mismo rol para comparar" cuando un cargo era único en la
organización — frecuente en esta empresa (Coordinador Nacional, Asistente
de Nómina, etc. suelen ser puestos de una sola persona) — sin ninguna
alternativa útil para esos casos.

**Alternativas evaluadas:**
1. Mantener el mensaje "sin compañeros" cuando no hay suficientes pares.
2. Motor de decisión de 3 niveles: comparación contra el cargo (≥3 pares),
   comparación limitada (2 pares, sin percentil), o comparación contra el
   propio historial personal (0-1 pares) — nunca cruzando cargos distintos
   ni con muestras estadísticamente inválidas.

**Decisión tomada:** opción 2.

**Justificación técnica:** Analytics siempre debe mostrar un benchmark útil
sin comparar nunca cargos distintos (aunque compartan nivel jerárquico) ni
con n=1/n=2 que no dan percentiles confiables — la opción 1 dejaba sin
ninguna señal útil justo a los roles más únicos de la organización.

**Impacto:** ningún usuario ve "sin datos para comparar"; el modo elegido
(y por qué) se explica siempre en el encabezado del componente.

**Aprobado por:** Anthony Jácome
**Implementado por:** Claude Code

---

## 2026-07-21 — Invalidación de caché de Analytics granular por usuario

**Problema detectado:** el caché en memoria del motor de Analytics se
invalidaba globalmente (`cache.clear()`) ante cualquier mutación (tarea,
actividad, permiso, estado especial) — correcto pero ineficiente: un cambio
para un usuario invalidaba el caché de todos.

**Alternativas evaluadas:**
1. Mantener invalidación global (simplicidad sobre eficiencia).
2. Invalidación granular por clave de usuario.

**Decisión tomada:** en el Analytics Engine v1 original (2026-07-20) se
eligió la opción 1 deliberadamente, documentada como "simplicidad/corrección
sobre granularidad" dado que hay vistas de equipo sin una sola clave de
usuario a la que apuntar. El 2026-07-21 se revisó esa decisión y se migró a
la opción 2 una vez que el patrón de acceso a caché maduró lo suficiente
para identificar claves por usuario de forma consistente.

**Justificación técnica:** con más de 19 handlers mutadores invalidando el
caché, la invalidación global generaba recálculos innecesarios a escala del
sistema completo cada vez que cualquier usuario cambiaba cualquier dato.

**Impacto:** menos recálculo innecesario del motor de Analytics sin
sacrificar corrección — cambio de rendimiento puro, sin alterar ninguna
fórmula.

**Aprobado por:** Anthony Jácome
**Implementado por:** Claude Code

---

## 2026-07-10 — Confirmación: no existe una base de datos de desarrollo separada

**Problema detectado (hallazgo, no una decisión de diseño en sí):** se
confirmó que el `DATABASE_URL` configurado en `.env` local es la misma base
de datos que usa el despliegue de producción en Vercel — no hay un entorno
de staging/desarrollo separado.

**Alternativas evaluadas:** ninguna a nivel de decisión de arquitectura —
este es un hallazgo operativo sobre el estado real de la infraestructura,
no una elección de diseño. Se documenta aquí porque cambia cómo debe
trabajarse: cualquier prueba de rol/permiso debe usar cuentas desechables
(`*@verify.local`), nunca cuentas de personal real, y cualquier operación
masiva/irreversible (cierres mensuales, purgas) requiere confirmación
explícita antes de ejecutarse, sin importar si se corre contra
`localhost:3000` o la URL de producción — son los mismos datos.

**Decisión tomada:** adoptar el patrón de cuentas desechables
`*@verify.local` para toda verificación de roles/permisos que requiera
datos reales, con limpieza inmediata después de cada sesión de pruebas.

**Impacto:** ninguna prueba de esta naturaleza vuelve a arriesgar datos de
personal real; el patrón se documentó y se reutilizó consistentemente en
sesiones posteriores.

**Aprobado por:** Anthony Jácome
**Implementado por:** Claude Code

---

_Este documento se actualiza cuando una implementación modifica reglas de
negocio o arquitectura — ver `CLAUDE.md` § Documentación para el
procedimiento. No registra decisiones de UI/UX menores ni refactors sin
impacto conceptual; para esas, ver `docs/DECISIONS.md`._
