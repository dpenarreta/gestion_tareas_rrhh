# docs/CLAUDE.md

Cómo trabajar dentro de `docs/`. El índice de qué contiene cada documento ya
existe en `docs/README.md` — no lo dupliques acá. `docs/README.md` además se
**renderiza dentro de la app** (Administración → Documentación) — no le
agregues instrucciones dirigidas a Claude, solo contenido para el usuario
final.

## Cuándo actualizar

Como parte del **mismo cambio** (no una tarea aparte), cada vez que
completes exitosamente una implementación (feature, fix, refactor, cambio
de reglas de negocio o de arquitectura):

1. **Clasificá el cambio**: `FEATURE`, `FIX`, `REFACTOR`, `UX`, `UI`,
   `ANALYTICS`, `SECURITY`, `PERFORMANCE`, `DATABASE`, `DOCUMENTATION`,
   `BREAKING CHANGE`.
2. **Agregá una entrada en `CHANGELOG.md`** (al principio — es
   cronológico-descendente) con fecha, tipo, módulo, qué se implementó,
   archivos afectados, impacto y autor. Seguí el formato de las entradas
   existentes, no inventes uno nuevo.
3. Si el cambio modifica **reglas de negocio o arquitectura** (no solo
   código): agregá también una entrada en `AUDIT_LOG.md` (problema /
   alternativas consideradas / decisión / justificación / impacto — solo
   para decisiones con análisis real de alternativas, no para cada PR) y/o
   una fila en `DECISIONS.md` (índice liviano, una línea, con link a
   `AUDIT_LOG.md` si existe el análisis completo).
4. Si el cambio **agrega un KPI nuevo o modifica un cálculo existente** del
   motor de Analytics: actualizá la sección correspondiente de
   `ANALYTICS_FORMULAS.md` (objetivo/fórmula/variables/pesos/
   normalización/ejemplo/casos borde/reglas de negocio/versión/notas).
5. Si la funcionalidad estaba en `ROADMAP.md` bajo "Planificado" o "En
   desarrollo", movela a "Implementado" en el mismo cambio.
6. Si el cambio afecta `ANALYTICS_ENGINE_VERSION`/`FORMULA_SET_VERSION`
   (`src/lib/analytics.ts`) o amerita subir la versión de NEXO (nueva
   funcionalidad → MINOR; fix/refactor → PATCH; cambio de arquitectura o
   de modelo de negocio incompatible con el estado anterior → MAJOR),
   actualizá `VERSION.md` **y** el campo `version` de `package.json` en el
   mismo cambio.

Si la tarea es puramente exploratoria (pregunta, lectura de código) o no
cambia código de producto, no se requiere actualizar documentación.

## Documentos de cumplimiento (no de arquitectura)

`RAT.md` y `PENDIENTES_LEGALES.md` son registros LOPDP, no documentación
técnica. Si un cambio agrega/quita un proveedor externo que procesa datos
personales (ej. cambiar el proveedor de IA, agregar una integración nueva),
actualizalos en el mismo cambio — seguí el patrón ya usado para retiros de
proveedor: marcar como **RETIRADO** con fecha, nunca borrar el registro
histórico.

## Qué NO hacer

- No dupliques el índice de `README.md` acá ni en otro documento.
- No confundas este mecanismo con el changelog automático (una línea por
  commit no trivial) en `## Changelog` de `README.md` (raíz), mantenido por
  `.githooks/post-commit` — son dos sistemas independientes, ambos siguen
  funcionando.
- No inventes un formato nuevo para una entrada de `CHANGELOG.md`/
  `AUDIT_LOG.md` — copiá la estructura de la entrada más reciente.
