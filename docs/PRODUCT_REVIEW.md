# Revisión de Producto — Sprint C (NEXO Experience)

> Auditoría de producto exigida por el sprint (§15): fortalezas, debilidades,
> oportunidades de mejora, deuda técnica y de UX detectada, y recomendaciones
> para futuras versiones. Complementa — no duplica — el informe de Design
> Review de Sprint B (`docs/DESIGN_SYSTEM.md` §17), que cubrió consistencia
> visual; este documento cubre flujos, fricción y arquitectura de producto.

**Fecha:** 2026-07-24 · **Autor:** Claude Code · **Alcance evaluado:** toda la
plataforma, con foco en los módulos de alto tráfico ya intervenidos por
Sprint B/C (Tareas, Dashboard, Escritorio Digital, Equipo, KPIs/Analytics,
Ajustes, Usuarios) y una revisión de los módulos no intervenidos (Ideas,
Reuniones, Proyectos, Repositorio, Nova, Login, Perfil).

---

## 1. Fortalezas del producto

- **Motor de Analytics auditable y versionado** (`src/lib/analytics.ts`,
  `AnalyticsAuditLog`) — cálculo 100% determinista, sin IA, con historial de
  fórmula/configuración. Poco común en herramientas internas de este tamaño.
- **Modelo de roles coherente y centralizado** (`src/lib/roles.ts`) — una
  sola fuente de verdad (`ROLE_LEVEL`) para jerarquía, visibilidad,
  notificaciones y ahora también para qué es "representativo" mostrar a cada
  rol (`isLeadershipRole`) — evita la duplicación de reglas de acceso que sí
  existe en otras partes (ver §3).
- **Centro de Recuperación único** (`src/lib/recoveryCenter.ts`) — patrón de
  papelera/restauración de una sola implementación para todos los módulos,
  en vez de que cada uno reinvente su propia lógica de borrado.
- **Sistema de documentación vivo** (`/docs`, panel de solo lectura en
  Administración) — decisiones y cambios trazables sin depender de memoria
  institucional.
- **Diseño visual ya unificado** (Sprint B) — botones, chips, tablas,
  modales, toasts y estados de carga/vacío comparten un único lenguaje en
  los módulos de alto tráfico.
- **Tono del feedback al usuario, ya antes de este sprint** — los mensajes
  de error existentes eran mayormente claros y en español, sin jerga técnica
  filtrada (con las excepciones puntuales corregidas en la Fase 3 de este
  sprint).

## 2. Debilidades detectadas

- **Cuatro mecanismos de interacción distintos para "cambiar estado"** antes
  de este sprint (dropdown inline en Tabla, drag-only en Kanban, checkbox +
  modal en Recordatorios, botones nombrados en Ideas) — parcialmente
  corregido (Kanban ahora tiene una alternativa de clic), pero Ideas sigue
  requiriendo abrir el modal de detalle para cualquier cambio de estado.
- **Búsqueda fragmentada** — Tareas tiene su propio buscador de solo texto
  (ahora también compara descripción/responsable, Fase 1), Escritorio
  Digital tiene un buscador rico independiente (con búsquedas recientes
  desde Fase 5), y no existe ningún punto de búsqueda que cubra tareas +
  proyectos + notas a la vez.
- **Analytics para líderes tenía un vacío de navegación real** — ver un
  subordinado (2 clics) era más directo que ver el propio desempeño (sin
  atajo). Corregido en Fase 1 para roles con KPIs individuales de ejecución.
- **Feedback de éxito/error inconsistente entre módulos "viejos" y
  "nuevos"** — antes de este sprint, Ideas/Reuniones/gran parte de
  Proyectos no tenían ningún sistema de toasts (Sprint B no los tocó);
  varias acciones fallaban o tenían éxito completamente en silencio. Cerrado
  en la Fase 3 de este sprint.
- **"Cancelar" nunca advierte de cambios sin guardar**, en ningún formulario
  de la plataforma (patrón consistente, pero consistentemente arriesgado) —
  no se tocó este sprint, ver Oportunidades futuras.

## 3. Oportunidades de mejora

- **Unificar mecanismos de cambio de estado restantes** — Recordatorios ya
  tiene un patrón de un clic adecuado a su estado binario (no requiere
  cambio); Ideas sigue siendo el caso pendiente real.
- **Un buscador verdaderamente global** (tareas + proyectos + notas +
  recordatorios en una sola consulta) — deliberadamente fuera de alcance
  este sprint por ser una superficie de API nueva, no una unificación de UI.
- **Confirmación de "cambios sin guardar" al cancelar formularios largos**
  (Crear Proyecto, editar tarea) — mejoraría la experiencia de error por
  omisión (nadie pierde trabajo por un clic accidental en "Cancelar").
- **Extender "acciones inteligentes" más allá de búsquedas recientes** —
  proyectos recientes, personas frecuentemente asignadas — mismo patrón de
  localStorage ya validado en Fase 5, solo falta priorizar dónde aporta más.

## 4. Deuda técnica detectada

- **`recoveryCenter.ts` solo tiene 2 de 6 módulos anticipados integrados**
  (Proyectos, Escritorio Digital) — Trabajo, Documentos, Repositorios y
  Plantillas quedan "preparados pero no migrados" (decisión explícita de un
  sprint anterior, no un olvido, pero sigue siendo deuda real).
- **Patrón de fallback de error `err instanceof Error ? err.message : "..."`**
  — endurecido en este sprint solo donde se detectó (rutas de
  `recoveryCenter.ts`); no se auditó exhaustivamente el resto de las ~130
  rutas API en busca del mismo patrón. Recomendado: un lint rule o revisión
  dedicada en un sprint futuro.
- **Dos conceptos de "Card" coexisten a propósito** (`ui/Card.tsx` genérico
  vs. `settings/SectionCard.tsx` acordeón) — documentado en Sprint B, sigue
  siendo una superficie que un desarrollador nuevo puede confundir sin leer
  `docs/DESIGN_SYSTEM.md` §14 primero.

## 5. Deuda de UX

- **Módulos no intervenidos por Sprint B ni C**: Ideas, Reuniones,
  Repositorio de documentos, Asistente Nova, Login, Perfil (parcialmente —
  solo se migró su feedback de éxito/error en este sprint, no sus
  botones/tablas). Siguen con botones/chips ad-hoc del sistema visual
  anterior a Sprint B.
- **Sin experiencia de primer uso** en ninguna parte de la plataforma — un
  usuario nuevo aprende por descubrimiento, sin tooltips iniciales ni guía
  rápida. Evaluado y descartado este sprint por ser una feature nueva de
  alcance considerable, no un refinamiento (§14 del sprint).
- **Ayuda contextual sigue siendo mayormente Analytics-only** — este sprint
  agregó 3 instancias puntuales (`InfoTooltip`) donde había fricción real
  confirmada, no una cobertura sistemática por módulo.

## 6. ¿Qué módulos aún pueden simplificarse?

- **Ideas** — el ciclo de estado (Propuesta → En revisión → Aprobada → En
  desarrollo → En pruebas → Implementada / Rechazada) se opera solo desde
  botones nombrados dentro de un modal; candidato natural para el mismo
  patrón de chip/dropdown ya aplicado a Tareas.
- **Escritorio Digital** — 4 pestañas (Hoy/Notas/Recordatorios/Calendario)
  con el buscador ya unificado (Fase 5) pero la creación de nota y de
  recordatorio siguen siendo flujos independientes sin punto de entrada
  compartido más allá del header de `DeskBoard`.

## 7. ¿Qué procesos siguen siendo complejos?

- **Crear proyecto** exige `targetTimeHours` desde el inicio (campo `Float`
  no-nullable en Prisma) aunque en la práctica se suele afinar por fase más
  adelante — ya se agregó una explicación (`InfoTooltip`, Fase 5) pero el
  campo en sí solo puede volverse opcional con una migración de schema,
  fuera de alcance de un sprint de refinamiento.
- **Cambiar el estado de una idea** sigue requiriendo abrir el modal de
  detalle — el único de los 4 flujos de "cambio de estado" del audit inicial
  que no se tocó este sprint (ver §2/§6).

## 8. ¿Qué pantallas están sobrecargadas?

- **Dashboard**, antes de la Fase 4 de este sprint: 8 cards de peso visual
  idéntico en una grilla uniforme, con el espacio más prominente ocupado por
  contenido decorativo. Parcialmente corregido (jerarquía en `jornada`,
  nueva card de Proyectos) — el resto de las cards (Comunicados, Acciones
  rápidas, Resumen) siguen sin una jerarquía explícita entre sí más allá del
  orden personalizable por drag-and-drop.
- **Ajustes** (`SettingsManager.tsx` + 13 secciones) — ya usa el acordeón
  `SectionCard` colapsado por defecto (mitiga la sobrecarga), pero sigue
  siendo la pantalla con más secciones independientes de toda la plataforma.

## 9. ¿Qué componentes generan más carga cognitiva?

- **El selector de estado de Kanban** (nuevo en Fase 2) es, por diseño, un
  control adicional junto al drag-and-drop existente — se agregó
  `InfoTooltip`/`title` explicando su propósito precisamente para mitigar el
  riesgo de que dos mecanismos para la misma acción confundan más de lo que
  ayudan. Vale la pena observar el uso real antes de replicar el patrón en
  más vistas.
- **La configuración de Analytics** (`AnalyticsConfigSection.tsx`, ~25
  campos numéricos de pesos/umbrales) sigue siendo, con diferencia, la
  pantalla de mayor densidad de información de toda la plataforma — fuera de
  alcance de este sprint (Analytics Engine no se toca), pero el candidato
  más claro para una futura revisión de agrupamiento/progresión visual.

## 10. Recomendaciones para futuras versiones (Sprint D o posterior)

1. Unificar el cambio de estado de Ideas al mismo patrón chip/quick-menu.
2. Confirmación de "cambios sin guardar" en formularios largos antes de
   cerrar sin guardar.
3. Auditoría dedicada del patrón `err instanceof Error` en el resto de las
   rutas API no revisadas este sprint.
4. Evaluar un buscador global real (tareas + proyectos + notas +
   recordatorios) como una iniciativa de producto propia, no un
   refinamiento — requiere una superficie de API nueva.
5. Extender el Design System de Sprint B (botones/chips/tablas/toasts) a
   Ideas, Reuniones, Repositorio y Nova — quedaron fuera de ambos sprints
   por alcance, no por decisión de producto.
6. Evaluar una experiencia de primer uso ligera (tooltips iniciales,
   opcional, no invasiva) como iniciativa propia si la incorporación de
   nuevos usuarios lo justifica.
7. Extender "acciones inteligentes" (Fase 5) a proyectos recientes y
   personas frecuentemente asignadas, reutilizando el mismo patrón de
   localStorage ya construido.
