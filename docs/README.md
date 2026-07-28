# Documentación de Nexo

Este directorio es la fuente oficial de verdad sobre la evolución técnica y
funcional de Nexo — trazabilidad completa desde su creación, pensada para
auditorías internas, mantenimiento y continuidad del desarrollo.

Toda la documentación aquí es Markdown puro, vive en el repositorio Git (sin
base de datos propia) y se actualiza como parte del flujo de trabajo normal
de implementación — ver `CLAUDE.md` § Documentación en la raíz del proyecto
para el procedimiento exacto.

## Índice

| Documento | Contenido |
|---|---|
| [`CHANGELOG.md`](./CHANGELOG.md) | Registro cronológico de todos los cambios, clasificados por tipo (FEATURE/FIX/REFACTOR/UX/UI/ANALYTICS/SECURITY/PERFORMANCE/DATABASE/DOCUMENTATION/BREAKING CHANGE), con versión, módulo, archivos afectados, impacto y autor. |
| [`AUDIT_LOG.md`](./AUDIT_LOG.md) | Decisiones **funcionales y arquitectónicas** — no registra código, registra el problema detectado, las alternativas evaluadas y la justificación técnica de cada decisión significativa. |
| [`DECISIONS.md`](./DECISIONS.md) | Índice liviano de decisiones de arquitectura y diseño técnico, con enlace a `AUDIT_LOG.md` cuando existe un análisis completo. |
| [`ROADMAP.md`](./ROADMAP.md) | Roadmap vivo: Implementado / En desarrollo / Planificado / Ideas futuras. |
| [`ARCHITECTURE.md`](./ARCHITECTURE.md) | Arquitectura actual del sistema: stack, estructura de carpetas, modelo de datos, autenticación, módulos funcionales, flujo de una request, convenciones técnicas. |
| [`ANALYTICS_FORMULAS.md`](./ANALYTICS_FORMULAS.md) | Documentación completa de cada fórmula del motor de Analytics: objetivo, fórmula, variables, pesos, normalización, ejemplo de cálculo, casos borde, reglas de negocio, versión. |
| [`VERSION.md`](./VERSION.md) | Versionado de NEXO, del Analytics Engine y del set de fórmulas, con el historial completo reconstruido desde Git. |
| [`DESIGN_SYSTEM.md`](./DESIGN_SYSTEM.md) | Referencia oficial de UI: tokens, botones, chips, tablas, modales, toasts, loading, empty states, iconografía — y el informe de Design Review de cada sprint de UX. |
| [`PRODUCT_REVIEW.md`](./PRODUCT_REVIEW.md) | Auditoría de producto: fortalezas, debilidades, oportunidades, deuda técnica y de UX, recomendaciones para futuras versiones. |
| [`ANALYTICS_CALCULATION_REGISTRY.md`](./ANALYTICS_CALCULATION_REGISTRY.md) | Auditoría técnica de duplicación de cálculos en el motor de Analytics (documento preexistente, complementario a `ANALYTICS_FORMULAS.md` — este es el ángulo "¿hay lógica repetida?", aquel es el ángulo "¿cómo se calcula cada cosa?"). |
| [`RAT.md`](./RAT.md) | Registro de Actividades de Tratamiento (LOPDP) — documento de cumplimiento normativo, no de arquitectura. |
| [`PENDIENTES_LEGALES.md`](./PENDIENTES_LEGALES.md) | Pendientes legales de cumplimiento LOPDP. |
| [`REPORTING_STANDARDS.md`](./REPORTING_STANDARDS.md) | Estándar oficial del Executive Reporting Engine: filosofía, público objetivo, principios de diseño/interpretación/auditoría, y la Definition of Product Excellence (10 principios de madurez). |
| [`REPORTING_NOVA_WRITING_GUIDE.md`](./REPORTING_NOVA_WRITING_GUIDE.md) | Guía de redacción de NOVA dentro del Executive Report: reglas obligatorias, lenguaje prohibido, estructura de las 4 secciones narrativas, niveles de confianza. |
| [`REPORTING_DESIGN_SYSTEM.md`](./REPORTING_DESIGN_SYSTEM.md) | Identidad visual del documento Executive Report (paleta, tipografía, componentes, impresión) — distinto de `DESIGN_SYSTEM.md`, que cubre la UI general de NEXO. |
| [`REPORTING_REFERENCE_LIBRARY.md`](./REPORTING_REFERENCE_LIBRARY.md) | Biblioteca de ejemplos ilustrativos de cada página del Executive Report, incluyendo reportes Consolidado/Por Área/Individual y reportes LEGACY. |
| [`REPORTING_USE_CASES.md`](./REPORTING_USE_CASES.md) | 6 casos de uso oficiales del Executive Report (Gerencia General, Dirección Nacional, Coordinación Nacional, Auditoría, Gestión Humana, Planeación). |
| [`REPORTING_AUDIT_MANUAL.md`](./REPORTING_AUDIT_MANUAL.md) | Manual completo de auditoría: Report ID, Snapshot, integridad, fecha de corte, versiones, calidad del dato/confiabilidad, reconstrucción histórica, procedimiento de auditoría. |
| [`REPORTING_EDGE_CASES.md`](./REPORTING_EDGE_CASES.md) | Comportamiento documentado del motor ante 9 situaciones excepcionales (sin colaboradores, datos incompletos, períodos futuros, usuario sin permisos, etc.). |
| [`REPORTING_QUALITY_BENCHMARK.md`](./REPORTING_QUALITY_BENCHMARK.md) | Criterios de aceptación de calidad del Executive Report y estado real del motor contra cada uno. |

## Cómo se lee esta documentación dentro de Nexo

El panel **Administración → Documentación** (solo Administrador) renderiza
estos archivos `.md` directamente en la aplicación, en modo de solo lectura,
sin duplicar su contenido en ninguna tabla — ver
`src/components/settings/DocumentationSection.tsx` y
`src/app/api/settings/documentation/route.ts`.

## Cómo se mantiene actualizada

Ver la sección "Documentación" de `CLAUDE.md` (raíz del repositorio) para el
procedimiento que sigue Claude Code al completar una implementación:
clasificar el cambio, registrar el módulo/fecha/versión, actualizar
`CHANGELOG.md` y, cuando corresponda, `AUDIT_LOG.md`, `DECISIONS.md`,
`ANALYTICS_FORMULAS.md` y `ROADMAP.md`.

Existe además un changelog automático mecánico (una línea por commit no
trivial) en la sección `## Changelog` del `README.md` de la raíz del
proyecto, mantenido por `.githooks/post-commit`. Ese mecanismo es
independiente de este sistema y sigue funcionando sin cambios.

---

_Última actualización: 2026-07-28._
