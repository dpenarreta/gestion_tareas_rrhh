# Nexo

## 1. Descripción general

Nexo es un sistema interno de gestión de recursos humanos para una organización en Ecuador. Centraliza la gestión de tareas y carga laboral, la visibilidad jerárquica de equipos, la programación de reuniones, un flujo de mejora continua, analítica de desempeño (KPIs) y un asistente de IA especializado en RRHH ("Nova"). Todo el sistema opera detrás de autenticación por sesión JWT, con control de acceso por cargo validado tanto en el frontend como en cada endpoint del servidor.

Este documento describe la arquitectura, el stack tecnológico y las convenciones del proyecto con fines técnicos internos. No contiene credenciales, tokens, URLs de producción ni información que facilite el acceso no autorizado al sistema.

## 2. Tecnologías principales

| Capa | Tecnología |
|---|---|
| Framework | Next.js 16 (App Router) + TypeScript en modo estricto |
| Estilos | Tailwind CSS v4 |
| ORM | Prisma 7 con driver adapter `@prisma/adapter-pg` |
| Base de datos | PostgreSQL |
| Autenticación | JWT (`jose`, HS256) en cookie httpOnly, `bcryptjs` para hashing de contraseñas |
| Enrutamiento/protección | `src/proxy.ts` (Next.js 16 renombró `middleware.ts` → `proxy.ts`) |
| IA conversacional | Groq SDK, usado por el asistente Nova y por el análisis automático de informes |
| Base de conocimiento (RAG) | Embeddings locales vía `@xenova/transformers`, extracción de texto de PDF vía `pdf-parse` |
| Almacenamiento documental | Repositorio privado de GitHub, accedido vía API de GitHub |
| Reuniones | API de Zoom (Server-to-Server OAuth) para creación de reuniones; enlace a notas de Otter.ai sin integración de API |
| Datos y reportes | `xlsx` (import/export de tareas), `recharts` (gráficos), `jspdf` + `html2canvas` (PDF de informes) |
| Interacción/UI | `framer-motion`, `@dnd-kit` (drag-and-drop), `canvas-confetti`, `lucide-react`, `next-themes` |
| Despliegue | Vercel, build automatizado en cada push a la rama principal |

## 3. Arquitectura general del proyecto

Nexo es una aplicación monolítica construida sobre Next.js App Router, que combina renderizado de servidor, componentes de cliente y una API REST propia bajo `src/app/api/`.

- **Capa de presentación**: páginas y layouts en `src/app/(protected)/*` (rutas autenticadas) y `src/app/login` (pública), apoyadas en componentes reutilizables de `src/components/`.
- **Capa de API**: route handlers de Next.js bajo `src/app/api/`, uno por recurso/acción. Cada handler valida sesión y rol de forma independiente del cliente.
- **Capa de dominio/servicios**: lógica compartida en `src/lib/` — sesión y JWT, jerarquía de roles y visibilidad, acceso a base de datos, integración con Zoom, integración con el repositorio de documentos en GitHub, generación de embeddings, formateo de fechas/horas y utilidades de carga laboral.
- **Capa de datos**: PostgreSQL accedido mediante Prisma 7 (cliente generado en `src/generated/prisma/`), con historial de migraciones versionado en `prisma/migrations/`.
- **Protección de rutas**: `src/proxy.ts` intercepta cada request, exige sesión válida para rutas protegidas, redirige sesiones autenticadas fuera de rutas públicas, fuerza HTTPS en producción y valida el header `Origin` en peticiones que mutan estado (defensa adicional contra CSRF).
- **Cabeceras de seguridad**: configuradas de forma centralizada en `next.config.ts` (CSP, HSTS en producción, `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`).

El sistema no expone una API pública: todos los endpoints están pensados para ser consumidos por el propio frontend de Nexo bajo sesión autenticada.

## 4. Estructura de carpetas

```
src/
  app/
    login/              # página de login (pública)
    (protected)/        # rutas protegidas: dashboard, tasks, team, kpis, my-kpis,
                         # meetings, mejora-continua, assistant, admin/users, settings, profile
    api/                # route handlers — cada uno valida sesión + rol en el servidor
  components/            # componentes de UI, organizados por módulo (shell, tasks, kpis, meetings, ideas, assistant, team, reminders, ui)
  hooks/                 # hooks de React reutilizables
  lib/                   # sesión, roles, Prisma, embeddings, integraciones (Zoom, GitHub), utilidades de negocio
  proxy.ts               # protección de rutas (equivalente a middleware.ts en Next 16)
  generated/prisma/      # cliente Prisma generado (no editar, no versionado)
prisma/
  schema.prisma           # modelos de datos y enumeraciones
  seed.ts                 # script de datos iniciales
  migrations/              # historial de migraciones
public/
  manuales/               # manuales de usuario en PDF
  vendor/                  # librerías de terceros vendorizadas (jsPDF, html2canvas)
.githooks/                 # hooks de git versionados (changelog automático de este README)
scripts/                   # scripts de mantenimiento del repositorio
```

| Carpeta | Contenido |
|---|---|
| `src/app/(protected)` | Páginas autenticadas de cada módulo funcional |
| `src/app/api` | Endpoints REST internos, agrupados por recurso |
| `src/components` | Componentes de interfaz, organizados por módulo |
| `src/lib` | Lógica de dominio, integraciones externas y utilidades compartidas |
| `src/generated/prisma` | Cliente Prisma autogenerado a partir del schema |
| `prisma` | Definición de datos, migraciones y seed |
| `public` | Recursos estáticos y manuales de usuario |
| `.githooks` | Automatización de changelog en commits |

## 5. Configuración base del entorno

La configuración se gestiona mediante variables de entorno (archivo `.env`, no versionado). El archivo `.env.example` documenta las claves requeridas sin valores reales.

| Variable | Requerida | Propósito |
|---|---|---|
| `DATABASE_URL` | Sí | Cadena de conexión a la base de datos PostgreSQL |
| `SESSION_SECRET` | Sí | Secreto de firma de los JWT de sesión (longitud mínima validada en runtime; la aplicación falla al iniciar si no cumple el mínimo — comportamiento fail-closed) |
| `GROQ_API_KEY` | No | Habilita el asistente Nova y el análisis de informes por IA. Sin esta variable, el sistema usa mensajes de respaldo |
| `GITHUB_TOKEN` | No | Autoriza el acceso al repositorio privado usado como almacenamiento de la base de conocimiento documental |
| `GITHUB_DOCS_REPO` | No | Identificador del repositorio privado donde se almacenan los documentos de la base de conocimiento |
| `ZOOM_ACCOUNT_ID` / `ZOOM_CLIENT_ID` / `ZOOM_CLIENT_SECRET` | No | Credenciales de integración Server-to-Server OAuth con Zoom para crear reuniones reales. Sin ellas se genera un enlace simulado |

Ninguna de estas variables debe versionarse con valores reales. `.env` y `.env.local` están excluidos del control de versiones.

## 6. Instalación local

```bash
git clone https://github.com/ajacome0494/nexo.git
cd nexo
npm install                 # instala dependencias y configura los git hooks del proyecto
cp .env.example .env        # completar con valores propios de un entorno de desarrollo
npx prisma generate         # genera el cliente Prisma
npx prisma migrate deploy   # aplica las migraciones existentes
npm run seed                # crea los usuarios iniciales de desarrollo
npm run dev                 # inicia el servidor de desarrollo
```

> Se recomienda generar un `SESSION_SECRET` propio con una herramienta criptográfica estándar (por ejemplo, un generador aleatorio de al menos 32 caracteres) en lugar de reutilizar valores de ejemplo.

## 7. Scripts y comandos disponibles

| Comando | Descripción |
|---|---|
| `npm run dev` | Servidor de desarrollo |
| `npm run build` | Aplica migraciones pendientes y genera el build de producción |
| `npm run start` | Sirve el build de producción (requiere `build` previo) |
| `npm run lint` | Ejecuta ESLint sobre el proyecto |
| `npm run seed` | Ejecuta `prisma/seed.ts` para crear datos iniciales |
| `npx prisma migrate dev --name <nombre>` | Crea y aplica una nueva migración en desarrollo |
| `npx prisma generate` | Regenera el cliente Prisma tras cambios en el schema |
| `npx prisma studio` | Explorador visual de la base de datos |

## 8. Base de datos

- **Motor**: PostgreSQL.
- **ORM**: Prisma 7, que en esta versión requiere un driver adapter explícito (`@prisma/adapter-pg`) — `new PrismaClient()` sin adapter falla en runtime. La inicialización centralizada está en `src/lib/prisma.ts`.
- **Tipos**: se importan desde `@/generated/prisma/client` (no desde `@/generated/prisma`).
- **Modelos principales** (ver `prisma/schema.prisma` para el detalle completo): `User`, `Task`, `TaskActivity`, `Comment`, `Notification`, `FollowUpReminder`, `MonthlyReport`, `MonthClosure`, `ImprovementIdea` (con `IdeaVote` e `IdeaStatusHistory`), `KnowledgeDocument` y `DocumentChunk`, `Meeting` y `MeetingInvitee`, `Announcement`, `SystemConfigHistory`, `DataSubjectRequest` (solicitudes de titulares de datos), `DataPurgeLog` (auditoría de depuración por política de retención), `LoginAttempt` (límite de intentos de login, persistido en base de datos).
- **Migraciones**: versionadas en `prisma/migrations/`, aplicadas automáticamente en el build de producción (`npm run build` ejecuta `prisma migrate deploy` antes de compilar).
- **Datos iniciales**: `prisma/seed.ts` crea un conjunto mínimo de usuarios de ejemplo para desarrollo local; no representa datos de producción.

## 9. Módulos o funcionalidades principales

| Módulo | Descripción |
|---|---|
| Inicio (Dashboard) | Resumen diario: tareas prioritarias, carga laboral, comunicados, próximas reuniones y un mensaje generado por IA |
| Trabajo (Tareas) | Gestión de tareas propias en vistas Kanban, Tabla y Gantt; tareas de tipo fija y de seguimiento (con registro de actividades por tiempo), importación/exportación en Excel, cierre y archivado mensual |
| Equipo | Visibilidad y asignación de tareas de subordinados, según la jerarquía de roles |
| Analytics / KPIs | Indicadores individuales y de equipo (cumplimiento, carga laboral, calidad), informes mensuales y por rango de fechas, con análisis narrativo generado por IA |
| Nova (Asistente IA) | Asistente conversacional con distintos modos (general, tareas, RRHH); en modo RRHH cita fuentes de la base de conocimiento documental interna |
| Reuniones | Creación de reuniones vía Zoom, gestión de invitados, enlace a notas de Otter.ai |
| Mejora Continua | Registro de ideas de mejora con votación, flujo de estados y adjuntos |
| Gestión de usuarios | Alta, edición, restablecimiento de acceso y baja de usuarios, restringido a roles con permisos de administración |
| Ajustes | Consentimiento de tratamiento de datos, configuración de parámetros de carga laboral (feriados y permisos incluidos en la base laboral), reglas de notificación por rol, motivos de actividad configurables por rol, calendario de feriados nacionales, registro de permisos médicos/personales (solo Administrador), mensaje de bienvenida del Dashboard, gestión de solicitudes de titulares de datos, política de retención/depuración, administración de la base de conocimiento (según rol) |
| Perfil | Datos personales del usuario autenticado y cambio de contraseña |

## 10. APIs, rutas o interfaces internas

Todas las rutas viven bajo `src/app/api/` como route handlers de Next.js. Son de uso interno del propio frontend, no una API pública, y cada una valida sesión y rol en el servidor antes de operar.

| Área | Recursos expuestos (resumen) |
|---|---|
| Autenticación | Inicio y cierre de sesión, usuario actual, cambio de contraseña, recuperación, registro de consentimiento |
| Usuarios | Listado, alta, edición, baja, restablecimiento de acceso y de consentimiento, preferencias de vista/tema |
| Tareas | CRUD de tareas, comentarios, registro de actividades, corrección, cierre mensual, importación/exportación |
| Equipo | Consulta de estructura y tareas de subordinados según jerarquía |
| KPIs / Informes | Indicadores propios y de equipo, generación de informes por mes o rango, histórico en repositorio de informes |
| Reuniones | CRUD de reuniones e invitados |
| Mejora Continua | CRUD de ideas, votos, historial de cambios de estado |
| Asistente (Nova) | Conversación del asistente, gestión de documentos de la base de conocimiento |
| Notificaciones y recordatorios | Listado, marcado como leído, recordatorios pendientes |
| Ajustes / Sistema | Configuración de carga laboral, política de retención y depuración, información del sistema, comunicados |
| Titulares de datos | Solicitudes de acceso/rectificación/eliminación, exportación de datos propios, gestión de estado (Administrador) |

No se documentan aquí rutas, parámetros ni payloads específicos por tratarse de detalles de implementación interna.

## 11. Autenticación y permisos

- **Sesión**: token JWT (HS256) almacenado en una cookie httpOnly. La verificación ocurre tanto en `src/proxy.ts` (a nivel de request) como en cada route handler (a nivel de recurso), mediante `getSession()` y las funciones de `src/lib/roles.ts`.
- **Jerarquía de roles**: definida en `src/lib/roles.ts`, con niveles numéricos que determinan qué usuarios puede ver, gestionar o notificar cada rol. Las notificaciones siempre fluyen hacia arriba en la jerarquía, nunca hacia abajo.
- **Permisos por función**: existen funciones dedicadas para determinar si un rol puede gestionar usuarios, crear reuniones, acceder a informes/analítica, revisar ideas de mejora continua o administrar la base de conocimiento documental. Ninguna verificación de permisos depende únicamente del cliente.
- **Contraseñas**: hasheadas con `bcryptjs`. Los usuarios nuevos reciben una contraseña temporal predefinida por el administrador que crea la cuenta, la cual debe cambiarse en el primer acceso.
- **Protecciones adicionales**: límite de intentos de inicio de sesión por IP (ventana temporal con bloqueo), validación de `Origin` en peticiones que mutan estado, redirección forzada a HTTPS en producción y cabeceras de seguridad (CSP, HSTS, `X-Frame-Options`, etc.) aplicadas globalmente.
- **Consentimiento de datos**: el modelo `User` registra si el usuario aceptó el tratamiento de datos personales y en qué momento; el flujo de consentimiento bloquea el resto de la aplicación hasta que se resuelve.

## 12. Estilos, templates y recursos estáticos

- **Sistema de estilos**: Tailwind CSS v4, con tokens de diseño propios (paleta, espaciados, tipografía) y soporte de modo claro/oscuro vía `next-themes`.
- **Componentes de interfaz**: biblioteca interna en `src/components/ui/` (botones, tarjetas, modales, badges, inputs) reutilizada por los componentes de cada módulo.
- **Recursos estáticos**: manuales de usuario en PDF (`public/manuales/`), librerías de terceros vendorizadas para generación de PDF en cliente (`public/vendor/`) y adjuntos subidos por usuarios (`public/uploads/`).
- **Generación de documentos**: informes exportables a PDF mediante `jspdf` y `html2canvas`, e importación/exportación de tareas en formato Excel mediante `xlsx`.

## 13. Pruebas y calidad

El proyecto cuenta con un framework de pruebas automatizadas basado en **Vitest** (compatible con TypeScript y con el App Router de Next.js), configurado en `vitest.config.ts`. Las pruebas viven en `src/__tests__/` (270+ pruebas) y cubren la mayor parte de `src/lib/`:

- **`src/lib/roles.ts`**: niveles jerárquicos de los 10 roles, visibilidad (`getVisibleRoles`) por rol, invisibilidad de `ADMINISTRADOR` y de `ASISTENTE_NOMINA` fuera de sus roles autorizados, y permisos de gestión de usuarios.
- **`src/lib/timeFormat.ts`**: conversión entre formato de horas HH.MM y horas decimales en ambos sentidos, y validación de minutos (0-59).
- **`src/lib/workload.ts`**: clasificación del semáforo de carga laboral por rango (Subutilización/Moderado/Óptimo/Carga elevada/Sobrecarga), cálculo de porcentaje con techo en 100% dentro de la zona óptima, y el caso de fin de semana (sin semáforo aplicable).
- **`src/lib/businessTime.ts`** y **`src/lib/dateRanges.ts`**: desplazamiento a la zona horaria de negocio (UTC-5) para determinar "hoy", rango real UTC de un día calendario, y límites de día/semana/mes.
- **`src/lib/utils.ts`**: formateo de fechas con getters UTC y la lógica de "tarea vencida" (el límite exacto en que una tarea pasa a estar overdue, respetando la zona horaria de negocio).
- **`src/lib/ideas.ts`**: máquina de estados de Mejora Continua (avanzar/retroceder/rechazar en el flujo de una idea).
- **`src/lib/navLinks.ts`**: navegación filtrada por rol y resolución del título de página.
- **`src/lib/mask-email.ts`** y **`src/lib/logger.ts`**: enmascarado de correos en respuestas de API y redacción de tokens de integraciones externas antes de llegar a los logs.
- **`src/lib/session-secret.ts`**: comportamiento fail-closed (la app no arranca sin un `SESSION_SECRET` de al menos 32 caracteres).
- **`src/lib/storage.ts`**: validación de tamaño/extensión y codificación base64 de adjuntos de ideas.
- **`src/lib/commentViews.ts`**, **`src/lib/rate-limit.ts`**, **`src/lib/systemConfig.ts`**, **`src/lib/retentionPolicy.ts`**: lógica de negocio (comentarios no leídos, límite de intentos de login, valor de configuración vigente por fecha, candidatos a depuración por política de retención), con `@/lib/prisma` mockeado explícitamente por test.
- **`GET/POST /api/users`**: 401/403 por sesión/rol, filtrado de visibilidad (`ADMINISTRADOR` sin filtro vs. el resto por `getVisibleRoles`), enmascarado de email en la respuesta, validación de campos requeridos, tope de rol asignable (no se puede crear un usuario con rol superior al del solicitante), email duplicado (409) y contraseña por defecto hasheada (nunca expuesta en texto plano).
- **`GET/POST /api/assistant/documents`**: 401/403, listado ordenado por fecha, y en la subida — límite de tamaño por header y por archivo, formulario inválido, archivo/título faltante, validación de extensión y mime type PDF, camino feliz (crear → subir a GitHub → procesar → 201), fallo de subida a GitHub (documento queda en estado `ERROR` pero responde 201) y error inesperado (500).
- **`GET/POST /api/tasks/close-month`**: 401/403, parseo de año/mes en query/body, preview de cierre (conteo por estado, `alreadyClosed`), mes ya cerrado (409), archivado de tareas candidatas con el resumen correcto, y duplicación de tareas recurrentes al mes siguiente con desplazamiento de fecha (incluyendo el recorte de día en meses más cortos, ej. 31 de enero → 28 de febrero).
- **`PATCH /api/ideas/[id]/status`**: 401/403/404, acción inválida, y las cuatro transiciones (`ADVANCE`/`RETREAT`/`REJECT`/`REOPEN`) con sus reglas — límites del flujo, motivo de rechazo obligatorio, reapertura solo desde `RECHAZADA`, limpieza del adjunto al salir de `PROPUESTA`, notificación al autor (omitida si el propio autor es quien revisa) y otorgamiento (sin duplicar) de la insignia "innovador" al llegar a `IMPLEMENTADA`.
- **Componentes de `src/components/ui/`** (con `@testing-library/react`, en `src/__tests__/components/`): `Badge` y `Button` (variantes, estado disabled, eventos), `Card`/`CardHeader`/`CardTitle`/`CardBody` (composición), `Modal`/`ModalHeader` (abierto/cerrado, variantes centro/drawer, cierre por overlay o botón) y `TimeInput24` (parseo y combinación de hora/minutos). También el hook `useHasMounted` y el componente `Sidebar` (navegación filtrada por rol vía `getNavLinks`, resaltado del enlace activo según la ruta, cierre del menú móvil), este último mockeando `usePathname` de `next/navigation`.

La base de datos configurada en `.env` es un entorno compartido con datos reales, por lo que las pruebas mockean `@/lib/prisma` y `@/lib/session` (ver `vitest.setup.ts`) en vez de conectarse a una base de datos real; cualquier uso no mockeado de `prisma` en un test falla explícitamente. Quedan fuera de cobertura, por ser integraciones externas de I/O (HTTP, embeddings, filesystem) con poco valor en pruebas unitarias: `embeddings.ts`, `githubDocuments.ts`, `zoom.ts`, `confetti.ts`, `pdfPolyfill.ts`, `session.ts` y `actions.ts`.

**Comandos**:

| Comando | Descripción |
|---|---|
| `npm run test` | Ejecuta la suite de pruebas en modo watch |
| `npm run test:ui` | Abre la interfaz visual de Vitest |
| `npm run test:coverage` | Ejecuta la suite con reporte de cobertura |

Adicionalmente, la calidad de código se apoya en:

- **ESLint** (`npm run lint`), con configuración basada en `eslint-config-next`.
- **TypeScript en modo estricto**, que actúa como primera línea de verificación de tipos.
- Validación manual end-to-end de los cambios antes de su despliegue.

Queda pendiente ampliar la cobertura a otros módulos de `src/lib/`, a componentes de UI (con `@testing-library/react`, ya instalado) y a pruebas end-to-end.

## 14. Despliegue

- **Plataforma**: Vercel, con build automatizado en cada push a la rama principal.
- **Proceso de build**: `npm run build` aplica las migraciones pendientes (`prisma migrate deploy`) antes de compilar la aplicación Next.js.
- **Consideración de entorno**: algunas dependencias con binarios nativos (extracción de texto de PDF, generación de embeddings) requieren configuración explícita de *file tracing* en `next.config.ts` para funcionar correctamente en el entorno serverless de despliegue, dado que su resolución de rutas difiere entre entornos de desarrollo y de producción.
- No se documentan aquí URLs, credenciales ni detalles de infraestructura del entorno productivo.

## 15. Seguridad y buenas prácticas

- Cada endpoint de API valida sesión y rol en el servidor, no solo en el cliente.
- La cookie de sesión es httpOnly y usa atributos restrictivos de envío entre sitios.
- El secreto de firma de sesión es fail-closed: la aplicación no arranca si la variable correspondiente falta o no cumple la longitud mínima requerida, evitando un valor por defecto inseguro.
- Límite de intentos de inicio de sesión por IP con bloqueo temporal, persistido en base de datos (`LoginAttempt`) para que el límite sea global entre instancias del despliegue, no por proceso.
- Cabeceras de seguridad HTTP activas de forma global (CSP, HSTS en producción, `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`).
- Verificación del header `Origin` en peticiones que mutan estado, como defensa adicional frente a ataques cross-site.
- Roles con visibilidad restringida: cada rol solo accede a los datos de las personas que la jerarquía le permite ver, validado en servidor.
- Se recomienda revisar periódicamente los mensajes de diagnóstico/log del servidor para evitar que se registren fragmentos de credenciales o tokens de integraciones externas, incluso de forma parcial.
- No se incluyen en este documento (ni deben incluirse en el futuro) URLs de producción, credenciales, tokens, claves o cualquier dato que facilite el acceso no autorizado al sistema.

## 16. Protección de datos personales según normativa de Ecuador (LOPDP)

### Datos personales identificados

| Categoría de dato | Dónde se origina | Modelo/almacenamiento |
|---|---|---|
| Identificación y contacto (nombre, correo electrónico) | Alta de usuario por administrador | `User` |
| Credencial de acceso (contraseña, hasheada) | Alta de usuario / cambio de contraseña | `User` |
| Cargo/rol dentro de la organización | Alta de usuario | `User` |
| Historial de sesión (último inicio de sesión) | Uso del sistema | `User` |
| Registro de consentimiento de tratamiento de datos | Aceptación explícita del usuario | `User` |
| Actividad laboral (tareas, horas registradas, comentarios) | Uso diario del sistema | `Task`, `TaskActivity`, `Comment` |
| Participación en reuniones (invitados, asistencia) | Programación de reuniones | `Meeting`, `MeetingInvitee` |
| Contenido conversacional con el asistente de IA | Interacción con Nova | Procesado por el proveedor de IA en tiempo de respuesta; el contexto de tareas del usuario se construye desde la base de datos para la consulta |
| Ideas propuestas y votos (asociados a un autor) | Módulo de mejora continua | `ImprovementIdea`, `IdeaVote`, `IdeaStatusHistory` |
| Documentos internos de RRHH (pueden contener datos de personal) | Carga manual por roles autorizados | Repositorio privado externo (GitHub) + fragmentos indexados (`KnowledgeDocument`, `DocumentChunk`) |
| **Permisos médicos y personales** (tipo, fecha, duración u observación) — **dato de salud cuando el tipo es médico** | Registro manual exclusivo del Administrador | `LeaveRecord` |
| **Estado especial de maternidad/lactancia** (fechas, base y límites de jornada configurados) — **dato de salud/condición personal** | Registro manual exclusivo del Administrador | `SpecialStatus` |

### Categoría especial de datos: salud (Art. 26 LOPDP)

Los permisos médicos y el estado de maternidad/lactancia son **datos de salud**, categoría especial bajo el Art. 26 de la Ley Orgánica de Protección de Datos Personales del Ecuador, que exige una base de legitimación reforzada y medidas de seguridad adicionales frente al resto de datos de RRHH. Ver el detalle completo en [`docs/RAT.md`](docs/RAT.md), sección 5.1, y los pendientes de validación legal en [`docs/PENDIENTES_LEGALES.md`](docs/PENDIENTES_LEGALES.md), sección 5.

En el producto, la visibilidad de estos datos está restringida técnicamente al propio titular y al Administrador: cualquier otro rol en la jerarquía (Coordinador ZS, Analista, Coordinador Nacional, Jefe Nacional) solo puede ver que existen horas de ausencia justificada, sin el tipo específico de permiso ni si hay un estado especial vigente (`redactSensitiveWorkloadDetail` en `src/lib/workload.ts`, aplicada en `GET /api/kpis/[userId]` cuando quien consulta no es el titular ni el Administrador).

### Forma de tratamiento

- Los datos de identificación, contacto y actividad laboral se almacenan de forma estructurada en la base de datos PostgreSQL de la aplicación.
- Las contraseñas se almacenan únicamente en forma hasheada (bcrypt), nunca en texto plano.
- El contenido de las conversaciones con el asistente Nova, así como el texto de los documentos de la base de conocimiento, se envía a un proveedor externo de IA (Groq) para su procesamiento en el momento de la consulta.
- Los documentos cargados a la base de conocimiento se almacenan en un repositorio privado de un proveedor externo (GitHub), y su contenido se fragmenta e indexa localmente mediante embeddings generados en el propio servidor.
- Las reuniones se coordinan a través de la API de Zoom, que recibe el título, la fecha/hora y la lista de invitados (correo/nombre) de la reunión creada.
- El acceso a los datos de otros usuarios está siempre acotado por la jerarquía de roles descrita en la sección 11.
- Los datos de salud (permisos médicos, maternidad/lactancia) están, además, acotados a un segundo nivel: solo el propio titular y el Administrador ven el detalle por tipo; el resto de la jerarquía ve únicamente el agregado genérico de horas de ausencia justificada (ver arriba).

### Finalidad del tratamiento

Gestionar internamente los recursos humanos de la organización: asignación y seguimiento de tareas, evaluación de desempeño mediante indicadores, coordinación de reuniones de trabajo, apoyo a la gestión de personal mediante un asistente de IA, y mejora continua de procesos internos.

### Riesgos identificados

- Envío de contenido potencialmente sensible (consultas de RRHH, contenido de documentos internos) a un proveedor externo de procesamiento de lenguaje (Groq) como parte del funcionamiento del asistente Nova.
- Almacenamiento de documentos internos de RRHH, que pueden contener datos de personal, en un repositorio de un proveedor externo (GitHub), fuera del perímetro directo de la base de datos de la aplicación.
- Transferencia de datos de invitados (nombre/correo) a la API de Zoom al programar reuniones.
- Dependencia de proveedores de infraestructura (Neon para la base de datos, Vercel para el hosting) que alojan la totalidad de los datos personales del sistema, sin acuerdos de encargado de tratamiento formalizados aún con ninguno de los cinco proveedores externos utilizados.
- Almacenamiento de datos de salud (permisos médicos, `LeaveRecord`) sin plazo de conservación definido ni base de legitimación diferenciada — categoría especial de datos que requiere evaluación legal específica (ver `docs/RAT.md`, secciones 3, 9 y 11).

### Estado de cumplimiento — mecanismos técnicos implementados

- ✅ **Consentimiento informado**: modal obligatorio en el primer inicio de sesión (`ConsentGate`, `PATCH /api/auth/consent`); mientras no se acepta, el resto de la aplicación no se renderiza ni se disparan llamadas a APIs de datos. Queda registrado `User.dataConsentAccepted` y `dataConsentAcceptedAt`.
- ✅ **Solicitudes de titulares** (acceso, rectificación, eliminación) desde `/profile` → "Mis derechos sobre mis datos" (`DataSubjectRequest`, `POST /api/data-requests`, descarga inmediata de datos propios vía `GET /api/data-requests/my-data`).
- ✅ **Cola de gestión de solicitudes** para el Administrador en `/settings`, con estado y trazabilidad de quién la resolvió y cuándo (`PATCH /api/data-requests/[id]`).
- ✅ **Política de retención y depuración configurable**: informes mensuales, tareas archivadas y documentos de la base de conocimiento, con vista previa + ejecución auditada (`DataPurgeLog`, `GET`/`POST /api/settings/retention-policy/purge`).
- ✅ **Rate limiting persistido en base de datos** (`LoginAttempt`), con limpieza automática de registros expirados (ver README, sección 15, y sección 19).
- ✅ **`safeLog`** (`src/lib/logger.ts`) como punto de paso obligatorio para los logs de integraciones externas, evitando que tokens/credenciales lleguen a los logs del servidor.
- ✅ **Registro de Actividades de Tratamiento (RAT)**: borrador técnico documentado en [`docs/RAT.md`](docs/RAT.md), a partir de la revisión del código y el esquema de datos.
- ✅ **Restricción de datos de salud a Administrador/titular**: el detalle de tipo de permiso (médico/personal/vacaciones) y de estado especial (maternidad/lactancia) solo es visible para el propio titular y el Administrador; el resto de la jerarquía ve un agregado genérico de "ausencia justificada" (`redactSensitiveWorkloadDetail`, `src/lib/workload.ts`).

### Pendiente — responsabilidad del área legal (no es un pendiente técnico)

- Formalizar acuerdos de encargado de tratamiento (o equivalentes) con los cinco proveedores externos que procesan datos personales de Nexo: **Groq** (IA), **GitHub** (almacenamiento documental), **Zoom** (videoconferencia), **Neon** (base de datos PostgreSQL gestionada) y **Vercel** (hosting/despliegue).
- Validación legal formal del cumplimiento LOPDP por asesoría jurídica especializada en protección de datos en Ecuador, incluyendo la evaluación de transferencias internacionales de datos (los cinco proveedores operan infraestructura fuera de Ecuador) y de que el flujo de eliminación de cuenta (gestión manual del Administrador tras la solicitud) cumple los plazos y garantías exigidos por la ley.
- Completar los campos pendientes de `docs/RAT.md` (razón social, RUC, delegado de protección de datos, etc.) con información que solo el área legal/administrativa de la organización posee.
- Definir la base de legitimación y el plazo de conservación de los permisos médicos y personales (`LeaveRecord`), dado que incluyen datos de salud — categoría especial sin cobertura aún en la política de retención (ver `docs/RAT.md`, secciones 3 y 9).
- Validación legal urgente de la categoría especial de datos de salud (permisos médicos, maternidad/lactancia) conforme al Art. 26 LOPDP, incluyendo si la base de consentimiento actual es suficiente y si es necesario minimizar el dato almacenado (ver `docs/PENDIENTES_LEGALES.md`, sección 5).

Este análisis es de carácter técnico y funcional, basado en la revisión del código y modelos de datos del repositorio. No constituye una conclusión legal definitiva.

### Mensaje tentativo para informar al usuario

> "Nexo trata tus datos personales (identificación, actividad laboral y, cuando corresponde, tus interacciones con el asistente Nova) con la finalidad de gestionar los procesos internos de recursos humanos de la organización. Parte de esta información puede ser procesada por proveedores externos que dan soporte a funcionalidades específicas del sistema (asistente de inteligencia artificial, almacenamiento de documentos y coordinación de reuniones). Puedes ejercer tus derechos como titular de datos personales conforme a la normativa aplicable contactando al área administradora del sistema."

## 17. Convenciones de desarrollo

- **TypeScript**: modo estricto habilitado; se prefiere `type` sobre `interface` para formas de objetos.
- **Tipos co-ubicados**: los tipos se co-ubican con el módulo que los define; se extraen a una carpeta compartida solo si se reutilizan en tres o más archivos.
- **Prisma 7**: siempre inicializar `PrismaClient` con el driver adapter de PostgreSQL; nunca instanciarlo sin adapter. Importar tipos desde el cliente generado, no desde el paquete raíz.
- **Validación de permisos**: toda regla de visibilidad o acceso debe validarse en el servidor (route handler), no solo en el componente de cliente.
- **Variables de entorno**: nunca versionar `.env` ni `.env.local`; usar `.env.example` como referencia de las claves requeridas.
- **Nomenclatura de commits**: se sigue el formato `tipo(alcance): asunto` (por ejemplo, `feat`, `fix`, `chore`, `docs`), documentado también de forma automática en la sección de Changelog de este archivo.

## 18. Estado del proyecto

Proyecto en desarrollo activo. Los módulos de Tareas, Equipo, KPIs/Analytics, Nova (asistente IA), Reuniones, Mejora Continua, Gestión de Usuarios y Ajustes están implementados y en uso. Framework de pruebas automatizadas (Vitest) configurado, con cobertura inicial de las reglas de visibilidad/permisos por rol, formateo de horas, semáforo de carga laboral y control de acceso de endpoints críticos (ver sección 13); la validación end-to-end de cambios sigue siendo manual.

## 19. Recomendaciones para próximos mantenimientos

**Los elementos técnicos han sido implementados. Los puntos restantes son de gestión legal y administrativa externa.**

- Formalizar acuerdos de encargado de tratamiento con proveedores externos (Groq, GitHub, Zoom, Neon, Vercel) — responsabilidad del área legal.
- Validar formalmente el cumplimiento LOPDP con asesoría jurídica especializada.
- Definir base de legitimación y plazo de conservación para los permisos médicos y personales (`LeaveRecord`) — dato de salud sin política de retención técnica aún (área legal + posterior implementación técnica).

## Changelog

_Se actualiza automáticamente en cada commit vía el hook `.githooks/post-commit` (configurado por `npm install`, ver `scripts/setup-git-hooks.js`). Cada línea nueva se agrega arriba, con la fecha y el asunto del commit. Los commits `chore:` y `docs:` se omiten por ser mantenimiento, no cambios de producto._

- 2026-07-24: test(dashboard): mockea prisma.project para la nueva query de myProjects
- 2026-07-24: feat(ux): ayuda contextual liviana y búsquedas recientes (Sprint C fase 5)
- 2026-07-24: refactor(ux): dashboard más completo y jerarquía visual (Sprint C fase 4)
- 2026-07-24: refactor(ux): unifica experiencia de error y éxito, agrega reintentar (Sprint C fase 3)
- 2026-07-24: refactor(ux): unifica navegación de "volver" y afordancia de cambio de estado en Kanban (Sprint C fase 2)
- 2026-07-24: refactor(ux): reduce clics en flujos de alta frecuencia (Sprint C fase 1)
- 2026-07-24: refactor(ui): unifica modales e iconografía en módulos de alto tráfico (Sprint B fase 5)
- 2026-07-24: refactor(ui): reemplaza feedback inline por sistema de toasts unificado (Sprint B fase 4)
- 2026-07-24: refactor(ui): unifica tablas, loading states y empty states en módulos de alto tráfico (Sprint B fase 3)
- 2026-07-24: refactor(ui): unifica chips de prioridad y estado con PriorityChip/StatusChip (Sprint B fase 2)
- 2026-07-24: refactor(ui): unifica botones en módulos de alto tráfico con <Button> (Sprint B fase 1)
- 2026-07-24: feat(design-system): primitivos UI compartidos (Sprint B fase 0)
- 2026-07-23: feat(analytics): capa de explicabilidad sobre el Analytics Engine (Sprint A)
- 2026-07-23: feat(desk): lectura automática, respuestas cortas y pipeline nota→recordatorio→tarea
- 2026-07-23: feat(desk-reminders): permite reabrir recordatorios completados
- 2026-07-23: feat(desk): evoluciona Escritorio Digital a centro personal de trabajo
- 2026-07-23: feat(desk-notes): agrega el módulo Escritorio Digital
- 2026-07-23: feat(projects): Sprint 2.1 — refinamiento UX/UI del módulo Proyectos
- 2026-07-23: feat(recovery-center): agrega el Centro de Recuperación (papelera/restauración corporativa)
- 2026-07-23: feat(projects): agrega el módulo Proyectos como dominio independiente de Trabajo
- 2026-07-22: feat(docs): sistema oficial de documentación, bitácora y auditoría de Nexo
- 2026-07-22: feat(tasks): unifica el registro de actividades entre tareas Fijas y Seguimiento
- 2026-07-22: test(kpis): verifica que Coordinador Nacional conserva su Analytics personal
- 2026-07-22: fix(analytics): elimina la pestaña "Mi actividad" para roles de dirección
- 2026-07-22: fix(dashboard): oculta carga laboral personal a roles de dirección en Home
- 2026-07-22: feat(analytics): Sprint 0A — corrige el modelo de Analytics según jerarquía organizacional
- 2026-07-21: test(kpis-executive): corrige 2 aserciones desactualizadas respecto a las reglas de negocio actuales
- 2026-07-21: fix(analytics): extrae computeCompletedPctAny para consolidar la Definición A de cumplimiento
- 2026-07-21: fix(analytics): consolida helpers de presentación duplicados en analyticsExplain.ts
- 2026-07-21: fix(analytics): riskAlerts.ts reutiliza countBusinessDays (holiday-aware) para el gap de inactividad
- 2026-07-21: fix(analytics): computeMonthlyCompliancePace reutiliza computeMonthlyHistory en vez de recalcular
- 2026-07-21: fix(analytics): extrae weightedPoints para eliminar la aritmética de ponderación duplicada 4 veces
- 2026-07-21: fix(analytics): extrae classifyPerformanceScore para eliminar la clasificación duplicada en kpis/executive
- 2026-07-21: fix(analytics): unifica el input de computeSimpleScore entre executive/reports y kpis/me
- 2026-07-21: fix(analytics): alinea el umbral de tareas vencidas de computeRiskAlerts con Ajustes
- 2026-07-21: fix(dashboard): reutiliza el Analytics Engine en vez de recalcular carga/cumplimiento/alertas de equipo
- 2026-07-21: perf(analytics): invalidación granular del caché por usuario
- 2026-07-21: fix(analytics): Comprometido/Capacidad Disponible no reaccionaba al Tiempo Objetivo validado
- 2026-07-21: feat(tasks): Sprint 6 — evolución de Horas Estimadas a Tiempo Objetivo
- 2026-07-21: feat(analytics): Sprint 6.5 — Explicabilidad, Transparencia y Confianza
- 2026-07-20: feat(analytics): Analytics Engine v1.5 — Consistencia corregida y Motor de Benchmarks Inteligente (Sprint 7)
- 2026-07-20: feat(analytics): Sprint 6 — Decision Intelligence Engine
- 2026-07-20: feat(analytics): Sprint 5 — Performance Score, NormalizationEngine y motor v1.3
- 2026-07-20: feat(analytics): correcciones P0, UX ejecutiva, recomendaciones deterministas y arquitectura del motor
- 2026-07-20: feat(analytics): motor centralizado determinista - salud laboral, riesgo operativo, alertas, tendencias, predicciones
- 2026-07-20: feat(analytics): capacidad proyectada con simulador, cumplimiento por prioridad y Nova con 4 secciones
- 2026-07-20: feat(analytics): balance de carga, capacidad disponible, cumplimiento por prioridad y motor de recomendaciones Nova
- 2026-07-18: feat(analytics): dashboard ejecutivo ampliado, insights de Nova con IA, alertas de riesgo
- 2026-07-18: test(assistant): cubrir POST /api/assistant/chat
- 2026-07-18: fix(kpis): etiquetas y alturas del gráfico de días laborables
- 2026-07-18: feat(kpis,nav): gráfico mensual deslizable, oculta Trabajo y dashboard ejecutivo para Jefe Nacional
- 2026-07-18: fix(consent): mantener checkbox y botones visibles fuera del área con scroll
- 2026-07-18: feat(compliance): cubrir maternidad, permisos médicos y vacaciones en protección de datos
- 2026-07-18: fix(kpis): rangos, gráficos y % de carga correctos para usuarios con estado especial activo
- 2026-07-18: feat(kpis,settings): límites del estado especial de maternidad/lactancia configurables por registro
- 2026-07-18: feat(settings,kpis): acordeones colapsables en Ajustes y estado especial de maternidad/lactancia
- 2026-07-17: test(api): cubrir las rutas de ajustes sin pruebas (notificaciones, motivos, feriados, fecha de inicio KPI, bienvenida)
- 2026-07-17: feat(activities): colores de iconos, horario en la lista y validador de solapamiento
- 2026-07-17: feat(settings,kpis): deseleccionar notificaciones, archivo de motivos, permisos por rango, ajuste de KPI por usuario
- 2026-07-17: feat(settings): notificaciones configurables, motivos dinámicos, feriados, permisos y mensaje de bienvenida
- 2026-07-16: fix(tasks): usar ícono de triángulo de alerta real para registro retroactivo
- 2026-07-16: feat(activities): registro retroactivo, edición por Administrador y comentarios bidireccionales
- 2026-07-16: fix(reminders): botones de posponer no hacían nada por un stale closure
- 2026-07-16: feat(compliance): limpieza de LoginAttempt expirados y ampliar cobertura de pruebas
- 2026-07-16: feat(activities): preferencia de formato de registro (duración vs. hora inicio/fin)
- 2026-07-15: test(api): cubrir informes consolidados (reports) y repositorio de archivados
- 2026-07-15: test(api): cubrir dashboard, mensaje de Nova, insignias y borrado de documentos
- 2026-07-15: test(api): cubrir rutas de ajustes del sistema (retencion, purga, workload)
- 2026-07-15: test(api): cubrir equipo, solicitudes de titulares de datos y comunicados
- 2026-07-15: test(api): cubrir reuniones, notificaciones y recordatorios
- 2026-07-15: test(api): cubrir rutas de KPIs (individual, equipo, rango de meses)
- 2026-07-15: test(api): cubrir rutas de ideas (listado, detalle, historial, votos)
- 2026-07-15: test(api): cubrir CRUD de tareas, actividades, comentarios, correccion e import/plantilla
- 2026-07-15: test(api): cubrir rutas de auth y gestion individual de usuarios
- 2026-07-15: test: cubrir la logica de negocio de los endpoints de API, no solo 401/403
- 2026-07-15: test: agregar pruebas de componentes con @testing-library/react
- 2026-07-15: test: ampliar cobertura de pruebas a los modulos restantes de src/lib
- 2026-07-15: test: implementar framework de pruebas automatizadas con Vitest
- 2026-07-15: feat(compliance): solicitudes de titulares, retención de datos, rate limiting persistente y logs sanitizados
- 2026-07-14: feat(tasks): nuevo formulario de actividad por horas/minutos en tareas SEGUIMIENTO
- 2026-07-13: feat(kanban): mostrar tarjetas en grid de 2 columnas dentro de cada columna Kanban
- 2026-07-13: fix(kpis): fecha de generación de informes, PDF sin autoprint y Analytics responsive
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
