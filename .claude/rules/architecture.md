# Architecture Rules

Reglas transversales del límite Next.js ↔ Django. Contexto completo en
`/CLAUDE.md` y `backend/CLAUDE.md` — esto son restricciones accionables, no
una repetición de la arquitectura.

- Ningún `route.ts` ni página server de Next.js accede a una base de datos
  directo. Todo pasa por `djangoApiFetch` (`src/lib/djangoSession.ts`) y un
  adaptador (`src/lib/django*Adapter.ts`).
- Django devuelve **snake_case** — el paso por un `django*Adapter.ts` (o
  `mapDjangoAnalyticsPayloadToNexoShape`/`mapDjangoKpiPayloadToNexoShape`
  genéricos) **no es opcional**. Saltarlo produce campos `undefined` en
  runtime sin error de tipos (TypeScript no lo detecta) — bug real ya
  ocurrido en producción.
- **Cerrado (2026-08-31): ya no hay dos espacios de id.** `session.djangoUserId`
  (el id numérico de Django) es el único identificador de sesión — se
  retiró por completo el cuid legado de Postgres (`legacy_postgres_id`,
  decisión explícita del usuario, ver docs/AUDIT_LOG.md § 2026-08-31).
  `resolveDjangoUserId(session)`/`fetchDjangoCurrentUserId()` siguen
  existiendo como resolución defensiva genérica (por si `session.djangoUserId`
  faltara en runtime, ej. un JWT emitido antes de este cambio), pero ya no
  hay una segunda identidad "cuid" con la que confundirlo.
- Django es la única fuente de verdad de autenticación y de reglas de
  negocio — Next.js nunca recalcula un KPI, un permiso de negocio ni un
  hash de contraseña real.
- `next.config.ts` fija `Content-Security-Policy` con `connect-src 'self'`
  — una llamada `fetch()` desde el cliente a un dominio externo nuevo
  queda bloqueada por el navegador salvo que actualices esa política ahí
  mismo.
- No agregues una capa de repositorios en el backend ni un state manager
  global en el frontend "por si acaso" — ninguno de los dos existe hoy y
  no hay necesidad real detectada (ver `backend/CLAUDE.md` y
  `.claude/rules/frontend/state.md`).
