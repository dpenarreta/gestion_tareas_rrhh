@AGENTS.md

# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Proyecto

**Nexo** — Sistema interno de gestión de recursos humanos con jerarquía de roles, autenticación JWT y control de visibilidad por cargo.

## Stack

- **Framework**: Next.js 16 (App Router) con TypeScript
- **Styling**: Tailwind CSS v4
- **ORM**: Prisma 7 con driver adapter `@prisma/adapter-pg`
- **Database**: PostgreSQL
- **Auth**: JWT con `jose`, cookies httpOnly, bcryptjs para hashing
- **Runtime proxy**: `src/proxy.ts` (Next.js 16 renombró `middleware.ts` → `proxy.ts`)

## Comandos

```bash
npm run dev        # servidor de desarrollo
npm run build      # build de producción
npm run lint       # ESLint
npm run seed       # ejecutar seed (crea usuarios iniciales)
```

## Prisma Workflow

```bash
npx prisma migrate dev --name <nombre>  # crear y aplicar migración
npx prisma generate                     # regenerar cliente tras cambios en schema
npx prisma db seed                      # ejecutar seed
npx prisma studio                       # explorador visual de BD
```

**Importante — Prisma 7:** requiere driver adapter para conectar a la BD. `new PrismaClient()` sin opciones lanza error en runtime. Siempre inicializar así:

```ts
import { PrismaPg } from "@prisma/adapter-pg";
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });
```

Importar tipos desde `@/generated/prisma/client` (NO `@/generated/prisma`).

## Variables de Entorno

Archivo `.env` (ya presente, gestionado por `prisma.config.ts`). Variables requeridas:

- `DATABASE_URL` — cadena de conexión PostgreSQL
- `SESSION_SECRET` — secreto para firmar JWT (mínimo 32 caracteres)

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
    prisma.ts           # singleton PrismaClient con adapter pg
    session.ts          # encrypt/decrypt JWT, create/delete session
    roles.ts            # jerarquía, visibilidad, notificaciones, permisos
  proxy.ts              # protección de rutas (equivalente a middleware)
  generated/prisma/     # cliente Prisma generado (no editar)
prisma/
  schema.prisma         # modelo User + enum Role
  seed.ts               # crea usuarios iniciales
  migrations/           # historial de migraciones
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

## Usuarios Iniciales (seed)

| Email | Contraseña | Rol |
|-------|-----------|-----|
| jefe@nexo.com | 123456 | JEFE_NACIONAL |
| coord.nacional@nexo.com | 123456 | COORDINADOR_NACIONAL |

## Testing

Framework de pruebas: Vitest + `@testing-library/react` (jsdom). Ver `docs/ARCHITECTURE.md` § Convenciones técnicas para el detalle del setup (`vitest.config.ts`, stub de `server-only`, mock global de Prisma). Tests en `src/__tests__/`.

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
