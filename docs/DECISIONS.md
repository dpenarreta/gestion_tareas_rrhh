# Decisiones de Arquitectura de Nexo

> Bitácora liviana de decisiones de arquitectura y diseño técnico — un
> índice escaneable de "qué se decidió y por qué", en una línea o un párrafo
> corto por decisión. Para el análisis completo (problema/alternativas/
> justificación/impacto) de las decisiones más significativas, ver
> `docs/AUDIT_LOG.md`, enlazado desde cada fila cuando exista.

| Decisión | Motivo técnico | Detalle completo |
|---|---|---|
| Cambio de "Horas Estimadas" → "Tiempo Objetivo" | Separar la estimación subjetiva del colaborador de un estándar oficial que un líder puede validar, sin migrar la columna física de Prisma. | `AUDIT_LOG.md` § 2026-07-21 |
| Unificación de registro Fija/Seguimiento vía `TaskActivity` | Las tareas Fijas no tenían historial ni auditoría de horas; reutilizar el modelo de Seguimiento evita mantener dos sistemas de registro con reglas distintas. | `AUDIT_LOG.md` § 2026-07-21 |
| Migración de historial de Fijas: perezosa, no un script masivo | La base de datos compartida es producción — una migración bajo demanda evita una escritura global irreversible sin necesidad real de serlo. | `AUDIT_LOG.md` § 2026-07-21 |
| Separación de Performance Score y Operational Risk Score | Un único número mezclaba desempeño y riesgo/capacidad, ocultando cuál de los dos requiere intervención. | `AUDIT_LOG.md` § 2026-07-20 |
| Índice de Riesgo Operativo congelado (Sprint 5 §S5-C) | Estabilidad de un indicador usado en reportes de dirección — cambiar sus pesos/reglas sin una decisión explícita rompería comparabilidad histórica. | `docs/ANALYTICS_FORMULAS.md` |
| Cero IA para cálculos de negocio (Decision Intelligence Engine) | Auditabilidad y disponibilidad — un KPI/alerta no puede depender de una llamada no determinista a un LLM ni de que `GROQ_API_KEY` esté configurada. | `AUDIT_LOG.md` § 2026-07-20 |
| Motor de Benchmarks Inteligente — 3 niveles (cargo/limitado/personal) | Muchos cargos de esta organización son de una sola persona; comparar contra el propio historial evita el mensaje "sin datos" sin inventar comparaciones inválidas. | `AUDIT_LOG.md` § 2026-07-20 |
| Modelo de Analytics diferenciado para roles de dirección | Jefe Nacional/Administrador dirigen equipos, no ejecutan tareas — sus KPIs individuales de ejecución no son representativos y distorsionan promedios/recomendaciones del equipo. | `AUDIT_LOG.md` § 2026-07-21 |
| Invalidación de caché de Analytics: global → granular por usuario | La invalidación global era correcta pero recalculaba Analytics de todo el sistema ante el cambio de un solo usuario, una vez que el patrón de acceso maduró lo suficiente para segmentar por clave. | `AUDIT_LOG.md` § 2026-07-21 |
| NormalizationEngine (curvas configurables por indicador) | Distintos indicadores necesitan distintas curvas de sensibilidad (lineal, por tramos) sin hardcodear umbrales — se centralizó en `getEffectiveCurve()`/`DEFAULT_CURVES`, editable desde Ajustes. | `docs/ANALYTICS_FORMULAS.md` |
| `getOfficialTargetTime()` como único accesor de Tiempo Objetivo | Evitar que cada caller reimplemente el fallback `targetTimeValidated ?? estimatedHours` — encontrado repetido antes de consolidarse. | `AUDIT_LOG.md` § 2026-07-21 |
| Prisma 7 con `@prisma/adapter-pg` (driver adapter obligatorio) | `new PrismaClient()` sin adapter lanza error en runtime desde Prisma 7 — se estandarizó la inicialización en `src/lib/prisma.ts` como singleton. | `CLAUDE.md` |
| JWT firmado (`jose`) + cookie httpOnly en vez de sesiones server-side | Sin estado de sesión que persistir en base de datos; el payload (`userId`/`role`/`name`/`email`) es suficiente para las verificaciones de `proxy.ts` sin una consulta adicional en cada request. | `docs/ARCHITECTURE.md` |
| Sistema de diseño v1 (2026-07-03) → v2 (2026-07-05) | La primera versión (modo claro/oscuro) se reemplazó por un rediseño premium con sidebar, tokens de diseño e iconografía nueva, tras validar la dirección visual con el producto. | — |
| Framework de pruebas: Vitest + Testing Library (no Jest) | Integración nativa con Vite/Next 16 sin configuración adicional de transformadores; `vitest.config.ts` ya replica el setup recomendado por la documentación de Next 16 para este propósito. | `CLAUDE.md` |
| Changelog automático vía hook `post-commit` (no `prepare-commit-msg`) | Un `git add` hecho en `prepare-commit-msg` no queda incluido en el commit que se está creando (comprobado empíricamente); enmendar desde `post-commit` sí funciona. | `.githooks/update-changelog.js` |
| Sistema de documentación en `/docs` leído en vivo, sin base de datos nueva | Los Markdown ya viven en el repositorio versionado por Git — una tabla nueva solo para mostrarlos duplicaría una fuente de verdad que ya existe. | Este sprint (2026-07-22) |

---

## Cómo agregar una decisión nueva

Cuando una implementación futura tome una decisión de arquitectura o diseño
técnico no trivial (una alternativa fue descartada por una razón concreta),
agregar una fila a la tabla de arriba. Si la decisión es lo bastante
significativa como para merecer un análisis completo de alternativas
evaluadas, agregar también una entrada en `docs/AUDIT_LOG.md` y enlazarla
desde la columna "Detalle completo".

_Última actualización: 2026-07-22._
