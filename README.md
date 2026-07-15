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
| Ajustes | Consentimiento de tratamiento de datos, configuración de parámetros de carga laboral, gestión de solicitudes de titulares de datos, política de retención/depuración, administración de la base de conocimiento (según rol) |
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

No identificado en el repositorio un framework de pruebas automatizadas (unitarias, de integración o end-to-end) configurado. La calidad de código se apoya en:

- **ESLint** (`npm run lint`), con configuración basada en `eslint-config-next`.
- **TypeScript en modo estricto**, que actúa como primera línea de verificación de tipos.
- Validación manual end-to-end de los cambios antes de su despliegue.

Se recomienda incorporar un framework de pruebas automatizadas (ver sección 19) como parte de la evolución del proyecto.

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

### Forma de tratamiento

- Los datos de identificación, contacto y actividad laboral se almacenan de forma estructurada en la base de datos PostgreSQL de la aplicación.
- Las contraseñas se almacenan únicamente en forma hasheada (bcrypt), nunca en texto plano.
- El contenido de las conversaciones con el asistente Nova, así como el texto de los documentos de la base de conocimiento, se envía a un proveedor externo de IA (Groq) para su procesamiento en el momento de la consulta.
- Los documentos cargados a la base de conocimiento se almacenan en un repositorio privado de un proveedor externo (GitHub), y su contenido se fragmenta e indexa localmente mediante embeddings generados en el propio servidor.
- Las reuniones se coordinan a través de la API de Zoom, que recibe el título, la fecha/hora y la lista de invitados (correo/nombre) de la reunión creada.
- El acceso a los datos de otros usuarios está siempre acotado por la jerarquía de roles descrita en la sección 11.

### Finalidad del tratamiento

Gestionar internamente los recursos humanos de la organización: asignación y seguimiento de tareas, evaluación de desempeño mediante indicadores, coordinación de reuniones de trabajo, apoyo a la gestión de personal mediante un asistente de IA, y mejora continua de procesos internos.

### Riesgos identificados

- Envío de contenido potencialmente sensible (consultas de RRHH, contenido de documentos internos) a un proveedor externo de procesamiento de lenguaje (Groq) como parte del funcionamiento del asistente Nova.
- Almacenamiento de documentos internos de RRHH, que pueden contener datos de personal, en un repositorio de un proveedor externo (GitHub), fuera del perímetro directo de la base de datos de la aplicación.
- Transferencia de datos de invitados (nombre/correo) a la API de Zoom al programar reuniones.
- Ausencia de un framework de pruebas automatizadas (sección 13) que valide de forma continua las reglas de visibilidad por rol, lo que aumenta el riesgo de regresiones de control de acceso no detectadas.

### Recomendaciones de cumplimiento

- Formalizar y mantener actualizado un registro de actividades de tratamiento (RAT) que documente estas categorías de datos, sus finalidades y los proveedores externos involucrados.
- Evaluar la existencia de acuerdos de encargado de tratamiento (o equivalentes) con los proveedores externos utilizados (proveedor de IA, proveedor de repositorio documental, proveedor de videoconferencia), acordes a la LOPDP.
- Nexo cuenta con un mecanismo en producto para solicitudes de titulares (acceso, rectificación, eliminación) desde `/profile`, con cola de gestión y trazabilidad para el Administrador en `/settings`, y con una política de retención/depuración configurable para informes mensuales, tareas archivadas y documentos de la base de conocimiento (ver `DataSubjectRequest`, `DataPurgeLog` y la política de retención en `prisma/schema.prisma`). Se recomienda que legal valide que el flujo de eliminación de cuenta (gestión manual del Administrador tras la solicitud) cumple los plazos y garantías exigidos por la LOPDP.
- Este análisis es de carácter técnico y funcional, basado en la revisión del código y modelos de datos del repositorio. No constituye una conclusión legal definitiva; se recomienda una validación formal por parte de asesoría legal especializada en protección de datos en Ecuador.

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

Proyecto en desarrollo activo. Los módulos de Tareas, Equipo, KPIs/Analytics, Nova (asistente IA), Reuniones, Mejora Continua, Gestión de Usuarios y Ajustes están implementados y en uso. No identificado en el repositorio un framework de pruebas automatizadas configurado; la validación de cambios es manual.

## 19. Recomendaciones para próximos mantenimientos

- Incorporar un framework de pruebas automatizadas (unitarias e integración), priorizando la cobertura de las reglas de visibilidad y control de acceso por rol descritas en `src/lib/roles.ts`, dado su impacto directo en la protección de datos personales.
- Mantener `src/lib/logger.ts` (`safeLog`) como punto de paso obligatorio para los logs de integraciones externas nuevas, y ampliar sus patrones de redacción si se incorporan proveedores con otros formatos de token.
- Formalizar el registro de actividades de tratamiento de datos personales y evaluar la necesidad de acuerdos de encargado de tratamiento con los proveedores externos utilizados (ver sección 16).
- Revisar periódicamente los resultados de la depuración programada (`DataPurgeLog`) y ajustar los valores por defecto de la política de retención si la operación de la organización lo requiere.
- Mantener actualizada la documentación de variables de entorno (`.env.example`) cada vez que se incorpore una nueva integración externa.
- Evaluar limpieza periódica de la tabla `LoginAttempt` (registros de intentos de login ya expirados) si su volumen crece de forma relevante.

## Changelog

_Se actualiza automáticamente en cada commit vía el hook `.githooks/post-commit` (configurado por `npm install`, ver `scripts/setup-git-hooks.js`). Cada línea nueva se agrega arriba, con la fecha y el asunto del commit. Los commits `chore:` y `docs:` se omiten por ser mantenimiento, no cambios de producto._

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
