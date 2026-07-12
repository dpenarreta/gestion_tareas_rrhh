# Nexo

Sistema interno de gestión de recursos humanos para una organización en Ecuador. Centraliza la gestión de tareas y carga laboral, la visibilidad jerárquica de equipos, reuniones, mejora continua, analítica de desempeño y un asistente de IA especializado en RRHH — todo detrás de autenticación JWT con control de acceso por cargo, validado tanto en frontend como en cada endpoint del servidor.

**Producción:** https://nexo-phi-eight.vercel.app

## Stack tecnológico

| Capa | Tecnología |
|---|---|
| Framework | Next.js 16 (App Router) + TypeScript, modo estricto |
| Estilos | Tailwind CSS v4 |
| ORM | Prisma 7 con driver adapter `@prisma/adapter-pg` |
| Base de datos | PostgreSQL (Prisma Postgres) |
| Autenticación | JWT (`jose`, HS256), cookies httpOnly `SameSite=strict`, `bcryptjs` para hashing |
| Middleware | `src/proxy.ts` (Next.js 16 renombró `middleware.ts` → `proxy.ts`) |
| IA / asistente | Groq SDK (`llama-3.3-70b-versatile`) para Nova (chat RRHH, análisis de informes, mensajes del dashboard) |
| Base de conocimiento RAG | Embeddings locales (`@xenova/transformers`), documentos PDF (`pdf-parse`) almacenados en un repositorio privado de GitHub vía API |
| Reuniones | API real de Zoom (Server-to-Server OAuth) para crear reuniones; notas de transcripción de Otter.ai enlazadas manualmente (sin integración de API) |
| Otros | `xlsx` (import/export de tareas), `recharts` (gráficos), `framer-motion` + `@dnd-kit` (drag-and-drop), `canvas-confetti` |
| Despliegue | Vercel, deploy automático en cada push a `main` vía integración con GitHub |

## Jerarquía de roles

Definida en `src/lib/roles.ts`. El Administrador es invisible para el resto de roles (nunca aparece en listas de usuarios, informes ni notificaciones de otros).

| Rol | Nivel | Ve las tareas de... |
|---|---|---|
| ADMINISTRADOR | 5 (superusuario) | Todos (pero invisible para el resto) |
| JEFE_NACIONAL | 4 | Todos excepto Administrador |
| COORDINADOR_NACIONAL | 3 | Todos excepto Jefe Nacional y Administrador |
| COORDINADOR_ZS | 2 | Propio + Asistente GH ZS |
| ANALISTA_CC | 2 | Propio + Asistente GH + Trabajo Social |
| ANALISTA_SELECCION | 2 | Propio + Asistente Selección + Asistente GH + Trabajo Social |
| ASISTENTE_SELECCION | 1 | Solo propio |
| ASISTENTE_GH | 1 | Solo propio |
| ASISTENTE_GH_ZS | 1 | Solo propio |
| TRABAJO_SOCIAL | 1 | Solo propio |
| ASISTENTE_NOMINA | 1 | Solo propio |

- **Notificaciones**: siempre hacia arriba en la jerarquía, nunca hacia abajo (`NOTIFICATION_TARGETS`).
- **Gestión de usuarios** (`canManageUsers`): ADMINISTRADOR, JEFE_NACIONAL, COORDINADOR_NACIONAL.
- **Crear reuniones** (`canCreateMeetings`): ADMINISTRADOR, JEFE_NACIONAL, COORDINADOR_NACIONAL, COORDINADOR_ZS.
- **Acceso a informes/Analytics** (`canAccessReports`): ADMINISTRADOR, JEFE_NACIONAL, COORDINADOR_NACIONAL.
- **Revisar ideas de Mejora Continua** (`canReviewIdeas`): ADMINISTRADOR, JEFE_NACIONAL, COORDINADOR_NACIONAL. Excepción: Mejora Continua es visible entre Jefe y Coordinador Nacional en ambos sentidos, a diferencia de KPIs/Analytics/Informes donde el Coordinador nunca ve datos del Jefe.
- **Base de conocimiento RRHH (Nova RAG)**: solo ADMINISTRADOR, JEFE_NACIONAL y COORDINADOR_NACIONAL pueden ver la lista de documentos; solo ADMINISTRADOR puede subirlos o eliminarlos.

Toda regla de visibilidad se valida en el servidor (cada route handler bajo `src/app/api/`), no solo en el cliente.

## Módulos

| Módulo | Ruta | Descripción |
|---|---|---|
| Inicio | `/dashboard` | Resumen del día: tareas prioritarias, carga laboral, actividad del área, comunicados, reuniones próximas, mensaje de Nova generado con IA |
| Trabajo | `/tasks` | Gestión de tareas propias en vistas Kanban, Tabla y Gantt; tareas FIJA y SEGUIMIENTO (con registro de actividades), importación/exportación Excel, cierre mensual con archivado |
| Equipo | `/team` | Visibilidad y asignación de tareas de los subordinados según jerarquía (roles nivel ≥ 2) |
| Analytics | `/kpis`, `/my-kpis` | KPIs individuales y de equipo (cumplimiento, carga laboral, seguimiento, calidad, score), informes mensuales y por rango con análisis generado por IA |
| Nova | `/assistant` | Asistente de IA con 3 modos (general, tareas, RRHH); en modo RRHH cita fuentes de la base de conocimiento documental de la empresa |
| Reuniones | `/meetings` | Creación de reuniones Zoom reales, invitados, notas de Otter.ai |
| Mejora Continua | `/mejora-continua` | Ideas de mejora con votos, flujo de estados (propuesta → revisión → aprobada → desarrollo → pruebas → implementada / rechazada) e insignias |
| Usuarios | `/admin/users` | Alta, edición, reseteo de contraseña/consentimiento y eliminación de usuarios (solo roles con `canManageUsers`) |
| Ajustes | `/settings` | Consentimiento de datos, configuración de horas efectivas de carga laboral, gestión de la base de conocimiento RRHH (solo Administrador) |
| Mi perfil | `/profile` | Datos personales, cambio de contraseña, insignias |

## Variables de entorno

Archivo `.env` (ver `.env.example`), gestionado por `prisma.config.ts`. Nunca commitear `.env` ni `.env.local`.

| Variable | Requerida | Descripción |
|---|---|---|
| `DATABASE_URL` | Sí | Cadena de conexión PostgreSQL |
| `SESSION_SECRET` | Sí | Secreto para firmar los JWT de sesión, **mínimo 32 caracteres**. La app no arranca si falta o es demasiado corto (fail-closed, ver `src/lib/session-secret.ts`) |
| `GROQ_API_KEY` | No | Habilita el asistente Nova y el análisis con IA de los informes de KPIs. Sin ella, el dashboard usa mensajes de respaldo |
| `GITHUB_TOKEN` | No | Token con acceso al repositorio de documentos, usado para subir/leer/eliminar los PDFs de la base de conocimiento RRHH |
| `GITHUB_DOCS_REPO` | No | Repositorio privado `owner/repo` donde se almacenan los documentos de la base de conocimiento |
| `ZOOM_ACCOUNT_ID` / `ZOOM_CLIENT_ID` / `ZOOM_CLIENT_SECRET` | No | Credenciales Server-to-Server OAuth de Zoom para crear reuniones reales. Sin ellas se genera un enlace simulado |

Generar un `SESSION_SECRET` seguro:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"
```

## Instalación local

```bash
git clone https://github.com/ajacome0494/nexo.git
cd nexo
npm install                 # también configura los git hooks del proyecto (ver Changelog automático)
cp .env.example .env        # completar con valores reales
npx prisma generate         # genera el cliente Prisma (@/generated/prisma)
npx prisma migrate deploy   # aplica las migraciones existentes
npm run seed                # crea los usuarios iniciales
npm run dev                 # http://localhost:3000
```

### Scripts disponibles

```bash
npm run dev     # servidor de desarrollo
npm run build   # aplica migraciones y genera el build de producción
npm run start   # servidor de producción (requiere build previo)
npm run lint    # ESLint
npm run seed    # ejecutar seed de usuarios iniciales
```

### Flujo de trabajo con Prisma

```bash
npx prisma migrate dev --name <nombre>  # crear y aplicar una nueva migración
npx prisma generate                     # regenerar el cliente tras cambios en el schema
npx prisma studio                       # explorador visual de la base de datos
```

> **Prisma 7**: requiere un driver adapter para conectar a la base de datos — `new PrismaClient()` sin opciones lanza error en runtime. Ver `src/lib/prisma.ts`. Los tipos se importan desde `@/generated/prisma/client` (no `@/generated/prisma`).

## Credenciales de prueba

| Email | Contraseña | Rol |
|---|---|---|
| administrador@nexo.com | 123456 | ADMINISTRADOR (cuenta de sistema, no una persona) |

Para probar con otro rol (Jefe Nacional, Coordinador Nacional, etc.) pide las credenciales a un administrador — este README no documenta correos ni contraseñas de cuentas de personal real. `npm run seed` (`prisma/seed.ts`) crea usuarios de ejemplo adicionales en una base de datos nueva, pero esas cuentas no necesariamente existen en la base compartida de este proyecto.

> La contraseña por defecto al crear usuarios nuevos desde `/admin/users` es `123456` (bcrypt, 10 rondas).

## Estructura del proyecto

```
src/
  app/
    login/              # página de login (pública)
    (protected)/        # rutas protegidas: dashboard, tasks, team, kpis, my-kpis,
                         # meetings, mejora-continua, assistant, admin/users, settings, profile
    api/                # route handlers — cada uno valida sesión + rol en el servidor
  components/           # componentes de UI por módulo (shell, tasks, kpis, meetings, ...)
  lib/                  # sesión, roles, Prisma, embeddings, Zoom, GitHub docs, rate limiting
  proxy.ts              # protección de rutas (equivalente a middleware.ts en Next 16)
  generated/prisma/     # cliente Prisma generado (no editar, no versionado)
prisma/
  schema.prisma
  seed.ts
  migrations/
.githooks/               # hooks versionados (changelog automático del README)
```

## Notas de seguridad y auditoría IT

- Cada endpoint de API valida sesión y rol en el servidor (`getSession()` + funciones de `src/lib/roles.ts`), no solo en el frontend.
- La cookie de sesión (`nexo-session`) es httpOnly, `SameSite=strict` y `Secure` en producción.
- `SESSION_SECRET` es fail-closed: la app no arranca si falta o es débil (sin fallback a un secreto por defecto).
- Login con rate limiting: 5 intentos fallidos por IP bloquean nuevos intentos durante 15 minutos.
- Cabeceras de seguridad activas (CSP, HSTS, X-Frame-Options `DENY`, X-Content-Type-Options `nosniff`) y verificación de `Origin` para peticiones que mutan estado.
- El Administrador es invisible para el resto de roles en toda la aplicación (listas de usuarios, informes, notificaciones).
- **Auditoría IT 2026-07-10 (H6/H7/H8)** — hallazgos corregidos y verificados en producción:
  - *Control de acceso en API*: varios endpoints de gestión de usuarios (`/api/users/[id]`, `reset-password`, `reset-consent`) solo bloqueaban a Administrador como objetivo, permitiendo que un Coordinador Nacional viera, eliminara o reseteara la contraseña de un Jefe Nacional por ID directo. Corregido con una validación general de jerarquía (`getVisibleRoles`).
  - *Consentimiento de datos*: el modal de consentimiento LOPDP ahora bloquea por completo el resto de la aplicación (sin overlay transparente ni llamadas a APIs de datos) hasta que el usuario acepta; "Rechazar y salir" cierra sesión y redirige al login con mensaje explícito.
  - *Base de conocimiento RRHH*: la subida y eliminación de documentos quedó restringida solo a ADMINISTRADOR (antes también incluía Coordinador Nacional); listar documentos requiere ahora sesión con rol autorizado (antes cualquier usuario autenticado podía verlos).
- No hay framework de tests automatizados configurado; los cambios se validan manualmente end-to-end (incluye pases contra producción con cuentas descartables cuando el cambio toca control de acceso).

## Changelog

_Se actualiza automáticamente en cada commit vía el hook `.githooks/post-commit` (configurado por `npm install`, ver `scripts/setup-git-hooks.js`). Cada línea nueva se agrega arriba, con la fecha y el asunto del commit. Los commits `chore:` y `docs:` se omiten por ser mantenimiento, no cambios de producto._

- 2026-07-12: fix(kpis): no aplicar semaforo de rango al KPI diario en fin de semana
- 2026-07-11: feat(settings): mostrar el 4to limite de carga laboral (Moderado/Optimo) agrupado con los otros 3
- 2026-07-11: fix(kpis): reemplazar tolerancia por 4 limites independientes y corregir clasificacion/porcentaje de carga laboral
- 2026-07-11: fix(kpis): techo de 100% en porcentaje de carga dentro del rango optimo
- 2026-07-11: fix(kpis): corregir superposicion de etiquetas y clipping en graficos de carga en mobile
- 2026-07-11: feat(kpis): sistema de carga laboral de 5 rangos con graficos de barras y linea
- 2026-07-11: feat(kpis): carga laboral por rango configurable (base ± tolerancia)
- 2026-07-11: feat(tasks,kpis): formato HH.MM para horas en toda la aplicación
- 2026-07-11: feat(hooks): omitir commits chore/docs del changelog automático
- 2026-07-11: fix(hooks): marcar como ejecutables los scripts de hooks y acotar el ignore de ESLint
- 2026-07-11: fix(hooks): usar post-commit en vez de prepare-commit-msg para el changelog automático
- 2026-07-10: fix(security): control de acceso en API, consentimiento vinculante y subida RAG solo Admin
- 2026-07-10: fix(nova): procesar embeddings en lotes concurrentes y subir el timeout de la ruta de documentos
- 2026-07-08: feat(nova): reemplazar Google Drive por repositorio GitHub para la base de conocimiento RRHH
- 2026-07-08: feat(ajustes,nova): configuración de carga laboral con historial y base de conocimiento RRHH vía Google Drive
- 2026-07-07: fix(nova,roles,ajustes): estabilizar subida de PDF, aislar Administrador y agregar módulo de Ajustes
- 2026-07-06: feat(roles,kpis): rol Administrador, fix Asistente de Nómina y completedAt en carga laboral de tareas Fijas
- 2026-07-05: feat(design-system): rediseño visual premium con sidebar, tokens y nueva iconografía
- 2026-07-05: feat(kpis,tareas): carga laboral dinámica en informes y recordatorios de seguimiento
- 2026-07-03: feat(design-system): sistema de diseño completo con modo claro/oscuro
- 2026-07-02: fix(security): auditoría de seguridad y Coordinador ve ideas del Jefe
- 2026-07-02: feat(mejora-continua): módulo de ideas de mejora continua
- 2026-07-01: feat(meetings): módulo de reuniones Zoom con notas Otter.ai
- 2026-06-30: feat(assistant): renombrar a Nova y ampliar modo RRHH a consultor integral de gestión de personal
- 2026-06-30: feat: asistente IA con 3 modos, base de conocimiento RAG y citación de fuentes
- 2026-06-29: feat: add Team module with subordinate view and task assignment
- 2026-06-28: feat: rename project to Nexo and implement full auth system
