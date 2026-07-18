# Registro de Actividades de Tratamiento (RAT) — Nexo

> **Estado: borrador técnico.** Este documento fue generado a partir de la revisión del código fuente, el esquema de base de datos (`prisma/schema.prisma`) y la configuración del repositorio de Nexo. Describe con precisión **qué hace el sistema hoy**, no constituye una conclusión legal ni sustituye la validación formal exigida por la Ley Orgánica de Protección de Datos Personales (LOPDP) de Ecuador. Los campos marcados como `[Completar: ...]` requieren información que solo el área legal/administrativa de la organización puede proporcionar. Ver también README, sección 16.

> **Este documento es un borrador técnico. Los campos marcados como PENDIENTE deben ser completados y validados por el área legal de la organización antes de su uso formal como Registro de Actividades de Tratamiento conforme a la LOPDP Ecuador.**

## 1. Responsable del tratamiento

| Campo | Valor |
|---|---|
| Razón social | PENDIENTE- EVALUAR DESIGNACION SEGUN EL ART 44. LOPDP |
| RUC | [PENDIENTE — completar con datos legales de la organización responsable del tratamiento] |
| Domicilio | `[Completar]` |
| Delegado de Protección de Datos (si aplica) | [PENDIENTE — evaluar designación según Art. 44 LOPDP] |
| Contacto para ejercicio de derechos | `[Completar: correo/canal formal]`. En el producto, el punto de entrada técnico es `/profile` → "Mis derechos sobre mis datos" (ver sección 8). |

## 2. Finalidad del tratamiento

Gestionar internamente los recursos humanos de la organización: asignación y seguimiento de tareas, evaluación de desempeño mediante indicadores (KPIs), coordinación de reuniones de trabajo, apoyo a la gestión de personal mediante un asistente de inteligencia artificial ("Nova"), y mejora continua de procesos internos.

## 3. Base de legitimación

> **Borrador — pendiente de confirmación legal.** El texto siguiente es una propuesta técnica razonable a partir del uso observado del sistema, no una determinación jurídica. Debe ser confirmada, ajustada o reemplazada por el área legal antes de tratarse como definitiva.

El tratamiento se apoya en más de una base de legitimación según el tipo de dato y finalidad, distinción habitual en sistemas de RRHH:

- **Ejecución de la relación laboral y cumplimiento de obligaciones legales del empleador**: es la base principal para los datos estrictamente necesarios para gestionar la relación de trabajo — identificación, cargo/rol, asignación y seguimiento de tareas, registro de horas, coordinación de reuniones. Esta información se trata como consecuencia directa del vínculo laboral, no depende del consentimiento del titular.
- **Interés legítimo del responsable**: aplica a funcionalidades de apoyo a la gestión que exceden el mínimo legal, como la analítica de desempeño (KPIs), el módulo de mejora continua y el asistente de IA (Nova). En estos casos correspondería documentar una prueba de ponderación (*balancing test*) que confirme que el interés de la organización no prevalece de forma desproporcionada sobre los derechos de las personas usuarias.
- **Consentimiento informado**: Nexo implementa un mecanismo de aceptación explícita y obligatoria en el primer inicio de sesión (`ConsentGate`, ver sección 8 y README §16). Se documenta aquí como mecanismo de transparencia y trazabilidad, **no como la base de legitimación principal del tratamiento nuclear de RRHH** — en una relación laboral, el consentimiento de la persona empleada frente a su empleador suele considerarse jurídicamente débil como base única (desequilibrio de poder entre las partes), por lo que no debería sustituir a las dos bases anteriores para las finalidades esenciales del sistema. Su rol más sólido es respaldar tratamientos claramente accesorios (p. ej., uso opcional del asistente de IA), si el área legal así lo determina.

`[Completar: el área legal debe confirmar esta triple base, ajustarla a la LOPDP y, si corresponde, formalizar la prueba de ponderación del interés legítimo]`.

> **Nota sobre datos de salud (2026-07-17):** el registro de permisos médicos (`LeaveRecord`, tipo `MEDICO`) introduce una **categoría especial de datos personales** (dato de salud) bajo la LOPDP, que normalmente exige una base de legitimación diferenciada y más estricta que la relación laboral general — no basta con "ejecución de la relación laboral" ni con "interés legítimo" sin más. `[Completar: el área legal debe determinar la base de legitimación aplicable a los permisos médicos — p. ej. cumplimiento de una obligación legal del empleador en materia laboral/seguridad social, o consentimiento explícito diferenciado — y si corresponde alguna medida de seguridad adicional específica para esta categoría]`.

## 4. Categorías de titulares de los datos

Personas colaboradoras de la organización con cuenta de usuario en Nexo (todos los roles definidos en `src/lib/roles.ts`: Jefe Nacional, Coordinador Nacional, Coordinador ZS, Analista de Clima y Cultura, Analista de Selección, Asistentes de Selección/Gestión Humana/GH ZS, Trabajo Social, Asistente de Nómina, Administrador).

## 5. Categorías de datos personales tratados

| Categoría de dato | Dónde se origina | Modelo/almacenamiento |
|---|---|---|
| Identificación y contacto (nombre, correo electrónico) | Alta de usuario por administrador | `User` |
| Credencial de acceso (contraseña, hasheada con bcrypt) | Alta de usuario / cambio de contraseña | `User` |
| Cargo/rol dentro de la organización | Alta de usuario | `User` |
| Historial de sesión (último inicio de sesión) | Uso del sistema | `User` |
| Registro de consentimiento de tratamiento de datos (aceptación y fecha) | Aceptación explícita en el primer inicio de sesión | `User.dataConsentAccepted`, `User.dataConsentAcceptedAt` |
| Actividad laboral (tareas, horas registradas, comentarios) | Uso diario del sistema | `Task`, `TaskActivity`, `Comment` |
| Participación en reuniones (invitados, asistencia) | Programación de reuniones | `Meeting`, `MeetingInvitee` |
| Contenido conversacional con el asistente de IA | Interacción con Nova | Procesado por el proveedor de IA (Groq) en tiempo de respuesta; el contexto de tareas del usuario se construye desde la base de datos para la consulta |
| Ideas propuestas y votos (asociados a un autor) | Módulo de mejora continua | `ImprovementIdea`, `IdeaVote`, `IdeaStatusHistory` |
| Documentos internos de RRHH (pueden contener datos de personal) | Carga manual por roles autorizados | Repositorio privado externo (GitHub) + fragmentos indexados (`KnowledgeDocument`, `DocumentChunk`) |
| Solicitudes de ejercicio de derechos (acceso, rectificación, eliminación) | Ejercicio de derechos por el titular desde `/profile` | `DataSubjectRequest` |
| Intentos de inicio de sesión por IP (para limitar fuerza bruta) | Uso del sistema | `LoginAttempt` |
| Auditoría de depuraciones ejecutadas (qué se eliminó, cuándo y por quién) | Ejecución de la política de retención por el Administrador | `DataPurgeLog` |
| **Permisos médicos y personales** (tipo, fecha, duración u observación) — **dato de salud cuando el tipo es `MEDICO`** | Registro manual exclusivo del Administrador, no autoservicio del titular | `LeaveRecord` |
| **Estado especial de maternidad/lactancia** (tipo, fecha de inicio/fin, base y límites de jornada configurados) — **dato de salud/condición personal** | Registro manual exclusivo del Administrador, no autoservicio del titular | `SpecialStatus` |

### 5.1 Categorías especiales de datos (Art. 26 LOPDP)

Los tres tipos de dato que introduce el módulo de ausencias/estado especial (`LeaveRecord`, `SpecialStatus`) se detallan aparte porque, a diferencia del resto de la sección 5, incluyen datos de salud y de condición personal — categoría especial bajo el Art. 26 LOPDP, que exige base de legitimación reforzada.

| Categoría de dato | Finalidad | Base legal | Responsable del registro | Destinatarios | Retención |
|---|---|---|---|---|---|
| Permisos médicos | Ajuste de la base laboral para el cálculo correcto de KPIs | Consentimiento explícito del titular + obligación legal laboral | Administrador del sistema | Solo Administrador y sistema de KPIs | Según política configurada en el sistema `[Completar: hoy sin plazo definido — ver sección 9]` |
| Maternidad/lactancia | Ajuste de jornada laboral reducida en KPIs conforme a la legislación laboral ecuatoriana | Obligación legal (Código de Trabajo Ecuador, Art. 153 y siguientes) + consentimiento | Administrador del sistema | Solo Administrador y sistema de KPIs | Durante el período activo + tiempo de retención configurado `[Completar: ver sección 9]` |
| Vacaciones y permisos personales | Ajuste de la base laboral para el cálculo correcto de KPIs | Relación contractual laboral + consentimiento informado | Administrador del sistema | Solo Administrador y sistema de KPIs | Según política configurada en el sistema `[Completar: ver sección 9]` |

> **Nota especial:** los datos de salud (permisos médicos, maternidad y lactancia) constituyen una categoría especial de datos conforme al Art. 26 LOPDP. Su tratamiento requiere base legal reforzada y medidas de seguridad adicionales. Se recomienda validación legal específica para esta categoría antes del uso formal del sistema. Ver también `docs/PENDIENTES_LEGALES.md`, sección 5.
>
> Desde 2026-07-18, la visibilidad de estos datos en la aplicación está técnicamente restringida al propio titular y al Administrador: superiores en la jerarquía (Coordinador ZS, Analista, Coordinador Nacional, Jefe Nacional) ven, como máximo, que existen horas de ausencia justificada, sin el tipo específico de permiso ni el estado especial (ver `redactSensitiveWorkloadDetail` en `src/lib/workload.ts`, consumida por `GET /api/kpis/[userId]`; README §16, sección "Estado de cumplimiento").

## 6. Categorías de destinatarios / encargados de tratamiento (proveedores externos)

| Proveedor | Rol | Datos que recibe |
|---|---|---|
| Groq | Procesamiento de lenguaje natural para el asistente Nova y el análisis automático de informes | Contenido de las consultas al asistente y, cuando corresponde, texto de documentos de la base de conocimiento |
| GitHub | Almacenamiento del repositorio privado de documentos de la base de conocimiento de RRHH | Documentos cargados a la base de conocimiento (pueden contener datos de personal) |
| Zoom | Coordinación de reuniones (API Server-to-Server OAuth) | Título, fecha/hora y lista de invitados (nombre/correo) de las reuniones creadas |
| Neon | Alojamiento de la base de datos PostgreSQL gestionada donde reside toda la información estructurada del sistema | La totalidad de los datos personales listados en la sección 5 |
| Vercel | Hosting y despliegue de la aplicación (incluye la ejecución de las funciones serverless que procesan cada solicitud) | Todo el tráfico de la aplicación en tránsito |

**Los acuerdos de encargado de tratamiento (o equivalentes) con estos cinco proveedores, así como la evaluación de transferencias internacionales de datos que su uso implica, son responsabilidad del área legal de la organización — no son un pendiente técnico del sistema.** El sistema no puede formalizar por sí mismo estos acuerdos contractuales.

## 7. Transferencias internacionales de datos

Los cinco proveedores listados en la sección 6 operan infraestructura fuera de Ecuador. `[Completar: el área legal debe evaluar si esto constituye una transferencia internacional de datos personales bajo la LOPDP y, de ser así, qué garantías adicionales aplican]`.

## 8. Ejercicio de derechos de los titulares

Nexo cuenta con un mecanismo en producto para que cualquier usuario ejerza sus derechos:

- **Solicitud**: desde `/profile` → "Mis derechos sobre mis datos", el usuario puede solicitar acceso a sus datos (descarga inmediata en JSON vía `GET /api/data-requests/my-data`), rectificación o eliminación de cuenta (`POST /api/data-requests`, tipos `ACCESO` / `RECTIFICACION` / `ELIMINACION`).
- **Gestión**: toda solicitud de rectificación o eliminación queda en una cola visible para el Administrador en `/settings`, con estado (`PENDIENTE` / `EN_PROCESO` / `RESUELTA`) y trazabilidad de quién la resolvió y cuándo (`DataSubjectRequest`, `PATCH /api/data-requests/[id]`).
- **Resolución**: la eliminación de cuenta se gestiona manualmente por el Administrador tras recibir la solicitud; no hay borrado automático inmediato. `[Completar: el área legal debe validar que este flujo cumple los plazos y garantías exigidos por la LOPDP]`.

## 9. Plazos de conservación

Configurables por el Administrador en `/settings` → "Política de retención de datos" (`SystemConfigHistory`, `src/lib/retentionPolicy.ts`), con historial de cambios:

| Categoría | Opciones disponibles | Acción al superar el plazo |
|---|---|---|
| Informes mensuales consolidados | 6 / 12 / 24 / 36 meses | Eliminación mediante depuración manual auditada |
| Tareas archivadas (tras cierre de mes) | 6 / 12 / 24 / 36 meses | Eliminación mediante depuración manual auditada |
| Documentos de la base de conocimiento | 12 / 24 / 36 meses / indefinido | Eliminación (BD + repositorio GitHub) mediante depuración manual auditada |
| Intentos de inicio de sesión (`LoginAttempt`) ya no bloqueantes | 30 días desde el último intento (fijo, no configurable) | Limpieza automática (~1 de cada 100 inicios de sesión) o bajo demanda desde `/settings` |

La depuración de informes/tareas/documentos no es automática: el Administrador revisa una vista previa de lo que se eliminaría (`GET /api/settings/retention-policy/purge`) y confirma explícitamente la ejecución (`POST .../purge`), que queda registrada en `DataPurgeLog` con quién la ejecutó y cuántos registros de cada tipo se eliminaron.

> **Pendiente (2026-07-17):** los permisos médicos y personales (`LeaveRecord`) **no tienen plazo de conservación definido ni mecanismo de depuración** — se conservan indefinidamente una vez creados, sin opción de eliminación salvo borrado manual individual por el Administrador desde `/settings`. Al tratarse de datos de salud en el caso `MEDICO`, esto es un vacío a resolver: `[Completar: el área legal debe definir el plazo de conservación aplicable a los registros de permisos, y si corresponde, se debe extender la política de retención/depuración técnica para cubrir este modelo]`.

## 10. Medidas de seguridad técnicas y organizativas

- Contraseñas almacenadas únicamente en forma hasheada (`bcrypt`, 10 rondas), nunca en texto plano.
- Sesión mediante JWT firmado (HS256), en cookie `httpOnly` con atributos restrictivos de envío entre sitios; el secreto de firma es *fail-closed* (la aplicación no arranca si no cumple la longitud mínima).
- Límite de intentos de inicio de sesión por IP con bloqueo temporal, persistido en base de datos (`LoginAttempt`) para que el límite sea global entre instancias del despliegue.
- Control de acceso por jerarquía de roles validado en el servidor en cada endpoint (`src/lib/roles.ts`), no solo en el cliente.
- Cabeceras de seguridad HTTP activas de forma global (CSP, HSTS en producción, `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`).
- Verificación del header `Origin` en peticiones que mutan estado, como defensa adicional frente a ataques cross-site.
- Redacción automática de tokens de integraciones externas en los logs del servidor (`src/lib/logger.ts`, `safeLog`), para que no se registren credenciales ni siquiera parcialmente.
- Framework de pruebas automatizadas (Vitest) con cobertura de las reglas de visibilidad/permisos por rol y del control de acceso de endpoints críticos (ver README, sección 13).
- Los permisos médicos y personales (`LeaveRecord`) están restringidos exclusivamente al rol Administrador: es el único rol que puede crear, listar o eliminar estos registros (validado en servidor en `/api/settings/leave-records`); ningún otro rol —incluida la persona titular del permiso— tiene acceso de autoservicio a esta categoría de dato.

> **Nota de verificación (2026-07-16):** los hallazgos de auditoría de IT H6 (control de acceso por jerarquía en `/api/users/*`), H7 (acceso a la base de conocimiento restringido por rol) y H8 (consentimiento vinculante que bloquea el render de la app) fueron implementados el 2026-07-10 en el commit [`02e948c`](https://github.com/ajacome0494/nexo/commit/02e948c9c8f95cd359aef069fe7cc519f26ffd39) y re-verificados el 2026-07-16 en vivo contra producción (`https://nexo-phi-eight.vercel.app`, desplegada desde ese mismo commit): matriz de autorización con cuentas desechables en los cuatro niveles de rol (Coordinador Nacional bloqueado con `404` al intentar ver/eliminar/resetear una cuenta de Jefe Nacional; acceso a `/api/assistant/documents` limitado a Administrador/Jefe/Coordinador Nacional y la subida de documentos restringida solo a Administrador; SSR de `/dashboard` sin consentimiento aceptado muestra únicamente el modal, sin `AppShell` ni llamadas a datos), más confirmación de cabeceras de seguridad (CSP, HSTS, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy) presentes en la respuesta de producción. Ningún commit posterior a `02e948c` modificó los archivos que corrigió.

## 11. Riesgos identificados

- Envío de contenido potencialmente sensible (consultas de RRHH, contenido de documentos internos) a un proveedor externo de procesamiento de lenguaje (Groq) como parte del funcionamiento del asistente Nova.
- Almacenamiento de documentos internos de RRHH, que pueden contener datos de personal, en un repositorio de un proveedor externo (GitHub), fuera del perímetro directo de la base de datos de la aplicación.
- Transferencia de datos de invitados (nombre/correo) a la API de Zoom al programar reuniones.
- Dependencia de proveedores de infraestructura (Neon, Vercel) que alojan la totalidad de los datos personales y el tráfico de la aplicación, sin que existan hoy acuerdos de encargado de tratamiento formalizados con ninguno de los cinco proveedores externos.
- Almacenamiento de datos de salud (permisos médicos, `LeaveRecord`) sin plazo de conservación definido ni base de legitimación diferenciada — categoría especial de datos que requiere una evaluación legal específica, distinta del resto del tratamiento de RRHH (ver sección 3 y sección 9).

## 12. Validación pendiente

Este documento es de carácter técnico y funcional, basado en la revisión del código y modelos de datos del repositorio en la fecha de su generación. No constituye una conclusión legal definitiva. Antes de considerarse un RAT formal y vigente, requiere:

1. Completar los campos `[Completar: ...]` de este documento con información que solo el área legal/administrativa de la organización posee.
2. Validación formal por parte de asesoría legal especializada en protección de datos en Ecuador.
3. Formalización de acuerdos de encargado de tratamiento con Groq, GitHub, Zoom, Neon y Vercel.

---

*Los datos de identificación legal (razón social y RUC) deberán ser actualizados cuando el sistema sea formalizado bajo una entidad legal registrada.*
