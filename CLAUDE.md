@AGENTS.md

# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Proyecto

**Nexo** — Sistema interno de gestión de recursos humanos con jerarquía de roles, autenticación JWT y control de visibilidad por cargo.

## Stack

- **Framework (frontend)**: Next.js 16 (App Router) con TypeScript
- **Styling**: Tailwind CSS v4
- **Backend**: Django/DRF (`backend/`) + SQL Server — Next.js habla con él vía
  `src/lib/djangoSession.ts` (`djangoApiFetch`) y los adaptadores
  `src/lib/django*Adapter.ts`. Migración de stack COMPLETA desde Postgres/Prisma
  (ver `docs/ROADMAP.md` § punto 14, `docs/AUDIT_LOG.md` Fases 87-90) — ningún
  `route.ts` toca una base de datos directo.
- **Auth**: JWT con `jose`, cookies httpOnly, bcryptjs para hashing (credenciales
  validadas contra Django, ver `src/lib/djangoSession.ts::loginToDjango`)
- **Runtime proxy**: `src/proxy.ts` (Next.js 16 renombró `middleware.ts` → `proxy.ts`)

## Comandos

```bash
npm run dev        # servidor de desarrollo
npm run build      # build de producción
npm run lint       # ESLint
```

## Variables de Entorno

Archivo `.env` (ya presente). Variables requeridas:

- `SESSION_SECRET` — secreto para firmar JWT (mínimo 32 caracteres)
- `DJANGO_API_URL` — URL base de la API de `backend/` (ver `backend/.env`)

Nunca commitear `.env.local` o `.env`.

## Convenciones TypeScript

- Preferir `type` sobre `interface` para formas de objetos
- Modo estricto habilitado (`"strict": true` en tsconfig)
- Co-locar tipos con el módulo propietario; extraer a `types/` solo si se comparte en 3+ archivos

## Estructura del Proyecto

```
src/
  app/
    login/              # página de login (pública)
    (protected)/        # grupo de rutas protegidas
      layout.tsx        # verifica sesión, renderiza nav
      dashboard/        # página de inicio post-login
      profile/          # perfil + cambio de contraseña
      admin/users/      # gestión de usuarios (solo admins)
    api/
      auth/
        login/          # POST — login, crea sesión JWT
        logout/         # POST — elimina cookie de sesión
        me/             # GET  — usuario actual desde sesión
        change-password/ # POST — cambiar contraseña
        forgot-password/ # POST — recuperación simulada
      users/
        route.ts        # GET lista / POST crear (solo admins)
        [id]/
          route.ts      # GET / PATCH / DELETE
          reset-password/ # POST — resetea a contraseña por defecto
  components/
    NavMenu.tsx         # navegación top, filtra links por rol
    UsersManager.tsx    # tabla de usuarios con acciones
  lib/
    session.ts          # encrypt/decrypt JWT, create/delete session
    roles.ts            # jerarquía, visibilidad, notificaciones, permisos, tipo Role
    djangoSession.ts    # puente de sesión hacia backend/ (djangoApiFetch)
    django*Adapter.ts   # un adaptador por dominio: mapea JSON de Django (snake_case) a la forma que ya espera el frontend
  proxy.ts              # protección de rutas (equivalente a middleware)
backend/                # Django/DRF + SQL Server — ver backend/CLAUDE.md o docs/ARCHITECTURE.md
```

## Jerarquía de Roles

Definida en `src/lib/roles.ts`. Niveles:

| Rol | Nivel | Ve las tareas de... |
|-----|-------|---------------------|
| JEFE_NACIONAL | 4 | Todos |
| COORDINADOR_NACIONAL | 3 | Todos excepto Jefe |
| COORDINADOR_ZS | 2 | Propio + Asistente GH ZS |
| ANALISTA_CC | 2 | Propio + Asistente GH + Trabajo Social |
| ANALISTA_SELECCION | 2 | Propio + Asistente Selección + Asistente GH + Trabajo Social |
| ASISTENTE_SELECCION | 1 | Solo propio |
| ASISTENTE_GH | 1 | Solo propio |
| ASISTENTE_GH_ZS | 1 | Solo propio |
| TRABAJO_SOCIAL | 1 | Solo propio |

**Notificaciones**: siempre hacia arriba en la jerarquía, nunca hacia abajo (`NOTIFICATION_TARGETS`).

**Gestión de usuarios** (`canManageUsers`): solo JEFE_NACIONAL y COORDINADOR_NACIONAL.

**Crear reuniones** (`canCreateMeetings`): JEFE_NACIONAL, COORDINADOR_NACIONAL, COORDINADOR_ZS.

## Autenticación

- Sesión: JWT firmado con HS256, almacenado en cookie `nexo-session` (httpOnly, 7 días)
- Contraseña por defecto al crear usuarios: `123456` (hasheada con bcrypt, 10 rondas)
- El payload del JWT contiene: `userId`, `role`, `name`, `email`
- `src/proxy.ts` redirige a `/login` si no hay sesión válida; redirige a `/dashboard` si ya está autenticado y visita rutas públicas

## Testing

Framework de pruebas: Vitest + `@testing-library/react` (jsdom). Ver `docs/ARCHITECTURE.md` § Convenciones técnicas para el detalle del setup (`vitest.config.ts`, stub de `server-only`). Tests en `src/__tests__/`. Los `route.ts` ya cortados a Django se testean mockeando `@/lib/djangoSession` (`djangoApiFetch`), no una base de datos.

## Documentación

Nexo mantiene un sistema oficial de documentación en `/docs` (`README.md` de ese
directorio es el índice) — es la fuente de verdad sobre la evolución del proyecto,
pensada para auditorías internas y continuidad del desarrollo. **Cada vez que
completes exitosamente una implementación** (feature, fix, refactor, cambio de
reglas de negocio o de arquitectura), como parte del mismo cambio:

1. **Clasifica el cambio** en uno de: `FEATURE`, `FIX`, `REFACTOR`, `UX`, `UI`,
   `ANALYTICS`, `SECURITY`, `PERFORMANCE`, `DATABASE`, `DOCUMENTATION`,
   `BREAKING CHANGE`.
2. **Agrega una entrada en `docs/CHANGELOG.md`** (al principio, es
   cronológico-descendente) con fecha, tipo, módulo, qué se implementó,
   archivos afectados, impacto y autor — sigue el formato de las entradas
   existentes.
3. Si el cambio modifica **reglas de negocio o arquitectura** (no solo código):
   agrega también una entrada en `docs/AUDIT_LOG.md` (problema/alternativas/
   decisión/justificación/impacto — solo para decisiones con análisis real de
   alternativas) y/o una fila en `docs/DECISIONS.md` (índice liviano, una línea).
4. Si el cambio **incorpora un KPI nuevo o modifica un cálculo existente** del
   motor de Analytics: actualiza la sección correspondiente de
   `docs/ANALYTICS_FORMULAS.md` (objetivo/fórmula/variables/pesos/
   normalización/ejemplo/casos borde/reglas de negocio/versión/notas).
5. Si la funcionalidad estaba en `docs/ROADMAP.md` bajo "Planificado" o "En
   desarrollo", muévela a "Implementado" en el mismo cambio.
6. Si el cambio afecta `ANALYTICS_ENGINE_VERSION`/`FORMULA_SET_VERSION`
   (`src/lib/analytics.ts`) o amerita un incremento de versión de NEXO (nueva
   funcionalidad → MINOR; fix/refactor → PATCH; cambio de arquitectura o de
   modelo de negocio incompatible con el estado anterior → MAJOR), actualiza
   `docs/VERSION.md` y el campo `version` de `package.json` en el mismo cambio.

Esto es manual (no hay CI/webhook separado) — la implementación de este
procedimiento ES el trabajo de Claude Code en cada sesión, no un script aparte.
No dupliques el changelog automático de `README.md` (una línea por commit,
mantenido por `.githooks/post-commit`) — ambos mecanismos coexisten con
propósitos distintos (ver `docs/README.md`).

Si una tarea es puramente exploratoria, de investigación o no cambia código de
producto (ej. una pregunta, una lectura de código), no se requiere actualizar
la documentación.
