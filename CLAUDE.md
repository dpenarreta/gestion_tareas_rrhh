@AGENTS.md

# CLAUDE.md

Guía para Claude Code al trabajar en este repositorio. Reglas específicas por
área en `.claude/rules/` (se cargan por `paths:`) y en `backend/CLAUDE.md`/
`docs/CLAUDE.md` (se cargan al entrar a esas carpetas) — este archivo es solo
el contexto global.

## Proyecto

**Nexo** — sistema interno de gestión de recursos humanos con jerarquía de
roles, autenticación JWT y control de visibilidad por cargo.

## Stack

- **Frontend**: Next.js 16 (App Router) en la **raíz del repo** — no hay
  carpeta `frontend/` para la app real (ver nota abajo). TypeScript estricto,
  Tailwind v4, React 19.
- **Backend**: Django 5.1 + DRF (`backend/`) + SQL Server (`mssql-django`).
  Fuente de verdad de negocio y de autenticación — ver `backend/CLAUDE.md`.
- **IA**: Nova usa Gemini (`@google/genai`), no OpenAI/Groq.
- **Sin ORM en el frontend** — Prisma se eliminó por completo (migración de
  stack COMPLETA, ver `docs/ROADMAP.md` § punto 14). Ningún `route.ts` toca
  una base de datos directo.

> ⚠️ **`frontend/` (carpeta en la raíz) es un prototipo Vite/React
> abandonado, no relacionado con la app real** — excluido explícitamente de
> los tests (`vitest.config.ts`). No lo uses como referencia ni lo trabajes
> salvo pedido explícito del usuario.

## Arquitectura

Next.js habla con Django exclusivamente vía `djangoApiFetch`
(`src/lib/djangoSession.ts`) y un adaptador por dominio
(`src/lib/django*Adapter.ts`, snake_case→camelCase). Reglas obligatorias:

- Ningún `route.ts`/página server accede a una base de datos directo —
  siempre a través de `djangoApiFetch`.
- No inventes una capa de repositorios en Django — el ORM ya es la capa de
  persistencia (ver `backend/CLAUDE.md`).
- Ver `.claude/rules/architecture.md` para el detalle.

## Estructura del Proyecto

```
src/
  app/
    login/, reset-password/    # rutas públicas
    (protected)/                # requieren sesión — layout.tsx la verifica
      dashboard/ kpis/ tasks/ projects/ team/ meetings/ desk/
      inteligencia-preventiva/ mejora-continua/ assistant/ settings/ admin/
    api/                        # ~150 route.ts, todos hablan con Django
  components/                   # un subdirectorio por módulo + ui/ (primitivos compartidos)
  lib/
    session.ts                  # JWT (crear/leer/borrar sesión)
    roles.ts                    # jerarquía de roles, visibilidad, permisos
    djangoSession.ts            # djangoApiFetch — único punto de entrada a Django
    django*Adapter.ts           # un adaptador por dominio
    executiveReporting/         # motor de Reportes Ejecutivos + narrativa Nova
  proxy.ts                      # protección de rutas (reemplaza a middleware.ts en Next 16)
  __tests__/                    # Vitest
backend/                        # Django/DRF + SQL Server — ver backend/CLAUDE.md
docs/                           # documentación oficial — ver docs/CLAUDE.md
```

## Comandos

```bash
npm run dev              # servidor de desarrollo (Next.js)
npm run build             # build de producción
npx tsc --noEmit           # typecheck (sin script propio en package.json)
npm run lint               # ESLint
npx vitest run             # suite completa de tests del frontend
```

Backend: ver `backend/CLAUDE.md`.

## Variables de Entorno

Archivo `.env` en la raíz (nunca commitear `.env`/`.env.local`):

- `SESSION_SECRET` — firma el JWT de sesión (mínimo 32 caracteres)
- `DJANGO_API_URL` — URL base de `backend/` (ver `backend/.env` para las suyas)
- `GEMINI_API_KEY` — Nova (chat, Insights, narrativa de Reportes Ejecutivos)
- `GITHUB_TOKEN`/`GITHUB_DOCS_REPO`, `ZOOM_*` — integraciones opcionales, cada
  feature degrada con gracia si faltan

## Jerarquía de Roles

Definida en `src/lib/roles.ts` — **fuente de verdad única**, no la
reimplementes ni la infieras de otro lado.

| Rol | Nivel | Ve las tareas de... |
|-----|-------|---------------------|
| JEFE_NACIONAL | 4 | Todos |
| COORDINADOR_NACIONAL | 3 | Todos excepto Jefe |
| COORDINADOR_ZS | 2 | Propio + Asistente GH ZS |
| ANALISTA_CC | 2 | Propio + Asistente GH + Trabajo Social |
| ANALISTA_SELECCION | 2 | Propio + Asistente Selección + Asistente GH + Trabajo Social |
| ASISTENTE_SELECCION / ASISTENTE_GH / ASISTENTE_GH_ZS / TRABAJO_SOCIAL | 1 | Solo propio |

- Notificaciones: siempre hacia arriba en la jerarquía (`NOTIFICATION_TARGETS`), nunca hacia abajo.
- `canManageUsers`: solo JEFE_NACIONAL y COORDINADOR_NACIONAL.
- `canCreateMeetings`: JEFE_NACIONAL, COORDINADOR_NACIONAL, COORDINADOR_ZS.
- `isLeadershipRole` (nivel ≥ 4) vs. `isExecutorRole`: los roles de dirección
  no ejecutan tareas operativas — su carga laboral individual no es
  representativa y no debe calcularse ni mostrarse como propia.

## Autenticación

- Sesión Next.js: JWT (HS256, `jose`) en cookie `nexo-session` (httpOnly, 7
  días). Payload: `djangoUserId` (id numérico de Django, único
  identificador de sesión desde el retiro del cuid legado de Postgres —
  decisión explícita del usuario, ver docs/AUDIT_LOG.md § 2026-08-31),
  `role`, `name`, `email`.
- **Django es la única fuente de verdad de credenciales** — el login
  valida contra Django (`loginToDjango`), no contra Next.js (hashing real
  con `Argon2PasswordHasher`; `bcryptjs` ya no está ni en `package.json`).
- Contraseña por defecto al crear un usuario desde la app:
  **`NexoTemporal2026!`** (`src/app/api/users/route.ts`). El `123456` que
  este archivo documentó hasta el 2026-09-11 es dato del seed de
  desarrollo, no del flujo real: no pasa los validadores de Django
  (mínimo 10 caracteres y no puede ser solo numérica), así que crear un
  usuario con esa contraseña falla.
- Para que alguien que olvidó su contraseña vuelva a entrar, Ajustes →
  Gestión de contraseñas genera un **enlace de recuperación de un solo
  uso** que se le entrega por fuera del sistema. Un administrador nunca ve
  ni define la contraseña de otra persona (decisión de Fase 2).
- `src/proxy.ts` redirige a `/login` sin sesión válida, y a `/dashboard` si
  ya hay sesión y se visita una ruta pública.

## Development Rules

- Lee el código existente antes de modificarlo — los patrones ya
  establecidos (adaptadores, servicios, jerarquía de roles) son la fuente
  de verdad, no los reinventes.
- No agregues dependencias nuevas sin necesidad real.
- No refactorices código no relacionado con la tarea pedida.
- No dupliques componentes, adaptadores, servicios o helpers — busca si ya
  existe algo equivalente antes de crear uno nuevo (`src/lib/`,
  `src/components/`, `backend/apps/*/services.py`).
- Cambios pequeños y enfocados en el problema.

## Testing

Vitest (`src/__tests__/`) para Next.js, pytest (`backend/apps/*/tests/`)
para Django. Reglas de mocking y convenciones en `.claude/rules/testing.md`.

## Documentación

Tras completar una implementación (feature/fix/refactor/cambio de reglas de
negocio o arquitectura), actualiza `docs/` como parte del mismo cambio —
procedimiento completo en `docs/CLAUDE.md`. Si la tarea es puramente
exploratoria (pregunta, lectura de código), no aplica.
