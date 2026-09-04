# Changelog de Nexo

> Registro cronológico de todos los cambios del proyecto. Ordenado del más
> reciente al más antiguo. Los tipos permitidos son: `FEATURE`, `FIX`,
> `REFACTOR`, `UX`, `UI`, `ANALYTICS`, `SECURITY`, `PERFORMANCE`, `DATABASE`,
> `DOCUMENTATION`, `BREAKING CHANGE`.
>
> Las entradas desde **v1.4.0** en adelante se registran en tiempo real,
> commit a commit relevante, a medida que se implementan. Las entradas
> **anteriores a v1.4.0** fueron reconstruidas retroactivamente el
> 2026-07-22 a partir del historial de Git (154 commits desde el nacimiento
> del proyecto) y de la memoria de sesiones previas — agrupadas por
> versión/sprint en vez de commit por commit, para que el documento sea
> legible. Ver `git log --oneline` para el detalle línea por línea de
> cualquier período.
>
> Existe además un changelog automático más simple (una línea por commit no
> trivial) en la sección "## Changelog" de `README.md`, mantenido por
> `.githooks/post-commit`. Ese mecanismo NO se reemplaza por este documento
> — siguen ambos: el de `README.md` es el registro mecánico línea-por-commit,
> este es el registro narrativo y clasificado, pensado para lectura humana y
> auditoría.

---

## v1.149.1 — 2026-09-03

**Tipo:** UX
**Módulo:** Responsividad del módulo Trabajo (Kanban/Tabla) en mobile/tablet
(ver docs/AUDIT_LOG.md § 2026-09-03, "Responsividad de Trabajo en
mobile/tablet"). Único módulo con problemas reales tras una auditoría
completa de dos pasadas de toda la aplicación — el resto ya manejaba
correctamente mobile/tablet.

- **Kanban** (`KanbanView.tsx`): `grid-cols-3` fijo → `grid-cols-1
  md:grid-cols-3` — las 3 columnas (Pendiente/En Progreso/Completada) se
  apilan verticalmente en pantallas angostas en vez de aplastarse a
  ~110px cada una.
- **Barra de pestañas de vista** (`TasksModule.tsx`): agrega
  `overflow-x-auto min-w-0` al contenedor de tabs y `shrink-0` al botón
  "Cerrar mes" — antes, sin espacio suficiente, arrastraba toda la
  página en scroll horizontal en vez de scrollear solo esa barra.
- **Barra flotante de selección masiva** (`TableView.tsx`): agrega
  `max-w-[calc(100vw-1.5rem)] overflow-x-auto` — antes, siendo un
  elemento `fixed` centrado sin límite de ancho, sus extremos quedaban
  literalmente cortados fuera de la pantalla en viewports angostos.
- **Tabla principal de Trabajo** (`TableView.tsx`): oculta columnas
  secundarias en mobile (`hidden sm:table-cell`/`hidden md:table-cell` en
  Frecuencia/Coment./Inicio/T. Objetivo/H. Reales) — mismo patrón ya
  usado en `UsersManager.tsx`. Quedan siempre visibles Título, Estado,
  Prioridad, Fin y Acciones.

**Verificación:** dos auditorías de código completas de toda la
aplicación (todas las pantallas protegidas) no encontraron otros
problemas reales — solo 2 hallazgos menores de bajo riesgo, sin cambios
(`TaskCard.tsx`, popover derivado del Kanban ya corregido;
`ScenarioSimulatorPanel.tsx`, tabla cruda sin wrapper, 3 columnas cortas
en un panel angosto). `tsc`/`eslint` limpios, Vitest 1158/1158,
confirmado en Chrome que Kanban y Tabla no tienen regresión visual en
desktop tras el cambio (no fue posible verificar visualmente en un
viewport móvil real en este entorno — la emulación de tamaño de ventana
de Chrome no funcionó).

## v1.149.0 — 2026-09-02

**Tipo:** FEATURE
**Módulo:** Despliegue en IIS (Windows) con SQL Server de producción (ver
docs/AUDIT_LOG.md § 2026-09-02, "Despliegue en IIS nativo de Windows" —
guía completa en `docs/DEPLOYMENT_IIS.md`).

- **`web.config`** (raíz del repo): regla única de reverse proxy de IIS
  (ARR + URL Rewrite) hacia Next.js (127.0.0.1:3000). Django nunca se
  expone vía IIS — solo `127.0.0.1:8000`, Next.js le habla server-side.
- **`backend/requirements/prod-windows.txt`** (nuevo): `waitress` en vez
  de `gunicorn` (Unix-only, no instala en Windows) —
  `requirements/prod.txt` (Docker/Linux, sin cambios) sigue siendo el
  path de despliegue con contenedores.
- **`backend/scripts/serve_production_windows.py`** (nuevo): pipeline de
  arranque de producción para Windows (espera DB → collectstatic →
  migrate → sirve con waitress), equivalente Windows de `entrypoint.sh`.
  Verificado en vivo contra la base de datos de desarrollo real.
- **`python manage.py seed_superadmin`** (nuevo, `apps/users`): crea el
  usuario ADMINISTRADOR inicial en una base de datos vacía — reutiliza
  `UserAdminService.create_user` (hasheo, sincronización de
  `is_superuser`, auditoría), idempotente, valida la contraseña y fuerza
  `must_change_password=True`.
- **`scripts/deploy/register-windows-services.ps1`** (nuevo): registra
  backend y frontend como Windows Services vía NSSM (arranque automático,
  reinicio si el proceso muere, logs rotados).
  **`scripts/deploy/seed-superadmin.ps1`** (nuevo): envoltorio del comando
  anterior para el servidor de producción.
- **`.env.production.example`** (raíz) y
  **`backend/.env.production.example`** (nuevos): plantillas de variables
  de entorno de producción, distintas de los `.env.example` de
  desarrollo ya existentes.
- **`docs/DEPLOYMENT_IIS.md`** (nuevo): guía operativa completa —
  prerrequisitos (IIS/ARR/URL Rewrite/NSSM, instalación manual con
  privilegios de administrador), pasos de instalación, registro de
  servicios, configuración del sitio IIS, verificación end-to-end,
  checklist de seguridad.

**Verificación:** pipeline completo de arranque de producción del backend
probado en vivo (puerto de prueba, sin afectar el servidor de desarrollo);
`npm run build` de producción ejecutado con éxito (servidor de desarrollo
pausado ~1 minuto y restaurado limpio); 6 tests nuevos de
`seed_superadmin` (`pytest apps/users/tests/test_seed_superadmin.py`,
6/6). La instalación real de IIS/ARR/URL Rewrite/NSSM queda como paso
manual documentado (requiere privilegios de administrador que esta sesión
no tiene).

## v1.148.1 — 2026-09-02

**Tipo:** FIX
**Módulo:** Consentimiento de datos — "Restablecer"/"Restablecer todos"
usaban `confirm()` nativo del navegador en vez de `ConfirmDialog` (ver
docs/AUDIT_LOG.md § 2026-09-02, "Restablecer consentimiento usaba confirm()
nativo en vez de ConfirmDialog").

`DataConsentSection.tsx::handleResetConsent`/`handleResetConsentAll`
usaban `window.confirm()` (heredado 1:1 de `SettingsManager.tsx`, nunca
migrado cuando el resto del sistema adoptó `ConfirmDialog` — ver su propio
docstring: "reemplaza confirm() nativo, usado hasta ahora en 13 archivos").
El usuario notó, al ver el diálogo del navegador sin el estilo de la app,
que era inconsistente con el resto de confirmaciones del sistema (incluida
"Eliminar consentimiento" en `UsersManager.tsx`, ya migrada en v1.148.0).
Ambos flujos ahora usan `ConfirmDialog`, con el mismo patrón de
`pendingXxx`/`loading` ya establecido. "Restablecer todos" (afecta a todos
los usuarios) consolida sus 2 `confirm()` encadenados en un solo diálogo
con estilo `danger`, en vez de duplicar la confirmación.

**Archivos:** `src/components/settings/DataConsentSection.tsx`.
**Verificación:** 9 tests nuevos en
`src/__tests__/components/settings/DataConsentSection.test.tsx` (14/14 en
el archivo), Vitest completo 1158/1158, `tsc`/`eslint` limpios. Verificado
en Chrome: ambos diálogos ahora usan el modal estándar de la app.

## v1.148.0 — 2026-09-02

**Tipo:** FEATURE
**Módulo:** Consentimiento de datos personales — gate real por scroll+checkbox,
eliminación individual desde Usuarios, contenido editable desde Ajustes (ver
docs/AUDIT_LOG.md § 2026-09-02, "Consentimiento de datos editable desde
Ajustes").

- **Gate real en `ConsentGate.tsx`:** el botón "Aceptar y continuar" ahora
  exige DOS condiciones independientes — checkbox marcado Y haber llegado
  al final del texto (`scrollTop + clientHeight >= scrollHeight - 4`, con
  chequeo adicional post-carga para el caso "el texto entra sin scroll").
  Antes bastaba con el checkbox, sin haber leído nada.
- **Eliminar consentimiento individual (`UsersManager.tsx`):** la columna
  "Consentimiento" de Usuarios muestra un botón "Eliminar" (con
  `ConfirmDialog`) cuando el usuario ya aceptó — fuerza a que vuelva a ver
  y aceptar el aviso en su próximo login. Reutiliza el endpoint existente
  `PATCH /api/users/:id/reset-consent` (antes solo disponible desde
  "Restablecer todos" en Ajustes).
- **Contenido editable desde Ajustes (`DataConsentSection.tsx`):** nuevo
  botón "✏️ Editar contenido" junto a "🔄 Restablecer todos" (mismo estilo
  `Button variant="secondary"`) que abre un modal con un textarea Markdown
  precargado con el aviso vigente. El texto pasa de estar hardcodeado en
  `ConsentGate.tsx` a ser un valor de `SystemConfigHistory`
  (`consent_text`, mismo mecanismo versionado ya usado por
  `welcome_message`/`nova_cache_ttl_minutes`) — `ConsentGate.tsx` lo trae
  de `GET /api/settings/consent-text` y lo renderiza como Markdown
  (`marked` + `DOMPurify.sanitize`, mismo patrón que
  `DocumentationSection.tsx`), con el texto anterior hardcodeado como
  respaldo (`FALLBACK_CONSENT_TEXT`) si la carga falla.
- **Backend:** `ConsentTextView` (`GET` cualquier usuario autenticado,
  `PUT` solo ADMINISTRADOR) en `apps/configuration/`; `SystemConfigHistory.value`
  pasa de `CharField(max_length=255)` a `TextField()` (migración
  `0006_alter_systemconfighistory_value`) — el aviso completo (~1500
  caracteres) no entraba en 255. Beneficia a todos los valores que usan
  ese mecanismo, no solo `consent_text`.

**Archivos:** `src/components/ConsentGate.tsx`,
`src/components/settings/DataConsentSection.tsx`,
`src/components/UsersManager.tsx`,
`src/app/api/settings/consent-text/route.ts` (nuevo),
`backend/apps/configuration/{models,serializers,views,urls,services}.py`,
`backend/apps/configuration/migrations/0006_alter_systemconfighistory_value.py`
(nueva).

**Verificación:** backend `pytest apps/` 1884/1886 (2 fallos preexistentes
no relacionados, mismo caso de fecha hardcodeada ya documentado en
v1.147.2); frontend `tsc`/`eslint` limpios, Vitest 1154/1154.

## v1.147.5 — 2026-09-02

**Tipo:** FIX
**Módulo:** Ajustes → Seguridad — pantalla se rompía al entrar (ver
docs/AUDIT_LOG.md § 2026-09-02, "ConfigCenter no validaba la respuesta de
/api/users").

`ConfigCenter.tsx::loadUsers()` asignaba el body de la respuesta a
`setUsers(data)` sin comprobar `res.ok` — un error (`{error: "..."}`, no un
array) se pasaba igual a `PasswordManagementSection.tsx`, que rompía en
`users.map is not a function`. Ahora valida `res.ok` y el tipo de `data`
antes de `setUsers`, con toast de error y `users = []` en cualquier fallo.
Hallazgo real del usuario ("intenté entrar a seguridad dentro de ajustes y
se rompió"), reproducido con la captura de pantalla del error.

**Archivos:** `src/components/settings/ConfigCenter.tsx`.

## v1.147.4 — 2026-09-02

**Tipo:** FIX
**Módulo:** Autenticación — `ConsentGate` fallaba en silencio,
`djangoApiFetch` no refrescaba el token cuando faltaba la cookie (ver
docs/AUDIT_LOG.md § 2026-09-02, "ConsentGate no mostraba ningún error si el
PATCH fallaba").

- `ConsentGate.tsx::handleAccept()` hacía `if (res.ok) onAccept()` sin
  rama `else` — cualquier fallo del `PATCH /api/auth/consent` (ej. token de
  Django recién vencido tras el login) dejaba al usuario sin ninguna señal:
  el botón volvía a su estado normal, indistinguible de no haber hecho
  clic. Ahora reintenta una vez automáticamente si el primer intento
  devuelve 401, y si sigue fallando muestra el error real por toast.
- `djangoApiFetch` (`src/lib/djangoSession.ts`) solo intentaba refrescar el
  token de Django cuando la respuesta era 401 con un token presente pero
  inválido — si la cookie de acceso faltaba directamente (mismo escenario
  del punto anterior), devolvía `null` sin siquiera intentar el refresh.
  Ahora, si no hay `access_token`, intenta refrescar antes de rendirse.

Ambos bugs fueron descubiertos porque el usuario insistió en que el
problema era real y reproducible en su propio navegador ("siempre, siempre,
siempre no me deja poner en aceptar y continuar"), no una falla puntual de
las pruebas automatizadas de Chrome como se había asumido inicialmente.

**Archivos:** `src/components/ConsentGate.tsx`, `src/lib/djangoSession.ts`.
**Verificación:** nuevo `src/__tests__/djangoSession.test.ts` (6 tests).

## v1.147.3 — 2026-09-01

**Tipo:** UX
**Módulo:** Renombrado de marca — "Nova" → "Gemini" en toda la interfaz de
usuario (ver docs/AUDIT_LOG.md § 2026-09-01, "Renombrado de marca de Nova a
Gemini").

Solo texto visible (labels, títulos, placeholders, mensajes) en ~12
archivos — identificadores internos, nombres de archivo, rutas, claves de
config y el modelo de Gemini usado (`@google/genai`) quedan exactamente
igual. El usuario pidió el cambio por percepción de seguridad/marca
("Nova" sonaba a un proveedor propio en vez de dejar explícito que es
Gemini bajo la licencia corporativa existente), no por un cambio real de
proveedor — ya se había migrado de Groq a Gemini en 2026-08-31.

**Archivos:** `src/lib/navLinks.ts`, `src/lib/settingsCategories.ts`,
`src/components/shell/NovaFab.tsx`,
`src/components/settings/{NovaCacheSection,RetentionPolicySection,registry}.tsx`,
`src/components/assistant/AssistantModule.tsx`,
`src/components/dashboard/DashboardModule.tsx`,
`src/app/(protected)/profile/page.tsx`,
`src/app/api/assistant/chat/route.ts`,
`src/app/api/dashboard/nova-message/route.ts`,
`src/app/api/kpis/nova-insights/[userId]/route.ts`.

## v1.147.2 — 2026-09-02

**Tipo:** SECURITY
**Módulo:** Corrección de los 7 hallazgos de la re-auditoría de IA y datos
personales (ver docs/AUDIT_LOG.md § 2026-09-02 para el detalle completo
Problema/Decisión/Justificación de cada uno).

- **H-1:** `docs/RAT.md` no desglosaba qué dato llega a Gemini en 3 de 4
  flujos de IA — agregada sección 6.1 con el detalle de cada punto de
  integración. Solo documentación.
- **H-2:** la exportación de "mis datos" excluía `LeaveRecord`/
  `SpecialStatus` (Art. 26 LOPDP) del propio titular —
  `export_my_data`/`djangoDataRequestsAdapter.ts` ahora los incluyen,
  filtrados estrictamente por el usuario autenticado.
- **H-3:** Solicitudes LOPD no dejaban rastro en el `AuditLog` central —
  `create_data_request`/`resolve_data_request`/`export_my_data` ahora
  auditan (`data_request.created`/`.resolved`/`.exported`).
- **H-4:** `docs/RAT.md` tenía datos técnicos desactualizados (bcrypt vs.
  Argon2, campo eliminado, nomenclatura Prisma) — corregido.
- **H-5:** gate inconsistente entre KPIs (`is_superuser`) y el CRUD de
  `LeaveRecord`/`SpecialStatus` (grupo ADMINISTRADOR) — los 4 endpoints
  ahora exigen `is_superuser=True` real.
- **H-6** (regresión de H-5, hallazgo de la re-auditoría): ningún flujo
  del producto asignaba `is_superuser` — `UserAdminService` ahora lo
  sincroniza con la pertenencia al grupo ADMINISTRADOR, con guard de
  "último administrador activo" y migración de backfill para cuentas ya
  existentes.
- **H-7** (hallazgo de seguridad real de la re-auditoría): bypass de
  autorización vía caché compartida en Nova Insights — la clave de caché
  no identificaba al viewer, permitiendo que un usuario sin visibilidad
  jerárquica real sobre un colaborador recibiera el resultado cacheado
  generado para otro viewer con el mismo rol. Clave ahora prefijada con
  `session.djangoUserId`.

**Verificación:** `pytest` backend 1870/1872 (2 fallos preexistentes no
relacionados, test con fecha hardcodeada), Vitest 1129/1129, `tsc`/`eslint`
limpios.

## v1.147.1 — 2026-09-02

**Tipo:** FIX
**Módulo:** Autenticación — login roto para toda cuenta ADMINISTRADOR (ver
docs/AUDIT_LOG.md § 2026-09-02).

`session.permissions` (JWT `nexo-session`, catálogo dinámico de permisos,
v1.146.0) embebía el array completo de `get_user_permission_codenames`.
Para un superusuario, `get_all_permissions()` de Django devuelve el
catálogo COMPLETO del sistema (~250 codenames, todo modelo × toda acción),
no solo los ~30 del catálogo de negocio — el JSON de esa lista pesa ~8KB,
por encima del límite práctico de ~4KB por cookie que aplican los
navegadores. El servidor emitía el `Set-Cookie` igual (sin error, sin
truncar), pero el navegador lo descartaba en silencio: cualquier login con
una cuenta ADMINISTRADOR devolvía 200 con el usuario correcto, pero la
sesión nunca quedaba realmente iniciada — cada request siguiente rebotaba
a `/login`. Confirmado en vivo con `curl` (fuera del navegador, mismo
resultado) para descartar que fuera un artefacto de la automatización de
Chrome usada para probarlo.

**Corrección:** `sessionPermissionsFor(role, permissions)`
(`src/lib/permissions.ts`) colapsa la lista a un sentinel `["*"]` cuando
`role === "ADMINISTRADOR"`, usado por los 2 puntos reales que arman
`session.permissions` (`api/auth/login/route.ts`, `api/auth/me/route.ts`
en el PATCH de perfil). `hasPermission`/`hasAnyPermission` tratan `"*"`
como "todos los permisos" — ninguna pantalla gateada por estas funciones
(`/admin/roles`, `canManageRoles`/`canViewRoles`) pierde acceso. Django
sigue siendo la única fuente de verdad real (`user_has_permission` ya
bypassea `is_superuser` de forma independiente) — este cambio es
exclusivamente sobre qué entra en la cookie de UI.

**Archivos:** `src/lib/permissions.ts`, `src/app/api/auth/login/route.ts`,
`src/app/api/auth/me/route.ts`, `src/__tests__/permissions.test.ts`
(2 tests nuevos de regresión).

**Impacto:** desbloquea el login de cualquier cuenta ADMINISTRADOR/
superusuario — estaba roto desde que se agregó `session.permissions`
(v1.146.0) hasta esta corrección. Ningún otro rol se ve afectado (sus
listas de permisos reales, ~5-15 codenames, nunca se acercaron al límite).

## v1.147.0 — 2026-09-01

**Tipo:** SECURITY
**Módulo:** Corrección de los hallazgos de la auditoría de seguridad
publicada el mismo día (ver docs/AUDIT_LOG.md § 2026-09-01, "Auditoría de
seguridad de Nexo — hallazgos corregidos"). Los 3 hallazgos con severidad
real (media/baja) quedan corregidos; el resto eran informativos y no
requerían cambio de código.

**NEXO-01 (media) — asignación de tareas sin validar jerarquía visible:**
`TaskService.create_task`/`update_task` y `TaskImportService.import_rows`
ahora validan `assigned_to` contra `is_visible_to(actor, ...)` — la misma
primitiva que ya usa `AssignableUsersView` para poblar el selector del
frontend, pero que la API nunca repetía del lado servidor. Verificado en
vivo durante la auditoría: un usuario nivel 1 podía asignar tareas a
cualquier otro usuario del sistema (incluido Administrador) sin ninguna
restricción. 3 tests de regresión nuevos.

**NEXO-02 (media) — CSP con `unsafe-eval` sin necesidad real en producción:**
`unsafe-eval` ahora solo se incluye en desarrollo (`!isProd`). Investigado
en vivo: al quitarlo por completo, `npm run dev` falla con un error
explícito de React ("React requires eval() in development mode... React
will never use eval() in production mode"); `npm run build` (producción)
compila y corre sin él. Sin `eval()`/`new Function()` en el código propio
de Nexo.

**NEXO-03 (baja) — HTML sin sanitizar en el visor de Documentación:**
`DocumentationSection.tsx` ahora pasa el HTML generado por `marked` a
través de `DOMPurify.sanitize()` antes de `dangerouslySetInnerHTML` —
nueva dependencia (`dompurify`), justificada por ser la única forma
correcta de sanitizar HTML arbitrario (ya no existe una opción de
sanitizado confiable dentro de `marked`). Test nuevo que reproduce el
escenario exacto (un `<script>` embebido en el Markdown fuente).

**NEXO-04 (informativa) — dependencias con advisories abiertos:**
`npm audit fix` (no disruptivo) resolvió `brace-expansion`/`js-yaml`/
`nanoid`/`undici`. Next.js actualizado 16.2.9 → 16.3.4 (cierra el CVE alto
de divulgación no autenticada de endpoints internos de Server Functions),
verificado con `tsc`/`eslint`/Vitest/`npm run build` en verde. Quedan sin
resolver, deliberadamente: la cadena `protobufjs`/`sharp` vía
`@xenova/transformers` (el único fix requiere degradar esa librería a
1.4.2, cambio disruptivo para el motor de embeddings de Nova) y `xlsx`
(sin fix upstream — riesgo práctico bajo, confirmado que el repo solo lo
usa para exportar, nunca para parsear archivos subidos).

**NEXO-05/NEXO-06:** no son hallazgos de código — recomendaciones de
proceso (correr `pip-audit` en un entorno sin interceptación TLS;
confirmar `DB_TRUST_SERVER_CERTIFICATE` en producción). Sin cambios.

**Verificado:** backend `pytest apps/` 1864/1864 relevantes (2 fallas
preexistentes de calendario, no relacionadas), frontend `tsc`/`eslint`
limpios, Vitest 1123/1123, `npm run build` exitoso.

**Archivos:** `backend/apps/tasks/services.py`,
`backend/apps/tasks/tests/{test_tasks,test_import_export}.py`,
`next.config.ts`, `src/components/settings/DocumentationSection.tsx`,
`src/__tests__/components/DocumentationSection.test.tsx` (nuevo),
`package.json`/`package-lock.json`.

**Autor:** Claude Code (Sonnet 5)

---

## v1.146.2 — 2026-09-01

**Tipo:** UX / REFACTOR
**Módulo:** Reemplazo de `confirm()`/`window.confirm()` nativo por un
diálogo de confirmación propio — hallazgo real de la "prueba integral de
toda la plataforma" (verificación manual de Tareas): el diálogo nativo
bloquea la pestaña completa del navegador (incluida cualquier
automatización/testing) y es visualmente inconsistente con el resto de la
app, que ya usa `Modal`/`ModalHeader` para toda otra confirmación.

**Cambios:**
- `src/components/ui/ConfirmDialog.tsx` (nuevo) — envoltorio delgado sobre
  `Modal`/`ModalHeader`/`Button` ya existentes. Sin Context nuevo (regla
  del repo: usar estado local cuando alcanza) — cada call site guarda su
  propio estado de "acción pendiente" en vez de un provider global.
- 16 usos migrados en 13 archivos: `TasksModule.tsx`/`TableView.tsx`
  (tareas, individual y masivo), `MeetingsModule.tsx` (reuniones),
  `ProjectPhasesTab.tsx`/`ProjectSummaryTab.tsx`/`ProjectTrashPanel.tsx`
  ×2 (proyectos: fases, papelera, restaurar/eliminar definitivo),
  `ActivityReasonsSection.tsx`/`RestoreDefaultButton.tsx`/
  `HolidaysSection.tsx`/`KnowledgeBaseSection.tsx`/
  `LeaveRecordsSection.tsx`/`SpecialStatusSection.tsx` ×2 (Configuración),
  `UsersManager.tsx` ×2 (usuarios).

**Verificado:** `tsc`/`eslint` limpios, Vitest 1122/1122, y confirmado
visualmente en browser que el modal nuevo no bloquea la pestaña (a
diferencia del nativo, que sí lo hacía — verificado empíricamente durante
la migración).

**Fuera de alcance, no corregido:** `TableView.tsx` también usa `alert()`
nativo (2 veces, mensajes informativos) — mismo problema de raíz, categoría
distinta a lo pedido.

**Archivos:** `src/components/ui/ConfirmDialog.tsx` (nuevo),
`src/components/tasks/{TasksModule,TableView}.tsx`,
`src/components/meetings/MeetingsModule.tsx`,
`src/components/projects/{ProjectPhasesTab,ProjectSummaryTab,ProjectTrashPanel}.tsx`,
`src/components/settings/{ActivityReasonsSection,HolidaysSection,KnowledgeBaseSection,LeaveRecordsSection,SpecialStatusSection}.tsx`,
`src/components/settings/history/RestoreDefaultButton.tsx`,
`src/components/UsersManager.tsx`.

**Autor:** Claude Code (Sonnet 5)

---

## v1.146.1 — 2026-09-01

**Tipo:** SECURITY
**Módulo:** "SuperUsuario" = `ADMINISTRADOR` con todo el catálogo de
permisos sembrado explícito en la base — pedido explícito del usuario tras
v1.146.0 ("crea un rol de SuperUsuario que tenga control de todos los
permisos, tenga asignado todo por defecto"). Aclarado con `AskUserQuestion`:
NO es un rol nuevo (`Role` sigue fijo en 11 valores) — es el `ADMINISTRADOR`
existente, que ya es el superusuario de facto de Nexo, con el catálogo
completo asignado en la base en vez de depender solo del bypass
`is_superuser`.

**Backend:**
- Nueva migración `apps/permissions/migrations/0004_seed_all_permissions_to_administrador.py`
  (aditiva, dependiente de `0003`): asigna a `ADMINISTRADOR` los 26
  codenames completos de `PERMISSION_CATALOG` — incluidos los 5 módulos
  administrativos originales (`usuarios`/`roles`/`permisos`/
  `configuracion`/`auditoria`, nunca antes sembrados explícitamente a
  ningún rol) y los 3 codenames que `0003` había excluido a propósito para
  reproducir fielmente el comportamiento legacy (`tareas.regularizar`,
  `tareas.cerrar_mes`, `escritorio_digital.usar`).
- Test actualizado (`apps/permissions/tests/test_business_module_permissions_seed.py`):
  `test_administrador_receives_every_catalog_codename` reemplaza al test
  anterior que verificaba un set acotado — ahora verifica que
  `ADMINISTRADOR` tiene exactamente `all_codenames()`.
- 5 tests de `apps/desk` que verificaban que ADMINISTRADOR recibía 403
  (`test_desk_notes.py`, `test_desk_search.py`, `test_desk_today.py`,
  `test_personal_reminders.py`) actualizados para reflejar el nuevo
  comportamiento intencional (200/201) — regresión real, no debilitada:
  la suite completa detectó estas 5 fallas tras aplicar la migración, cada
  una confirmando el efecto exacto descrito abajo.

**Efecto real (no solo cosmético):** para un superusuario real
(`is_superuser=True`) no cambia nada — ya tenía acceso total. El cambio es
para el caso `ADMINISTRADOR`-solo-por-grupo (`is_superuser=False`, estado
real alcanzable — `UserAdminService.create_user` nunca setea
`is_superuser`): pasa a tener acceso a Escritorio Digital y a
regularizar/cerrar mes en bloque, que antes no tenía — reversión
deliberada de una exclusión de producto documentada, por pedido explícito
y literal del usuario. `src/lib/roles.ts` no se tocó — el link de
Escritorio Digital sigue oculto en el frontend para `role === "ADMINISTRADOR"`.

**Archivos:** `backend/apps/permissions/migrations/0004_seed_all_permissions_to_administrador.py`
(nuevo), `backend/apps/permissions/tests/test_business_module_permissions_seed.py`,
`backend/apps/desk/tests/{test_desk_notes,test_desk_search,test_desk_today,test_personal_reminders}.py`.

**Autor:** Claude Code (Sonnet 5)

---

## v1.146.0 — 2026-09-01

**Tipo:** SECURITY + FEATURE
**Módulo:** Catálogo dinámico de permisos extendido a todo el sistema (19
módulos) + pantalla "Roles y Permisos" (`/admin/roles`) — pedido explícito
del usuario ("porque si copie o inicie todo desde el proyecto de skelleton
no tengo el tema de gestion y asignacion de permisos?" → "Si, quiero que se
arme esa pantalla de control de permisos para cada rol" →, ante el
trade-off presentado, "Extender el catálogo a todo el sistema").

Nexo heredó de `skelleton_base` un sistema de permisos por rol
(`Group`↔`Permission` de Django) completo pero sin ninguna pantalla que lo
consuma, y limitado a 4-5 módulos administrativos (usuarios/roles/
permisos/configuración/auditoría) — el resto de la autorización real
(~15 apps de dominio) vivía en checks de rol hardcodeados, tanto en
`src/lib/roles.ts` como en `permission_classes` de Django. El usuario
eligió extender el catálogo a todo el sistema en vez de limitarse a una
pantalla sobre el catálogo administrativo existente.

**Backend:**
- 10 módulos nuevos en `PERMISSION_CATALOG` (`backend/apps/permissions/catalog.py`):
  `tareas`, `reportes`, `equipo`, `reuniones`, `mejora_continua`,
  `base_conocimiento`, `inteligencia_preventiva`, `proyectos`,
  `escritorio_digital`, `announcements` (13 codenames nuevos en total).
- Migración de datos (`apps/permissions/migrations/0003_seed_business_module_permissions.py`)
  que siembra cada codename EXACTAMENTE al set de roles que reproduce su
  comportamiento previo — verificado codename por codename contra
  `src/lib/roles.ts` y el `permission_classes` real de cada app.
- 9 apps migradas de checks hardcodeados (`role_name()`/`role_level()`,
  duplicados literalmente en 6+ archivos) al catálogo dinámico
  (`user_has_permission`): `apps/tasks`, `apps/reports`, `apps/meetings`,
  `apps/ideas`, `apps/desk`, `apps/announcements`, `apps/assistant` (×2),
  `apps/projects`.
- `apps/team` gana `TeamPermission` (`equipo.ver`) — antes sin
  `permission_classes` propio a nivel de vista (el frontend ya ocultaba el
  link, pero el endpoint no lo exigía server-side).
- Nuevo test `apps/permissions/tests/test_business_module_permissions_seed.py`
  (13 tests) que verifica la migración contra `src/lib/roles.ts` en tiempo
  de test, mismo patrón que `apps/hierarchy/tests/test_seed_matches_legacy_roles.py`.

**Frontend:**
- `SessionPayload.permissions: string[]` (JWT) — mismo trade-off de
  staleness ya aceptado para `role`/`djangoUserId`.
- `src/lib/permissions.ts` (nuevo): `hasPermission`/`hasAnyPermission`/
  `canManageRoles`/`canViewRoles`.
- Pantalla nueva `/admin/roles` (`RolesPermissionsManager.tsx`): matriz de
  19 módulos × 11 roles, un rol a la vez. Fila de Administrador con todo
  tildado y sin edición (el bypass real es `is_superuser`, destildar acá no
  cambiaría nada). Guardado con modal de confirmación (reemplazo completo
  del set de codenames, igual que `RoleService.update_role`), advertencia
  si el usuario está por quitarse `roles.ver` a su propio rol en sesión.
  Deliberadamente sin crear/eliminar roles pese a que el backend lo soporta
  (`Role` es un union type TS fijo de 11 valores).
- `src/lib/roles.ts` deliberadamente SIN modificar — sigue gateando la UI
  hoy; migrarlo módulo por módulo a `session.permissions` queda en
  `docs/ROADMAP.md`.

**Hallazgo crítico corregido durante la implementación (ver `docs/AUDIT_LOG.md`
§ 2026-09-01):** los helpers legacy `role_name()`/`role_level()` tratan la
sola pertenencia al grupo `ADMINISTRADOR` como equivalente a
`is_superuser=True` (sin serlo necesariamente — `UserAdminService.create_user`
nunca asigna `is_superuser`). El catálogo dinámico (`user_has_permission`)
NO replica ese bypass por defecto — la primera versión de la migración de
datos dejaba a un ADMINISTRADOR-solo-por-grupo sin los permisos nuevos,
causando 23 fallas de test. Corregido sembrando explícitamente los
codenames nuevos también a `ADMINISTRADOR` (salvo los 2 casos donde el
comportamiento original tampoco lo incluía).

**Archivos:** `backend/apps/permissions/catalog.py`,
`backend/apps/permissions/migrations/0002_alter_modulepermission_options.py`,
`backend/apps/permissions/migrations/0003_seed_business_module_permissions.py`,
`backend/apps/permissions/tests/test_business_module_permissions_seed.py`,
`backend/apps/{tasks,reports,meetings,ideas,desk,announcements,assistant,projects}/permissions.py`,
`backend/apps/ideas/services.py`, `backend/apps/team/permissions.py` (nuevo),
`backend/apps/team/views.py`, `backend/apps/tasks/tests/test_month_closure.py`,
`backend/apps/roles/tests/test_roles.py`, `src/lib/session.ts`,
`src/lib/permissions.ts` (nuevo), `src/lib/djangoRolesAdapter.ts` (nuevo),
`src/app/api/admin/{roles,roles/[id],permissions}/route.ts` (nuevos),
`src/app/(protected)/admin/roles/page.tsx` (nuevo),
`src/components/RolesPermissionsManager.tsx` (nuevo), `src/lib/navLinks.ts`,
`src/app/api/auth/{login,me}/route.ts`.

**Impacto:** autorización real de 9 apps de dominio + `apps/team` pasa de
checks hardcodeados a un catálogo administrable en runtime, sin cambio de
comportamiento el día del rollout (verificado con la suite completa +
verificación manual en browser con 3 roles representativos). Riesgo
documentado: revocar un permiso no tiene efecto inmediato sobre sesiones
Next.js activas de ese rol hasta su próximo login (mismo comportamiento ya
aceptado para `role`). `apps/configuration` (Ajustes) y partes de
`apps/dashboard`/`apps/notifications` quedan fuera de alcance — dependen
100% del guard de frontend, documentado como hallazgo relacionado, no
corregido.

**Autor:** Claude Code (Sonnet 5)

---

## v1.145.3 — 2026-08-31

**Tipo:** REFACTOR
**Módulo:** Retiro completo de `legacy_postgres_id` y del puente de id
cuid↔Django — pedido explícito del usuario tras ver el resumen de v1.145.2
("Si, quiero que también retires eso, repito, no voy a utilizar nada de lo
antiguo, nunca más volveré a topar la información antigua").

A diferencia de v1.145.2 (código de conexión ya inerte, sin consumidor
real), este cambio SÍ es de arquitectura de sesión — toca el JWT de todo
usuario autenticado. La investigación previa confirmó que el campo ya no
conectaba con nada externo (Prisma no existe en el código desde la Fase 90)
y que el "puente" causaba 2 bugs activos en producción, cerrados en el
mismo cambio.

**Backend — eliminado:**
- **14 migraciones nuevas** (`RemoveField`, una por app): `legacy_postgres_id`
  retirado de los ~40 modelos que lo conservaban (`users`, `reports`,
  `assistant`, `configuration`, `data_requests`, `desk`, `ideas`,
  `meetings`, `notifications`, `projects`, `recovery`, `tasks`, `analytics`,
  `announcements`).
- **`UserLegacyIdLookupView`** (`GET /reports/user-lookup/`) — endpoint
  completo eliminado, junto con su ruta.
- **`UserPublicSerializer`** (`apps/users/serializers.py`) — deja de exponer
  `legacy_postgres_id` en `GET/PATCH /auth/me/`.
- **`RosterView`** (`GET /reports/roster/`) — expone el id numérico de
  Django directo en `users[].id` (antes exponía el cuid).

**Frontend — `SessionPayload` (cambio de forma del JWT de sesión):**
- `src/lib/session.ts`: se elimina `userId: string` (cuid); `djangoUserId: number`
  pasa a ser obligatorio (antes opcional, resuelto vía fallback).
- `auth/login/route.ts`: se elimina el gate `if (!me.legacy_postgres_id) return 401`
  — cierra un bug activo: cualquier usuario creado directo en el panel de
  administración de Django (sin `legacy_postgres_id` histórico) no podía
  iniciar sesión hasta este cambio.
- `auth/me/route.ts`: `mapDjangoMe` devuelve `id: String(me.id)` en vez de
  `me.legacy_postgres_id ?? sessionUserId`.
- Propagación de `djangoUserId` en los 8 sitios que ya usaban el patrón
  `djangoUserId ?? session.userId` (páginas protegidas principales),
  `AppShell`/`Topbar`/`ThemeToggle`/`profile/page.tsx`.

**2 bugs activos cerrados** (consecuencia directa del mismo cambio, no
tareas aparte):
- `src/app/api/users/[id]/route.ts` — el guard "no puedes eliminarte a ti
  mismo" comparaba el `id` numérico del path contra `session.userId`
  (cuid) — nunca coincidía, el guard estaba inerte. Ahora compara contra
  `djangoUserId` resuelto de la sesión.
- `src/app/api/users/[id]/view-preferences/route.ts` — llamaba a Django con
  el cuid crudo del path contra una ruta `<int:pk>/`, que nunca matcheaba
  — la escritura de `viewPreferences` fallaba siempre (404 interno). Ahora
  resuelve `djangoUserId` primero, mismo patrón que `theme/route.ts`.

**Reportes Ejecutivos — colapso del espacio cuid interno:**
- `djangoAnalyticsBridge.ts`: se elimina `resolveDjangoIdsForRoster`
  (ya no hace falta ningún `Map<cuid, djangoId>`).
- `djangoReportKpisBridge.ts`: se elimina `remapDjangoIdentity`/
  `remapListIdentity` — `fetchMonthlyTeamReport`/`fetchCustomRangeTeamReport`/
  `fetchRangeTeamReport` reciben `userIds: string[]` (numéricos) directo.
- `buildSnapshotData.ts` (3 builders): eliminado el paso de traducción
  cuid↔numérico en cada uno; `buildPredictivoForCurrentMonth` y el bloque
  del Índice Ejecutivo usan `Number(id)` directo.

**Documentación de código actualizada** (ya no describe un puente vigente):
`backend/CLAUDE.md`, `.claude/rules/backend/database.md`,
`.claude/rules/architecture.md`, `.claude/rules/frontend/api.md`,
`/CLAUDE.md`.

**Verificación:** `pytest apps/` backend en verde (293 tests de
`reports`/`users`/`authentication` re-verificados tras el cambio de capa de
lectura, antes de tocar el modelo); `npx tsc --noEmit`/`npx eslint src`
limpios; `npx vitest run` 1095/1095 en verde. No se invalidan sesiones
activas al desplegar (decisión confirmada con el usuario — riesgo mínimo,
el sistema ya degrada con gracia).

---

## v1.145.2 — 2026-08-31

**Tipo:** REFACTOR
**Módulo:** Decommission de la infraestructura de conexión al Postgres
legacy — pedido explícito del usuario: nunca se va a volver a usar, el
proyecto pasa a una base SQL Server nueva en un servidor de aplicaciones
distinto al anterior.

A diferencia de la depuración de código muerto de v1.145.1 (archivos/
dependencias sin ninguna referencia), esto es la eliminación deliberada de
infraestructura que SÍ tenía un propósito documentado (migrar datos
históricos reales) pero que una decisión explícita anterior (Fase 82, ver
`docs/AUDIT_LOG.md` § 2026-08-27) ya había dejado sin ejecutar contra
producción — el usuario confirmó ahora que tampoco se va a ejecutar en el
futuro.

**Backend — eliminado:**
- **41 comandos `migrate_*_from_postgres.py`** (uno por entidad de
  negocio, en 20 apps de Django) — nunca se corrieron contra datos reales.
- **`apps/core/legacy_migration.py`** — helper compartido por esos 41
  comandos (`bulk_import_rows`/`filter_not_yet_imported`/etc.), sin otro
  consumidor tras eliminarlos.
- **`apps/users/tests/test_migrate_users_from_postgres.py`** — único test
  existente para uno de esos comandos.
- **`LEGACY_POSTGRES_URL`** — variable de entorno (`backend/.env`,
  `backend/.env.example`, `config/settings/base.py`), solo la usaban los
  comandos eliminados.
- **`psycopg2-binary`** (driver de Postgres) y **`bcrypt`** (paquete
  Python — fallback de `PASSWORD_HASHERS` para verificar hashes `bcryptjs`
  importados) — `requirements/base.txt`, desinstalados del venv.
  `BCryptPasswordHasher` retirado de `PASSWORD_HASHERS`
  (`config/settings/base.py`); `Argon2PasswordHasher` sigue siendo el
  hasher primario, sin cambios.

**Frontend — código específico de Vercel (hosting retirado el
2026-08-28) simplificado, sin cambio de comportamiento real:**
- `src/app/api/assistant/documents/route.ts`: se quita
  `export const maxDuration = 300` — es una convención de Route Segment
  Config que Next.js solo interpreta al desplegar en Vercel, inerte en
  cualquier otro entorno.
- `src/lib/pdfPolyfill.ts` y `src/app/api/assistant/documents/route.ts`
  (límite de 4.5MB): el código funcional se conserva sin cambios (siguen
  siendo salvaguardas reales — el polyfill evita un crash real de
  `pdfjs-dist` ante un binario nativo faltante, el límite de tamaño evita
  cargar PDFs enormes en memoria), pero los comentarios que enmarcaban
  ambos como "porque estamos en Vercel" se generalizan — ninguno de los
  dos depende en verdad de esa plataforma específica.
- `docker-compose.yml`: comentario corregido — ya no menciona la carpeta
  `prisma/` (eliminada en la Fase 90) ni una "convivencia" con Postgres
  que terminó hace días.

**Explícitamente NO tocado en este cambio — es una decisión distinta,
mayor, que el usuario no pidió todavía:** el campo `legacy_postgres_id`
en ~40 modelos de Django. A diferencia de los comandos de importación
(que sí eran código muerto puro), este campo está **activo hoy** — lo usa
`RosterView`/`user-lookup` (Reportes Ejecutivos) para resolver
colaboradores, y sigue el mismo patrón de bridging cuid↔id-Django que
`session.userId` (JWT de Next.js) usa en el resto de la app. Eliminarlo
requiere re-arquitecturar cómo viaja el id de usuario por toda la sesión
(no solo borrar código sin uso) — se documenta como pendiente, no se
ejecuta sin pedido explícito.

**Verificación:** `pytest apps/` 1853/1853 en verde (1853, no 1856 — la
diferencia son los tests del comando eliminado), `ruff check`/`black
--check`/`isort --check` limpios en los archivos tocados. `tsc --noEmit`
limpio, `vitest run` 1100/1100 en verde.

**Archivos:** ver arriba — 41 comandos + `legacy_migration.py` + 1 test
(backend), `requirements/base.txt`, `config/settings/base.py`,
`backend/.env`, `backend/.env.example`, `docker-compose.yml`,
`src/lib/pdfPolyfill.ts`, `src/app/api/assistant/documents/route.ts`,
`backend/CLAUDE.md`, `.claude/rules/backend/database.md`.

**Impacto:** cierra por completo la dependencia de código hacia el
Postgres legacy y hacia el hosting anterior (Vercel) — el repositorio
queda listo para conectar la base SQL Server nueva sin ningún rastro
funcional de la infraestructura previa, salvo el bridging de id
(`legacy_postgres_id`) que sigue activo por diseño.

**Autor:** Claude Code (pedido explícito de Anthony Jácome: "debes de
limpiar el código de las conexiones previas... vamos a conectar una nueva
base de datos en sqlserver y en otro servidor de aplicaciones")

---

## v1.145.1 — 2026-08-31

**Tipo:** REFACTOR
**Módulo:** Depuración de código muerto — todo el repositorio

Auditoría de código muerto usando herramientas dedicadas (`knip` para el
frontend TypeScript, `vulture` para el backend Python), no solo grep manual
— cada candidato se verificó individualmente antes de borrar, porque ambas
herramientas dieron falsos positivos reales (scripts standalone invocados
por `tsx`/git hooks, assets vendorizados cargados vía `<script src>`,
convenciones de Django como `AppConfig`/`urlpatterns`/migraciones que
`vulture` no reconoce como "usadas").

**Eliminado (frontend):**
- **`frontend/`** (25 archivos) — prototipo Vite/React abandonado, no
  relacionado con la app real (que vive en la raíz del repo). Ya estaba
  excluido de los tests (`vitest.config.ts`); confirmado sin ninguna
  referencia real hacia/desde `src/`.
- **7 archivos de `src/lib/`, huérfanos tras la migración de stack**:
  `deskNotes.ts`, `personalReminders.ts`, `taskAccess.ts`,
  `teamComparison.ts`, `zoom.ts` (superado por `backend/apps/meetings/zoom.py`),
  `executiveReporting/nova/renderMarkdown.ts` (superado por
  `generateExecutiveNarrative`), `djangoWorkdayEndHourConfig.ts` (escrito en
  la Fase 73 para un consumidor —`capacityForecast.ts`— eliminado en la
  Fase 85, quedó sin caller). Cero imports hacia cualquiera de los 7,
  verificado por archivo.
- **`scripts/stub-server-only.cjs`** — mecanismo de stub para "server-only"
  en scripts standalone, nunca invocado desde ningún `package.json`/script
  committeado (a diferencia de `vitest.server-only-stub.ts`, que sí está
  referenciado en `vitest.config.ts` y se conserva).
- **`src/generated/`** — directorio vacío, remanente de la eliminación de
  Prisma (Fase 90).
- **5 dependencias de `package.json`**: `@anthropic-ai/sdk`, `bcryptjs`
  (Django ya hashea con Argon2 desde el cutover de auth), `html2canvas` y
  `jspdf` (solo se usan las copias vendorizadas en `public/vendor/`,
  cargadas vía `<script src>`, no el paquete npm), `@types/bcryptjs`.
  `@types/pdf-parse` también se retira — `pdf-parse@2.4.5` ya trae sus
  propios `.d.ts`, el paquete de DefinitelyTyped quedó redundante.

**Conservado pese a la señal de "no usado" de la herramienta (falso
positivo verificado):** `.githooks/update-changelog.js` (invocado por
`post-commit`, no por import), `scripts/bench-executive-report.ts`/
`scripts/generate-manuals.ts` (scripts manuales vía `npx tsx`, con sus
dependencias `dotenv`/`pdfkit`/`@types/pdfkit`/`tsx` real y activamente
usadas), `vitest.server-only-stub.ts` (alias de `vitest.config.ts`),
`public/vendor/*.min.js` (cargados vía `<script src>` en las ventanas de
reporte/PDF).

**Backend (Django):** auditoría de módulos huérfanos (archivos `.py` fuera
de las convenciones de Django — `models.py`/`views.py`/`serializers.py`/
`urls.py`/`migrations/`/`tests/`/`management/` — sin ninguna referencia en
el resto del código) **no encontró candidatos** — consistente con las
múltiples pasadas de limpieza ya realizadas durante la migración de stack
(Fases 63, 74, 85, 86, 90). `vulture` no dio señal accionable sin una lista
de exclusión extensa (ruido casi total: `AppConfig`, `urlpatterns`,
migraciones, `pytestmark`, campos de serializer — todos patrones de
Django/DRF/pytest que la herramienta no reconoce como "en uso").

**Verificación:** `npx tsc --noEmit` limpio, `npx vitest run` 1100/1100 en
verde, `npm install` sincronizó `package-lock.json`. `npm run lint` reporta
163 errores/1863 warnings preexistentes (ninguno relacionado con este
cambio, verificado — ninguno de los archivos/paquetes tocados aparece en
esa lista) — deuda de lint no relacionada, fuera de alcance de esta tarea,
no corregida acá.

**Archivos:** ver arriba. `package.json`, `package-lock.json`.

**Impacto:** repositorio más chico y sin rutas de código que ya no llevan a
ningún lado — ningún cambio de comportamiento (todo lo eliminado estaba
genuinamente sin uso, verificado antes de borrar).

**Autor:** Claude Code (pedido explícito de Anthony Jácome: "depuración de
todo el código muerto")

---

## v1.145.0 — 2026-08-31

**Tipo:** FEATURE
**Módulo:** Nova (asistente conversacional, saludo del dashboard, Insights de
Analytics, narrativa de Reportes Ejecutivos) — reemplazo completo del
proveedor de IA generativa

Pedido explícito del usuario: reemplazar Groq por Google Gemini como
proveedor de IA de Nova, aportando su propia API key. Groq era el único
proveedor de IA generativa del sistema, con 4 puntos de integración reales
vía `groq-sdk` — todos migrados a `@google/genai` (SDK oficial y activo de
Google, no el legado `@google/generative-ai`) en el mismo cambio:

- `src/app/api/assistant/chat/route.ts` — chat multi-turno de Nova (modos
  general/tareas/RRHH, con RAG sobre la base de conocimiento). El historial
  de conversación pasa de `messages` (rol `system`/`user`/`assistant`) a
  `contents` (rol `user`/`model`, con el prompt de sistema movido a
  `config.systemInstruction` — Gemini no tiene rol `system` dentro de
  `contents`).
- `src/app/api/dashboard/nova-message/route.ts` — mensaje corto del
  dashboard.
- `src/app/api/kpis/nova-insights/[userId]/route.ts` — análisis técnico y
  mensaje motivacional (2 llamadas, ambas en modo JSON).
- `src/lib/executiveReporting/nova/generateNarrative.ts` — 4 llamadas
  paralelas de la narrativa del Reporte Ejecutivo (Executive Summary/
  Insights/Assessment/Enriquecimiento de Recomendaciones).

**2 hallazgos durante la verificación en vivo (no solo lectura de
documentación) que determinaron la config final:**

1. `gemini-2.5-flash` (elección inicial) devuelve `404` para la cuenta
   asociada a la key provista — "ya no disponible para cuentas nuevas".
   Modelo final: **`gemini-3.6-flash`** (verificado funcional).
2. `gemini-3.6-flash` tiene una fase de "thinking" obligatoria que consume
   tokens del MISMO presupuesto que `maxOutputTokens` (medido entre ~50 y
   ~600 tokens incluso para prompts triviales) y **no puede desactivarse**
   (`thinkingBudget: 0` es rechazado con `400`, a diferencia de la familia
   2.5) — sin margen amplio, las respuestas se truncaban a mitad de frase
   (`finishReason: "MAX_TOKENS"`). Se omite `thinkingConfig` y se sube
   `maxOutputTokens` en los 6 call sites (60→1536, 600→2048, 220→1536,
   1500→4096, 2048→4096 ×4) — verificado con respuestas completas
   (`finishReason: "STOP"`) tras el ajuste. El deadline de
   `generateExecutiveNarrative` sube de 8s a 15s por la misma razón
   (latencia de Gemini más alta y variable que la de Groq).

**Cambios adicionales en el mismo commit:**

- `src/lib/logger.ts` — el patrón de redacción de tokens en logs gana el
  formato estándar de API key de Google AI Studio/Cloud (`AIzaSy...`),
  reemplazando la mención a Groq en el comentario (el patrón `gsk_` se
  conserva como red de seguridad).
- `src/components/ConsentGate.tsx` — texto de consentimiento LOPDP
  mostrado al usuario actualizado ("Groq Inc." → "Google LLC (Gemini API)").
- `src/components/assistant/AssistantModule.tsx` — badge de modelo visible
  en la UI del chat actualizado.
- `docs/RAT.md`, `docs/PENDIENTES_LEGALES.md`, `README.md` — Groq marcado
  como proveedor **RETIRADO** (mismo patrón usado para Neon/Vercel el
  2026-08-28), Google (API de Gemini) agregado como proveedor vigente.
- `package.json` — `groq-sdk` removido, `@google/genai` agregado.
- `.env`/`.env.example` — `GROQ_API_KEY` → `GEMINI_API_KEY`.
- Documentación de referencia (`docs/ARCHITECTURE.md`,
  `docs/ANALYTICS_FORMULAS.md`, `docs/ANALYTICS_CALCULATION_REGISTRY.md`,
  `docs/REPORTING_NOVA_WRITING_GUIDE.md`, `docs/REPORTING_QUALITY_BENCHMARK.md`)
  y comentarios de docstrings en 12 archivos del backend Django (solo
  prosa, sin código funcional — el backend nunca llamó a Groq/Gemini
  directamente) actualizados de "Groq" a "Gemini". `docs/ROADMAP.md`
  deliberadamente NO tocado — es un log cronológico de fases pasadas, las
  menciones a Groq ahí describen el estado real en el momento de cada fase.

7 mocks de test migrados de `groq-sdk` a `@google/genai`
(`src/__tests__/api/kpis-nova-insights.test.ts`,
`src/__tests__/api/nova-badges-documents.test.ts`,
`src/__tests__/api/assistant-chat.test.ts`,
`src/__tests__/executiveReporting/nova.test.ts`,
`src/__tests__/api/reports-executive.test.ts`), 1 test nuevo en
`src/__tests__/logger.test.ts` para el patrón `AIzaSy...`. `tsc`/Vitest
1100/1100 en verde, `pytest` de los 2 archivos backend tocados en verde.
Verificado en vivo contra la API real de Gemini (Chrome + scripts Node
aislados): `nova-insights` y `assistant/chat` devuelven contenido
generado por IA bien formado (no solo el fallback determinista).

**Impacto:** todo Nova pasa de Groq a Gemini sin cambio de contrato hacia
el resto de la app — mismo shape de respuesta JSON en los 4 endpoints,
mismo comportamiento de degradación a fallback determinista ante cualquier
fallo del proveedor de IA (arquitectura preexistente, sin cambios).

**Autor:** Claude Code (pedido explícito de Anthony Jácome, incluyendo la
API key de Gemini a usar)

---

## v1.144.6 — 2026-08-31

**Tipo:** FIX
**Módulo:** Simulador de Escenarios de Inteligencia Preventiva
(`ScenarioSimulatorPanel.tsx`)

Continuación de la QA en vivo del módulo de Inteligencia (segunda mitad:
Inteligencia Preventiva). 2 bugs reales encontrados ejercitando los 5
escenarios del simulador con datos reales en Chrome (login como
Coordinador Nacional y Jefe Nacional).

**Bug 1 — "Redistribuir carga" siempre fallaba con "Escenario inválido"
en cuanto había un compañero de equipo real:** el selector "Redistribuir
hacia" se llena desde `GET /api/predictive/team-subutilization`, cuya
respuesta trae `members[].userId` (numérico) — el componente esperaba
`members[].id` (`UserOption = { id: string; name: string }`), campo que
esa respuesta nunca tuvo. `m.id` era siempre `undefined`: el filtro
"excluirme a mí mismo" nunca excluía a nadie (`undefined !== userId` es
siempre verdadero) y el `<option>` seleccionado por defecto mandaba
`toUserId: undefined` al simular, rechazado por el backend. Corregido
mapeando `userId` → `id` (con `String()`) al poblar `members`.

**Bug 2 (menor, UI) — el resultado del simulador filtraba un campo
interno de estilo como si fuera un indicador:** `SnapshotTable` iteraba
`Object.keys(before)` sin filtrar, así que cualquier campo del snapshot
de Django sin traducción en `FIELD_LABEL` (p. ej. `cargaColor`, un hint
de color puramente visual, nunca usado para colorear nada en este
componente) se mostraba como una fila cruda con el nombre técnico del
campo y su valor literal (`cargaColor: red / red`). Corregido iterando
`Object.keys(FIELD_LABEL)` filtrado a los presentes en el snapshot, en
vez de todas las claves del objeto.

Verificado en vivo: los 5 escenarios (Agregar horas, Cerrar tareas,
Modificar tiempo objetivo, Redistribuir carga, Agregar participantes)
probados exitosamente tanto desde la vista de equipo (Jefe Nacional)
como desde "Mi actividad" (Coordinador Nacional, self-service). Resto de
Inteligencia Preventiva (predicciones de subutilización/sobrecarga/
retrasos de tareas y proyectos, tendencias históricas, alertas
preventivas individuales y de equipo — 9 rutas de `/api/predictive/*`)
verificado sin hallazgos adicionales. `tsc`/Vitest 1099/1099 en verde (sin
tests nuevos — el componente no tenía cobertura previa, fuera de alcance
de una sesión de QA agregarla retroactivamente).

**Archivos:** `src/components/inteligencia-preventiva/ScenarioSimulatorPanel.tsx`

**Impacto:** el escenario de simulación más usado en la práctica
("¿qué pasa si redistribuyo carga a un compañero?") estaba completamente
roto para cualquier equipo con al menos un miembro real — nunca detectado
porque el componente no tiene tests, y en pruebas manuales previas
probablemente solo se ejercitaron los escenarios sin selector de
colaborador.

**Autor:** Claude Code (QA en vivo del módulo de Inteligencia, pedida por
Anthony Jácome)

---

## v1.144.5 — 2026-08-31

**Tipo:** FIX
**Módulo:** Nova Insights (`kpis/nova-insights/[userId]`) + bundle de
Analytics/Nova (`analytics/[userId]`, `analytics/insights/[userId]`,
`analytics/operational-risk/[userId]`, `analytics/operational-risk/team`,
`kpis/executive`) + `djangoAnalyticsBridge.ts` (Reportes Ejecutivos)

Hallazgo de la QA en vivo del módulo de Inteligencia (Nova + Inteligencia
Preventiva) pedida por el usuario, con datos reales en Chrome. Dos bugs
distintos, ambos previamente indetectados porque la suite de Vitest mockea
`djangoApiFetch` con fixtures ya en camelCase y con `mockResolvedValue`
inmediato — ninguno de los dos escenarios se puede reproducir con mocks.

**Bug 1 (crítico — Nova Insights roto con cualquier dato real desde el
cutover a Django, Fase 54):** `generateAnalytical`/`generateMotivational`
(`kpis/nova-insights/[userId]/route.ts`) nunca aplicaban el adaptador
snake_case→camelCase sobre la respuesta de Django, a diferencia de TODOS
los demás consumidores del mismo bundle (`analytics/[userId]`,
`analytics/operational-risk/[userId]`, `kpis/[userId]`, que sí usan
`mapDjangoAnalyticsPayloadToNexoShape`/`mapDjangoKpiPayloadToNexoShape`).
`bundle.healthScore`/`kpi.cargaTiempo`/etc. eran siempre `undefined` (el
campo real es `health_score`/`carga_tiempo`) — `TypeError: Cannot read
properties of undefined (reading 'score')` en cualquier request real,
nunca solo con el fallback determinista. `fetchDjangoJson` ahora exige un
`mapper` explícito por call site.

**Bug 2 (performance — timeout de 3s insuficiente para el bundle de
Analytics):** `GET /analytics/<id>/` (Django, `AnalyticsBundleView`) no
tiene caché con TTL (gap documentado desde su creación, Fase 4m) — toma
~2.8s solo de cómputo (medido directo en Django) antes del overhead
HTTP/DRF, por encima del `REQUEST_TIMEOUT_MS` genérico (3s) de
`djangoApiFetch` casi siempre. Bajo la concurrencia real de una sola carga
de página (bundle + KPIs + Riesgo Operativo + Motor de Insights + resumen
ejecutivo, todos en paralelo), el mismo timeout genérico también hacía
fallar de forma intermitente al resto de los consumidores de ese
endpoint — incluido `kpis/executive` (`ExecutiveDashboardView`, agregado de
todo el roster visible). El síntoma en todos los casos era un `500` con
el body completamente vacío (Next.js aborta la conexión sin escribir JSON
cuando el `AbortSignal` del timeout dispara fuera del `try/catch` de la
ruta), no un error legible.

Fix: nuevo `ANALYTICS_BUNDLE_TIMEOUT_MS` (12s, `djangoSession.ts`) —
timeout dedicado y más generoso, aplicado únicamente a los consumidores de
este endpoint puntual (`djangoApiFetch`/`callDjango` ganan un 3er parámetro
opcional `timeoutMs`, default sin cambios). El resto de las llamadas a
Django (login, CRUD liviano) se quedan con el default de 3s, que debe
seguir fallando rápido. Cada ruta afectada ahora también atrapa el timeout
explícitamente y responde `504` con un mensaje legible en vez de dejar
que la excepción escape sin traducir.

Verificado en vivo en Chrome (login real, Jefe Nacional viendo a un
Coordinador Nacional): "Análisis del período" (Nova), "Índice de Riesgo
Operativo" y "Motor de Insights" en la pestaña Score de Analytics — los
3 pasaron de "No se pudo cargar"/500 vacío a datos reales. `tsc`/Vitest
1099/1099 en verde (7 mocks de test actualizados para exponer
`ANALYTICS_BUNDLE_TIMEOUT_MS` y no fijar el número exacto de argumentos de
`djangoApiFetch`, que ahora varía por endpoint).

**Archivos:** `src/lib/djangoSession.ts`,
`src/app/api/kpis/nova-insights/[userId]/route.ts`,
`src/app/api/analytics/[userId]/route.ts`,
`src/app/api/analytics/insights/[userId]/route.ts`,
`src/app/api/analytics/operational-risk/[userId]/route.ts`,
`src/app/api/analytics/operational-risk/team/route.ts`,
`src/app/api/kpis/executive/route.ts`,
`src/lib/executiveReporting/djangoAnalyticsBridge.ts`,
`src/__tests__/api/analytics-granular.test.ts`,
`src/__tests__/api/kpis-nova-insights.test.ts`,
`src/__tests__/api/kpis-executive.test.ts`,
`src/__tests__/executiveReporting/djangoAnalyticsBridge.test.ts`

**Impacto:** Nova Insights (recuadro "Análisis del período" en Analytics y
en Equipo) pasa de estar roto con cualquier dato real a funcionar
correctamente. La pantalla de Analytics/KPIs (Resumen Ejecutivo + detalle
individual — Riesgo Operativo, Motor de Insights) deja de fallar de forma
intermitente bajo carga concurrente normal. Reportes Ejecutivos
(`fetchPerformanceAndHealth`) deja de arriesgarse a que un timeout
interrumpa la generación completa del reporte.

**Autor:** Claude Code (QA en vivo del módulo de Inteligencia, pedida por
Anthony Jácome)

---

## v1.144.4 — 2026-08-31

**Tipo:** FIX
**Módulo:** 6 `page.tsx` de rutas protegidas (Proyectos, Reuniones, Equipo,
Tiempo Objetivo, Dashboard) — desajuste de espacio de ids Postgres↔Django

Hallazgo de una prueba integral end-to-end en Chrome real (login →
navegación por todos los módulos → escritura real de datos), continuación
de la verificación de las Fases 87-90. Crear un proyecto dejando la opción
por defecto **"Responsable principal: Yo mismo"** fallaba con `400 {"error":
"Este campo no puede ser nulo."}` — un error real del backend, no de
prueba.

Causa raíz: `src/app/(protected)/projects/page.tsx` pasaba
`currentUserId={session.userId}` (el cuid de Postgres del JWT) al mismo
tiempo que `candidateUsers[].id` ya son ids NUMÉRICOS de Django (Fase 2).
`CreateProjectModal` arma la opción "Yo mismo" con ese cuid;
`Number(cuid)` da `NaN`, y `JSON.stringify(NaN)` serializa como `null` —
Django recibe `"responsible": null` y lo rechaza. Mismo patrón de bug ya
resuelto para Tareas en la Fase 55 (`tasks/page.tsx` ya resuelve el id de
Django vía `fetchDjangoCurrentUserId()`), pero nunca replicado en el resto
de las páginas que comparten componentes con Tareas.

Auditoría completa de `session.userId` en `src/app/(protected)/**/page.tsx`
encontró el mismo defecto en 6 archivos (2 ya con `Number()`/comparación
de igualdad rota, no solo el caso de Proyectos):

- `projects/page.tsx` — "Yo mismo" como responsable (400 al crear, arriba).
- `projects/[id]/page.tsx` — `isParticipant`/permisos de registrar
  actividad por fase nunca detectaban correctamente al usuario propio
  (comparación cuid vs id numérico, silenciosamente falsa siempre).
- `meetings/page.tsx` — `isHost` nunca coincidía (sin controles de
  anfitrión en tus propias reuniones) y el selector de invitados no te
  excluía a vos mismo.
- `team/page.tsx` — autoría de comentarios/actividades rota al ver el
  trabajo de un subordinado desde Equipo (`CommentPanel`/`ActivityPanel`,
  mismos componentes que Tareas, alimentados con el id equivocado).
- `tiempo-objetivo/page.tsx` — `RegularizeTargetTimeManager` no excluía
  tareas propias de la lista validable ni marcaba `isSelf` correctamente.
- `dashboard/page.tsx` — "Nueva tarea"/"Nueva reunión" (Acciones Rápidas)
  heredaban el mismo bug de auto-asignación/auto-designación de anfitrión
  que Proyectos.

`kpis/page.tsx` tiene el mismo valor incorrecto pasado a `AnalyticsModule`
→ `KpisModule`, pero ese componente destructura `currentUserId: _uid` sin
usarlo — prop muerta, sin impacto real, no se tocó.

Fix: las 6 páginas ahora resuelven el id numérico de Django server-side
(`fetchDjangoCurrentUserId()`/`resolveDjangoUserId()`, ya existentes) y lo
pasan con el mismo criterio de degradación del resto de la migración —
`djangoUserId ?? session.userId` (nunca rompe la página si Django no
responde). `projects/[id]/page.tsx` y `dashboard/page.tsx` ya resolvían el
id para otro propósito (`isResponsibleOrCreator`/`view-preferences`) y solo
necesitaron reusarlo.

Ninguno de los 1099 tests de Vitest detectaba este defecto (estas páginas
`page.tsx` no tienen test directo) — confirma que fue necesaria la
verificación en navegador real para encontrarlo. Verificado visualmente:
recrear el proyecto con "Yo mismo" ahora funciona (`Responsable: Coordinador
Nacional`, sin error). `npx tsc --noEmit` limpio, `npx vitest run`
1099/1099 sin regresiones.

---

## v1.144.3 — 2026-08-31

**Tipo:** FIX
**Módulo:** `src/app/api/dashboard/nova-message/route.ts` +
`src/app/api/kpis/nova-insights/[userId]/route.ts`

Hallazgo de la misma prueba integral en Chrome real: `POST
/api/dashboard/nova-message` devolvía `500` en TODAS las requests. Causa
raíz: `groq-sdk` lanza una excepción SÍNCRONA en su constructor cuando
`GROQ_API_KEY` no está definida ("The GROQ_API_KEY environment variable is
missing or empty..."), y ambas rutas construían el cliente `new Groq(...)` a
nivel de MÓDULO — antes de llegar a los guards `if (!process.env.GROQ_API_KEY)`
que esas mismas rutas ya tenían más abajo para degradar a un mensaje
determinista. El guard nunca se alcanzaba: el módulo completo fallaba al
cargar y Next.js devolvía 500 a cualquier request, sin importar el guard.
`src/lib/executiveReporting/nova/generateNarrative.ts` (mismo propósito,
Reportes Ejecutivos) sí seguía el patrón correcto — chequeo temprano antes
de construir el cliente — y sirvió de referencia para el fix.

Fix: el cliente Groq pasa a construirse de forma perezosa, después del
guard existente — en `nova-message/route.ts` inline dentro del `try`
(un solo call site); en `nova-insights/[userId]/route.ts` vía un accesor
`getGroqClient()` memoizado (dos call sites, cada uno ya detrás de su
propio guard). Ningún test de Vitest lo detectaba porque mockean
`groq-sdk` (el constructor real nunca se ejecuta ahí) — confirma otra vez
que hizo falta un navegador real contra un proceso real sin
`GROQ_API_KEY` configurada (caso real de este entorno de desarrollo, no
solo hipotético).

Verificado en Chrome: `POST /api/dashboard/nova-message` pasa a responder
`200` con el mensaje de fallback determinista correcto. `npx tsc --noEmit`
limpio, `npx vitest run src/__tests__/api/dashboard.test.ts
src/__tests__/api/kpis-nova-insights.test.ts` 20/20.

---

## v1.144.2 — 2026-08-28

**Tipo:** FIX
**Módulo:** `src/lib/djangoUsersAdapter.ts` (listado administrativo de Usuarios)

Hallazgo durante verificación funcional end-to-end en navegador real (Chrome,
post Fases 87-90 + cierre del gap `notification_rules`): la pantalla
`/admin/users` mostraba **"Pendiente"** en la columna Consentimiento para
todos los usuarios, incluso para uno que acababa de aceptar el `ConsentGate`
en la misma sesión de prueba.

Causa raíz: el backend Django (`UserAdminListSerializer`, desde la Fase 86)
ya expone `data_consent_accepted`/`data_consent_accepted_at`, pero el
adaptador de la Fase 2 (`DjangoUser`/`mapDjangoUserToNexoShape`, que traduce
la forma de Django a la que espera `UsersManager.tsx`) nunca los incluía —
quedaban `undefined` en el objeto mapeado, y `UsersManager.tsx` los trata
como *falsy*. Regresión propia de la migración de stack: el `ConsentGate`
(Fase 86) lee `/auth/me/`, un endpoint distinto de `/admin/users/`, así que
nadie había ejercitado esta ruta desde que el campo se agregó al backend.

Fix: se agregan `data_consent_accepted`/`data_consent_accepted_at` al tipo
`DjangoUser` y `dataConsentAccepted`/`dataConsentAcceptedAt` a
`NexoUserShape`, mapeados en `mapDjangoUserToNexoShape` — cubre los 3
consumidores de esa función (`GET`/`POST /api/users`, `GET /api/users/[id]`)
sin cambios de backend (el serializer ya los devolvía).

Verificado visualmente en Chrome tras el fix: el usuario que había aceptado
el consentimiento pasó a mostrar "Aceptado · 28 ago 2026, 17:20"; el que
nunca inició sesión siguió en "Pendiente", como corresponde.

`npx tsc --noEmit` limpio, `npx vitest run` 1099/1099 sin regresiones.

---

## v1.144.1 — 2026-08-28

**Tipo:** FIX
**Módulo:** Cierre del gap `notification_rules` → `apps/tasks/services.py`

`comment_targets`/`first_comment_role`/`retroactive_notify_roles`
(`/settings/notification-rules/`, editable desde Ajustes desde la Fase 35)
ya tienen efecto real: `CommentService.create_comment` y
`ActivityService.create_retroactive_activity` (`backend/apps/tasks/services.py`)
dejan de usar la jerarquía fija (`RoleNotificationTarget`) y la constante
hardcodeada `RETROACTIVE_NOTIFY_ROLES` (retirada) — ahora leen
`get_effective_notification_rules()`. Bajo la configuración por defecto
(sin override guardado) el comportamiento es idéntico al anterior.

`first_comment_role` (rol notificado además en el primer comentario de una
tarea) tiene consumidor por primera vez — antes no tenía ningún efecto
observable, ni en Django ni en el legacy TS original.

Salvaguarda nueva: el autor de un comentario nunca se auto-notifica, aunque
la configuración lo incluya como destinatario de su propio rol — la
jerarquía fija anterior nunca permitía esto por diseño ("hacia arriba"),
la config libremente editable sí lo permite sin esta salvaguarda.

Fuera de alcance: `apps/analytics/services.py::notify_if_high_risk` (mismo
patrón de jerarquía hardcodeada, pero consumidor distinto sin campo propio
en la config).

`pytest apps/tasks apps/configuration apps/analytics` 1034/1034 (5 tests
nuevos), `pytest apps/` completo sin regresiones. Ver `docs/AUDIT_LOG.md` §
2026-08-28.

---

## v1.144.0 — 2026-08-28

**Tipo:** REFACTOR / BREAKING CHANGE
**Módulo:** Migración de stack — Fases 87-90: cierre COMPLETO del punto 14 del roadmap — decommission total de Prisma/PostgreSQL del código

Cierra el último punto abierto de la migración de stack (14 de 14). 4
sub-fases:

- **Fase 87** — `resolveRoster.ts` reconectado a `GET /reports/roster/`
  (nueva `RosterView`, Django), composición sobre primitivas de jerarquía
  ya probadas (`get_visible_groups`/`is_executor_group`/`scope_for_role`).
- **Fase 88** — `computeDataQuality`/`recordEngineVersionIfChanged`
  reconectados a `GET /analytics/diagnostics/` (nueva
  `AnalyticsDiagnosticsView`), reusa `compute_data_quality` (ya vivo en
  Django con 3 consumidores reales) + los helpers genéricos de config ya
  usados por 6+ configuraciones del Centro de Configuración.
- **Fase 89** — comparación mes-anterior del Índice Ejecutivo reconectada
  a `GET /reports/monthly-report/` (nueva `MonthlyReportView` mínima) —
  mismo comportamiento exacto, `MonthlyReport` nunca recibió escrituras
  desde el inicio de esta migración.
- **Fase 90** — eliminación completa del código: `package.json` (4
  dependencias + 1 devDependency), `prisma.config.ts`, `prisma/` (schema +
  48 migraciones + seed), `src/lib/prisma.ts`, `src/generated/prisma/`, 2
  scripts de backfill inservibles sin Postgres, mock global de Prisma en
  Vitest, `.env.example`/`.gitignore`, `CLAUDE.md`/`docs/ARCHITECTURE.md`.

**Hallazgo no trivial:** 79 archivos importaban solo TIPOS (no el cliente
runtime) desde `@/generated/prisma/client`. Cada uno se redefinió como
union type local en su módulo dueño de dominio — `Role` (74 de los 79
imports) se movió a `src/lib/roles.ts`; el resto (`ReportScope`,
`ExecutiveReportType`/`PeriodStatus`/`Origin`/`Integrity`,
`MonthClosureType`, `DataRequestType`/`Status`, `Reminder*`, `DeskNote*`,
`EndDateApprovalStatus`/`AuditAction`) a los adaptadores/componentes que
ya eran dueños de ese dominio.

`pytest apps/` sin regresiones (subset `reports`/`analytics` 826/826 +
suite completa), `npx tsc --noEmit`/`npx eslint src` limpios, `npx vitest
run` 1099/1099, `npm install` (97 paquetes retirados), `npx next build`
verificado sin `prisma generate`/`prisma migrate deploy` en el pipeline.

Fuera de alcance, confirmado con el usuario: el servicio de Windows
`postgresql-x64-16`/hosting Neon no se tocan — posible presencia de datos
reales de personal, decisión legal/de producto aparte.

Con esto, los 14 puntos del roadmap de migración de stack quedan
COMPLETO/CUTOVER 100% a nivel de código. Ver `docs/AUDIT_LOG.md` §
2026-08-28 (Fases 87-90).

---

## v1.143.0 — 2026-08-28

**Tipo:** REFACTOR
**Módulo:** Migración de stack — Fase 86: cutover de los últimos 6 archivos sin explorar de `src/lib/*`/páginas SSR

Cierra los últimos consumidores directos de Prisma detectados desde la
Fase 84: `notificationRules.ts`, `projectPhaseStats.ts`,
`resolveRoster.ts` y 4 páginas SSR (`dashboard/page.tsx`, `layout.tsx`,
`projects/page.tsx`, `projects/[id]/page.tsx`). 5 de 6 resultaron
reconexión simple contra endpoints Django ya completos:

- `notification-rules` → `NotificationRulesView` (Django, Fase 35), vía
  nuevo `src/lib/djangoNotificationRulesAdapter.ts`.
- `projects/page.tsx` → `GET /projects/` (Django, Fase 5f) +
  `fetchAllDjangoUsers()` para `candidateUsers`.
- `dashboard/page.tsx` → `GET /users/<id>/view-preferences/` llamado
  directo desde la página, reusando el precedente exacto que ya existía
  en `tasks/page.tsx`.
- `projects/[id]/page.tsx` → `GET /projects/<id>/`, cierra
  `projectPhaseStats.ts` (sus 2 funciones ya resueltas en
  `mapDjangoProjectDetailToNexoShape`).
- `layout.tsx` → `GET /auth/me/`, tras agregar `data_consent_accepted` a
  `UserPublicSerializer` (Django, aditivo).

**Hallazgo durante la implementación:** `projectAccess.ts` comparaba el
`cuid` de Postgres de `session.userId` contra ids que, en la forma
Django, pasan a ser el id numérico — nunca hubiera coincidido. Django ya
hace ese control de acceso server-side con la misma fórmula exacta
(`CanAccessProject`/`CanManageProject`/`CanDeleteProject`), así que la
página delega el 403/404 y solo recalcula `canManage`/`canDelete`
localmente contra el id numérico. `projectAccess.ts` quedó sin
consumidores y se eliminó.

`resolveRoster.ts` queda fuera de alcance (lógica propia de Reportes
Ejecutivos sin equivalente Django). El gap ya documentado desde la Fase
35 (`apps/tasks/services.py` sin leer `notification_rules`) se mantiene,
no se cierra en esta fase.

`pytest apps/` 461/461 (subset relevante), `npx vitest run` 1101/1101,
`tsc`/`eslint` limpios. Ver `docs/AUDIT_LOG.md` § 2026-08-28 (Fase 86).

---

## v1.142.0 — 2026-08-27

**Tipo:** REFACTOR
**Módulo:** Migración de stack — Fase 85: reconexión del bloque "Predictivo" de Reportes Ejecutivos a Django (reuso, no construcción nueva)

Investigar con 3 agentes en paralelo si `predictionEngine.ts`/
`capacityForecast.ts`/`trendEngine.ts` requerían endpoints Django nuevos
reveló que ya son réplicas exactas de código que Django sirve en vivo
desde la Fase 48 (`/inteligencia-preventiva`). En vez de portar o
construir motor nuevo, `buildPredictivoForCurrentMonth` pasa a llamar
directamente al bundle Django ya existente.

Se agregó `?as_of=` a `PredictionBundleView` (antes solo aceptaba
"ahora") y una vista batch nueva (`POST
/reports/executive/team-subutilization/`) que acepta un roster
explícito de usuarios en vez de derivarlo de la jerarquía del actor —
ambos cambios mínimos, reutilizando el 100% de la lógica de cálculo ya
portada.

**Limpieza en cascada:** verificar función por función (no archivo por
archivo) reveló que, una vez cortado `predictionEngine.ts`, TODA la
cadena que lo alimentaba quedaba muerta: `capacityForecast.ts`,
`trendEngine.ts`, `analyticsAuditHistory.ts` (archivos completos),
`analytics.ts::computeWeeklyHistory/computeConsistency/
computeEffectiveHistoryStart`, y en cascada `workload.ts::
sumWeightedBaseHours` — lo que a su vez dejó `leaves.ts`/
`specialStatus.ts` completos sin ningún consumidor real. Ambos se
eliminaron, cerrando sin necesitar ningún endpoint nuevo un backlog que
la Fase 84 había dejado pendiente para "una fase futura".

`pytest apps/` 1831/1831, `npx vitest run` 1105/1105, `tsc`/`eslint`
limpios. Ver `docs/AUDIT_LOG.md` § 2026-08-27 (Fase 85).

---

## v1.141.0 — 2026-08-27

**Tipo:** FIX
**Módulo:** Migración de stack — Fase 84: reconexión del motor interno a Django (cierra 3 bugs activos de divergencia) + limpieza masiva de código muerto

Investigando cómo continuar la reconexión de `src/lib/*` a Django, se
encontraron y cerraron 3 bugs activos de divergencia de datos (mismo
patrón que las Fases 52/60): `holidays.ts` (feriados agregados desde
Ajustes eran invisibles para el motor de KPIs), `workload.ts` vía
`systemConfig.ts` (límites de carga laboral), y `closurePeriod.ts` +
`executiveReporting/periodStatus.ts` (Motor de Cierre Inteligente) —
todos leían Postgres pese a que sus rutas de administración ya escriben
en Django desde hace fases.

`ClosureStatusView` (Django) se extendió con 4 campos que le faltaban
para cubrir también `buildSnapshotData.ts::closureMetaFrom`, no solo la
vista previa. Se cortan además 3 `route.ts` que nunca se habían
conectado pese a tener vista Django lista desde las Fases 31/32:
`analytics-config`, `normalization-curves`, `prediction-window`.

**Limpieza de código muerto** (huérfano de cutovers anteriores, mismo
patrón que la Fase 74): 12 archivos `src/lib/*` completos + 39 funciones
muertas dentro de `analytics.ts`/`workload.ts`/`predictionEngine.ts`/
`reportInsights.ts`/`systemConfig.ts` (más de 3700 líneas retiradas en
total).

`pytest apps/` 1821/1821, `npx vitest run` 1128/1128, `tsc`/`eslint`
limpios. Ver `docs/AUDIT_LOG.md` § 2026-08-27 (Fase 84).

---

## v1.140.0 — 2026-08-27

**Tipo:** FEATURE
**Módulo:** Migración de stack — Fase 83: port de `MonthlyReport`/`DataPurgeLog` (retención/purga LOPDP) a Django

Cierra el backlog dejado por la Fase 81: `MonthlyReport`/`DataPurgeLog`
resultaron ser una feature con consumidor activo real
(`src/lib/retentionPolicy.ts`/`buildSnapshotData.ts`), no datos
históricos congelados. Se agregan 2 modelos Django nuevos (sin
`legacy_postgres_id` ni comando de importación — decisión explícita del
usuario en la Fase 82 de no migrar datos históricos reales) y el
servicio de purga completo (`find_purge_candidates`/`execute_purge`,
réplica exacta del TS) en `backend/apps/configuration/services.py`.

Nueva vista `RetentionPolicyPurgeView`
(`GET/POST /api/v1/settings/retention-policy/purge/`) — con esto, el
catálogo `settings/*` queda cerrado al 100% (era el único endpoint
pendiente, documentado desde la Fase 31).

**Cutover de `route.ts`:** `retention-policy/route.ts` (config, que
nunca se había cortado pese a que Django lo soportaba desde la Fase 31)
y `retention-policy/purge/route.ts` pasan a Django vía el nuevo
`src/lib/djangoRetentionAdapter.ts`. `src/lib/retentionPolicy.ts`
(Prisma) se elimina — sin consumidores tras el cutover.

**Diseño no trivial:** la limpieza de GitHub de documentos purgados
(best-effort) se reordena — Django borra en la base primero y devuelve
la lista de documentos borrados; `route.ts` limpia GitHub después. Ya
era best-effort en el TS original, así que el resultado final es
idéntico y se evita una segunda ida y vuelta HTTP.

`pytest apps/` 1820/1820, `npx vitest run` 1228/1228, `tsc`/`eslint`
limpios. Ver `docs/AUDIT_LOG.md` § 2026-08-27 (Fase 83).

---

## v1.139.1 — 2026-08-27

**Tipo:** DOCUMENTATION
**Módulo:** Migración de stack — Fase 82: decisión de producto, la migración de DATOS reales queda descartada

Tras la Fase 81 (código de los 40 comandos de importación completo y
verificado con datos sintéticos), el usuario pidió avanzar con el
único paso pendiente documentado: ejecutarlos contra el Postgres de
producción real. Al investigar el bloqueo (ninguna `LEGACY_POSTGRES_URL`
real configurada en ningún entorno de esta migración, pese a existir un
PostgreSQL 16 real corriendo localmente) y preguntar por credenciales/
destino, el usuario aclaró explícitamente que no quiere recuperar
ningún dato histórico real — las pruebas de funcionalidad siguen
usando siempre datos ficticios.

**Decisión:** la ejecución real de los 40 comandos contra Postgres
queda descartada, no diferida. El código (Fases 80-81) se conserva
intacto, sin ejecutar contra producción. Sin cambios de código en este
cambio — corrección documental de `docs/VERSION.md`/`docs/ROADMAP.md`/
`docs/DECISIONS.md` para reflejar la decisión. Ver `docs/AUDIT_LOG.md`
§ 2026-08-27 (Fase 82).

---

## v1.139.0 — 2026-08-27

**Tipo:** FEATURE
**Módulo:** Backend Django — Fase 81: Waves 1-4 completas (38 comandos) — código de migración de datos reales 100% escrito y verificado

Continuación directa de la Fase 80 (v1.138.0) — el usuario pidió
finalizar toda la "Fase A". Los 38 comandos restantes de las Waves 1-4
(`Task`, `Comment`, `TaskActivity`, `Announcement`, `KnowledgeDocument`,
`DocumentChunk`, `ImprovementIdea`, `IdeaVote`, `IdeaStatusHistory`,
`Meeting`, `MeetingInvitee`, `DataSubjectRequest`,
`SystemConfigHistory`, `LeaveRecord`, `SpecialStatus`, `Project` + sus
6 sub-entidades, `AnalyticsAuditLog`, `MonthClosure`,
`ExecutiveReportSnapshot`/`ExecutiveReportAuditLog`, `TaskCommentView`,
`TargetTimeAuditLog`, `EndDateAuditLog`, `Notification`,
`PersonalReminder`, `ActivityComment`, `ActivityAuditLog`, `DeskNote`+
`DeskNoteReply`+`DeskAuditLog`, `RecoveryItem`/`RecoveryAuditLog`),
todos usando el módulo compartido de la Fase 80.

**Decisión de alcance:** `MonthlyReport`/`DataPurgeLog` quedan
explícitamente fuera — resultaron ser una feature con consumidor activo
real (`retentionPolicy.ts`/`buildSnapshotData.ts`), no datos históricos
congelados; documentados como backlog aparte en `docs/ROADMAP.md`.

**Hallazgo de corrección en `bulk_import_rows`** (mismo módulo
compartido): un modelo sin timestamp legacy real para algún campo
`auto_now` (`MeetingInvitee`) reveló que la corrección pisaba con
`NULL` el valor "ahora" correcto que `bulk_create` ya había generado —
corregido para solo aplicar corrección cuando hay un valor legacy real
(no `None`); de paso se envolvió la operación completa en
`transaction.atomic()`.

**Casos de FK no triviales resueltos:** referencias sueltas numéricas
con resolución dinámica según tipo (`DeskAuditLog.entity_id`), campo
autorreferencial resuelto en 2 fases (`ProjectDocument.previous_version_id`).

**Archivos:** 38 comandos nuevos en
`backend/apps/{tasks,announcements,assistant,ideas,meetings,data_requests,configuration,projects,analytics,reports,notifications,desk,recovery}/management/commands/`,
`backend/apps/core/legacy_migration.py` (fix de `bulk_import_rows`).

**Impacto:** el código de la migración de datos reales queda 100%
completo y verificado end-to-end contra datos sintéticos (cadena
completa de dependencias, re-ejecución idempotente). Lo único
pendiente para un corte real a producción es ejecutar los 40 comandos
contra el Postgres real — un paso operativo, no de desarrollo. Sin
impacto en producción — código nuevo, sin ejecución contra datos
reales. `pytest apps/` 1813/1813 sin regresiones.

**Autor:** Claude Code (dirigido por dpenarreta)

---

## v1.138.0 — 2026-08-27

**Tipo:** FEATURE
**Módulo:** Backend Django — Fase 80: prerrequisitos de migración de datos reales + patrón compartido + Wave 0

Primer paso concreto de la "Fase A" (migración de DATOS reales,
hallazgo del mismo día, v1.137.1) — el usuario pidió iniciarla
completa; se propuso y aprobó (Plan Mode) un enfoque por fases en vez
de escribir las ~40 entidades de una sola pasada.

**Esquema:** `legacy_postgres_id = models.CharField(max_length=30, unique=True, null=True, blank=True)`
agregado a los 40 modelos Django en alcance, 13 apps (`tasks`,
`configuration`, `announcements`, `assistant`, `ideas`, `meetings`,
`data_requests`, `projects`, `analytics`, `reports`, `notifications`,
`desk`, `recovery`), 13 migraciones nuevas, todas aplicadas.

**Módulo compartido** `backend/apps/core/legacy_migration.py`
(`legacy_postgres_connection`/`fetch_legacy_rows`/
`filter_not_yet_imported`/`safe_batch_size`/`bulk_import_rows`),
reutilizable por las 36 entidades restantes sin cambios. 2 hallazgos de
corrección resueltos ahí, el segundo descubierto durante la
verificación con datos sintéticos (no anticipado en el plan original):
`mssql-django` no soporta `bulk_create(ignore_conflicts=True)`
(idempotencia resuelta prefiltrando en vez de dejar que la base ignore
conflictos); `bulk_create` SÍ dispara `auto_now`/`auto_now_add` (la
premisa inicial de que lo esquivaba era incorrecta, verificado
reproduciendo el bug) — corregido con un `bulk_update()` de corrección
inmediato tras el `bulk_create()`.

**Wave 0** — 2 comandos nuevos: `migrate_activity_reasons_from_postgres`
(`backend/apps/tasks/management/commands/`),
`migrate_holidays_from_postgres`
(`backend/apps/configuration/management/commands/`). Verificados con
datos sintéticos (Postgres descartable vía Docker, sin dejar
infraestructura permanente): filas creadas con `legacy_postgres_id`
correcto, timestamps legacy preservados, re-ejecución idempotente.

**Archivos:** `backend/apps/{tasks,configuration,announcements,assistant,ideas,meetings,data_requests,projects,analytics,reports,notifications,desk,recovery}/models.py`
(+ 13 migraciones), `backend/apps/core/legacy_migration.py` (nuevo),
`backend/apps/tasks/management/commands/migrate_activity_reasons_from_postgres.py`
(nuevo), `backend/apps/configuration/management/commands/migrate_holidays_from_postgres.py`
(nuevo).

**Impacto:** cimiento reutilizable para las 36 entidades restantes
(Waves 1-4, documentadas como backlog en `docs/ROADMAP.md`), con 2
bugs de corrección ya resueltos que de haberse ignorado habrían
corrompido timestamps históricos reales en un corte de verdad. Sin
impacto en producción — código nuevo, sin wiring HTTP, sin ejecución
contra datos reales todavía. `pytest apps/` 1813/1813 sin regresiones.

**Autor:** Claude Code (dirigido por dpenarreta)

---

## v1.137.1 — 2026-08-27

**Tipo:** DOCUMENTATION
**Módulo:** Corrección — "migración de stack 100% completa" conflacionaba cutover de ruta con migración de datos reales

El usuario preguntó qué falta para levantar el sistema con exactamente
los mismos datos y comportamiento que el sistema anterior. La
investigación reveló que `docs/VERSION.md`/`docs/ROADMAP.md`
afirmaban "solo falta ejecutar `migrate_users_from_postgres`" como si
fuera el único paso pendiente — engañoso por omisión: ese es el ÚNICO
comando de migración de datos que existe en TODO el backend, y solo
migra Usuarios. No existe ningún comando equivalente para ~40
entidades de negocio más (Tareas, Proyectos, Comentarios, Reuniones,
Ideas, Notificaciones, Notas del Escritorio, Solicitudes LOPD,
Feriados/Permisos, Configuración, Base de Conocimiento, Comunicados,
Papelera). De los 44 modelos de Prisma, 42 ya tienen modelo Django
equivalente (esquema listo) — falta el código de transferencia. Sin
mecanismo de escritura dual, así que Django nunca acumuló datos reales
en paralelo desde ningún cutover.

- **`docs/VERSION.md`/`docs/ROADMAP.md` corregidos** para distinguir
  "cutover de ruta" (código, 100% completo) de "migración de datos
  reales" (pendiente en su totalidad salvo Usuarios).
- **Nuevo ítem de backlog trackeable** en `docs/ROADMAP.md` §
  Planificado — más urgente que Sprint S/T/U (funcionalidad nueva),
  ya que es el verdadero bloqueante para un corte real a producción.
- **Sin código escrito** — el alcance de escribir los ~40 comandos de
  migración queda pendiente de decisión con el usuario, no se
  emprendió en este cambio.

**Archivos afectados:**
- `docs/VERSION.md`
- `docs/ROADMAP.md`

**Impacto:** ninguno sobre producción — cambio puramente documental
que corrige una afirmación propia engañosa por omisión, antes de que
alguien tomara una decisión de corte real basada en ella.

**Autor:** Claude Code

---

## v1.137.0 — 2026-08-27

**Tipo:** FEATURE
**Módulo:** Fase 79 — Sprint R: Snapshot Integrity Validation

Cierra "Sprint R" (diferido desde 2026-07-28): el FPS Parte IV §15
exige que los valores de un reporte ejecutivo coincidan con
Dashboard/Analytics para la misma fecha de corte, y que una
discrepancia se registre como incidente. Agrega la validación ACTIVA
en tiempo de ejecución que en su momento se difirió, complementando
(no reemplazando) la integridad ESTRUCTURAL ya cumplida por diseño.

- **Investigación previa reveló 2 gaps del FPS, resueltos con el
  usuario:** `GET /api/dashboard` no tiene KPIs para comparar
  ("Dashboard/Analytics" se interpreta como `GET /kpis/team/`+
  `GET /analytics/<id>/`); `TeamKpiView` no es consciente de la fecha
  de corte de un reporte — la validación solo corre para reportes
  MENSUAL del mes calendario en curso SIN `fechaCorte` explícita,
  único caso donde ambas superficies miran el mismo momento.
- **Modelo Django nuevo `ExecutiveReportIntegrityIncident`**
  (`backend/apps/reports/models.py`) — mismo patrón que
  `ExecutiveReportAuditLog` (campos sueltos sin FK, append-only, sin
  ciclo de vida de resolución en esta primera versión). Nuevo endpoint
  `POST /reports/executive/integrity-incidents/`.
- **Nuevo `src/lib/executiveReporting/verifySnapshotIntegrity.ts`** —
  corre en paralelo con Índice Ejecutivo/Predictivo dentro de
  `buildMonthlySnapshotData` (nunca agrega latencia secuencial),
  compara `completedPct`/`cargaPct` contra `GET /kpis/team/` con
  tolerancia de ±0.5 puntos, registra un incidente por discrepancia
  real. Best-effort, nunca lanza — mismo principio que NOVA (FPS §8):
  nunca bloquea ni hace fallar la generación del reporte que audita.
- **Nuevo campo `integrityCheck` en `ExecutiveReportSnapshotData`** —
  mismo espíritu que `novaDegraded`, visibilidad sin bloquear nada.

**Archivos afectados:**
- `backend/apps/reports/models.py` (+ migración nueva)
- `backend/apps/reports/serializers.py`
- `backend/apps/reports/views.py`
- `backend/apps/reports/urls.py`
- `backend/apps/reports/tests/test_executive_reports.py`
- `src/lib/executiveReporting/verifySnapshotIntegrity.ts` (nuevo)
- `src/lib/executiveReporting/buildSnapshotData.ts`
- `src/lib/executiveReporting/snapshotData.ts`
- `scripts/backfill-executive-report-snapshots.ts`
- `src/__tests__/executiveReporting/verifySnapshotIntegrity.test.ts` (nuevo)
- `src/__tests__/executiveReporting/buildSnapshotData.test.ts`
- `src/__tests__/executiveReporting/documentModel.test.ts`

**Impacto:** cierra Sprint R sin cambio de comportamiento visible para
el usuario final del reporte — los incidentes se registran en Django,
sin UI todavía (fuera de alcance de esta fase, junto con RANGO_MESES/
RANGO_PERSONALIZADO/reportes con corte explícito y el Índice
Ejecutivo, deliberadamente no comparados). `pytest apps/reports`
166/166, suite completa del backend 1813/1813 en verde. `npx tsc
--noEmit`/`npx eslint` limpios, suite completa de Vitest **1233/1233
en verde** (97 archivos, +7 tests). `ruff check` limpio.

**Autor:** Claude Code

---

## v1.136.0 — 2026-08-27

**Tipo:** PERFORMANCE
**Módulo:** Fase 78 — gunicorn pasa a `gthread` (workers × threads): fix de configuración de despliegue para el hallazgo de la Fase 77

Fix directo del hallazgo de severidad alta de la Fase 77 (`POST
/api/reports/executive?tipoReporte=MENSUAL` puede fallar con 500 para
el mes en curso). Investigación previa (solo lectura) reveló que la
causa no está en el código de aplicación sino en la configuración de
despliegue: `backend/entrypoint.sh` arranca gunicorn con `--workers 3`
sin `--threads` — el worker `sync` por defecto atiende 1 request a la
vez por worker, así que producción solo puede procesar 3 requests HTTP
simultáneas en total. Con 9-11 llamadas paralelas por reporte (una por
colaborador, Índice Ejecutivo), 6-8 quedan en cola detrás de los 3
workers — la aritmética de esa cola (⌈11/3⌉ rondas × ~1.5s) coincide
con precisión con el rango medido en la Fase 77 (5-9s).

- **`backend/entrypoint.sh`**: se agrega `--worker-class gthread
  --threads "${GUNICORN_THREADS:-4}"` al comando de gunicorn. Se elige
  subir threads en vez de workers porque la carga es de I/O (espera de
  red hacia SQL Server, no CPU — el cómputo puro mide ~0.28s por la
  Fase 77) — un worker `gthread` atiende varios requests I/O-bound
  concurrentes dentro del mismo proceso, mucho más barato en memoria
  que clonar el proceso completo de Django por cada unidad de
  concurrencia. Capacidad total: de 3 a 12 requests simultáneas con los
  defaults (`--workers 3 --threads 4`).
- **Sin re-verificar contra gunicorn real** — decisión explícita del
  usuario, entre 3 opciones presentadas, de aplicar el ajuste razonado
  ahora en vez de bloquear en reconstruir el entorno sintético una vez
  más. Documentado como tal en el propio comentario de `entrypoint.sh`.

**Archivos afectados:**
- `backend/entrypoint.sh`

**Impacto:** si la aritmética de cola identificada es la causa real
(alta confianza, no confirmación empírica nueva), este cambio debería
resolver o mitigar sustancialmente el 500 activo de la Fase 77 sin
tocar código de aplicación Python/TypeScript. Queda pendiente, sin
urgencia, una re-medición con `scripts/bench-executive-report.ts`
contra un despliegue real para confirmar el número post-fix.

**Autor:** Claude Code

---

## v1.135.0 — 2026-08-26

**Tipo:** PERFORMANCE
**Módulo:** Fase 77 — re-medición de Sprint Q: hallazgo de severidad alta, `POST /api/reports/executive?tipoReporte=MENSUAL` puede fallar activamente (500) para el mes en curso

Re-medición del rendimiento de Reportes Ejecutivos ("Sprint Q" en
`docs/ROADMAP.md`), con infraestructura sintética descartable
(Postgres + Django, mismo método de la Fase 70). El resultado cambia
la naturaleza del problema: **ya no es "lento pero funciona" — es una
falla activa (500) para reportes MENSUAL del mes en curso** cuando el
equipo tiene varios colaboradores.

- **Causa raíz aislada con 3 mediciones independientes:** el cálculo
  puro (`compute_performance_score`/`compute_health_score`, Django) es
  rápido (~0.28s). Una sola llamada HTTP a `GET /analytics/<id>/`
  aislada tarda ~1.2-1.8s. Pero bajo la concurrencia REAL que usa
  `buildMonthlySnapshotData` (N llamadas en paralelo, una por
  colaborador), cada llamada tarda entre 5.0s y 9.0s — muy por encima
  del timeout de cliente de `djangoApiFetch` (3 segundos), que aborta
  la llamada y hace fallar toda la generación del reporte con un 500.
- **`scripts/bench-executive-report.ts` reescrito** — el patrón
  anterior (llamar a los builders directamente, sin HTTP/sesión) dejó
  de ser viable desde que `buildMonthlySnapshotData` depende de
  `cookies()` de `next/headers` (Fase 57), que lanza fuera de un
  request real de Next.js. El script ahora hace login real y llama al
  endpoint de producción real (`POST /api/reports/executive`), leyendo
  `generationMs` de la respuesta — mide el camino exacto de un usuario
  real. Queda con manejo de errores por sección.
- **RANGO_MESES/RANGO_PERSONALIZADO no están afectados** — nunca
  llaman a la ruta de Índice Ejecutivo (solo aplica al mes en curso);
  ambos midieron cómodamente dentro del presupuesto de 15s (3.64s y
  2.58s con 11 colaboradores).
- **Bonus incidental:** durante la medición se usó el comando REAL de
  producción `migrate_users_from_postgres` (apuntado temporalmente a
  la BD sintética) para importar los usuarios a Django — funcionó
  13/13 sin fallos, validación adicional de que ese comando (el único
  paso operativo pendiente de la migración de stack, bloqueado por
  falta de `LEGACY_POSTGRES_URL` real) está en buen estado.
- **Salvedad metodológica documentada:** la medición usó `manage.py
  runserver` (dev, un proceso), no necesariamente representativo de
  producción (`gunicorn`/`uwsgi`, pooling de conexiones). La magnitud
  exacta podría diferir en producción, pero el margen de seguridad del
  timeout de 3s frente a una llamada que aislada ya tarda 1.2-1.8s es
  mínimo bajo cualquier servidor.

**Archivos afectados:**
- `scripts/bench-executive-report.ts` (reescrito, permanece)

**Impacto:** cierra la pregunta de si Sprint Q seguía vigente tras la
migración de stack — sí, y con más urgencia de la que el backlog
original describía. No se implementó ninguna corrección todavía (esta
fase fue deliberadamente solo de medición) — queda pendiente una fase
de optimización separada, a definir con el usuario (aumentar el
timeout, batch-ificar `predictionEngine.ts`, construir un endpoint
batch en Django, investigar la causa de la degradación bajo
concurrencia). `npx tsc --noEmit`/`npx eslint` limpios. Toda la
infraestructura descartable de la medición (Postgres, usuarios
sintéticos en Django, `.env` temporal) fue eliminada — el repo queda
igual que antes salvo el script fijo y esta documentación.

**Autor:** Claude Code

---

## v1.134.1 — 2026-08-26

**Tipo:** DOCUMENTATION
**Módulo:** Migración de stack — cierre formal: consolida el estado final tras la Fase 76, deja constancia de que solo queda un paso operativo (no de código) pendiente

Con Centro de Configuración cerrado (Fase 76), se re-auditó
`docs/ROADMAP.md` completo — los 14 puntos numerados de la migración
de stack quedan todos en estado COMPLETO/CUTOVER 100%, salvo uno: la
ejecución real de `migrate_users_from_postgres` contra la base
Postgres legacy, bloqueada por falta de credenciales reales de
`LEGACY_POSTGRES_URL` en este entorno (`backend/.env` solo tiene un
placeholder, no hay `.env` de Next.js con `DATABASE_URL` real). El
comando en sí ya está implementado y completamente probado
(`test_migrate_users_from_postgres.py`, simula la fila legacy
mockeando `psycopg2.connect`, nunca requiere una conexión real) —
queda listo para ejecutarse el día del corte real a producción, no es
trabajo de código pendiente.

- **`docs/VERSION.md`** — la fila "Backend Django (migración de
  stack)" de la tabla "Estado actual" no se había actualizado desde
  la Fase 35 dentro de su propio texto narrativo (aunque el resto del
  documento sí siguió las Fases 36-76 en sus entradas de "Última
  actualización"/"Actualización anterior"); se agregó un cierre
  consolidado de las Fases 73-76 y una declaración final explícita del
  estado del proyecto.

**Archivos afectados:**
- `docs/VERSION.md`

**Impacto:** ninguno sobre producción — cambio puramente documental.
Deja registro claro y consultable de que la migración de stack está
funcionalmente terminada, con un único paso operativo pendiente y
explícitamente fuera del alcance de esta sesión (requiere acceso a
infraestructura real que este entorno no tiene).

**Autor:** Claude Code

---

## v1.134.0 — 2026-08-26

**Tipo:** FIX
**Módulo:** Migración de stack — Fase 76: cutover de favoritos del Centro de Configuración (Prisma→Django) — cierra un riesgo de divergencia de datos activo y completa Centro de Configuración al 100%

Tercer y último incremento del Centro de Configuración. Al investigar
el ítem "rediseño completo de `/settings`" que `docs/ROADMAP.md`
describía como pendiente, se encontró que esa descripción estaba
**desactualizada**: el rediseño (categorías, búsqueda, favoritos,
historial de auditoría) ya se había implementado por completo en
**Sprint O** (2026-07-28, v1.21.0), antes incluso de que empezara la
migración de stack. Dentro de ese shell ya completo apareció un cabo
suelto real y dentro de esta migración: el endpoint de favoritos.

- **Hallazgo:** `GET/PATCH /api/settings/favorites` seguía
  leyendo/escribiendo `User.viewPreferences` vía Prisma
  (`src/lib/configFavorites.ts`), pese a que su réplica Django
  (`FavoritesView`, completa desde la Fase 28) existía sin usar. No
  era solo código sin cortar: `PATCH /api/dashboard/card-order`
  (mismo campo `User.viewPreferences`, mismo truco de prefijo) **ya
  escribía en Django desde la Fase 55** — los 2 endpoints leían/
  escribían 2 copias distintas del mismo array desde bases de datos
  distintas, un riesgo de divergencia activo para cualquier usuario
  que usara ambas funciones (marcar un favorito en Ajustes y
  reordenar tarjetas del Dashboard). Mismo patrón de bug real que el
  cerrado en la Fase 52. El propio comentario de
  `dashboard/card-order/route.ts` afirmaba (incorrectamente) que
  `favorites` "ya cortado desde antes" — corregido en el mismo
  cambio.
- **Cutover mecánico**, mismo patrón que `dashboard/card-order/route.ts`:
  `route.ts` reemplaza las llamadas a `configFavorites.ts` por
  `djangoApiFetch("/settings/favorites/")`, traduciendo
  `settingId`→`setting_id` en el body del `PATCH`. Sin cambios de
  backend — `FavoritesView`/`FavoriteUpdateSerializer` ya existían
  completos, con su propia suite de tests
  (`test_favorites_view.py`, 6/6 en verde, sin tocar).
- **`src/lib/configFavorites.ts` eliminado** (único importador era
  este `route.ts`), junto con su test dedicado
  (`configFavorites.test.ts`, 5 tests que probaban lógica Prisma ya
  eliminada — cobertura equivalente ya existe, exhaustiva, del lado
  Django).
- **`settings-config-center.test.ts`** — describe de favoritos
  reescrito para mockear `djangoApiFetch` en vez de `configFavorites.ts`,
  mismo patrón que el describe de `config-history` ya existente en
  ese archivo (401 sin sesión, 401 sin sesión Django, 400 body
  inválido sin llamar a Django, 200 con el body traducido a
  snake_case).
- **Corrección de documentación:** `docs/ROADMAP.md` daba por
  pendiente "el rediseño completo de `/settings`" en 2 lugares — ambos
  corregidos para reflejar que Sprint O ya lo cerró antes de que
  empezara esta lista de fases; el punto "Centro de Configuración" se
  marca **COMPLETO Y CUTOVER 100%**.

**Archivos afectados:**
- `src/app/api/settings/favorites/route.ts`
- `src/lib/configFavorites.ts` (eliminado)
- `src/__tests__/configFavorites.test.ts` (eliminado)
- `src/__tests__/api/settings-config-center.test.ts`
- `src/app/api/dashboard/card-order/route.ts` (solo comentario)

**Impacto:** cierra Centro de Configuración al 100% dentro del
alcance de la migración de stack — cierra además un riesgo de
divergencia de datos activo, no solo una migración mecánica más.
`npx tsc --noEmit` limpio, `npx eslint` limpio, suite completa de
Vitest **1226/1226 en verde** (96 archivos — bajó de 97 por la
eliminación de `configFavorites.test.ts`). Sin cambios de backend —
`pytest apps/configuration/tests/test_favorites_view.py` 6/6 en verde
como referencia de que la superficie Django no se tocó. Con esto,
dentro de la migración de stack solo queda pendiente
`migrate_users_from_postgres` contra datos reales (Decommission de
PostgreSQL, postergada a propósito por falta de
`LEGACY_POSTGRES_URL`).

**Autor:** Claude Code

---

## v1.133.0 — 2026-08-26

**Tipo:** SECURITY
**Módulo:** Migración de stack — Fase 75: clampea `password_min_length` a un piso de 10 — cierra el hallazgo de seguridad de la Fase 61 (segundo incremento del Centro de Configuración)

Segundo incremento de la limpieza del Centro de Configuración. El
usuario eligió explícitamente resolver el hallazgo de seguridad de la
Fase 61 antes que el rediseño de `/settings`, y confirmó la política:
subir el piso del valor configurable a 10 en vez de hacer que Django
respete dinámicamente el valor de Ajustes.

- **Alcance real del hallazgo, confirmado antes de tocar código:**
  Django corre `validate_password()` (que aplica
  `AUTH_PASSWORD_VALIDATORS.MinimumLengthValidator(min_length=10)`,
  hardcodeado) en los 5 puntos reales donde valida una contraseña
  nueva (`apps/authentication/serializers.py` ×3,
  `apps/users/serializers.py` ×1 más el flujo de creación
  administrativa). **No es una vulnerabilidad** — Django nunca permite
  algo más débil que 10 caracteres pase lo que pase en Ajustes — es
  una **configuración engañosa por debajo de 10**: un Administrador
  podía configurar el mínimo en, por ejemplo, 6, creyendo que ese es
  el umbral real, cuando Django siempre exige 10. Confirmado además
  que la creación administrativa de usuarios no está expuesta a este
  gap (usa un password fijo de 18 caracteres,
  `"NexoTemporal2026!"`) y que el reseteo admin ya no define
  contraseñas desde la Fase 2 (fuerza cambio en próximo login +
  revoca sesiones, no el legacy "123456" que sigue documentado en
  `CLAUDE.md` como dato del seed, no del flujo de reseteo).
- **`password_min_length` clampeado a un piso de 10** en los 3
  lugares que replican el mismo rango (`SeguridadConfigUpdateSerializer`
  en Django, `PUT /api/settings/seguridad-config` en Next.js, e input
  de la UI de Ajustes) — antes el piso era 4 en los 3. El default
  también sube de 6 a 10 (Django `DEFAULT_PASSWORD_MIN_LENGTH`,
  `djangoPasswordPolicyConfig.ts`, `registry.ts`), para que un
  despliegue sin configurar nunca muestre un valor por debajo de lo
  que realmente se aplica.
- **Texto de ayuda nuevo en Ajustes → Seguridad**, aclarando que el
  piso de 10 lo impone Django siempre, sin importar el valor
  configurado.
- **`get_effective_password_min_length` clampea también en LECTURA**
  (`max(10, ...)`), no solo en la validación del `PUT` — una fila de
  `SystemConfigHistory` guardada antes de esta fase con un valor
  menor sigue siendo "vigente" para `get_effective_config_value`
  hasta que alguien la sobrescriba; sin este clamp, una instalación ya
  configurada por debajo de 10 seguiría mostrando ese valor en Ajustes
  indefinidamente. Cierra el gap sin necesidad de migrar datos
  históricos de auditoría.
- **Tests nuevos** verificando el rechazo por debajo del piso en el
  `PUT` (`test_put_400_for_password_min_length_below_the_django_floor`
  en Django, `"PUT rechaza passwordMinLength por debajo del piso..."`
  en TS) y el clamp en la lectura de un valor histórico ya guardado
  (`test_password_min_length_clamps_stale_value_below_the_django_floor`)
  — los tests existentes que usaban valores por debajo de 10 como
  ejemplo válido (`6`, `8`) se actualizaron a valores consistentes con
  el nuevo piso.

**Archivos afectados:**
- `backend/apps/configuration/serializers.py`
- `backend/apps/configuration/services.py`
- `backend/apps/configuration/tests/test_seguridad_config_view.py`
- `backend/apps/configuration/tests/test_effective_config.py`
- `src/app/api/settings/seguridad-config/route.ts`
- `src/lib/djangoPasswordPolicyConfig.ts`
- `src/components/settings/registry.ts`
- `src/components/settings/SeguridadConfigSection.tsx`
- `src/__tests__/api/settings-config-center.test.ts`

**Impacto:** cierra el hallazgo de seguridad documentado desde la
Fase 61 — la UI de Ajustes ya no puede prometer un mínimo de
contraseña más permisivo del que Django realmente aplica, ni siquiera
para una instalación configurada antes de esta fase (el clamp en
lectura corrige el valor mostrado de inmediato, sin esperar a que un
Administrador lo vuelva a guardar). `npx tsc --noEmit` limpio, `npx
eslint` limpio, `pytest apps/configuration` 231/231 en verde. Del
Centro de Configuración queda 1 pieza: el rediseño completo de
`/settings`.

**Autor:** Claude Code

---

## v1.132.0 — 2026-08-26

**Tipo:** REFACTOR
**Módulo:** Migración de stack — Fase 74: elimina `insightsEngine.ts`/`riskAlerts.ts` (código muerto confirmado desde la Fase 63, ataduras ahora resueltas) — primer incremento del Centro de Configuración

Primer incremento de la limpieza del Centro de Configuración, a
pedido del usuario ("vamos con el punto 1" tras elegir explícitamente
la opción de menor riesgo entre las 3 piezas pendientes de ese ítem).
Cierra las 2 ataduras que la Fase 63 había identificado y documentado
como bloqueo para no eliminar estos 2 archivos en esa fase.

- **`src/lib/riskAlerts.ts` eliminado.** `computeRiskAlerts` no tenía
  ningún caller real (confirmado con `grep` — ni producción ni
  tests), su lógica está portada íntegramente en Django desde la Fase
  4b (`GET /kpis/<id>/`, vía `djangoKpisAdapter.ts`). Atadura
  resuelta: el tipo `RiskAlert`/`RiskAlertSeverity` (único elemento
  del archivo con un consumidor real, `import type` en
  `components/kpis/types.ts`) se movió a ese mismo archivo antes de
  borrar el original.
- **`src/lib/insightsEngine.ts` eliminado (999 líneas).** Sin ningún
  caller de producción — su lógica está 100% portada a Django
  (`insights_engine.py`, Fases 4j/4k), consumida hoy por
  `InsightsPanel.tsx` vía `GET /analytics/insights/[userId]` (cutover
  de la Fase 47). Atadura resuelta: `analytics-formulas.test.ts`
  compartía archivo con tests de `analytics.ts` (que SÍ sigue vivo) —
  se extrajeron y eliminaron los 2 describe que probaban funciones de
  `insightsEngine.ts` (`computeEquilibrioInsights`/
  `explainEquilibrioFactor`/`explainEquilibrioMeaning`/
  `explainEquilibrioImpact`) sin reemplazo, ya que esa cobertura
  existe exhaustiva del lado Django (`test_insights_engine.py`) —
  mismo criterio que la Fase 72 al eliminar tests de lógica ya
  migrada.
- **Comentarios actualizados** en 4 archivos que mencionaban
  `insightsEngine.ts`/`riskAlerts.ts` por nombre y quedaron
  desactualizados por la eliminación (`preventiveIntelligence.ts`,
  `GlobalParamsSection.tsx`, `reportInsights.ts`, `analytics.ts`,
  `InsightsPanel.tsx`) — sin cambios de comportamiento, solo
  precisión documental.

**Archivos afectados:**
- `src/lib/riskAlerts.ts` (eliminado)
- `src/lib/insightsEngine.ts` (eliminado)
- `src/components/kpis/types.ts`
- `src/__tests__/analytics-formulas.test.ts`
- `src/lib/preventiveIntelligence.ts`
- `src/components/settings/GlobalParamsSection.tsx`
- `src/lib/reportInsights.ts`
- `src/lib/analytics.ts`
- `src/components/kpis/InsightsPanel.tsx`

**Impacto:** cierra 2 de los "10 motores legacy" auditados en la Fase
63 — de esos 10, ya quedan 6 confirmados eliminados
(`recoveryCenter.ts`/`deskNoteRetention.ts`/`rate-limit.ts` en la Fase
63, más estos 2), y los 5 restantes (`analytics.ts`/`workload.ts`/
`predictionEngine.ts`/`trendEngine.ts`/`capacityForecast.ts`)
confirmados genuinamente vivos (cadena real hacia Reportes
Ejecutivos). Sin cambio de comportamiento en producción — ningún
caller real se tocó. `npx tsc --noEmit` limpio, `npx eslint` limpio en
los 9 archivos tocados, suite completa de Vitest **1229/1229** en
verde (97 archivos — mismos archivos que antes, 8 tests menos: los 2
describe eliminados de `analytics-formulas.test.ts`, sin reemplazo
porque esa cobertura ya existe del lado Django). Sin cambios de
backend. Del Centro de Configuración
quedan 2 piezas pendientes: el hallazgo de seguridad de
`password_min_length` (requiere decisión de producto) y el rediseño
completo de `/settings` (proyecto de UI de tamaño propio).

**Autor:** Claude Code

---

## v1.131.0 — 2026-08-26

**Tipo:** FEATURE
**Módulo:** Migración de stack — Fase 73: cutover HTTP real de RANGO_PERSONALIZADO y RANGO_MESES en `buildSnapshotData.ts` + fix de la divergencia de `workday_end_hour` — **cierra Reportes Ejecutivos al 100%**

Completa, en una sola fase, las 3 piezas que quedaban pendientes del
motor de cálculo de Reportes Ejecutivos, a pedido explícito del
usuario ("finaliza con los reportes ejecutivos... en 1 sola fase").

- **`buildCustomRangeSnapshotData` (RANGO_PERSONALIZADO) cortado a
  `POST /reports/executive/custom-range-team-kpis/`** (Fase 69) vía
  `fetchCustomRangeTeamReport` (`djangoReportKpisBridge.ts`, ya
  existía sin usar desde la Fase 72). A diferencia de MENSUAL, este
  builder nunca tuvo integración con el Índice Ejecutivo — `insights`/
  `estadoOperativo`/`principalHallazgo` vienen del bundle de Django
  sin ninguna glue code, cutover más simple que el de la Fase 72.
- **`buildRangeSnapshotData` (RANGO_MESES) cortado a `POST
  /reports/executive/range-team-kpis/`** (Fase 69) vía
  `fetchRangeTeamReport`, mismo criterio. Requirió reconstruir
  `monthlyEvolution` (Django devuelve `member_snapshots` por mes como
  diccionario indexado por id numérico, sin campos de identidad — una
  decisión deliberada de las Fases 66/71, documentada en su docstring
  Python: "el roster resuelto del lado de Next.js ya tiene esos 3
  campos") — se reconstruye como array con `id`/`name`/`role`
  provistos por el `members` ya remapeado, aplicando el mismo
  "recorte" de campos que el TS original (`overdueCount`/
  `cargaRealHours`/`cargaBaseHours` no viajan al snapshot final).
- **Ambos builders eliminan toda su computación local de agregados de
  equipo** (`computeRiskQuadrant`/`computeFindings`/
  `computeRecommendations`/`explainCumplimientoIndicator`/
  `explainCargaIndicator`/`explainConsultasIndicator`/
  `explainMotivoDistribution`/`getActivityReasonLabelMap`/
  `computeTeamInsights`/`computeEffectiveMemberBases`/
  `previousEquivalentPeriod` y las 4 consultas Prisma de Tareas/
  Actividades por builder) — con MENSUAL ya cortado desde la Fase 72,
  estas funciones quedan sin ningún caller vivo en
  `buildSnapshotData.ts` y se eliminan junto con 2 funciones locales
  ya muertas (`getMonthsInRange`, `asOfFechaCorte`) y el tipo
  `MotivoDistributionItem`.
- **Mismas 2 decisiones de comportamiento en producción de la Fase
  72, aplicadas sin re-preguntar (ya establecidas como criterio del
  motor completo):** si Django falla, la generación FALLA; un
  colaborador sin id de Django resuelto se excluye de la tabla.
- **Fix de la divergencia de `workday_end_hour`** (hallazgo de la
  Fase 63): `capacityForecast.ts` seguía leyendo la hora de corte de
  jornada de Postgres (`getEffectiveWorkdayEndHour`,
  `systemConfig.ts`) pese a que Ajustes → Trabajo Avanzado ya escribe
  ese valor en Django desde la Fase 60 — 2 almacenes desincronizados,
  staleness activa (editar el valor desde Ajustes no tenía efecto
  real en Capacidad Proyectada ni en los reportes ejecutivos que la
  consumen vía `predictionEngine.ts`). Nuevo
  `src/lib/djangoWorkdayEndHourConfig.ts` (mismo patrón que
  `djangoNovaCacheConfig.ts`, Fase 59: `fetchDjangoWorkdayEndHour()`
  llama `GET /settings/trabajo-avanzado/` y degrada al default
  hardcodeado (17, igual que el default de Django) si Django no
  responde — no es un dato que deba romper la generación de la
  proyección en sí, mismo criterio que el TTL de caché de Nova, no el
  de `ReportMemberKpi`). `CONFIG_KEY_WORKDAY_END_HOUR`/
  `DEFAULT_WORKDAY_END_HOUR`/`getEffectiveWorkdayEndHour`/
  `setWorkdayEndHour` eliminados de `systemConfig.ts` (código muerto
  confirmado — `setWorkdayEndHour` ya no tenía ningún caller,
  `getEffectiveWorkdayEndHour` tenía exactamente uno). El duplicado
  homónimo en `src/components/settings/registry.ts` (metadata de UI
  del Centro de Configuración — búsqueda/favoritos/"restaurar
  predeterminado") es deliberado y preexistente, documentado en su
  propio comentario — no se toca.
- **Tests:** se agregaron 7 tests nuevos a `buildSnapshotData.test.ts`
  (3 para RANGO_PERSONALIZADO, 4 para RANGO_MESES — incluida la
  reconstrucción de `monthlyEvolution`), cerrando un gap de cobertura
  real descubierto durante la verificación (ningún test previo
  ejercitaba estos 2 builders de punta a punta). Se eliminó el
  describe `getEffectiveWorkdayEndHour` de `systemConfig.test.ts`
  (probaba una función ya eliminada).

**Archivos afectados:**
- `src/lib/executiveReporting/buildSnapshotData.ts`
- `src/lib/djangoWorkdayEndHourConfig.ts` (nuevo)
- `src/lib/capacityForecast.ts`
- `src/lib/systemConfig.ts`
- `src/__tests__/executiveReporting/buildSnapshotData.test.ts`
- `src/__tests__/systemConfig.test.ts`

**Impacto:** cierra el motor de cálculo de Reportes Ejecutivos al
100% en Django para los 3 tipos de reporte (MENSUAL, RANGO_PERSONALIZADO,
RANGO_MESES) — `buildSnapshotData.ts` ya no depende de Prisma para
`ReportMemberKpi`/agregados de equipo en ningún builder, solo para
roster/Índice Ejecutivo/Predictivo (mes en curso, solo MENSUAL)/NOVA/
metadatos. Cierra además la última divergencia de configuración
pendiente de Reportes Ejecutivos. `npx tsc --noEmit` limpio, `npx
eslint` limpio en los archivos tocados, suite completa de Vitest
1237/1237 en verde (97 archivos). Sin cambios de backend — los 2
endpoints HTTP y el fix ya existían/no requerían Python nuevo. Con
esto, del ítem "Decommission de PostgreSQL" solo queda pendiente la
migración de usuarios reales (`migrate_users_from_postgres`,
postergada a propósito, no bloqueante). `renderReportHtml.ts`/
`renderReportExcel.ts` (exportación) y la narrativa NOVA
(`src/lib/executiveReporting/nova/`, Groq) no necesitan portarse —
presentación/generación de lenguaje natural, no cálculo de negocio,
mismo criterio que Nova Insights (Fase 54).

**Autor:** Claude Code

---

## v1.130.0 — 2026-08-26

**Tipo:** FEATURE
**Módulo:** Migración de stack — Fase 72: cutover HTTP real del builder MENSUAL de `buildSnapshotData.ts` (`ReportMemberKpi` + agregados de equipo, parte (2) de las "3 partes que faltan del motor de cálculo de Reportes Ejecutivos")

Primer cutover real del motor de cálculo de Reportes Ejecutivos —
`buildMonthlySnapshotData` deja de calcular `members`/`teamSummary`/
`distribuciones`/`trends`/`findings`/`recommendations`/
`indicatorExplanations`/`alerts`/`dataQuality` localmente contra Prisma
y pasa a leerlos del bundle de Django (`POST
/reports/executive/monthly-team-kpis/`, Fase 68), verificado campo por
campo contra este mismo builder con datos sintéticos antes del
cutover (Fases 70/71, incluidos los casos de borde de mes).

- **Nuevo `src/lib/executiveReporting/djangoReportKpisBridge.ts`** —
  puente hacia `apps.reports.team_report` (mismo patrón que
  `djangoAnalyticsBridge.ts`, Fase 57): `fetchMonthlyTeamReport`
  (usado en este cutover) + `fetchCustomRangeTeamReport`/
  `fetchRangeTeamReport` (preparados para los cutovers de
  RANGO_PERSONALIZADO/RANGO_MESES, próxima fase — no usados todavía).
  Convierte snake_case→camelCase (`deepCamelCase`, mismo mecanismo que
  `djangoAnalyticsAdapter.ts`) y remapea cada `id`/`userId` NUMÉRICO de
  Django de vuelta al cuid de Postgres correspondiente
  (`remapDjangoIdentity`) — el resto del builder sigue operando 100%
  en cuids.
- **Decisiones de comportamiento en producción, confirmadas
  explícitamente con el usuario antes de implementar:** (1) si Django
  no responde o responde con error, la generación del reporte FALLA
  (excepción) — a diferencia del Índice Ejecutivo (que degrada
  excluyendo colaboradores), `ReportMemberKpi` es el corazón visible
  del reporte, no un agregado secundario; (2) un colaborador sin id de
  Django resuelto (`legacy_postgres_id` nunca importado) queda
  excluido de la tabla — mismo criterio que el Índice Ejecutivo (Fase
  57).
- **`resolveDjangoIdsForRoster` se resuelve UNA sola vez** al inicio
  de `buildMonthlySnapshotData` y se reutiliza tanto para el nuevo
  bundle como para la rama existente del Índice Ejecutivo (antes hacía
  su propia resolución aparte, duplicando la llamada).
- **Se elimina toda la computación local del bloque `ReportMemberKpi`**
  (4 consultas Prisma de Tareas/Actividades, `computeEffectiveMemberBases`,
  `asOfFechaCorte`, el `.map()` de 60+ líneas por colaborador,
  `computeRiskQuadrant`/`computeTeamMonthlySnapshots`/
  `computeTrendComparisons`/`computeFindings`/`computeRecommendations`/
  `explainCumplimientoIndicator`/`explainCargaIndicator`/
  `explainConsultasIndicator`/`explainMotivoDistribution`/
  `getActivityReasonLabelMap` para este builder — siguen usándose en
  RANGO_PERSONALIZADO/RANGO_MESES, sin cutover todavía).
- **`insights` (`computeTeamInsights`) sigue calculándose en TS, NO
  viene del bundle de Django** — necesita `healthByMember`/
  `variableConsistencyMembers` del Índice Ejecutivo (mes en curso),
  que el bundle de Django no calcula (documentado en
  `djangoReportKpisBridge.ts`). `estadoOperativo`/`principalHallazgo`
  por miembro tampoco vienen de Django, por el mismo motivo
  (dependen de `equilibrioScore`).
- **Test file actualizado** (`buildSnapshotData.test.ts`): se eliminó
  el describe `"fecha de corte"` (3 tests que probaban lógica de
  `asOfFechaCorte`/prorrateo que ya NO vive en esta función — esa
  lógica tiene su propia cobertura exhaustiva del lado Django,
  `test_member_kpis.py`, verificada con datos sintéticos reales en las
  Fases 70/71); se agregaron 3 tests nuevos para el nuevo camino
  (resolución de ids una sola vez, datos del bundle fluyendo tal cual
  al snapshot, fallo explícito si Django no responde). Los tests de
  metadatos/inmutabilidad/Motor de Cierre Inteligente (que SÍ siguen
  en TS) se mantuvieron intactos, con mocks nuevos para no crashear.
  `src/__tests__/api/reports-executive.test.ts` también actualizado
  (mock de `djangoApiFetch` para las 2 rutas nuevas).

**Archivos afectados:**
- `src/lib/executiveReporting/djangoReportKpisBridge.ts` (nuevo)
- `src/lib/executiveReporting/buildSnapshotData.ts`
- `src/__tests__/executiveReporting/buildSnapshotData.test.ts`
- `src/__tests__/api/reports-executive.test.ts`

**Impacto:** Cierra el cutover real del builder MENSUAL de Reportes
Ejecutivos — el de mayor tráfico de los 3 (el mes en curso es el caso
de uso más común). `npx tsc --noEmit` limpio, `npx eslint` limpio en
los archivos tocados (hallazgos preexistentes en otros componentes,
sin relación), suite completa de Vitest 1231/1231 en verde (97
archivos). Sin cambios de backend — no requirió `pytest`. Quedan
RANGO_PERSONALIZADO y RANGO_MESES sin cutover (builders ya verificados
campo por campo, endpoints ya construidos y probados desde las Fases
69/70/71 — el trabajo restante es mecánico, mismo patrón que este
cutover) y la parte (3): la divergencia de `workday_end_hour` (Fase
63).

**Autor:** Claude Code (Sonnet 5)

---

## v1.129.2 — 2026-08-26

**Tipo:** FIX
**Módulo:** `apps.reports` — réplica fiel del desplazamiento de hora LOCAL del negocio en los límites de mes de RANGO_MESES (Causa raíz B de la Fase 70), descubierto y confirmado con una segunda verificación sintética dirigida al borde de mes

Continuación de la Fase 70: con la Causa raíz A (redondeo) cerrada, se
investigó el alcance real de la Causa raíz B antes de decidir el fix
— una segunda verificación sintética (tareas justo antes/después del
borde de mes en un rango RANGO_MESES) confirmó que el impacto es más
amplio de lo medido inicialmente: no solo `cargaBaseHours`, también el
desglose mes a mes (`monthlyEvolution`) de qué tareas/actividades caen
en cada mes.

- **Causa raíz precisa (corrigiendo la hipótesis inicial de la Fase
  70):** no es que el día de la semana se calcule en hora local (TS
  usa `getUTCDay()`, confirmado leyendo el código) — es que
  `monthBounds()` (TS) construye los límites del mes con `new
  Date(year, month, day, ...)`, que interpreta esos componentes en la
  hora LOCAL DEL PROCESO de Next.js en producción
  (`America/Guayaquil`, UTC-5) — no en UTC. Confirmado con el usuario
  que producción corre en esa zona horaria. Solo `compute_range_member_kpis`
  (RANGO_MESES) pasa el resultado de `monthBounds()` directamente a
  consultas de tareas/actividades y al prorrateo de base horaria —
  MENSUAL/RANGO_PERSONALIZADO derivan sus límites de otras fuentes ya
  en UTC explícito, verificados sin esta divergencia.
- **Nuevo `_local_month_bounds(year, month)`** (`member_kpis.py`) —
  réplica de `monthBounds()`, desplazada por `BUSINESS_TZ_OFFSET_HOURS`
  (constante YA existente en `apps.tasks.business_time`, mismo
  criterio que `business_day_real_range`) — reemplaza a `_month_bounds`
  (UTC puro) en TODOS los usos de `compute_range_member_kpis`/
  `assemble_range_team_report` que en TS derivan de `monthBounds()`
  (consultas de tareas/actividades, límites de `compute_effective_member_bases`,
  bucketing de `monthSnapshots`) — MENSUAL/RANGO_PERSONALIZADO
  siguen usando `_month_bounds` sin cambios.
- **Nuevo `_ts_local_period_end_date(clamped_start_dt, period_end_instant)`**
  — réplica EXACTA (aritmética de división entera de `timedelta`, no
  una aproximación) del límite final que produce el loop de pasos de
  24h de `sumWeightedBaseHours`/`sumWeightedLimit` en TS cuando
  `clamped_start_dt` no coincide con la hora del día de
  `period_end_instant` — el día extra depende de la hora del día
  exacta del `clamped_start` de CADA colaborador (dato real:
  `completedAt`/`createdAt`), no es un ajuste uniforme.
- **`compute_effective_member_bases` gana 2 parámetros opcionales**
  (`period_start_instant`/`period_end_instant`, default `None`) — solo
  los pasa el builder RANGO_MESES; con `None` (MENSUAL/RANGO_PERSONALIZADO)
  el comportamiento es idéntico al existente desde la Fase 64.
- 7 tests nuevos, incluidos 2 que reproducen EXACTAMENTE los 2
  escenarios reales verificados contra TS (tarea excluida por caer
  antes del inicio local del mes; tarea incluida y bucketeada
  correctamente pese a caer después del fin de mes UTC; 104.0h vs. las
  97.5h que daba el código anterior en el caso de prorrateo real).

**Archivos afectados:**
- `backend/apps/reports/member_kpis.py`
- `backend/apps/reports/team_report.py`
- `backend/apps/reports/tests/test_member_kpis.py`

**Impacto:** Corrige RANGO_MESES para que su desglose mes a mes y su
prorrateo de base horaria coincidan exactamente con lo que produce
`buildSnapshotData.ts` en producción, incluidas tareas/actividades
justo en el borde de mes — verificado con datos sintéticos, no
inferido. `ruff check` limpio, `pytest apps/reports/` 162/162 en
verde (155 previos + 7 nuevos), suite completa del backend verificada
en el mismo cambio (ver detalle en `docs/VERSION.md`). Cierra la Causa
raíz B de la Fase 70 — con esto, los 3 builders del motor de cálculo
quedan verificados campo por campo contra `buildSnapshotData.ts`.

**Autor:** Claude Code (Sonnet 5)

---

## v1.129.1 — 2026-08-26

**Tipo:** FIX
**Módulo:** Backend Django — bug de redondeo activo en producción (`round()` de Python vs `Math.round()` de JS), descubierto verificando los endpoints de Reportes Ejecutivos (Fases 68/69) con datos sintéticos reales contra `buildSnapshotData.ts`

Verificación de campo por campo (Postgres descartable + Django, mismo
escenario sintético en ambos lados) de los 3 endpoints de la Fase
68/69 contra `buildSnapshotData.ts` real — 283 verificaciones, 261
coincidieron exactamente. Las 22 discrepancias se explicaron por 2
causas raíz. Esta entrada corrige la primera (la segunda, un quirk de
conteo de días hábiles en rangos multi-mes, queda documentada como
hallazgo pendiente de decisión — no es un bug de puerto, es una
divergencia real entre el TS original y el port Python).

- **Causa raíz:** `round()` de Python usa "banker's rounding"
  (redondea .5 al PAR más cercano — `round(66.5) == 66`), mientras que
  `Math.round()` de JavaScript SIEMPRE redondea .5 hacia +Infinity
  (`Math.round(66.5) === 67`). Todo el backend Django de esta
  migración es una réplica línea por línea del TypeScript original —
  cualquier `round()` que mirroree un `Math.round()` de TS con
  `round()` nativo de Python diverge exactamente cuando el resultado
  cae en .5. Caso real que expuso el bug: `(33+100)/2 = 66.5` → TS
  daba 67, Django daba 66.
- **Alcance real — no es un bug de las Fases 64-69:** un `grep` de
  `apps/analytics/*.py` encontró 157 usos de `round(`, la mayoría
  réplicas directas de un `Math.round()` de TS — varios de ellos
  (`compute_completed_pct_any`, `compute_simple_score`, etc.) ya sirven
  tráfico real desde el cutover de Analytics/KPIs (Fase 47). **Este
  bug probablemente ya afectaba números reales en producción antes de
  esta fase.**
- **Nuevo `backend/apps/core/rounding.py`** — `round_half_up(value,
  ndigits=0)`, réplica exacta de `Math.round()` (`ndigits=0`, devuelve
  `int`) y del patrón `Math.round(value * 10**n) / 10**n` (`ndigits=n`,
  devuelve `float`), vía `math.floor(value * factor + 0.5) / factor`
  (aritmética IEEE 754 idéntica bit a bit entre Python y JS).
- **217 call sites reemplazados en 32 archivos** (`round(` →
  `round_half_up(`, más el import correspondiente) en
  `apps/analytics/*` (23 archivos), `apps/configuration/*`,
  `apps/dashboard`, `apps/projects`, `apps/recovery`, `apps/reports/*`
  (los 3 archivos de las Fases 64-69) y `apps/tasks/services.py`+
  `task_import.py`. **Excluido deliberadamente:**
  `apps/core/middleware.py` (`round()` ahí mide latencia de request
  para logging, sin espejo en TS).
- 6 tests nuevos para `round_half_up`
  (`backend/apps/core/tests/test_rounding.py`), incluido el caso real
  que expuso el bug.

**Archivos afectados:** `backend/apps/core/rounding.py` (nuevo),
`backend/apps/core/tests/test_rounding.py` (nuevo), más 32 archivos de
`apps/analytics`, `apps/configuration`, `apps/dashboard`,
`apps/projects`, `apps/recovery`, `apps/reports`, `apps/tasks`
(reemplazo mecánico de `round(` → `round_half_up(`).

**Impacto:** Corrige un bug de redondeo con impacto potencial en
producción para CUALQUIER promedio/porcentaje ya calculado en Django
que caiga exactamente en `.5` (Analytics/KPIs desde la Fase 47,
Reportes Ejecutivos desde que se corte — Fases 68/69 — y todo lo demás
que use estos módulos). `ruff check` limpio en los 32 archivos
tocados. Suite completa del backend — **1799/1799 tests en verde**
(corrida de `apps/` completo, no solo los módulos tocados, dado el
alcance transversal del cambio) — ningún test existente se rompió,
confirmando que el mecanismo de reemplazo fue seguro. Sin cambios de
TypeScript.

**Autor:** Claude Code (Sonnet 5)

---

## v1.129.0 — 2026-08-26

**Tipo:** FEATURE
**Módulo:** Migración de stack — Fase 69: 2 endpoints HTTP más del motor de CÁLCULO de Reportes Ejecutivos (`POST /reports/executive/custom-range-team-kpis/` y `.../range-team-kpis/`, builders RANGO PERSONALIZADO/RANGO DE MESES), sin cutover de `buildSnapshotData.ts` todavía

Completa el trío de endpoints HTTP del motor de cálculo (mensual desde
la Fase 68) — mismo criterio de riesgo mínimo: se construyen y prueban
en aislamiento, nada en Next.js los llama todavía.

- **`assemble_custom_range_team_report`** (`backend/apps/reports/team_report.py`)
  — reutiliza `compute_custom_range_member_kpis` (Fase 65) +
  `insights.py` + las mismas `compute_monthly_ranking`/
  `compute_team_alerts` de la Fase 68 (verificado línea por línea
  contra el TS: `buildCustomRangeSnapshotData` usa el mismo orden de
  ranking/alertas que el builder MENSUAL). La diferencia real es la
  tendencia de consultas, que compara contra `previous_equivalent_period`
  (Fase 67, mismo-duración) en vez del mes calendario anterior.
- **`assemble_range_team_report`** — reutiliza `compute_range_member_kpis`
  (Fase 66) + `insights.py`, con lógica propia genuinamente nueva:
  `compute_range_ranking` (prioridad INVERTIDA respecto al ranking
  mensual — `completedPct` antes que `score`, verificado contra el TS)
  y `compute_range_alerts` (a diferencia de las alertas de umbral fijo
  del builder mensual, un colaborador entra en alerta si el problema se
  repite en al menos la mitad de sus meses ACTIVOS del rango —
  `monthsAffected` cuenta cuántos). Agrega también `monthlyEvolution`/
  `rangeTrend`/`problematicMonths`, ausentes en los otros 2 builders.
- **`POST /reports/executive/custom-range-team-kpis/`**
  (`CustomRangeTeamReportView`) y **`POST /reports/executive/range-team-kpis/`**
  (`RangeTeamReportView`), ambas gateadas por `CanAccessReports`, mismo
  patrón de la Fase 68.
- 14 tests nuevos (35 en total en `test_team_report.py`), todos en
  verde en el primer intento.

**Archivos afectados:**
- `backend/apps/reports/team_report.py`
- `backend/apps/reports/tests/test_team_report.py`
- `backend/apps/reports/views.py`
- `backend/apps/reports/serializers.py`
- `backend/apps/reports/urls.py`

**Impacto:** Ningún riesgo para producción — los 2 endpoints existen y
están probados, pero `buildSnapshotData.ts` sigue calculando
localmente contra Prisma sin ningún cambio. Con esto, los 3 builders
del motor de cálculo tienen su endpoint HTTP equivalente construido y
probado en Django — queda el paso de mayor riesgo de toda esta
sub-iniciativa: el cutover real del `route.ts`/`buildSnapshotData.ts`,
que requiere verificación campo por campo contra datos reales antes de
reemplazar el cálculo local.

**Autor:** Claude Code (Sonnet 5)

---

## v1.128.0 — 2026-08-26

**Tipo:** FEATURE
**Módulo:** Migración de stack — Fase 68: primer endpoint HTTP del motor de CÁLCULO de Reportes Ejecutivos (`POST /reports/executive/monthly-team-kpis/`, builder MENSUAL), sin cutover de `buildSnapshotData.ts` todavía

Primer paso de la parte (2) de las "3 partes que faltan" (cutover HTTP
real de `buildSnapshotData.ts`): construye y prueba en aislamiento el
endpoint Django que expondrá el motor de cálculo ya portado
(`member_kpis.py` + `insights.py`, Fases 64-67), antes de tocar el
`route.ts`/`buildSnapshotData.ts` real — mismo criterio que el port
original de KPIs/Analytics (endpoint primero, cutover de TS mucho
después, con verificación campo por campo contra datos reales).

- **Nuevo `backend/apps/reports/team_report.py`** — capa de ENSAMBLADO
  (`member_kpis` calcula, `insights` interpreta, `team_report`
  ensambla) con `assemble_monthly_team_report(...)`, que combina:
  - `compute_monthly_member_kpis` (Fase 64) para el `ReportMemberKpi`
    por colaborador, con `id`/`name`/`role` agregados desde el propio
    `User` de Django (a diferencia de `member_kpis.py`, que los omite
    deliberadamente).
  - `insights.py` (Fase 67) para `compute_risk_quadrant`/
    `compute_team_monthly_snapshots`+`compute_trend_comparisons`/
    `compute_findings`/`compute_recommendations`/`compute_team_insights`/
    `explain_cumplimiento_indicator`/`explain_carga_indicator`/
    `explain_consultas_indicator`/`resolve_monthly_period_status`.
  - `compute_data_quality` (`apps/analytics/scoring.py`, ya portada).
  - **3 funciones nuevas, genuinamente sin cubrir por las fases
    previas:** `compute_team_alerts` (umbral de cumplimiento/sobrecarga
    por colaborador), `compute_monthly_ranking` (orden por
    score/completedPct), `compute_consultas_by_reason` (agrupación de
    `TaskActivity` por motivo con %/tendencia vs. el mes anterior — el
    único bloque de `buildMonthlySnapshotData` que no tenía ninguna
    primitiva ya portada).
- **Deliberadamente fuera de este bundle, documentado en el docstring
  del módulo:** Índice Ejecutivo (Fase 57, llamada aparte por
  colaborador con su propio caché), Analytics Predictivo
  (`predictionEngine.ts`, motor aparte), narrativa NOVA, y
  `estadoOperativo`/`principalHallazgo` por miembro del builder
  MENSUAL (dependen del `equilibrioScore` del Índice Ejecutivo) —
  ninguno se elimina de TypeScript, el caller los sigue resolviendo
  igual que hoy.
- **`POST /reports/executive/monthly-team-kpis/`** (`MonthlyTeamReportView`,
  gateado por `CanAccessReports`) — recibe `user_ids` (numéricos de
  Django, resueltos por el caller vía `GET /reports/user-lookup/`,
  mismo puente de la Fase 57), `year`/`month`/`fecha_corte` opcional;
  devuelve el bundle completo (`team_summary`/`members`/`ranking`/
  `distribuciones`/`trends`/`findings`/`insights`/
  `indicator_explanations`/`recommendations`/`alerts`/`data_quality`/
  `period_status`).
- 21 tests nuevos (`backend/apps/reports/tests/test_team_report.py`),
  todos en verde en el primer intento.

**Archivos afectados:**
- `backend/apps/reports/team_report.py` (nuevo)
- `backend/apps/reports/tests/test_team_report.py` (nuevo)
- `backend/apps/reports/views.py` (`MonthlyTeamReportView`)
- `backend/apps/reports/serializers.py` (`MonthlyTeamReportRequestSerializer`)
- `backend/apps/reports/urls.py` (`executive/monthly-team-kpis/`)

**Impacto:** Ningún riesgo para producción — el endpoint existe y está
probado, pero `buildSnapshotData.ts` sigue calculando localmente contra
Prisma sin ningún cambio; nada en Next.js llama a este endpoint
todavía. Deja el terreno preparado para el cutover real (fase futura),
que requerirá verificación campo por campo contra datos reales antes
de reemplazar el cálculo local del builder MENSUAL — y, después,
RANGO_MESES/RANGO_PERSONALIZADO (sin endpoint propio todavía).

**Autor:** Claude Code (Sonnet 5)

---

## v1.127.0 — 2026-08-26

**Tipo:** FEATURE
**Módulo:** Migración de stack — Fase 67: port de `src/lib/reportInsights.ts` (agregados de EQUIPO de Reportes Ejecutivos — cuadrante de riesgo, hallazgos, recomendaciones, insights, tendencia de consultas, snapshots mensuales de equipo, estado del período), sin cutover HTTP

Completa la parte (1) de las "3 partes que faltan del motor de cálculo
de Reportes Ejecutivos" pedidas por el usuario tras la Fase 66: el
port completo de `reportInsights.ts` (538 líneas) — el archivo del que
dependía el resto de `buildRangeSnapshotData`/`buildMonthlySnapshotData`
(rollups de equipo), documentado como pendiente en las Fases 65/66.
Quedan las otras 2 partes (cutover HTTP de `buildSnapshotData.ts` y la
divergencia de `workday_end_hour` de la Fase 63) para próximas fases.

- **Nuevo `backend/apps/reports/insights.py`** — 16 funciones portadas,
  agrupadas en 4 lotes por riesgo/dependencia (investigados con un fork,
  verificados línea por línea contra el TS antes de escribir código):
  - **Puras standalone:** `compute_risk_quadrant`, `previous_equivalent_period`,
    `explain_motivo_distribution`, `explain_cumplimiento_indicator`,
    `explain_carga_indicator`, `explain_consultas_indicator`.
  - **I/O reusando modelos ya existentes:** `get_activity_reason_label_map`
    (`ActivityReason`, portado desde la Fase 3b), `resolve_monthly_period_status`/
    `resolve_range_period_status`/`resolve_custom_range_period_status`
    (`MonthClosure`, portado desde la Fase 3d).
  - **Reglas de negocio puras sobre datos ya calculados:** `compute_findings`,
    `compute_recommendations`, `compute_team_insights` — ninguna usa IA
    (el "Análisis IA" de NOVA es un módulo aparte, nunca portado).
  - **I/O pesado (4 queries a `Task`/`TaskActivity`):**
    `compute_team_monthly_snapshots` + `compute_trend_comparisons`.
- **`deriveEstadoOperativo`/`computeEffectiveMemberBases`/
  `computePrincipalHallazgo` NO se duplican** — ya están portadas en
  `apps.reports.member_kpis` desde las Fases 64/65; el docstring del
  módulo nuevo lo deja explícito para el próximo lector.
- **Hallazgo documentado, no corregido:** `computeEffectiveMemberBases`
  (TS) usa `periodEnd` como valor de reserva de `computeEffectiveHistoryStart`
  cuando un colaborador no tiene ningún historial; el port ya existente
  (`compute_effective_member_bases`, Fase 64) usa `now` en ese mismo
  lugar — divergencia menor, en la práctica inalcanzable porque
  `User.created_at` (`auto_now_add`) siempre está poblado en Django. No
  se reabren las 3 sub-fases ya verificadas (64/65/66) por un caso sin
  impacto real.
- **Reutiliza `compute_completed_pct_any`** (`apps/analytics/scoring.py`,
  ya portada) en `compute_team_monthly_snapshots` en vez de reimplementar
  el mismo cálculo inline — encontrado durante la verificación cruzada
  contra el TS.
- 47 tests nuevos (`backend/apps/reports/tests/test_insights.py`), los
  47 en verde en el primer intento.

**Archivos afectados:**
- `backend/apps/reports/insights.py` (nuevo)
- `backend/apps/reports/tests/test_insights.py` (nuevo)

**Impacto:** Cierra el port completo de `reportInsights.ts` — junto con
`member_kpis.py` (Fases 64-66), el motor de CÁLCULO completo de
Reportes Ejecutivos (`ReportMemberKpi` + agregados de equipo) ya existe
en Django, sin ningún wiring HTTP todavía y sin ningún riesgo para
producción. Deja mapeado con precisión lo que queda: el cutover HTTP
real de `buildSnapshotData.ts` (los 3 builders) y la divergencia de
`workday_end_hour` (Fase 63).

**Autor:** Claude Code (Sonnet 5)

---

## v1.126.0 — 2026-08-26

**Tipo:** FEATURE
**Módulo:** Migración de stack — Fase 66: Sub-fase 3 del motor de CÁLCULO de Reportes Ejecutivos (`ReportMemberKpi`/`MonthSnapshot`, builder de rango de meses — solo lo que NO depende de `reportInsights.ts`)

Completa el port de `ReportMemberKpi` para los 3 builders de
`buildSnapshotData.ts` (mensual, rango personalizado, rango de meses).
El builder de RANGO_MESES resultó ser el más grande de los 3 — arma un
desglose mes a mes (`MonthSnapshot[]`) además de la agregación por
colaborador — pero también el que reveló el límite real de esta
sub-fase: más allá de `ReportMemberKpi`/`MonthSnapshot`, el resto de
`buildRangeSnapshotData` (rollups de equipo: cuadrante de riesgo,
hallazgos, recomendaciones, insights, tendencia de consultas, alertas)
depende de `src/lib/reportInsights.ts` (538 líneas), que sigue sin
portar — se acotó el alcance explícitamente a lo que NO depende de
ese archivo.

- **Nueva función `compute_range_member_kpis(...)`** en
  `backend/apps/reports/member_kpis.py` — réplica de la porción de
  `buildRangeSnapshotData` que arma `monthSnapshots`/`aggregatedMembers`.
  Reutiliza `resolve_closure_cutoff`/`as_of_fecha_corte`/
  `compute_effective_member_bases`/`derive_estado_operativo`/
  `compute_principal_hallazgo` (Sub-fases 1/2) y `monthly_business_base_for_users`
  (`apps/analytics/workload.py`, ya portada desde antes de esta
  sesión, sin conectar a Reportes Ejecutivos hasta ahora).
- **2 funciones nuevas triviales:** `_months_in_range` (réplica de
  `getMonthsInRange`) y `_month_label` (réplica del formato "{mes} de
  {año}" que ya usa Django en otro lugar —
  `apps.analytics.services._month_label_range`, privada — se duplicó
  localmente en vez de importarla cruzando módulos, mismo criterio que
  `_month_bounds`).
- **Simplificación deliberada del contrato de salida, documentada:**
  a diferencia del TS (que arma `memberSnapshots` como array con
  `id`/`name`/`role`, y los "aligera" antes de devolverlos por HTTP),
  acá `month_snapshots[i]["member_snapshots"]` es un dict `{user_id:
  {...}}` sin identidad (mismo criterio que las Sub-fases 1/2: el
  roster resuelto del lado de Next.js ya tiene `id`/`name`/`role`) y
  sin el "strip" de campos previo al payload HTTP — no hay payload
  HTTP todavía.
- 6 tests nuevos: 2 meses básicos, respeto de `fechaCorte`, promedio
  que excluye meses sin actividad (verificando explícitamente que un
  colaborador con tareas solo en 1 de 3 meses del rango no ve su
  promedio diluido por los meses sin actividad), roster vacío, agregado
  en cero sin tareas, y formato de `month`/`label` por mes. Los 6
  pasaron en verde en el primer intento (a diferencia de las Sub-fases
  1/2, que encontraron bugs de test al correr por primera vez).

**Archivos afectados:**
- `backend/apps/reports/member_kpis.py`
- `backend/apps/reports/tests/test_member_kpis.py`

**Impacto:** Cierra el port de `ReportMemberKpi` para los 3 builders
de Reportes Ejecutivos — sin ningún riesgo para producción (sin
wiring HTTP, sin cambios en TS). Lo que queda del motor de cálculo
completo: los rollups de equipo (`reportInsights.ts`, 538 líneas —
cuadrante de riesgo/hallazgos/recomendaciones/insights/tendencia de
consultas/alertas) y, eventualmente, el cutover HTTP real de los 3
builders. `ruff check apps/reports/` limpio, `pytest
apps/reports/tests/test_member_kpis.py` 36/36 en verde (30 previos +
6), `pytest apps/reports apps/analytics apps/users apps/team
apps/tasks` 928/928 en verde (922 previos + 6). Sin cambios de
TypeScript — no requirió `npx tsc`/`npm run lint`/Vitest.
**Autor:** Claude Code

---

## v1.125.0 — 2026-08-26

**Tipo:** FEATURE
**Módulo:** Migración de stack — Fase 65: Sub-fase 2 del motor de CÁLCULO de Reportes Ejecutivos (`ReportMemberKpi`, builder de rango personalizado, sin cutover de TS)

Continúa la Sub-fase 1 (Fase 64) — mismo criterio de riesgo mínimo:
primitivas puras + assembler probados de forma aislada, sin tocar
ningún endpoint HTTP ni archivo TypeScript.

- **Builder elegido — rango personalizado, no rango de meses:** de los
  2 builders restantes de `buildSnapshotData.ts`
  (`buildRangeSnapshotData`/`buildCustomRangeSnapshotData`), se
  investigó cuál era más chico y seguro. `buildRangeSnapshotData`
  (RANGO_MESES) arma un `MonthSnapshot[]` con agregación mes a mes
  (promedios de `completedPct`/`score` entre meses activos) — bastante
  más complejo. `buildCustomRangeSnapshotData` (RANGO_PERSONALIZADO)
  resultó estructuralmente casi idéntico al builder mensual de la
  Sub-fase 1, solo con una resolución de fecha de corte más simple (sin
  `MonthClosure`, que es un mecanismo exclusivo de meses calendario).
- **Hallazgo — otra primitiva más ya portada:** `businessBaseForRange`
  (TS) es literal `return businessBaseCore(start, end)`, 1 línea. Su
  equivalente Django, `business_base_for_range`
  (`apps/configuration/services.py`), YA EXISTÍA — reutilizada
  internamente por `monthly_business_base` desde antes de esta sesión.
  No hizo falta escribir ninguna primitiva de fechas nueva.
- **2 funciones nuevas de `src/lib/reportInsights.ts`, también
  portadas en esta sub-fase** (el builder de rango personalizado las
  necesita, a diferencia del mensual): `derive_estado_operativo`
  (aproxima el Equilibrio Operativo sin el bundle de Analytics del mes
  en curso, reutilizando `classify_estado_operativo` ya portado desde
  la Fase 4e/4g) y `compute_principal_hallazgo` (un único hallazgo
  predominante por colaborador, reglas fijas de severidad) — réplicas
  exactas de `deriveEstadoOperativo`/`computePrincipalHallazgo`,
  verificadas línea por línea contra el TS, incluida la tabla
  `CARGA_LABEL_SCORE`.
- **Nueva función assembler en `backend/apps/reports/member_kpis.py`:**
  `compute_custom_range_member_kpis(...)` — réplica del bloque
  `ReportMemberKpi` de `buildCustomRangeSnapshotData`. Reutiliza
  `as_of_fecha_corte`/`compute_effective_member_bases` ya existentes
  del mismo módulo (Sub-fase 1), sin duplicarlas.
- 14 tests nuevos en `test_member_kpis.py` (mismo archivo, no uno
  aparte): caso básico, respeto de `fechaCorte` explícita, conteo de
  actividades de seguimiento por motivo, roster vacío, colaborador sin
  tareas, y un caso específico de rango NO calendario (marzo→abril)
  verificando que `compute_effective_member_bases` prorratea contra
  los límites del RANGO completo, no de un mes — más los tests propios
  de `derive_estado_operativo`/`compute_principal_hallazgo`.

**Archivos afectados:**
- `backend/apps/reports/member_kpis.py`
- `backend/apps/reports/tests/test_member_kpis.py`

**Impacto:** Segundo bloque del motor de cálculo de Reportes
Ejecutivos portado y probado, sin ningún riesgo para producción (sin
wiring HTTP, sin cambios en TS). Queda pendiente el builder de RANGO
DE MESES (agregación mes a mes, más complejo) y los agregados de
EQUIPO (`src/lib/reportInsights.ts`, cuadrante de riesgo/tendencias)
para sub-fases futuras. `ruff check apps/reports/` limpio, `pytest
apps/reports/tests/test_member_kpis.py` 30/30 en verde (16 de la
Sub-fase 1 + 14 nuevas), `pytest apps/reports apps/analytics
apps/users apps/team apps/tasks` 922/922 en verde (908 previos + 14,
corrida conjunta para descartar contaminación cruzada). Sin cambios de
TypeScript — no requirió `npx tsc`/`npm run lint`/Vitest.
**Autor:** Claude Code

---

## v1.124.0 — 2026-08-25

**Tipo:** FEATURE
**Módulo:** Migración de stack — Fase 64: Sub-fase 1 del motor de CÁLCULO de Reportes Ejecutivos (`ReportMemberKpi`, solo builder mensual, sin cutover de TS)

Primer paso real del motor de cálculo completo de Reportes Ejecutivos
(`ReportMemberKpi` + agregados de equipo), el trabajo grande que
quedaba pendiente tras cerrar el backlog de Centro de Configuración
(Fases 59-63). El usuario confirmó explícitamente arrancar la Sub-fase
1 tras una pregunta directa sobre el alcance (~13 sub-fases estimadas,
mismo tamaño que el port original de KPIs/Analytics).

- **Investigación con hallazgo mayor:** delegada a un fork, luego
  verificada línea por línea. La premisa inicial ("hay que portar todo
  desde cero") era incorrecta — Django YA tiene la gran mayoría de las
  primitivas necesarias, portadas mucho antes de esta sesión (Fase 4b,
  4d): `compute_simple_score`/`compute_completed_pct_any`/
  `compute_estimated_vs_real_ratio` (`apps/analytics/scoring.py`),
  `compute_workload_range`/`compute_workload_pct`/
  `sum_weighted_base_hours`/`sum_weighted_limit` (`apps/analytics/workload.py`),
  `compute_effective_history_start` (`apps/analytics/history.py`),
  `is_task_overdue` (`apps/analytics/utils.py`),
  `get_team_special_status_day_map`/`get_holiday_set`
  (`apps/configuration/services.py`), `business_day_real_range`
  (`apps/tasks/business_time.py`) — todas réplicas exactas ya
  verificadas de sus equivalentes TS. Lo genuinamente NUEVO era mucho
  más chico de lo estimado: 2 funciones nuevas (`as_of_fecha_corte`,
  2 líneas; `compute_effective_member_bases`, wiring de primitivas ya
  existentes) + 1 función assembler (`compute_monthly_member_kpis`).
- **Nuevo módulo `backend/apps/reports/member_kpis.py`:**
  - `as_of_fecha_corte(tasks, cutoff)` — réplica exacta de
    `asOfFechaCorte`: una tarea COMPLETADA cuyo `completed_at` es
    posterior al corte se trata como PENDIENTE para el snapshot (vista
    de solo lectura, nunca persiste). Opera sobre instancias `Task`
    copiadas en memoria (`copy.copy`), no dicts — mismo contrato de
    atributos que usan `compute_completed_pct_any`/`is_task_overdue`
    en el resto de `apps.analytics`.
  - `resolve_closure_cutoff(...)` — réplica de `resolveClosureCutoff`
    (Motor de Cierre Inteligente con Fecha de Corte).
  - `compute_effective_member_bases(...)` — réplica de
    `computeEffectiveMemberBases`: prorratea la base horaria/límites
    para colaboradores nuevos a mitad de período, reutilizando
    primitivas ya portadas.
  - `compute_monthly_member_kpis(...)` — assembler: réplica del bloque
    `ReportMemberKpi` de `buildMonthlySnapshotData` (solo builder
    MENSUAL). Devuelve `{user_id: dict}` SIN `id`/`name`/`role` (esos
    ya los tiene el roster resuelto del lado de Next.js — mismo patrón
    que `/analytics/<id>/`: Django calcula, el caller mergea con la
    identidad que ya tiene).
- **Deliberadamente SIN wiring a ningún endpoint HTTP todavía** — mismo
  criterio que usó el port original de KPIs/Analytics (primero las
  primitivas + su assembler probados de forma aislada, el endpoint y
  el cutover del `route.ts` real vienen en sub-fases futuras, después
  de verificar campo por campo contra el TS con datos reales). Cero
  cambios en TypeScript en esta fase.
- 16 tests nuevos, incluidos 3 bugs de test genuinos encontrados y
  corregidos al correrlos por primera vez (no bugs del código de
  producción): `compute_completed_pct_any`/`is_task_overdue` esperan
  atributos de objeto, no claves de dict (el diseño inicial pasaba
  dicts); `User.created_at`/`TaskActivity.created_at` son
  `auto_now_add`, así que los tests contra un período fijo en el
  pasado (2026-03) necesitan backdatearlos explícitamente o el
  "ahora" real del test los deja fuera de rango.

**Archivos afectados:**
- `backend/apps/reports/member_kpis.py` (nuevo)
- `backend/apps/reports/tests/test_member_kpis.py` (nuevo, 16 tests)

**Impacto:** Primer bloque real del motor de cálculo de Reportes
Ejecutivos portado y probado en Django, sin ningún riesgo para el
sistema en producción (sin wiring HTTP, sin cambios en TS). Reduce
significativamente la estimación de esfuerzo restante — la mayoría de
las primitivas de bajo nivel ya existían. `ruff check apps/reports/`
limpio, `pytest apps/reports apps/analytics apps/users apps/team
apps/tasks` 908/908 en verde (corrida conjunta para descartar
contaminación cruzada). Sin cambios de TypeScript — no requirió `npx
tsc`/`npm run lint`/Vitest.
**Autor:** Claude Code

---

## v1.123.0 — 2026-08-25

**Tipo:** FIX
**Módulo:** Migración de stack — Fase 63: corrección de hallazgo (la Fase 60 estaba equivocada) + limpieza de código muerto confirmado

Continuando "siguiente fase" tras la Fase 62, se eligió investigar la
limpieza de los "motores legacy" que las Fases 47-62 fueron marcando
como "sin importadores reales" (alternativa más chica que portar el
motor de cálculo completo de Reportes Ejecutivos). La investigación
encontró que esa caracterización era **parcialmente incorrecta**.

- **Corrección crítica:** `capacityForecast.ts`, `workload.ts`,
  `predictionEngine.ts` y `trendEngine.ts` (y partes de `analytics.ts`)
  NO son código muerto — se ejecutan de verdad en cada generación de un
  Reporte Ejecutivo: `POST /api/reports/executive` →
  `buildMonthlySnapshotData` (`buildSnapshotData.ts`) importa
  directamente de `workload.ts` y `predictionEngine.ts`;
  `computeSobrecargaProbability`/`computeSubutilizacionPredictions`
  (`predictionEngine.ts`) llaman a `computeCapacityForecast`/
  `computeTeamCapacityForecast` (`capacityForecast.ts`) y a
  `computeTrendEngine` (`trendEngine.ts`). Las fases anteriores solo
  verificaron importadores **directos** desde `src/app` (`grep` de una
  sola capa) — nunca siguieron la cadena transitiva completa hasta un
  `route.ts` real.
- **Hallazgo nuevo, no corregido en esta fase — divergencia activa de
  `workday_end_hour`:** `capacityForecast.ts` sigue llamando a
  `getEffectiveWorkdayEndHour()` (Postgres, retenida deliberadamente en
  la Fase 60 porque "capacityForecast.ts la importaba" — resultó ser la
  razón correcta, aunque en ese momento se caracterizó como código
  muerto que solo bloqueaba la compilación). Como `settings/
  trabajo-avanzado/route.ts` ya escribe este valor en Django desde la
  Fase 60, **hay 2 almacenes desincronizados**: un Administrador que
  edite la hora de corte de jornada desde Ajustes no ve ningún efecto
  real en la Capacidad Proyectada de un Reporte Ejecutivo del mes en
  curso. Severidad acotada (la rama que lo usa está gateada a
  "reporte del mes en curso", mismo patrón de bajo impacto que el
  hallazgo de la Fase 57) pero real. **NO se corrige acá** — arreglarlo
  bien requiere entender la interacción con `fecha de corte`/caché
  dentro del mismo motor que ya está identificado como el próximo gran
  trabajo pendiente (~13 sub-fases, Reportes Ejecutivos § motor de
  cálculo) — un parche aislado corre el riesgo de introducir su propia
  inconsistencia con ese trabajo futuro.
- **Limpieza real, sí ejecutada:** de los 10 archivos investigados,
  solo 3 resultaron genuinamente sin ningún importador real en todo
  `src/` (confirmado con `grep` transitivo + verificación manual):
  `recoveryCenter.ts` (Centro de Recuperación en TS, superado por
  `apps.recovery` en Django desde las Fases 39/50), `deskNoteRetention.ts`
  (purga de notas archivadas, superada por el cutover de Escritorio
  Digital, Fase 50) y `rate-limit.ts` (rate-limiting de login por IP,
  superado por el rate-limiting real de Django, Fase 6a). Los 3 +
  sus tests (`rate-limit.test.ts`, `deskNoteRetention.test.ts`)
  eliminados.
- `getEffectiveRecoveryRetentionHours`/`setRecoveryRetentionHours`,
  `getEffectiveDeskArchiveRetentionDays`/`setDeskArchiveRetentionDays`,
  `getEffectiveDeskNoteMaxReplies`/`setDeskNoteMaxReplies`,
  `getEffectiveSnoozePresetsMinutes`/`setSnoozePresetsMinutes`,
  `getEffectiveRetentionLoginAttempts`/`setRetentionLoginAttempts` (+
  10 constantes `CONFIG_KEY_*`/`DEFAULT_*`) eliminados de
  `systemConfig.ts` — sin consumidores reales restantes tras borrar
  los 3 archivos, confirmado con `grep`.
- **`insightsEngine.ts`/`riskAlerts.ts` (también sin consumidores
  reales) y el resto de `analytics.ts` (parcialmente muerto, mezclado
  con partes vivas en un archivo de 2400+ líneas) quedan FUERA de esta
  fase** — separarlos requiere extraer tipos compartidos
  (`components/kpis/types.ts` importa `RiskAlert` como tipo) y dividir
  un archivo de test compartido (`analytics-formulas.test.ts` cubre
  ambos), trabajo más delicado que amerita su propia fase.

**Archivos afectados:**
- Eliminados: `src/lib/recoveryCenter.ts`, `src/lib/deskNoteRetention.ts`,
  `src/lib/rate-limit.ts`, `src/__tests__/rate-limit.test.ts`,
  `src/__tests__/deskNoteRetention.test.ts`
- `src/lib/systemConfig.ts`
- `src/__tests__/systemConfig.test.ts`

**Impacto:** Corrige una afirmación incorrecta documentada en 3 lugares
(AUDIT_LOG/ROADMAP/VERSION, Fase 60). Documenta (sin corregir) una
divergencia de datos real pero de bajo impacto práctico. Elimina 3
archivos + 2 tests genuinamente muertos, más 20 símbolos huérfanos en
`systemConfig.ts`. `npx tsc --noEmit` limpio, `npm run lint` sin
hallazgos nuevos (verificado también con lint completo del proyecto,
todos los hallazgos preexistentes en archivos no tocados), suite
completa de Vitest 97 archivos / 1231 tests en verde (baja de 99/1259
por los 2 archivos de test eliminados, no por una regresión). Sin
cambios de backend.
**Autor:** Claude Code

---

## v1.122.0 — 2026-08-25

**Tipo:** REFACTOR
**Módulo:** Migración de stack — Fase 62: cutover de la duración de sesión (`session.ts`) — último valor pendiente de Centro de Configuración

Cierra el último candidato del backlog de valores de configuración con
consumidor real confirmado. A diferencia de las Fases 59-61
(cutover de un `route.ts` de Ajustes), acá el consumidor es
`src/lib/session.ts` — el módulo de sesión núcleo de la app, con más
cuidado que los anteriores por ser ruta crítica.

- **Investigación:** `createSession(data, rememberMe, durationHoursOverride)`
  solo cae a Postgres cuando NO recibe `durationHoursOverride`. De sus
  2 callers reales, `auth/login/route.ts` YA pasaba la duración
  resuelta por Django desde la Fase 6a (`session_policy` en la
  respuesta de login) — el fallback a Postgres nunca se ejecutaba ahí.
  El único caller que sí caía al fallback era `auth/me/route.ts`
  (re-emisión de sesión tras editar nombre/email), que no pasaba
  ningún override.
- **Decisión — se resuelve en el caller, no dentro de `session.ts`:**
  `auth/me/route.ts` ahora resuelve `session_duration_default_hours`
  contra Django (`GET /settings/seguridad-config/`, mismo endpoint que
  las Fases 59-61) ANTES de llamar a `createSession`, y lo pasa como
  `durationHoursOverride` — igual que ya hacía `login/route.ts`. Se
  evitó agregar una llamada a Django dentro de `session.ts` mismo (el
  módulo de sesión núcleo, importado por prácticamente toda la app)
  para no introducir una dependencia de red en un lugar tan central;
  el patrón "el caller resuelve, `session.ts` solo recibe el número"
  ya existía para login, así que extenderlo es consistente, no nuevo.
- Con ambos callers reales resolviendo la duración de antemano, el
  fallback de `session.ts` (antes Postgres) pasa a ser un piso de
  seguridad hardcodeado (168h/720h, mismos defaults que Django) para
  el caso sin caller real hoy de invocar `createSession` sin resolver
  la duración — `session.ts` queda sin ninguna dependencia de
  Prisma/Django en su código.
- **Comportamiento preexistente preservado, no corregido:** la
  re-emisión de sesión en `auth/me/route.ts` sigue usando siempre la
  duración "default" (nunca "recordarme"), incluso si la sesión
  original se creó con "recordarme" activo — quirk heredado del
  código original, documentado, fuera de alcance de este cutover.
- `getEffectiveSessionDurationDefaultHours`/
  `getEffectiveSessionDurationRememberHours`/`setSessionDurationDefaultHours`/
  `setSessionDurationRememberHours`/4 constantes eliminadas de
  `systemConfig.ts` (sin consumidores reales restantes, confirmado con
  `grep`).

**Archivos afectados:**
- `src/lib/session.ts`
- `src/lib/systemConfig.ts`
- `src/app/api/auth/me/route.ts`
- `src/__tests__/systemConfig.test.ts`
- `src/__tests__/api/auth.test.ts`

**Impacto:** Cierra el backlog de valores de configuración con
consumidor real confirmado (Fases 59-62: TTL de Nova, hora de corte de
jornada, longitud mínima de contraseña, duración de sesión). Sin
cambios de backend. `npx tsc --noEmit` limpio, `npm run lint` sin
hallazgos nuevos, suite completa de Vitest 99 archivos / 1259 tests en
verde.
**Autor:** Claude Code

---

## v1.121.0 — 2026-08-25

**Tipo:** FIX
**Módulo:** Migración de stack — Fase 61: cutover de `passwordMinLength` (`settings/seguridad-config`) + hallazgo de seguridad documentado

Cierra el último campo pendiente de `seguridad-config` (los otros 3 ya
estaban en Django desde la Fase 36). Mismo patrón que `nova-cache`
(Fase 59) y `trabajo-avanzado` (Fase 60): `SeguridadConfigView` (Django)
ya devolvía `password_min_length` en la misma respuesta desde la Fase
32 — no hizo falta backend nuevo.

- `settings/seguridad-config/route.ts`: `GET`/`PUT` ahora leen/escriben
  `passwordMinLength` en Django, igual que los otros 3 campos.
- Nuevo `src/lib/djangoPasswordPolicyConfig.ts`
  (`fetchDjangoPasswordMinLength`) para el único consumidor externo,
  `auth/change-password/route.ts` — se degrada al mismo default (6)
  que el backend si Django no está disponible.
- **Hallazgo de seguridad documentado, NO corregido en esta fase:**
  Django **no enforcea `password_min_length` en su propio flujo de
  cambio de contraseña** (`ChangeOwnPasswordSerializer.validate_new_password`
  llama a `django.contrib.auth.password_validation.validate_password`,
  que usa `AUTH_PASSWORD_VALIDATORS` — `MinimumLengthValidator` está
  **hardcodeado en `min_length=10`**, sin ninguna conexión con el valor
  configurable en `SystemConfigHistory`). Efecto práctico: un
  Administrador que configure una longitud mínima MENOR a 10 desde
  Ajustes (ej. 6, el default) obtiene una falsa sensación de control —
  Django sigue exigiendo 10 igual. Si configura un valor MAYOR a 10
  (ej. 12), sí tiene efecto real (la pre-validación de Next.js bloquea
  antes de llegar a Django). Esta ruta (`auth/change-password/route.ts`)
  sigue siendo solo una pre-validación de UX, nunca la única defensa —
  el validador autoritativo real siempre fue Django, y sigue sin
  reconectarse a este valor configurable. Requiere decisión de producto
  (¿un validador Django dinámico que lea `SystemConfigHistory` en cada
  request, o simplemente subir el hardcodeado a 10 como piso documentado
  y quitar la ilusión de configurabilidad?) — fuera de alcance de un
  cutover de lectura/escritura.
- `getEffectivePasswordMinLength`/`setPasswordMinLength`/
  `CONFIG_KEY_PASSWORD_MIN_LENGTH`/`DEFAULT_PASSWORD_MIN_LENGTH`
  eliminados de `systemConfig.ts` (sin consumidores reales restantes,
  a diferencia de `workdayEndHour` en la Fase 60 — nada más los
  importa).

**Archivos afectados:**
- `src/lib/djangoPasswordPolicyConfig.ts` (nuevo)
- `src/lib/systemConfig.ts`
- `src/app/api/auth/change-password/route.ts`
- `src/app/api/settings/seguridad-config/route.ts`
- `src/__tests__/systemConfig.test.ts`
- `src/__tests__/api/auth.test.ts`
- `src/__tests__/api/settings-config-center.test.ts`

**Impacto:** Cierra `settings/seguridad-config` al 100% en Django. Deja
documentado (no corregido) un hallazgo de seguridad real: el mínimo de
contraseña configurable en Ajustes tiene efecto parcial, dominado por
un piso hardcodeado de Django (10) que la UI no refleja. Sin cambios
de backend. `npx tsc --noEmit` limpio, `npm run lint` sin hallazgos
nuevos, suite completa de Vitest 99 archivos / 1260 tests en verde.
**Autor:** Claude Code

---

## v1.120.0 — 2026-08-25

**Tipo:** FIX
**Módulo:** Migración de stack — Fase 60: cutover completo de `settings/trabajo-avanzado` (hora de corte de jornada)

Continúa el patrón de la Fase 59 dentro de Centro de Configuración:
`workdayEndHour` era el único campo de `trabajo-avanzado` que seguía en
Postgres, documentado como bloqueado porque su único consumidor real era
`src/lib/capacityForecast.ts` (Inteligencia Preventiva, entonces 100%
Prisma). Ese bloqueo ya no existe.

- **Hallazgo — el motivo que bloqueaba este cutover quedó obsoleto sin
  que nadie lo notara:** desde el cutover de Inteligencia Preventiva
  (Fase 48, 2026-08-24), `capacityForecast.ts` quedó sin ningún
  importador real — es código muerto, reemplazado por
  `apps/analytics/capacity_forecast.py` en Django. El comentario del
  `route.ts` seguía afirmando "Predictive sigue 100% en Prisma", una
  aserción que dejó de ser cierta 1 fase antes sin que el comentario se
  actualizara.
- **Cutover más simple que el de Nova Cache (Fase 59):** `TrabajoAvanzadoView`
  (Django) ya devolvía `workday_end_hour` en la misma respuesta que
  `retroactive_window_days` desde la Fase 32 — no hizo falta ningún
  adaptador nuevo ni llamada extra a Django, solo dejar de ignorar el
  campo que ya llegaba en la respuesta existente.
- `settings/trabajo-avanzado/route.ts` simplificado: se eliminó la
  llamada paralela a Postgres (`getEffectiveWorkdayEndHour`/
  `setWorkdayEndHour`) en `GET` y `PUT`.
- **`getEffectiveWorkdayEndHour`/`setWorkdayEndHour` NO se eliminan de
  `systemConfig.ts`** (a diferencia de la Fase 59) — `capacityForecast.ts`
  sigue importándolos, y aunque ese archivo es código muerto en tiempo
  de ejecución, sigue siendo parte del build de TypeScript; eliminarlos
  ahora rompería la compilación. Queda documentado como candidato de
  limpieza si `capacityForecast.ts`/`analytics.ts`/`insightsEngine.ts`/
  `predictionEngine.ts`/`trendEngine.ts`/`riskAlerts.ts`/`workload.ts`
  (motores legacy, sin importadores reales desde el cutover de
  Analytics/Predictive) se eliminan en una fase futura dedicada.

**Archivos afectados:**
- `src/app/api/settings/trabajo-avanzado/route.ts`
- `src/__tests__/api/settings-config-center.test.ts`

**Impacto:** Cierra `settings/trabajo-avanzado` al 100% en Django. Sin
cambios de backend (`TrabajoAvanzadoView` ya estaba completa desde la
Fase 32). `npx tsc --noEmit` limpio, `npm run lint` sin hallazgos
nuevos, suite completa de Vitest 99 archivos / 1261 tests en verde.
**Autor:** Claude Code

---

## v1.119.0 — 2026-08-25

**Tipo:** FIX
**Módulo:** Migración de stack — Fase 59: cutover del TTL de caché de Nova (`settings/nova-cache`), cierra staleness activa

Continúa "Centro de Configuración" (punto 9 del roadmap de la migración):
de los ~9-12 valores de configuración cuyo CRUD ya vive en Django pero cuyo
consumidor REAL de runtime seguía leyendo `SystemConfigHistory` en
Postgres, se eligió el más aislado y de menor riesgo para arrancar —
`nova_cache_ttl_minutes` tiene un solo consumidor real (2 archivos) y
Django ya tenía `GET/PUT /settings/nova-cache/` completo y probado desde
la Fase 34, sin necesitar backend nuevo.

- **Hallazgo — staleness activa, no solo teórica:** `PUT
  /api/settings/nova-cache` (la UI de Ajustes) escribía en
  `SystemConfigHistory` de Postgres, pero `dashboard/nova-message` y
  `kpis/nova-insights/[userId]` calculaban su TTL de caché leyendo el
  mismo nombre de tabla en SQL Server vía Django — 2 almacenes
  desincronizados desde que esos 2 endpoints se cortaron a Django (Fase
  54): editar el TTL desde Ajustes no tenía ningún efecto real desde
  entonces.
- **`settings/nova-cache/route.ts` redirigido a Django** (`NovaCacheView`,
  sin cambios de backend — ya estaba completo). Nuevo
  `src/lib/djangoNovaCacheConfig.ts` (`fetchDjangoNovaCacheTtlMinutes`)
  para los 2 consumidores reales (`dashboard/nova-message`,
  `kpis/nova-insights/[userId]`) — se degrada al mismo default (240
  minutos) que el backend si Django no está disponible, ya que es solo la
  duración de una caché en memoria, nunca un dato que deba romper la
  generación del mensaje.
- **Limpieza:** `getEffectiveNovaCacheTtlMinutes`/`setNovaCacheTtlMinutes`/
  `CONFIG_KEY_NOVA_CACHE_TTL_MINUTES`/`DEFAULT_NOVA_CACHE_TTL_MINUTES`
  eliminados de `src/lib/systemConfig.ts` (sin consumidores reales
  restantes tras el cutover).

**Archivos afectados:**
- `src/lib/djangoNovaCacheConfig.ts` (nuevo)
- `src/lib/systemConfig.ts`
- `src/app/api/settings/nova-cache/route.ts`
- `src/app/api/dashboard/nova-message/route.ts`
- `src/app/api/kpis/nova-insights/[userId]/route.ts`
- `src/__tests__/systemConfig.test.ts`
- `src/__tests__/api/kpis-nova-insights.test.ts`
- `src/__tests__/api/settings-config-center.test.ts`
- `src/__tests__/api/nova-badges-documents.test.ts` (mock de
  `systemConfigHistory` ya muerto, eliminado en el mismo cambio)

**Impacto:** Cierra la staleness del TTL de caché de Nova. Sin cambios de
backend (Django ya estaba completo). `npx tsc --noEmit` limpio, `npm run
lint` sin hallazgos nuevos, suite completa de Vitest 99 archivos / 1260
tests en verde.
**Autor:** Claude Code

---

## v1.118.0 — 2026-08-25

**Tipo:** FEATURE
**Módulo:** Migración de stack — Fase 58: Asistente LLM/RAG, cutover de la base de conocimiento a Django (cálculo de embeddings sigue en TypeScript)

Continúa "Cutovers pendientes" tras Reportes Ejecutivos (Fase 57). El
Asistente (Nova) era el único módulo grande que quedaba, con un riesgo
técnico marcado desde antes en `docs/ROADMAP.md`: el cálculo de
embeddings parecía requerir portar un modelo de ML a Python.

- **Hallazgo que de-riesgó la fase por completo:** `getEmbedding()`
  (`src/lib/embeddings.ts`) usa `@xenova/transformers`, que corre el
  modelo de sentence-transformers (`Xenova/all-MiniLM-L6-v2`) EN
  PROCESO dentro de Node.js — no es una llamada a una API externa. No
  hacía falta portar nada a Python: alcanza con mover la PERSISTENCIA
  del resultado ya calculado, mismo patrón que Reportes Ejecutivos
  (Fase 56).
- **App Django nueva `apps.assistant`:** `KnowledgeDocument` (título,
  nombre de archivo, contenido extraído, ruta/sha de GitHub, estado
  PROCESANDO/LISTO/ERROR, autor) + `DocumentChunk` (contenido,
  `embedding` como `JSONField` — el vector ya calculado en TS, Django
  nunca lo toca ni lo recalcula) — réplica exacta de
  `prisma/schema.prisma`. 4 vistas nuevas
  (`KnowledgeDocumentListCreateView`/`KnowledgeDocumentDetailView`/
  `DocumentChunkBulkCreateView`/`DocumentChunkListView`), gateadas por
  `CanViewKnowledgeBase`/`CanManageKnowledgeBase` (réplica de
  `canViewKnowledgeBase`/`canManageKnowledgeBase` de
  `src/lib/roles.ts`) — `DocumentChunkListView` es la única sin ese
  gate (cualquier autenticado puede leerla, mismo criterio que el chat
  en modo "hr" del TS original, que la usa para cualquier rol).
- **Lado TypeScript:** nuevo `djangoAssistantAdapter.ts`;
  `src/lib/githubDocuments.ts::processGithubDocument` reemplaza sus 5
  llamadas a `prisma.knowledgeDocument.update`/
  `prisma.documentChunk.deleteMany` por las funciones del adaptador —
  la descarga/extracción de texto/chunking/generación de embeddings no
  cambia. `assistant/documents/route.ts` (GET/POST) y
  `assistant/documents/[id]/route.ts` (DELETE) cortados igual.
- **`assistant/chat/route.ts` recompuesto, no solo cortado:**
  `buildTaskContext` usa `fetchOwnDjangoTasks()` (ya existente desde
  la Fase 3a); `buildTeamContext` usa `GET /team/` + `GET
  /team/<id>/tasks/` (Fase 18/46) en vez de 1+N consultas Prisma;
  `findRelevantChunks` usa `GET /assistant/chunks/` en vez de
  `prisma.documentChunk.findMany` — la búsqueda por similitud coseno
  (`cosineSimilarity`) sigue calculándose en TypeScript sin cambios.
  La llamada a Groq no se toca.
- **Hallazgo aditivo de API:** `github_sha` no estaba en
  `KnowledgeDocumentSerializer` (el TS original leía el registro
  Prisma completo, sin `select`) — se agregó porque
  `DELETE .../[id]/route.ts` lo necesita para borrar el archivo de
  GitHub antes de eliminar el registro.

**Archivos afectados:**
- `backend/apps/assistant/` (app nueva completa: `models.py`,
  `permissions.py`, `serializers.py`, `views.py`, `urls.py`,
  `migrations/0001_initial.py`, `tests/test_assistant_views.py` — 24
  tests)
- `backend/config/settings/base.py` (`INSTALLED_APPS`)
- `backend/config/api_v1_urls.py` (`assistant/` → `apps.assistant.urls`)
- `src/lib/djangoAssistantAdapter.ts` (nuevo)
- `src/lib/githubDocuments.ts`
- `src/app/api/assistant/documents/route.ts`
- `src/app/api/assistant/documents/[id]/route.ts`
- `src/app/api/assistant/chat/route.ts`
- `src/__tests__/api/assistant-documents.test.ts` (reescrito)
- `src/__tests__/api/assistant-chat.test.ts` (reescrito)
- `src/__tests__/api/nova-badges-documents.test.ts` (bloque `DELETE
  /api/assistant/documents/[id]` reescrito)

**Impacto:** Cierra el cutover del módulo Asistente/RAG. `npx tsc
--noEmit` limpio, `npm run lint` sin hallazgos nuevos, suite completa
de Vitest 99 archivos / 1260 tests en verde. `pytest apps/assistant/
apps/reports/ apps/users/ apps/team/ apps/tasks/` 285/285 en verde,
`ruff check` limpio en los módulos tocados (los 28 hallazgos de `ruff
check .` global son deuda preexistente en `apps/tasks/tests/`, ajena a
esta fase). Sin migración de datos: los documentos/chunks ya existentes
en Postgres no se portan automáticamente (mismo criterio que el resto
de la migración — la tabla de origen queda intacta hasta el
decommission final).
**Autor:** Claude Code

---

## v1.117.0 — 2026-08-25

**Tipo:** FIX
**Módulo:** Migración de stack — Fase 57: Reportes Ejecutivos, primer recorte del motor de CÁLCULO recompuesto sobre Django (Índice Ejecutivo)

Continúa tras cerrar la persistencia (Fase 56). Se investigó el motor
de cálculo para decidir por dónde empezar: `buildMonthlySnapshotData`
tiene 2 cómputos por colaborador distintos — el **Índice Ejecutivo**
(`computePerformanceScore`/`computeHealthScore`, ya portados a Django
desde la Fase 4e/4g) y el **KPI del miembro del reporte**
(`ReportMemberKpi`, lógica propia sin equivalente en Django, calculada
en lote sobre Task/TaskActivity). Solo el primero tenía un recompose
limpio disponible — el segundo queda como investigación pendiente.

- **Bloqueador encontrado a mitad de camino:** el roster se resuelve
  con cuids de Postgres (`resolveReportRoster`, necesario para las
  queries Prisma de Tareas/Actividades, sin cambios) y no existía
  ningún endpoint Django para traducir un LOTE de cuids a ids
  numéricos — `/auth/me/` solo resuelve "a mí mismo",
  `GET /admin/users/` exige el permiso de administración
  (`usuarios.ver`), distinto del que usa Reportes Ejecutivos
  (`canAccessReports` — un Coordinador Nacional puede generar
  reportes sin acceso a administración de usuarios).
- **Vista Django nueva:** `GET /reports/user-lookup/?legacy_ids=...`
  (`backend/apps/reports/`, gateada por `CanAccessReports`) resuelve
  el lote cuid→id numérico.
- **`buildSnapshotData.ts` reemplaza 2 llamadas locales por 1 llamada
  por colaborador:** en vez de `computePerformanceScore`/
  `computeHealthScore` separados, se lee `/analytics/<id>/` (bundle ya
  existente desde la Fase 4m/47) — trae ambos valores juntos, mejor
  que el original. Nuevo módulo `djangoAnalyticsBridge.ts` con el
  puente de ids + el fetch del bundle, cacheado con el mismo `cached()`
  y TTL que antes.
- **Degradación explícita, no bloqueante:** un colaborador sin id de
  Django resuelto (nunca importado desde Postgres) se excluye del
  promedio del Índice Ejecutivo — la generación del reporte no aborta.
- **Gap documentado:** `/analytics/<id>/` siempre calcula contra
  `now()` real, sin parámetro de fecha de corte — sin efecto en el
  caso común (esta rama solo corre para el mes calendario EN CURSO,
  donde el corte ya es ≈ `now()`), salvo un `fechaCorte` manual
  explícito (uso excepcional, documentado en el código).
- **Cobertura de tests:** `djangoAnalyticsBridge.test.ts` (nuevo, 7
  tests) — puente de ids y fetch del bundle, incluida la degradación
  ante Django no disponible. `TestUserLegacyIdLookup` (backend, 5
  tests) — autenticación, permisos (confirma que NO exige
  `usuarios.ver`), 400 sin `legacy_ids`, resolución con ids no
  encontrados ignorados. `pytest apps/reports/ apps/users/` 100/100 en
  verde, `ruff check` limpio. `npx tsc --noEmit` limpio, `npm run
  lint` sin hallazgos nuevos, suite completa de Vitest 99 archivos /
  1259 tests en verde.

**Archivos:** `backend/apps/reports/{views,urls}.py`,
`backend/apps/reports/tests/test_executive_reports.py`,
`src/lib/executiveReporting/{buildSnapshotData,djangoAnalyticsBridge}.ts`,
`src/__tests__/executiveReporting/djangoAnalyticsBridge.test.ts`

**Impacto:** primer paso real de sacar Prisma del motor de cálculo de
Reportes Ejecutivos, sin tocar ninguna fórmula (mismos valores, misma
fuente de verdad que ya usan Dashboard/Analytics). El grueso del motor
(`ReportMemberKpi`, agregados de equipo en `reportInsights.ts`) sigue
sin portar — candidato a su propia investigación futura (¿recompone
sobre `/kpis/<id>/`, o necesita backend nuevo?). Ningún modelo ni
migración nueva.

**Autor:** Claude Code

---

## v1.116.0 — 2026-08-25

**Tipo:** FIX
**Módulo:** Migración de stack — Fase 56: Reportes Ejecutivos, cutover de persistencia + lectura (cálculo sigue en Next.js)

Continúa la migración con SQL Server ya operativo (recuperado en el
cierre de la Fase 55). Se auditó a fondo `src/lib/executiveReporting/`
(19 archivos, 3866 líneas) antes de decidir el alcance: el motor de
cálculo (`buildSnapshotData.ts`, roster + KPIs por colaborador +
agregados de equipo + narrativa NOVA) es un proyecto propio de varias
sub-fases, del mismo orden que KPIs/Analytics (~13 sub-fases). Esta
fase NO lo porta — cierra en cambio un hallazgo de mayor impacto
inmediato encontrado durante la auditoría.

- **Hallazgo crítico — staleness activa desde la Fase 8
  (2026-08-18):** `POST /api/reports/executive` (generación) seguía
  escribiendo `ExecutiveReportSnapshot` en Postgres vía Prisma,
  mientras que `ExecutiveReportListView`/`ExecutiveReportDetailView`
  (Django, ya completos desde la Fase 8) leían de SQL Server. Todo
  reporte generado en Next.js desde entonces era invisible para esos
  2 endpoints de lectura — solo servían los 4 registros del backfill
  original (`origin=LEGACY_MIGRATION`).
- **2 vistas Django nuevas, sin portar el motor de cálculo:**
  `ExecutiveReportCreateView` (`POST /reports/executive/`) y
  `ExecutiveReportAuditCreateView` (`POST /reports/executive/audit/`,
  `backend/apps/reports/`) solo PERSISTEN el snapshot que
  `buildSnapshotForFilters` ya calculó en Next.js — sin ningún cambio
  ahí. `generated_by`/`user` se resuelven desde `request.user` (JWT),
  nunca desde el body — evita que un cliente atribuya un reporte a
  otro usuario, y es más simple que el resto de la migración (no
  necesita `resolveDjangoUserId`).
- **Colisión de `report_id` → 409, no 400:** se desactivó el
  `UniqueValidator` automático que DRF agrega para campos
  `unique=True` (`validators=[]` en el serializer) — la colisión se
  detecta recién en la escritura (`IntegrityError`), traducida a 409;
  el reintento con un id nuevo sigue viviendo en `snapshotStore.ts`
  (TS), sin cambios de comportamiento.
- **`GET /api/reports/executive/list` + `/[reportId]` cortados como
  reenvío directo** a las vistas de lectura ya existentes de la Fase
  8 (sin cambios de backend ahí) — `ensureSnapshotMeta`/visibilidad
  por `scope`/auditoría `viewed` ya vivían en Django, no se
  re-implementan en TS.
- **Cobertura de tests:** `apps/reports/tests/test_executive_reports.py`
  — 2 clases nuevas (`TestExecutiveReportCreate`/
  `TestExecutiveReportAuditCreate`, 9 tests) cubriendo autenticación,
  permisos, atribución forzada al usuario autenticado (ignora
  `generated_by` del body), 409 por colisión y 400 por campo
  faltante. `snapshotStore.test.ts` (TS) reescrito para mockear
  `djangoApiFetch` en vez de Prisma, mismo comportamiento de
  reintento verificado contra la nueva semántica 409.
  `reports-executive.test.ts` — bloques `[reportId]`/`list`
  reescritos como reenvío directo; bloque `POST` conserva el mockeo
  pesado de Prisma para el motor de cálculo (sin cambios), solo la
  persistencia pasa a mockear `djangoApiFetch`. `pytest apps/reports/
  apps/users/` 95/95 en verde, `ruff check` limpio. `npx tsc --noEmit`
  limpio, `npm run lint` sin hallazgos nuevos, suite completa de
  Vitest 98 archivos / 1252 tests en verde.

**Archivos:** `backend/apps/reports/{views,serializers,urls}.py`,
`backend/apps/reports/tests/test_executive_reports.py`,
`src/lib/executiveReporting/{snapshotStore,buildSnapshotData}.ts`,
`src/app/api/reports/executive/{route,list/route}.ts`,
`src/app/api/reports/executive/[reportId]/route.ts`,
`src/__tests__/executiveReporting/snapshotStore.test.ts`,
`src/__tests__/api/reports-executive.test.ts`

**Impacto:** cierra una staleness activa de más de una semana (todo
reporte generado desde la Fase 8 era invisible en los endpoints de
lectura de Django). Deja el terreno preparado para portar el motor de
cálculo en una fase futura, sin apuro — la persistencia ya es
correcta independientemente de cuándo se porte `buildSnapshotData.ts`.
Ningún modelo ni migración nueva (reutiliza `ExecutiveReportSnapshot`/
`ExecutiveReportAuditLog` de la Fase 8).

**Autor:** Claude Code

---

## v1.115.0 — 2026-08-25

**Tipo:** FIX
**Módulo:** Migración de stack — Fase 55 (cierre): cutover de `view-preferences` + `activityFormat` — completa el cluster de Consentimiento/Preferencias

Cierra las 2 rutas que habían quedado bloqueadas más temprano en la
misma sesión (v1.114.0) por lo que parecía falta de acceso a SQL
Server.

- **Diagnóstico corregido:** el problema real no era "SQL Server no
  disponible" — era apuntar al puerto equivocado. `backend/.env` ya
  tenía el valor correcto (`DB_PORT=14330`), pero se probó primero
  contra una instancia SQL Server Express nativa en otro puerto,
  porque Docker no parecía estar corriendo en el primer chequeo.
  `localhost:14330` es en realidad el contenedor Docker
  `gestion_tareas_rrhh-mssql-1` de este proyecto (Docker sí estaba
  activo, solo no se había vuelto a verificar). Con el contenedor
  correcto identificado, la contraseña ya presente en `.env` funcionó
  sin cambios.
- **2 vistas Django nuevas** (`apps/users/self_service_views.py`):
  `UserViewPreferencesView` (`GET`/`PATCH /users/<id>/view-preferences/`)
  y `ActivityFormatView` (`GET`/`PATCH /users/activity-format/`).
  `UserViewPreferencesView.PATCH` replica fielmente un bug preexistente
  del TS legacy — reemplaza `view_preferences` completo, sin fusionar
  con `ACTIVITY_FORMAT:`/`DASHBOARD_CARDS:`/`CONFIG_FAVORITE:` — no se
  corrigió de paso. `.GET` es aditivo (el TS legacy nunca tuvo esa
  ruta como `GET`), necesario para que `tasks/page.tsx` pueda leer el
  array completo desde Django. `ActivityFormatView` reutiliza el mismo
  truco de prefijo que `FavoritesView`/`DashboardCardOrderView`.
- **2 rutas Next.js reconectadas:** `PATCH /api/users/[id]/view-preferences`
  y la porción `activityFormat` de `GET`/`PATCH /api/auth/me`.
- **Cierra además el gap explícito documentado desde la Fase 3a en
  `tasks/page.tsx`:** ya no lee `viewPreferences` de Prisma — resuelve
  `fetchDjangoCurrentUserId()` y pasa el id numérico de Django a
  `TasksModule` (antes usaba el cuid de Postgres, porque
  `view-preferences` seguía en Prisma). El comentario "OJO — gap
  explícito" que documentaba esto desde 2026-08-07 se elimina.
- **Cobertura de tests:** 9 tests nuevos en `test_self_service_views.py`
  (backend) para las 2 vistas nuevas, incluida una prueba explícita del
  bug de reemplazo completo replicado a propósito. `auth.test.ts`
  (bloques `GET`/`PATCH /api/auth/me`) y `users-id.test.ts` (bloque
  `view-preferences`) reescritos para mockear `djangoApiFetch` — mocks
  de Prisma huérfanos removidos por completo de ambos archivos (ya sin
  ningún consumidor). `pytest apps/users/` 63/63 en verde (verificado
  en aislamiento, sin la contención transitoria de correr el full-suite
  compartido en paralelo), `ruff check` limpio. `npx tsc --noEmit`
  limpio, `npm run lint` sin hallazgos nuevos, suite completa de Vitest
  98 archivos / 1248 tests en verde.

**Archivos:** `backend/apps/users/self_service_views.py`,
`backend/apps/users/self_service_urls.py`,
`backend/apps/users/tests/test_self_service_views.py`,
`src/app/api/users/[id]/view-preferences/route.ts`,
`src/app/api/auth/me/route.ts`,
`src/app/(protected)/tasks/page.tsx`,
`src/__tests__/api/{auth,users-id}.test.ts`

**Impacto:** cierra por completo el cluster de Consentimiento/
Preferencias de usuario (6 de 6 rutas) — junto con Nova Insights/Message
(Fase 54), deja "Decommission de Postgres" con solo la importación de
datos reales (postergada a propósito) y los 2 ítems mayores (Asistente
LLM/RAG, Reportes Ejecutivos) como trabajo genuinamente pendiente.
Ningún modelo ni migración nueva.

**Autor:** Claude Code

---

## v1.114.0 — 2026-08-25

**Tipo:** FIX
**Módulo:** Migración de stack — Fase 55: cutover PARCIAL de Consentimiento/Preferencias de usuario (4 de 6 rutas)

Continúa "Cutovers pendientes" — punto 2 de "Decommission de
Postgres" (`docs/ROADMAP.md`). Su premisa también estaba
desactualizada: decía que el modelo `User` de Django no tenía los
campos necesarios, pero `theme`/`view_preferences`/`badges`/
`data_consent_accepted`/`data_consent_accepted_at` ya existen desde
las Fases 12/25/26.

- **4 rutas redirigidas a Django, sin backend nuevo:** `PATCH
  /api/auth/consent` (→ `AcceptConsentView`, Fase 13), `PATCH
  /api/dashboard/card-order` (→ `DashboardCardOrderView`, Fase 25),
  `PATCH /api/users/[id]/reset-consent` y `PATCH
  /api/users/reset-consent-all` (→ acciones `reset_consent`/
  `reset_consent_all` de `UserAdminViewSet`, Fase 13) — las 4 vistas
  ya estaban completas y probadas, solo faltaba reconectar el
  `route.ts`.
- Las 2 rutas de `users/[id]` conservan `canManageUsers`/
  `canManageTargetUser` en TS (no se delegó 100% a Django) — mismo
  criterio que `reset-password/route.ts` (Fase 2), el módulo de
  administración de usuarios sigue prefiriendo defensa en profundidad
  sobre confiar ciegamente en el catálogo de permisos de Django.
- `dashboard/card-order` cierra además el riesgo de divergencia
  documentado desde la Fase 36/51 (`favorites` ya escribía en
  `User.view_preferences` de Django; `card-order` seguía escribiendo
  en Postgres — 2 copias del mismo array).
- **2 rutas quedan BLOQUEADAS en esta sesión — no por falta de
  trabajo, por falta de acceso a SQL Server:** `PATCH
  /api/users/[id]/view-preferences` y la porción `activityFormat` de
  `GET/PATCH /api/auth/me` necesitan una vista Django nueva
  (`view_preferences` existe en el modelo pero sin endpoint de
  escritura genérico). `./venv/Scripts/python.exe -m pytest` falló
  con `OperationalError` contra `localhost:14330` (sin listener TCP
  en esta sesión, confirmado con `Get-NetTCPConnection`) — se decidió
  no escribir ese código de backend sin poder verificarlo con
  `pytest`, a diferencia de fases anteriores.
- **Hallazgo documentado, no corregido:** el `view-preferences/route.ts`
  legacy REEMPLAZA el array `viewPreferences` completo en vez de
  fusionar solo la clave que le corresponde — a diferencia de
  `card-order`/`favorites`/`activityFormat` (que sí preservan las
  demás claves de prefijo), un cambio de vistas de Tareas (KANBAN/
  TABLA) borra silenciosamente cualquier `ACTIVITY_FORMAT:`/
  `DASHBOARD_CARDS:`/`CONFIG_FAVORITE:` guardado en Postgres. Es un
  bug preexistente del TS original (no introducido por esta fase) — se
  replicará fielmente cuando se corte esa ruta, no se corregirá de
  paso sin que se pida explícitamente.
- **Cobertura de tests:** `auth.test.ts` (bloque `consent`),
  `dashboard.test.ts` (bloque `card-order`, mocks de Prisma huérfanos
  removidos del archivo completo) y `users-id.test.ts` (bloques
  `reset-consent`/`reset-consent-all`, mocks `findUnique`/`updateMany`
  huérfanos removidos) reescritos para mockear `djangoApiFetch`; cada
  uno con un test nuevo para "sesión sin acceso a Django todavía".
  `npx tsc --noEmit` limpio, `npm run lint` sin hallazgos nuevos,
  suite completa de Vitest 98 archivos / 1247 tests en verde. Sin
  cambios de backend en esta fase.

**Archivos:** `src/app/api/auth/consent/route.ts`,
`src/app/api/dashboard/card-order/route.ts`,
`src/app/api/users/[id]/reset-consent/route.ts`,
`src/app/api/users/reset-consent-all/route.ts`,
`src/__tests__/api/{auth,dashboard,users-id}.test.ts`

**Impacto:** avanza "Decommission de Postgres" en 4 de 6 rutas
restantes de este cluster. Cierra un riesgo de divergencia documentado
desde la Fase 36 (`card-order`/`favorites` ya no pueden pisarse entre
Postgres y Django). `view-preferences`/`auth/me` quedan como trabajo
pendiente explícito para una sesión con acceso a SQL Server. Ningún
modelo ni migración nueva.

**Autor:** Claude Code

---

## v1.113.0 — 2026-08-24

**Tipo:** FIX
**Módulo:** Migración de stack — Fase 54: cutover de Nova Insights/Message + fix de bug de ids en `MyKpisModule.tsx`

Quincuagésima cuarta sub-fase — continúa "Cutovers pendientes".
`kpis/nova-insights/[userId]` y `dashboard/nova-message` eran los
últimos consumidores reales que seguían llamando a `src/lib/analytics.ts`/
`src/lib/workload.ts` (Prisma) directamente en vez de a Django, pese a
que el motor que consultan está 100% portado desde la Fase 4m.

- **2 rutas recompuestas sobre Django, sin backend nuevo:**
  `kpis/nova-insights/[userId]` combina `GET /analytics/<id>/`
  (bundle Health Score/alertas/tendencias/consistencia/anomalías/
  predicción/calidad del dato, Fase 4m), `GET /kpis/<id>/` (nombre/
  rol del colaborador + estado especial vigente del mes) y `GET
  /analytics/operational-risk/<id>/` (Fase 47, solo si el viewer
  puede ver Riesgo Operativo). `dashboard/nova-message` combina
  `fetchOwnDjangoTasks` (`GET /tasks/`, Fase 3a — ya filtra tareas
  propias no archivadas) y `GET /kpis/me/` (carga de tiempo del día).
  Groq permanece en Next.js sin cambios — solo cambió de dónde vienen
  los datos que arma el `ctx` antes de llamarlo.
- **Bug activo encontrado y cerrado, misma familia que las Fases
  42/52:** `MyKpisModule.tsx` (pestaña "Mis KPIs", vista propia) le
  pasaba a 6 usos (`NovaInsightsCard`, `WhatIfSimulator`,
  `AdvancedAnalyticsPanel`, `InsightsPanel`, `ScoreHistoryChart`,
  `downloadKpisPDF`) el cuid de Postgres (`currentUserId`, derivado de
  `session.userId`) en vez del id numérico de Django que esas rutas ya
  esperan desde su propio cutover (Fase 47). La vista de equipo
  (`KpisModule.tsx`) sí usaba el id correcto (`kpi.user.id`) y
  funcionaba bien — el problema era exclusivo de la vista propia.
  Efecto real: ver Nova Insights (y el resto de esos 5 paneles) de un
  compañero de equipo devolvía 404 desde que Analytics/KPIs se cortó
  (Fase 47), sin que nadie lo notara porque cada fase probó su propio
  endpoint de forma aislada, no la cadena completa componente→ruta.
  Cortar `nova-insights` a Django sin este fix habría además roto la
  vista PROPIA (hoy funciona por casualidad: el `route.ts` anterior
  seguía en Prisma, y el cuid sí resuelve contra Postgres) — una
  interdependencia real, no evitable, igual que la Fase 42.
- **Decisión de alcance (confirmada con el usuario):** ya que el fix
  era una línea por cada uno de los 6 usos y todos comparten la misma
  causa raíz, se corrigieron los 6 juntos en vez de solo
  `NovaInsightsCard` — cierra el bug completo de "Mis KPIs" en un solo
  cambio en lugar de dejar 4 paneles con el mismo problema activo.
  `currentUserId` quedó sin ningún uso en `MyKpisModule`/
  `AnalyticsModule`/`my-kpis/page.tsx` tras el fix — se eliminó de las
  3 firmas en vez de dejarlo como parámetro muerto.
- **Decisión — `nova-message` degrada a un saludo genérico (200) si
  Django no está disponible para la sesión, en vez del patrón de 401
  usado en el resto de la migración:** es una ruta puramente cosmética
  (el saludo del Dashboard) que antes de este cutover nunca podía
  fallar por un problema de infraestructura (Postgres siempre
  disponible) — preservar ese comportamiento evita mostrar un error
  visible por algo que el usuario no puede resolver.
- **Cobertura de tests:** `kpis-nova-insights.test.ts` (nuevo, la ruta
  nunca tuvo tests) — 10 casos cubriendo los 3 modos (motivacional/
  insights-only/completo), propagación de 401/403/404 de Django,
  caché y fallback sin `GROQ_API_KEY`. `nova-badges-documents.test.ts`
  — el bloque de `nova-message` reescrito para mockear
  `fetchOwnDjangoTasks`/`djangoApiFetch` en vez de
  `prisma.task.findMany`/`computeCargaTiempo` (mocks huérfanos
  removidos), con 2 tests nuevos para "Django no disponible".
  `MyKpisModule.test.tsx` actualizado a la firma sin `currentUserId`.
  `npx tsc --noEmit` limpio, `npm run lint` sin hallazgos nuevos en
  los archivos tocados, suite completa de Vitest 98 archivos / 1243
  tests en verde. Sin cambios de backend.

**Archivos:** `src/app/api/kpis/nova-insights/[userId]/route.ts`,
`src/app/api/dashboard/nova-message/route.ts`,
`src/components/kpis/MyKpisModule.tsx`, `src/components/kpis/AnalyticsModule.tsx`,
`src/app/(protected)/my-kpis/page.tsx`,
`src/__tests__/api/kpis-nova-insights.test.ts` (nuevo),
`src/__tests__/api/nova-badges-documents.test.ts`,
`src/__tests__/components/MyKpisModule.test.tsx`

**Impacto:** cierra el último gap de cutover del Centro de
Configuración/Nova documentado desde la Fase 49. Corrige un bug activo
de 404 en 5 paneles de la pestaña "Mis KPIs" al ver a un compañero de
equipo (vigente desde la Fase 47). Desbloquea, para una fase futura,
los 6 endpoints de `settings/*` que seguían sin cutover por depender
de Nova (`analytics-config`, `normalization-curves`, `nova-cache`,
entre otros — a re-auditar). Ningún modelo ni migración nueva.

**Autor:** Claude Code

---

## v1.112.0 — 2026-08-24

**Tipo:** FIX
**Módulo:** Migración de stack — Fase 53: cutover de `settings/config-history` + `settings/config-history/restore-default`

Quincuagésima tercera sub-fase — continúa "Cutovers pendientes". Antes
de arrancarla se corrigió `docs/ROADMAP.md` § Planificado (punto 14,
"Decommission de PostgreSQL"): su párrafo describía a Notificaciones/
Reuniones/`users/assignable`/Ideas/Comunicados como pendientes de
cutover, pero esos 5 ya se habían cerrado en las Fases 41-44
(2026-08-21) — el párrafo nunca se actualizó para reflejarlo, quedando
desactualizado por más de 10 fases.

- **2 rutas redirigidas a Django:** `GET /api/settings/config-history`
  + `POST /api/settings/config-history/restore-default` — ambas
  vistas (`ConfigHistoryView`/`ConfigHistoryRestoreDefaultView`) ya
  estaban completas y probadas en el backend desde la Fase 33, réplica
  exacta del `route.ts` original (mismo criterio que la Fase 51: solo
  reconectar, sin trabajo de backend nuevo).
- Traducción de respuesta snake_case→camelCase a mano
  (`valid_from`→`validFrom`, `valid_until`→`validUntil`,
  `updated_by_name`→`updatedByName`) — mismo criterio que
  `workload-config`/`kpi-start-date` en la Fase 52. Validación de
  `keys`/`defaults` y el chequeo de rol ADMINISTRADOR se conservan en
  el `route.ts` como defensa en profundidad (mismo criterio que
  `role-targets`/`config-history` en el propio backend), evitando un
  round-trip innecesario a Django para requests inválidos.
- **Cobertura de tests:** `settings-config-center.test.ts` — los 2
  bloques (`GET /api/settings/config-history` y `POST .../
  restore-default`) reescritos para mockear `djangoApiFetch` en vez de
  `prisma.systemConfigHistory.findMany`/`setConfigValue`; mocks
  huérfanos removidos (`vi.mock("@/lib/prisma", ...)` completo y
  `setConfigValue` del mock de `systemConfig`, sin más consumidores en
  este archivo tras el cutover). Nueva cobertura para el caso "sesión
  sin acceso a Django todavía" (`djangoApiFetch` devuelve `null`) en
  ambas rutas, gap que no tenían los tests originales. `npx tsc
  --noEmit` limpio, `npm run lint` sin hallazgos nuevos en los
  archivos tocados, suite completa de Vitest 97 archivos / 1231 tests
  en verde. Sin cambios de backend — `apps.configuration` ya estaba
  completo desde la Fase 33, no requirió corrida de pytest.

**Archivos:** `src/app/api/settings/config-history/route.ts`,
`src/app/api/settings/config-history/restore-default/route.ts`,
`src/__tests__/api/settings-config-center.test.ts`,
`docs/ROADMAP.md` (corrección del párrafo desactualizado de la Fase 40)

**Impacto:** cierra el último gap de cutover del historial de
auditoría de configuración — el Centro de Configuración queda 100%
servido desde Django salvo los ítems ya documentados como bloqueados
(Nova Insights/Message, sin vista Django; Reportes Ejecutivos, sin
cutover). Ningún modelo ni migración nueva.

**Autor:** Claude Code

---

## v1.111.0 — 2026-08-24

**Tipo:** FIX
**Módulo:** Migración de stack — Fase 52: cutover de `holidays`/`leave-records`/`special-status`/`workload-config`/`kpi-start-date`

Quincuagésima segunda sub-fase — cierra el hallazgo documentado (no
corregido) en la Fase 51: estos 5 endpoints de `settings/*` ya
divergían del bundle de Analytics/Dashboard desde la Fase 4a/4m,
meses antes de esta sesión — editarlos desde Ajustes no tenía ningún
efecto real en Django, que ya calcula con su propia configuración
(default, nunca sincronizada con Postgres).

- **8 rutas redirigidas a Django:** `GET/POST /settings/holidays/` +
  `DELETE .../<id>/`, `GET/POST /settings/leave-records/` +
  `DELETE .../<id>/`, `GET/POST /settings/special-status/` +
  `PATCH/DELETE .../<id>/`, `GET/PUT /settings/workload-config/`,
  `GET/PATCH /settings/kpi-start-date/` — las 8 vistas ya estaban
  completas en el backend desde la Fase 29/31, sin cambios de motor.
- **Bug activo cerrado — más severo de lo esperado:** `leave-records`/
  `special-status` reciben `userId` desde un selector poblado por
  `GET /api/users` (Django, id numérico desde la Fase 2) — como esas
  2 rutas seguían en Prisma, ese id nunca coincidía con ningún `cuid`
  de Postgres. **Crear un permiso o estado especial para CUALQUIER
  usuario devolvía 404 "Usuario no encontrado" en la práctica, desde
  la Fase 2** — mucho antes de que el hallazgo de la Fase 51 hiciera
  sospechar del resto de este grupo.
- **Hallazgo y corrección de backend — `HolidayListView.get` exigía
  ADMINISTRADOR por error:** el docstring de la Fase 29 afirmaba
  "réplica exacta de `route.ts`, igual que el TS", pero el `route.ts`
  real nunca restringió `GET` (cualquier autenticado puede consultar
  el calendario) — solo `POST`/`DELETE` son admin-only. Se corrigió
  en el backend (`apps/configuration/views.py`) y se actualizó
  `test_holidays_view.py` en el mismo cambio — único cambio de
  backend de esta fase, verificado con `ruff check` limpio y
  `pytest apps/configuration/` 228/228 en verde.
- Traducción de body/query camelCase→snake_case a mano en las rutas
  con campos no triviales (`leave-records`/`special-status`:
  `startDate`→`start_date`, etc.; `workload-config`:
  `hoursPerDay`→`hours_per_day`, etc.; `kpi-start-date`:
  `kpiStartDate`→`kpi_start_date`) — mismo criterio que `meetings`
  (Fase 42). Mensajes de error preservados vía
  `extractDjangoFlatErrorMessage` donde el contenido real varía
  (validaciones de rango/orden), hardcodeados donde es genérico
  (401/403/404), mismo criterio que el resto de esta migración.
- **Cobertura de tests:** `special-status` nunca había tenido ningún
  test (gap preexistente) — nuevo `special-status.test.ts`;
  `GET /api/settings/leave-records` tampoco (agregado al reescribir
  `leave-records.test.ts`). `settings-holidays.test.ts`,
  `settings-kpi-start-date.test.ts` y el bloque `workload-config` de
  `settings.test.ts` reescritos por completo (mocks de Prisma
  huérfanos removidos). `npx tsc --noEmit` limpio, `npm run lint` sin
  hallazgos nuevos, suite completa de Vitest 97 archivos / 1229 tests
  en verde.

**Archivos:** `src/app/api/settings/{holidays,leave-records,special-status}/**/route.ts`,
`src/app/api/settings/{workload-config,kpi-start-date}/route.ts`,
`backend/apps/configuration/views.py`, `backend/apps/configuration/tests/test_holidays_view.py`,
`src/__tests__/api/{settings-holidays,leave-records,special-status,settings-kpi-start-date,settings}.test.ts`

**Impacto:** cierra staleness activa en 5 configuraciones de Ajustes
y un bug activo (permisos/estados especiales no se podían crear para
ningún usuario desde la Fase 2). Corrige además un bug de permisos en
el backend (`GET /settings/holidays/`). Ningún modelo ni migración
nueva.

**Autor:** Claude Code

---

## v1.110.0 — 2026-08-24

**Tipo:** FIX
**Módulo:** Migración de stack — Fase 51: cutover de `GET /api/dashboard` + `settings/welcome-message`

Quincuagésimo primera sub-fase — continúa "Cutovers pendientes".
Cierra la staleness de Tareas/Comentarios/Actividades/Proyectos en el
bundle del Dashboard, documentada como fuera de alcance desde la Fase
44 (que ya había corregido Comunicados/Reuniones en el mismo bundle).

- **`GET /api/dashboard`** redirigido a Django
  (`build_dashboard_payload`, backend completo desde la Fase 25) — ya
  era una réplica campo por campo con las mismas claves camelCase que
  el contrato TS, así que el `route.ts` queda como reenvío directo,
  solo convirtiendo a `string` los 4 arrays con `id` numérico
  (`priorityTasks`/`announcements`/`upcomingMeetings`/`myProjects`).
- **Hallazgo — bug activo cerrado:** el enlace de `myProjects`
  (`href="/projects/${p.id}"`) usaba el `cuid` de Postgres,
  desactualizado desde que Proyectos se cortó a Django en la Fase 39
  — cualquier proyecto creado después de ese cutover daba 404 al
  hacer clic desde el Dashboard. El cutover lo corrige.
- **`GET/PUT /api/settings/welcome-message` se cortó en el MISMO
  cambio** (no solo Dashboard): el payload de Django ya incluía este
  mensaje, así que dejar la escritura en Prisma habría introducido
  una divergencia nueva — Ajustes escribiendo en Postgres, Dashboard
  leyendo de SQL Server — mismo criterio que la Fase 38 ("cortar
  ambos lados juntos para no introducir staleness nueva").
- **Hallazgo documentado, NO corregido en esta fase (divergencia
  preexistente, no introducida acá):** `workload-config`/`holidays`/
  `leave-records`/`special-status`/`kpi-start-date` alimentan
  `compute_carga_tiempo` (Django), ya consumida por el bundle de
  Analytics desde la Fase 4m (2026-08-12) — meses antes de esta
  sesión. Esos 5 endpoints de `settings/*` ya estaban divergentes
  desde entonces; el cutover de Dashboard solo agrega un consumidor
  más al mismo problema preexistente. Candidato a una fase dedicada
  futura.
- `PATCH /api/dashboard/card-order` NO se corta — comparte
  `User.viewPreferences` con `favorites` (sin cutover), mismo riesgo
  de divergencia ya documentado desde la Fase 36.
- Tests: `dashboard.test.ts` — el bloque `GET` reescrito para mockear
  `djangoApiFetch` (Prisma mocks huérfanos removidos, salvo
  `user.findUnique`/`user.update` que sigue usando `card-order`); el
  bloque `describe("GET/PUT /api/settings/welcome-message")` en
  `settings.test.ts` reescrito igual (mocks de `getEffectiveWelcomeMessage`/
  `getEffectiveWelcomeMessageActive`, ya huérfanos, removidos).
  `npx tsc --noEmit` limpio, `npm run lint` sin hallazgos nuevos,
  suite completa de Vitest 96 archivos / 1216 tests en verde. Sin
  cambios de backend — `apps.dashboard`/`apps.configuration` ya
  estaban completos desde las Fases 25/28, no requirió corrida de
  pytest.

**Archivos:** `src/app/api/dashboard/route.ts`, `src/app/api/settings/welcome-message/route.ts`,
`src/__tests__/api/dashboard.test.ts`, `src/__tests__/api/settings.test.ts`

**Impacto:** cierra staleness activa en el bundle completo del
Dashboard y en el mensaje de bienvenida. Ningún modelo ni migración
nueva.

**Autor:** Claude Code

---

## v1.109.0 — 2026-08-24

**Tipo:** FIX
**Módulo:** Migración de stack — Fase 50: cutover de `DELETE /api/desk-notes/[id]` (Papelera de Notas)

Quincuagésima sub-fase — continúa "Cutovers pendientes". Cierra el
último gap documentado desde la Fase 7g/14 del backend: `GET`/`PATCH
/api/desk-notes/[id]` ya eran Django desde la Fase 7g, pero `DELETE`
seguía en Prisma porque, en su momento, el Centro de Recuperación
(`RecoveryItem`, transversal a varios módulos) todavía no estaba
portado. Ese bloqueo se resolvió silenciosamente en la Fase 14 del
backend (`apps.recovery` + `DeskNoteViewSet.destroy`, réplica exacta
de las 2 vías de eliminación del TS) — solo faltaba conectar el
`route.ts`.

- **`DELETE /api/desk-notes/[id]`** redirigido a Django
  (`DeskNoteViewSet.destroy`, backend completo desde la Fase 14). Las
  2 vías de eliminación (remitente→envía a la papelera vía
  `apps.recovery.move_to_trash`; destinatario→borrado definitivo de
  una nota ya archivada) y los mensajes de error exactos
  (`RecoveryError`, contrato plano `{"error": "..."}`) se preservan
  vía `extractDjangoFlatErrorMessage`.
- **Hallazgo que simplificó el riesgo:** a diferencia de la Papelera
  de Proyectos (Fase 39, que sí tenía UI de listar/restaurar), la
  papelera de Notas nunca tuvo pantalla de restauración —
  `listActiveTrash("DESK_NOTE")` nunca tuvo ningún caller, ni en el TS
  legacy ni en Django — así que no había una interdependencia
  lista-vs-detalle que coordinar en esta fase.
- **Observación sin acción:** `src/lib/recoveryCenter.ts` queda sin
  ningún importador en Next.js tras este cutover (Proyectos ya estaba
  en Django desde la Fase 39) — no se eliminó, fuera de alcance.
  `purge_expired_archived_notes()` (backend, Fase 14) sigue sin
  activarse en ningún lado — gap preexistente, ya documentado desde la
  Fase 31.
- Tests: `desk-notes-id.test.ts` — el bloque `DELETE` reescrito para
  mockear `djangoApiFetch` en vez de Prisma/`recoveryCenter`; el mock
  de Prisma (huérfano tras el cambio, ya no usado por GET/PATCH) se
  eliminó del archivo. `npx tsc --noEmit` limpio, `npm run lint` sin
  hallazgos nuevos, suite completa de Vitest 96 archivos / 1217 tests
  en verde. Sin cambios de backend — `apps.recovery`/`apps.desk` ya
  estaban completos desde la Fase 14, no requirió corrida de pytest.

**Archivos:** `src/app/api/desk-notes/[id]/route.ts`, `src/__tests__/api/desk-notes-id.test.ts`

**Impacto:** cierra el último gap de cutover de Escritorio Digital —
el módulo queda 100% servido desde Django. Ningún modelo ni migración
nueva.

**Autor:** Claude Code

---

## v1.108.0 — 2026-08-24

**Tipo:** FIX
**Módulo:** Migración de stack — Fase 49: cutover de `settings/role-targets`, `settings/role-compatibility` y `settings/system-info`

Cuadragésima novena sub-fase — continúa "Cutovers pendientes". A
diferencia de las Fases 47/48 (desbloqueadas por el cutover de un
módulo completo), esta fase nace de auditar los 15 endpoints de
`settings/*` que seguían deferidos desde la Fase 36, para ver cuáles
quedaron desbloqueados AHORA que Analytics/KPIs (Fase 47) y
Predictive Intelligence (Fase 48) están 100% en Django. Resultado:
solo 3 de los 15 estaban realmente desbloqueados — los otros 12 (`holidays`,
`leave-records`, `special-status`, `workload-config`, `kpi-start-date`,
`analytics-config`, `normalization-curves`, `prediction-window`,
`welcome-message`, `nova-cache`, `favorites`, `retention-policy`)
siguen bloqueados por Dashboard/Nova Insights/Reportes Ejecutivos
(todavía 100% Prisma), no por Analytics/Predictive — quedan
documentados como bloqueados por ese motivo distinto en
`docs/ROADMAP.md`.

- **`GET/PATCH /api/settings/role-targets/`** y **`GET/PATCH
  /api/settings/role-compatibility/`** redirigidos a Django
  (`RoleTargetsView`/`RoleCompatibilityView`, Fase 28 del backend,
  completo). Su único consumidor real hoy es Analytics (`benchmarks`/
  `recommendations/team`, ya en Django desde las Fases 22/24/47) — el
  caller TS que les quedaba (`analytics.ts::runAnalyticsPipeline`/
  `computeTeamRecommendations`) es código muerto desde el cutover de
  Analytics (verificado: cero callers reales, solo sus propios tests).
  Validación client-side (rango 0-100, Regla 4 de niveles jerárquicos)
  conservada como defensa en profundidad — Django re-valida vía
  `Serializer`.
- **`GET /api/settings/system-info/`** redirigido a Django
  (`SystemInfoView`, Fase 32 del backend, completo) — cerraba
  staleness activa: contaba Usuarios/Tareas/Reuniones/Ideas
  directamente en Postgres, los 4 modelos ya 100% Django desde sus
  respectivos cutovers. `version`/`commitSha` ahora reflejan el
  backend Django (`APP_VERSION`/`GIT_COMMIT_SHA`), no `package.json`
  de Next.js — 2 apps distintas en esta migración, cada una con su
  propio versionado.
- **Cobertura de tests:** `role-targets`/`system-info` nunca habían
  tenido ningún test (gap preexistente) — nuevos `role-targets.test.ts`/
  `system-info.test.ts`; `role-compatibility.test.ts` reescrito
  (mockeaba Prisma). El bloque `system-info` duplicado dentro de
  `settings.test.ts` (junto al Prisma mock que solo él usaba) se
  eliminó al migrar su cobertura al archivo dedicado.
- `npx tsc --noEmit` limpio, `npm run lint` sin hallazgos nuevos,
  suite completa de Vitest 96 archivos / 1213 tests en verde. Sin
  cambios de backend — `apps.configuration` ya tenía las 3 vistas
  completas desde las Fases 28/32, no requirió corrida de pytest.

**Archivos:** `src/app/api/settings/role-targets/route.ts`,
`src/app/api/settings/role-compatibility/route.ts`,
`src/app/api/settings/system-info/route.ts`,
`src/__tests__/api/role-targets.test.ts`, `src/__tests__/api/role-compatibility.test.ts`,
`src/__tests__/api/system-info.test.ts`, `src/__tests__/api/settings.test.ts`

**Impacto:** cierra staleness activa en `system-info`; `role-targets`/
`role-compatibility` pasan a tener efecto real de nuevo (su único
consumidor vivo es Django). Ningún modelo ni migración nueva.

**Autor:** Claude Code

---

## v1.107.0 — 2026-08-24

**Tipo:** FIX
**Módulo:** Migración de stack — Fase 48: cutover de Inteligencia Preventiva (`src/app/api/predictive/**`, `src/lib/djangoPredictiveAdapter.ts`)

Cuadragésima octava sub-fase — continúa "Cutovers pendientes". Cierra
staleness activa en las 9 rutas de Inteligencia Preventiva, que
seguían calculando en Next.js/Prisma (`predictionEngine.ts`/
`trendEngine.ts`/`preventiveIntelligence.ts`/`capacityForecast.ts`)
sobre Tareas/Proyectos leídos de Postgres, pese a que ambos son 100%
Django desde la Fase 3/39.

- **6 rutas GET redirigidas a Django:** `predictions/[userId]`,
  `trend/[userId]` (reenvía `weeksBack` como `weeks_back`),
  `alerts/[userId]`, `team-alerts`, `team-subutilization`,
  `project-delay/[projectId]`. **3 rutas POST (simuladores, nunca
  persisten nada):** `simulate/[userId]` (traduce `taskId`/
  `newTargetTimeHours` a `task_id`/`new_target_time_hours`),
  `simulate/project/[projectId]` (`additionalParticipants` →
  `additional_participants`), `simulate/redistribute`
  (`fromUserId`/`toUserId`/`hours` → `from_user_id`/`to_user_id`/
  `hours`). Mismo patrón que `analytics/[userId]/route.ts` (Fase 4m/47):
  `getSession()` solo para el 401, 404/403 propagados con mensaje
  genérico, mapeo genérico recursivo snake_case→camelCase (nuevo
  `djangoPredictiveAdapter.ts`, mismo criterio de duplicación ya
  documentado en `djangoAnalyticsAdapter.ts`).
- **Puente de ids (Fase 40) requerido:**
  `inteligencia-preventiva/page.tsx` pasaba `session.userId` (`cuid`
  de Postgres) como `currentUserId` — todas las rutas por-usuario ya
  esperan el id numérico de Django. Se cambió a
  `resolveDjangoUserId(session)`, mismo patrón que Notificaciones/
  Reuniones/Ideas/Equipo. `project-delay`/`simulate/project` no
  necesitaron el mismo puente — `projectId` ya llega numérico desde
  `GET /api/projects`, cutover desde la Fase 39.
- Backend (`backend/apps/analytics/{prediction_engine,trend_engine,
  preventive_intelligence,simulate_engine}.py` + las 9 vistas) ya
  estaba 100% completo desde la Fase 9 — verificado, sin cambios.
- **Observación sin acción:** `ScenarioSimulatorPanel.tsx` filtra el
  selector de "redistribuir hacia" con `m.id !== userId`, pero
  `team-subutilization` siempre devolvió el campo como `userId` (nunca
  `id`) — bug preexistente, anterior a esta migración y no introducido
  por ella; fuera de alcance de un cutover de `route.ts` (no cambia
  contrato ni comportamiento del backend).
- **Cobertura de tests:** `predictions/[userId]` y `team-alerts` no
  tenían ningún test previo (gap preexistente) — se agregó cobertura
  para ambas al reescribir `predictive-auth.test.ts`;
  `predictive-simulate.test.ts` reescrito por completo. `npx tsc
  --noEmit` limpio, `npm run lint` sin hallazgos nuevos, suite completa
  de Vitest 94 archivos / 1202 tests en verde. Sin cambios de backend
  — no requirió corrida de pytest.

**Archivos:** `src/app/api/predictive/{predictions,trend,alerts,simulate}/[userId]/route.ts`,
`src/app/api/predictive/{team-alerts,team-subutilization}/route.ts`,
`src/app/api/predictive/project-delay/[projectId]/route.ts`,
`src/app/api/predictive/simulate/project/[projectId]/route.ts`,
`src/app/api/predictive/simulate/redistribute/route.ts`,
`src/lib/djangoPredictiveAdapter.ts`,
`src/app/(protected)/inteligencia-preventiva/page.tsx`,
`src/__tests__/api/predictive-auth.test.ts`, `src/__tests__/api/predictive-simulate.test.ts`

**Impacto:** cierra staleness activa en todo el módulo Inteligencia
Preventiva. Ningún modelo ni migración nueva — el backend ya estaba
completo.

**Autor:** Claude Code

---

## v1.106.0 — 2026-08-24

**Tipo:** FIX
**Módulo:** Migración de stack — Fase 47: cutover de Analytics + KPIs, rutas granulares (`src/app/api/analytics/**`, `src/app/api/kpis/{team,team-capacity,executive}/route.ts`)

Cuadragésima séptima sub-fase — continúa "Cutovers pendientes". Cierra
staleness activa en 13 rutas que seguían componiendo el motor central
(`src/lib/analytics.ts`) sobre datos de Prisma/Postgres, pese a que
Tareas (su único insumo real) es 100% Django desde la Fase 3 — cada
una de estas rutas venía calculando Insights/Equilibrio/Riesgo
Operativo/etc. sobre datos de tareas cada vez más desactualizados.

- **10 rutas nuevas bajo `analytics/`:** `GET insights/[userId]`,
  `equilibrio/[userId]`, `benchmarks/[userId]`, `operational-risk/[userId]`,
  `operational-risk/team`, `recommendations/team`, `history/[userId]`
  (reenvía `kind`/`months`), `target-time/[userId]`, `data-quality`
  (reenvía `scope`, default `"self"`); **`POST simulate/[userId]`**
  (reenvía el body tal cual, sin re-validar — `is_valid_scenario` ya
  vive en Django). **3 rutas nuevas bajo `kpis/`:** `team` (reenvía
  `month`), `team-capacity`, `executive`. Las 13 son reenvíos directos
  siguiendo el mismo template exacto que las 2 rutas ya cortadas en la
  Fase 4m (`analytics/[userId]`, `kpis/[userId]`): `getSession()` solo
  para el 401, 404/403 propagados sin extraer mensaje (mensajes
  genéricos hardcodeados), `mapDjangoAnalyticsPayloadToNexoShape`/
  `mapDjangoKpiPayloadToNexoShape` (mapeo genérico recursivo
  snake_case→camelCase, ya establecidos en la Fase 4b/4m) para el
  payload.
- Backend (`backend/apps/analytics/**`) ya estaba 100% completo desde
  las Fases 16-24 — verificado campo por campo en esas fases, sin
  cambios necesarios en esta.
- Excluidas del alcance por no tener backend: `kpis/nova-insights`,
  `analytics/diagnostics` (confirmado leyendo `api_v1_urls.py`).
- **Cobertura de tests:** ninguna de las 10 rutas `analytics/*`
  granulares tenía test previo (gap preexistente, igual que Proyectos
  antes de la Fase 39) — nuevo `analytics-granular.test.ts` (routing/
  mapeo únicamente, la lógica de negocio ya la cubre la suite de
  Django). `kpis-executive.test.ts` reescrito por completo;
  `kpis-team-range.test.ts` reescrito solo en su mitad `GET
  /api/kpis/team` (la mitad `GET /api/kpis/me/range`, cortada en la
  Fase 4c, queda sin tocar).
- `npx tsc --noEmit` limpio, `npm run lint` sin hallazgos nuevos,
  suite completa de Vitest 94 archivos / 1192 tests en verde. Sin
  cambios de backend — no requiere corrida de pytest.

**Archivos:** `src/app/api/analytics/{insights,equilibrio,benchmarks,simulate,operational-risk,target-time}/[userId]/route.ts`,
`src/app/api/analytics/{operational-risk/team,recommendations/team,history/[userId],data-quality}/route.ts`,
`src/app/api/kpis/{team,team-capacity,executive}/route.ts`,
`src/__tests__/api/analytics-granular.test.ts`,
`src/__tests__/api/kpis-executive.test.ts`, `src/__tests__/api/kpis-team-range.test.ts`

**Impacto:** cierra staleness activa en todo el módulo Analytics/KPIs
granular. Ningún modelo ni migración nueva — el backend ya estaba
completo.

**Autor:** Claude Code

---

## v1.105.0 — 2026-08-24

**Tipo:** FIX
**Módulo:** Migración de stack — Fase 46: cutover de Equipo (`src/app/api/team/**`, `src/lib/djangoTeamAdapter.ts`)

Cuadragésima sexta sub-fase — continúa "Cutovers pendientes".

- **`GET /api/team/`** + **`GET /api/team/[userId]/tasks/`** redirigidos
  a Django (`TeamListView`/`TeamMemberTasksView`, Fase 18 del backend,
  completo). Cierra staleness: ambos leían Postgres — el conteo de
  tareas por estado de `GET /api/team` y el listado completo de
  `GET /api/team/[userId]/tasks` quedaban desactualizados desde el
  cutover de Tareas.
- **Interdependencia identificada y resuelta cortando ambos juntos:**
  `TeamModule.tsx` obtiene `memberId` de la respuesta de `/api/team` y
  lo usa tal cual para pedir `/api/team/${memberId}/tasks` — cortar
  solo uno de los dos habría dejado esa llamada encadenada rota (id
  numérico contra un endpoint que espera `cuid`, o viceversa). Mismo
  patrón de interdependencia ya resuelto en la Fase 42
  (`users/assignable`+Reuniones).
- `team/[userId]/tasks` es un caso especial heredado desde la Fase 3a:
  nunca se migró en el cutover de Tareas porque Django solo exponía
  las tareas del propio usuario autenticado, no las de un tercero —
  `TeamMemberTasksView` (backend, Fase 18) es la réplica Django de ese
  mismo caso especial (ya la tenía resuelta, solo faltaba el cutover
  del `route.ts`).
- Nuevo `djangoTeamAdapter.ts` (mapeo snake_case→camelCase, incluido
  `in_progress`→`inProgress` en el conteo de tareas). El enmascarado
  de email (`GET /api/team`, vía `mask_email` del backend) y la
  distinción de 2 mensajes de error 403 distintos en
  `team/[userId]/tasks` (permiso general vs. objetivo fuera de la
  jerarquía) se preservaron con `extractDjangoFlatErrorMessage`.
- Tests: `team.test.ts` reescrito por completo (mockea
  `djangoApiFetch`). `npx tsc --noEmit` limpio, `npm run lint` sin
  hallazgos nuevos, suite completa de Vitest 1155/1155 en verde. Sin
  cambios de backend.

**Archivos:** `src/app/api/team/route.ts`,
`src/app/api/team/[userId]/tasks/route.ts`,
`src/lib/djangoTeamAdapter.ts`, `src/__tests__/api/team.test.ts`

**Impacto:** cierra staleness activa en el módulo Equipo. Ningún
modelo ni migración nueva — el backend ya estaba completo.

**Autor:** Claude Code

---

## v1.104.0 — 2026-08-24

**Tipo:** FIX
**Módulo:** Migración de stack — Fase 45: cutover de Solicitudes LOPD (`src/app/api/data-requests/**`, `src/lib/djangoDataRequestsAdapter.ts`)

Cuadragésima quinta sub-fase — continúa "Cutovers pendientes" más
allá de la lista original de la Fase 40. Sin interdependencia con
otro módulo (autor siempre "yo mismo", resolución por rol, no por id)
— cutover autocontenido.

- **`GET/POST /api/data-requests/`** + **`PATCH /api/data-requests/[id]/`**
  + **`GET /api/data-requests/my-data/`** redirigidos a Django
  (`DataRequestListCreateView`/`DataRequestDetailView`/`MyDataExportView`,
  Fase 12 del backend, completo).
- **Hallazgo — `my-data` (exportación LOPD/GDPR) es el cutover de
  mayor severidad real de toda la sesión hasta ahora:** a diferencia
  de un widget de UI, este endpoint es una obligación de compliance
  ("acceso a mis datos"). Agregaba Tareas/Actividades/Comentarios/
  Reuniones/Ideas/Votos — TODOS ya escritos exclusivamente en Django
  desde sus respectivos cutovers — así que la versión Prisma exportaba
  un archivo cada vez más incompleto para una solicitud legal real, no
  solo una vista desactualizada.
- **Gap heredado del backend, preservado y documentado (no
  fabricado):** `apps.data_requests.services.export_my_data` ya
  documentaba que el objeto `usuario` de la exportación no incluye
  `theme`/`viewPreferences`/`badges`/`dataConsentAccepted`/
  `dataConsentAcceptedAt` — campos sin equivalente todavía en el
  `User` de Django (gaps ya aceptados en fases previas: Fase 6b, Fase
  11). El adaptador de Next.js replica el mismo criterio: omite esos
  5 campos en vez de inventar valores. Se evaluó el trade-off
  explícitamente: preferible exportar datos operativos completos y
  actuales (el grueso legal de una solicitud de acceso) sin 5 campos
  cosméticos/de gamificación, que exportar esos 5 campos junto a
  Tareas/Reuniones/Ideas cada vez más viejas.
- Nuevo `djangoDataRequestsAdapter.ts` — incluye el mapeo completo
  (recursivo, snake_case→camelCase) del payload de exportación:
  usuario, tareas, actividades, comentarios, reuniones organizadas/
  invitado, ideas propuestas, votos y solicitudes previas.
- Tests: `data-requests-announcements.test.ts` reescrito por completo
  (la porción de Comunicados, ya cutover en la Fase 44, queda igual;
  se agrega la de Solicitudes LOPD) — ningún mock de Prisma queda en
  el archivo. `npx tsc --noEmit` limpio, `npm run lint` sin hallazgos
  nuevos, suite completa de Vitest 1155/1155 en verde. Sin cambios de
  backend.

**Archivos:** `src/app/api/data-requests/route.ts`,
`src/app/api/data-requests/[id]/route.ts`,
`src/app/api/data-requests/my-data/route.ts`,
`src/lib/djangoDataRequestsAdapter.ts`,
`src/__tests__/api/data-requests-announcements.test.ts`

**Impacto:** cierra un riesgo real de compliance (exportación LOPD
con datos operativos incompletos/desactualizados). Ningún modelo ni
migración nueva — el backend ya estaba completo.

**Autor:** Claude Code

---

## v1.103.0 — 2026-08-21

**Tipo:** FIX
**Módulo:** Migración de stack — Fase 44: cutover de Comunicados + corrige staleness de Comunicados/Reuniones en `GET /api/dashboard` (`src/app/api/announcements/**`, `src/app/api/dashboard/route.ts`, `backend/apps/announcements/views.py`)

Cuadragésima cuarta sub-fase — quinto y último cutover apoyado en el
puente de ids de la Fase 40, cerrando la lista completa de candidatos
identificada en esa fase (Notificaciones, `users/assignable`+Reuniones,
Ideas, y ahora Comunicados).

- **`GET/POST /api/announcements/`** + **`DELETE /api/announcements/[id]/`**
  redirigidos a Django (`AnnouncementListView`/`AnnouncementDetailView`,
  Fase 25 del backend). La visibilidad de a quién notificar (todos los
  visibles, excluyendo al autor) ya vive en
  `apps.announcements.services.create_announcement`.
- **Hallazgo al investigar el único consumidor real (`DashboardModule.tsx`):**
  el widget de Comunicados NUNCA llama a `GET /api/announcements`
  directamente — lee el listado desde el bundle agregado de `GET
  /api/dashboard` (todavía en Postgres) y solo usa `POST`/`DELETE
  /api/announcements` para las acciones, refrescando después vía
  `fetchData()` (que vuelve a pedir el bundle). Cortar solo el CRUD sin
  tocar el bundle habría hecho que publicar/eliminar un comunicado
  pareciera fallar silenciosamente (el bundle seguiría mostrando la
  versión vieja de Postgres).
- **Se corrigió también la sección de Reuniones del mismo bundle:**
  `GET /api/dashboard` también arma `upcomingMeetings` con
  `prisma.meeting.findMany` — stale desde el cutover de Reuniones (Fase
  42). Se reemplazaron ambas secciones (Comunicados y Reuniones) por
  llamadas a Django dentro del mismo `Promise.all`, con el filtro de
  "solo futuras, primeras 5" para reuniones movido al `route.ts` (la
  vista de Django lista todas, sin ese recorte). El resto del bundle
  (Tareas/Comentarios/Actividades/Proyectos, también con staleness
  conocida por depender de Tareas/Proyectos ya cutover) queda
  explícitamente FUERA de alcance — depende de Analytics/Workload,
  todavía sin cutover, y es un problema mucho más grande que amerita su
  propia fase dedicada.
- **`AnnouncementListView._serialize` (backend) ganó el campo
  `author: {name, role}`** — el serializer original solo tenía
  `authorId` (id numérico suelto), pero el único
  consumidor real (`GET /api/dashboard`) necesita el NOMBRE del autor
  para mostrarlo (`authorName`). Aditivo, con `prefetch_related` nuevo
  para evitar un N+1 sobre `Group` al resolver el rol de cada fila.
- Tests: `data-requests-announcements.test.ts` (sección de anuncios
  reescrita), `dashboard.test.ts` (Prisma→Django para
  comunicados/reuniones, 2 tests nuevos verificando el mapeo/filtro),
  nuevo test de Django para el campo `author`. `ruff check` limpio,
  suite de Django 1624/1624 en verde, `npx tsc --noEmit` limpio, suite
  de Vitest 1159/1159 en verde.

**Archivos:** `src/app/api/announcements/route.ts`,
`src/app/api/announcements/[id]/route.ts`,
`src/app/api/dashboard/route.ts`,
`backend/apps/announcements/views.py`,
`backend/apps/announcements/services.py`,
`backend/apps/announcements/tests/test_announcement_views.py`,
`src/__tests__/api/data-requests-announcements.test.ts`,
`src/__tests__/api/dashboard.test.ts`

**Impacto:** cierra el último candidato del puente de ids (Fase 40) +
corrige 2 secciones de staleness en `GET /api/dashboard`
(Comunicados/Reuniones). 1 campo nuevo en un serializer de Django, sin
migración. El resto del bundle de Dashboard (Tareas/Comentarios/
Actividades/Proyectos) queda con staleness conocida, documentada,
fuera de alcance — depende del cutover de Analytics/Workload.

**Autor:** Claude Code

---

## v1.102.0 — 2026-08-21

**Tipo:** FIX
**Módulo:** Migración de stack — Fase 43: cutover de Mejora Continua / Ideas (`src/app/api/ideas/**`, `src/app/(protected)/mejora-continua/page.tsx`, `src/lib/djangoIdeasAdapter.ts`)

Cuadragésima tercera sub-fase — cuarto cutover apoyado en el puente de
ids de la Fase 40. A diferencia de `users/assignable`/Reuniones, Ideas
no tiene ningún selector manual de usuarios (autor siempre "yo
mismo", revisores computados por rol) — sin interdependencia con otro
módulo, cutover autocontenido.

- **`GET/POST /api/ideas/`** + **`GET/PATCH /api/ideas/[id]/`** +
  **`POST /api/ideas/[id]/vote/`** + **`PATCH /api/ideas/[id]/status/`** +
  **`GET /api/ideas/[id]/history/`** redirigidos a Django
  (`IdeaListCreateView`/`IdeaDetailView`/`IdeaVoteView`/`IdeaStatusView`/
  `IdeaHistoryView`, Fase 11 del backend, completo). Visibilidad por
  jerarquía, máquina de estados, notificación al autor (ya visible en
  la campana desde la Fase 41) y el badge "innovador" (asignado al
  llegar a IMPLEMENTADA, cerrado en la Fase 27) ya viven en
  `apps.ideas.services` — los `route.ts` quedan como reenvío/mapeo.
- **`src/app/(protected)/mejora-continua/page.tsx`** — hacía su propia
  consulta a Prisma en el Server Component (no vía `/api/ideas`), mismo
  patrón que `tasks/page.tsx` (Fase 3a) — se cortó también, y
  `currentUserId` pasa a `session.djangoUserId` (Fase 40): `IdeaCard`/
  `IdeasModule` comparan `idea.author.id` (ahora numérico) contra ese
  prop para decidir "¿es mía?" — mismo caso que `NotificationBell` en
  la Fase 41.
- El adjunto (imagen/PDF/doc) sigue codificándose como data: URL en el
  `route.ts`, mismo contrato ya establecido para `desk-notes` (Fase 7d)
  — Django valida extensión/tamaño server-side. `saveAttachment`/
  `AttachmentError` (`src/lib/storage.ts`) quedan sin ningún caller
  tras este cambio (su otro consumidor, Escritorio Digital, ya no los
  usa desde su propio cutover) — no se eliminó el archivo, fuera de
  alcance de esta fase.
- Nuevo `djangoIdeasAdapter.ts` (mapeo snake_case→camelCase, ids→string,
  `impact`/`status` casteados a los union types de
  `src/components/ideas/types.ts`).
- Tests: `ideas-routes.test.ts` reescrito por completo, `ideas-status.test.ts`
  reducido de la máquina de estados completa (ahora en Django, ya
  cubierta ahí) a ruteo/mapeo. `npx tsc --noEmit` limpio, `npm run
  lint` sin hallazgos nuevos, suite completa de Vitest 1160/1160 en
  verde. Sin cambios de backend.

**Archivos:** `src/app/api/ideas/route.ts`,
`src/app/api/ideas/[id]/route.ts`, `src/app/api/ideas/[id]/vote/route.ts`,
`src/app/api/ideas/[id]/status/route.ts`,
`src/app/api/ideas/[id]/history/route.ts`,
`src/app/(protected)/mejora-continua/page.tsx`,
`src/lib/djangoIdeasAdapter.ts`, `src/__tests__/api/ideas-routes.test.ts`,
`src/__tests__/api/ideas-status.test.ts`

**Impacto:** entrega Mejora Continua completo en Django. Ningún modelo
ni migración nueva. Queda **Comunicados (Announcements)** como último
candidato del puente de ids de la Fase 40.

**Autor:** Claude Code

---

## v1.101.0 — 2026-08-21

**Tipo:** FIX
**Módulo:** Migración de stack — Fase 42: cutover de `users/assignable` + Reuniones (`src/app/api/users/assignable/route.ts`, `src/app/api/meetings/**`, `src/lib/djangoMeetingsAdapter.ts`)

Cuadragésima segunda sub-fase — el bloqueo original de la Fase 37
(`users/assignable` frenado por el problema de ids) se cierra
combinándolo con el cutover de Reuniones, porque son interdependientes:
el selector de invitados de Reuniones consume `users/assignable`, así
que cortar uno sin el otro habría roto el flujo de invitación.

- **`GET /api/users/assignable/`** — investigando sus 4 consumidores
  reales se encontraron **3 bugs activos preexistentes**, todos por
  el mismo motivo (la lista devolvía el `cuid` de Postgres, pero el
  destino final ya esperaba el id numérico de Django): `RegularizeTargetTimeManager`
  filtra Tareas por `userId` contra un endpoint ya cutover;
  `DashboardModule` pasa la lista a `TaskFormModal`, que crea Tareas
  vía `POST /api/tasks` (`Number(assignedToId)`, ya cutover); y el
  selector de invitados de Reuniones (ver abajo). Los 3 quedaban
  silenciosamente rotos (filtros vacíos, ids `NaN`) — ninguno tiraba
  error visible.
- **`GET/POST /api/meetings/`** + **`GET/PATCH/DELETE /api/meetings/[id]/`**
  redirigidos a `MeetingListCreateView`/`MeetingDetailView` (Django,
  Fase 10 del backend, completo: integración real de Zoom con
  fallback simulado + notificación a invitados ya en
  `apps.meetings.services.create_meeting`, consumido por
  Notificaciones desde su propio cutover en la Fase 41). Nuevo
  `djangoMeetingsAdapter.ts` (mapeo snake_case→camelCase, ids→string,
  mismo patrón que `djangoProjectsAdapter.ts`).
- `inviteeIds` que manda el formulario ya llega en id numérico de
  Django (mismo cutover del selector) — Django filtra al propio
  anfitrión internamente, no hace falta replicarlo en el `route.ts`.
- Tests: `meetings.test.ts` reescrito por completo (21 tests, mockea
  `djangoApiFetch`), sección de `assignable` en `users-id.test.ts`
  reescrita. `npx tsc --noEmit` limpio, `npm run lint` sin hallazgos
  nuevos, suite completa de Vitest 1193/1193 en verde. Sin cambios de
  backend — ambas superficies ya estaban completas.

**Archivos:** `src/app/api/users/assignable/route.ts`,
`src/app/api/meetings/route.ts`, `src/app/api/meetings/[id]/route.ts`,
`src/lib/djangoMeetingsAdapter.ts`,
`src/__tests__/api/meetings.test.ts`, `src/__tests__/api/users-id.test.ts`

**Impacto:** cierra 3 bugs activos preexistentes (filtro de tareas por
colaborador, creación de tarea rápida desde Dashboard, y ahora también
invitación a reuniones — los 3 recibían un id de usuario del tipo
equivocado) + entrega Reuniones completo en Django. Ningún modelo ni
migración nueva.

**Autor:** Claude Code

---

## v1.100.0 — 2026-08-21

**Tipo:** FIX
**Módulo:** Migración de stack — Fase 41: cutover de Notificaciones (`src/app/api/notifications/route.ts`, `[id]/route.ts`, `src/app/(protected)/layout.tsx`, `AppShell.tsx`, `Topbar.tsx`)

Cuadragésima primera sub-fase — primer cutover que se apoya en el
puente de la Fase 40. `Notification` (`notify()`/`notify_many()`) ya
la escriben internamente varios de los módulos de Django ya cutover
(Tareas — comentarios/validaciones, Proyectos, Escritorio Digital,
Reuniones, Ideas, LOPD) desde que cada uno se portó — pero la campana
de notificaciones (`/api/notifications`) seguía leyendo Postgres, así
que nunca las mostraba. Bug de staleness activo, mismo patrón que
otras fases de este cutover.

- **`GET/PATCH /api/notifications/`** + **`PATCH /api/notifications/[id]/`**
  redirigidos a `NotificationListView`/`NotificationDetailView`
  (Django, Fase 15 del backend, réplica exacta — incluido el
  comportamiento silencioso de `PATCH .../[id]/`: id inexistente o de
  otro usuario no rompe nada, responde `{ok: true}` igual).
- **`taskAssignedToId` pasa a ser el id NUMÉRICO de Django** (Tareas ya
  cutover) — `NotificationBell.tsx` lo compara contra `currentUserId`
  para decidir la navegación ("¿es mi tarea?"); ese prop ahora recibe
  `session.djangoUserId` (Fase 40, resuelto vía `resolveDjangoUserId`
  en `(protected)/layout.tsx`) en vez del `cuid` de Postgres —
  **sin este cambio, esa comparación habría dejado de funcionar
  silenciosamente** (nunca "es mía", todo hubiera navegado a
  `/team?...`). `ThemeToggle`, en el mismo `Topbar`, sigue recibiendo
  el `cuid` sin cambios (su propio `route.ts` ya resuelve el id de
  Django internamente desde la Fase 38).
- **Gap preexistente NO cerrado por esta fase, documentado para no
  sobre-prometer:** `TaskService.create_task` (Django) todavía no
  llama a `notify()` al asignar una tarea — gap heredado de la Fase
  3a, antes de que `Notification` existiera. Esta fase cierra la
  staleness de LECTURA (la campana ahora ve lo que Django YA escribe);
  no agrega la notificación de asignación en sí, que es un cambio
  distinto en `apps.tasks`, no en `apps.notifications`.
- Tests: `notifications.test.ts` reescrito (mockea `djangoApiFetch`
  en vez de Prisma). `npx tsc --noEmit` limpio, `npm run lint` sin
  hallazgos nuevos, suite completa de Vitest 1193/1193 en verde. Sin
  cambios de backend.

**Archivos:** `src/app/api/notifications/route.ts`,
`src/app/api/notifications/[id]/route.ts`,
`src/app/(protected)/layout.tsx`, `src/components/shell/AppShell.tsx`,
`src/components/shell/Topbar.tsx`, `src/__tests__/api/notifications.test.ts`

**Impacto:** cierra un bug activo de staleness — la campana de
notificaciones ahora muestra las notificaciones que Tareas/Proyectos/
Escritorio Digital/Reuniones/Ideas/LOPD ya generan en Django desde
sus respectivos cutovers. Ningún modelo ni migración nueva.

**Autor:** Claude Code

---

## v1.99.0 — 2026-08-21

**Tipo:** FEATURE
**Módulo:** Migración de stack — Fase 40: reconciliación de ids Postgres↔Django (`src/lib/session.ts`, `src/lib/djangoSession.ts`, `src/app/api/auth/login/route.ts`, `src/app/api/auth/me/route.ts`)

Cuadragésima sub-fase — arranca la reconciliación de ids pedida
explícitamente por el usuario (ver `docs/ROADMAP.md` punto 14: "migrar
el espacio de IDs de los 19 módulos restantes" era el último
prerequisito, sin planificar en detalle, antes de poder retirar
Postgres). Esta fase construye el PUENTE — no corta ningún módulo
nuevo todavía, eso son fases futuras que se apoyan en esto.

- **`SessionPayload.djangoUserId?: number`** (nuevo campo, `session.ts`)
  — `userId` sigue siendo el `cuid` de Postgres (Fase 6a, sin tocar:
  lo siguen necesitando los módulos todavía no cutover contra Prisma).
  `djangoUserId` es el id NUMÉRICO de Django del mismo usuario, para
  cuando un `route.ts` cutover necesita construir `/users/<id>/...` o
  mandar un `authorId`/`hostId` numérico a Django.
- Se popula en los 2 lugares que ya emiten/renuevan la cookie de
  sesión: **`auth/login/route.ts`** (login real, ya traía `me.id` de
  `/auth/me/` sin usarlo) y **`auth/me/route.ts`** (`PATCH`, renueva
  la sesión al editar nombre/email).
- **`resolveDjangoUserId(session)`** (nuevo, `djangoSession.ts`) — usa
  `session.djangoUserId` si está; si no (sesión emitida ANTES de esta
  fase, todavía sin expirar), cae una única vez a `GET /auth/me/`.
  Consolida el workaround que `users/[id]/theme/route.ts` (Fase 38)
  hacía inline — se refactorizó ese endpoint para usar el helper.
- Tests: `auth.test.ts` actualizado (`createSession` ahora incluye
  `djangoUserId`), `users-id.test.ts` con 2 tests nuevos que cubren
  ambas ramas de `resolveDjangoUserId` (con y sin el campo en sesión).
  `npx tsc --noEmit` limpio, `npm run lint` sin hallazgos nuevos,
  suite completa de Vitest 1192/1192 en verde. Sin cambios de
  backend — `UserPublicSerializer.id` ya existía desde siempre.

**Archivos:** `src/lib/session.ts`, `src/lib/djangoSession.ts`,
`src/app/api/auth/login/route.ts`, `src/app/api/auth/me/route.ts`,
`src/app/api/users/[id]/theme/route.ts`,
`src/__tests__/api/auth.test.ts`, `src/__tests__/api/users-id.test.ts`

**Impacto:** ninguno sobre el comportamiento actual — infraestructura
pura. Desbloquea (no implementa todavía) el cutover de Reuniones,
Ideas, Comunicados, Notificaciones y `users/assignable`, todos
frenados hasta ahora por no tener forma de resolver el id de Django
del usuario en sesión sin un round-trip manual. Sesiones ya emitidas
antes de este cambio siguen funcionando (fallback a `/auth/me/`) hasta
que expiren y se renueven con el campo nuevo.

**Autor:** Claude Code

---

## v1.98.0 — 2026-08-21

**Tipo:** FIX
**Módulo:** Migración de stack — Fase 39: cutover de la Papelera de Proyectos (`src/app/api/projects/[id]/route.ts`, `trash/route.ts`, `[id]/restore/route.ts`, `[id]/permanent/route.ts`)

Trigésima novena sub-fase — cierra un gap ACTIVO Y EXPLÍCITAMENTE
DOCUMENTADO desde la Fase 5f (2026-08-14): al cortar `GET/PATCH
/api/projects/[id]` y `GET/POST /api/projects` a Django, el propio
comentario del código ya advertía que `DELETE /api/projects/[id]`
("mover a la papelera") seguiría en Prisma/Postgres, y que cualquier
proyecto creado DESPUÉS de ese cutover (que solo existe en SQL
Server) recibiría 404 "Proyecto no encontrado" al intentar enviarlo a
la papelera — bug real, en producción, desde esa fecha.

- **`DELETE /api/projects/[id]/`** (mover a la papelera),
  **`GET /api/projects/trash/`**, **`POST /api/projects/[id]/restore/`**,
  **`DELETE /api/projects/[id]/permanent/`** — los 4 se redirigen a
  `ProjectViewSet` (Django, Fase 14 del backend, ya completo y
  probado: `destroy`/`trash`/`restore`/`permanent`). El registro de
  `ProjectHistory` ("ELIMINADO"/"RESTAURADO") ya lo hace
  `ProjectService` internamente — el `route.ts` no lo duplica.
- Nuevo `DjangoProjectTrashItem`/`mapDjangoProjectTrashItemToNexoShape`
  en `djangoProjectsAdapter.ts` (mapeo snake_case→camelCase,
  ids→string, mismo criterio que el resto del adaptador).
- **Contrato de error mixto identificado y manejado:** `destroy` usa
  permisos/`get_object()` de DRF (403/404 vía el manejador global,
  contrato anidado — pero acá alcanza con mensajes estáticos, igual
  que ya hacían los `route.ts` de GET/PATCH); `restore`/`permanent`
  construyen sus `Response` de error a mano (contrato PLANO
  `{"error": "mensaje"}"`) — se usó `extractDjangoFlatErrorMessage`
  (Fase 36) para estos, NO `extractDjangoProjectErrorMessage` (que
  espera el contrato anidado y habría perdido el mensaje real).
- Tests: nuevo `projects-trash.test.ts` (18 tests) — primer archivo de
  test para CUALQUIER `route.ts` de Proyectos (el resto del módulo,
  cutover en sesiones previas, no tenía cobertura de este lado; se
  igualó al rigor del resto de esta sesión sin intentar rellenar ese
  gap preexistente más amplio). `npx tsc --noEmit` limpio, `npm run
  lint` sin hallazgos nuevos, suite completa de Vitest 1191/1191 en
  verde. Sin cambios de backend (ya estaba completo).

**Archivos:** `src/app/api/projects/[id]/route.ts`,
`src/app/api/projects/trash/route.ts`,
`src/app/api/projects/[id]/restore/route.ts`,
`src/app/api/projects/[id]/permanent/route.ts`,
`src/lib/djangoProjectsAdapter.ts`,
`src/__tests__/api/projects-trash.test.ts`

**Impacto:** cierra 1 bug activo, real y explícitamente documentado
desde 2026-08-14 (proyectos creados después del cutover de Proyectos
no podían enviarse a la papelera). Ningún modelo ni migración nueva
— el backend ya estaba 100% listo.

**Autor:** Claude Code

---

## v1.97.0 — 2026-08-21

**Tipo:** FIX
**Módulo:** Migración de stack — Fase 38: cutover de `PATCH /api/users/[id]/theme` + tema inicial de `layout.tsx` (`backend/apps/users/serializers.py`, `src/app/layout.tsx`, `src/app/api/users/[id]/theme/route.ts`)

Trigésima octava sub-fase — cierra el gap identificado en la Fase 37:
`users/[id]/theme` quedó deliberadamente sin cutover porque requería
resolver el `id` numérico de Django del usuario en sesión, ya que
`session.userId` (Next.js) sigue siendo el `cuid` de Postgres
(decisión de la Fase 6a) mientras `UserThemeView` (Django) exige
`pk == request.user.id` (numérico).

- **`UserPublicSerializer.theme`** (nuevo campo, `backend/apps/users/serializers.py`)
  — `GET /auth/me/` ahora expone también `id` (ya lo tenía, sin usar
  del lado Next.js) y `theme` del usuario autenticado. Aditivo, sin
  romper ningún consumidor existente (sin test que asuma una lista
  exacta de campos).
- **`PATCH /api/users/[id]/theme/`** — el `id` del path sigue siendo
  el `cuid` de sesión de Next.js (validado igual que antes, siempre
  "yo mismo"); internamente ahora resuelve el `id` numérico de Django
  vía `GET /auth/me/` antes de llamar a `PATCH /users/<id>/theme/`
  (Django).
- **`src/app/layout.tsx`** — el tema inicial (claro/oscuro) se lee
  ahora de Django (`/auth/me/`) en vez de `prisma.user.findUnique`.
  A diferencia de otras fases de este cutover, acá NO había un bug
  preexistente: hasta este cambio, lectura (`layout.tsx`) y escritura
  (`route.ts`) coincidían, ambas en Postgres. Se cortan las DOS en el
  mismo cambio precisamente para no introducir uno: cortar solo la
  escritura (como en fases anteriores donde el consumidor real ya
  estaba en Django) habría dejado el tema congelado, porque acá el
  "consumidor real" del valor escrito es este mismo `layout.tsx`.
- Tests: nuevo `test_me_endpoint_includes_theme` (backend, Django),
  reescrita la sección de `theme` en `users-id.test.ts` (mockea
  `djangoApiFetch` en vez de Prisma, cubre la resolución de `/auth/me/`
  y el rechazo de Django). `ruff check` limpio, suite completa de
  Django 1623/1623 en verde, `npx tsc --noEmit` limpio, suite completa
  de Vitest 1173/1173 en verde.
- **Diferido explícitamente (sin cambios):** `users/assignable`
  (consumido tanto por selectores ya-Django como por Reuniones/Dashboard
  todavía-Prisma, con expectativas de tipo de id incompatibles entre
  sí) y `users/[id]/view-preferences` (sobrescribe el array completo
  de `viewPreferences`, compartido con `activityFormat`/`CONFIG_FAVORITE`/
  `card-order` — mismo riesgo de divergencia ya documentado para
  `favorites` en la Fase 36).

**Archivos:** `backend/apps/users/serializers.py`,
`backend/apps/authentication/tests/test_views.py`,
`src/app/layout.tsx`, `src/app/api/users/[id]/theme/route.ts`,
`src/__tests__/api/users-id.test.ts`

**Impacto:** ninguna regresión (lectura y escritura se cortan juntas
en el mismo cambio, evitando introducir el tipo de bug de staleness
que otras fases de este cutover cerraron). Ningún modelo ni migración
nueva — solo 1 campo agregado a un serializer existente.

**Autor:** Claude Code

---

## v1.96.0 — 2026-08-21

**Tipo:** FIX
**Módulo:** Migración de stack — Fase 37: cutover de `profile/badges` y `activities/day-schedule` (`src/app/api/profile/badges/route.ts`, `src/app/api/activities/day-schedule/route.ts`)

Trigésimo séptima sub-fase — continúa "Cutovers pendientes" fuera de
`settings/*`. Al investigar el resto de endpoints sin cutover
(`users/assignable`, `users/[id]/theme`, `users/[id]/view-preferences`),
se encontró que requieren resolver primero la reconciliación entre el
id de Postgres (`session.userId`, `cuid`) y el id numérico de Django —
un gap YA documentado explícitamente en
`src/app/(protected)/tasks/page.tsx` desde la Fase 3a como trabajo de
una sub-fase futura dedicada. Se descartaron de este alcance para no
mezclar un cutover de bajo riesgo con ese problema mayor.

- **`GET /api/profile/badges/`** y **`GET /api/activities/day-schedule/`**
  — ambos sin ningún id foráneo cruzado (autoservicio, alcance "yo
  mismo" vía sesión/JWT) y sin ningún campo compartido con otro módulo
  — se redirigen a Django. Sus 3 insumos (Tareas, Comentarios,
  Actividades) ya se escriben exclusivamente ahí desde el cutover de
  Tareas — la versión Prisma calculaba insignias y validaba
  solapamientos de horario sobre datos cada vez más desactualizados.
  **Bug de staleness cerrado**, mismo patrón que `data-quality`/
  `activity-reasons` (Fase 36).
- `compute_and_persist_badges` (Fase 27) y `DayScheduleView` (Fase 26)
  ya devuelven JSON en camelCase idéntico al contrato TS — ningún
  mapeo de campos necesario, solo reenvío directo de la respuesta de
  Django.
- Tests: reescrita la sección de badges en `nova-badges-documents.test.ts`
  y la de day-schedule en `activities-retroactive-overlap.test.ts`
  (mockean `djangoApiFetch` en vez de Prisma). `npx tsc --noEmit`
  limpio, `npm run lint` sin hallazgos nuevos, suite completa de
  Vitest: 1171/1171 en verde.
- **Diferido explícitamente:** `users/assignable`, `users/[id]/theme`,
  `users/[id]/view-preferences` — requieren reconciliar el id de
  Postgres con el id numérico de Django antes de poder cortarse sin
  romper comparaciones de identidad en otros módulos (ver gap ya
  documentado en `tasks/page.tsx`, Fase 3a).

**Archivos:** `src/app/api/profile/badges/route.ts`,
`src/app/api/activities/day-schedule/route.ts`,
`src/__tests__/api/nova-badges-documents.test.ts`,
`src/__tests__/api/activities-retroactive-overlap.test.ts`

**Impacto:** cierra 2 bugs activos preexistentes (insignias de perfil
y validación de solapamiento de horario calculados sobre datos
desactualizados). Ningún modelo ni migración nueva.

**Autor:** Claude Code

---

## v1.95.0 — 2026-08-21

**Tipo:** FIX
**Módulo:** Migración de stack — Fase 36: primer cutover de `route.ts` del catálogo `settings/*` (`src/app/api/settings/**`, `src/lib/djangoSession.ts`)

Trigésimo sexta sub-fase — el usuario eligió "Cutovers pendientes"
tras el cierre del catálogo backend en la Fase 35. Investigación
previa detectó 57 archivos `route.ts` ya modificados (sin commitear,
de sesiones anteriores) — se confirmó que corresponden a cutovers ya
completados, no a trabajo roto o a tocar. A partir de ahí se auditó,
endpoint por endpoint, cuál de los 24 `route.ts` de `settings/*` sin
cutover tiene su consumidor real YA viviendo en Django, para no cortar
a ciegas: cortar el lado admin de una config cuyo consumidor real
sigue en Prisma la dejaría inconsistente incluso administrable, o
peor, no administrable en absoluto pese a devolver 200.

- **9 endpoints cortados** (auth/rol se sigue validando en Next.js,
  solo cambia el almacenamiento efectivo):
  - `POST /api/settings/activity-reasons/` + `PATCH .../[id]/` — el
    catálogo que consume el resto de la app (`GET /api/activity-reasons`)
    ya lee de Django desde la Fase 3b; el alta/edición desde Postgres
    no tenía ningún efecto visible. **Bug preexistente cerrado**, no
    introducido en esta sesión.
  - `GET/POST /api/settings/login-attempts/cleanup/` — el rate
    limiting real ya se resuelve en Django desde la Fase 6a; el
    `LoginAttempt` de Postgres que este endpoint purgaba ya no recibía
    escrituras (`@/lib/rate-limit.ts` queda huérfano, sin caller).
  - `GET/PUT /api/settings/escritorio-digital-config/` — `maxReplies`/
    `snoozePresetsMinutes` ya los consume Escritorio Digital
    (`apps/desk/services.py`, cutover desde la Fase 7). Otro **bug
    preexistente cerrado**. `archiveRetentionDays` se corta también
    pese a no tener consumidor real hoy (la purga automática de notas
    archivadas es un gap ya documentado y pospuesto, ROADMAP #13) —
    queda en el lugar correcto a la espera de esa purga.
  - `GET /api/settings/snooze-presets/` y `GET /api/settings/retroactive-window/`
    — mismo criterio, lecturas de valores cuyo enforcement real ya es
    Django (recordatorios / registro retroactivo de actividades).
  - `GET /api/settings/data-quality/` — las 7 entidades del informe
    (Tareas/Proyectos/Fases/Participantes/Motivos/Actividades) ya se
    escriben solo en Django; la versión Prisma leía datos cada vez más
    desactualizados desde que esos módulos se cortaron.
  - `GET/PUT /api/settings/seguridad-config/` — **cutover parcial**:
    `sessionDurationDefaultHours`/`sessionDurationRememberHours`
    (consumidos por `session_policy` del login Django) y
    `retentionLoginAttemptsDays` (consumido por
    `LoginAttemptsCleanupView`) se cortan; `passwordMinLength` NO —
    Django todavía no lo enforcea en su propio cambio de contraseña
    (gap ya documentado en `SeguridadConfigView`, Fase 32), así que la
    única fuente de verdad hoy sigue siendo la pre-validación de
    `auth/change-password/route.ts` contra Postgres.
  - `GET/PUT /api/settings/trabajo-avanzado/` — **cutover parcial**:
    `retroactiveWindowDays` se corta (mismo enforcement ya Django que
    `retroactive-window`); `workdayEndHour` NO — su único consumidor
    real hoy es `src/lib/capacityForecast.ts` (Predictive sigue 100%
    en Prisma); Django ya tiene una réplica dormida
    (`apps/analytics/capacity_forecast.py`) a la espera del cutover de
    `predictive/*`.
- **`extractDjangoFlatErrorMessage`** (nuevo en `djangoSession.ts`) —
  extrae `{"error": "mensaje"}`, el contrato plano que usan las vistas
  de `apps.configuration` (construyen la `Response` de error a mano),
  distinto del contrato anidado `{"error":{"code","message","details"}}`
  de `apps.core.exceptions` que ya cubría `extractDjangoFieldErrorMessage`.
- **Diferido explícitamente** (consumidor real todavía en Prisma o
  mixto, cutover prematuro rompería el único control administrable
  que hoy funciona): `prediction-window`, `welcome-message`,
  `role-targets`, `role-compatibility`, `holidays`, `leave-records`,
  `special-status`, `workload-config`, `kpi-start-date`,
  `analytics-config`, `normalization-curves`, `retention-policy`,
  `nova-cache`, `system-info` (mezcla usuarios/tareas ya-Django con
  reuniones/ideas todavía-Prisma), `config-history`+`restore-default`
  (perdería visibilidad de los cambios de las claves aún no
  cortadas), `documentation` (lee Markdown del filesystem, sin DB —
  cortar sería una regresión). `favorites` también se descartó:
  comparte el campo `User.view_preferences` con `dashboard/card-order`
  y `users/[id]/view-preferences`, ninguno de los dos cortado — riesgo
  de divergencia entre las dos copias del array.
- Tests: reescritos `settings-activity-reasons.test.ts`,
  `settings-data-quality.test.ts` (mockean `djangoApiFetch` en vez de
  Prisma — la lógica de negocio migró a Django y ya la cubre su propia
  suite), y las secciones correspondientes de `settings-config-center.test.ts`/
  `settings.test.ts`. `npx tsc --noEmit` limpio, `npm run lint` sin
  hallazgos nuevos (164 errores/1866 warnings preexistentes, ninguno en
  archivos tocados), suite completa de Vitest: 1172/1172 en verde.

**Archivos:** `src/lib/djangoSession.ts`,
`src/app/api/settings/activity-reasons/route.ts` + `[id]/route.ts`,
`src/app/api/settings/login-attempts/cleanup/route.ts`,
`src/app/api/settings/escritorio-digital-config/route.ts`,
`src/app/api/settings/seguridad-config/route.ts`,
`src/app/api/settings/trabajo-avanzado/route.ts`,
`src/app/api/settings/snooze-presets/route.ts`,
`src/app/api/settings/retroactive-window/route.ts`,
`src/app/api/settings/data-quality/route.ts`,
`src/__tests__/api/settings-activity-reasons.test.ts`,
`src/__tests__/api/settings-data-quality.test.ts`,
`src/__tests__/api/settings-config-center.test.ts`,
`src/__tests__/api/settings.test.ts`

**Impacto:** sobre producción (a diferencia de las Fases 28-35, que
solo agregaban superficie backend): cierra 2 bugs activos preexistentes
(alta/edición de motivos de actividad y configuración de Escritorio
Digital sin efecto real desde Ajustes) y hace administrables de nuevo
la duración de sesión y la retención de intentos de login. Ningún
modelo ni migración nueva — solo reenrutamiento de 9 `route.ts`.

**Autor:** Claude Code

---

## v1.94.0 — 2026-08-21

**Tipo:** FEATURE
**Módulo:** Migración de stack — Fase 35: Centro de Configuración, `notification-rules` (`apps/configuration/services.py`)

Trigésimo quinta sub-fase — cierra el último ítem del catálogo
`settings/*` que admitía una réplica de bajo riesgo (el usuario eligió
esta opción entre 4 posibles siguientes pasos tras el cierre del
catálogo en la Fase 34).

- **`GET/PUT /api/v1/settings/notification-rules/`** — reglas de
  notificación configurables: `comment_targets` (por rol que comenta
  una tarea → rol(es) notificados), `first_comment_role` (rol
  adicional notificado en el primer comentario de una tarea, o
  `null`), `retroactive_notify_roles` (roles notificados al registrar
  horas retroactivas). `GET` no requiere rol especial; `PUT` solo
  ADMINISTRADOR, con los 3 campos SIEMPRE obligatorios (nunca
  parciales, a diferencia del resto de `settings/*` — réplica fiel de
  `validateConfig`).
- **`get_effective_notification_rules` replica una semántica única en
  todo el catálogo:** a diferencia de cada `get_effective_*` anterior,
  NO recibe `as_of` (el TS tampoco lo tiene) y, una vez que existe un
  registro guardado, los campos ausentes en ese registro caen a un
  valor VACÍO — nunca al default basado en jerarquía. Solo se usa el
  default completo (`comment_targets` construido desde
  `RoleNotificationTarget`, `retroactive_notify_roles=["COORDINADOR_NACIONAL"]`)
  cuando NUNCA se guardó nada.
- **GAP DOCUMENTADO — esta fase SOLO porta la configuración, no
  reconecta los consumidores reales:** `CommentService.create_comment`
  y `RETROACTIVE_NOTIFY_ROLES` (ambos en `apps/tasks/services.py`)
  siguen leyendo directamente de `RoleNotificationTarget`/la lista
  hardcodeada, no de esta configuración nueva. Es seguro hoy porque
  los defaults coinciden exactamente con ese comportamiento
  hardcodeado — pero una regla personalizada guardada desde este
  endpoint no tendría ningún efecto observable todavía. Mismo
  criterio ya usado para `password_min_length` (Fase 32).
- **Sin cutover de `route.ts` todavía.** Sin migraciones nuevas. 12
  tests nuevos — 1622 pasando en total. Ver `docs/AUDIT_LOG.md` §
  2026-08-21 (Fase 35). **Con esta entrega, el catálogo `settings/*`
  queda cerrado en su totalidad** salvo `retention-policy/purge`
  (modelos no portados).

**Archivos:** `backend/apps/configuration/services.py`, `views.py`,
`urls.py`

**Impacto:** ninguno sobre producción — 1 endpoint Django nuevo, sin
cutover de `route.ts`.

**Autor:** Claude Code

---

## v1.93.0 — 2026-08-21

**Tipo:** FEATURE
**Módulo:** Migración de stack — Fase 34: Centro de Configuración, informe de calidad del dato + 2 rutas más (`apps/configuration/data_quality.py`, `apps/reports/views.py`)

Trigésimo cuarta sub-fase — cierra `settings/data-quality` (el
informe de consistencia más grande del catálogo, ~256 líneas TS) +
`settings/nova-cache` (solo configuración) + `reports/executive/closure-status`
(descubierto en un barrido completo del árbol `src/app/api/`, fuera
del catálogo `settings/*`).

- **`GET /api/v1/settings/data-quality/`** (`DataQualityView` +
  `apps.configuration.data_quality.build_data_quality_report`) — 7
  chequeos de consistencia sobre Tareas/Proyectos/Fases/Participantes/
  Actividades (fechas inválidas, progreso/horas fuera de rango, sin
  propietario, motivo de actividad huérfano, registro retroactivo
  inconsistente, horas con horario solapado, huérfanos estructurales)
  — cero modelo nuevo, todos ya portados (Fases 3b/5a-5e). Solo
  ADMINISTRADOR.
- **`GET/PUT /api/v1/settings/nova-cache/`** — TTL de caché de
  mensajes de Nova. Solo se porta la configuración (un entero) — Nova/
  Groq en sí sigue fuera de alcance, mismo criterio que
  `dashboard/nova-message` (Fase 25).
- **`GET /api/v1/reports/executive/closure-status/`** (`ClosureStatusView`,
  en `apps.reports`) — si un mes tiene un cierre con corte anticipado,
  reutilizando `get_month_closure_period` (ya portado desde la Fase
  4a). Descubierto en un barrido completo de rutas fuera de
  `settings/*` (`users/[id]/reset-password` también revisado y
  confirmado YA cortado a Django desde la Fase 2 — no requería nada).
- **Con esta entrega, el catálogo `settings/*` queda 100% cerrado**
  salvo `notification-rules`/`retention-policy/purge` (cambio de
  comportamiento real/modelos no portados, decisión de fases previas).
- **Sin cutover de `route.ts` todavía.** Sin migraciones nuevas. 27
  tests nuevos — 1610 pasando en total. Ver `docs/AUDIT_LOG.md` §
  2026-08-21 (Fase 34).

**Archivos:** `backend/apps/configuration/data_quality.py` (nuevo),
`views.py`, `serializers.py`, `services.py`, `urls.py`,
`backend/apps/reports/views.py`, `urls.py`

**Impacto:** ninguno sobre producción — 3 endpoints Django nuevos, sin
cutover de `route.ts`.

**Autor:** Claude Code

---

## v1.92.0 — 2026-08-21

**Tipo:** FEATURE
**Módulo:** Migración de stack — Fase 33: Centro de Configuración, 4 endpoints más (`apps/configuration/views.py`, `apps/authentication/services.py`)

Trigésimo tercera sub-fase — continúa el barrido de `settings/*` con
las últimas 4 rutas de bajo riesgo del catálogo (todas sobre modelos
ya existentes: `SystemConfigHistory` desde la Fase 3d, `LoginAttempt`
desde la Fase 6a).

- **`GET /api/v1/settings/config-history/?keys=...`** — historial de
  valores de una o más claves de configuración, con el nombre de
  quién los cambió.
- **`POST /api/v1/settings/config-history/restore-default/`** —
  reescribe un lote de claves a valores dados (JSON `{defaults: {key: value}}`).
- **`GET /api/v1/settings/documentation/?doc=...`** — lee los Markdown
  de `docs/` (whitelist fija de 6 claves, nunca un path arbitrario),
  reutilizando `BASE_DIR.parent` (ya usado para leer el archivo
  `VERSION` en `settings/base.py`) como raíz del repo.
- **`GET/POST /api/v1/settings/login-attempts/cleanup/`** (en
  `apps.authentication`, dueña de `LoginAttempt`) — vista previa
  (cuenta) y purga real de intentos de login expirados. **Réplica
  ADAPTADA, no literal:** el `LoginAttempt` de Django (Fase 6a) es un
  log por evento (una fila por intento), mientras que el TS opera
  sobre un contador agregado por IP con estado de bloqueo propio
  (`attempts`/`blockedUntil`) — el criterio de purga se adapta a
  "más antiguo que la retención configurada" a secas, ya que para
  este modelo esa condición sola ya implica "no bloqueante" (la
  ventana de bloqueo real, `settings.LOGIN_LOCKOUT_MINUTES`, es
  órdenes de magnitud más corta que cualquier retención en días).
- **`notification-rules`/`data-quality`/`retention-policy/purge`
  siguen fuera de alcance** (cambios de comportamiento real o modelos
  no portados, ya documentado en Fases 31/32).
- **Sin cutover de `route.ts` todavía.** Sin migraciones nuevas. 18
  tests nuevos — 1583 pasando en total. Ver `docs/AUDIT_LOG.md` §
  2026-08-21 (Fase 33). **Con esta entrega, el catálogo `settings/*`
  queda esencialmente cerrado** salvo las 3 rutas explícitamente
  deferidas.

**Archivos:** `backend/apps/configuration/views.py`, `urls.py`,
`backend/apps/authentication/services.py`, `views.py`,
`backend/config/api_v1_urls.py`

**Impacto:** ninguno sobre producción — 4 endpoints Django nuevos, sin
cutover de `route.ts`.

**Autor:** Claude Code

---

## v1.91.0 — 2026-08-21

**Tipo:** FEATURE
**Módulo:** Migración de stack — Fase 32: Centro de Configuración, 4 endpoints más (`apps/configuration/views.py`, `apps/analytics/normalization.py`)

Trigésimo segunda sub-fase — continúa el barrido de `settings/*` con
4 rutas cuyo backing ya existía en su mayoría (motor de normalización
de Analytics desde la Fase 4d, sesión desde la Fase 6a, jornada/
ventana retroactiva desde las Fases 3f/4f).

- **`GET/PATCH /api/v1/settings/normalization-curves/`** — las 6
  curvas de normalización del motor de Analytics
  (cumplimiento/vencidas/carga/capacidad/consistencia/trazabilidad).
  `get_effective_curve`/`get_all_effective_curves`/`is_valid_curve`/
  `DEFAULT_CURVES` ya existían desde la Fase 4d; nuevo
  `set_curve_config` (primer consumidor HTTP de ese motor). Requiere
  `can_manage_users` (mismo whitelist que `analytics-config`).
- **`GET/PUT /api/v1/settings/seguridad-config/`** — longitud mínima
  de contraseña (clave nueva) + duración de sesión (ya existente,
  Fase 6a) + retención de intentos de login (clave nueva). Solo
  ADMINISTRADOR. Gap documentado: `password_min_length` no se
  enforce todavía en el flujo de cambio de contraseña de Django (usa
  los validadores nativos de `AUTH_PASSWORD_VALIDATORS`) — esta fase
  solo porta la superficie de configuración.
- **`GET/PUT /api/v1/settings/trabajo-avanzado/`** — ventana de
  registro retroactivo + hora de corte de jornada, AMBAS ya existentes
  desde las Fases 3f/4f. Backing 100% preexistente.
- **`GET /api/v1/settings/system-info/`** — versión (`settings.APP_VERSION`,
  ya existente) + conteos (usuarios/tareas/reuniones/ideas). Solo
  ADMINISTRADOR.
- **`seguridad-config`/`trabajo-avanzado` con `PUT` de cuerpo vacío
  válido (200, no-op)** — a diferencia de `escritorio-digital-config`
  (Fase 31), el TS de estas 2 rutas NO exige al menos un campo
  presente, réplica fiel de esa asimetría.
- **Sin cutover de `route.ts` todavía.** Sin migraciones nuevas. 22
  tests nuevos — 1565 pasando en total. Ver `docs/AUDIT_LOG.md` §
  2026-08-21 (Fase 32).

**Archivos:** `backend/apps/configuration/views.py`, `serializers.py`,
`services.py`, `urls.py`, `backend/apps/analytics/normalization.py`

**Impacto:** ninguno sobre producción — 4 endpoints Django nuevos, sin
cutover de `route.ts`. El resto del catálogo `settings/*` (~11 rutas
más — data-quality/notification-rules/config-history/documentation/
login-attempts-cleanup/retention-policy-purge) sigue sin planificar
en detalle.

**Autor:** Claude Code

---

## v1.90.0 — 2026-08-21

**Tipo:** FEATURE
**Módulo:** Migración de stack — Fase 31: Centro de Configuración, 5 endpoints más (`apps/configuration/views.py`)

Trigésimo primera sub-fase — continúa el barrido de `settings/*` con
5 rutas cuyo backing ya existía en su mayoría (motor de KPIs/Analytics
desde las Fases 4a/4d) o era trivial de completar.

- **`GET/PUT /api/v1/settings/workload-config/`** — horas efectivas +
  3 límites de carga laboral, validado manualmente (el orden válido
  depende de los valores YA vigentes para los campos que la llamada
  no toca). Backing 100% preexistente.
- **`GET/PATCH /api/v1/settings/kpi-start-date/`** — lista de usuarios
  con su `kpi_start_date` + ajuste puntual por usuario. `User.kpi_start_date`
  ya existía desde la Fase 4a.
- **`GET/PUT /api/v1/settings/retention-policy/`** — política de
  retención (informes mensuales/tareas archivadas/base de
  conocimiento), 3 claves JSON nuevas. Solo la política se porta — la
  ejecución de la purga (`retention-policy/purge`) requiere
  `MonthlyReport`/`KnowledgeDocument`/`DataPurgeLog`, ninguno portado
  (Reportes Ejecutivos/Nova-RAG, fuera de alcance), y queda deferida.
- **`GET/PUT /api/v1/settings/escritorio-digital-config/`** — retención
  de archivado + tope de respuestas + presets de posposición.
  `set_snooze_presets_minutes` (nuevo) — la Fase 28 lo había dejado
  sin escritura por falta de consumidor HTTP real; esta ruta SÍ lo
  expone.
- **`GET/PATCH /api/v1/settings/analytics-config/`** — las 26 claves
  del motor de Analytics, validado manualmente (diccionario disperso
  de claves dinámicas + 3 validaciones de suma de ponderación +
  orden de 3 umbrales, todo contra los valores YA vigentes). Nuevo
  `set_analytics_config_value`.
- **Todas las escrituras requieren ADMINISTRADOR**, salvo
  `analytics-config` que reutiliza el whitelist de 3 roles
  (`can_manage_users`) ya usado en `role-targets`/`role-compatibility`
  — mismo criterio que el TS (`canManageUsers` también ahí).
- **Sin cutover de `route.ts` todavía.** Sin migraciones nuevas. 39
  tests nuevos — 1543 pasando en total. Ver `docs/AUDIT_LOG.md` §
  2026-08-21 (Fase 31).

**Archivos:** `backend/apps/configuration/views.py`, `serializers.py`,
`services.py`, `urls.py`

**Impacto:** ninguno sobre producción — 5 endpoints Django nuevos, sin
cutover de `route.ts`. El resto del catálogo `settings/*` (~15 rutas
más — data-quality/seguridad-config/notification-rules/
normalization-curves/config-history/documentation/system-info/
login-attempts/trabajo-avanzado/retention-policy-purge) sigue sin
planificar en detalle.

**Autor:** Claude Code

---

## v1.89.0 — 2026-08-21

**Tipo:** FEATURE
**Módulo:** Migración de stack — Fase 30: Centro de Configuración, CRUD de Motivos de Actividad (`apps/tasks/views.py`)

Trigésima sub-fase — cierra `activity-reasons`, el par de rutas
diferido explícitamente en la Fase 29 por vivir en un prefijo distinto
al resto del trío Feriados/Permisos/Estados Especiales.

- **`POST /api/v1/settings/activity-reasons/`** (`ActivityReasonCreateView`)
  — crea un motivo, generando una `key` única a partir del `label`
  (`_slugify_activity_reason_key`: normaliza NFD, descarta diacríticos,
  mayúsculas, no-alfanuméricos → `_`, recorta extremos, `"MOTIVO"` si
  queda vacío), con sufijo numérico si la clave colisiona. Solo
  ADMINISTRADOR.
- **`PATCH /api/v1/settings/activity-reasons/<id>/`** (`ActivityReasonUpdateView`)
  — actualización parcial (label/description/assigned_roles/is_active/
  is_archived); archivar fuerza `is_active=False` y setea
  `archived_at`; restaurar (`is_archived=False`) NO reactiva
  `is_active` automáticamente — asimetría fiel del TS, replicada tal
  cual. Solo ADMINISTRADOR.
- **`description` se persiste como cadena vacía, no `None`:** el
  modelo Django (`blank=True, default=""`, desde la Fase 3b) nunca fue
  nullable, a diferencia del `String?` de Prisma — mismo criterio ya
  aplicado en otros campos de texto opcionales del backend.
- **Cero motor nuevo, cero migraciones** — `ActivityReason` ya existía
  completo desde la Fase 3b; solo faltaban estos 2 endpoints de
  escritura (la lectura, `GET /activity-reasons/`, ya estaba portada).
- **Sin cutover de `route.ts` todavía.** 17 tests nuevos — 1504
  pasando en total. Ver `docs/AUDIT_LOG.md` § 2026-08-21 (Fase 30).

**Archivos:** `backend/apps/tasks/views.py`, `serializers.py`,
`backend/config/api_v1_urls.py`

**Impacto:** ninguno sobre producción — 2 endpoints Django nuevos, sin
cutover de `route.ts`. Con esta entrega, el `activity-reasons` deferido
en la Fase 29 queda cerrado; el resto del catálogo `settings/*` (~20
rutas más — analytics-config/seguridad-config/data-quality/
workload-config/notification-rules/etc.) sigue sin planificar en
detalle.

**Autor:** Claude Code

---

## v1.88.0 — 2026-08-20

**Tipo:** FEATURE
**Módulo:** Migración de stack — Fase 29: Centro de Configuración, CRUD de Feriados/Permisos/Estados Especiales (`apps/configuration/views.py`)

Veintinueveava sub-fase — cierra la superficie HTTP de 3 modelos que
ya existían desde la Fase 4a ("tabla interna sin endpoint HTTP,
gestionada vía Django Admin", consumidos en proceso por el motor de
KPIs/Analytics desde entonces).

- **`GET/POST /api/v1/settings/holidays/` + `DELETE
  /api/v1/settings/holidays/<id>/`** — catálogo de feriados, año
  derivado de la fecha, 409 en fecha duplicada.
- **`GET/POST /api/v1/settings/leave-records/` + `DELETE
  /api/v1/settings/leave-records/<id>/`** — permisos/ausencias:
  `POST` crea UN registro por cada día laborable (lunes-viernes, sin
  feriado) dentro del rango, nunca uno solo por todo el período;
  VACACIONES siempre de día completo; 404 si el usuario no existe;
  400 si el rango no incluye ningún día laborable.
- **`GET/POST /api/v1/settings/special-status/` + `PATCH/DELETE
  /api/v1/settings/special-status/<id>/`** — estados especiales
  (maternidad/lactancia): valida que cada límite de horas esté en
  `(0, 24]` y respete el orden estricto Subutilización < Moderado/
  Óptimo ≤ Óptimo/Elevada < Elevada/Sobrecarga; `PATCH` finaliza el
  estado hoy (o antes, si ya tenía fecha fin pasada) — nunca lo
  extiende.
- **Todas las escrituras requieren ADMINISTRADOR** (a diferencia de
  `retroactive-window`/`snooze-presets` de la Fase 28) — mismo
  criterio que el TS: este catálogo es 100% administrativo.
  Reutiliza `is_working_day`/`get_holiday_set` (ya portados desde la
  Fase 3d/4a) para el cómputo de días laborables.
- **Sin cutover de `route.ts` todavía.** Sin migraciones nuevas (los 3
  modelos ya existían). 44 tests nuevos — 1487 pasando en total. Ver
  `docs/AUDIT_LOG.md` § 2026-08-20 (Fase 29).

**Archivos:** `backend/apps/configuration/views.py`, `serializers.py`,
`urls.py`, `models.py` (docstrings actualizados)

**Impacto:** ninguno sobre producción — 3 recursos CRUD nuevos, sin
cutover de `route.ts`. El resto del catálogo `settings/*` (~21 rutas
más — analytics-config/seguridad-config/data-quality/workload-config/
notification-rules/etc.) sigue sin planificar en detalle.

**Autor:** Claude Code

---

## v1.87.0 — 2026-08-20

**Tipo:** FEATURE
**Módulo:** Migración de stack — Fase 28: Centro de Configuración, 6 endpoints de bajo riesgo (`apps/configuration/views.py`)

Veintiochoava sub-fase — continúa el "arranque acotado" del Centro de
Configuración (Fase 13) con 6 rutas más cuyo backing ya existía
(Fases 22/24/25) o era trivial de agregar.

- **`GET /api/v1/settings/retroactive-window/`** — cualquier
  autenticado, reutiliza `get_effective_retroactive_window_days` (ya
  portado desde la Fase 3f).
- **`GET /api/v1/settings/snooze-presets/`** — cualquier autenticado,
  nuevo `get_effective_snooze_presets_minutes` (mismo mecanismo JSON
  que `RoleCompatibility`). Solo lectura: el TS tiene un `setter` en la
  librería sin ningún `route.ts` que lo exponga — no se porta un
  `set_snooze_presets_minutes` sin consumidor real.
- **`GET/PATCH /api/v1/settings/favorites/`** — reutiliza
  `User.view_preferences` con el prefijo `CONFIG_FAVORITE:`, mismo
  truco que `PATCH /dashboard/card-order/` (Fase 25).
- **`GET/PUT /api/v1/settings/welcome-message/`** — el `GET` ya tenía
  backing desde la Fase 25 (Dashboard); se agrega el `PUT`
  (ADMINISTRADOR).
- **`GET/PATCH /api/v1/settings/role-targets/`** — bulk sobre
  `get_effective_role_target` (Fase 22); nuevo `set_role_target` +
  `get_all_effective_role_targets`.
- **`GET/PATCH /api/v1/settings/role-compatibility/`** — bulk sobre
  `get_effective_role_compatibility` (Fase 24); nuevo
  `set_role_compatibility` + `get_all_effective_role_compatibility`,
  con la Regla 4 (dura, nunca cruzar `ROLE_LEVEL`) validada en la vista.
- **`ROLE_LABEL`/`ALL_ROLES` centralizados en `apps.hierarchy.services`**
  (mismo criterio que `ROLE_LEVEL` en la Fase 9b) — `apps.tasks.services`
  tenía la única copia hasta ahora; el Centro de Configuración es el
  segundo consumidor real, así que se centraliza en vez de triplicar.
- **Sin cutover de `route.ts` todavía.** Sin migraciones nuevas. 36
  tests nuevos — 1443 pasando en total. Ver `docs/AUDIT_LOG.md` §
  2026-08-20 (Fase 28).

**Archivos:** `backend/apps/configuration/views.py`, `serializers.py`,
`services.py`, `urls.py`, `backend/apps/hierarchy/services.py`,
`backend/apps/tasks/services.py`

**Impacto:** ninguno sobre producción — 6 endpoints Django nuevos, sin
cutover de `route.ts`. El resto del catálogo `settings/*` (~25 rutas
más — analytics-config/holidays/leave-records/special-status/
seguridad-config/data-quality/etc.) sigue sin planificar en detalle.

**Autor:** Claude Code

---

## v1.86.0 — 2026-08-20

**Tipo:** FEATURE
**Módulo:** Migración de stack — Fase 27: Gamificación de perfil (`apps/users/badges.py` nuevo)

Veintisieteava sub-fase — porta `GET /api/profile/badges` y de paso
cierra un gap real ya documentado desde la Fase 11 (Mejora Continua).

- **`GET /api/v1/profile/badges/`** (`BadgesView` + `compute_and_persist_badges`)
  — réplica exacta de `profile/badges/route.ts`: calcula 6 insignias
  (Cumplidor/Confiable/Colaborador/Innovador/Constante/Mentor) sobre
  Tareas/Comentarios/Actividades ya portados, persiste en `User.badges`
  las recién ganadas (nunca quita las existentes) y devuelve
  estadísticas de racha de actividad.
- **Gap cerrado — badge "innovador" en `apps.ideas`:**
  `change_idea_status` (`apps/ideas/services.py`) ahora asigna el
  badge "innovador" al autor cuando una idea llega a IMPLEMENTADA —
  documentado como gap pendiente desde la Fase 11 (`User.badges` no
  existía en Django en ese momento; existe desde la Fase 25).
- **Cero motor nuevo** — todas las dependencias (`Task`/`Comment`/
  `TaskActivity`/`User.badges`) ya estaban portadas.
- **Sin cutover de `route.ts` todavía.** Sin migraciones nuevas. 25
  tests nuevos — 1407 pasando en total. Ver `docs/AUDIT_LOG.md` §
  2026-08-20 (Fase 27).

**Archivos:** `backend/apps/users/badges.py` (nuevo),
`backend/apps/users/self_service_views.py`, `backend/apps/ideas/services.py`,
`backend/apps/ideas/models.py`, `backend/config/api_v1_urls.py`

**Impacto:** ninguno sobre producción — 1 endpoint Django nuevo, sin
cutover de `route.ts`. El fix de `apps.ideas` es lógica de negocio
nueva (asignación de badge) pero solo afecta el backend Django, que
todavía no sirve tráfico real de Mejora Continua.

**Autor:** Claude Code

---

## v1.85.0 — 2026-08-20

**Tipo:** FEATURE
**Módulo:** Migración de stack — Fase 26: cabos sueltos de auto-servicio (`apps/users/self_service_views.py` nuevo, `DayScheduleView` en `apps/tasks/views.py`)

Veintiseisava sub-fase — barrido de rutas pequeñas y autocontenidas
sin motor ni decisión de arquitectura pendiente, tras confirmar que
`repository`/`repository/<year>/<month>` y `auth/reset-password` YA
estaban cortados a Django en fases previas (Fase 3d/6c).

- **`GET /api/v1/users/assignable/`** (`AssignableUsersView`) —
  réplica exacta de `users/assignable/route.ts`: usuarios visibles
  para el actor (INCLUYE al propio actor, a diferencia del Dashboard),
  usado para poblar selectores de asignación de tareas. Deliberadamente
  separada de `UserAdminViewSet` (`admin/users/`, permisos
  administrativos) — es auto-servicio, cualquier autenticado.
- **`PATCH /api/v1/users/<id>/theme/`** (`UserThemeView`) — réplica
  exacta de `users/[id]/theme/route.ts`: solo el propio usuario cambia
  su tema. Nuevo `User.theme` (`LIGHT`/`DARK`, default `LIGHT`) —
  mismo gap documentado desde la Fase 12 que `badges`/`view_preferences`
  (Fase 25).
- **`GET /api/v1/activities/day-schedule/`** (`DayScheduleView`, en
  `apps.tasks`) — réplica exacta de `activities/day-schedule/route.ts`:
  actividades del actor con horario registrado en tareas SEGUIMIENTO
  (no FIJA) para un día dado, usado por el cliente para validar
  solapamientos antes de guardar. Reutiliza `parse_date_only`/
  `business_calendar_day`/`business_day_real_range` (`business_time.py`,
  ya portados desde la Fase 3b).
- **Cero lógica de negocio nueva** — las 3 rutas son ensamblaje puro
  sobre modelos/motor ya portados.
- **Sin cutover de `route.ts` todavía.** 1 migración nueva
  (`users.0006_user_theme`). 15 tests nuevos — 1382 pasando en total.
  Ver `docs/AUDIT_LOG.md` § 2026-08-20 (Fase 26).

**Archivos:** `backend/apps/users/self_service_views.py` (nuevo),
`backend/apps/users/self_service_urls.py` (nuevo),
`backend/apps/users/models.py`, `backend/apps/tasks/views.py`,
`backend/config/api_v1_urls.py`

**Impacto:** ninguno sobre producción — 3 endpoints Django nuevos, sin
cutover de `route.ts`.

**Autor:** Claude Code

---

## v1.84.0 — 2026-08-20

**Tipo:** FEATURE
**Módulo:** Migración de stack — Fase 25: Dashboard (nuevas `backend/apps/dashboard/`, `backend/apps/announcements/`)

Veinticincoava sub-fase — primer módulo de negocio nuevo desde Equipo
(Fase 18) que no es una ruta delgada de Analytics: agregación personal
del Dashboard + Comunicados (dependencia descubierta sin modelo
Django propio hasta ahora).

- **`GET /api/v1/dashboard/`** (`DashboardView` + `build_dashboard_payload`)
  — réplica exacta de `src/app/api/dashboard/route.ts` (~320 líneas):
  tareas prioritarias con urgencia (vencida/hoy/mañana/esta semana),
  estadísticas por período (hoy/semana/mes), % de carga laboral y de
  cumplimiento del mes (motor central, no recalculado), feed de
  actividad reciente del área (comentarios/registros de horas/tareas
  completadas/asignadas/ideas propuestas/implementadas desde el último
  login), alertas de equipo (colaboradores ejecutores en Carga
  elevada/Sobrecarga, niveles 2+), comunicados vigentes, próximas
  reuniones (propias + invitado), proyectos propios, mensaje de
  bienvenida configurable. Ensamblado 100% sobre motor YA portado
  (Analytics/Ideas/Configuración/Tareas/Reuniones/Proyectos) — sin
  motor nuevo.
- **`PATCH /api/v1/dashboard/card-order/`** (`DashboardCardOrderView`)
  — réplica exacta de `card-order/route.ts`: orden de tarjetas
  codificado como una entrada `DASHBOARD_CARDS:` en `view_preferences`.
- **`apps.announcements`** (app nueva) — modelo `Announcement` +
  `GET`/`POST /api/v1/announcements/` + `DELETE
  /api/v1/announcements/<id>/`, réplica exacta de
  `src/app/api/announcements/route.ts`/`[id]/route.ts`. Único modelo
  Prisma consumido por el Dashboard que no tenía ningún equivalente
  Django todavía (gap real, no solo de endpoint).
- **`User.badges`/`User.view_preferences`** (campos nuevos,
  `JSONField(default=list)`) — cierran gaps documentados desde la
  Fase 12 (LOPD). `User.lastLoginAt` (TS) NO se agrega como campo
  nuevo: nunca se escribe en ningún handler del legacy, así que se
  reutiliza el `last_login` nativo de `AbstractUser` (tampoco escrito
  — esta app no usa `django.contrib.auth.login()`), mismo
  comportamiento observable sin campo redundante.
- **`get_effective_welcome_message`/`_active`** (`apps/configuration/services.py`)
  y **`get_activity_reason_label_map`** (`apps/tasks/services.py`) —
  piezas de motor puntuales que solo el Dashboard consumía.
- **`nova-message` (asistente Nova/Groq) queda explícitamente FUERA de
  alcance** — depende de LLM/Groq, nunca portado, mismo criterio que
  otros consumidores de IA generativa deferidos en fases previas.
- **Sin cutover de `route.ts` todavía.** 2 migraciones nuevas
  (`users.0005_user_badges_view_preferences`,
  `announcements.0001_initial`). 34 tests nuevos — 1367 pasando en
  total. Ver `docs/AUDIT_LOG.md` § 2026-08-20 (Fase 25).

**Archivos:** `backend/apps/dashboard/` (nuevo), `backend/apps/announcements/`
(nuevo), `backend/apps/users/models.py`, `backend/apps/configuration/services.py`,
`backend/apps/tasks/services.py`, `backend/config/settings/base.py`,
`backend/config/api_v1_urls.py`

**Impacto:** ninguno sobre producción — 2 apps Django nuevas, sin
cutover de `route.ts`. Con esta entrega, Dashboard y Comunicados
quedan disponibles en Django para una futura migración del adaptador
del frontend.

**Autor:** Claude Code

---

## v1.83.0 — 2026-08-20

**Tipo:** FEATURE
**Módulo:** Migración de stack — Fase 24: Analytics, `recommendations/team` (nuevo `backend/apps/analytics/recommendations.py`)

Veinticuatroava sub-fase — cierra `recommendations/team`, el Motor
Determinista de Recomendaciones (Compatibilidad Organizacional).
Dejaba solo `diagnostics` como única ruta delgada de Analytics
pendiente.

- **`GET /api/v1/analytics/recommendations/team/`**
  (`TeamRecommendationsView` + `compute_team_recommendations`) —
  recomendaciones de redistribución de carga con impacto cuantificado
  entre los subordinados EJECUTORES del actor: cruza exceso de horas
  (colaboradores sobrecargados) vs. capacidad disponible (colaboradores
  con margen), respetando 5 reglas de negocio — mismo cargo siempre
  primero, Matriz de Compatibilidad Operativa como respaldo, NUNCA
  redistribución vertical (filtro absoluto por `ROLE_LEVEL`, no solo
  de configuración), y un mensaje explícito (nunca una sugerencia
  incorrecta) cuando no hay candidato compatible.
- **`get_effective_role_compatibility`** (`apps/configuration/services.py`)
  — matriz de compatibilidad ADICIONAL entre cargos del mismo nivel,
  configuración OPCIONAL y DIRECCIONAL (JSON en `SystemConfigHistory`,
  mismo mecanismo que `get_effective_role_target`, Fase 22). Vacía por
  defecto — sin configuración explícita, un cargo solo redistribuye
  con el mismo cargo.
- **Cero lógica de negocio nueva en el resto de las piezas** —
  reutiliza `compute_team_capacity_forecast` (Fase 9b),
  `classify_capacity`/`capacity_to_score` (Fase 4f/4g, ya usadas por
  el simulador KPI-level de la Fase 23) y `prioritize_recommendations`
  (Fase 4k, `insights_engine.py` — sin consumidor HTTP hasta ahora,
  ya tenía exactamente la forma `TeamRecommendation` esperada).
- **Con esta entrega, 13 de las ~16 rutas delgadas de Analytics
  identificadas en la Fase 16 quedan cerradas** — resta únicamente
  `diagnostics`, que depende de instrumentación de proceso (contadores
  de caché/validaciones en memoria) nunca portada a Django.
- **Sin cutover de `route.ts` todavía** — Next.js sigue sirviendo
  `/api/analytics/recommendations/team` desde Postgres/Prisma.
- **Tests**: 23 nuevos (`apps/analytics/tests/test_recommendations.py`:
  11, `apps/configuration/tests/test_role_compatibility.py`: 7,
  `apps/analytics/tests/test_team_recommendations_view.py`: 5) — 1337
  pasando en total. `ruff check` limpio, sin migraciones nuevas.

## v1.82.0 — 2026-08-20

**Tipo:** FEATURE
**Módulo:** Migración de stack — Fase 23: Analytics, simulador KPI-level (nuevo `backend/apps/analytics/kpi_simulate.py`)

Veintitresava sub-fase — cierra `analytics/simulate/[userId]`, el
simulador interactivo MÁS ANTIGUO de Analytics (§9, ampliado en Sprint
A) — 8 escenarios que nunca persisten nada. La investigación previa
confirmó, igual que con Benchmarks (Fase 22), que pese al tamaño
(~280 líneas TS) no había gap de motor: `classify_capacity` incluso
tiene un comentario propio en el código legado anticipando este
puerto ("para que el motor real y el simulador... usen la MISMA
clasificación").

- **`POST /api/v1/analytics/simulate/<user_id>/`** (`SimulateKpiView`
  + `simulate_kpi_scenario`) — recalcula en memoria, a partir del
  estado real actual, el efecto de 8 escenarios sobre Equilibrio
  Operativo/Performance Score/Carga Laboral/Capacidad Proyectada:
  `assign_task`, `daily_hours`, `vacation`, `permiso` (afectan solo
  Carga/Capacidad — el Performance Score nunca pondera horas ni
  capacidad, por diseño) y `complete_task`/`reduce_overdue`/
  `increase_consistency`/`register_hours` (Sprint A — recalculan UN
  factor con la curva/peso reales, dejando los otros 3 intactos).
- **Cero lógica de negocio nueva** — reutiliza `compute_health_score`/
  `compute_performance_score`/`compute_capacity_forecast`/
  `classify_capacity`/`capacity_to_score`/`carga_health_score`/
  `weighted_points`/`normalize`/`compute_workload_range`/
  `compute_workload_pct`/`compute_carga_tiempo`/`monthly_business_base`
  (todas ya portadas desde las Fases 4a-4h) para recombinar factores
  sin recalcular el resto.
- **Validación de escenario manual** (`is_valid_scenario`), no un DRF
  `Serializer` — el cuerpo es una unión discriminada por `type` con
  campos distintos por escenario (réplica exacta de `isValidScenario`),
  primer caso de este tipo en el proyecto — se documentó explícitamente
  por qué no encaja en el patrón `Serializer` ya establecido.
- **Con esta entrega, 12 de las ~16 rutas delgadas de Analytics
  identificadas en la Fase 16 quedan cerradas** — restan `diagnostics`
  y `recommendations/team`, los 2 únicos casos que sí requieren piezas
  nuevas genuinas (instrumentación de proceso / Matriz de
  Compatibilidad Operativa).
- **Sin cutover de `route.ts` todavía** — Next.js sigue sirviendo
  `/api/analytics/simulate` desde Postgres/Prisma.
- **Tests**: 44 nuevos (`apps/analytics/tests/test_kpi_simulate.py`:
  36, `test_kpi_simulate_view.py`: 8) — 1314 pasando en total.
  `ruff check` limpio, sin migraciones nuevas.

## v1.81.0 — 2026-08-20

**Tipo:** FEATURE
**Módulo:** Migración de stack — Fase 22: Analytics, Benchmarks Inteligente (nuevo `backend/apps/analytics/benchmark.py`)

Veintidosava sub-fase — cierra el mayor de los 4 casos de Analytics
que requerían motor nuevo (Sprint 7): Benchmarks Inteligente. La
investigación previa confirmó que, pese a su tamaño (~350 líneas TS),
todas sus piezas de datos ya existían — `get_factor_audit_history`/
`closest_factor_point` (Fase 4j/9), `compute_monthly_history`/
`compute_weekly_history` (Fase 4a-4b) — o eran configuración simple
(`RoleTarget`, mismo patrón JSON-en-`SystemConfigHistory` ya usado en
toda la migración), no un subsistema nuevo.

- **`GET /api/v1/analytics/benchmarks/<user_id>/`** (`BenchmarkView`)
  — decide automáticamente entre 3 modos para 5 indicadores
  (Performance/Riesgo Operativo/Cumplimiento/Carga Laboral/Capacidad
  Futura): `cargo` (≥3 colaboradores del mismo cargo — promedio,
  percentil, mejor del cargo), `cargo-limitado` (exactamente 2 — solo
  promedio, sin percentil/mejor) o `personal` (0-1 — comparación
  contra el propio historial + objetivo del cargo si está
  configurado). NUNCA compara cargos distintos aunque compartan
  `ROLE_LEVEL`, NUNCA modifica ningún cálculo de KPI, NUNCA devuelve
  "sin compañeros" — siempre hay un benchmark útil.
- **`apps.analytics.benchmark`** (nuevo módulo) — `compute_smart_benchmark`,
  `compute_personal_evolution` (tarjeta siempre visible, independiente
  del modo), `build_cargo_benchmark`/`build_cargo_benchmark_carga`/
  `build_cargo_limitado_benchmark` (comparación entre pares),
  `build_personal_from_audit_history`/`build_personal_from_work_history`
  (Benchmark Personal — Performance/Riesgo vía `AnalyticsAuditLog`,
  Cumplimiento/Carga vía tablas fuente, más preciso que muestrear
  auditoría).
- **`get_effective_role_target`** (`apps/configuration/services.py`) —
  objetivo esperado del cargo, configuración OPCIONAL (JSON en
  `SystemConfigHistory`, mismo mecanismo que las curvas de
  normalización) usada solo como referencia en modo "personal". `None`
  si el cargo nunca se configuró — nunca un objetivo inventado. Sin
  `set_role_target`/endpoint HTTP en esta sub-fase (Sprint O del
  Centro de Configuración sigue sin planificar en detalle).
- **`reliability_pct_from_observations`** (`apps/analytics/explain.py`)
  — deferida explícitamente desde la Fase 16, ahora portada.
- **Con esta entrega, 11 de las ~16 rutas delgadas de Analytics
  identificadas en la Fase 16 quedan cerradas** — restan `simulate`
  KPI-level, `diagnostics` y `recommendations/team`.
- **Sin cutover de `route.ts` todavía** — Next.js sigue sirviendo
  `/api/analytics/benchmarks` desde Postgres/Prisma.
- **Tests**: 32 nuevos (`apps/analytics/tests/test_benchmark.py`: 16,
  `test_benchmark_view.py`: 6, `apps/configuration/tests/test_role_target.py`:
  6, 4 casos agregados a `test_explain.py`) — 1270 pasando en total.
  `ruff check` limpio, sin migraciones nuevas.

## v1.80.0 — 2026-08-20

**Tipo:** FEATURE
**Módulo:** Migración de stack — Fase 21: Analytics, `kpis/executive` (`backend/apps/analytics/services.py`)

Veintiunava sub-fase — cierra el dashboard ejecutivo, la ruta de
Analytics deferida más grande (~326 líneas TS), confirmando que no
requería motor nuevo: todas sus dependencias (Performance Score,
Riesgo Operativo, clasificaciones, carga laboral por rango,
cumplimiento) ya estaban portadas.

- **`GET /api/v1/kpis/executive/`** (`ExecutiveDashboardView` +
  `build_executive_dashboard_payload`) — snapshot de 6 meses de los
  subordinados EJECUTORES del actor (`get_subordinate_executor_groups`,
  Fase 19), ranking por score con tendencia mes a mes, alertas de bajo
  cumplimiento/sobrecarga, ideas pendientes (`apps.ideas`, PROPUESTA/
  EN_REVISION) y un bloque "CEO": Performance Score/Riesgo Operativo
  PROMEDIO del equipo (nunca mezclados en un solo número — Sprint 5 §
  S5-K), estado global (verde/amarillo/rojo), heurísticas de "cambios"
  (mejoras/deterioros vs. mes anterior) y "atender" (top 3 candidatos
  priorizados por severidad). Gateado por `is_leadership`
  (`ROLE_LEVEL>=3`, ya existente) — DISTINTO del filtro
  `isExecutorRole` (`ROLE_LEVEL>=4`) aplicado a los SUJETOS del
  dashboard, mismo patrón de dos umbrales ya establecido en la Fase 19.
- **Cero lógica de negocio nueva** — compone `compute_performance_score`/
  `compute_operational_risk`/`classify_performance_score`/
  `classify_operational_risk`/`compute_workload_range`/
  `compute_workload_pct`/`compute_simple_score`/`compute_completed_pct_any`/
  `compute_estimated_vs_real_ratio`/`cumplimiento_color`/
  `monthly_business_base_for_users` (todas ya portadas en fases
  previas) en una sola tanda de queries por mes + loop en memoria,
  mismo patrón que `build_kpi_range_payload`/`TeamKpiView`.
- **Import diferido** de `operational_risk`/`performance_score` dentro
  de la función (no al tope del archivo) — ambos módulos importan de
  `history.py`, que a su vez importa `_month_bounds`/`_shift_month` de
  `services.py`: un import a nivel de módulo habría creado un ciclo
  real, mismo patrón ya documentado para `pipeline.py` en
  `build_analytics_bundle_payload` (Fase 4m).
- **Con esta entrega, las 16 rutas delgadas de Analytics identificadas
  en la Fase 16 quedan en 10 de 16 cerradas** — restan Benchmarks
  Inteligente, `simulate` KPI-level, `diagnostics` y
  `recommendations/team` (los 4 casos que requieren motor nuevo o
  instrumentación ausente, ya documentados en fases previas).
- **Sin cutover de `route.ts` todavía** — Next.js sigue sirviendo
  `/api/kpis/executive` desde Postgres/Prisma.
- **Tests**: 6 nuevos (`apps/analytics/tests/test_executive_dashboard_view.py`)
  — 1238 pasando en total. `ruff check` limpio, sin migraciones nuevas.

## v1.79.0 — 2026-08-20

**Tipo:** FEATURE
**Módulo:** Migración de stack — Fase 20: Analytics, `operational-risk/team` (`backend/apps/analytics/views.py`, `apps/notifications/models.py`)

Veinteava sub-fase — cierra la ruta de Riesgo Operativo de equipo,
deferida desde la Fase 17/19 por su efecto lateral de notificación
automática.

- **`GET /api/v1/analytics/operational-risk/team/`**
  (`TeamOperationalRiskView`) — Índice de Riesgo Operativo de los
  subordinados EJECUTORES (`get_subordinate_executor_groups`, Fase
  19), reutiliza `compute_operational_risk` (ya portada, Fase 4h) por
  colaborador. Gateado por `can_view_operational_risk` (Fase 16).
- **`notify_if_high_risk`** (`apps/analytics/services.py`) — cuando el
  riesgo de un subordinado es Alto/Crítico, notifica una vez por
  persona/mes a sus superiores directos
  (`get_notification_target_groups`, ya portado desde la Fase 1).
- **`Notification.dedup_key`** (nuevo campo, migración
  `0002_notification_dedup_key`) — el TS abusa de `taskId` (`String`
  en Prisma) como marcador de texto libre para deduplicar; en Django
  `task_id` es un `PositiveBigIntegerField` real desde la Fase 3f, no
  reutilizable para esto. `dedup_key` es la forma correcta de portar
  el mismo mecanismo de deduplicación sin sobrecargar `task_id`.
- **Gap documentado, no cerrado en esta fase**: el override
  configurable de destinos de notificación (`Ajustes → Reglas de
  Notificación`, `commentTargets` en `getNotificationRules()` del TS)
  no tiene equivalente en Django todavía — se usa el conjunto POR
  DEFECTO (`get_notification_target_groups`, idéntico a
  `NOTIFICATION_TARGETS`), correcto salvo que un Administrador haya
  reconfigurado los destinos desde Ajustes.
- **`recommendations/team` queda fuera de alcance** — depende de
  `computeTeamRecommendations` (motor de ~100 líneas: matriz de
  compatibilidad operativa configurable + algoritmo greedy de
  redistribución), no portado todavía — motor nuevo sustancial, no una
  ruta delgada.
- **Sin cutover de `route.ts` todavía** — Next.js sigue sirviendo
  `/api/analytics/operational-risk/team` desde Postgres/Prisma.
- **Tests**: 13 nuevos (`apps/analytics/tests/test_notify_if_high_risk.py`:
  8, `apps/analytics/tests/test_team_operational_risk_view.py`: 5) —
  1232 pasando en total. `ruff check` limpio.

## v1.78.0 — 2026-08-20

**Tipo:** FEATURE
**Módulo:** Migración de stack — Fase 19: Analytics, `kpis/team` + `kpis/team-capacity` (`backend/apps/analytics/views.py`, `apps/hierarchy/services.py`)

Diecinueveava sub-fase — cierra 2 de las 3 rutas de Analytics de
equipo deferidas en la Fase 18 por requerir un concepto de permiso
nuevo.

- **Nuevo `is_executor_group`/`get_subordinate_executor_groups`**
  (`apps/hierarchy/services.py`) — réplica de `isLeadershipRole`/
  `isExecutorRole`/`getSubordinateRoles(role).filter(isExecutorRole)`
  (`src/lib/roles.ts`, Sprint 0A): excluye roles cuyo `ROLE_LEVEL>=4`
  (JEFE_NACIONAL/ADMINISTRADOR — dirigen, no ejecutan). **Concepto
  deliberadamente DISTINTO de `is_leadership`** (ya existente,
  `ROLE_LEVEL>=3`, usado para visibilidad de proyectos) — mismo nombre
  conceptual, umbral y uso diferentes, documentado explícitamente para
  no confundirlos.
- **`GET /api/v1/kpis/team-capacity/`** (`TeamCapacityView`) —
  proyección de capacidad de los subordinados ejecutores, reutiliza
  `compute_team_capacity_forecast` (ya portada, Fase 9b).
- **`GET /api/v1/kpis/team/?month=YYYY-MM`** (`TeamKpiView`) —
  snapshot mensual de score/cumplimiento/carga/capacidad disponible
  por subordinado ejecutor, compone `monthly_business_base_for_users`/
  `compute_workload_range`/`compute_workload_pct`/`compute_simple_score`/
  `compute_completed_pct_any`/`compute_estimated_vs_real_ratio`/
  `cumplimiento_color` (todas ya portadas) en una sola tanda de
  queries — mismo patrón "1 sola tanda + loop en memoria" que
  `compute_team_capacity_forecast`.
- **`kpis/executive` queda deferida** — dashboard ejecutivo completo
  (~326 líneas TS: 6 meses de tendencia, ranking, bloque "CEO" con
  Performance Score/Riesgo Operativo promedio del equipo, alertas
  sintetizadas) es sustancialmente más grande que las 2 rutas de esta
  fase — motor nuevo propio, no una composición delgada.
- **Sin cutover de `route.ts` todavía** — Next.js sigue sirviendo
  `/api/kpis/team`/`/api/kpis/team-capacity` desde Postgres/Prisma.
- **Tests**: 14 nuevos (`apps/analytics/tests/test_team_kpi_views.py`:
  9, 5 casos agregados a `apps/hierarchy/tests/test_services.py`) —
  1219 pasando en total. `ruff check` limpio, sin migraciones nuevas.

## v1.77.0 — 2026-08-20

**Tipo:** FEATURE
**Módulo:** Migración de stack — Fase 18: Equipo, CRUD de solo lectura (nueva app `backend/apps/team/`)

Dieciochoava sub-fase — primer módulo de negocio nuevo desde
Notificaciones (Fase 15), sin dependencia del motor de Analytics.
Porta las 2 rutas del módulo "Equipo" (`ARCHITECTURE.md` §5): lista de
subordinados y detalle de tareas de un subordinado puntual.

- **`GET /api/v1/team/`** (`TeamListView`) — lista de subordinados
  visibles (`get_subordinate_groups`, sin filtro de rol ejecutor/
  liderazgo — a diferencia de las rutas de Analytics de equipo, que
  quedan para una fase futura) con conteo de tareas por estado y email
  enmascarado.
- **`GET /api/v1/team/<user_id>/tasks/`** (`TeamMemberTasksView`) —
  tareas activas (no archivadas) de un subordinado puntual, con la
  misma proyección de campos que tenía `/api/tasks` antes de su
  cutover (Fase 3a) — esta ruta nunca se migró en esa fase porque
  Django solo expone las tareas del propio usuario autenticado.
  Orden de chequeos réplica exacta del `route.ts`: 401→403
  (`can_view_team`)→404(usuario)→403(rol no subordinado)→200.
- **Nuevo `mask_email`** (`apps/core/mask_email.py`) — puerto de
  `maskEmail` (`src/lib/mask-email.ts`), primer consumidor
  `TeamListView`. **Asimetría fiel al TS, no "corregida"**: el email
  del asignado en `GET /team/<id>/tasks/` va SIN enmascarar (el TS
  nunca lo enmascara ahí — quien ve esa lista ya es su superior
  directo), a diferencia de `GET /team/` que sí enmascara.
- **Hallazgo documentado, fuera de alcance**: `Proyectos` (ya cortado
  a Django desde la Fase 5) usa `maskEmailUnless` en el TS pero su
  `ProjectViewSet`/`ProjectSerializer` en Django NUNCA enmascaran el
  email — gap preexistente en un módulo ya en producción, detectado al
  portar `mask_email` pero fuera de alcance de esta fase (no se pidió,
  tocaría un módulo ya cortado).
- **Sin cutover de `route.ts` todavía** — Next.js sigue sirviendo
  `/api/team`/`/api/team/[userId]/tasks` desde Postgres/Prisma.
- **Tests**: 17 nuevos (`apps/team/tests/test_team_views.py`: 10,
  `apps/core/tests/test_mask_email.py`: 7) — 1205 pasando en total.
  `ruff check` limpio, sin migraciones (módulo sin modelos propios).

## v1.76.0 — 2026-08-20

**Tipo:** FEATURE
**Módulo:** Migración de stack — Fase 17: Analytics, 3 rutas delgadas más (`backend/apps/analytics/views.py`)

Diecisieteava sub-fase — continúa el cierre de las rutas delgadas de
Analytics iniciado en la Fase 16. De las 13 rutas restantes, se
identificaron 3 más como composición pura sobre motor ya portado.

- **`GET /api/v1/analytics/history/<user_id>/?kind=<kind>&months=<n>`**
  (`HistoryView`) — histórico de evolución con selector de período,
  lectura pura sobre `AnalyticsAuditLog` vía `get_score_series`
  (`audit_history.py`, ya portada desde la Fase 4j/9). `kind` valida
  contra `{performance_score, operational_risk, health_score}`
  (default `performance_score`), `months` contra `{1, 3, 6, 12}`
  (default 3) — cualquier valor inválido cae al default, réplica
  exacta del `route.ts`.
- **`GET /api/v1/analytics/target-time/<user_id>/`**
  (`TargetTimePrecisionView`) — precisión promedio del Tiempo Objetivo
  del mes en curso (Sprint 6 S6-F). `compute_target_time_precision`
  (`scoring.py`) ya estaba portada desde la Fase 4d sin consumidor
  HTTP hasta ahora — cero lógica nueva.
- **`GET /api/v1/analytics/data-quality/?scope=self|team`**
  (`DataQualityView`) — calidad de los datos usados por Analytics.
  `scope=self` (default): cualquier usuario sobre sus propios datos.
  `scope=team`: gateado por `can_view_team`, reutiliza `get_team_members`
  (mismo conjunto que `TeamPreventiveAlertsView`/
  `TeamSubutilizationView`, Fase 9b) — sin duplicar la resolución de
  subordinados.
- **Deferidos explícitamente, con motivo documentado**: `diagnostics`
  (depende de contadores en memoria del proceso — `cacheHits`/
  `cacheMisses`/`totalComputeMs`/`validationsRun` — instrumentación
  nunca portada a Django, no solo routing faltante) y
  `simulate/<user_id>` (simulador de 8 escenarios interactivos, ~280
  líneas de lógica de recombinación de factores — motor sustancial
  nuevo, no una ruta delgada, mismo criterio que separó Benchmarks en
  la Fase 16).
- **Sin cutover de `route.ts` todavía** — Next.js sigue sirviendo estas
  3 rutas desde Postgres/Prisma.
- **Tests**: 14 nuevos (agregados a
  `apps/analytics/tests/test_thin_analytics_views.py`) — 1188 pasando
  en total. `ruff check` limpio, sin migraciones nuevas.

## v1.75.0 — 2026-08-20

**Tipo:** FEATURE
**Módulo:** Migración de stack — Fase 16: Analytics, 3 rutas delgadas individuales (`backend/apps/analytics/views.py`)

Dieciseisava sub-fase — primeras 3 de las ~10 rutas delgadas de
Analytics identificadas como deuda explícita en el ROADMAP
("`/insights/[userId]`, `/equilibrio/[userId]`, `/operational-risk/
[userId]`, `/benchmarks/[userId]`, `/history/[userId]`, `/target-time/
[userId]`, `/simulate/[userId]`, y las variantes `/team`"). Se acotó el
alcance a las 3 que son composición pura sobre motor YA portado —
`Benchmarks Inteligente` requiere portar `computeSmartBenchmark`/
`computePersonalEvolution` (motor nuevo, no solo routing) y queda
deferido a una sub-fase propia.

- **`GET /api/v1/analytics/insights/<user_id>/`** (`InsightsView`) —
  Motor de Insights (Decision Intelligence Engine, Sprint 6): compone
  `run_analytics_pipeline` + `compute_operational_risk` +
  `compute_monthly_history` + `compute_capacity_forecast`, ya
  portados, con `compute_insights`/`compute_indicator_relations`/
  `compute_personal_benchmark`/`compute_recommendation_reevaluation`/
  `prioritize_insights`/`get_score_trend_explanation`
  (`insights_engine.py`, puerto completo desde la Fase 4j/4k) — cero
  lógica de negocio nueva, solo ensamblado.
- **`GET /api/v1/analytics/equilibrio/<user_id>/`** (`EquilibrioView`)
  — capa de interpretación del Equilibrio Operativo (estado/
  tendencia/dimensiones explicadas/fortalezas/oportunidades/
  confianza), nunca recalcula `compute_health_score`.
- **`GET /api/v1/analytics/operational-risk/<user_id>/`**
  (`OperationalRiskView`) — Índice de Riesgo Operativo individual +
  confianza/tendencia de presentación, nunca recalcula
  `compute_operational_risk`. Gateado por `can_view_operational_risk`
  (nuevo whitelist de roles puntual en `apps/analytics/permissions.py`
  — gerencia, nunca nivel 1, mismo patrón que `can_create_meetings` de
  Reuniones), chequeado ANTES de buscar al usuario objetivo — réplica
  exacta del orden 403→404→403 del `route.ts`.
- **Nueva función portada**: `reliability_pct_from_stars`
  (`apps/analytics/explain.py`) — puerto puntual de
  `reliabilityPctFromStars` (`src/lib/analyticsExplain.ts`), usada por
  Equilibrio/Riesgo Operativo para traducir estrellas de confiabilidad
  de la consistencia a un porcentaje de presentación.
- **Sin cutover de `route.ts` todavía** — Next.js sigue sirviendo
  `/api/analytics/insights`/`/equilibrio`/`/operational-risk` desde
  Postgres/Prisma. Mismo gap ya aceptado desde `AnalyticsBundleView`
  (Fase 4m): sin capa de caché con TTL — se calcula en vivo en cada
  request (`cache_active: false`).
- **Tests**: 32 nuevos (`apps/analytics/tests/test_thin_analytics_views.py`:
  17, `test_analytics_permissions.py`: 11, 4 casos agregados a
  `test_explain.py`) — 1174 pasando en total. `ruff check` limpio, sin
  migraciones nuevas.

## v1.74.0 — 2026-08-20

**Tipo:** FEATURE
**Módulo:** Migración de stack — Fase 15: Notificaciones, superficie HTTP (`backend/apps/notifications/views.py`)

Quinceava sub-fase — cierre de un gap documentado explícitamente desde
la Fase 3f (v1.35.0, 2026-08-11): `apps.notifications` ya existía
(modelo `Notification` + `notify()`/`notify_many()`, consumido
internamente por Tareas/Proyectos/Escritorio Digital/Reuniones/Ideas/
LOPD) pero nunca había ganado endpoints HTTP propios de lectura/
gestión.

- **`GET /api/v1/notifications/`** (`NotificationListView`) — réplica
  exacta de `route.ts`: las 20 notificaciones más recientes del usuario
  + `unread_count`. Como `Notification.task_id` NO es una FK real
  (sobrevive al borrado de la tarea, decisión de la Fase 3f), se
  resuelve aparte el dueño ACTUAL de cada tarea referenciada
  (`task_assigned_to_id`) para que el cliente sepa a dónde navegar —
  `None` si la tarea ya no existe o si la notificación no tiene
  `task_id`.
- **`PATCH /api/v1/notifications/`** (misma vista) — marca TODAS las
  notificaciones no leídas del usuario como leídas.
- **`PATCH /api/v1/notifications/<id>/`** (`NotificationDetailView`) —
  marca UNA notificación como leída. Réplica fiel del `updateMany`
  scopeado a `id`+`userId` del TS: si el id no existe o pertenece a
  otro usuario, no hace nada y de todas formas responde `{ok: true}`
  — sin 404/403, comportamiento silencioso replicado tal cual, no
  "corregido".
- **Sin cutover de `route.ts` todavía** — Next.js sigue sirviendo
  `/api/notifications`/`/api/notifications/[id]` desde Postgres/Prisma
  (alimentado también por módulos todavía no migrados a Django, ej.
  Nova/Dashboard — cortarlo mostraría una lista incompleta a usuarios
  reales).
- **Tests**: 13 nuevos (`apps/notifications/tests/test_notification_views.py`)
  — 1142 pasando en total. `ruff check` limpio, sin migraciones nuevas
  (el modelo `Notification` no cambió, solo `views.py`/`urls.py`).

## v1.73.0 — 2026-08-20

**Tipo:** FEATURE
**Módulo:** Migración de stack — Fase 14: Papelera transversal / Centro de Recuperación (nueva app `backend/apps/recovery/`, integración en `apps.projects`/`apps.desk`)

Catorceava sub-fase — puerto del Centro de Recuperación (`src/lib/
recoveryCenter.ts`), el motor de "papelera" transversal que ya usaban
Proyectos y Notas de Escritorio Digital, más el mecanismo
independiente de purga de archivo de notas (`src/lib/
deskNoteRetention.ts`), gap documentado desde la Fase 7g.

- **`RecoveryItem`/`RecoveryAuditLog`** (nuevos modelos) + `ENTITY_REGISTRY`
  (`apps/recovery/services.py`) — puerto directo del patrón TS
  `Record<string, EntityAdapter>`: un `dataclass` `EntityAdapter`
  (`module_label`/`get_display_name`/`set_trashed`/`hard_delete`) por
  tipo de entidad, registrado en un dict abierto/cerrado — agregar un
  módulo nuevo a la papelera no requiere tocar `move_to_trash`/
  `restore`/`delete_permanently`/`purge_expired_items`, solo sumar una
  entrada al registro. Adaptadores `PROJECT`/`DESK_NOTE` registrados
  esta fase, con imports diferidos (`from apps.projects.models import
  Project` dentro de cada función) para evitar dependencia circular en
  tiempo de carga con `apps.projects`/`apps.desk` (que a su vez
  importan `apps.recovery.services` de forma diferida dentro de sus
  propios métodos de servicio).
- **Asimetría deliberada, fiel al TS** (decisión explícita del
  usuario): Proyectos porta el flujo completo — `GET /api/v1/projects
  /trash/`, `POST /api/v1/projects/<id>/restore/`, `DELETE /api/v1/
  projects/<id>/permanent/` — mientras que Notas de Escritorio Digital
  SOLO obtiene `DELETE /api/v1/desk-notes/<id>/` (mover a la papelera).
  No existen endpoints de restaurar/listar/eliminar-definitivo para
  notas — tampoco existían en el TS ni en su frontend.
- **`DeskNoteViewSet.destroy`** — réplica de la doble vía de
  `route.ts`: el remitente mueve la nota a la papelera
  (`RecoveryItem`); el destinatario solo puede eliminarla
  definitivamente si ya estaba archivada (409 si no); cualquier otro
  usuario recibe 403.
- **Segundo mecanismo de purga, confirmado independiente** (decisión
  explícita del usuario, incluido en esta misma fase): `purge_expired
  _archived_notes()` (`apps/desk/services.py`) — borra notas
  archivadas hace 15+ días, sin pasar por `RecoveryItem`, disparado de
  forma perezosa desde `DeskNoteViewSet.list()` (mismo trigger que
  tenía el `route.ts` original). No comparte código ni tabla con
  `purge_expired_items()` (Centro de Recuperación).
- **Acoplamiento incidental entre módulos, replicado tal cual**:
  `purge_expired_items()` no filtra por `entity_type` — abrir la
  papelera de Proyectos también purga los ítems vencidos de Notas de
  Escritorio Digital (y viceversa). Es un comportamiento real del TS,
  no un bug — se portó fielmente, no se "corrigió".
- **Orden manual de códigos de estado** (mismo patrón ya usado en
  Reuniones/Ideas/LOPD): `restore`/`permanent` de Proyectos y
  `destroy` de Notas NO usan el pipeline automático de `get_permissions
  `/`has_object_permission` de DRF (que resolvería 404→403, sin lugar
  para un 409 intermedio) — hacen los chequeos 404→409→403 a mano y en
  secuencia dentro del cuerpo de la vista, para igualar el orden exacto
  del `route.ts` original.
- **`RecoveryItem.deleted_at` es un `DateTimeField` plano, sin
  `auto_now_add`** — se asigna explícitamente en `move_to_trash` con la
  MISMA instancia de `timezone.now()` usada para calcular `expires_at`,
  evitando el desfase de milisegundos que introduciría llamar a `now()`
  dos veces por separado.
- **Dos claves de configuración nuevas** (`apps.configuration.services`,
  mismo patrón time-aware ya establecido): `recovery_center_retention_hours`
  (default 48h, única para toda la plataforma) y
  `desk_archive_retention_days` (default 15 días).
- **Sin cutover de `route.ts` todavía** — Next.js sigue sirviendo
  `/api/projects/trash`/`/api/projects/[id]/restore`/`/api/projects/
  [id]/permanent`/`/api/desk-notes/[id]` desde Postgres/Prisma.
- **Tests**: 38 nuevos (`apps/recovery/tests/test_recovery_services.py`:
  16, `apps/projects/tests/test_project_trash.py`: 13,
  `apps/desk/tests/test_desk_note_trash.py`: 9) — 1129 pasando en
  total. `ruff check` limpio, `makemigrations --check --dry-run` sin
  cambios pendientes.

## v1.72.0 — 2026-08-19

**Tipo:** FEATURE
**Módulo:** Migración de stack — Fase 13: Centro de Configuración, arranque acotado (`backend/apps/configuration/views.py`, gate de consentimiento en `apps.authentication`/`apps.users`)

Treceava sub-fase — no un módulo nuevo, sino el cierre de 2 cabos
sueltos deferidos en fases previas (Fase 9c: `prediction-window`; Fase
12: gate de consentimiento), ambos apuntando al mismo lugar del
ROADMAP (Centro de Configuración, punto 9). Primera superficie HTTP de
`apps.configuration` (hasta ahora 100% servicios internos).

- **`GET/PUT /api/v1/settings/prediction-window/`**
  (`PredictionWindowSettingsView`) — réplica exacta de `route.ts`.
  `GET` sin rol especial; `PUT` solo Administrador. Gap documentado:
  no hay caché de Analytics que invalidar en Django (mismo gap ya
  aceptado desde la Fase 9a).
- **Gate de consentimiento** — se agregan `data_consent_accepted`/
  `data_consent_accepted_at` a `apps.users.models.User` (primera
  migración a este modelo compartido desde su creación). `PATCH
  /api/v1/auth/consent/` (`AcceptConsentView`, auto-servicio) +
  `POST /api/v1/admin/users/<id>/reset-consent/` +
  `POST /api/v1/admin/users/reset-consent-all/`, agregados como
  `@action` nuevas de `UserAdminViewSet` (ya existente).
- **Decisión de autorización con dos criterios distintos, a
  propósito**: `reset-consent` (por usuario) reutiliza el catálogo de
  permisos ya establecido (`UsuariosPermission`, `usuarios.editar`) —
  el chequeo `canManageUsers`+`canManageTargetUser` del TS ya fue
  superado en este backend por ese catálogo (mismo criterio que
  `roles`/`permissions`, acciones hermanas del mismo viewset).
  `reset-consent-all` (masivo, irreversible) SÍ replica el chequeo
  estricto y literal del TS (`IsAdministrator`, solo rol
  ADMINISTRADOR) en vez del catálogo — es la única acción de todo el
  viewset que exige el rol en vez de un permiso, documentado
  explícitamente como decisión consciente.
- **Bug real encontrado y corregido durante el desarrollo** (no solo
  en tests): `AuditLog.previous_values`/`new_values` son `JSONField`
  SIN `encoder=DjangoJSONEncoder` — pasar un `datetime` crudo ahí
  crashea la serialización a JSON del driver mssql (`TypeError: Object
  of type datetime is not JSON serializable`). `UserAdminService.
  reset_consent` ahora convierte `data_consent_accepted_at` a ISO
  string antes de auditar; ningún otro método de `UserAdminService`
  había pasado un `datetime` crudo antes, así que el bug no se había
  manifestado hasta esta fase.
- **Sin cutover de `route.ts` todavía** — Next.js sigue sirviendo
  `/api/settings/prediction-window`/`/api/auth/consent`/
  `/api/users/**/reset-consent**` desde Postgres/Prisma.
- **Tests**: 13 nuevos (`apps/configuration/tests/test_prediction_window_view.py`,
  `apps/authentication/tests/test_consent.py`, 4 casos agregados a
  `apps/users/tests/test_admin_users.py`) — 1091 pasando en total.
  `ruff check` limpio.

## v1.71.0 — 2026-08-19

**Tipo:** FEATURE
**Módulo:** Migración de stack — Fase 12: Solicitudes LOPD (nueva app `backend/apps/data_requests/`)

Doceavo módulo portado a Django. A diferencia de Reuniones/Mejora
Continua, el ROADMAP marcaba este módulo como "sensible legalmente,
revisión propia" — se investigó exhaustivamente el alcance legal/de
riesgo antes de escribir código (contenido de `docs/RAT.md`/
`docs/PENDIENTES_LEGALES.md`, si había borrado real automatizado) y se
confirmó una conversación de alcance explícita con el usuario antes de
implementar.

- **Hallazgo clave**: NO existe ningún borrado o anonimización real de
  datos de un titular automatizado por código — `type=ELIMINACION`
  solo crea un registro `PENDIENTE` que un Administrador gestiona
  100% manualmente fuera del sistema, confirmado contra `docs/RAT.md`
  ("no hay borrado automático inmediato"). El riesgo técnico de portar
  este módulo es equivalente al de un CRUD de tickets — el riesgo real
  es de fidelidad de contenido (textos legales), no de arquitectura.
- **`DataSubjectRequest`** (nuevo modelo, réplica exacta de
  `prisma/schema.prisma`) — tipos ACCESO/RECTIFICACION/ELIMINACION,
  estados PENDIENTE/EN_PROCESO/RESUELTA.
- **`export_my_data`** (`apps/data_requests/services.py`) — reúne los
  datos operativos del titular ya portados en fases previas (Tareas,
  Actividades, Comentarios, Reuniones, Ideas, Votos, solicitudes
  previas) en un export JSON descargable, y registra la exportación
  como una solicitud ACCESO ya resuelta (trazabilidad, sin gestión
  manual). Gap documentado: el `user` exportado por el TS también
  incluye `theme`/`viewPreferences`/`badges`/`dataConsentAccepted`/
  `dataConsentAcceptedAt` — ninguno de esos campos existe todavía en
  el modelo `User` de Django (gaps ya documentados en Fases 6b/11); se
  omiten del export en vez de fabricar valores falsos.
- **Alcance de esta sub-fase, decisión explícita del usuario**: solo
  `DataSubjectRequest` (crear/listar/resolver + exportar "mis datos").
  El gate de consentimiento (`User.dataConsentAccepted`/
  `dataConsentAcceptedAt`, `PATCH /api/auth/consent`, reset individual/
  masivo) es un mecanismo distinto — bloquea el render de toda la app,
  no una cola de tickets — y queda deferido a una sub-fase futura, sin
  campos agregados al modelo `User` compartido.
- **HTTP**: `GET/POST /api/v1/data-requests/` (`DataRequestListCreateView`
  — lista todas si Administrador, solo propias si no; crear no requiere
  rol especial), `PATCH /api/v1/data-requests/<request_id>/`
  (`DataRequestDetailView`, solo Administrador) y
  `GET /api/v1/data-requests/my-data/` (`MyDataExportView`, descarga
  JSON con `Content-Disposition: attachment`). La respuesta de `POST`
  replica fielmente ser "más plana" que la de `GET`/`PATCH` (el
  `create()` original no usa `include` de Prisma — sin objetos
  `user`/`resolver` anidados, solo IDs crudos).
- **Sin cutover de `route.ts` todavía** — Next.js sigue sirviendo
  `/api/data-requests/**` desde Postgres/Prisma.
- **Tests**: 27 nuevos (`apps/data_requests/tests/`: permisos,
  servicios, vistas HTTP) — 1078 pasando en total. `ruff check` limpio.

## v1.70.0 — 2026-08-19

**Tipo:** FEATURE
**Módulo:** Migración de stack — Fase 11: Mejora Continua (nueva app `backend/apps/ideas/`)

Onceavo módulo portado a Django tras cerrar Reuniones. Investigar
reveló un módulo puramente CRUD + votos + máquina de estados +
notificaciones internas (~461 líneas backend puro), sin integraciones
externas — pero con más superficie de reglas de negocio que Reuniones
(regla de visibilidad no estándar, ciclo de vida del adjunto ligado al
estado, asimetría de permisos entre rutas).

- **`ImprovementIdea`/`IdeaVote`/`IdeaStatusHistory`** (nuevos
  modelos, réplica exacta de `prisma/schema.prisma`). `attachmentUrl`
  se renombra a `attachment_name` (es el nombre del archivo, no una
  URL — mismo criterio ya usado en `DeskNote`); `attachment_mime` es un
  campo nuevo (el mime vive embebido en el data: URL de
  `attachmentData` en el Prisma original), mismo patrón que `DeskNote`.
- **`get_visible_idea_author_ids`** (`apps/ideas/services.py`) —
  réplica exacta de `getVisibleIdeaAuthorIds`: Mejora Continua es una
  EXCEPCIÓN documentada a la jerarquía general — Jefe Nacional y
  Coordinador Nacional ven todas las ideas de todos los usuarios
  (excepto el Administrador, siempre invisible), a diferencia de
  KPIs/Analytics/Informes. Cubre además un caso que el TS no necesita
  cubrir (ahí `role` es un único campo enum): un superusuario Django
  sin ningún `Group` asignado debe verse como "ADMINISTRADOR" igual
  que el resto del backend.
- **Voto binario con toggle** — 1 voto por `(idea, usuario)`, sin
  restricción de rol; el conteo NUNCA se desnormaliza, se calcula
  on-the-fly (`IdeaVote.objects.filter(idea=idea).count()`), réplica
  exacta del TS.
- **Máquina de estados** (`next_idea_status`/`prev_idea_status`/
  `can_reject`) — 6 pasos lineales (Propuesta→En revisión→Aprobada→En
  desarrollo→En pruebas→Implementada) + Rechazada como estado lateral
  alcanzable desde cualquiera salvo Implementada, + Reabrir (solo desde
  Rechazada, vuelve a En revisión). Cada transición crea un
  `IdeaStatusHistory` y notifica al autor (salvo que el autor sea quien
  hizo el cambio).
- **Ciclo de vida del adjunto ligado al estado** — se enmascara
  (`None`) en la respuesta de `GET /ideas/<id>/` cuando el estado ya no
  es Propuesta, Y se purga de la base de datos al salir de Propuesta
  vía cualquier transición de `/status` — doble mecanismo, réplica
  fiel del TS.
- **Asimetría real replicada, no corregida**: `PATCH /ideas/<id>/status/`
  es la única ruta de detalle que NO filtra por visibilidad del autor
  (solo exige `can_review_ideas`) — a diferencia de `GET`/`PATCH`
  (progreso)/`vote`/`history`, que sí filtran. Documentado como
  hallazgo del TS original, no como bug a corregir en este puerto.
- **Gap documentado**: el badge "innovador" (`User.badges`,
  gamificación transversal sin campo equivalente en Django) NO se
  asigna cuando una idea llega a Implementada — se omitió agregar el
  campo al modelo `User` (compartido por todo el backend) por una
  única funcionalidad puntual.
- **Sin cutover de `route.ts` todavía** — Next.js sigue sirviendo
  `/api/ideas/**` desde Postgres/Prisma.
- **Tests**: 57 nuevos (`apps/ideas/tests/`: permisos, servicios
  —visibilidad/máquina de estados/notificaciones/votos—, vistas HTTP)
  — 1051 pasando en total. `ruff check` limpio.

## v1.69.0 — 2026-08-19

**Tipo:** FEATURE
**Módulo:** Migración de stack — Fase 10: Reuniones (nueva app `backend/apps/meetings/`)

Décimo módulo portado a Django tras cerrar Inteligencia Preventiva.
Investigar reveló que el alcance real es acotado (~307 líneas entre los
2 `route.ts` + `src/lib/zoom.ts`): Zoom tiene una integración HTTP real
(OAuth Server-to-Server) que replicar con su fallback simulado, pero
Otter.ai NO tiene ninguna integración de API — es 100% edición manual
de 3 campos, confirmado exhaustivamente contra el código y el propio
README del proyecto.

- **`Meeting`/`MeetingInvitee`** (nuevos modelos, réplica exacta de
  `prisma/schema.prisma`) — `MeetingInvitee.attended` se porta fiel al
  esquema aunque no tiene ningún endpoint/UI que lo lea o escriba en
  el TS actual (campo "muerto" heredado, no se le agrega
  funcionalidad no solicitada).
- **`apps/meetings/zoom.py`** — réplica exacta de `src/lib/zoom.ts`:
  `create_zoom_meeting` (OAuth Server-to-Server + creación de la
  reunión). Primera llamada HTTP saliente del backend Django — se
  agrega `requests` a `requirements/base.txt` (sin precedente previo
  que copiar: NOVA/Groq nunca se portaron).
- **`apps/meetings/services.create_meeting`** — réplica exacta del
  handler `POST /api/meetings`: si Zoom falla (credenciales ausentes,
  timeout, error HTTP) genera un enlace/ID/contraseña simulados y
  responde con `zoom_warning`, igual que el TS. La duración enviada a
  Zoom es fija (40 min), independiente de la duración real de la
  reunión — réplica fiel de un detalle del legacy, no un bug a
  corregir. Notifica a los invitados reutilizando el campo
  `task_title` de `Notification` (heredado de Tareas) para guardar el
  título de la reunión, igual que hace el TS.
- **`can_create_meetings`** (`apps/meetings/permissions.py`) —
  whitelist puntual de 4 roles (ADMINISTRADOR/JEFE_NACIONAL/
  COORDINADOR_NACIONAL/COORDINADOR_ZS), NO un umbral de `role_level`:
  Coordinador ZS comparte nivel 2 con Analista CC/Selección en
  `apps.hierarchy.services.ROLE_LEVEL`, pero solo Coordinador ZS crea
  reuniones.
- **HTTP**: `GET/POST /api/v1/meetings/` (`MeetingListCreateView` —
  lista reuniones donde el actor es anfitrión o invitado, sin
  excepción para Administrador) y `GET/PATCH/DELETE /api/v1/meetings/
  <meeting_id>/` (`MeetingDetailView` — editar/eliminar solo el
  anfitrión, whitelist estricta de 8 campos editables por `PATCH`,
  réplica exacta de la whitelist `allowed` del `route.ts`).
- **Sin cutover de `route.ts` todavía** — Next.js sigue sirviendo
  `/api/meetings/**` desde Postgres/Prisma.
- **Tests**: 43 nuevos (`apps/meetings/tests/`: permisos, Zoom
  mockeado, servicio de creación, vistas HTTP) — 994 pasando en
  total. `ruff check` limpio.

## v1.68.0 — 2026-08-18

**Tipo:** FEATURE
**Módulo:** Migración de stack — Fase 9c: Inteligencia Preventiva — Simulador (`backend/apps/analytics/simulate_engine.py`, `backend/apps/analytics/serializers.py`)

Cierra Inteligencia Preventiva casi por completo, salvo el endpoint
admin de configuración de ventana (que pertenece a un futuro "Centro
de Configuración"). Los 3 escenarios "qué pasaría si" (`simulate/*`)
reutilizan por completo funciones puras ya portadas en fases previas
(`compute_capacity_forecast`/`compute_team_capacity_forecast`/
`classify_capacity`/`capacity_to_score`/`weighted_points`/
`compute_health_score`/`get_official_target_time`) — nunca persisten
los valores simulados.

- **`simulate_engine.py`** (nuevo) — `simulate_adjust_target_time`
  (nivel tarea: recalcula capacidad + Equilibrio Operativo si se
  cambiara el tiempo objetivo de una tarea), `simulate_add_participants`
  (nivel proyecto: recalcula el promedio de horas restantes por
  participante) y `simulate_redistribute_load` (bi-usuario: mueve horas
  comprometidas de un colaborador a otro), réplica exacta de los 3
  `route.ts` de `/api/predictive/simulate/**`.
- **`serializers.py`** (nuevo) — primeros serializers de entrada de
  `apps.analytics` (el resto del app era de solo lectura hasta ahora):
  `AdjustTargetTimeSimulationSerializer`/
  `AddParticipantsSimulationSerializer`/
  `RedistributeLoadSimulationSerializer`, réplica de las validaciones
  inline de cada `route.ts` (rangos numéricos, `from_user_id` ≠
  `to_user_id`).
- **HTTP**: `POST /api/v1/predictive/simulate/<user_id>/`
  (`SimulateAdjustTargetTimeView`, visibilidad jerárquica individual +
  la tarea debe pertenecer al usuario y estar Pendiente/En Progreso),
  `POST /api/v1/predictive/simulate/project/<project_id>/`
  (`SimulateAddParticipantsView`, gateada por `can_view_project`) y
  `POST /api/v1/predictive/simulate/redistribute/`
  (`SimulateRedistributeLoadView`, ambos usuarios deben ser visibles
  para el actor — nuevo helper `_can_view_target_user`, extraído de
  `_check_target_visibility` para reusarse en el chequeo bi-usuario).
- **Deferido a una sub-fase futura**: `GET/PUT /settings/prediction-window`
  (config ya portada desde la Fase 9a, falta la primera superficie
  HTTP de `apps.configuration` — pertenece más a "Centro de
  Configuración", punto 9 del ROADMAP, que a este módulo).
- **Sin cutover de `route.ts` todavía** — Next.js sigue sirviendo
  `/api/predictive/simulate/**` desde Postgres/Prisma.
- **Tests**: 24 nuevos (`test_simulate_engine.py`,
  `test_simulate_views.py`) — 951 pasando en total. `ruff check`
  limpio, sin migraciones nuevas (sin modelos nuevos).

## v1.67.0 — 2026-08-18

**Tipo:** FEATURE
**Módulo:** Migración de stack — Fase 9b: Inteligencia Preventiva — Alertas Preventivas + wiring de equipo (`backend/apps/analytics/preventive_intelligence.py`, `backend/apps/hierarchy/services.py`)

Cierra casi por completo Inteligencia Preventiva tras la Fase 9a
(Trend/Prediction Engine). Investigar el resto de las 7 rutas de
`/api/predictive/**` reveló que 4 son solo lectura sobre funciones que
ya existían al terminar la Fase 9a (`compute_subutilizacion_predictions`/
`compute_project_delay_prediction`, portadas pero sin endpoint propio) —
el único código nuevo genuino es `preventiveIntelligence.ts`
(144 líneas, compone las 4 predicciones en alertas priorizadas) y el
wiring de "equipo visible" que las rutas `team-*` necesitan.

- **`preventive_intelligence.py`** (nuevo) — réplica exacta de
  `preventiveIntelligence.ts`: `compute_preventive_alerts` (individual:
  Sobrecarga/Cumplimiento en caída/Subutilización/Estabilidad Operativa,
  con severidad `roja/naranja/amarilla/verde` y orden estable
  descendente) y `compute_team_preventive_alerts` (equipo: batch de
  Subutilización + Retrasos de proyecto).
- **`ROLE_LEVEL`/`role_level`/`is_leadership`/`can_view_team`/
  `get_subordinate_groups` centralizados en `apps/hierarchy/services.py`**
  — vivían duplicados en `apps/projects/permissions.py` (única copia,
  con su propio docstring anticipando "se generaliza cuando aparezca un
  segundo consumidor real"): `team-alerts`/`team-subutilization` son ese
  segundo consumidor. `apps.projects.permissions` re-exporta
  `role_level`/`is_leadership` para no romper imports existentes — sus
  12 tests siguen en verde sin cambios.
- **`get_team_members`/`get_visible_team_project_ids`** (nuevos en
  `apps/analytics/services.py`) — enumeran los subordinados visibles de
  un líder y los proyectos activos visibles para un escaneo de equipo
  (liderazgo nivel ≥3 ve todos; el resto solo los propios), réplica del
  filtro inline de `team-alerts/route.ts`.
- **HTTP**: `GET /api/v1/predictive/alerts/<user_id>/`
  (`PreventiveAlertsView`, visibilidad jerárquica individual),
  `GET /api/v1/predictive/team-alerts/` y
  `GET /api/v1/predictive/team-subutilization/`
  (`TeamPreventiveAlertsView`/`TeamSubutilizationView`, gateadas por
  `can_view_team`, nivel ≥2) y
  `GET /api/v1/predictive/project-delay/<project_id>/`
  (`ProjectDelayView`, gateada por `can_view_project` — mismo permiso
  que el detalle del proyecto, no visibilidad jerárquica de usuario).
- **Deferido a una sub-fase futura**: `simulate/*` (3 endpoints,
  calculadoras puras "qué pasaría si" que nunca persisten) y
  `GET/PUT /settings/prediction-window` (endpoint admin — la config ya
  está portada desde la Fase 9a, falta la primera superficie HTTP de
  `apps.configuration`, que pertenece más a "Centro de Configuración",
  punto 9 del ROADMAP, que a Inteligencia Preventiva).
- **Sin cutover de `route.ts` todavía** — Next.js sigue sirviendo
  `/api/predictive/**` desde Postgres/Prisma.
- **Tests**: 31 nuevos (`test_preventive_intelligence.py`,
  `test_services.py` en `apps.hierarchy`, más los agregados a
  `test_predictive_views.py`) — 927 pasando en total. `ruff check`
  limpio, sin migraciones nuevas.

## v1.66.0 — 2026-08-18

**Tipo:** FEATURE
**Módulo:** Migración de stack — Fase 9a: Inteligencia Preventiva — Trend Engine + predicciones explicables individuales (`backend/apps/analytics/trend_engine.py`, `backend/apps/analytics/prediction_engine.py`)

Noveno módulo portado a Django tras cerrar Reportes Ejecutivos.
Investigar reveló que 5 de las 6 funciones de Analytics que el motor
predictivo necesita ya existen en Django (`compute_weekly_history`,
`compute_consistency`, `compute_data_quality`, `compute_capacity_forecast`/
`compute_team_capacity_forecast`) — el único código nuevo genuino es el
clasificador OLS del Trend Engine (`trend_engine.py`, sin equivalente
portado hasta ahora) y las reglas determinísticas del Prediction Engine
(`prediction_engine.py`), ambos consumidores puros de solo lectura sobre
ese motor ya existente, nunca recalculan un KPI ni usan IA.

- **`trend_engine.py`** — réplica exacta de `src/lib/trendEngine.ts`:
  `classify_trend_direction` (regresión lineal + coeficiente de
  variación de RESIDUOS, con corte especial para "cambio_brusco" cuando
  el último punto rompe el patrón de los anteriores) y
  `compute_trend_engine`, que clasifica 8 indicadores (Cumplimiento,
  Productividad, Horas registradas, Consistencia Operativa, Capacidad
  Disponible, Equilibrio Operativo, Proyectos, Actividades).
  "Proyectos"/"Actividades" siempre tienen `window_weeks` puntos (cero
  es un valor válido, no "sin dato").
- **`get_score_series`** (nuevo en `audit_history.py`) — serie
  `{date, score}` ascendente desde `AnalyticsAuditLog`, consumida por
  los indicadores Productividad/Equilibrio Operativo del Trend Engine.
- **`prediction_engine.py`** — réplica exacta de
  `src/lib/predictionEngine.ts`: `nearest_horizon`/
  `compute_historical_reliability`/`compute_prediction_confidence`
  (funciones puras) + `compute_cumplimiento_projection`/
  `compute_sobrecarga_probability`/`compute_task_delay_prediction`/
  `compute_project_delay_prediction`/`compute_subutilizacion_predictions`/
  `compute_operational_stability`. Se porta el archivo completo
  (incluyendo las 2 predicciones que todavía no tienen endpoint HTTP
  propio) para no dejar réplicas parciales de un mismo módulo.
- **Config**: `get_effective_prediction_window_weeks`/`_number` (nuevo
  en `apps/configuration/services.py`) — mismas clave/opciones/default
  ("3", enum cerrado `{3,4,6,8,12}`) que `predictiveConfig.ts`.
- **HTTP**: `GET /api/v1/predictive/predictions/<user_id>/`
  (`PredictionBundleView` — Cumplimiento + Sobrecarga + Estabilidad +
  hasta 10 predicciones de retraso de tareas abiertas del colaborador,
  réplica de `computeBundle` en `route.ts`) y
  `GET /api/v1/predictive/trend/<user_id>/?weeks_back=<n>`
  (`TrendEngineView`, override opcional 1-52 para Tendencias
  Históricas). Mismo patrón de auth/visibilidad jerárquica que
  `KpiUserView`/`AnalyticsBundleView`. Sin capa de caché con TTL —
  mismo gap ya aceptado en `build_analytics_bundle_payload` (Fase 4m).
- **Deferido a una sub-fase futura**: Alertas Preventivas
  (`preventiveIntelligence.ts`, sin puerto Python todavía),
  `team-alerts`, `team-subutilization`, `project-delay` (las funciones
  de cálculo ya están portadas, solo falta el endpoint), `simulate/*`
  (calculadoras puras) y `GET/PUT /settings/prediction-window`.
- **Sin cutover de `route.ts` todavía** — Next.js sigue sirviendo
  `/api/predictive/**` desde Postgres/Prisma.
- **Tests**: 44 nuevos (`test_trend_engine.py`, `test_prediction_engine.py`,
  `test_predictive_views.py`) — 896 pasando en total. `ruff check`
  limpio, sin migraciones nuevas (sin modelos nuevos).

## v1.65.0 — 2026-08-18

**Tipo:** FEATURE
**Módulo:** Migración de stack — Fase 8: Reportes Ejecutivos, solo lectura de snapshots ya generados (nueva app `backend/apps/reports/`)

Primer módulo nuevo portado a Django tras cerrar Escritorio Digital.
Investigar reveló que el Executive Reporting Engine 2.0 completo
(`src/lib/executiveReporting/`, ~3200 líneas: construcción del
documento, narrativa IA vía NOVA/Groq, exportación Excel/HTML) es un
motor de magnitud comparable al de KPIs/Analytics (Fases 4a-4m) — el
propio ROADMAP ya acotaba el alcance de esta fase a "snapshots ya
generados, nunca recalculados", confirmado como la estrategia correcta:
portar el modelo + los 2 endpoints de LECTURA, dejar la generación
(`POST /api/reports/executive`) fuera, con el mismo riesgo que el
Asistente LLM/RAG (ROADMAP punto 6).

- **`ExecutiveReportSnapshot`/`ExecutiveReportAuditLog`** (nuevos
  modelos, réplica campo por campo de `prisma/schema.prisma`) +
  `GET /api/v1/reports/executive/list/` (paginado, filtrado por
  `scope` según el rol del actor) + `GET /api/v1/reports/executive/
  <report_id>/` (lectura inmutable, audita `viewed`).
- **`ensure_snapshot_meta`** — réplica exacta de `ensureSnapshotMeta`
  del TS: repara en el límite de lectura los 4 snapshots
  `LEGACY_MIGRATION` del backfill original, que se persistieron sin el
  campo `data.meta` (gap del backfill TS, no de este puerto),
  reconstruyéndolo desde las columnas propias de la fila sin reescribir
  nada.
- **`MonthlyReport` (modelo legacy) no se porta** — solo alimentó el
  backfill de 4 filas migradas, sin consumidor propio hoy.
- **Sin cutover de `route.ts` todavía** — mismo criterio que el resto
  de módulos recién portados (Notas/Recordatorios en su momento):
  Next.js sigue sirviendo `/api/reports/executive/**` desde Postgres/
  Prisma.
- **Tests**: 15 nuevos en `apps.reports` — 852 pasando en total.

## v1.64.0 — 2026-08-18

**Tipo:** FEATURE
**Módulo:** Migración de stack — Fase 7g: Escritorio Digital — cutover de `route.ts` (`src/lib/djangoDeskAdapter.ts`, `src/app/api/desk-notes/**`, `src/app/api/desk-reminders/**`, `src/app/api/desk/**`)

Séptima sub-fase del Escritorio Digital: los 14 `route.ts` de Next.js
pasan de Prisma/Postgres a Django/SQL Server, mismo patrón que
Proyectos (Fase 5f) y Tareas — nuevo adaptador `djangoDeskAdapter.ts`
(tipos + mapeo snake_case→camelCase + `extractDjangoDeskErrorMessage`)
entre la forma de Django y `src/components/desk/types.ts` (sin
cambios).

- **13 de 14 rutas cortan por completo**: `desk-notes/` (GET/POST),
  `desk-notes/[id]/` (GET/PATCH — DELETE ver más abajo),
  `desk-notes/[id]/attachment/`, `desk-notes/[id]/convert-to-reminder/`,
  `desk-notes/[id]/history/`, `desk-notes/[id]/replies/`,
  `desk-notes/recipients/`, `desk-notes/unread-count/`,
  `desk-reminders/` (GET/POST), `desk-reminders/[id]/`
  (PATCH/DELETE), `desk-reminders/[id]/convert-to-task/`,
  `desk-reminders/[id]/history/`, `desk/today/`, `desk/search/`.
- **`DELETE /api/desk-notes/[id]` se queda en Prisma** — mismo gap que
  Proyectos (Fase 5f): el borrado real de una nota pasa por el Centro
  de Recuperación (`recoveryCenter.ts`, transversal, sin portar — ver
  docs/ROADMAP.md punto 13). Único handler mixto de todo el cutover.
- **El adjunto de una nota nueva se codifica a base64 server-side**,
  no en el cliente: `POST /api/desk-notes` sigue recibiendo
  `multipart/form-data` con un `File` crudo (sin tocar
  `NewNoteModal.tsx`) — la ruta lo codifica a data URL antes de
  reenviarlo a Django (que espera JSON+base64 desde la Fase 7d), mismo
  criterio que `saveAttachment` legacy, redirigido a Django en vez de
  a la fila local.
- **Gap explícito y documentado**: la purga automática de notas
  archivadas hace 15+ días (`purgeExpiredArchivedNotes`, Centro de
  Recuperación) no se replica todavía — pieza transversal, misma
  pospuesta que el punto anterior.
- **Tests**: 6 archivos reescritos (`desk-notes-convert`,
  `desk-notes-id`, `desk-notes-replies`, `desk-reminders`,
  `desk-reminders-convert-to-task`) + 2 archivos nuevos
  (`desk-notes-main` para rutas sin cobertura previa,
  `desk-today-search`) — 1181 tests de Vitest en verde (90 archivos
  previos + 2 nuevos), `tsc --noEmit`/`eslint` limpios.

## v1.63.1 — 2026-08-18

**Tipo:** FIX
**Módulo:** Migración de stack — deuda de tests/tipos post-cutover (`src/__tests__/api/**`, `src/lib/djangoTasksAdapter.ts`, `src/app/api/team/[userId]/tasks/route.ts`)

Al preparar el cutover de Escritorio Digital (Fase 7g) se encontró que
varios cutovers previos (Fases 2/3a-3f/4b/4c) habían dejado tests de
Vitest mockeando `@/lib/prisma` para rutas cuyo código real ya llama a
Django — 13 archivos de test, 150 casos, todos fallando con `cookies
was called outside a request scope` (el mock nunca interceptaba la
llamada real a `djangoApiFetch`). Encontrado y corregido como fix
independiente, no como parte del trabajo de Escritorio Digital.

- **13 archivos de test reescritos** (`tasks-crud`, `tasks-activities-
  comments`, `tasks-close-month`, `tasks-correct-import-template`,
  `tasks-end-date`, `tasks-end-date-bulk-approve`, `tasks-validations-
  pending`, `users`, `users-id`, `kpis-me-userid`, `kpis-team-range`,
  `activities-retroactive-overlap`, `repository`,
  `settings-activity-reasons`) — mismo patrón que `auth.test.ts` (único
  ya correcto): mockear `@/lib/djangoSession` en vez de `@/lib/prisma`,
  y testear solo lo que el `route.ts` wrapper realmente hace (sesión,
  mapeo de body/respuesta, forwarding), no la lógica de negocio que ya
  vive del lado Django (esa la cubre `backend/apps/**/tests/`). Los
  archivos con rutas mixtas (algunas cortadas, otras no) mantienen
  ambos mocks — ningún test de una ruta NO cortada se tocó.
- **`vitest.config.ts`** excluye `frontend/**`/`backend/**` del escaneo
  — Vitest intentaba correr `frontend/node_modules/gensync/test/*.js`
  (falso positivo sin relación con la suite de Nexo).
- **2 bugs de tipos reales encontrados con `tsc --noEmit`** (build de
  producción roto, no solo tests): `DjangoTask.type`/`status`/
  `priority`/`frequency` tipados como `string` genérico en vez de los
  union types de `@/components/tasks/types` (rompía `tasks/page.tsx`);
  `DjangoTask` sin `archived_month` pese a que el serializer de Django
  sí lo expone (rompía `tasks/[id]/route.ts`). `team/[userId]/tasks/
  route.ts` importaba `taskSelect` desde `tasks/route.ts`, un símbolo
  que dejó de existir ahí desde el cutover de Tareas (Fase 3a) — esa
  ruta nunca se migró (Django solo expone las tareas del propio usuario
  autenticado, no las de un subordinado arbitrario), así que se
  reconstruyó `taskSelect` localmente en vez de inventar un endpoint
  Django nuevo, fuera de alcance de este fix.
- **Suite completa verificada**: `tsc --noEmit` limpio, `eslint` sin
  hallazgos nuevos en los archivos tocados, 1153 tests de Vitest en
  verde (90 archivos).

## v1.63.0 — 2026-08-17

**Tipo:** FEATURE
**Módulo:** Migración de stack — Fase 7f: Escritorio Digital — Bandeja Hoy + Buscador (extiende `backend/apps/desk/`)

Sexta sub-fase del Escritorio Digital: los 2 agregados cruzados que
faltaban, `desk/today` y `desk/search` — ambos de solo lectura contra
Trabajo/Proyectos (§15 del TS: "no se modifican"), sin bloqueos de
alcance como las sub-fases anteriores porque `Task`/`Project` ya
existen completos en Django.

- **`GET /api/v1/desk/today/`** ("Bandeja Hoy") — 4 bloques: notas
  pendientes, recordatorios de hoy/vencidos, tareas próximas (7 días),
  proyectos con actividad reciente (7 días, ventana fija — mismo gap ya
  aceptado en el TS: `User` no guarda timestamp de última visita).
  Reutiliza `business_calendar_day`/`business_day_real_range`
  (`apps.tasks.business_time`, portados en la Fase 3b) para el rango
  "hoy" en huso de negocio, sin duplicar esa lógica.
- **`GET /api/v1/desk/search/`** (buscador único) — notas y
  recordatorios con filtros `q`/`priority`/`date`/`sender`/`recipient`/
  `status`, sin que el usuario cambie de sección. `sender`/`recipient`
  usan `first_name`/`username` como aproximación de `User.name`
  (Prisma) — mismo criterio que `DeskUserRefSerializer.get_name` en el
  resto del módulo.
- **Ambas vistas son `APIView` simples, no `ViewSet`** — a diferencia
  del resto de `apps.desk`, no hay CRUD detrás, son agregaciones de
  solo lectura sin recurso propio.
- **Tests**: 38 nuevos en `apps.desk` (20 de Bandeja Hoy + 18 del
  buscador) — 837 pasando en total.

## v1.62.0 — 2026-08-17

**Tipo:** FEATURE
**Módulo:** Migración de stack — Fase 7e: Escritorio Digital — `convert-to-reminder` (extiende `backend/apps/desk/`)

Quinta sub-fase del Escritorio Digital: convertir una `DeskNote` en
`PersonalReminder`. Desbloquea exactamente el gap que había dejado
documentado la Fase 7d ("Adjuntos de Recordatorios" no era una pieza
aislada — dependía de portar esta conversión primero).

- **`DeskNote.converted_to_reminder`/`converted_at`** (nuevos campos,
  migración `desk.0005`, FK con `on_delete=SET_NULL`) +
  `PersonalReminder.attachment_name`/`attachment_mime`/
  `attachment_data` (mismos campos que Notas, sin endpoint propio de
  subida/descarga — réplica exacta del TS: el único origen posible es
  la copia desde la nota) + `DeskNoteService.convert_to_reminder` +
  `POST /api/v1/desk-notes/<id>/convert-to-reminder/`.
- **Prioridad traducida 1:1**: `NOTE_TO_REMINDER_PRIORITY` mapea las 4
  prioridades de Notas a las 4 de Recordatorios
  (INFORMACION→BAJA/RECORDATORIO→MEDIA/IMPORTANTE→ALTA/URGENTE→
  URGENTE), sobreescribible en el body.
- **Exclusivo del destinatario, no del remitente** — a diferencia del
  resto de acciones sobre `DeskNote` (`CanAccessDeskNote` permite
  ambos), acá solo quien recibió la nota puede convertirla. 404 antes
  que 403, réplica del orden de validación del TS — misma técnica que
  `attachment`/`convert-to-task` (búsqueda manual, sin
  `self.get_object()`).
- **La nota original nunca se edita ni se elimina** — solo queda
  marcada `converted_to_reminder`/`converted_at`; título vacío/ausente
  cae al mensaje de la nota (truncado con "…" si excede 150
  caracteres).
- **Gap aceptado — truncado a 149 en vez de 150 caracteres antes del
  "…"**: el TS trunca a 150 y agrega "…", quedando en 151 caracteres —
  cabe en el `String` sin límite de Postgres, pero no en
  `PersonalReminder.title` de Django (`CharField(max_length=150)`,
  real en MSSQL). Se ajustó a 149 para que el resultado quepa.
- **Tests**: 12 nuevos en `apps.desk` — 799 pasando en total.

## v1.61.0 — 2026-08-17

**Tipo:** FEATURE
**Módulo:** Migración de stack — Fase 7d: Escritorio Digital — Adjuntos de Notas (extiende `backend/apps/desk/`)

Cuarta sub-fase del Escritorio Digital: adjuntos, pero acotada a Notas.
Investigar reveló que "Adjuntos (Notas y Recordatorios)", tal como
figuraba en el ROADMAP, no es una sola pieza de trabajo: en el TS el
único camino para que un `PersonalReminder` tenga adjunto es que se
COPIE desde la nota de origen al convertir Nota→Recordatorio — una
conversión que sigue fuera de alcance (ver Fase 7a). Sin esa
conversión portada, no existe upload propio de adjunto de recordatorio
que portar de forma aislada — queda diferido junto con
`convert-to-reminder`.

- **`DeskNote.attachment_name`/`attachment_mime`/`attachment_data`**
  (nuevos campos, migración `desk.0004`) — réplica de `saveAttachment`
  (`src/lib/storage.ts`): mismo límite de tamaño (8MB) y mismas
  extensiones permitidas (`png`/`jpg`/`jpeg`/`pdf`/`doc`/`docx`/`xls`/
  `xlsx`).
- **Forma del contrato distinta a propósito del TS**: el TS recibe un
  `File` de `multipart/form-data` y lo codifica a base64 en el
  servidor; acá el cliente ya manda `attachment_data` como data URL en
  el body JSON — mismo criterio que `ProjectDocumentUploadSerializer.
  file_data` (Fase 5d), consistente con el resto de la API Django ya
  construida. El servidor solo valida extensión/tamaño, no re-codifica
  nada.
- **`GET /api/v1/desk-notes/<id>/attachment/`** — descarga bajo
  demanda (el listado/detalle nunca incluyen `attachment_data`, solo
  `has_attachment`/`attachment_name`/`attachment_mime`). Réplica
  exacta del orden de validación del TS: 404 (no encontrado O sin
  adjunto) se chequea ANTES que 403 (sin permisos) — a propósito no usa
  `self.get_object()` (que aplicaría el permiso de objeto primero,
  dando 403 aun sin adjunto).
- **Tests**: 10 nuevos en `apps.desk` — 787 pasando en total.

## v1.60.0 — 2026-08-17

**Tipo:** FEATURE
**Módulo:** Migración de stack — Fase 7c: Escritorio Digital — `convert-to-task` (extiende `backend/apps/desk/`)

Tercera sub-fase del Escritorio Digital: convertir un `PersonalReminder`
en `Task` de Trabajo. Diferida en la Fase 7b porque duplicaba los
requisitos de `POST /api/tasks` — con `TaskService.create_task` ya
disponible en Django, se resuelve reutilizándolo en vez de reimplementar
la creación de tareas desde cero.

- **`PersonalReminder.converted_to_task`/`converted_to_task_at`** (nuevos
  campos, migración `desk.0003`, FK con `on_delete=SET_NULL` — réplica
  exacta de `convertedToTaskId`/`convertedToTask`/`convertedToTaskAt` de
  Prisma) + `PersonalReminderService.convert_to_task` + `POST
  /api/v1/desk-reminders/<id>/convert-to-task/`.
- **Prioridad traducida, no elegida**: el recordatorio no tiene "prioridad
  de tarea" propia — `REMINDER_TO_TASK_PRIORITY` la mapea a la escala de
  Trabajo (ALTA/MEDIA/BAJA), con URGENTE colapsando en ALTA a propósito
  (Trabajo no tiene un cuarto nivel) — réplica exacta de `PRIORITY_MAP`
  en el `route.ts` original.
- **El recordatorio original nunca se edita ni se elimina** — solo queda
  marcado `converted_to_task`/`converted_to_task_at`; título vacío/ausente
  en el body cae al título del recordatorio.
- **403 explícito (no 404) para quien no es el dueño** — única acción de
  `DeskReminderViewSet` que a propósito NO usa `self.get_object()` (que
  filtra por dueño y respondería 404, como el resto de la clase): réplica
  de que en el TS `convert-to-task` es su propio `route.ts` aislado, que
  sí distingue 403 (existe, no es tuyo) de 404 (no existe).
- **Sin adjunto todavía**: a diferencia del TS (que referencia el nombre
  del archivo adjunto en la descripción de la tarea creada),
  `PersonalReminder` no tiene adjuntos en Django — gap documentado, sin
  impacto funcional hasta que se porten los adjuntos de Escritorio
  Digital (sub-fase propia, sin planificar en detalle todavía).
- **Tests**: 9 nuevos en `apps.desk` — 777 pasando en total.

## v1.59.0 — 2026-08-17

**Tipo:** FEATURE
**Módulo:** Migración de stack — Fase 7b: Escritorio Digital — Recordatorios, CRUD core (extiende `backend/apps/desk/`)

Segundo sub-dominio de Escritorio Digital tras 7a (Notas). Más simple
que Notas en un aspecto clave: `PersonalReminder` no tiene remitente/
destinatario, es de un solo dueño — sin la complejidad de permisos
cruzados de `DeskNote`.

- **`PersonalReminder`** (nuevo modelo) + `PersonalReminderService`
  (`create_reminder`/`complete`/`postpone`/`reopen`/`set_archived`/
  `edit`) + `advance_repeat`/`notify_due_reminders` (funciones de
  módulo) — `GET/POST /api/v1/desk-reminders/`, `GET/PATCH/DELETE
  /desk-reminders/<id>/` (una sola acción `PATCH` cubre `complete`/
  `postpone`/`reopen`/`archive`/`unarchive` o edición directa de
  campos, réplica exacta de la cascada de `if` del TS), `GET /<id>/history/`.
- **`DELETE` SÍ entra en esta sub-fase** (a diferencia de Notas): el
  propio TS ya decidió que el borrado de un recordatorio es físico,
  sin Centro de Recuperación — no hay gap de Papelera que replicar.
- **404, no 403, para un recordatorio de otro usuario** — réplica
  exacta del TS (evita revelar que existe). Resuelto filtrando el
  queryset por dueño en todas las acciones, no con una excepción de
  permiso.
- **Completar un recordatorio repetitivo genera automáticamente la
  siguiente ocurrencia** (`advance_repeat`, réplica de `advanceRepeat`)
  — con una excepción documentada y aceptada: para repetición mensual,
  el desborde de fecha cuando el día no existe en el mes destino (ej.
  31 ene) se **clampea** al último día (28/29 feb) en vez de replicar
  el desborde de `Date.setUTCMonth` de JS (que saltaría a marzo) — evita
  sumar una dependencia nueva (`dateutil`) para un edge case raro sin
  evidencia de estar cubierto por tests en el propio TS.
- **Fuera de alcance, documentado**: `convert-to-task` (pese a que
  `Task` ya existe completo en Django, duplica los requisitos de
  `POST /api/tasks` — feature propia, mejor en su propia sub-fase 7c),
  adjuntos, `desk/today`/`desk/search`.
- **Tests**: 23 nuevos en `apps/desk` — 768 pasando en total.

## v1.58.0 — 2026-08-17

**Tipo:** FEATURE
**Módulo:** Migración de stack — Fase 7a: Escritorio Digital — Notas, CRUD core (nueva app `backend/apps/desk/`)

Primer módulo de negocio nuevo portado a Django desde cero tras
completar Auth — el ROADMAP lo marcaba "riesgo bajo, solo depende de
Usuarios", confirmado para el CRUD core (investigar reveló 3 flujos
concretos que sí cruzan hacia Tarea/Proyecto/Centro de Recuperación,
diferidos explícitamente).

- **`DeskNote`/`DeskNoteReply`/`DeskAuditLog`** (nuevos modelos) +
  `DeskNoteService`/`DeskNoteReplyService` — `GET/POST
  /api/v1/desk-notes/`, `GET/PATCH /desk-notes/<id>/` (acciones
  `read`/`pin`/`unpin`/`archive`/`unarchive`, exclusivas del
  destinatario), `GET /recipients/`, `GET /unread-count/`, `GET/POST
  /<id>/replies/` (límite configurable, 409 al superarlo), `GET
  /<id>/history/`. Réplica campo por campo de
  `src/app/api/desk-notes/**`.
- **Reutiliza infraestructura ya portada**: `apps.notifications.services.notify()`
  (Fase 3f) para notificar al destinatario y confirmar lectura, sin
  extender el modelo `Notification`. Nueva clave de configuración
  `desk_note_max_replies` (default 2) en `apps.configuration`, mismo
  patrón que las claves agregadas en Fase 6a/6b.
- **Fuera de alcance, documentado**: adjuntos (`attachmentData` base64),
  `DELETE`/Papelera (Centro de Recuperación, transversal, sin portar),
  `convert-to-reminder` (depende de `PersonalReminder`, llega en 7b),
  purga de archivadas vencidas. `desk/today` y `desk/search`
  (agregados que cruzan hacia `Task`/`Project`) tampoco están en esta
  sub-fase.
- **Sin cutover de Next.js** — mismo criterio que Proyectos 5a-5e:
  Django se construye y prueba completo primero,
  `src/app/api/desk-notes/**` sigue intacto.
- **Tests**: 28 nuevos en `apps/desk` + 2 en `apps/configuration`
  (`desk_note_max_replies`) — 745 pasando en total.

## v1.57.0 — 2026-08-17

**Tipo:** SECURITY
**Módulo:** Migración de stack — Fase 6c: Auth — cutover de forgot-password (cierra el módulo Auth)

Última pieza del módulo Auth (tras 6a/6b) — cierra el decommission de
PostgreSQL para todo Auth salvo la excepción híbrida de
`activityFormat`. No hizo falta tocar Django:
`PasswordResetRequestView`/`PasswordResetConfirmView` ya estaban
completos y probados desde antes de esta migración.

- **Fix de seguridad**: el stub anterior de `forgot-password`
  devolvía un mensaje DISTINTO según existiera o no la cuenta
  (`prisma.user.findUnique` decidía el texto) — filtraba la
  existencia de una cuenta por email. Ahora responde siempre el mismo
  mensaje genérico de Django, sin importar el resultado.
- **`forgot-password`** reescrito: ya no es un stub — dispara un email
  real con un link a `/reset-password?token=...`.
- **`/api/auth/reset-password`** (nuevo) + **`/reset-password`**
  (nueva pantalla, mismo patrón visual que `/login`): confirma el
  reset con el token del email. Sin auto-login tras el éxito — Django
  revoca todas las sesiones del usuario al confirmar, corresponde
  volver a `/login`.
- **`src/proxy.ts`**: `/reset-password` y `/api/auth/reset-password`
  se agregan a las rutas públicas.
- **2 helpers nuevos en `djangoSession.ts`** (`requestDjangoPasswordReset`/
  `confirmDjangoPasswordReset`) — a diferencia de `djangoApiFetch`, sin
  cookies: son endpoints públicos, el usuario todavía no inició sesión.
- **Tests**: `src/__tests__/api/auth.test.ts` reescribió el describe
  de `forgot-password` y agregó uno nuevo para `reset-password` —
  34/34 pasando. Sin cambios de backend, sin tests nuevos de Django.
  Sin prueba manual en navegador — mismo motivo que fases anteriores,
  riesgo aceptado explícitamente por el usuario para esta sub-fase
  (primera pantalla nueva construida sin verificación visual).

## v1.56.0 — 2026-08-17

**Tipo:** BREAKING CHANGE
**Módulo:** Migración de stack — Fase 6b: Auth — cutover de logout/me/change-password (continúa el decommission de PostgreSQL)

Segundo paso del decommission de PostgreSQL — cierra el resto del
módulo Auth salvo `forgot-password` (queda fuera: requiere una
pantalla nueva de confirmación por token que hoy no existe en el
frontend, candidata a una Fase 6c futura).

- **`logout`**: ahora revoca la sesión real de Django
  (`POST /auth/logout/`, best-effort) y limpia las cookies
  `nexo-django-access`/`nexo-django-refresh` (nuevo
  `clearDjangoTokenCookies()` en `src/lib/djangoSession.ts`) — antes
  quedaban vivas hasta expirar por su cuenta.
- **`GET`/`PATCH /api/auth/me`**: identidad (`name`/`email`/`role`/
  `createdAt`) pasa a Django (`GET`/`PATCH /auth/me/`). `PATCH` es
  nuevo del lado Django — antes no existía auto-servicio de perfil
  (`PATCH /admin/users/{id}/` exige el permiso administrativo
  `usuarios.editar`, no sirve para que un usuario edite su propio
  registro). **Excepción híbrida documentada**: `activityFormat`
  (preferencia de UI, respaldada por `viewPreferences`) sigue
  leyéndose/escribiéndose en Postgres vía Prisma — Django no tiene
  ningún campo equivalente, y `session.userId` sigue siendo el `cuid`
  de Postgres (Fase 6a), así que el residual es válido.
- **`change-password`**: pasa a `POST /auth/password/change/`. Mapea
  camelCase→snake_case y reusa `newPassword` como
  `new_password_confirm` (el frontend ya valida la coincidencia
  client-side, nunca mandaba ese campo). **Comportamiento nuevo
  aceptado**: Django además revoca las demás sesiones activas del
  usuario y envía un email real de notificación — mejora de
  seguridad, no una regresión.
- **Backend**: `MeView.patch` (nuevo) + `MeUpdateSerializer` (reusa
  `validate_unique_email`, sin exigir el permiso administrativo).
- **`extractDjangoFieldErrorMessage`** (nuevo, `djangoSession.ts`):
  2do consumidor real de la extracción de mensajes de error por campo
  del contrato uniforme de Django — se centraliza en vez de duplicarlo.
- **Tests**: 4 nuevos en `apps/authentication` (715 en total);
  `src/__tests__/api/auth.test.ts` reescribió los describes de
  `logout`/`GET me`/`PATCH me`/`change-password` (32/32 pasando) —
  `forgot-password`/`consent` quedan intactos.

## v1.55.0 — 2026-08-14

**Tipo:** BREAKING CHANGE
**Módulo:** Migración de stack — Fase 6a: Auth — cutover de Login (primer paso del decommission de PostgreSQL)

Primer paso del decommission completo de PostgreSQL (decisión explícita
del usuario, ver `docs/AUDIT_LOG.md`): el login real
(`src/app/api/auth/login/route.ts`) deja de decidirse contra
Prisma/bcrypt y pasa a autenticar contra Django
(`backend/apps/authentication/`), que ya tenía un sistema de auth más
maduro (rate-limit por IP + por `identifier`, timing-safe contra
enumeración de usuarios) sin necesidad de construir nada nuevo.

- **Modelo híbrido de IDs** (decisión explícita del usuario): Django
  decide si la contraseña es válida, pero `nexo-session` (la cookie de
  Next.js) sigue guardando el `userId` con el `cuid` de Postgres
  (`legacy_postgres_id`, que Django ya guarda por cada usuario
  importado) — así los 19 módulos que todavía dependen de
  `prisma.*(where: { id: session.userId })` no requieren ningún
  cambio. Un usuario Django sin `legacy_postgres_id` (no importado
  todavía desde Postgres) no puede iniciar sesión — gap aceptado,
  documentado.
- **Backend**: `UserPublicSerializer` (`apps/users/serializers.py`)
  ahora expone `roles`/`legacy_postgres_id`; nuevas claves de
  configuración `session_duration_default_hours`/`_remember_hours` en
  `apps.configuration.services` (mismos defaults que
  `src/lib/systemConfig.ts`: 168h/720h); `AuthenticationService.
  authenticate_and_issue_tokens` devuelve `session_policy` junto a los
  tokens, para que el login de Next.js no necesite leer Postgres para
  saber cuánto debe durar `nexo-session`.
- **`src/lib/rate-limit.ts` deja de usarse en esta ruta** — el throttle
  `ScopedRateThrottle` (scope `login`) + `BruteForceProtectionService`
  (por `identifier`) de Django ya cubren el mismo caso.
  `establishDjangoSession` (el puente best-effort en paralelo de la
  Fase 2) se retira — `loginToDjango`/`setDjangoTokenCookies`
  (`src/lib/djangoSession.ts`) lo reemplazan como fuente de verdad.
- **Gaps aceptados y documentados**: `must_change_password` (concepto
  nuevo de Django, sin superficie en el frontend todavía);
  `lastLoginAt` deja de actualizarse (Django no pasa por
  `django.contrib.auth.login()` en este flujo, no actualiza
  `last_login`).
- **Sin correr el import real de usuarios ni prueba en navegador** —
  este entorno no tiene `DATABASE_URL`/`LEGACY_POSTGRES_URL` reales
  (confirmado con el usuario). El comando
  `migrate_users_from_postgres` ya existe y está probado (resuelve
  bcrypt→Argon2 sin forzar reset), pero nunca se corrió contra datos
  reales — queda pendiente para el entorno real del usuario.
- **Tests**: 3 nuevos en `apps/configuration`, 1 en
  `apps/authentication/tests/test_views.py` (roles/legacy_postgres_id
  en `/auth/me/`), 1 en `apps/authentication/tests/test_auth_security.py`
  (`session_policy`) — 706 previos + 5 nuevos, 711 pasando.
  `src/__tests__/api/auth.test.ts` reescribió por completo el
  describe de `POST /api/auth/login` (mock de `djangoSession` en vez
  de Prisma/bcrypt/rate-limit) — 28/28 pasando.
- **Hallazgo no relacionado, documentado pero NO corregido en esta
  entrega**: 173 tests de Vitest ya fallaban antes de este cambio en
  módulos ya cortados a Django en fases previas (Tareas, KPIs,
  Usuarios, Repositorio) — `cookies() was called outside a request
  scope` al llamar `djangoApiFetch` desde esos tests, que nunca
  mockean `@/lib/djangoSession`. Verificado que es previo a esta
  sesión (con `git stash -u`, revirtiendo también los archivos sin
  trackear, la suite completa vuelve a pasar 1208/1208 porque las
  rutas revierten a su versión Prisma pre-cutover). Fuera de alcance
  de la Fase 6a — afecta código de fases anteriores, no lo introduce
  este cambio.

## v1.54.0 — 2026-08-14

**Tipo:** FEATURE
**Módulo:** Migración de stack — Fase 5f: Proyectos — cutover de `route.ts` a Django (`src/app/api/projects/**` + nuevo `src/lib/djangoProjectsAdapter.ts`)

Con Actividades (5e) completa, Proyectos tenía toda la superficie
portada — corresponde el mismo paso que Tareas (3a) y KPIs (4b/4m):
`route.ts` deja de usar Prisma y llama a Django vía `djangoApiFetch`,
adaptando la respuesta con un adaptador dedicado. El frontend
(`src/components/projects/**`) no cambia.

- **2 gaps de backend cerrados antes del corte** (`backend/apps/projects/serializers.py`):
  `ProjectUserRefSerializer` ahora expone `roles` (antes solo Tareas lo
  tenía; `ProjectComment.author.role` es campo obligatorio en el
  frontend), y `ProjectListSerializer`/`ProjectDetailSerializer` ahora
  exponen `phase_count`/`comment_count`/`document_count`/
  `activity_count` (antes solo `participant_count` — los 3 modelos ya
  estaban portados desde 5b-5d, solo faltaba el conteo).
- **`DELETE /api/projects/[id]` (enviar a la papelera) queda en
  Prisma/Postgres, sin cortar** — la Papelera de Proyectos
  (`trash/route.ts`, `[id]/restore/route.ts`, `[id]/permanent/route.ts`,
  también sin tocar) sigue leyendo exclusivamente Postgres vía
  `recoveryCenter.ts`; cortar el DELETE dejaría cualquier proyecto
  enviado a la papelera sin aparecer nunca ahí. `GET`/`PATCH` del mismo
  archivo sí cortan a Django — cada handler HTTP es independiente en
  Next.js App Router.
- **`src/lib/djangoProjectsAdapter.ts`** (nuevo) — mismo patrón que
  `djangoTasksAdapter.ts`: mapeo snake_case→camelCase, IDs numéricos de
  Django castings a `String(...)`, y un `extractDjangoProjectErrorMessage`
  más general que el de Tareas (toma el primer campo con error en
  `details`, no solo `non_field_errors` — Proyectos depende de mensajes
  específicos por campo). El enmascarado de email (`maskEmailUnless`)
  sigue viviendo en cada `route.ts`, no en el adaptador.
- **10 rutas reescritas** (`route.ts`, `[id]/route.ts` GET/PATCH,
  `participants/*`, `comments`, `history`, `phases/*`, `documents/*`,
  `activities`); 3 quedan intactas (Papelera).
- **Verificación**: `tsc --noEmit` y `eslint` limpios sobre todos los
  archivos tocados, suite completa de Django en verde (706 tests, 703
  previos + 3 nuevos de los gaps de serializer), `manage.py check` +
  `makemigrations --check` sin cambios pendientes (los gaps cerrados
  son solo de serializer, sin campos de modelo nuevos).
  **Sin prueba manual en navegador** — este entorno no tiene un
  `.env` de Next.js con `DATABASE_URL`/`SESSION_SECRET` reales
  (confirmado con el usuario, que tampoco los tiene a mano); queda
  pendiente que se corra `npm run dev` contra un entorno real antes de
  dar por buena la experiencia visual end-to-end.

## v1.53.0 — 2026-08-14

**Tipo:** FEATURE
**Módulo:** Migración de stack — Fase 5e: Proyectos — Actividades (extiende `backend/apps/projects/`) — sin cutover de Next.js todavía

Porta `ProjectActivity`, cerrando Proyectos salvo Papelera/Centro de
Recuperación y el cutover de `route.ts`. **Corrección de una suposición
desactualizada del ROADMAP**: se venía asumiendo que Actividades era "la
pieza más pesada" por arrastrar `businessTime.ts`/`systemConfig.ts`/
`timeOverlap.ts` sin portar — investigando se confirmó que las 3 ya
estaban portadas en Django como parte del registro de horas de Tareas
(Fase 3b/3f, `apps/tasks/business_time.py` +
`apps.configuration.get_effective_retroactive_window_days`), lo que
redujo esta fase a un trabajo comparable a 5d.

- **`ProjectActivity`** (nuevo modelo) + **`ActivityService.create_activity`**
  — `GET/POST /api/v1/projects/<id>/activities/` (acción de
  `ProjectViewSet`). A diferencia de Tareas, el TS de Proyectos no valida
  solapamiento de horarios (`findOverlappingActivity`) ni separa un
  endpoint `/activities/retroactive` — un solo método cubre registro
  normal y retroactivo según si `activity_date` viene y difiere de hoy.
  Reutiliza el patrón de `created_at` retroactivo ya resuelto en
  `apps.tasks.services.ActivityService.create_retroactive_activity`
  (`auto_now_add=True` + `.filter(pk=...).update(created_at=...)`).
  Auto-alta como participante si el actor no lo era, con historial
  PARTICIPANTE_AGREGADO (`new_value={"auto": True}`) — sin evento de
  historial para la actividad en sí (Sprint 2.1 §1, mismo criterio que
  Comentarios).
- **3 huecos cerrados** que dependían de `ProjectActivity`:
  `ProjectDocument.activity` (diferido en 5d), `registered_minutes`/
  `participants` reales por fase (fijos en `0`/`[]` desde 5c, ahora
  agregan sobre `obj.activities.all()`) y `last_activity` en el detalle
  del proyecto (nunca implementado).
- **Tests**: 17 nuevos (`test_project_activities.py`) + 2 extendidos en
  `test_project_documents.py` — 703 pasando en total, sin regresiones.

## v1.52.0 — 2026-08-13

**Tipo:** FEATURE
**Módulo:** Migración de stack — Fase 5d: Proyectos — Documentos (extiende `backend/apps/projects/`) — sin cutover de Next.js todavía

Porta `ProjectDocument`, más chica que Actividades (que arrastra
`businessTime.ts`/`systemConfig.ts`/`timeOverlap.ts`, todavía sin
portar): Documentos solo depende de `is_project_participant`/
`can_view_project`, ya portados.

- **`ProjectDocument`** (nuevo modelo) + **`DocumentService.upload_document`**
  — `GET/POST /api/v1/projects/<id>/documents/` (acción de
  `ProjectViewSet`) y `GET /api/v1/projects/<id>/documents/<document_id>/`
  (`DocumentDetailView`). Versionado con `previous_version_id`
  (referencia SUELTA, sin FK — igual que el schema Prisma original,
  "permite historial de versiones sin encadenar borrados"), historial
  DOCUMENTO_AGREGADO con sufijo `"(vN)"` cuando corresponde.
- **413 explícito preservado** para archivos > ~4.5MB
  (`MAX_BASE64_LENGTH = 6_000_000`, mismo literal que el TS) — chequeo
  inline en la vista, no una validación de campo del serializer (que
  siempre mapea a 400) — mismo criterio que los 409 de 5b/5c.
- **Simplificación aceptada**: `activityId` (vínculo opcional a
  `ProjectActivity` en el TS) no se porta — ese modelo no existe
  todavía en Django, un documento nunca queda asociado a una
  actividad en esta sub-fase.
- **Tests**: 12 nuevos — 684 pasando en total, sin regresiones.

## v1.51.0 — 2026-08-13

**Tipo:** FEATURE
**Módulo:** Migración de stack — Fase 5c: Proyectos — Fases (extiende `backend/apps/projects/`) — sin cutover de Next.js todavía

Porta `ProjectPhase`, la siguiente pieza más chica tras 5b:
`canManagePhases` (`projectAccess.ts`) es literalmente `isProjectManager`
(ya portado como `CanManageProject`), sin dependencias externas nuevas.
Actividades/Documentos/Papelera siguen pendientes.

- **`ProjectPhase`** (nuevo modelo) + **`PhaseService`**
  (`create_phase`/`update_phase`/`delete_phase`) —
  `POST /api/v1/projects/<id>/phases/` (acción de `ProjectViewSet`,
  `order` autoincremental) y `PATCH|DELETE /api/v1/projects/<id>/phases/<phase_id>/`
  (`PhaseDetailView`, 2 ids en la URL, mismo patrón que
  `ParticipantDetailView`). Solo el cambio de `status` genera evento
  FASE_ACTUALIZADA (Sprint 2.1 §1) — progreso/notas/fechas/responsable
  son ediciones intermedias sin auditar. Eliminación es hard delete (el
  TS tampoco mueve fases a la papelera).
- **`ProjectDetailSerializer` extendido** con `phases` — ya no está
  fuera de alcance. `registered_minutes`/`participants` de cada fase
  (derivados de `ProjectActivity` en el TS vía `getPhaseStats`) quedan
  fijos en `0`/`[]`: `ProjectActivity` no existe todavía en Django,
  simplificación documentada (el propio TS ya hace esto para una fase
  recién creada).
- **Tests**: 12 nuevos — 672 pasando en total, sin regresiones.

## v1.50.0 — 2026-08-13

**Tipo:** FEATURE
**Módulo:** Migración de stack — Fase 5b: Proyectos — Participantes, Comentarios e Historial (extiende `backend/apps/projects/`) — sin cutover de Next.js todavía

Cierra las 3 piezas más chicas que quedaron fuera de alcance de 5a
— ninguna necesitó modelos ni dependencias externas nuevas más allá de
`ProjectComment` (trivial). Fases/Actividades siguen pendientes
(arrastran `businessTime.ts`/`systemConfig.ts`/`timeOverlap.ts`, sin
portar).

- **`ProjectComment`** (nuevo modelo) + `CommentService.create_comment`
  — `GET/POST /api/v1/projects/<id>/comments/`. Sin evento de
  `ProjectHistory` (Sprint 2.1 §1 del TS: los comentarios tienen su
  propia pestaña cronológica).
- **`ParticipantService`** (`add_participant`/`remove_participant`) —
  `POST /api/v1/projects/<id>/participants/` y
  `DELETE /api/v1/projects/<id>/participants/<participant_id>/`
  (`ParticipantDetailView`, no una acción anidada — 2 ids en la URL,
  mismo patrón que `ActivityDetailView` en `apps/tasks/`). Preserva los
  2 `409 Conflict` del TS (ya participante / intento de quitar al
  responsable) explícitos, mismo patrón que `CloseMonthView`.
- **`GET /api/v1/projects/<id>/history/`** — lectura de
  `ProjectHistory` (el modelo ya existía desde 5a, solo faltaba el
  endpoint).
- **Hallazgo**: `isProjectParticipant` (gate de `POST /comments` en el
  TS) y `canViewProject` (gate de `GET /comments`/`retrieve`) resultan
  ser el mismo conjunto de usuarios una vez comparadas ambas fórmulas
  — se reutiliza `CanAccessProject` para las 2 acciones de `comments`,
  no una relajación del permiso original.
- **Tests**: 16 nuevos — 660 pasando en total, sin regresiones.

## v1.49.0 — 2026-08-13

**Tipo:** FEATURE
**Módulo:** Migración de stack — Fase 5a: módulo Proyectos, CRUD core en Django (nueva app `backend/apps/projects/`) — sin cutover de Next.js todavía

Arranca la migración del módulo Proyectos (`docs/ROADMAP.md` §
Planificado punto 4), el siguiente territorio grande tras completar
KPIs/Analytics (4a-4m). A diferencia de todas las fases anteriores,
esta se queda deliberadamente del lado Django: Django usa su propia
base (SQL Server), separada de Postgres/Prisma — un `Project` creado
hoy vía Django no sería visible para las pestañas de Participantes/
Fases/Actividades/Comentarios/Documentos (todavía sin portar, leen
Postgres) si se cortara ya `route.ts`. Decisión confirmada
explícitamente por el usuario: construir y probar en Django, sin tocar
`src/app/api/projects/**` todavía.

- **`Project`/`ProjectParticipant`/`ProjectHistory`** (nuevos modelos)
  — réplica de los 3 modelos Prisma equivalentes; `ProjectHistoryEvent`
  define los 14 valores del enum TS completo aunque esta sub-fase solo
  emite 4 (CREADO/ESTADO_CAMBIADO/RESPONSABLE_CAMBIADO/ELIMINADO).
  `deleted_at` es un soft-delete DIRECTO, sin Centro de Recuperación
  (`recoveryCenter.ts`, pieza transversal no portada — candidata a su
  propia sub-fase).
- **`ROLE_LEVEL`/`role_level()`** (nuevo, `apps/projects/permissions.py`)
  — Proyectos es el primer módulo Django que necesita el nivel
  jerárquico numérico crudo (`apps.hierarchy` es 100% table-driven,
  `RoleVisibility`, sin nivel); réplica literal de `ROLE_LEVEL` en
  `src/lib/roles.ts`, duplicada localmente (mismo criterio que
  `ROLE_LABEL` en `apps/tasks/services.py`) en vez de centralizarla con
  un solo consumidor.
- **`ProjectService`** (`create_project`/`update_project`/
  `soft_delete_project`) + **`permissions.py`** (réplica exacta de
  `src/lib/projectAccess.ts`: `is_project_manager`/`can_view_project`/
  `is_project_creator`/`is_project_participant`) + **`ProjectViewSet`**
  (`GET/POST /api/v1/projects/`, `GET/PATCH/DELETE /api/v1/projects/<id>/`)
  — mismo patrón exacto que `TaskViewSet`/`TaskService`
  (`apps/tasks/`).
- **Fuera de alcance de 5a** (ver plan de la fase): `ProjectPhase`/
  `ProjectActivity` (arrastran `businessTime.ts`/`systemConfig.ts`/
  `timeOverlap.ts`, sin portar), `ProjectComment`, `ProjectDocument`,
  endpoints dedicados de Participantes, Papelera/Centro de
  Recuperación, lectura de `ProjectHistory`, y el cutover de
  `route.ts`/`[id]/route.ts` (Next.js sigue sirviendo `/api/projects`
  desde Postgres/Prisma sin cambios).
- **Tests**: 34 nuevos — 644 pasando en total, sin regresiones.

## v1.48.0 — 2026-08-12

**Tipo:** FEATURE
**Módulo:** Migración de stack — Fase 4m: primer endpoint HTTP real de Analytics, `GET /api/analytics/[userId]` — cutover completo Django↔Next.js; nuevos `backend/apps/analytics/tests/test_analytics_bundle_view.py` y `src/lib/djangoAnalyticsAdapter.ts`; `services.py`/`views.py`/`config/api_v1_urls.py` extendidos; `src/app/api/analytics/[userId]/route.ts` reescrito

Cierra por completo el punto 3 (KPIs/Analytics) de la migración de
stack: con el motor entero portado (4a-4l), este era el único ítem
pendiente. Sigue el mismo patrón de cutover ya usado en Tareas (Fase 3)
y KPIs (Fase 4b) — Django expone el endpoint real, la ruta Next.js se
reescribe como proxy delgado.

- **`build_analytics_bundle_payload`** (nuevo, `services.py`) —
  envuelve `run_analytics_pipeline` (Fase 4l), redacta
  `validation_failures` → `validation_warnings` solo para
  `is_superuser` con fallas (mismo patrón exacto ya usado en
  `build_kpi_payload`), agrega `engine_version`/`formula_set_version`/
  `last_updated`/`cache_active` (siempre `false` — Django no porta la
  capa de caché en memoria por-proceso del TS en esta fase). Import
  local de `run_analytics_pipeline` (no al tope del archivo) para
  evitar un ciclo real: `pipeline.py` → `history.py` → `services.py`
  (que ya expone `_month_bounds`/`_shift_month`, consumidos por
  `history.py`) — mismo patrón de import diferido que
  `normalization.get_effective_curve`.
- **`AnalyticsBundleView`** (nuevo, `views.py`) — `GET /api/v1/analytics/<user_id>/`,
  mismo patrón de auth/visibilidad jerárquica que `KpiUserView`.
- **`djangoAnalyticsAdapter.ts`** (nuevo) — mismo patrón exacto que
  `djangoKpisAdapter.ts`: transformación recursiva snake_case→camelCase
  genérica, duplicada a propósito (payload 100% mecánico, sin
  renombres pendientes una vez resuelto `validation_warnings` del lado
  Django).
- **`route.ts` reescrito** — de cálculo local (`runAnalyticsPipeline` +
  Prisma) a proxy (`djangoApiFetch` + adaptador), mismo patrón que
  `kpis/[userId]/route.ts`. Único consumidor hoy:
  `AdvancedAnalyticsPanel` (`AdvancedAnalytics.tsx`).
- **Tests**: 10 nuevos en Django (401/404/403/200/redacción admin-only)
  — 610 pasando en total, sin regresiones. Sin test de Vitest nuevo
  para la ruta proxy — ningún cutover previo (Tareas/KPIs) tiene uno;
  se verificó con `tsc --noEmit`/`eslint` limpios sobre los archivos
  nuevos/modificados (no fue posible antes de esta fase: `node_modules/`
  no estaba instalado en el entorno — se corrió `npm install` como
  parte de la verificación).

## v1.47.0 — 2026-08-12

**Tipo:** FEATURE
**Módulo:** Migración de stack — Fase 4l: KPIs/Analytics, Trend/Predictive Engine + Pipeline orquestador — nuevos `backend/apps/analytics/prediction.py` y `backend/apps/analytics/pipeline.py`; `backend/apps/analytics/models.py` extendido

Con `insightsEngine.ts` 100% portado (4j+4k), `docs/ROADMAP.md` dejaba 3
ítems sin planificar en detalle: Trend/Predictive Engine,
`runAnalyticsPipeline` y el primer endpoint HTTP real. Investigando
`analytics.ts` se confirmó que las 2 primeras piezas ya eran portables
sin bloqueos — todas sus dependencias estaban portadas desde fases
anteriores. Esta entrega cierra ambas; el endpoint HTTP queda pendiente.

- **`prediction.py`** (nuevo) — `detect_anomalies` (§5, compara carga/
  cumplimiento/actividades de Seguimiento del mes actual contra el
  promedio de hasta 5 meses previos con dato, severidad yellow/orange
  según magnitud) y `compute_prediction` (§6, regresión lineal simple
  sobre 6 semanas de horas para proyectar la carga de la próxima
  semana, proyección de cumplimiento por ritmo con rango de confianza,
  horas para volver al rango óptimo si hay Subutilización) +
  `compute_prediction_confidence_pct` (nunca ≥92%, ver Sprint 1 S1-C).
- **`pipeline.py`** (nuevo) — `validate_analytics_consistency` (§S3-C, 6
  chequeos de sanidad matemática sobre KPIs ya calculados: capacidad ≤
  base, comprometido ≥ 0, suma de factores == score en ambos scores,
  Performance Score en rango, predicción completa, sin NaN/Infinity —
  audita solo si hay fallas) y `run_analytics_pipeline` (el bundle
  orquestador: ensambla, en el orden documentado en el TS, los 10 KPIs
  individuales ya portados en 4a-4l).
- **`AUDIT_KIND_FORMULAS["validation_failure"] = []`** (nuevo en
  `models.py`) — `validate_analytics_consistency` audita vía
  `audit_calculation` (a diferencia de `validate_cumplimiento_consistency`,
  Fase 4b, que sigue auditando inline por predatar ese helper — mismo
  comportamiento que sus respectivos equivalentes TS).
- **No se porta** el objeto `diagnostics` (contador de cache/
  validaciones en memoria del proceso Next.js) — instrumentación de
  proceso sin consumidor en Django, no una regla de negocio.
- **Tests**: 22 nuevos — 600 pasando en total, sin regresiones.

## v1.46.0 — 2026-08-12

**Tipo:** FEATURE
**Módulo:** Migración de stack — Fase 4k: KPIs/Analytics, cierre de la capa explicativa (`insightsEngine.ts`) — `backend/apps/analytics/insights_engine.py` extendido con relaciones/benchmark/reevaluación/priorización

Cierra el puerto completo de `insightsEngine.ts` (999 líneas), arrancado
en la Fase 4j. Se agregan las 4 piezas que faltaban, todas features
"secundarias" sobre el mismo dato ya calculado, sin dependencia hacia
atrás desde el núcleo portado en 4j:

- **`compute_indicator_relations`** (S6-C) — cruza indicadores YA
  CALCULADOS (histórico mensual, consistencia, factores de Riesgo
  Operativo, Capacidad Proyectada) con 4 reglas fijas deterministas (sin
  ML): cumplimiento vs. Seguimiento, horas extra vs. capacidad, carga vs.
  consistencia, tareas sin estimar vs. confiabilidad de la proyección.
  Función pura, sin queries propias. `relation_confidence` calcula la
  confianza de cada relación por umbrales de observaciones × fuerza del
  efecto.
- **`compute_personal_benchmark`** (S6-D) — reconstruye el historial
  PERSONAL del Performance Score leyendo `AnalyticsAuditLog`
  (`kind="performance_score"`, ventana de 366 días, sin tabla nueva):
  promedio, mejor período histórico, mejor semana, promedio de últimas
  4 semanas/3 meses, percentil y narrativa ejecutiva. Reutiliza
  `_utc_week_start` (`workload.py`) para agrupar por semana.
- **`compute_recommendation_reevaluation`** (S6-G) — compara el ciclo
  actual de alertas/Riesgo Operativo contra el snapshot más antiguo
  disponible en una ventana de 14 días (`AnalyticsAuditLog`, kinds
  `"alerts"`/`"operational_risk"`), clasificando cada regla de la
  referencia como mejorada/válida/prioritaria/sin-datos. Se recalcula
  íntegramente en cada llamada, sin persistir nada nuevo.
- **`prioritize_recommendations`/`insight_priority`/`prioritize_insights`**
  (S6-H) — orden fijo de 4 criterios (prioridad → magnitud de impacto en
  Riesgo Operativo → impacto combinado → facilidad de implementación →
  colaboradores afectados), top 3 + resto agrupado. Funciones puras
  sobre dicts, sin equivalente de los genéricos TypeScript (`Rankable<T>`)
  — Python no los necesita para este caso de uso.
- **Sin endpoint HTTP y sin auditoría propia**, mismo criterio que 4j:
  ninguna de estas 4 piezas llama `audit_calculation`.
- **Tests**: 27 nuevos — 578 pasando en total, sin regresiones.

Con esto, `insightsEngine.ts` queda 100% portado a Django
(`apps.analytics.insights_engine` + `apps.analytics.audit_history`).

## v1.45.0 — 2026-08-12

**Tipo:** FEATURE
**Módulo:** Migración de stack — Fase 4j: KPIs/Analytics, núcleo de la capa explicativa (`insightsEngine.ts`) — nuevos `backend/apps/analytics/insights_engine.py` y `backend/apps/analytics/audit_history.py`; `backend/apps/analytics/explain.py` extendido

Arranca la capa explicativa ("Decision Intelligence Engine") sobre el
núcleo de scoring cerrado en la Fase 4i. `insightsEngine.ts` (999 líneas)
es ~4× más grande que cualquier sub-fase portada hasta ahora — se dividió
en 4j (esta, el núcleo consumido directamente por el panel de Insights) y
4k (relaciones entre indicadores, benchmark personal, reevaluación de
recomendaciones y priorización, pendiente).

- **`insights_engine.py`** — réplica función por función de la mitad del
  archivo original (líneas 1-679): `compute_confidence` (S6-F, ★1-5),
  `compute_performance_insights`/`compute_equilibrio_insights` (Sprint A /
  Sprint Analytics 2.0 — fortalezas y oportunidades bidireccionales a
  partir de los factores ya calculados de Performance Score/Equilibrio
  Operativo, "Medio" no genera insight), `explain_equilibrio_factor`/
  `explain_equilibrio_meaning`/`explain_equilibrio_impact` (Bloques 3/4/7,
  plantillas fijas por nivel), el orquestador `compute_insights` (S6-A —
  combina insights de Performance + factores de Riesgo Operativo
  relevantes, con enriquecimiento cruzado del histórico mensual para
  "Tendencia negativa de cumplimiento" + insight positivo de tendencia +
  fallback neutral) y `explain_score_trend`/`get_score_trend_explanation`
  (Sprint A — narra qué factores subieron/bajaron más entre dos snapshots
  de auditoría).
- **`audit_history.py`** (nuevo) — puerto parcial de
  `analyticsAuditHistory.ts`: solo `get_factor_audit_history`/
  `closest_factor_point`, las 2 funciones que consume `insights_engine.py`
  (`get_score_series`, para gráficos, no se porta todavía — sin
  consumidor).
- **`explain.py` extendido** — se agregan `score_level`/
  `derived_normalized_value` (réplica de `scoreLevel`/
  `derivedNormalizedValue`), junto con tests nuevos para las 3 funciones
  del archivo (incluida `cumplimiento_color`, que no tenía cobertura
  dedicada desde la Fase 4b).
- **Sin endpoint HTTP y sin auditoría propia** — `insightsEngine.ts` es de
  solo lectura (nunca llama `auditCalculation`), confirmado leyendo el
  archivo completo; no hizo falta tocar `AUDIT_KIND_FORMULAS` en
  `models.py`.
- **Tests**: 55 nuevos (`test_insights_engine.py`, `test_audit_history.py`,
  `test_explain.py`) — 551 pasando en total, sin regresiones.

## v1.44.0 — 2026-08-11

**Tipo:** FEATURE
**Módulo:** Migración de stack — Fase 4i: KPIs/Analytics, motor de alertas automáticas (`computeAlerts`) — nuevo `backend/apps/analytics/alerts_engine.py`; `backend/apps/analytics/models.py` extendido

Cierra el núcleo de scoring completo de `analytics.ts` (Performance
Score/Equilibrio Operativo/Riesgo Operativo/Capacidad Proyectada, Fases
4e-4h). Era la función de mayor fan-in de todo el archivo — necesitaba
casi todo lo demás ya portado (histórico mensual/semanal, tendencias,
carga por día, capacidad proyectada).

- **`compute_alerts`**: réplica función por función de `computeAlerts`
  — 8 reglas independientes, cada una lee de una fuente distinta ya
  portada: (1) Sobrecarga proyectada/Capacidad crítica según el estado
  de Capacidad Proyectada; (2) Subutilización prolongada — días
  consecutivos con esa clasificación en `compute_carga_history`; (3)
  Tareas vencidas con 2 umbrales configurables (orange/red); (4)
  Cumplimiento a la baja vs. mes anterior, severidad por magnitud de
  la caída; (5) Horas extra de fin de semana inusuales vs. promedio
  histórico; (6) Días consecutivos sobre el rango óptimo; (7) Caída de
  registros diarios (señal sobre el dato, no una inferencia de causa);
  (8) Crecimiento excesivo de actividades de Seguimiento. Ordena por
  severidad (red>orange>yellow>green) y audita de forma minimalista
  (`kind="alerts"`, solo las reglas que dispararon — sin
  `formula_versions` de negocio).
- **`get_resolved_alerts_history`**: lee las últimas 30 auditorías de
  alertas de un usuario y detecta reglas que estaban activas y ya no
  lo están — best-effort, sin logging (réplica fiel del comportamiento
  legacy).
- **`AUDIT_KIND_FORMULAS["alerts"] = []`** (nuevo en `models.py`) —
  mismo mapeo vacío que el TS.
- **Distinto de `compute_risk_alerts`** (`.risk_alerts`, Fase 4b) —
  verificado leyendo ambos: son 2 motores independientes sin
  solapamiento de código. Ese sigue siendo el motor de 4 reglas
  simples que usa `/kpis/me`; este es el motor completo de 8 reglas de
  `analytics.ts`, en un módulo separado a propósito.
- **Sin endpoint HTTP nuevo** — sus consumidores reales
  (`runAnalyticsPipeline`/`/api/analytics/[userId]`, `/api/kpis/nova-insights`)
  integran también Health/Performance/Risk en un solo bundle, fuera de
  alcance de esta sub-fase.
- **Verificación**: 32 tests nuevos (`test_alerts_engine.py`,
  mockeando las 5 dependencias ya probadas para aislar las 8 reglas
  nuevas) — 496 pasando en total (464 previos + 32). Verificación
  adicional con `manage.py shell` contra el usuario sintético
  `kpi_demo`.

## v1.43.0 — 2026-08-11

**Tipo:** FEATURE
**Módulo:** Migración de stack — Fase 4h: KPIs/Analytics, Riesgo Operativo (Operational Risk) — nuevo `backend/apps/analytics/operational_risk.py`; `backend/apps/analytics/models.py` extendido

Última pieza grande del núcleo de scoring (salvo Alertas del motor).
El propio código legacy documenta que esta fórmula tiene un requisito
de negocio explícito de fidelidad exacta (Sprint 5 § S5-C: "prohíbe
modificar reglas/pesos/alertas") — los 8 factores, sus pesos y sus
fórmulas de severidad se copiaron tal cual, sin ajustes.

- **`compute_operational_risk`**: réplica función por función de
  `computeOperationalRisk` — 8 factores de severidad ponderados:
  Sobrecarga proyectada (capacidad negativa), Tareas críticas vencidas
  (prioridad Alta, ×33% cada una), Tendencia negativa de cumplimiento
  (solo si empeoró vs. mes anterior), Horas extras recurrentes (fin de
  semana), Baja capacidad futura (<10% disponible), Variabilidad
  excesiva entre semanas (según nivel de consistencia), Concentración
  en un tipo de actividad de Seguimiento, Muchas tareas sin
  planificación (sin Tiempo Objetivo). Calcula `trend_vs_prev_month` y
  hasta 4 `suggested_actions` condicionales según qué factores
  dispararon.
- **`_compute_seguimiento_concentration`**: riesgo por concentrar el
  tiempo de Seguimiento en un solo motivo — solo si supera 70% del
  tiempo total del mes (`(topPct-70)×3`).
- **`_get_risk_trend_vs_prev_month`**: lee el último
  `AnalyticsAuditLog(kind="operational_risk")` del mes anterior de
  este usuario — best-effort, nunca bloquea el cálculo.
- **`classify_operational_risk`**: 4 bandas (Bajo/Medio/Alto/Crítico)
  con los 3 umbrales configurables (`risk_threshold_*`, Fase 4d).
- **`AUDIT_KIND_FORMULAS["operational_risk"]`** (nuevo en
  `models.py`): mapeo 1:1 a `riesgo_operativo`, ya versionado desde la
  Fase 4e.
- **Sin endpoint HTTP nuevo** — el único consumidor real
  (`/api/analytics/operational-risk/[userId]` y `/team`) integra capas
  adicionales (`confidence`, `trendExplained`, notificaciones de
  equipo) fuera de alcance de esta sub-fase.
- **Verificación**: 26 tests nuevos (`test_operational_risk.py`,
  mockeando las 4 dependencias ya probadas en sus propios archivos —
  Fases 4b/4d/4f — para aislar la orquestación nueva de esta
  sub-fase) — 464 pasando en total (438 previos + 26). Verificación
  adicional con `manage.py shell` contra el usuario sintético
  `kpi_demo`.

## v1.42.0 — 2026-08-11

**Tipo:** FEATURE
**Módulo:** Migración de stack — Fase 4g: KPIs/Analytics, Equilibrio Operativo (Health Score) — nuevo `backend/apps/analytics/health_score.py`; `backend/apps/analytics/models.py` extendido

Segunda de las piezas grandes del núcleo de scoring en portarse
(después de Performance Score, 4e), ahora desbloqueada por Capacidad
Proyectada (4f). Se presentó al usuario la disyuntiva entre Equilibrio
Operativo y Riesgo Operativo (ambas de tamaño similar, ambas
desbloqueadas); eligió Equilibrio Operativo.

- **`compute_health_score`**: réplica exacta de `computeHealthScore` —
  5 factores ponderados (Cumplimiento, Carga laboral, Tareas vencidas,
  Consistencia, Capacidad futura). A diferencia de Performance Score,
  NO pasa por NormalizationEngine/curvas: sus 4 funciones de score
  (`carga_health_score`/`overdue_score` inline/`_consistency_to_score`/
  `capacity_to_score`) ya producen directamente un valor 0-100, solo se
  ponderan con `weighted_points` (Fase 4e). Acepta
  `precomputed_consistency` opcional, mismo criterio que Performance
  Score.
- **`carga_health_score`**: mapea horas reales del mes a 0-100 usando
  los 4 límites REALES de la base horaria (no el % con techo en 100
  del semáforo de exhibición) — Óptimo=100, decrece simétricamente
  hacia ambos extremos.
- **`capacity_to_score`**: el estado `sobrecarga` decrece linealmente
  (`100 + 2×disponiblePct`, acotado a [0,100]) en vez de caer directo a
  0 — único cambio matemático autorizado del Sprint Analytics 2.0
  Bloque 9, portado tal cual.
- **`classify_estado_operativo`** + `ESTADO_OPERATIVO_TIERS`/
  `ESCALA_INTERPRETACION_EQUILIBRIO`: escala de 5 niveles (Equilibrio
  Óptimo/Estable/Requiere Atención/Riesgo Operativo/Desequilibrio
  Crítico) con emoji/color/rango/explicación ejecutiva — capa de
  presentación adicional sobre el score, no reemplaza
  `classification`/`classification_color`.
- **`AUDIT_KIND_FORMULAS["health_score"]`** (nuevo en `models.py`): las
  5 fórmulas involucradas (`equilibrio_operativo`/`carga_laboral`/
  `cumplimiento`/`consistencia`/`capacidad_disponible`), todas ya
  versionadas desde la Fase 4e.
- **Sin endpoint HTTP nuevo** — el único consumidor real
  (`/api/analytics/equilibrio/[userId]`) integra además capas de
  interpretación de `insightsEngine.ts`/`analyticsExplain.ts`, fuera
  de alcance de esta sub-fase.
- **Verificación**: 23 tests nuevos (`test_health_score.py`) — 438
  pasando en total (415 previos + 23). Verificación adicional con
  `manage.py shell` contra el usuario sintético `kpi_demo`.

## v1.41.0 — 2026-08-11

**Tipo:** FEATURE
**Módulo:** Migración de stack — Fase 4f: KPIs/Analytics, Capacidad Proyectada — nuevo `backend/apps/analytics/capacity_forecast.py`; `backend/apps/configuration/services.py` extendido

Con Performance Score cerrado (4e), la siguiente pieza es Capacidad
Proyectada — la dependencia común que faltaba para poder portar
Equilibrio Operativo y Riesgo Operativo (ambos la necesitan; Alertas
del motor también, en una sub-fase posterior). No es una "pieza
grande" del núcleo por sí misma sino infraestructura, igual que 4a/4d.

- **`compute_team_capacity_forecast`**: réplica función por función de
  `computeTeamCapacityForecast` — capacidad disponible para asumir
  NUEVAS tareas, proyección hacia adelante (desde ahora hasta fin de
  mes), no un balance del mes ya transcurrido. Multi-usuario en una
  sola tanda de queries (feriados del año, `LeaveRecord` del mes,
  estado especial, tareas abiertas PENDIENTE/EN_PROGRESO, horas reales
  ya trabajadas del tramo transcurrido) — después un loop en memoria
  por usuario calcula horas restantes hoy (parcial, según hora local
  vs. `workday_end_hour`), días laborables restantes, base futura
  total, comprometido en progreso/pendiente (usa el Tiempo Objetivo
  Validado como referencia oficial cuando existe, nunca horas reales
  como estándar), disponible/disponiblePct y confiabilidad — que
  penaliza SOLO por señales verificables (tareas sin Tiempo Objetivo,
  feriados no configurados este año), nunca infiere permisos por falta
  de actividad registrada (evita falsos positivos).
- **`classify_capacity`**: semáforo de 5 estados (sin-planificación/
  sobrecarga/alta/limitada/no-asignar), función pura.
- **`compute_capacity_forecast`**: wrapper de 1 usuario sobre la
  función de equipo, con el mismo fallback defensivo "sin
  planificación" del legacy.
- **`_build_leave_maps`**: agrupa `LeaveRecord` por usuario y día en
  una sola consulta batcheada — no existía una versión multi-usuario
  de `get_leave_minutes_by_day` (Fase 4a, solo 1 usuario a la vez).
- **`get_effective_workday_end_hour`** (nuevo en
  `apps.configuration.services`): hora local de fin de jornada,
  default 17 — antes de esa hora "hoy" cuenta como parcial en la
  proyección, después arranca desde el siguiente día laborable.
- **Sin endpoint HTTP nuevo** — no existe en el legacy ninguna ruta
  real que expone Capacidad Proyectada de forma aislada; sus
  consumidores (`computeHealthScore`/`computeOperationalRisk`/
  `computeAlerts`/`computeTeamRecommendations`) quedan fuera de
  alcance de esta sub-fase.
- **Verificación**: 21 tests nuevos (`test_capacity_forecast.py`) —
  415 pasando en total (394 previos + 21). Verificación adicional con
  `manage.py shell` contra el usuario sintético `kpi_demo`.

## v1.40.0 — 2026-08-11

**Tipo:** FEATURE
**Módulo:** Migración de stack — Fase 4e: KPIs/Analytics, Performance Score — nuevo `backend/apps/analytics/performance_score.py`; `backend/apps/analytics/scoring.py` y `backend/apps/analytics/models.py` extendidos

Primera de las 4 piezas grandes del núcleo de scoring de `analytics.ts`
en portarse (Health Score, Riesgo Operativo y Alertas del motor
quedan para sub-fases futuras, todas dependientes de Capacidad
Proyectada — `capacityForecast.ts`, todavía sin portar). Performance
Score es la única de las 4 aislable de esa dependencia, por diseño
explícito del código legacy: nunca pondera carga laboral, capacidad
futura ni riesgo operativo — responde una sola pregunta ("¿qué tan bien
está ejecutando su trabajo?").

- **`compute_performance_score`**: réplica exacta de
  `computePerformanceScore` — 4 factores ponderados (Cumplimiento,
  Tareas vencidas, Consistencia, Índice de Trazabilidad), cada uno
  normalizado vía `normalize()`/`get_effective_curve()`
  (`apps.analytics.normalization`, Fase 4d) antes de ponderar. Usa la
  Definición A de "cumplimiento" con `empty_value=100` (a diferencia de
  `/kpis/me`, que usa `empty_value=0`) — sin tareas del mes, el factor
  Cumplimiento parte de 100%, no de 0%. Tareas vencidas de prioridad
  ALTA pesan el doble que las normales. Acepta
  `precomputed_consistency` opcional para no recalcular
  `compute_consistency` cuando se invoque desde un pipeline mayor
  (sub-fase futura).
- **`_compute_trazabilidad_raw`**: Índice de Trazabilidad — mide
  evidencia/documentación del trabajo realizado (NO calidad), 50% días
  con registro + 25% comentarios + 25% actividades documentadas.
- **`classify_performance_score`**: clasificación Excelente/Bueno/
  Riesgo/Crítico, función pura.
- **`weighted_points`/`audit_calculation`** (nuevos en `scoring.py`):
  helpers genéricos reutilizables por las sub-fases siguientes
  (Health Score, Riesgo Operativo). `audit_calculation` calcula
  `formula_versions` desde los nuevos `FORMULA_VERSIONS`/
  `AUDIT_KIND_FORMULAS` (`models.py`) y escribe `AnalyticsAuditLog`,
  best-effort — la `validate_cumplimiento_consistency` de la Fase 4b
  sigue auditando inline (código ya probado, no se refactoriza).
- **Sin endpoint HTTP nuevo** — no existe en el legacy ninguna ruta
  real aislada de solo Performance Score; su único consumidor real es
  `runAnalyticsPipeline` (el bundle completo de `/api/analytics/[userId]`)
  y `/api/kpis/executive`, ambos fuera de alcance por depender también
  de Health Score/Riesgo Operativo.
- **Verificación**: 16 tests nuevos (`test_performance_score.py`,
  ampliaciones a `test_scoring.py`) — 394 pasando en total (378 previos
  + 16). Verificación adicional con `manage.py shell` contra el usuario
  sintético `kpi_demo`.

## v1.39.0 — 2026-08-11

**Tipo:** FEATURE
**Módulo:** Migración de stack — Fase 4d: KPIs/Analytics, infraestructura común para el núcleo de scoring ("Tanda A") — nuevos `backend/apps/analytics/normalization.py`, `backend/apps/analytics/target_time.py`, `backend/apps/analytics/history.py`; `backend/apps/configuration/services.py` y `backend/apps/analytics/scoring.py` extendidos

Investigué el núcleo de scoring de `analytics.ts` (Performance Score,
Riesgo Operativo, Equilibrio, Alertas del motor) antes de tocar código
y encontré que ninguna de esas 4 piezas es portable de forma aislada —
todas dependen de infraestructura común que no existía en Django. Se
presentó la disyuntiva al usuario vía `AskUserQuestion`; eligió portar
esa infraestructura común primero, sin endpoint HTTP todavía (mismo
patrón que la Fase 4a).

- **`apps.analytics.normalization`** (nuevo, puro): réplica exacta de
  `normalizationEngine.ts` — `interpolate_curve`/`normalize` (interpolación
  lineal por tramos, clamada a [0,100]), `DEFAULT_CURVES` (los 6 arrays
  de puntos de control exactos), `is_valid_curve`. También
  `get_effective_curve`/`get_all_effective_curves` (lectura de curvas
  desde `SystemConfigHistory`, JSON) — viven aquí y no en
  `apps.configuration.services` para no invertir la dirección de
  dependencia entre apps (`apps.analytics` depende de
  `apps.configuration`, nunca al revés).
- **`apps.configuration.services.get_effective_analytics_config`**:
  réplica de `getEffectiveAnalyticsConfig` — las 26 claves de
  `ANALYTICS_CONFIG_DEFAULTS` (pesos de Equilibrio/Performance/Riesgo,
  umbrales de bandas de riesgo, alertas, caché, predicción). Ninguna
  función de esta sub-fase consume la mayoría de estas claves todavía
  (las necesitarán Health/Performance/Risk/Alerts, sub-fases futuras) —
  se portan juntas porque comparten una única función/tabla, igual que
  el legacy. Nueva `get_effective_config_string` (genérica, para
  valores no numéricos como el JSON de una curva).
- **`apps.analytics.target_time`** (nuevo, puro — subset de
  `targetTime.ts`): solo `is_target_time_validated`/
  `get_official_target_time`/`compute_precision_pct`/
  `precision_classification` — lo único que consumen
  `compute_data_quality`/`compute_target_time_precision`.
- **`apps.analytics.history`** (nuevo): `compute_monthly_history`/
  `compute_weekly_history` (histórico base de Consistencia/Anomalías/
  Riesgo/Predicción — ninguna de esas 4 piezas se porta en esta
  sub-fase, solo su cimiento), `compute_trends` (mejora/empeoro/estable
  semana-a-semana y mes-a-mes), `compute_effective_history_start` (la
  señal más reciente entre 5 candidatas nunca es `None`),
  `compute_consistency` + sus 3 clasificadores puros
  (`consistency_level_from_cv`/`consistency_pct_from_cv`/
  `consistency_reliability_from_weeks`) — replica fielmente la
  exclusión de semanas anteriores al inicio efectivo del historial, sin
  base laboral, sin registro, o ancladas por permiso/vacaciones de día
  completo (`CONSISTENCY_LOOKBACK_WEEKS = 16`, no 6 como el resto del
  motor). Detectado y replicado a propósito un límite legacy exacto:
  `compute_weekly_history` filtra tareas por `end_date` entre el lunes
  y el viernes a las 00:00 UTC (no fin de día) — una tarea vencida el
  viernes después de medianoche queda fuera de esa semana; mismo
  comportamiento que el TypeScript original, no un bug a corregir.
- **`apps.analytics.scoring.compute_data_quality`/
  `compute_target_time_precision`**: 2 KPIs aditivos de bajo costo,
  réplica exacta — 4 issues posibles de calidad de dato (tareas sin
  estimar, fechas inconsistentes, seguimiento sin actividad, horas
  efectivas nunca configuradas) y precisión del Tiempo Objetivo del mes
  en curso.
- **Sin endpoint HTTP nuevo** — infraestructura pura, mismo criterio
  que la Fase 4a. Las piezas que la consumirían (Health Score/Performance
  Score/Riesgo Operativo/Alertas del motor) son las sub-fases
  siguientes, todavía sin planificar en detalle.
- **Verificación**: 62 tests nuevos (`test_normalization.py`,
  `test_target_time.py`, `test_analytics_config.py`, `test_history.py`,
  `test_consistency.py`, `test_data_quality.py`) — 378 pasando en total
  (316 previos + 62). Verificación adicional con `manage.py shell`
  contra el usuario sintético `kpi_demo` (sembrado en la Fase 4b).

## v1.38.0 — 2026-08-11

**Tipo:** FEATURE
**Módulo:** Migración de stack — Fase 4c: KPIs/Analytics, `GET /api/kpis/me/range` (nuevos `compute_completed_pct_any` en `backend/apps/analytics/scoring.py`, `monthly_business_base_for_users` en `backend/apps/analytics/workload.py`, `build_kpi_range_payload` en `services.py`, `KpiMeRangeView` en `views.py`; `src/app/api/kpis/me/range/route.ts` reescrito)

Cierra los 3 endpoints personales de KPIs (junto con `/kpis/me` y
`/kpis/[userId]` de la Fase 4b) — la sub-fase recomendada y elegida por
el usuario en vez de entrar de lleno al núcleo de scoring de
`analytics.ts` (Performance Score/Riesgo Operativo/Equilibrio/
Predicción), que queda para una sub-fase futura dedicada.

- **`compute_completed_pct_any`** (`scoring.py`): Definición A de
  "cumplimiento" — % de tareas `COMPLETADA` sin importar si fue a
  tiempo, réplica exacta de `computeCompletedPctAny`. Deliberadamente
  distinta e inconsistente con `is_completed_on_time`/Definición B (la
  que usan `/kpis/me`/`/kpis/<id>/`) — mismo gap legacy documentado y
  aceptado en la Fase 4b, no una discrepancia a resolver aquí.
- **`monthly_business_base_for_users`** (`workload.py`): variante
  multi-usuario de `monthly_business_base` (Fase 4a) — si alguno de los
  usuarios pasados tiene un `SpecialStatus` vigente en el mes, su base/
  límites se recalculan con la configuración de ese estado sin afectar
  al resto (`shared`). Reusa `get_team_special_status_day_map`/
  `sum_weighted_base_hours`/`sum_weighted_limit` (ya existentes desde
  4a). A diferencia de `business_base_for_range`, expone `start`/`end`
  en el dict devuelto — este caller sí los necesita (para
  `business_day_real_range`), ningún consumidor anterior los requería.
- **`build_kpi_range_payload`** (`services.py`): orquestador que
  replica el cuerpo completo de la ruta legacy — genera el rango de
  meses, consulta `Task`/`TaskActivity` una sola vez sobre el rango
  completo (no por mes, misma optimización que el legacy) y calcula por
  mes: cumplimiento (Definición A), carga laboral (base dinámica días
  hábiles × horas efectivas vigentes en cada mes, sensible a
  `SpecialStatus` de este usuario), score, tareas vencidas. Agrega
  totales/promedios (excluyendo meses sin tareas de los promedios, no
  arrastrados por un 0% engañoso) y una tendencia simple (mejora/
  deterioro/estancamiento comparando el primer y último mes con datos).
- **`KpiMeRangeView`**: `GET /api/v1/kpis/me/range/?from=YYYY-MM&to=YYYY-MM`,
  validación de forma en la vista (400 si falta algún parámetro, si
  `from >= to`, o si el rango resulta en menos de 2 o más de 24 meses) —
  con un tope defensivo nuevo de esta superficie HTTP (1000 meses antes
  de rechazar) que no cambia el comportamiento para ningún rango
  realista, solo evita iterar sin límite ante una entrada patológica.
- **`djangoKpisAdapter.ts`** reusado sin cambios — el payload de este
  endpoint también es 100% mecánico snake_case→camelCase (verificado
  campo por campo), misma transformación recursiva que 4b.
- **Verificación**: 17 tests nuevos (`test_scoring.py` ampliado,
  `test_workload_range.py`, `test_kpi_range.py`) — 316 pasando en total
  (299 previos + 17). Verificado en vivo contra Django corriendo:
  rango válido de 3 meses, y los 4 casos de rechazo (`from`/`to`
  faltantes, `from >= to`, 1 solo mes, >24 meses).

## v1.37.0 — 2026-08-11

**Tipo:** FEATURE
**Módulo:** Migración de stack — Fase 4b: KPIs/Analytics, primer endpoint real con corte de tráfico (`GET /api/kpis/me`, `GET /api/kpis/[userId]`; nuevos `backend/apps/analytics/{utils,priority_compliance,risk_alerts,scoring,explain,views,urls,services}.py`; `backend/apps/analytics/workload.py` extendido; `backend/apps/configuration/services.py` extendido; `src/lib/djangoKpisAdapter.ts` nuevo; `src/app/api/kpis/me/route.ts` y `src/app/api/kpis/[userId]/route.ts` reescritos)

Cierra la Fase 4a (base horaria sin endpoint) con el primer corte de
tráfico real de KPIs/Analytics. El usuario eligió explícitamente ir
directo por el endpoint completo (`AskUserQuestion`: "Ir directo por
analytics.ts para habilitar el endpoint completo") en vez de la opción
recomendada más acotada — esto significó tocar por primera vez piezas
puntuales de `analytics.ts` (2430 líneas) además de `workload.ts`.

- **`apps.analytics.utils`**: `is_task_overdue`/`utc_calendar_day`,
  réplica de `isTaskOverdue`/`utcCalendarDay` (`utils.ts`).
- **`apps.analytics.priority_compliance`**: `is_completed_on_time`
  (compara por día calendario de negocio, no por instante — mismo fix
  que v1.14.1) y `compute_priority_compliance` (siempre 3 prioridades
  ALTA/MEDIA/BAJA en orden), réplica de `priorityCompliance.ts`.
- **`apps.analytics.risk_alerts`**: `compute_risk_alerts` — 4 alertas
  independientes (tareas vencidas con umbral configurable y escalado
  ×2 a severidad roja, carga laboral en Sobrecarga/Carga elevada,
  tareas por vencer en 3 días, inactividad ≥2 días hábiles omitida si
  el usuario nunca registró actividad), réplica de `riskAlerts.ts`.
  Nueva clave de configuración `analytics_alert_overdue_task_threshold`
  (default 3) en `apps.configuration.services`.
- **`apps.analytics.scoring`**: 3 funciones puntuales de `analytics.ts`
  — `compute_simple_score` (40/20/20/20 ponderado), `compute_estimated_vs_real_ratio`
  (centinela 200), `validate_cumplimiento_consistency` (4 checks de
  coherencia entre cumplimiento general y por prioridad; audita en
  `AnalyticsAuditLog` best-effort, nunca bloquea la respuesta). Resto
  de `analytics.ts` (Performance Score, Riesgo Operativo, Equilibrio,
  Predicción) queda fuera de alcance, para sub-fases futuras.
- **`apps.analytics.explain`**: solo `cumplimiento_color` de
  `analyticsExplain.ts` — el resto del archivo no lo necesita este
  endpoint.
- **`apps.analytics.models.AnalyticsAuditLog`**: nueva tabla append-only
  (`user`/`kind`/`period`/`inputs`/`result`/`engine_version`), mismo
  patrón que `TargetTimeAuditLog`.
- **`apps.analytics.workload`** (completado): `compute_carga_tiempo`/
  `compute_carga_history`/`redact_sensitive_workload_detail` — réplica
  función por función de `computeCargaTiempo`/`computeCargaHistory`/
  `redactSensitiveWorkloadDetail`, incluyendo el ajuste por
  `User.kpi_start_date`, sensibilidad a permisos/estado especial
  vigente hoy (factor proporcional sobre la envolvente completa del
  día), y la redacción de detalle médico/personal/estado especial
  (Art. 26 LOPDP) para viewers que no son el titular ni Administrador.
- **`apps.analytics.services.build_kpi_payload`**: orquestador que
  replica el cuerpo completo de ambas rutas legacy (~95% código
  idéntico) — bounds de mes, `ref_date` capado a "hoy", cumplimiento
  (Definición B, `isCompletedOnTime`), carga laboral (misma fuente que
  `WorkloadCard`, no el ratio estimado-vs-real de las tareas del
  período — fix de v1.20.1 preservado), seguimiento por motivo,
  calidad, actividad, score, horas por semana, histórico de
  cumplimiento de 6 meses (excluye meses sin tareas), comparación con
  el mes anterior (reusa `business_base_for_range` de la Fase 4a).
- **`KpiMeView`/`KpiUserView`** (`apps/analytics/views.py`): `GET
  /api/v1/kpis/me/` sin chequeo de jerarquía (uno mismo, igual que el
  legacy); `GET /api/v1/kpis/<id>/` con 404 si el usuario no existe,
  403 si `not is_visible_to(actor, target_group)` (reusa
  `apps.hierarchy.services`, Fase 1), redacción de detalle sensible
  salvo que el viewer sea el propio titular o Administrador
  (`is_superuser`).
- **`djangoKpisAdapter.ts`** (nuevo, primer adaptador de este tipo en
  la migración): a diferencia de `djangoTasksAdapter.ts` y el resto
  (mapeo campo por campo explícito), este payload es un árbol grande
  (~10 secciones, 100+ campos hoja) en el que CADA clave es una
  traducción 1:1 snake_case→camelCase sin renombres ni
  reestructuración — verificado campo por campo contra `workload.ts`/
  `riskAlerts.ts`/`priorityCompliance.ts` durante la investigación.
  Mapear a mano sería puro boilerplate mecánico sin valor; se usa una
  transformación recursiva genérica, acotada a este único archivo.
- **Fuera de alcance explícito** (documentado para no perder el foco):
  `GET /api/kpis/me/range` (Definición A de "cumplimiento",
  deliberadamente distinta e inconsistente con la Definición B que usa
  este endpoint — mezclar ambas a medio portar generaría confusión);
  resto de `analytics.ts`; `getEffectiveAnalyticsConfig` completo
  (solo se porta `alertOverdueTaskThreshold`).
- **Verificación**: 54 tests nuevos (`test_risk_alerts.py`,
  `test_priority_compliance.py`, `test_scoring.py`,
  `test_workload_carga_tiempo.py`, `test_kpi_views.py`) — 299 pasando
  en total (245 previos + 54). Verificación live contra Django
  corriendo con usuarios/tareas/permisos sembrados: 403 fuera de
  jerarquía visible, 200 con redacción para un superior, 200 sin
  redacción para Administrador/uno mismo, `month` como query param.

## v1.36.0 — 2026-08-11

**Tipo:** FEATURE
**Módulo:** Migración de stack — Fase 4a: KPIs/Analytics, base horaria + dependencias de datos nuevas (app nueva `backend/apps/analytics/` — `workload.py`; `LeaveRecord`/`SpecialStatus` en `backend/apps/configuration/`; `User.kpi_start_date` en `backend/apps/users/`)

Primera sub-fase del motor de KPIs/Analytics (después de cerrar Tareas
por completo en 3a-3f). Porta la base horaria — el cimiento del que
depende casi todo el resto del motor (Performance Score, Riesgo
Operativo, Equilibrio, Predicción, etc.) — y las 3 piezas de datos que le
faltaban a Django para calcularla con fidelidad.

- **`LeaveRecord`/`SpecialStatus`** (nuevos, en `apps.configuration`):
  mismo patrón sin endpoint HTTP que `Holiday` (Fase 3d) — viven bajo
  `/api/settings/**` en el legacy (gate ADMINISTRADOR), cortar esas
  rutas reales crearía el mismo split-brain Postgres/SQL-Server ya
  evitado en 3d. Se gestionan vía Django Admin.
- **`User.kpi_start_date`**: mismo campo que el Prisma original (ajuste
  puntual del Administrador sobre desde cuándo calcular los KPIs de un
  usuario).
- **`apps.configuration.services`**: `get_leave_minutes_by_day`/
  `leave_hours_for_day`/`total_leave_minutes` (réplica de `leaves.ts`),
  `get_special_status_day_map`/`get_team_special_status_day_map`
  (réplica de `specialStatus.ts`); `business_base_for_range` (Fase 3d)
  se completa con los campos de límites que le faltaban — puramente
  aditivo, `MonthClosureService` sigue sin cambios.
- **App nueva `apps.analytics`** (hogar de todas las sub-fases futuras
  de este motor): `workload.py` — `sum_weighted_base_hours`/
  `sum_weighted_limit` (sumas ponderadas día a día, sensibles a permisos/
  estado especial), `compute_workload_range` (semáforo de 5 zonas),
  `compute_workload_pct`, `get_month_closure_period`/
  `monthly_business_base` (Motor de Cierre Inteligente aplicado a la
  base horaria — depende de `apps.tasks.MonthClosure`, ya migrado).
- **Sin endpoint HTTP en esta sub-fase** (mismo criterio que 3d/3f para
  infraestructura sin consumidor todavía) — `compute_carga_tiempo`/
  `compute_carga_history` (los orquestadores que sí consultan `Task`/
  `TaskActivity`) quedan para la sub-fase siguiente, junto con el primer
  endpoint real de KPIs.

**Verificación**: 245 tests de Django (219 + 26 nuevos) pasando;
verificado además directamente en `manage.py shell` contra la base
compartida con datos sintéticos (permiso parcial descontando la base
horaria, `monthly_business_base` de un mes sin cierre y truncado por un
cierre EARLY).

**Impacto:** ninguno sobre producción — infraestructura pura, sin
endpoint ni consumidor real todavía. La comparación en paralelo
Next.js↔Django que pide el roadmap para esta fase queda pendiente de la
importación real de datos (diferida). Ver `docs/AUDIT_LOG.md` §
2026-08-11 (Fase 4a).

---

## v1.35.0 — 2026-08-11

**Tipo:** FEATURE
**Módulo:** Migración de stack — Fase 3f: Notification, registro retroactivo, comentarios de actividad, edición por Admin de horas (`backend/apps/notifications/` nueva app; `backend/apps/tasks/` — `ActivityComment`, `ActivityAuditLog`, `ActivityService.create_retroactive_activity`/`admin_edit_activity`/`delete_activity`, `ActivityCommentService`; `src/app/api/tasks/[id]/activities/retroactive/route.ts`, `.../[activityId]/route.ts`, `.../[activityId]/comments/route.ts`)

Cierra el módulo Tareas de la migración de stack: última sub-fase
pendiente de la hoja de ruta. Introduce `Notification` en Django y usa
esa infraestructura nueva para cerrar 2 gaps ya documentados en fases
previas (comentarios de tarea desde la 3a, cambio de Fecha Fin desde la
3c), además de las 3 funcionalidades nuevas de horas.

- **App nueva `apps.notifications`** (`Notification`, `notify`/
  `notify_many`): sin endpoints HTTP, mismo criterio que `Holiday` en la
  Fase 3d — `/api/notifications` real sigue 100% en Postgres, alimentado
  también por módulos todavía no migrados (Reuniones, Proyectos); cortarlo
  mostraría una lista incompleta a usuarios reales. Los datos SÍ se crean
  correctamente en Django, solo no llegan todavía a la campanita real.
- **Reglas de notificación con su valor DEFAULT hardcodeado**
  (`commentTargets` = `RoleNotificationTarget`, ya sembrado 1:1 desde la
  Fase 1; `retroactiveNotifyRoles` = `["COORDINADOR_NACIONAL"]`): no
  configurable vía Django, mismas razones que la Fase 3d
  (`/api/settings/notification-rules` sigue en Postgres).
- **Cierra 2 gaps ya documentados**: `CommentService.create_comment`
  notifica "hacia arriba" según `RoleNotificationTarget` + preview de 60
  caracteres (gap de la Fase 3a); `EndDateService.apply_action` notifica
  al colaborador en MODIFICADA/RECHAZADA con el mensaje exacto recuperado
  de `notifyEndDateChange` legacy vía `git show` (gap de la Fase 3c).
- **Registro retroactivo** (`ActivityService.create_retroactive_activity`):
  ventana de días hábiles + gracia de fin de semana lunes/martes
  (`retroactive_valid_dates`, portado 1:1 a `business_time.py`), solo
  tareas SEGUIMIENTO, `created_at` backdateado al día real elegido (mismo
  truco que el legacy, para que cálculos futuros que agrupen por
  `created_at` no necesiten cambios), notifica a
  `retroactiveNotifyRoles` (sin excluir al propio actor — igual que el
  legacy, verificado en código).
- **Edición por Admin de horas** (`admin_edit_activity`): solo
  `ADMINISTRADOR` (`is_superuser`), crea `ActivityAuditLog` (append-only,
  `activity_id` suelto sin FK), notifica al responsable de la tarea.
- **Comentarios de actividad** (`ActivityCommentService`): notificación
  BIDIRECCIONAL (autor de la actividad + cualquier comentarista previo,
  sin importar jerarquía), excluyendo siempre al propio actor.
- **`_count.comments`/`adminComment`/`modifiedByAdmin`/`modifiedAt`** en
  `djangoTasksAdapter.ts`: dejan de ser gaps hardcodeados, usan los
  valores reales que Django ya devuelve.

**Verificación**: 219 tests de Django (186 + 33 nuevos) pasando; flujo
completo probado directamente contra Django real (registro retroactivo,
edición por Admin con gate 403 para no-superusuario, hilo de comentarios,
y las 3 `Notification` resultantes confirmadas por contenido exacto).

**Impacto:** ninguno sobre producción — mismo estado que las sub-fases
previas. Con esta entrega, **todas las sub-fases de Tareas (3a-3f) quedan
migradas** — el módulo completo de Tareas está ahora servido por Django,
con Postgres/Prisma como única fuente de datos reales hasta que se decida
importarlos. Ver `docs/AUDIT_LOG.md` § 2026-08-11 (Fase 3f).

---

## v1.34.0 — 2026-08-07

**Tipo:** FEATURE
**Módulo:** Migración de stack — Fase 3e: import/export Excel de Tareas (`backend/apps/tasks/` — `task_import.py`, `TaskImportService`, `TaskImportView`, `TaskTemplateView`; `src/app/api/tasks/import/route.ts`, `.../template/route.ts`; `src/lib/djangoSession.ts`)

Porta la plantilla descargable y el importador masivo de tareas por
Excel. El "export de seleccionadas" (`TableView.tsx`) no requirió ningún
cambio: es 100% client-side (SheetJS en el navegador) y ya opera sobre
datos servidos por Django desde la Fase 3a.

- **`task_import.parse_date`**: réplica 1:1 de `parseDate` legacy —
  `YYYY-MM-DD`, `DD/MM/YYYY`/`MM/DD/YYYY` ambiguo (con el mismo orden de
  fallback), serial numérico de Excel, y objetos `date`/`datetime`
  nativos (`openpyxl` los entrega directamente para celdas con formato de
  fecha real, a diferencia de SheetJS que da un serial — mismo resultado
  final, camino distinto).
- **`TaskImportService.import_rows`**: mismo orden exacto de
  validaciones/mensajes que el legacy, cada fila independiente (sin
  transacción global, nunca aborta el batch completo), solo CREATE
  (nunca actualiza), auto-asignación al actor si no viene email,
  normalización silenciosa de `type` a `FIJA` si es inválido. Única
  mejora (no cambia el contrato): se loggea con `logger.exception` antes
  de reportar un error de fila por excepción en la creación.
- **`callDjango` (`djangoSession.ts`)**: ajuste mínimo y compatible hacia
  atrás — ya no fuerza `Content-Type: application/json` cuando el body es
  `FormData`, necesario para reenviar el archivo subido a Django tal
  cual. Cero cambio para los llamadores existentes (ninguno pasa
  `FormData`).

**Verificación**: 186 tests de Django (166 + 20 nuevos) pasando; plantilla
descargada y archivo de prueba con filas válidas e inválidas mezcladas
subido directamente contra Django real (autoasignación, normalización de
`type`, fecha `DD/MM/YYYY`, título vacío y prioridad inválida rechazados
sin abortar el resto del archivo).

**Impacto:** ninguno sobre producción — mismo estado que las sub-fases
previas. Queda en la hoja de ruta 3f (notificaciones + registro
retroactivo/comentarios de actividad/edición por Admin de horas). Ver
`docs/AUDIT_LOG.md` § 2026-08-07 (Fase 3e).

---

## v1.33.0 — 2026-08-07

**Tipo:** FEATURE
**Módulo:** Migración de stack — Fase 3d: Motor de Cierre Inteligente (`backend/apps/tasks/` — `MonthClosure`, `closure.py`, `MonthClosureService`; `backend/apps/configuration/` nueva app — `Holiday`/`SystemConfigHistory`; `src/app/api/tasks/close-month/route.ts`, `.../[id]/correct/route.ts`, `src/app/api/repository/route.ts`, `.../[year]/[month]/route.ts`)

Cierra el archivado mensual de tareas, la duplicación de recurrentes, las
correcciones de Admin sobre archivadas y las pantallas de solo-lectura del
Repositorio — porción de negocio que 3a-3c-bulk dejaron pendiente.

- **App nueva `apps.configuration`** (`Holiday`/`SystemConfigHistory` +
  funciones "vigente a la fecha"): alcance ampliado deliberadamente sobre
  el plan original de 3d (decisión explícita del usuario) para que
  `calendar_days_considered`/`working_days_considered`/`working_hours_
  considered` sean reales en vez de aproximados o en 0. **Límite explícito
  de este alcance**: sin endpoints HTTP — se gestionan solo vía Django
  Admin, y NO se cortan `/api/settings/holidays`/`/api/settings/workload-
  config` reales (evita un split-brain Postgres/SQL Server sobre
  configuración que el motor de Analytics real, todavía 100% Next.js,
  sigue leyendo de Postgres).
- **`MonthClosureService`**: `preview`/`execute` (archivado siempre
  anclado al fin de mes calendario natural, nunca al `cutoff_date` —
  verificado en el código real que `calendar_days_considered` es
  literalmente `cutoff_date.day`, no un cálculo de rango);
  `correct_archived_task` (dedupe de valores idénticos, ajuste de
  `progress`/`completed_at` por estado, *append* a `MonthClosure.corrections`
  o log de advertencia si no existe el cierre asociado).
- **`CanCloseMonth`** (`usuarios.editar`, verificado equivalente a
  `CAN_MANAGE_USERS` legacy) vs **`IsAdministrador`** (`is_superuser`,
  nuevo, en `apps.core` — gate de `/correct`, más estrecho).
- **Gap de visibilidad en Repositorio** (mismo patrón ya aceptado en 3a):
  sin `apps.hierarchy` conectado a las vistas, cada usuario ve solo sus
  propias tareas archivadas, nunca las de subordinados por jerarquía.

**Verificación**: 166 tests de Django (138 + 28 nuevos) pasando; ciclo
completo probado directamente contra Django real (preview, cierre con
duplicación de recurrentes y continuidad de Seguimiento activas, doble
cierre → 409, corrección de Admin con auditoría en `MonthClosure`, gate
`usuarios.editar` vs `is_superuser`, Repositorio con el gap de visibilidad
confirmado).

**Impacto:** ninguno sobre producción — mismo estado que las sub-fases
previas (lista de tareas vacía para usuarios reales hasta la importación).
Ver `docs/AUDIT_LOG.md` § 2026-08-07 (Fase 3d).

---

## v1.32.0 — 2026-08-07

**Tipo:** FEATURE
**Módulo:** Migración de stack — Fase 3c-bulk: operaciones en bloque de Tiempo Objetivo/Fecha Fin + listado combinado de pendientes (`backend/apps/tasks/` — `CanRegularize`, `TargetTimeService.bulk_validate`/`data_quality`, `EndDateService.bulk_approve`/`data_quality`, `TaskValidationService`, `src/app/api/tasks/target-time/bulk-validate/route.ts`, `.../end-date/bulk-approve/route.ts`, `.../validations/pending/route.ts`)

Cierra la sub-fase que 3c dejó pendiente: las operaciones EN BLOQUE que
alimentan `RegularizeTargetTimeManager.tsx` (única pantalla consumidora),
sin las cuales esa pantalla quedaba sin backend real tras el cutover.

- **`CanRegularize`** (permission class nueva): `CAN_REGULARIZE` legacy
  (ADMINISTRADOR + JEFE_NACIONAL) es MÁS ESTRECHO que `usuarios.editar`
  (que además incluye COORDINADOR_NACIONAL) — los 3 endpoints usan este
  gate más restringido, a diferencia de la validación individual de 3c.
- **`TargetTimeService.bulk_validate`/`EndDateService.bulk_approve`**:
  reutilizan `apply_validation`/`apply_action` por tarea (mismo criterio
  que el legacy reusando `applyTargetTimeValidation`/`applyEndDateAction`
  también en sus bulks); tareas auto-asignadas y `task_id` inexistentes
  se omiten en silencio y se reportan aparte (`skipped_self_assigned`/
  `skipped_invalid_date`).
- **`TargetTimeService.data_quality`/`EndDateService.data_quality`**: %
  de calidad del dato sobre tareas "activas o recientes" (≤60 días
  archivadas); réplica deliberada de una discrepancia del legacy: Fecha
  Fin cuenta RECHAZADA como "no pendiente" (se porta la implementación
  real, no el comentario del código original).
- **`TaskValidationService.list_pending`**: combina ambas dimensiones
  (Tiempo Objetivo O Fecha Fin pendiente) en una sola consulta, con
  filtros opcionales `user_id`/`role`/`type` — valores inválidos se
  ignoran, nunca producen una lista vacía espuria.
- **Next.js**: las 3 rutas dejan de usar el `CAN_REGULARIZE` propio
  (Postgres) — la autorización real pasa a vivir 100% en Django, mismo
  criterio ya adoptado para la validación individual en 3c.

**Verificación**: 138 tests de Django (118 + 20 nuevos) pasando; los 3
endpoints probados directamente contra Django real con un usuario
JEFE_NACIONAL (bulk-validate con auto-asignada e id inexistente
omitidos, bulk-approve con MODIFICAR/APROBAR/auto-asignada, listado
combinado con filtros y % de calidad); un usuario con `usuarios.editar`
pero sin `CanRegularize` (COORDINADOR_NACIONAL) confirmado en 403 en los
3 endpoints.

**Impacto:** ninguno sobre producción — mismo estado que 3a/3b/3c (lista
de tareas vacía para todos los usuarios reales hasta la importación
real). Queda en la hoja de ruta la notificación al colaborador (depende
de `Notification`, todavía no migrado). Ver `docs/AUDIT_LOG.md` §
2026-08-07 (Fase 3c-bulk).

---

## v1.31.0 — 2026-08-07

**Tipo:** FEATURE
**Módulo:** Migración de stack — Fase 3c: validación de Tiempo Objetivo y Fecha Fin (`backend/apps/tasks/` — `TargetTimeAuditLog`/`EndDateAuditLog`/`TargetTimeService`/`EndDateService`, `src/app/api/tasks/[id]/target-time/route.ts`, `.../end-date/route.ts`)

Continúa 3a/3b agregando la validación individual (sin operaciones en
bloque todavía) de los dos campos de gobierno sobre `Task`: Tiempo
Objetivo y Fecha Fin, cada uno con su log de auditoría append-only.

- **`Task`**: se agregan `target_time_validated_at`/`_by` y
  `end_date_approval_status`/`_approved_at`/`_by` (3a los había dejado
  explícitamente pendientes).
- **`TargetTimeAuditLog`/`EndDateAuditLog`** (nuevos): `task_id` como
  `IntegerField` suelto, sin FK — mismo patrón deliberado que Prisma
  (sobrevive al borrado de la tarea), ya usado en el diseño de 3a/3b.
- **Simplificación de autorización validada, no asumida**: `usuarios.editar`
  es exactamente el mismo conjunto de roles que `CAN_VALIDATE_TARGET_TIME_
  ROLES` legacy en el estado actual del catálogo (sembrado en la Fase 1) —
  autorizar con `usuarios.editar` + "no soy el propio responsable" es
  equivalente, sin necesidad de hardcodear nombres de rol en Django.
- **`TaskService.update_task` (3a, extendido)**: si `end_date` cambia de
  valor y la Fecha Fin ya había sido decidida, se reinicia a `PENDIENTE`
  y se audita como `PROPUESTA` — mismo comportamiento que
  `pendingResetTaskData`/`createEndDateProposalAuditLog` legacy.
- **Desviación histórica del proceso**: promedio de `real_hours` de hasta
  40 tareas `COMPLETADA` con el mismo título, portado 1:1.
- **Gap documentado**: la notificación al colaborador cuando su Fecha Fin
  es MODIFICADA/RECHAZADA no se replica todavía (`Notification` no existe
  en Django).

**Verificación**: 118 tests de Django (105 + 13 nuevos) pasando; flujo
completo probado directamente contra Django real (auto-validación
rechazada, validación exitosa con auditoría, aprobación de Fecha Fin,
reinicio a Pendiente al reeditar `end_date`).

**Impacto:** ninguno sobre producción — mismo estado que 3a/3b (lista de
tareas vacía para todos los usuarios reales hasta la importación real).
Quedan en la hoja de ruta las operaciones en bloque y la notificación al
colaborador. Ver `docs/AUDIT_LOG.md` § 2026-08-07 (Fase 3c).

---

## v1.30.0 — 2026-08-07

**Tipo:** FEATURE
**Módulo:** Migración de stack — Fase 3b: registro de horas (`backend/apps/tasks/` — `ActivityReason`/`TaskActivity`/`business_time.py`/`ActivityService`, `src/app/api/tasks/[id]/activities/route.ts`, `src/app/api/activity-reasons/route.ts`)

Continúa la Fase 3a (Task/Comment) agregando el registro de horas que
calcula `Task.realHours`. Mismo vertical slice acotado: sin registro
retroactivo, comentarios de actividad, edición por Admin ni Cierre
Inteligente (quedan en la hoja de ruta).

- **Modelos nuevos**: `ActivityReason` (`assigned_roles` como
  `JSONField` — SQL Server no tiene array nativo tipo Postgres);
  `TaskActivity` (sin `admin_comment`/`modified_by_admin`, sub-fase futura).
- **`business_time.py`** (nuevo, puro): `business_calendar_day`/
  `business_day_real_range`/`time_to_minutes`/`ranges_overlap` — portados
  1:1 de `src/lib/businessTime.ts`/`src/lib/timeOverlap.ts` (mismo offset
  de negocio de 5 horas).
- **`ActivityService.create_activity`**: replica el orden exacto de
  validaciones legacy — motivo existe/activo/asignado al rol del actor;
  rango de horas/minutos; límite de 2 actividades por tarea Fija;
  detección de solapamiento horario contra TODAS las actividades del
  mismo autor ese día de negocio en tareas Seguimiento (nunca Fija); crea
  la actividad y recalcula `Task.real_hours`.
- **Omitido a propósito (no es un gap, no aplica)**:
  `migrateFijaHistoryIfNeeded` — migración perezosa legacy para conciliar
  horas sueltas de tareas Fijas anteriores al modelo `TaskActivity` de
  Postgres; los `Task` de Django son todos nuevos, sin ese historial.
- **Gap documentado**: Django devuelve 400 uniforme para todas las
  validaciones de `ActivityService` (el legacy distinguía 400 de 409 según
  el tipo de error) — sin impacto funcional conocido, ningún componente
  distingue por código de estado.
- **Datos de prueba**: 3 `ActivityReason` placeholder (`trabajo_general`,
  `reunion`, `capacitacion`), asignados a los 11 roles — no el catálogo
  real de Postgres.

**Verificación**: 105 tests de Django (93 + 12 nuevos) pasando; endpoints
probados directamente contra Django real (crear actividad con horario,
recálculo de `real_hours`, solapamiento rechazado, catálogo de motivos).

**Impacto:** ninguno sobre producción — mismo estado que la Fase 3a (lista
de tareas vacía para todos los usuarios reales hasta la importación real).
Ver `docs/AUDIT_LOG.md` § 2026-08-07 (Fase 3b).

---

## v1.29.0 — 2026-08-07

**Tipo:** FEATURE
**Módulo:** Migración de stack — Fase 3a: módulo Tareas, CRUD core + comentarios (`backend/apps/tasks/`, `src/app/(protected)/tasks/page.tsx`, `src/app/api/tasks/**`, `src/lib/djangoTasksAdapter.ts`)

Primer corte del módulo más complejo de Nexo (~18 rutas API en total,
investigación completa por 3 agentes). Alcance deliberadamente acotado a un
vertical slice completo: ver/crear/editar/eliminar tareas y comentar,
servido por Django — sin registro de horas, validación de Tiempo
Objetivo/Fecha Fin, operaciones en bloque, Cierre Inteligente ni
import/export Excel (quedan en la hoja de ruta de sub-fases, ver
`docs/ROADMAP.md`).

- **Modelos Django nuevos** (`apps.tasks`, no toca el esquema de
  skelleton_base): `Task` (campos core, sin los de gobierno de Fecha Fin
  todavía), `Comment`, `TaskCommentView`.
- **Permisos**: `TaskService.can_access` (ver/editar/comentar: asignado,
  creador, o `usuarios.editar`) y `TaskService.can_delete` (eliminar: MÁS
  ESTRECHO, solo creador o `usuarios.editar` — el asignado no puede borrar,
  igual que el Next.js legacy). Reusa el permiso `usuarios.editar` del
  catálogo de la Fase 1 en vez de crear uno nuevo solo para Tareas.
- **`src/app/(protected)/tasks/page.tsx`** (Server Component que antes
  consultaba Prisma directamente, sin pasar por `/api/tasks`): pasa a leer
  de Django (`fetchOwnDjangoTasks`) y a reusar `fetchAllDjangoUsers` de la
  Fase 2 para los usuarios asignables. `viewPreferences` sigue en Postgres
  (preferencia de Usuario, no de Tarea).
- **`/api/tasks`, `/api/tasks/[id]`, `/api/tasks/[id]/comments`**: cortados
  a Django sin tocar ningún componente React del módulo (`TasksModule.tsx`
  y el resto de `src/components/tasks/` quedan intactos).
- **Gaps explícitos y documentados de esta sub-fase**: las notificaciones
  al asignar/comentar una tarea no se replican todavía (`Notification` no
  existe en Django); un gerente que hoy edita la tarea de un subordinado
  por jerarquía (`getVisibleRoles`) en esta sub-fase solo puede hacerlo si
  además tiene `usuarios.editar` (`apps.hierarchy` no está conectado a las
  vistas de Tareas); `currentUserId` que recibe `TasksModule` sigue siendo
  el id de Postgres (no el de Django) porque `PATCH /api/users/[id]/
  view-preferences` — fuera de alcance, sigue en Prisma — depende de él;
  efecto: las comparaciones "¿esta tarea es mía?" dentro de los componentes
  de Tareas no coinciden todavía, sin impacto real mientras la lista esté
  vacía (ver punto siguiente).
- **Decisión explícita del usuario, con la consecuencia ya aceptada**:
  cortar `/api/tasks` ya, sabiendo que **todo usuario real verá su lista de
  tareas vacía** hasta que se importen las tareas reales de Postgres (fase
  futura) — mismo patrón que usuarios en la Fase 2, aplicado ahora a un
  módulo de blast radius mucho mayor (100% de los usuarios).

**Verificación**: 93 tests de Django (81 + 12 nuevos) pasando; cada
endpoint verificado directamente contra Django real (login, crear, listar,
editar campo propio, comentar, eliminar) con resultados idénticos a los
que esperan los adaptadores de Next.js. Pendiente, sin bloquear: prueba
end-to-end con Next.js real corriendo (mismo límite que la Fase 2 — sin
credenciales de Postgres en esta sesión).

**Impacto:** ninguno sobre producción hoy (la lista de tareas de Django
está vacía para todos hasta la importación real). Ver `docs/AUDIT_LOG.md`
§ 2026-08-07 (Fase 3a).

---

## v1.28.0 — 2026-08-07

**Tipo:** FEATURE / SECURITY
**Módulo:** Migración de stack — Fase 2: Cutover de Usuarios/Roles/Permisos (`src/app/api/auth/login/route.ts`, `src/app/api/users/**`, `src/lib/djangoSession.ts`, `src/lib/djangoUsersAdapter.ts`)

Primera fase que modifica código real de Next.js desde que arrancó la
migración de stack (Fase 1, v1.27.0). El login real de producción **sigue
decidiéndose 100% contra Postgres/bcrypt, sin cambios** — esta fase solo
agrega una llamada paralela, no bloqueante, a Django en cada login exitoso,
y corta el admin de usuarios (`/admin/users`, sin tocar sus componentes
React) para que hable con Django en vez de Prisma.

- **Login paralelo** (`src/lib/djangoSession.ts`, nuevo): tras la validación
  real, `establishDjangoSession(email, password)` intenta loguear las mismas
  credenciales en Django y guarda el par de tokens en cookies httpOnly
  (`nexo-django-access`/`nexo-django-refresh`) — con timeout de 3s y
  try/catch que nunca puede afectar la respuesta del login real (Django
  todavía solo tiene usuarios de prueba, no los reales de Postgres).
  `djangoApiFetch()` reintenta una vez tras refrescar el access token si la
  primera respuesta es 401 — mismo patrón que el interceptor de axios ya
  construido en el frontend de la Fase 1.
- **`/api/users` y `/api/users/[id]`**: pasan de leer/escribir Prisma a
  llamar a los endpoints ya existentes de Django (`/admin/users/`,
  `/admin/roles/`), traduciendo la forma de los datos — `UsersManager.tsx`
  y `admin/users/page.tsx` NO cambiaron, siguen recibiendo
  `{id, name, email, role, createdAt}` como siempre. La visibilidad
  jerárquica (`getVisibleRoles`) se aplica como post-filtro en TypeScript
  sobre la respuesta de Django, que todavía no conoce `apps.hierarchy`
  (decisión explícita: no wirear la jerarquía dentro de las vistas de
  Django en esta fase).
- **Cambios de comportamiento explícitos** (heredados del diseño de
  seguridad de skelleton_base, no relajado):
  - Contraseña inicial de un usuario nuevo: `"NexoTemporal2026!"` en vez de
    `"123456"` (que no pasa los validadores de Django: mínimo 10
    caracteres, no puede ser solo numérica). Corregido el texto estático en
    `UsersManager.tsx` que anunciaba el valor viejo.
  - `DELETE /api/users/[id]` ya no elimina físicamente — llama
    `POST /admin/users/{id}/disable/` (baja lógica). Elimina además el
    caso de error `P2003` ("tiene registros asociados") que ya no puede
    ocurrir.
  - `POST /api/users/[id]/reset-password` ya no fija una contraseña
    conocida — llama al reset administrativo de Django con
    `force_change_on_next_login: true, revoke_sessions: true`; el admin
    nunca vuelve a conocer la contraseña nueva del usuario. Corregido el
    tooltip en `PasswordManagementSection.tsx`.
- **Datos de prueba en Django**: se sembraron (`manage.py shell`, no una
  migración) los 2 usuarios ya documentados como seed de Nexo
  (`jefe@nexo.com`/`coord.nacional@nexo.com`, password `123456`) para poder
  ejercitar el puente de login paralelo con credenciales reales de
  Postgres. No se importaron usuarios reales — decisión explícita del
  usuario, queda para una fase posterior.

**Verificación**: 81 tests de Django sin cambios (no se tocó nada del lado
Django, solo se consumen endpoints ya existentes); cada endpoint que llaman
las rutas nuevas de Next.js se probó por separado contra Django real (login,
listado paginado, listado de roles, crear, editar perfil, cambiar rol,
deshabilitar, resetear contraseña, 404/401) con resultados idénticos a lo
que el código espera. **Pendiente** (decisión explícita del usuario, no
bloqueante): la prueba end-to-end con el Next.js real corriendo contra
Postgres real — se hará cuando el usuario provea esas credenciales o se
decida la importación de datos reales.

**Impacto:** el login real de todos los usuarios no cambia. Solo los 3
roles con `usuarios.*` (ADMINISTRADOR/JEFE_NACIONAL/COORDINADOR_NACIONAL)
ven un comportamiento distinto en `/admin/users`, y solo verán ahí los
usuarios de prueba de Django hasta la importación real. Ver
`docs/AUDIT_LOG.md` § 2026-08-07 (Fase 2).

---

## v1.27.0 — 2026-08-07

**Tipo:** FEATURE / DATABASE
**Módulo:** Migración de stack — Fase 1: núcleo de seguridad (`backend/`, `frontend/`, `docker-compose.yml`)

Primera fase de una migración de stack de varios meses (strangler,
incremental) hacia la tecnología de seguridad de la plantilla externa
`skelleton_base` (Django 5.1 + DRF, SQL Server, Argon2, JWT con revocación
real de sesión, catálogo de permisos granular). **El Next.js/Prisma/
PostgreSQL actual sigue intacto y sirviendo el 100% del tráfico de
producción** — esta fase construye el núcleo nuevo en paralelo, sin
cortar nada; el cutover real de tráfico es una fase futura de la hoja de
ruta (ver `docs/AUDIT_LOG.md` § 2026-08-07 y `docs/DECISIONS.md`).

- **Backend Django nuevo** (`backend/`): apps `core`, `permissions`,
  `authentication`, `users`, `roles` portadas de `skelleton_base` (sesión
  revocable con detección de reutilización de refresh rotado, protección
  de fuerza bruta timing-safe, protección de "último admin activo",
  catálogo de permisos cerrado `usuarios.*`/`roles.*`/`permisos.ver`/
  `auditoria.*`). Se excluyó `apps.branding` (no aporta al dominio de
  Nexo).
- **App nueva `apps.hierarchy`** (propia de Nexo, no existe en
  `skelleton_base`): modelos `RoleVisibility`/`RoleNotificationTarget` +
  migración de datos que siembra los 11 roles de Nexo como `auth.Group` y
  copia EXACTAMENTE `VISIBLE_ROLES`/`NOTIFICATION_TARGETS` de
  `src/lib/roles.ts` (44 + 12 filas) — jerarquía modelada como datos, no
  como código, porque el catálogo de permisos de `skelleton_base` es
  deliberadamente plano. `ROLE_LEVEL` (nivel numérico) se descarta como
  concepto: las 10 funciones de autorización legacy nunca fueron
  consistentes con un solo nivel.
- **Fix de causa raíz en `skelleton_base` heredado**: la migración de
  datos de `apps.roles` (siembra del rol "Superusuario") asumía que los
  `Permission` del catálogo ya existían, pero Django solo los crea en la
  señal `post_migrate`, emitida una única vez al FINAL de cada invocación
  de `migrate` — nunca entre migraciones de la misma invocación. Rompía en
  una base de datos nueva migrada de una sola vez (reproducido con
  pytest-django). Solucionado invocando `create_permissions` manualmente
  antes de leer el catálogo, en `apps/roles/migrations/0001_initial.py` y
  `apps/hierarchy/migrations/0002_seed_nexo_roles.py`.
- **Migración de usuarios legacy** (`apps/users/management/commands/
  migrate_users_from_postgres.py`): importa la tabla `User` de Postgres
  (solo lectura) con fallback perezoso bcrypt→Argon2 — el hash bcryptjs se
  importa con el prefijo `"bcrypt$"` que exige `BCryptPasswordHasher`, y
  Django lo re-encripta a Argon2 automáticamente en el primer login
  exitoso, sin resetear contraseñas ni acción del usuario. Campo nuevo
  `User.legacy_postgres_id` para que fases futuras resuelvan FKs sin unir
  ambos motores en vivo.
- **Frontend React nuevo** (`frontend/`, Vite): `AuthContext`/`usePermission`/
  `RequirePermission` portados de `skelleton_base`, más pantalla de login y
  shell mínimo de listado de usuarios/roles — solo para probar el flujo de
  punta a punta, sin pantallas de negocio.
- **SQL Server** vía `docker-compose.yml` (nuevo, raíz del repo) — conviven
  dos motores de base de datos durante toda la migración: PostgreSQL sigue
  siendo la única fuente de verdad de los datos de negocio.
- Tests: 81 pasando (75 portados de `skelleton_base` + 6 nuevos — 3 de
  regresión que comparan la siembra de `hierarchy` contra `roles.ts` en
  cada corrida, y 3 del flujo bcrypt-import→login→Argon2).

**Impacto:** ninguno sobre producción (Next.js/Prisma/PostgreSQL sin
cambios, verificado por diff vacío en `src/`/`prisma/`). Sienta la base de
seguridad (revocación de sesión, catálogo de permisos, Argon2) para las
13 fases de negocio siguientes de la hoja de ruta.

---

## v1.26.0 — 2026-08-03

**Tipo:** FEATURE
**Módulo:** Aprobación masiva de Fecha Fin con edición por fila (`src/app/api/tasks/end-date/bulk-approve/route.ts`, `src/components/tasks/RegularizeTargetTimeManager.tsx`)

Extiende la aprobación masiva de Fecha Fin (v1.25.0/v1.25.1, que solo
aprobaba en bloque la fecha ya propuesta) para permitir al líder **editar la
Fecha Fin de cada actividad seleccionada, individualmente, antes de
aprobar** — sin tener que entrar tarea por tarea.

- **Modal de revisión masiva** (`BulkApproveEndDateModal`, reescrito):
  tabla con Actividad/Colaborador/Fecha Inicio/Fecha Fin actual/Nueva Fecha
  Fin (editable, prellenada con el valor actual) por cada tarea
  seleccionada. Si el líder no toca una fila, se mantiene la fecha
  original.
- **Confirmación solo cuando hay cambios**: al continuar, si alguna fila
  fue editada, se muestra un paso de confirmación listando cada cambio
  ("La Fecha Fin de «X» será modificada de DD/MM/YYYY a DD/MM/YYYY") antes
  de ejecutar; si ninguna fila cambió, aprueba directamente sin ese paso
  extra.
- **`POST /api/tasks/end-date/bulk-approve`** cambia su contrato de
  `{ taskIds }` a `{ items: [{ taskId, newEndDate? }] }` (único consumidor,
  sin necesidad de compatibilidad hacia atrás): por cada ítem, si
  `newEndDate` coincide con el valor vigente de la tarea se aplica como
  `APROBAR` (sin cambio, sin notificar); si difiere, como `MODIFICAR`
  (cambia `endDate`, notifica al colaborador) — reusa
  `applyEndDateAction` sin duplicar su lógica de transacción/auditoría.
  Nueva validación: una `newEndDate` anterior a `Task.startDate` se omite
  y se reporta aparte (`skippedInvalidDate`), igual que ya se hacía con las
  tareas autoasignadas (`skippedSelfAssigned`).
- Cero cambio a `applyEndDateAction`, permisos, ni a la aprobación
  individual (`ValidateActivityModal`) — solo el camino masivo gana
  capacidad de edición por fila.
- Ver `docs/AUDIT_LOG.md` § 2026-08-03 (Aprobación masiva con edición) para
  el detalle de las decisiones de diseño.

---

## v1.25.1 — 2026-08-03

**Tipo:** REFACTOR / UX
**Módulo:** Consolidación de la validación de líder en la pantalla Tiempo Objetivo (`src/lib/taskValidationServer.ts` nuevo, `src/app/api/tasks/validations/pending/route.ts` nuevo, `src/components/tasks/{ValidateActivityModal,RegularizeTargetTimeManager,ActivityPanel}.tsx`, elimina `RegularizeEndDateManager.tsx`/`RegularizeValidationsTabs.tsx`/`ValidateTargetTimeModal.tsx`/`ValidateEndDateModal.tsx`/`api/tasks/{target-time,end-date}/pending`)

Corrige la ubicación de la validación de Fecha Fin (v1.25.0): en vez de una
segunda pestaña/tabla/modal separados, ahora vive integrada en la MISMA
pantalla, tabla y acción "Validar" que Tiempo Objetivo — un pedido explícito
de reutilizar el flujo existente en vez de duplicar la superficie de UI.

- **Tabla única** (`RegularizeTargetTimeManager.tsx`, Menú lateral →
  Gestión → Tiempo Objetivo): gana una columna "Fecha Fin" con el badge
  🟡🟢🔵🔴; la fuente de datos pasa a `GET /api/tasks/validations/pending`
  (nuevo, reemplaza `target-time/pending` y `end-date/pending`), que lista
  una tarea si necesita atención en Tiempo Objetivo O en Fecha Fin (o
  ambas) — así ninguna tarea pendiente en una sola dimensión queda
  invisible en la pantalla de gestión.
- **Modal único** (`ValidateActivityModal.tsx`, nuevo, reemplaza
  `ValidateTargetTimeModal.tsx` + `ValidateEndDateModal.tsx`): la acción
  "Validar" abre un solo diálogo con 2 secciones independientes — Tiempo
  Objetivo (mismo comportamiento/API de siempre, valor + motivo) y Fecha
  Fin (Aprobar/Modificar/Rechazar + observaciones), cada una con su propio
  envío y su propio historial — el líder puede aprobar una y rechazar la
  otra en la misma sesión. Se usa tanto en la pantalla de gestión como en
  el panel de actividades de la tarea (`ActivityPanel.tsx`, que pasa de 2
  botones "Validar" separados a 1).
- **Bulk**: 2 botones independientes cuando hay tareas seleccionadas
  ("Regularizar Tiempo Objetivo" / "Aprobar Fecha Fin en bloque") —
  siguen usando exactamente los mismos 2 endpoints de bulk que ya
  existían (`target-time/bulk-validate`, `end-date/bulk-approve`), sin
  cambios.
- **Cero cambio de lógica de validación**: `applyTargetTimeValidation`/
  `applyEndDateAction`, permisos (`canValidateTargetTime`/
  `canValidateEndDate`), auditoría y notificaciones de v1.25.0 quedan
  intactos — este sprint es exclusivamente de presentación/ubicación.
- Ver `docs/AUDIT_LOG.md` § 2026-08-03 (Consolidación) para el detalle de
  la decisión de listado por unión.

---

## v1.25.0 — 2026-08-03

**Tipo:** FEATURE
**Módulo:** Validación de Fecha Fin por líderes (`prisma/schema.prisma`, `src/lib/endDate.ts` nuevo, `src/lib/endDateServer.ts` nuevo, `src/app/api/tasks/[id]/end-date/route.ts` nuevo, `src/app/api/tasks/end-date/{pending,bulk-approve}/route.ts` nuevos, `src/app/api/tasks/[id]/route.ts`, `src/components/tasks/{ValidateEndDateModal,RegularizeEndDateManager,RegularizeValidationsTabs,ActivityPanel}.tsx`)

Extiende el flujo de validación por líderes (hoy solo Tiempo Objetivo, Sprint
6) a la **Fecha Fin** de la tarea — mismo espíritu, misma arquitectura de
aprobación, reutilizada sin duplicar lógica.

- **Schema**: `Task` gana `endDateApprovalStatus` (enum `PENDIENTE`/
  `APROBADA`/`MODIFICADA`/`RECHAZADA`, default `PENDIENTE` — retroactivo
  también para tareas existentes, mismo comportamiento que tuvo
  `targetTimeValidated` al lanzarse), `endDateApprovedAt`,
  `endDateApprovedById`. Nuevo modelo `EndDateAuditLog` (mirror de
  `TargetTimeAuditLog`) con un `action` adicional `PROPUESTA` para
  distinguir "el colaborador (re)propuso un valor" de las 3 decisiones del
  líder.
- **Permisos reutilizados, no duplicados**: `canValidateEndDate`
  (`src/lib/endDate.ts`) reusa la MISMA constante `CAN_VALIDATE_TARGET_TIME_ROLES`
  de `targetTime.ts` (Administrador/Jefe Nacional/Coordinador Nacional,
  nunca el propio responsable) — NEXO no tiene un campo `managerId`/"jefe
  directo" explícito en `User`; la autorización siempre fue por jerarquía
  de roles, y Tiempo Objetivo ya estableció ese criterio para "quién puede
  validar".
- **3 acciones del líder** (`POST /api/tasks/[id]/end-date`): Aprobar (no
  cambia `endDate`), Modificar (el líder elige una nueva fecha), Rechazar
  (no cambia `endDate`, queda 🔴 — el colaborador debe reproponerla). Toda
  decisión queda en `EndDateAuditLog` dentro de la misma transacción que el
  cambio de estado.
- **Notificaciones**: se notifica al colaborador (modelo `Notification`
  genérico ya existente, mismo patrón que la notificación de asignación de
  tarea) en Modificada Y en Rechazada — no solo en Modificada como sugiere
  el ejemplo literal del pedido, porque en ambos casos el colaborador debe
  actuar. Aprobada no notifica.
- **Re-propuesta transparente, sin UI/endpoint nuevo**: `PATCH
  /api/tasks/[id]` — si `endDate` cambia de valor en una tarea cuya Fecha
  Fin ya tenía una decisión terminal (Aprobada/Modificada/Rechazada), el
  estado vuelve automáticamente a 🟡 Pendiente y queda auditado
  (`action: PROPUESTA`) — esa misma edición ES la "nueva solicitud de
  aprobación" pedida, sin fricción de UI adicional.
- **Alcance deliberado**: la Fecha Fin nunca bloquea nada del resto de la
  app (KPIs, overdue, cierre de mes siguen leyendo `Task.endDate`
  directamente sin importar el estado de aprobación) — mismo principio no
  bloqueante que Tiempo Objetivo. El archivado de tareas en "Cerrar Mes" no
  se toca.
- **UI**: nueva sección "Fecha Fin" en el panel de actividades de la tarea
  (`ActivityPanel.tsx`, espejo de la sección "Tiempo Objetivo" existente,
  con los 4 indicadores 🟡🟢🔵🔴), `ValidateEndDateModal.tsx` (Aprobar/
  Modificar/Rechazar + observaciones opcionales), y una segunda pestaña
  "Fecha Fin" en `/tiempo-objetivo` (`RegularizeEndDateManager.tsx`) para
  regularizar el backlog de tareas existentes — el bulk aquí solo aprueba
  en bloque la fecha ya propuesta de cada tarea (a diferencia del bulk de
  Tiempo Objetivo, que fija un mismo valor nuevo a varias tareas; no
  aplica para fechas, cada tarea tiene la suya).
- Ver `docs/AUDIT_LOG.md` § 2026-08-03 para las decisiones confirmadas con
  el usuario (semántica de Rechazar, re-edición tras aprobación,
  notificaciones).

---

## v1.24.0 — 2026-08-02

**Tipo:** FEATURE
**Módulo:** Cierre Mensual / Analytics / Executive Reporting Engine (`prisma/schema.prisma`, `src/lib/closurePeriod.ts` nuevo, `src/lib/workload.ts`, `src/lib/analytics.ts`, `src/lib/executiveReporting/{buildSnapshotData,snapshotData,documentModel,renderReportHtml,renderReportExcel}.ts`, `src/app/api/tasks/close-month/route.ts`, `src/app/api/reports/executive/closure-status/route.ts` nuevo, `src/components/tasks/CloseMonthModal.tsx`, `src/components/kpis/reports/ReportWizardModal.tsx`)

**Motor de Cierre Inteligente con Fecha de Corte** — "Cerrar Mes" ahora
acepta una Fecha de Corte editable (por defecto, el último día del mes),
permitiendo cierres anticipados o regularizaciones sin distorsionar KPIs,
Carga Laboral, Analytics ni Executive Reporting con días/horas que nunca
formaron parte del período efectivamente evaluado.

- **Schema**: `MonthClosure` gana `cutoffDate`, `closureType` (enum
  `NORMAL`/`EARLY`/`MANUAL`), `calendarDaysTotal`, `calendarDaysConsidered`,
  `workingDaysConsidered`, `workingHoursConsidered` — congelados de forma
  inmutable al momento del cierre, nunca recalculados después (migraciones
  `add_closure_cutoff` + `add_closure_cutoff_not_null`;
  `scripts/backfill-month-closure-cutoff.ts` para filas históricas — la BD
  no tenía ningún `MonthClosure` preexistente, backfill no fue necesario).
- **Truncamiento transparente**: `monthlyBusinessBase` (`workload.ts`)
  consulta el cierre del mes vía el nuevo `src/lib/closurePeriod.ts` y
  trunca su propio `end` cuando existe un corte anticipado — sin cambiar su
  firma, los ~15 call sites existentes (Analytics, KPIs, Executive
  Reporting, dashboard) heredan el corte automáticamente. Cero cambio de
  comportamiento cuando el corte coincide con el último día del mes o el mes
  no tiene cierre formal.
- **Fix de asimetría numerador/denominador**: `computeMonthlyHistory`
  (`analytics.ts`, usado por Tendencias/Anomalías) filtraba tareas contra el
  fin de mes completo mientras la base de horas ya venía truncada por el
  cierre — corregido para usar el mismo límite en ambos. Mismo patrón que ya
  existía (documentado) en el Executive Reporting Engine: `filters.
  fechaCorte` truncaba la actividad real pero nunca la base de horas; ahora
  los reportes de un mes cerrado heredan el `cutoffDate` del cierre como
  default de `fechaCorte` de forma permanente (inmutable, sin importar
  cuándo se genere el reporte).
- **Executive Reporting**: `SnapshotMeta` gana un bloque `closure`
  (`closureType`, `cutoffDate`, `closedAt`, días/horas considerados). Portada
  y Metadatos (HTML/PDF y Excel) muestran "Estado del período" + cobertura +
  días hábiles/horas base + nota metodológica automática, solo cuando
  `closureType !== NORMAL` — reportes de meses cerrados normalmente quedan
  visualmente idénticos a antes de este sprint. `RANGO_MESES` hereda el
  cierre del ÚLTIMO mes del rango (mismo criterio que
  `resolveMonthlyPeriodStatus`); `RANGO_PERSONALIZADO` nunca hereda cierre.
- **UI**: `CloseMonthModal.tsx` pasa de un paso a 3 (Período → Fecha de
  Corte → Vista previa con cobertura/días hábiles/horas base).
  `ReportWizardModal.tsx` muestra un aviso informativo cuando el mes
  seleccionado ya fue cerrado con corte anticipado/manual, vía el nuevo
  endpoint de solo lectura `GET /api/reports/executive/closure-status`
  (gateado por `canAccessReports`, más permisivo que el `canManageUsers` de
  `close-month`, ya que solo expone la fecha de corte, no conteos de tareas).
- **Alcance deliberado**: la Fecha de Corte acota únicamente la ventana de
  datos para cálculo — el archivado/duplicación de tareas de "Cerrar Mes"
  sigue anclado al fin de mes calendario natural, sin cambios. Ver
  `docs/AUDIT_LOG.md` § 2026-08-02 para las decisiones de diseño (definición
  de `closureType`, herencia en `RANGO_MESES`, por qué no sube
  `ANALYTICS_ENGINE_VERSION`/`FORMULA_SET_VERSION`) y
  `docs/ANALYTICS_FORMULAS.md` §20 para la fórmula.

---

## v1.23.4 — 2026-07-28

**Tipo:** FIX
**Módulo:** Executive Reporting Engine — límite cliente/servidor (`src/lib/executiveReporting/indiceEjecutivo.ts` nuevo, `reportInsights.ts`, `estadoGeneral.ts`)

Bug real reportado por el usuario: el fix de v1.23.3 (unificación del Estado
General) NO se veía reflejado en producción — un Informe de Rango
Personalizado seguía mostrando "Sin datos para el período" pese a que el
snapshot tenía colaboradores/indicadores/recomendaciones completos.

- **Causa raíz — no era el algoritmo, era el DEPLOY**: se instrumentó
  `buildCustomRangeSnapshotData` contra la BD real con el período exacto
  reportado (03 jul — 27 jul 2026, 9 colaboradores) y `resolveEstadoGeneral`/
  `buildReportPages` ya calculaban correctamente "Excelente — 87/100" — el
  código de v1.23.3 era correcto. `npx vercel ls` mostró que el deploy de
  producción del commit `fc04525` (v1.23.3) había terminado en **● Error**
  — Vercel seguía sirviendo el deploy anterior (previo al fix), por eso el
  usuario seguía viendo el bug ya corregido.
- **`npx vercel inspect <deploy> --logs`** reveló la causa real del build
  roto: un panic de Rust en Turbopack (`crates/next-code-frame/src/
  highlight.rs:1011` — "end byte index 94 is not a char boundary; it is
  inside 'í'") al intentar renderizar el code frame de un diagnóstico de
  build. Reproducido de forma determinista en local (`npx next build`, con
  y sin `.next` cacheado).
- **Causa raíz del panic**: `estadoGeneral.ts` (v1.23.3) importaba
  `classifyIndiceEjecutivo` de `@/lib/reportInsights` — un archivo que
  empieza con `import "server-only"` (Prisma, `getHolidaySet`, `analytics.ts`
  transitivos). `estadoGeneral.ts` lo usa `documentModel.ts`, que a su vez
  importan DIRECTAMENTE dos Client Components (`ReportWizardModal.tsx`/
  `MonthlyReports.tsx`) para generar el PDF/Excel en el navegador (llaman a
  `buildReportPages`/`buildExecutiveReportHtml` en el cliente). Ese import
  real (no `import type`) arrastraba TODO `reportInsights.ts` al bundle de
  cliente — una violación real que Next.js debe rechazar en build (y lo
  hace, correctamente) — pero el diagnóstico de Turbopack que reporta esa
  violación panickeaba al formatear el code frame de `holidays.ts` (un
  comentario con "días" — la 'í' cae en un límite de byte no válido de
  UTF-8 al truncar el preview), tumbando el build ENTERO en vez de mostrar
  un error de build normal.
- **Por qué solo afectaba a `documentModel.ts`/al reporte visible**: todos
  los demás consumidores de `reportInsights.ts` dentro del motor de reportes
  (`documentModel.ts`, `context.ts`, `snapshotData.ts`, `nova/*.ts`,
  `components/kpis/types.ts`) ya usaban exclusivamente `import type` —
  borrado en compilación, nunca dispara la guardia `"server-only"` (patrón
  ya documentado explícitamente en `kpis/types.ts`). `estadoGeneral.ts` fue
  el primer y único import de VALOR real cruzando esa frontera.
- **Corregido extrayendo el clasificador puro a su propio módulo**:
  `classifyIndiceEjecutivo`/`IndiceEjecutivoNivel`/`IndiceEjecutivoResult`
  (Bloque 11) no tienen ninguna dependencia de I/O — no necesitaban vivir en
  un archivo `"server-only"`. Se movieron a
  `src/lib/executiveReporting/indiceEjecutivo.ts` (sin `"server-only"`,
  cero dependencias); `reportInsights.ts` los reexporta para no romper a
  `buildSnapshotData.ts`/`report-insights.test.ts`; `estadoGeneral.ts` ahora
  importa directamente de `./indiceEjecutivo`, nunca de
  `@/lib/reportInsights`. Cero cambio de fórmula/etiquetas/umbrales.
- **Verificado el fix real**: `npx next build` local (con y sin `.next`
  cacheado) completa sin panic — el error de Turbopack desaparece porque ya
  no hay ninguna violación de frontera cliente/servidor que reportar.
- Verificado: `tsc --noEmit`/`npm run lint` limpios, **1141/1141 tests**
  (sin tests nuevos — el fix es de módulo/bundling, no de lógica; ya cubierto
  por los tests de v1.23.3), `npx next build` de producción exitoso.

## v1.23.3 — 2026-07-28

**Tipo:** FIX
**Módulo:** Executive Reporting Engine — unificación del Estado General (`src/lib/executiveReporting/estadoGeneral.ts` nuevo, `documentModel.ts`, `context.ts`)

Bug real reportado: la Portada de un Informe de Rango Personalizado con
colaboradores, indicadores, hallazgos, insights y recomendaciones completos
mostraba igual "Estado General: Sin datos para el período", mientras que un
Informe Mensual del mes en curso mostraba "Excelente — 89.7/100" con el
mismo motor.

- **Causa raíz**: `buildCoverPage` (`documentModel.ts`) derivaba
  `estadoGeneralLabel`/`color`/`scoreGeneral` EXCLUSIVAMENTE de
  `estadoGeneral.indiceEjecutivo` — `nivel ?? "Sin datos para el período"`.
  El Índice Ejecutivo (Bloque 11, `reportInsights.ts`) es, por diseño
  documentado desde su creación, exclusivo del mes calendario en curso:
  incorpora Equilibrio Operativo → Capacidad Futura, una proyección hacia
  adelante que no es representativa de un período ya cerrado o de un rango.
  `buildRangeSnapshotData`/`buildCustomRangeSnapshotData` nunca lo calculan
  (`indiceEjecutivo: null` fijo), y `buildMonthlySnapshotData` tampoco lo
  calcula fuera del mes en curso — en los 3 casos, correcto y esperado. El
  defecto real era tratar "Índice Ejecutivo ausente" como sinónimo de
  "snapshot sin datos", cuando son dos cosas distintas.
- **No era un problema de los 3 builders**: se comparó explícitamente cómo
  `buildMonthlySnapshotData`/`buildRangeSnapshotData`/
  `buildCustomRangeSnapshotData` construyen `meta`/`estadoGeneral`/
  `teamSummary`/`dataQuality`/`periodStatus` — los tres usan exactamente el
  mismo procedimiento y las mismas funciones compartidas
  (`computeDataQuality`, `generateReportId`, `currentExecutiveReportVersions`,
  `resolveMonthlyPeriodStatus`/`resolveCustomRangePeriodStatus`); la única
  diferencia es el conjunto de datos analizado, como debe ser. El bug vivía
  en la capa de PRESENTACIÓN, no en los builders.
- **Corregido con un constructor único**: `estadoGeneral.ts`
  (`resolveEstadoGeneral`) — la MISMA función para los 6 tipos de reporte
  (Mensual/Rango de Meses/Rango Personalizado × Consolidado/Individual/Por
  Área), sin ninguna rama por tipo:
  1. Snapshot realmente vacío (`members.length === 0` y
     `teamSummary.totalTasks === 0` y `teamSummary.totalConsultas === 0`) →
     "Sin datos para el período" — el ÚNICO caso legítimo para ese mensaje.
  2. `indiceEjecutivo` presente → se usa tal cual (sin cambios de fórmula).
  3. Snapshot con datos pero sin `indiceEjecutivo` → aproximación de
     respaldo, calculada EXCLUSIVAMENTE con `teamSummary.avgCumplimiento` +
     proximidad de `avgCargaPct` al 100% ideal (ambos ya presentes en el
     snapshot congelado — cero consulta a Prisma, cero recálculo de
     Analytics), reutilizando el mismo clasificador `classifyIndiceEjecutivo`
     y sus mismos umbrales/etiquetas (85/70/50 → Excelente/Bueno/Atención/
     Crítico) — nunca una escala paralela.
- **`buildCoverPage`** y **`deriveExecutiveReportContext`** (`context.ts`,
  el resumen que NOVA recibe para generar/degradar su narrativa) ahora
  llaman a `resolveEstadoGeneral` en vez de leer `indiceEjecutivo` cada uno
  por su cuenta — antes divergían por accidente (ambos leían el mismo campo
  `null`, pero de forma independiente); ahora divergir es estructuralmente
  imposible porque comparten la misma función.
- **Sin cambios en `buildSnapshotData.ts`**: los 3 builders siguen
  calculando `estadoGeneral.indiceEjecutivo` exactamente igual que antes (no
  se amplió su alcance a rango/mes cerrado — seguiría siendo una proyección
  no representativa). `ESTADO_GENERAL_COLOR` (mapeo nivel→color redundante
  con `IndiceEjecutivoResult.color`, ya existente) se eliminó de
  `documentModel.ts` por quedar sin uso.
- **Tests de regresión agregados**: `estadoGeneral.test.ts` (nuevo — 5 casos
  sobre `resolveEstadoGeneral`: vacío real, Índice Ejecutivo presente,
  aproximación de respaldo, simetría sobrecarga/subutilización, degradación
  sin lanzar), 2 casos nuevos en `documentModel.test.ts` (Portada de un
  Rango Personalizado con datos completos ya no muestra "Sin datos"; un
  snapshot realmente vacío sí lo muestra, sin importar el tipo), y
  `context.test.ts` (nuevo — NOVA recibe el mismo Estado General resuelto).
- Verificado: `tsc --noEmit`/`npm run lint` limpios, **1141/1141 tests**
  (9 nuevos).

## v1.23.2 — 2026-07-28

**Tipo:** FIX
**Módulo:** Executive Reporting Engine — lectura de reportes LEGACY_MIGRATION (`src/app/api/reports/executive/[reportId]/route.ts`)

Bug real reportado en producción tras el repunte de `MonthlyReports.tsx`
(v1.23.0): `TypeError: Cannot read properties of undefined (reading
'periodLabel')` al abrir la página Informes Mensuales.

- **Causa raíz**: los 4 `ExecutiveReportSnapshot` con `origin:
  LEGACY_MIGRATION` (backfill de Fase D, v1.22.0) se persistieron con la
  columna `data` **sin el campo `meta`** —
  `scripts/backfill-executive-report-snapshots.ts` (`adaptLegacyReportData`)
  devolvía a propósito `Omit<ExecutiveReportSnapshotData, "meta">` (el
  `reportId` solo se conocía dentro del loop de reintento por colisión) y
  nunca lo volvía a adjuntar antes de insertar; los campos equivalentes
  quedaron solo como columnas Prisma sueltas. El defecto era invisible
  porque ningún consumidor anterior leía `data.meta` de un reporte legacy —
  el repunte de `MonthlyReports.tsx` fue el primer código en hacerlo
  (`GET /api/reports/executive/[reportId]` → `body.report.data.meta.periodLabel`),
  y ahí revienta.
- **Corregido en el LÍMITE DE LECTURA, sin escribir en la base compartida**:
  `GET /api/reports/executive/[reportId]/route.ts` gana `ensureSnapshotMeta`
  — si `data.meta` falta, se reconstruye en runtime a partir de las columnas
  propias de la fila (`reportId`, `type`, `scope`, `origin`,
  `integrityFlag`, `periodLabel`, `periodStart/End`, `fechaCorte`,
  `periodStatus`, `collaboratorIds/Count`, `generatedBy` + `generator.name`,
  `generatedAt`, `generationMs`, las 4 versiones) — `rosterKind` se fija en
  `CONSOLIDADO` (valor correcto, no una suposición: `MonthlyReport` nunca
  soportó roster filtrado). Garantiza que `report.data` sea SIEMPRE un
  `ExecutiveReportSnapshotData` completo, para ambos orígenes.
- **Causa raíz también corregida en el origen**:
  `scripts/backfill-executive-report-snapshots.ts` ahora construye `meta`
  completo antes de insertar — no vuelve a reproducir el defecto si se
  ejecuta contra nuevos datos legacy en el futuro (las 4 filas ya migradas
  no se re-escriben — las corrige el fix de arriba en tiempo de lectura).
- **Validaciones defensivas agregadas** (`documentModel.ts` —
  `buildCoverPage`/`buildStrategicIndicatorsPage`/`buildMetadataPage` —, y
  los puntos de exportación en `MonthlyReports.tsx`/`ReportWizardModal.tsx`):
  optional chaining con fallback textual (`"Período no disponible"`, `"—"`)
  en cada acceso a `snap.meta.*` — ningún snapshot incompleto, sea cual sea
  su causa futura, puede volver a tumbar la página.
- **No se restauró el contrato antiguo** ni se agregó una rama de código que
  entienda "el formato viejo" — el fix hace que TODO snapshot que sale de
  este endpoint cumpla el mismo contrato único (`ExecutiveReportSnapshotData`
  completo), consistente con el principio "Analytics calcula una vez,
  Executive Reporting consume una vez" ya establecido.
- **Tests de regresión agregados**: `documentModel.test.ts` (un snapshot con
  `meta: undefined` no lanza y produce los fallbacks esperados) y
  `reports-executive.test.ts` (`GET /[reportId]` reconstruye `data.meta`
  correctamente cuando la fila persistida no lo trae).
- Verificado: `tsc --noEmit`/`npm run lint` limpios, **1132/1132 tests**
  (2 nuevos).

## v1.23.1 — 2026-07-28

**Tipo:** DOCUMENTATION
**Módulo:** Executive Reporting Engine — FPS Parte V (`docs/`)

Cierre documental del FPS del Executive Reporting Engine. La Parte V es
explícitamente no-funcional: "no deberá alterar el comportamiento del
Executive Reporting Engine implementado en las Partes I, II, III y IV" —
esta entrada no toca ningún archivo de `src/`, solo agrega/actualiza
documentación, grounded contra el código real de
`src/lib/executiveReporting/` (no especulada).

- **8 documentos nuevos** en `docs/`: `REPORTING_STANDARDS.md` (filosofía,
  público objetivo, principios de diseño/interpretación/auditoría,
  Definition of Product Excellence — 10 principios), 
  `REPORTING_NOVA_WRITING_GUIDE.md` (reglas obligatorias de redacción de
  NOVA, grounded contra `nova/prompts.ts`/`nova/confidence.ts` reales),
  `REPORTING_DESIGN_SYSTEM.md` (identidad visual del documento, grounded
  contra `EXECUTIVE_REPORT_STYLES` real — distinto de `DESIGN_SYSTEM.md`,
  que cubre la UI general de NEXO), `REPORTING_REFERENCE_LIBRARY.md`
  (ejemplos ilustrativos de las 11 páginas, 3 alcances y reportes LEGACY),
  `REPORTING_USE_CASES.md` (6 casos de uso oficiales, honestos sobre que
  solo 3 roles de NEXO acceden a reportes — los 6 casos son propósitos de
  uso, no 6 roles inventados), `REPORTING_AUDIT_MANUAL.md` (Report ID,
  Snapshot, integridad, fecha de corte, versiones, calidad del
  dato/confiabilidad, reconstrucción histórica, y una tabla honesta de qué
  acciones de `ExecutiveReportAuditLog` están realmente activas hoy vs. cuáles
  existen solo como tipo declarado — `exported_pdf`/`exported_excel`/
  `legacy_migrated` no se emiten desde ningún caller todavía),
  `REPORTING_EDGE_CASES.md` (9 casos límite documentados contra el código
  real — incluye 2 limitaciones conocidas no corregidas en esta entrega:
  `resolveMonthlyPeriodStatus` no distingue un mes futuro de un histórico sin
  cierre, y no hay validación de que `fechaCorte ≥ inicio del período`),
  `REPORTING_QUALITY_BENCHMARK.md` (10 criterios de aceptación con el estado
  real de cada uno, incluyendo las brechas conocidas ya registradas en
  v1.22.3).
- **`docs/ROADMAP.md` § Planificado**: los 2 sprints futuros ya registrados
  en v1.22.3 ganan su nombre oficial del FPS (Sprint Q — Analytics Engine
  Performance; Sprint R — Snapshot Integrity Validation) sin duplicarse.
  3 sprints nuevos registrados como intención, sin diseño técnico: Sprint S
  (Executive Benchmark — comparativos entre meses/áreas/equipos), Sprint T
  (Executive Presentation — PowerPoint/resumen para comité), Sprint U
  (Conversational Executive Reporting — consultas conversacionales sobre
  cualquier Snapshot histórico vía NOVA).
- **`docs/README.md`**: índice actualizado con los 8 documentos nuevos.
- Sin cambios a `docs/AUDIT_LOG.md`/`docs/DECISIONS.md` — esta entrega no
  modifica reglas de negocio ni arquitectura, solo las documenta (regla de
  CLAUDE.md § Documentación: esas bitácoras registran decisiones, no
  documentación descriptiva).

## v1.23.0 — 2026-07-28

**Tipo:** REFACTOR / BREAKING CHANGE (interno)
**Módulo:** Executive Reporting Engine — repunte de `MonthlyReports.tsx`/`ReportWizardModal.tsx` (`src/components/kpis/`)

Cierre del ítem diferido en v1.22.0: `MonthlyReports.tsx` y
`ReportWizardModal.tsx` dejan de tener una ruta de datos propia y pasan a
consumir EXCLUSIVAMENTE el endpoint unificado del Executive Reporting Engine
2.0. Investigación previa (agente de exploración) confirmó que los 7
componentes de presentación legacy y las 4 rutas antiguas no tenían ningún
otro consumidor en el sistema — seguro retirarlos por completo.

- **`MonthlyReports.tsx` reescrito**: ambas vistas (mes individual / rango)
  generan y leen ahora vía `POST /api/reports/executive`,
  `GET /api/reports/executive/[reportId]` y `GET /api/reports/executive/list`
  — el sidebar de "informes guardados" usa el historial real del snapshot
  (incluye entradas `LEGACY_MIGRATION`, marcadas con una etiqueta "Legacy").
  La vista en pantalla deja de tener una implementación de componentes
  propia y reutiliza el MISMO render a HTML que alimenta el PDF
  (`buildReportPages` + `buildExecutiveReportHtml`, inyectado vía
  `dangerouslySetInnerHTML` sobre contenido ya escapado) — pantalla y PDF no
  pueden volver a divergir en contenido.
- **`ReportWizardModal.tsx` reescrito**: el selector de "secciones a
  incluir" pasa de 10 claves ad-hoc a las 9 páginas reales del documento
  unificado (`ReportPage["kind"]`, excluyendo Portada/Metadatos que son
  siempre estructurales); el formato "PDF Ejecutivo" fuerza un subconjunto
  fijo (Resumen/Estado General/Indicadores/Recomendaciones) igual que antes.
  El preset "Rango personalizado"/"Últimos 30 días" del asistente ahora
  llega de verdad a `tipoReporte=RANGO_PERSONALIZADO` del motor unificado
  (antes llegaba a `/api/reports/custom-range`, un endpoint aparte con su
  propia lógica).
- **Retirado por ser código muerto tras el repunte** (verificado con grep de
  cero importadores restantes, no solo por inspección): 4 rutas
  (`/api/reports/generate`, `/api/reports/range`, `/api/reports/custom-range`,
  `/api/reports` list/detail), 7 componentes de presentación
  (`ExecutiveSummarySection`, `FindingsSection`, `RecommendationsSection`,
  `RiskMatrixChart`, `TrendsSection`, `TeamInsightsSection`,
  `IndicatorInterpretation`), `wizardExport.ts` completo (normalizadores +
  builders de PDF/Excel — su lógica ya vivía duplicada en
  `renderReportHtml.ts`/`renderReportExcel.ts`), los 4 `download*` de
  `MonthlyReports.tsx` (`downloadReportPDF`/`downloadReportExcel`/
  `downloadRangePDF`/`downloadRangeExcel`), los tipos `ReportData`/
  `RangeReportData`/`PeriodReportData`/`MonthlyReportSummary`/
  `MonthlyReportFull` de `kpis/types.ts`, y `src/__tests__/api/reports.test.ts`
  (probaba directamente los handlers de las rutas eliminadas). `MonthSnapshot`
  se conservó — lo sigue usando el motor nuevo (`monthlyEvolution`). El
  modelo Prisma `MonthlyReport` NO se tocó — permanece como tabla legacy
  inmutable, ya migrada por completo (ver v1.22.0/v1.22.2).
- **Sin pérdida funcional real, con un ajuste de superficie documentado**:
  el documento fijo de 11 páginas no imprime 3 campos que sí existen en el
  snapshot (tendencias mes/trimestre/semestre, evolución mensual con
  gráfico de línea por colaborador, alertas de gestión/persistentes) — se
  agregaron como paneles complementarios en pantalla (`TrendsPanel`,
  `RangeEvolutionPanel`, `AlertsPanel` en `MonthlyReports.tsx`), leyendo
  directamente del mismo snapshot ya congelado, sin recalcular nada. Los
  botones de exportación PDF/Excel ahora reutilizan el snapshot ya cargado
  en pantalla en vez de generar uno nuevo en cada clic (antes,
  `handleDownloadExecutiveV2Pdf`/`Excel` volvían a llamar a
  `POST /api/reports/executive`, creando un snapshot inmutable adicional
  por cada exportación) — corrige una duplicación de snapshots no
  intencional del sprint anterior, no un cambio de comportamiento visible.
- **Verificado**: `tsc --noEmit` limpio (solo los 2 errores preexistentes y
  no relacionados de siempre), `npm run lint` limpio (0 errores),
  `npx vitest run` en verde (83 archivos / 1130 tests — 14 menos que antes,
  correspondientes exactamente a los tests eliminados de
  `reports.test.ts`, sin ninguna prueba nueva fallando), `npm run build`
  exitoso (el listado de rutas del build ya no incluye las 4 rutas
  retiradas).

## v1.22.3 — 2026-07-28

**Tipo:** FIX / DOCUMENTATION
**Módulo:** Executive Reporting Engine — FPS Parte IV, Arquitectura Técnica/Calidad/Auditoría/Rendimiento (`src/lib/executiveReporting/`)

Última parte del FPS. Auditar el código real de las Fases A-E contra el
texto literal de la Parte IV encontró 3 brechas cerradas con código y 1
hallazgo de rendimiento resuelto mediante 2 decisiones explícitas del
usuario (documentadas en `docs/AUDIT_LOG.md` § Decisiones 8-9).

- **Report ID en pie de página**: el FPS exige que aparezca en Portada,
  Metadatos, pie de página y auditoría — solo estaba en los primeros dos.
  `renderReportHtml.ts` ahora inyecta un footer (`NEXO · Executive
  Reporting Engine · {reportId} · Página X de 11`) en las 11 páginas sin
  tocar los 11 render<X>Page individuales. Se agregó además `@media print
  { @page { size: A4; margin: 14mm } }`.
- **Auditoría de generación incompleta**: `filtersApplied` existía en el
  tipo `ReportAuditEntry` pero nunca se pasaba en la llamada `"generated"`
  de `/api/reports/executive`. Corregido. Se agregó además una entrada
  `generation_failed` en el catch (Report ID provisional generado al inicio
  del intento — para poder auditar incluso si el builder falla antes de
  generar el suyo propio —, paso del proceso, mensaje técnico) — el cliente
  sigue recibiendo el mismo mensaje genérico de siempre, el detalle técnico
  queda solo en el log de auditoría (FPS Parte IV §16).
- **Benchmark real de rendimiento** (`scripts/bench-executive-report.ts`,
  nuevo — llama a los builders directamente contra datos de producción, sin
  necesitar HTTP/sesión, mismo patrón que el backfill): un reporte MENSUAL
  del mes en curso con 9 colaboradores tomó ~22s, sobre el presupuesto de
  15s del FPS §8. Se descartó a NOVA como causa corriendo el mismo
  benchmark sin `GROQ_API_KEY` (cero llamadas de red) — tiempo idéntico. La
  causa real: `computeHealthScore`/`computePerformanceScore`/
  `computeCumplimientoProjection`/`computeSobrecargaProbability` se llaman
  una vez POR COLABORADOR (36 llamadas para 9 personas) — funciones
  diseñadas para uso individual, nunca antes invocadas en lote para un
  equipo completo. Dentro de lo permitido (sin tocar `predictionEngine.ts`/
  `analytics.ts`): se paralelizó el cómputo de Índice Ejecutivo y Analytics
  Predictivo (antes secuenciales sin necesidad real) y se agregó `cached()`
  (mismo patrón/TTL ya usado por el resto del motor) a las 2 llamadas de
  predicción que no lo tenían — una 2ª generación del mismo reporte en el
  mismo proceso bajó de ~22s a ~3.3s, dentro de presupuesto.
- **Decisión explícita del usuario — limitación conocida, no un bug**: la
  generación FRÍA del mes en curso queda documentada como limitación
  conocida de v2.0 — no afecta la exactitud de los resultados (mismas
  funciones, mismos valores, solo más lentas en serie); las regeneraciones
  se benefician del caché ya implementado. `predictionEngine.ts`/
  `analytics.ts` permanecen completamente intactos. Se registra como mejora
  futura un **Sprint de Optimización del Analytics Engine** (único
  objetivo: variantes batch para las 4 funciones, mismo patrón que
  `computeTeamCapacityForecast`/`computeSubutilizacionPredictions` que ya
  existen — cero cambio de fórmulas/resultados/comportamiento funcional).
  Ver `docs/ROADMAP.md` § Planificado.
- **Decisión explícita del usuario — Snapshot Integrity Validation
  diferida**: la validación ACTIVA en tiempo de ejecución (re-consultar
  Dashboard/Analytics al generar y registrar discrepancias como incidente,
  FPS Parte IV §15) queda como mejora futura, no se implementa en esta
  versión. La integridad ESTRUCTURAL ya se considera cumplida: el builder
  canónico único (`buildSnapshotData.ts`) llama a las mismas funciones que
  Dashboard/Analytics, y un único `ExecutiveReportSnapshotData` alimenta
  todas las vistas — dos superficies no pueden divergir si comparten la
  misma función y el mismo objeto.
- Tests: +2 (`reports-executive.test.ts` — `filtersApplied` presente en la
  auditoría, `generation_failed` auditado con mensaje técnico nunca
  expuesto al cliente). Suite completa: 1144/1144 en verde, `tsc`/`lint`
  limpios, `npm run build` exitoso.

Con esta versión se completa la implementación funcional de las 4 partes
del FPS Executive Reporting Engine 2.0 (Fases A-E de arquitectura +
materialización de Partes I-IV), con 2 mejoras futuras registradas y
documentadas en `docs/ROADMAP.md` § Planificado.

## v1.22.2 — 2026-07-28

**Tipo:** FIX
**Módulo:** Executive Reporting Engine — FPS Parte III, NOVA Intelligence Framework (`src/lib/executiveReporting/nova/`)

Con la Parte II aprobada (v1.22.1), se auditó el código real de NOVA (Fase
C) contra el texto literal de la FPS Parte III — no la memoria de lo
construido, sino los prompts/tipos/fallbacks tal como están hoy. La mayor
parte de la Parte III ya estaba correctamente implementada desde la Fase C
(persona de Consultor Senior, cadena de razonamiento obligatoria,
prohibición de muletillas, antialucinación, cruce inteligente de
indicadores, nivel de confianza interno, topes de longitud, enriquecimiento
de recomendaciones alineado estrictamente por `id`). Se encontraron y
cerraron 3 brechas concretas:

- **Recomendaciones incompletas**: la Parte III exige 5 campos por
  recomendación (Impacto esperado, Área afectada, Beneficio operativo,
  Nivel de prioridad, Complejidad estimada) — `NovaRecommendationEnrichment`
  solo tenía 3 de los 5 (más `tiempoEstimado`/`responsableSugerido`, útiles
  pero no los que pedía el FPS). Se agregaron `areaAfectada` y
  `complejidadEstimada` — tipo, prompt (`buildRecommendationEnrichmentPrompt`),
  fallback determinista (`fallbackRecommendationEnrichment`) y validación
  anti-alucinación (`validateAndAlignRecommendations`) actualizados en
  conjunto, sin romper la garantía de "nunca inventa ni pierde un id".
- **Profundidad de Fortalezas/Riesgos/Oportunidades**: el prompt de
  Executive Assessment pedía las 3 listas sin instruir la estructura
  específica que exige el FPS. Ahora exige explícitamente: fortalezas
  → por qué es fortaleza / qué impacto / cómo aprovecharla; riesgos → qué
  riesgo / por qué existe / qué impacto / qué acción preventiva; oportunidades
  → retorno esperado explícito (mismo ejemplo del FPS: redistribución de
  solicitudes → capacidad disponible sin recursos nuevos). Se agregó además
  instrucción de no repetir Executive Insights (antes solo prohibía repetir
  el Executive Summary).
- **Regla de Lenguaje ausente**: no había instrucción explícita contra
  jerga técnica de RRHH/Analytics o lenguaje emocional/de venta. Agregada a
  `NOVA_BASE_RULES`, compartida por los 4 prompts.
- **Sin cambios de arquitectura**: misma orquestación de 4 llamadas
  paralelas, mismo timeout por `Promise.race`, mismo fallback determinista
  garantizado, misma realineación estricta por `id`. Cero cambios a
  `analytics.ts`/`predictionEngine.ts`/Scores/Equilibrio Operativo — solo
  contenido de prompt y 2 campos de datos en un tipo ya existente.
- Tests: fixtures de `nova.test.ts`/`documentModel.test.ts` actualizados a
  la forma de datos ampliada. Suite completa: 1143/1143 en verde,
  `tsc`/`lint` limpios, `npm run build` exitoso.

## v1.22.1 — 2026-07-28

**Tipo:** FIX
**Módulo:** Executive Reporting Engine — FPS Parte II (`src/lib/executiveReporting/`)

Al cerrar la Fase E (v1.22.0), el usuario aprobó formalmente la arquitectura
y pidió materializar la FPS Parte II completa sobre la infraestructura ya
existente. Auditar la Fase E contra el checklist explícito de la Parte II
encontró 2 brechas reales entre lo construido y lo especificado — el resto
de la Parte II (Portada, Executive Summary, Estado General, Indicadores
Estratégicos, Detalle por Colaborador, Executive Insights, Recomendaciones,
Metadatos, Report ID/Snapshot/Fecha de Corte/Estado del período) ya estaba
completo desde la Fase E.

- **Distribución Operativa sin gráfico**: la página mostraba solo tarjetas
  numéricas. Se agregó un gráfico de barras horizontal minimalista (SVG
  inline, reutiliza las variables de color ya definidas en
  `EXECUTIVE_REPORT_STYLES`) — sin librería de gráficos nueva.
- **Analytics Predictivo era un placeholder**: mostraba "no disponible" sin
  excepción. `SnapshotPredictivo` pasa de `null` fijo a un tipo real
  (`buildMonthlySnapshotData` lo popula llamando a
  `computeCumplimientoProjection`/`computeSobrecargaProbability`/
  `computeSubutilizacionPredictions` de `predictionEngine.ts` — el motor
  YA EXISTENTE, por colaborador, sin ninguna fórmula nueva). Gateado a
  `isCurrentMonth`, mismo criterio ya usado por el Índice Ejecutivo (una
  proyección hacia adelante no es representativa de un mes ya cerrado). La
  página muestra tarjetas resumen (horizonte, cumplimiento esperado al
  cierre, colaboradores en riesgo de sobrecarga Alto) + detalle por
  colaborador; degrada con un mensaje explicativo cuando no aplica (rango,
  mes pasado), nunca falla.
- **Sin cambios de arquitectura**: cero nuevas consultas a Analytics desde
  la capa de render (`documentModel.ts`/`renderReportHtml.ts`/
  `renderReportExcel.ts` siguen consumiendo exclusivamente
  `ExecutiveReportSnapshotData`, tal como exige el FPS) — los únicos
  llamados nuevos a `predictionEngine.ts` viven en el builder
  (`buildSnapshotData.ts`), la única capa con mandato de tocar Analytics.
  Cero cambios a `analytics.ts`/`predictionEngine.ts`/Scores/Equilibrio
  Operativo.
- **Pendiente, no confundir con lo anterior**: los 3 escenarios de equipo
  (Esperado/Preventivo/Optimista) de la FPS Parte III siguen sin
  implementar — no existe un motor de síntesis a nivel de EQUIPO, solo por
  colaborador. Ver `docs/ROADMAP.md` § En desarrollo.
- Tests: +1 (`documentModel.test.ts`, escenario con datos predictivos
  reales, valida HTML + Excel). Suite completa: 1143/1143 en verde,
  `tsc`/`lint` limpios, `npm run build` exitoso (confirmadas las 3 rutas
  `/api/reports/executive/*` en el output).

## v1.22.0 — 2026-07-28

**Tipo:** FEATURE
**Módulo:** Executive Reporting Engine 2.0 (`src/lib/executiveReporting/`)

El Informe Mensual/de Rango pasa de "exportación de tablas con un bloque de
IA pegado" a un motor de reportes ejecutivos propio, independiente de
Analytics, construido en 5 fases (A-E) sobre una especificación funcional de
4 partes entregada por el usuario. Cero cambios al Analytics Engine ni a sus
fórmulas — el motor nuevo consume `analytics.ts`/`reportInsights.ts` tal
como están, nunca los modifica.

- **Fase A — Fundación** (`prisma/schema.prisma`, `src/lib/executiveReporting/{reportId,version,snapshotStore}.ts`):
  modelos `ExecutiveReportSnapshot`/`ExecutiveReportAuditLog` (migración
  100% aditiva), generador de Report ID (`NXR-YYYYMMDD-HHMMSS-XXXX`, huso de
  negocio, alfabeto sin caracteres ambiguos), auditoría best-effort.
- **Fase B — Builder unificado** (`buildSnapshotData.ts`, `snapshotData.ts`,
  `context.ts`, `filters.ts`, `resolveRoster.ts`, `periodStatus.ts`):
  `ExecutiveReportSnapshotData` como objeto de dominio único — se calcula
  UNA vez y alimenta Portada/Estado General/Detalle/Distribución/Insights/
  Assessment/Recomendaciones/Metadatos sin que ningún consumidor vuelva a
  tocar Prisma/Analytics. Las 3 rutas existentes (`generate`/`range`/
  `custom-range`) se reescriben para delegar en este builder — mismas
  fórmulas exactas, reubicadas, más `computeDataQuality` (antes ausente del
  reporte de equipo) y estado de período (`EN_CURSO`/`CERRADO`/`HISTORICO`).
  Fecha de corte real: acota consultas/carga por fecha y reconstruye el
  estado de cumplimiento "a la fecha de corte" vía `completedAt` (NEXO no
  lleva historial de `status` por tarea). `ExecutiveReportFilters` unificado
  (período/tipo/fecha de corte/roles/áreas/colaboradores) y `resolveReportRoster`
  reemplazan el filtro de roles duplicado en los 3 endpoints. Snapshot
  congelado (`Object.freeze` profundo) antes de devolverse — inmutabilidad
  real, no solo de tipo. `Recommendation`/`TeamRecommendation` ganan un
  `id` estable (para el enriquecimiento de NOVA).
- **Fase C — NOVA estructurado** (`nova/{types,confidence,prompts,fallbacks,generateNarrative,renderMarkdown}.ts`):
  reemplaza `buildAiAnalysis`/`buildRangeAiAnalysis` (1 llamada de texto
  libre a Groq, sin caché, en cada endpoint) por 4 llamadas paralelas
  estructuradas (Executive Summary/Insights/Assessment/Enriquecimiento de
  Recomendaciones), timeout por llamada (`Promise.race`, nunca bloquea la
  generación), fallback determinista garantizado por sección (nunca en
  blanco), y realineación estricta por `id` real en recomendaciones (Groq
  nunca puede inventar ni perder una). `renderNovaAsMarkdown` adapta las 4
  secciones al mismo bloque de texto que la UI actual ya sabe mostrar — cero
  regresión visible, mismo aviso de "configura GROQ_API_KEY" de siempre.
  Escenarios predictivos (5ª sección del FPS) quedan deliberadamente sin
  implementar — no existe aún un motor de predicción de equipo sobre el que
  narrar sin alucinar.
- **Fase D — Persistencia inmutable** (`api/reports/executive/{route,[reportId]/route,list/route}.ts`,
  `scripts/backfill-executive-report-snapshots.ts`): endpoint unificado de
  generación (`POST /api/reports/executive`), lectura inmutable por Report
  ID, historial paginado. Backfill de una sola corrida (dry-run por
  defecto, `--execute` con confirmación interactiva) migró los 4
  `MonthlyReport` históricos a `ExecutiveReportSnapshot`
  (`origin=LEGACY_MIGRATION`, `integrityFlag=PARTIAL` siempre — ningún
  reporte histórico registró calidad de dato/versiones/NOVA estructurado) —
  `MonthlyReport` no se modificó ni se borró.
- **Fase E — Documento de 11 páginas** (`documentModel.ts`,
  `renderReportHtml.ts`, `renderReportExcel.ts`): Portada, Executive
  Summary, Estado General del Equipo, Indicadores Estratégicos, Detalle por
  Colaborador, Distribución Operativa, Executive Insights, Executive
  Assessment by NOVA, Recomendaciones, Analytics Predictivo, Metadatos —
  orden fijo en un único lugar. Vista en pantalla y PDF comparten el mismo
  render a HTML (simplificación deliberada sobre el diseño original de dos
  sistemas de presentación paralelos). Integrado a `MonthlyReports.tsx` de
  forma ADITIVA — botones "PDF Ejecutivo 2.0"/"Excel Ejecutivo 2.0" nuevos,
  junto a los existentes, sin retirar ni modificar el flujo actual.
- **Pendiente, explícitamente diferido** (ver `docs/ROADMAP.md` § En
  desarrollo): repuntar `MonthlyReports.tsx`/`ReportWizardModal.tsx`/
  `wizardExport.ts` al endpoint unificado y retirar los renderers antiguos;
  escenarios predictivos de equipo.
- Tests: 82 tests nuevos a través de las 5 fases (`src/__tests__/executiveReporting/`,
  `src/__tests__/api/reports-executive.test.ts`) — Report ID, inmutabilidad,
  fecha de corte, roster/filtros, fallback de NOVA nunca en blanco,
  degradación por timeout/error/JSON malformado, no-alucinación de
  recomendaciones, orden fijo de páginas, escape anti-inyección en HTML.
  Suite completa: 1142/1142 en verde, `tsc`/`lint` limpios.

## v1.21.0 — 2026-07-28

**Tipo:** FEATURE
**Módulo:** Centro de Configuración NEXO (Sprint O)

Reemplaza el acordeón plano de `/settings` (`SettingsManager.tsx`, ~21
secciones + 6 bloques inline sin categorías, sin búsqueda, sin favoritos, sin
historial navegable ni restaurar-a-predeterminado) por un módulo organizado
(`ConfigCenter.tsx`) — sin cambiar la lógica de ninguna sección existente.

- **Arquitectura:** `src/lib/systemConfig.ts` (el almacén genérico
  `SystemConfigHistory` con auditoría por diseño, ya reutilizado por ~10
  dominios) sigue siendo la única fuente de verdad; este sprint construye la
  capa transversal que faltaba encima, no un nuevo mecanismo de storage.
- **Categorías:** Organización, Analytics, Trabajo, Proyectos, Escritorio
  Digital, Reportes, NOVA, Seguridad, Notificaciones, Parámetros Globales,
  Sistema — cada una de las ~21+6 secciones existentes se re-hospedó en su
  categoría vía `src/components/settings/registry.ts` (metadatos, no
  referencias a componentes) sin tocar su interior.
- **Extracciones:** los 6 bloques que vivían inline en `SettingsManager.tsx`
  (Consentimiento de datos, Gestión de contraseñas, Información del sistema,
  Configuración de Carga Laboral, Solicitudes de titulares, Política de
  retención) pasan a componentes propios (`DataConsentSection.tsx`,
  `PasswordManagementSection.tsx`, `SystemInfoSection.tsx`,
  `WorkloadConfigSection.tsx`, `DataRequestsSection.tsx`,
  `RetentionPolicySection.tsx`) — copy-paste 1:1, cero cambio de lógica.
  `SettingsManager.tsx` se elimina (no queda código muerto en paralelo).
- **Búsqueda global:** `searchSettings()` filtra el registro por
  label/description/keywords, insensible a mayúsculas/acentos (normalización
  extraída de `SectionCard.tsx` a `src/lib/textSearch.ts`, reutilizada por
  ambos). Sin API nueva — es filtrado client-side sobre un array estático.
- **Favoritos:** `src/lib/configFavorites.ts` reutiliza `User.viewPreferences`
  con prefijo `CONFIG_FAVORITE:`, el mismo patrón ya usado por el orden de
  tarjetas del Dashboard (`/api/dashboard/card-order`) — sin columna nueva.
- **Historial navegable:** `GET /api/settings/config-history?keys=...` lee
  `SystemConfigHistory` directamente — el dato ya existía (usuario, fecha,
  valor anterior por `setConfigValue`), solo faltaba una UI para verlo
  (`SettingHistoryModal.tsx`).
- **Restaurar predeterminado:** `POST /api/settings/config-history/restore-default`
  toma los valores de las constantes `DEFAULT_*`/`ANALYTICS_CONFIG_DEFAULTS`
  ya exportadas por `systemConfig.ts` (no se hardcodean dos veces).
- **9 valores nuevos configurables** (todos con default = comportamiento
  anterior exacto, mismo patrón `CONFIG_KEY_*`/`getEffective*`/`set*` que ya
  usan los ~10 dominios existentes, sin cambios de esquema):
  - Trabajo: ventana de registro retroactivo (`retroactive_window_business_days`,
    antes literal `2` en 4 sitios), hora de corte de jornada de Capacidad
    Proyectada (`capacity_workday_end_hour_local`, antes literal `17`).
  - Escritorio Digital: retención de archivado (`desk_archive_retention_days`,
    antes `15`), tope de respuestas (`desk_note_max_replies`, antes `2`),
    presets de posposición (`desk_reminder_snooze_presets_minutes`, antes
    array fijo `[15,30,60,1440]`).
  - NOVA: TTL de caché de mensajes generados (`nova_cache_ttl_minutes`, antes
    `4h` duplicado en `nova-message`/`nova-insights`).
  - Seguridad: longitud mínima de contraseña (`password_min_length`, antes
    `6` duplicado cliente/servidor — se eliminó el chequeo duplicado del
    cliente en `profile/page.tsx`, el servidor ya valida y muestra el error),
    duración de sesión (`session_duration_default_hours`/`_remember_hours`,
    antes `7d`/`30d` fijos — solo afecta sesiones nuevas), retención de
    intentos de login (`retention_login_attempts`, antes `30` fijo, hermano
    de las 3 claves de retención ya existentes).
- **Fix de bug real:** `src/app/(protected)/settings/page.tsx` permitía
  `ADMINISTRADOR` y `COORDINADOR_NACIONAL`, pero `SettingsManager.tsx`
  escondía todo detrás de un gate más estricto (`isAdmin`) — Coordinador
  Nacional veía una página vacía. El link de navegación (`navLinks.ts`) ya
  era Administrador-only: 2 de 3 fuentes ya coincidían, se corrigió la
  tercera.
- **Fuera de alcance (documentado, no construido a medias):** SLA/nivel de
  riesgo en Proyectos ("Sprint K"), plantillas/logo/portada/firmas y
  programación automática de Reportes ("Sprint F"), permisos especiales por
  usuario en Seguridad, prioridades/estados/tipos de tarea y días laborables
  como listas editables (enums de Prisma + riesgo de regresión en Analytics),
  idioma/moneda en Parámetros Globales (sin consumidor real en un sistema de
  RRHH sin i18n) — cada uno con su propia tarjeta "Próximamente" en la UI y
  entrada en `docs/ROADMAP.md`.
- **Archivos:** `src/lib/systemConfig.ts` (9 pares nuevos),
  `src/lib/configFavorites.ts`, `src/lib/textSearch.ts`,
  `src/lib/settingsCategories.ts`, `src/lib/retroactiveWindow.ts`,
  `src/components/settings/{ConfigCenter,CategoryNav,SearchBox,
  FavoritesSection,ConfigSectionCard,registry,ProximamenteCard,
  GlobalParamsSection}.tsx`, `src/components/settings/history/*`,
  7 secciones extraídas + 4 secciones nuevas agrupadas
  (`TrabajoAvanzadoSection`, `EscritorioDigitalConfigSection`,
  `NovaCacheSection`, `SeguridadConfigSection`), 9 rutas API nuevas bajo
  `/api/settings/*`, `src/lib/capacityForecast.ts`/`deskNoteRetention.ts`/
  `session.ts`/`rate-limit.ts`/businessTime call sites (switch a los nuevos
  getters), `src/app/(protected)/settings/page.tsx`,
  `src/components/desk/ReminderCard.tsx`/`RemindersPanel.tsx`,
  `src/components/tasks/RetroactiveActivityModal.tsx`,
  `src/components/projects/ProjectActivitiesTab.tsx`.
- **Impacto:** el Administrador puede adaptar 9 comportamientos más de la
  plataforma sin tocar código, con auditoría e historial ya visibles; sin
  configurar nada, el sistema se comporta exactamente igual que antes (todos
  los defaults igualan el literal que reemplazan). Sin migración de datos.
- **Autor:** Claude Code

---

## v1.20.1 — 2026-07-28

**Tipo:** FIX
**Módulo:** Analytics/KPIs — indicador "Carga Laboral"

Corrige el indicador "Carga Laboral" mostrado en `/api/kpis/[userId]` y
`/api/kpis/me` (consumido por `KpisModule.tsx`/`MyKpisModule.tsx`: SummaryCard,
DonutChart y exportables PDF/Excel) — usaba una fuente de datos completamente
distinta a la del resto de Analytics para el mismo período, mostrando dos
números de "Carga laboral" incompatibles en la misma pantalla (reportado por
el usuario 2026-07-28: 113.28h/206.18h/55% en el indicador vs. 135.49h/
140-165h/Moderado en WorkloadCard, ya validado).

- **Causa raíz:** `cargaLaboral.{estimatedHours,realHours,ratio}` se calculaba
  sumando `Task.estimatedHours`/`Task.realHours` crudos de las tareas con
  `endDate` en el período (`computeEstimatedVsRealRatio`) — un ratio de
  precisión de estimación, sin relación con la Base Horaria Efectiva (días
  hábiles × horas efectivas configuradas, Sprint Analytics 2.1) que
  `computeCargaTiempo`/`cargaTiempo.mensual` ya calcula y que WorkloadCard
  (misma pantalla) y el resto de Analytics usan como fuente validada.
- **FIX:** `cargaLaboral` ahora lee directamente de `cargaTiempo.mensual`
  (mismo objeto ya calculado y enviado al frontend como `cargaTiempo`) —
  `estimatedHours` pasa a contener `mensual.baseHours`, `realHours` a
  `mensual.realHours`, `ratio` a `mensual.pct`; el color se deriva de
  `mensual.color` (5 zonas `WorkloadColor`) con `orange` colapsado a
  `yellow` (único mapeo posible a `KpiColor`, 3 zonas).
- **Delta mes anterior (`prevMonth.cargaRatio`):** recalculado con el mismo
  criterio (`businessBaseForRange` + horas reales FIJA/`TaskActivity` del mes
  anterior, mismo patrón que `reports/custom-range/route.ts`) para que el
  badge de tendencia compare el mismo tipo de dato mes a mes — antes de este
  fix habría quedado comparando el nuevo % (Base Horaria Efectiva) contra el
  ratio antiguo (estimado-vs-real) de un mes distinto.
- **Fuera de alcance (a propósito):** el ratio estimado-vs-real
  (`computeEstimatedVsRealRatio`) se conserva sin cambios como único input del
  Score básico (`computeSimpleScore`) — no es el indicador reportado, y
  tocar su fórmula queda fuera de este fix (ver inconsistencia ya documentada
  en `docs/ROADMAP.md` sobre `computeEstimatedVsRealRatio` vs
  `computeTargetTimePrecision`). Cero cambios a `src/lib/analytics.ts`
  (Analytics Engine), Equilibrio Operativo, Analytics Predictivo, Reportes ni
  Dashboard.
- **Archivos:** `src/app/api/kpis/[userId]/route.ts`,
  `src/app/api/kpis/me/route.ts` (fuente de datos + delta mes anterior),
  `src/components/kpis/KpisModule.tsx`, `src/components/kpis/MyKpisModule.tsx`
  (etiquetas "Tiempo objetivo"/"est." → "Horas base", ahora coherentes con el
  dato que muestran), `src/__tests__/api/kpis-me-userid.test.ts` (fixture
  `CargaTiempo` tipado completo, 2 tests actualizados a la nueva fuente, 1
  test nuevo de regresión).
- **Impacto:** el número de "Carga Laboral" que ve cualquier colaborador o su
  jerarquía en Analytics/KPIs ahora coincide con el de WorkloadCard/Equilibrio
  Operativo para el mismo período — elimina la contradicción visible en la
  misma pantalla. Sin migración de datos (cálculo en tiempo real, no
  persistido).
- **Autor:** Claude Code

---

## v1.20.0 — 2026-07-26

**Tipo:** FIX / ANALYTICS
**Módulo:** Motor Determinista de Recomendaciones — Compatibilidad Organizacional

Corrige `computeTeamRecommendations` (motor determinista de redistribución
de carga, §S3-A) para que respete la estructura organizacional de NEXO —
antes optimizaba solo por disponibilidad/carga, pudiendo sugerir
redistribuciones entre cargos jerárquicamente incompatibles (ej. Asistente →
Coordinador). Sin cambios a cálculos de carga laboral, KPIs, ni al resto del
Analytics Engine — ver `docs/AUDIT_LOG.md` § 2026-07-26.

- **FIX — Regla 1 (redistribución horizontal):** el mismo cargo siempre se
  prioriza como destino, aunque exista un cargo compatible con más capacidad
  disponible.
- **FEATURE — Matriz de Compatibilidad Operativa (Regla 2/3):** nueva
  configuración en Ajustes → Analytics → Compatibilidad Operativa (solo
  roles con gestión de usuarios) — qué cargos ADICIONALES del mismo nivel
  jerárquico pueden recibir redistribución cuando no hay nadie disponible del
  mismo cargo. `getEffectiveRoleCompatibility`/`setRoleCompatibility`
  (`src/lib/systemConfig.ts`), `GET/PATCH /api/settings/role-compatibility`.
  Vacía por defecto — sin configurar, solo el mismo cargo redistribuye.
- **FIX — Regla 4 (prohibición vertical), filtro absoluto:** nunca se
  sugiere redistribución entre niveles jerárquicos distintos —
  `ROLE_LEVEL` (`roles.ts`) filtra los candidatos ANTES de consultar la
  matriz, y `PATCH /api/settings/role-compatibility` rechaza con 400 (400,
  no solo advertencia) cualquier intento de configurar un par de niveles
  distintos. Defensa en profundidad, no una sola capa de protección.
- **FIX — Regla 5 (sin candidato):** cuando no existe un colaborador
  compatible con capacidad disponible, el motor devuelve el mensaje "No
  existe actualmente un colaborador compatible para redistribuir esta carga
  operativa (nombre)" en vez de omitir silenciosamente o sugerir algo
  incorrecto (`TeamRecommendation.hasCandidate: false`).
- **UI:** `TeamWorkloadCards.tsx` (`RecommendationItem`) muestra el mensaje
  de Regla 5 sin la línea de "impacto esperado" (no aplica cuando no hay
  redistribución real); nueva sección `RoleCompatibilitySection.tsx`.

**Archivos:** `src/lib/analytics.ts` (`computeTeamRecommendations`,
`TeamRecommendation`), `src/lib/systemConfig.ts`,
`src/app/api/settings/role-compatibility/route.ts`,
`src/app/api/analytics/recommendations/team/route.ts`,
`src/components/settings/RoleCompatibilitySection.tsx`,
`src/components/SettingsManager.tsx`, `src/components/kpis/TeamWorkloadCards.tsx`,
`src/__tests__/team-recommendations-compatibility.test.ts`,
`src/__tests__/api/role-compatibility.test.ts`.

**Impacto:** las recomendaciones de redistribución que ya se mostraban en
`/team` (Recomendaciones — motor determinista) ahora solo sugieren
movimientos operativamente viables; en equipos donde nadie es compatible con
un colaborador sobrecargado, se informa en vez de sugerir algo incorrecto.
`npx tsc --noEmit` (2 errores preexistentes no relacionados), `npm run lint`
(0 errores), `npx vitest run` (1039/1039), `npm run build` limpio.

**Autor:** Claude Code

---

## v1.19.0 — 2026-07-26

**Tipo:** FEATURE / ANALYTICS
**Módulo:** Sprint E — Analytics Predictivo e Inteligencia Preventiva

Nuevo motor predictivo, 100% determinístico (sin IA generativa), construido
como capa aislada sobre el Analytics Engine existente — **cero cambios** a
`analytics.ts`/`capacityForecast.ts`/`workload.ts`/`computeAlerts`/
`riskAlerts.ts` ni a ninguna UI de Dashboard/Analytics(KPIs)/Reportes/
Proyectos/Equipo. Vive en un módulo nuevo y autónomo,
`/inteligencia-preventiva` — la integración profunda en esas pantallas
queda para un sprint futuro (ver `docs/ROADMAP.md`). Decisiones completas en
`docs/AUDIT_LOG.md` § 2026-07-26 (Sprint E).

- **FEATURE — Trend Engine (`src/lib/trendEngine.ts`):** detecta dirección
  (positiva/negativa/estable/variable/cambio brusco) de 8 indicadores
  (Cumplimiento, Productividad, Horas registradas, Consistencia Operativa,
  Capacidad Disponible, Equilibrio Operativo, Proyectos, Actividades) sobre
  la ventana histórica configurada — regresión OLS + CV de residuos
  (variabilidad neta de tendencia, no dispersión cruda). "Consultas" queda
  fuera de alcance (sin fuente de datos — ver `docs/ROADMAP.md`).
- **FEATURE — Ventana Histórica de Predicción configurable (Bloque 2):**
  nuevo parámetro global en Ajustes → Configuración Predictiva (3/4/6/8/12
  semanas, default 3, solo Administrador) — `src/lib/predictiveConfig.ts`,
  `GET/PUT /api/settings/prediction-window`.
- **FEATURE — 4 predicciones explicables (`src/lib/predictionEngine.ts`):**
  Proyección de Cumplimiento (variación esperada vs. promedio de la
  ventana), Predicción de Sobrecarga (probabilidad + nivel), Predicción de
  Subutilización (vista de equipo, batch), Predicción de Retrasos (tareas y
  proyectos, 3 factores: Sobrecarga/Baja consistencia/Retrasos recientes).
  Cada una expone horizonte fijo (7/15/30/90 días), nivel de confianza y
  confiabilidad del histórico como ejes explícitamente distintos, y
  explicación de 4 partes (qué ocurrirá, por qué, qué datos, qué acciones).
- **FEATURE — Estabilidad Operativa (Bloque 10):** nuevo indicador,
  exclusivamente predictivo — clasifica la variabilidad conjunta de los 8
  indicadores del Trend Engine (Muy Alta/Alta/Media/Baja/Muy Baja). No
  modifica ningún KPI existente.
- **FEATURE — Inteligencia Preventiva (`src/lib/preventiveIntelligence.ts`):**
  alertas priorizadas 🔴 Acción inmediata / 🟠 Atención / 🟡 Seguimiento /
  🟢 Sin riesgo, individuales y de equipo — separada de `computeAlerts` (motor
  de 8 reglas) y de `riskAlerts.ts` (vestigial), ninguno de los dos tocado.
- **FEATURE — Simulador de Escenarios (Bloque 8):** 5 escenarios (agregar
  horas, cerrar tareas, redistribuir carga, modificar tiempo objetivo,
  agregar participantes) — nunca persiste nada. Los 2 primeros reutilizan
  `/api/analytics/simulate/[userId]` tal cual (sin modificarlo); los otros 3
  son rutas nuevas (`/api/predictive/simulate/**`) porque no encajan en el
  contrato de usuario único de esa ruta protegida, reutilizando sus mismas
  funciones puras exportadas.
- **FEATURE — Tendencias Históricas (Bloque 9):** gráficos de evolución con
  ventanas independientes de la configuración global (3/4/8 semanas, 3/6
  meses, 1 año) para 8 indicadores — reutiliza `recharts`/`useChartTheme`
  ya usados en KPIs, sin nueva dependencia.
- **UI — módulo nuevo:** `/inteligencia-preventiva`
  (`src/components/inteligencia-preventiva/`), entrada de navegación en la
  sección "Inteligencia" existente (junto a Nova). Visibilidad
  individual/equipo compuesta con los mismos predicados que ya separan
  `/my-kpis` de `/kpis` (`isExecutorRole`/`canViewTeam`) — sin gate de
  navegación nuevo.

**Fix incidental descubierto durante el propio desarrollo (no en
producción):** el clasificador de "cambio brusco" del Trend Engine
originalmente comparaba el último punto contra la media plana de los
anteriores, generando un falso positivo en cualquier tendencia fuerte y
perfectamente lineal; corregido para comparar contra el residuo de la recta
de regresión (ver `docs/ANALYTICS_FORMULAS.md` §16).

**Archivos:** `src/lib/{trendEngine,predictionEngine,preventiveIntelligence,predictiveConfig}.ts`,
`src/lib/systemConfig.ts` (nueva clave `prediction_window_weeks`),
`src/app/api/predictive/**` (9 rutas nuevas), `src/app/api/settings/prediction-window/route.ts`,
`src/components/settings/PredictionWindowSection.tsx`, `src/components/SettingsManager.tsx`,
`src/app/(protected)/inteligencia-preventiva/page.tsx`,
`src/components/inteligencia-preventiva/**` (9 archivos), `src/lib/navLinks.ts`,
`src/__tests__/{trendEngine,predictionEngine,predictiveConfig}.test.ts`,
`src/__tests__/api/predictive-{settings,auth,simulate}.test.ts`, `src/__tests__/navLinks.test.ts` (extendido).

**Impacto:** ningún cambio de comportamiento para usuarios existentes de
Dashboard/KPIs/Reportes/Proyectos/Equipo. Usuarios autenticados ganan acceso
a un nuevo módulo de predicción/prevención, con visibilidad individual/equipo
compuesta por rol. `npx tsc --noEmit` (2 errores preexistentes no
relacionados), `npm run lint` (0 errores), `npx vitest run` (1026/1026),
`npm run build` limpio.

**Autor:** Claude Code

---

## v1.18.1 — 2026-07-26

**Tipo:** FIX
**Módulo:** Registro retroactivo de actividades (Seguimiento y Proyectos)

Amplía la ventana de registro retroactivo para incluir el fin de semana
inmediato anterior, sin tocar la regla base de 2 días laborables (48 horas
hábiles). Antes, el sábado y domingo previos quedaban fuera de la ventana
retroactiva de forma permanente; ahora están disponibles hasta el martes
siguiente (inclusive) y desaparecen automáticamente a partir del miércoles.

- **FIX — motor único de validación (`src/lib/businessTime.ts`):** nuevas
  funciones `weekendGraceDays(today)` (devuelve sábado/domingo del fin de
  semana inmediato anterior, solo si `today` es lunes o martes) y
  `retroactiveValidDates(today, count)` (combina `previousBusinessDays` +
  `weekendGraceDays`, orden más reciente primero). `previousBusinessDays`
  no se modificó — la regla de 2 días hábiles queda intacta.
- Los 4 puntos de la plataforma que calculaban la ventana retroactiva de
  forma independiente ahora llaman a `retroactiveValidDates` en vez de
  `previousBusinessDays` directamente: `RetroactiveActivityModal.tsx`
  (tareas de Seguimiento), `ProjectActivitiesTab.tsx` (Proyectos), y sus
  dos rutas de API correspondientes (`POST /api/tasks/[id]/activities/
  retroactive`, `POST /api/projects/[id]/activities`) — sin duplicar
  lógica de fechas entre cliente y servidor.
- **Alcance deliberado — Tareas Fijas quedan fuera:** el pedido original
  mencionaba Tareas Fijas como parte del alcance, pero Fija nunca tuvo
  registro retroactivo (decisión explícita del sprint de unificación del
  2026-07-21, ver `docs/DECISIONS.md`) — solo registra "hoy" vía
  `ActivityPanel`. Confirmado con el usuario antes de implementar: no se
  agrega retroactivo a Fija en este cambio: ver `docs/AUDIT_LOG.md` §
  2026-07-26.
- No se tocó Analytics, KPIs, Auditoría, historial de actividades, ni el
  cálculo de horas — la única superficie de cambio es qué fechas son
  seleccionables/aceptadas para un registro retroactivo.

**Archivos:** `src/lib/businessTime.ts`,
`src/components/tasks/RetroactiveActivityModal.tsx`,
`src/components/projects/ProjectActivitiesTab.tsx`,
`src/app/api/tasks/[id]/activities/retroactive/route.ts`,
`src/app/api/projects/[id]/activities/route.ts`,
`src/__tests__/businessTime.test.ts` (tests nuevos para
`weekendGraceDays`/`retroactiveValidDates`, cubriendo los 7 días de la
semana según la tabla del pedido).

**Impacto:** colaboradores pueden registrar horas del sábado/domingo
inmediato anterior hasta el martes siguiente; miércoles en adelante la
ventana vuelve a ser exactamente la de antes (2 días hábiles). Sin cambios
para tareas Fijas.

**Autor:** Claude Code

---

## v1.18.0 — 2026-07-24

**Tipo:** FEATURE / ANALYTICS
**Módulo:** Sprint Analytics 2.1 — Mejora del Reporte Ejecutivo y Calidad de la Comparabilidad

Fortalece el Informe Consolidado (`/kpis` → Informes) construido en Sprint
Reportes Ejecutivos 2.0: comparabilidad correcta entre colaboradores
(Base Horaria Efectiva), un asistente de configuración antes de generar
(Generador Inteligente de Reportes), y dos columnas nuevas por colaborador
(Estado Operativo, Principal Hallazgo). **No modifica el Analytics Engine**
(`src/lib/analytics.ts`) ni ninguna fórmula/peso/KPI existente — todo lo
nuevo reutiliza cálculos ya hechos por `analytics.ts`/`workload.ts` o los
compone en `reportInsights.ts`. Ver `docs/AUDIT_LOG.md` § Sprint Analytics
2.1 para el detalle de decisiones y `docs/DECISIONS.md` para el índice.

- **FEATURE — Base Horaria Efectiva (Bloque 1):** la base horaria de cada
  colaborador en el informe ya no asume el período completo — se recorta al
  tramo `[max(inicio del período, inicio efectivo del colaborador),
  fin del período]`, reutilizando `computeEffectiveHistoryStart`
  (`analytics.ts`, ya usado por Consistencia desde el Analytics Engine
  v1.3.1: cruza `kpiStartDate`/primera actividad/primera tarea completada/
  primera imputación de horas/`createdAt`, la señal más reciente gana).
  Nueva función `computeEffectiveMemberBases` (`reportInsights.ts`) y
  `businessBaseForRange` (`workload.ts`, generalización de
  `monthlyBusinessBase` a fechas arbitrarias). Para informes de rango
  (trimestre/semestre/año/personalizado) se usa la tarifa vigente al inicio
  del rango completo, no mes a mes — simplificación deliberada, ver
  `docs/AUDIT_LOG.md`.
- **UX — nota informativa de Base Horaria Efectiva (Bloque 2):**
  `BaseEfectivaNote` en `MonthlyReports.tsx`, visible solo cuando algún
  colaborador del informe tiene su base recortada; cada fila afectada se
  marca con `*` en la tabla y en las exportaciones PDF/Excel.
- **UX — nueva visualización de horas (Bloque 3):** la columna "Horas
  (real/base)" pasa de `126.0h/149.3h` a `126.0h / 149.3h` + `84%` en dos
  líneas (`HorasCell`), tanto en pantalla como en PDF/Excel.
- **FEATURE — Generador Inteligente de Reportes (Bloques 4-8):** nuevo
  asistente (`ReportWizardModal.tsx`) antes de exportar — selección de
  colaboradores (checkboxes + 6 filtros rápidos: todos/mi equipo/con
  actividad/con riesgo operativo/destacados/activos), selección de período
  (7 presets: mes actual, mes anterior, últimos 30 días, trimestre,
  semestre, año, rango personalizado), selección de secciones (10
  bloques activables) y formato de exportación (PDF Ejecutivo — versión
  condensada fija para dirección; PDF Completo; Excel). Nuevo endpoint
  `GET /api/reports/custom-range` para los presets de fecha arbitraria
  (últimos 30 días/rango personalizado, día-granularidad, no calzan con
  límites de mes calendario); los presets de mes completo reutilizan
  `/api/reports/generate` y `/api/reports/range` ya existentes (ambos ahora
  aceptan `userIds` opcional). Nuevo módulo `src/components/kpis/reports/
  wizardExport.ts` normaliza las 3 formas de datos (mes/rango de
  meses/rango de fechas) y arma la exportación sin recalcular ningún KPI.
- **FEATURE — Estado del Colaborador (Bloque 9):** columna nueva en la
  tabla de detalle (🟢 Equilibrio Óptimo / 🔵 Equilibrio Estable / 🟡
  Requiere Atención / 🟠 Riesgo Operativo / 🔴 Desequilibrio Crítico).
  Reutiliza literalmente `classifyEstadoOperativo` (`analytics.ts`): con el
  Equilibrio Operativo real cuando el informe es del mes calendario en
  curso, o una aproximación derivada de cumplimiento/carga/vencidas para
  cualquier otro período (mismo criterio que el Índice Ejecutivo — Capacidad
  Futura no es representativa para un período ya cerrado, ver
  `docs/DECISIONS.md` § Sprint Reportes Ejecutivos 2.0). Nueva función
  `deriveEstadoOperativo` en `reportInsights.ts`.
- **FEATURE — Principal Hallazgo (Bloque 10):** columna nueva, reglas fijas
  sin IA (`computePrincipalHallazgo`, `reportInsights.ts`) sobre carga,
  cumplimiento, vencidas y consistencia (esta última solo cuando está
  disponible, mes en curso): Sobrecarga → Subutilización → Retrasos
  recurrentes → Consistencia baja → Sin tareas vencidas → Carga equilibrada.
- **FEATURE — Interpretación de Consultas en informes de rango (Bloque
  11):** los informes de rango (`/api/reports/range`,
  `/api/reports/custom-range`) ahora calculan tendencia por motivo vs. un
  "período anterior equivalente" (misma duración en días, terminando el día
  previo al inicio del rango) — nueva función `previousEquivalentPeriod`
  (`reportInsights.ts`). Antes solo el informe de un mes tenía tendencia
  (cierra el ítem pendiente de `docs/ROADMAP.md` § Sprint Reportes
  Ejecutivos 2.0, Bloque 6).
- **FEATURE — preparación de arquitectura para Comparación de Equipos
  (Bloque 12):** `src/lib/teamComparison.ts` — tipos y función placeholder
  (`computeTeamComparison`, no implementada). Sin cambios de schema (NEXO no
  tiene hoy un campo de área/equipo/zona en `User`) y sin UI — solo deja
  preparada la forma de los datos para un sprint futuro.
- **PERFORMANCE — paridad Excel/PDF:** `downloadReportExcel`/
  `downloadRangeExcel` (`MonthlyReports.tsx`) ganan las hojas que solo
  existían en PDF desde Sprint Reportes Ejecutivos 2.0 (Índice Ejecutivo,
  Hallazgos y Recomendaciones, Mapa de Riesgo, Tendencias e Insights) y las
  columnas Estado/Principal Hallazgo/Base prorrateada; el PDF de rango gana
  una tabla "Detalle por Colaborador" que antes solo existía en Excel.

**Archivos afectados:** `src/lib/workload.ts` (`businessBaseForRange`,
`sumWeightedLimit` exportado), `src/lib/reportInsights.ts`
(`computeEffectiveMemberBases`, `deriveEstadoOperativo`,
`computePrincipalHallazgo`, `previousEquivalentPeriod`), `src/lib/
teamComparison.ts` (nuevo), `src/app/api/reports/generate/route.ts`,
`src/app/api/reports/range/route.ts`, `src/app/api/reports/custom-range/
route.ts` (nuevo), `src/components/kpis/types.ts`, `src/components/kpis/
MonthlyReports.tsx`, `src/components/kpis/reports/ReportWizardModal.tsx`
(nuevo), `src/components/kpis/reports/wizardExport.ts` (nuevo),
`src/__tests__/api/reports.test.ts` (mocks ampliados para las nuevas
dependencias de Prisma).

**Impacto:** los informes ejecutivos comparan colaboradores de forma justa
sin importar cuándo empezaron a usar NEXO, permiten generar exactamente el
informe que Coordinadores/Jefe Nacional/Gerencia necesitan (colaboradores,
período y secciones a medida) en 3 formatos, y cada colaborador muestra un
estado operativo y un hallazgo principal identificables de un vistazo —
mejora directa de interpretación y toma de decisiones sin tocar ningún
cálculo del Analytics Engine.

**Autor:** Claude Code

---

## v1.17.0 — 2026-07-24

**Tipo:** FEATURE / ANALYTICS
**Módulo:** Sprint Reportes Ejecutivos 2.0 — Inteligencia Organizacional en el Informe Consolidado

Transforma el Informe Mensual Consolidado (`/kpis` → Informes) de una
exportación de tablas a un informe ejecutivo: primera página de resumen,
hallazgos y recomendaciones generados por reglas (nunca IA), interpretación
por indicador, visualizaciones (recharts), mapa de riesgo, tendencias
automáticas e Índice Ejecutivo del Equipo. **No modifica el Analytics
Engine** (`src/lib/analytics.ts`) ni ninguna fórmula/peso existente — todo
lo nuevo es una capa de composición sobre datos que el motor ya calcula.
Ver `docs/AUDIT_LOG.md` § Sprint Reportes Ejecutivos 2.0 para el detalle de
decisiones y `docs/DECISIONS.md` para el índice.

- **FEATURE — nuevo módulo `src/lib/reportInsights.ts`:** motor de
  interpretación de reportes, 100% determinístico (mismo principio que
  `insightsEngine.ts`, a nivel de equipo en vez de individuo):
  `classifyIndiceEjecutivo`, `computeTeamMonthlySnapshots`,
  `computeTrendComparisons`, `computeRiskQuadrant`,
  `explainMotivoDistribution`, `computeFindings`, `computeRecommendations`,
  `computeTeamInsights`, `explainCumplimientoIndicator`/
  `explainCargaIndicator`/`explainConsultasIndicator`.
- **FEATURE — Resumen Ejecutivo (Bloque 1):** primera sección del informe —
  score y estado del Índice Ejecutivo, variación vs. informe anterior,
  riesgos críticos, alertas, personas destacadas y en riesgo, todo en una
  sola pantalla (`ExecutiveSummarySection.tsx`).
- **FEATURE — Índice Ejecutivo del Equipo (Bloque 11):** promedio de
  Performance Score + Equilibrio Operativo por miembro, clasificado en 4
  niveles (Excelente/Bueno/Atención/Crítico). Disponible **solo cuando el
  informe es del mes calendario en curso** — Capacidad Futura (parte de
  Equilibrio Operativo) es una proyección hacia adelante, no representativa
  para un mes pasado; en informes de meses históricos se muestra una nota
  explicativa en su lugar.
- **FEATURE — Hallazgos Automáticos y Recomendaciones Ejecutivas (Bloques
  2 y 3):** reglas fijas sobre datos ya calculados (variación de
  cumplimiento, colaboradores subutilizados/sobrecargados, tareas
  vencidas, motivo dominante) — explícitamente sin IA, coexistiendo con el
  bloque "Análisis IA" (Groq) ya existente, que se mantiene intacto como
  lectura complementaria.
- **FEATURE — Mapa de Riesgo (Bloque 8):** matriz Cumplimiento×Carga
  (`RiskMatrixChart.tsx`, `ScatterChart` de recharts), un punto por
  colaborador, 4 cuadrantes.
- **FEATURE — Tendencias automáticas (Bloque 9):** comparación del
  cumplimiento del equipo vs. mes anterior/trimestre/semestre
  (`TrendsSection.tsx`), vía `computeTeamMonthlySnapshots` — seguro para
  cualquier mes (sin Capacidad Futura).
- **FEATURE — Insights (Bloque 10):** observaciones automáticas tipo
  "X concentró el N% del tiempo ejecutado" (`TeamInsightsSection.tsx`).
- **ANALYTICS — Distribución por Motivo enriquecida (Bloque 6):** cada
  motivo ahora muestra % del total, tendencia vs. período anterior (solo
  en el informe de un mes) e interpretación generada por reglas.
- **UI — Interpretación por indicador (Bloque 5):** Cumplimiento/Carga/
  Consultas del equipo ahora responden qué significa/por qué/impacto/
  acción (`IndicatorInterpretation.tsx`).
- **UI — Ranking visual y exportación PDF:** el ranking ya usaba tarjetas
  con barra de progreso (no tabla); la exportación PDF/impresión
  (`downloadReportPDF`/`downloadRangePDF`) se amplió con las mismas
  secciones nuevas en formato texto/tabla.
- **Archivos nuevos:** `src/lib/reportInsights.ts`,
  `src/components/kpis/reports/{ExecutiveSummarySection,FindingsSection,
  RecommendationsSection,RiskMatrixChart,TrendsSection,
  TeamInsightsSection,IndicatorInterpretation}.tsx`.
- **No modifica** `src/lib/analytics.ts`, ningún peso/fórmula/rol/permiso
  existente. Verificación: `tsc --noEmit` (2 errores preexistentes sin
  relación), `eslint .` limpio (3 warnings preexistentes sin relación),
  `vitest run` 962/962 (936 previos + 26 nuevos), `next build` exitoso.

---

## v1.16.0 — 2026-07-24

**Tipo:** ANALYTICS / FEATURE
**Módulo:** Sprint Analytics 2.0 — Inteligencia Explicable e Interpretación Ejecutiva

Revive `computeHealthScore` (congelado desde Sprint 5 §S5-A) como indicador
estrella bajo el nombre **Equilibrio Operativo** y le agrega una capa
completa de explicabilidad automática — cada resultado ahora responde
automáticamente 4 preguntas: ¿qué significa?/¿por qué?/¿qué impacto
tiene?/¿qué puedo hacer? Ver `docs/AUDIT_LOG.md` § Sprint Analytics 2.0 para
el detalle completo de decisiones y `docs/ANALYTICS_FORMULAS.md` §3 para la
referencia técnica.

- **ANALYTICS — rename de marca "Score de Salud Laboral" → "Equilibrio
  Operativo":** todo texto visible al usuario (tarjetas, tooltips,
  `ExplainModal`, narrativas de Nova, Ajustes) y la prosa de documentación
  técnica. **Deliberadamente no renombrado:** los símbolos de código
  (`computeHealthScore`/`HealthScoreResult`/`HealthFactor`) ni el valor
  persistido `AnalyticsAuditLog.kind = "health_score"` (miles de filas
  históricas) — ver `docs/DECISIONS.md`.
- **FEATURE — nueva identidad visual:** la tarjeta ahora siempre muestra
  score + Estado Operativo (5 niveles: 🟢 Equilibrio Óptimo / 🔵 Equilibrio
  Estable / 🟡 Requiere Atención / 🟠 Riesgo Operativo / 🔴 Desequilibrio
  Crítico) + tendencia + variación vs. hace 30 días, con la escala completa
  de interpretación siempre visible (no en un modal).
- **FEATURE — motor de interpretación automática, 100% determinístico (sin
  IA):** nuevas funciones en `insightsEngine.ts`
  (`computeEquilibrioInsights`/`explainEquilibrioFactor`/
  `explainEquilibrioMeaning`/`explainEquilibrioImpact`) generan, sobre las 5
  dimensiones ya calculadas: párrafo de significado, explicación por
  dimensión, fortalezas reales, aspectos a mejorar (con motivo),
  narrativa de impacto operativo y recomendaciones basadas en reglas fijas
  por dimensión — nunca texto generado por IA.
- **ANALYTICS (único cambio de fórmula) — normalización progresiva de
  Capacidad Futura:** `capacityToScore` reemplaza el salto abrupto anterior
  (cualquier sobrecarga proyectada caía a 0) por una curva lineal
  (`score = 100 + 2×disponiblePct`, acotada a [0,100]) activada por
  `estado === "sobrecarga"`. `FORMULA_VERSIONS.capacidadDisponible`/
  `equilibrioOperativo` → `"1.1"`; `FORMULA_SET_VERSION` `4.3` → `4.4`.
  Afecta solo a usuarios con capacidad futura negativa proyectada.
- **ANALYTICS — auto-explicación de Consistencia "Variable"/"Muy variable":**
  nuevo campo `ConsistencyResult.explain.impactNote` con la frase de impacto
  cualitativo ("...reduciendo la estabilidad operativa" / "...afectando
  significativamente la previsibilidad operativa").
- **ANALYTICS — calidad del cálculo ampliada:** el detalle de cálculo de
  Equilibrio Operativo (`GET /api/analytics/equilibrio/[userId]`, nuevo)
  ahora expone también tiempo de procesamiento, registros utilizados/
  descartados y advertencias, además de calidad del dato/confiabilidad/
  versión/fecha/origen que ya existían.
- **Archivos nuevos:** `src/app/api/analytics/equilibrio/[userId]/route.ts`,
  `src/components/kpis/EquilibrioOperativoCard.tsx`.
- **No modifica** ningún otro KPI, peso, rol ni permiso existente — la única
  fórmula tocada es la descrita arriba (autorizada explícitamente por el
  alcance del sprint). Verificación: `tsc --noEmit` (2 errores preexistentes
  sin relación), `eslint .` limpio (3 warnings preexistentes sin relación),
  `vitest run` 936/936 (919 previos + 17 nuevos), `next build` exitoso.

---

## v1.15.1 — 2026-07-24

**Tipo:** UX / ANALYTICS (calidad del dato) / DOCUMENTATION
**Módulo:** Sprint D (continuación) — UX, Calidad del Dato ampliada, validación de efectos secundarios

Versión más detallada del mismo Sprint D (v1.15.0, entrada siguiente) —
cubre Bloque 7 (UX, con hallazgos reales de una auditoría dedicada),
Bloque 5 ampliado (2 verificaciones nuevas), y un Bloque 11 nuevo
(validación de efectos secundarios). Ver `docs/AUDIT_LOG.md` § Sprint D
(continuación) para el detalle completo.

- **UX (10 fixes, solo markup, cero cambio de comportamiento):** `Spinner`
  compartido en 18 archivos (Reuniones/Perfil/Nova/KPIs/Desk/Ajustes);
  `aria-label` en ~19 modales sin `Modal`/`ModalHeader`; `EmptyState`
  deduplicado en Proyectos y Nova (copias idénticas ya existentes en otros
  archivos); tabla LOPDP de Perfil envuelta en `overflow-x-auto`; `Button`
  compartido migrado en Ideas/Reuniones/Proyectos (17 botones); radio de
  banners de error normalizado a `rounded-lg`; ícono de cierre normalizado
  a `w-4 h-4`; padding de tarjeta normalizado a `p-4` en Ideas/Reuniones.
- **Calidad del Dato — 2 verificaciones nuevas:** actividades con
  `TaskActivity.reason` que no existe en el catálogo de `ActivityReason`
  (motivo huérfano — `reason` es un String libre, no una FK real);
  registros con `isRetroactive`/`activityDate` internamente inconsistentes.
  Se extendió también el chequeo "sin propietario" a
  `ProjectParticipant.userId`.
- **Validación de efectos secundarios (nuevo, informe en AUDIT_LOG):**
  confirmado por `git diff` que ningún cambio de v1.15.0 ni de esta
  versión tocó `analytics.ts`/`capacityForecast.ts`/`workload.ts`/
  `priorityCompliance.ts`/`normalizationEngine.ts`/`prisma/schema.prisma`
  ni `projectHistory.ts`; los 22 call sites de `invalidateAnalyticsCache()`
  previos siguen intactos (+2 nuevos, cero remociones); las funciones de
  recálculo de horas son extracciones literales, sin cambio de fórmula.
- **No modifica** ninguna fórmula, KPI, permiso existente ni regla de
  negocio — 3 hallazgos UX que sí tocaban comportamiento (primitivo
  `Input`/`FormField`, color de banner info/confirmación, tecla Espacio en
  `IdeaCard`) quedaron documentados en `docs/ROADMAP.md`, sin implementar.

**Pruebas:** 919/919 pasando (+6 nuevas para las 2 verificaciones de
Calidad del Dato). `tsc`/`eslint` en la misma baseline previa. `next build`
exitoso.

**Archivos:** ~40 archivos de UI en `src/components/{ideas,meetings,projects,tasks,desk,kpis,assistant,settings}/**`
y `src/app/login/page.tsx`/`src/app/(protected)/profile/page.tsx` (solo
markup); `src/app/api/settings/data-quality/route.ts` (2 chequeos nuevos).

---

## v1.15.0 — 2026-07-24

**Tipo:** SECURITY / REFACTOR / PERFORMANCE / FEATURE / DOCUMENTATION
**Módulo:** Sprint D — Optimización y Refinamiento (auditoría integral de los 10 módulos, sin nuevos módulos, sin tocar fórmulas del Analytics Engine)

**Contexto:** Bloque 1 exigía una auditoría funcional previa a cualquier cambio.
Se ejecutó vía 3 agentes de investigación de solo lectura (Trabajo/Seguimiento/
Proyectos; Escritorio Digital/Reuniones/Equipo/Usuarios/Ajustes; Analytics/
Dashboard/Seguridad/Calidad del dato), con ~40 hallazgos concretos citados por
archivo:línea. De esos hallazgos, un subconjunto cambiaba comportamiento de
negocio existente (ej. notificar a invitados al reprogramar una reunión) —
el propio Sprint D exige aprobación para ese tipo de cambio, así que se
consultó el alcance con el usuario, que eligió explícitamente **"Solo lo
seguro"**: implementar todo lo que es bug/seguridad/deuda técnica/performance
sin tocar comportamiento de negocio, y documentar el resto como backlog. Ver
`docs/AUDIT_LOG.md` § Sprint D para el detalle completo de la auditoría, la
decisión de alcance y el informe final (Bloque 12).

- **SECURITY — cierra un IDOR real**: 5 rutas de subrecursos de tareas
  (`tasks/[id]/comments`, `tasks/[id]/activities`, `tasks/[id]/activities/[activityId]/comments`,
  `tasks/[id]/activities/retroactive`) no verificaban que la tarea fuera
  visible/propia del solicitante — cualquier usuario autenticado podía leer y
  escribir comentarios/horas de cualquier tarea del sistema, corrompiendo
  `realHours`/carga laboral de otra persona. Nuevo `src/lib/taskAccess.ts`
  (`canAccessTask`, mismo patrón que `projectAccess.ts`), aplicado en los 5
  archivos y reutilizado también en `tasks/[id]/route.ts` (dedup). Además,
  `DELETE /api/users/[id]` lanzaba un 500 crudo (violación de FK no
  controlada) al eliminar cualquier usuario con historial — ahora responde
  409 con un mensaje claro.
- **REFACTOR — consolida duplicación segura**: `recalcRealHours` (4 copias →
  `src/lib/recalcHours.ts`), `parseDateOnly` (2 copias → `businessTime.ts`),
  `formatRelative` (2 copias → `utils.ts`), `formatDuration` (4 copias con
  formato inconsistente → `utils.ts`, estandarizado a la variante que omite
  unidades en cero), `taskSelect` (2 copias idénticas → uno solo, importado),
  el chequeo de jerarquía de Usuarios repetido 4 veces (→
  `canManageTargetUser` en `roles.ts`). Corrige además: `ideas/route.ts`
  usaba un array de roles hardcodeado en vez de `CAN_REVIEW_IDEAS`;
  `operational-risk/team` notificaba con la tabla estática
  `NOTIFICATION_TARGETS` en vez de `getNotificationRules()` (no honraba
  reconfiguraciones desde Ajustes); `activity-reasons` no invalidaba la
  caché de Analytics al cambiar `assignedRoles`; `ProjectCard.tsx` nunca
  migró al sistema de Chips de Sprint B; `CommentPanel.tsx` (Tareas)
  todavía tenía el fallo silencioso que Sprint C §7 ya había corregido en
  Proyectos (ahora usa el mismo `useToast()` + "Reintentar"); `meetings/[id]/route.ts`
  no tenía ningún manejo de errores.
- **PERFORMANCE**: `dashboard/route.ts` agrupó ~9 consultas independientes
  en un solo `Promise.all` (antes secuenciales); gráficos de KPIs
  (`KpiCharts.tsx`, `ScoreHistoryChart.tsx`, `ExecutiveDashboard.tsx`)
  memoizan sus transformaciones de datos con `useMemo`; `UsersManager.tsx`
  ganó un buscador (nombre/correo/rol) sobre la lista ya cargada.
- **FEATURE — Calidad del Dato**: nuevo panel de diagnóstico de solo
  lectura dentro de Ajustes (no un módulo nuevo), `GET /api/settings/data-quality`
  (solo Administrador, bajo demanda, sin cron): fechas inválidas, progreso/
  horas fuera de rango, registros sin propietario, horas duplicadas (mismo
  autor, horario solapado, cruzando Tarea↔Proyecto — evidencia el hueco de
  `findOverlappingActivity` documentado en el backlog sin corregirlo),
  registros huérfanos (confirmación estructural vía llaves foráneas).
- **No modifica** ninguna fórmula del Analytics Engine, permisos existentes
  fuera del propio hallazgo de seguridad, ni ninguna regla de negocio — los
  ~8 hallazgos que sí la cambiaban quedaron documentados como backlog
  (`docs/DECISIONS.md`, `docs/ROADMAP.md`), no implementados.

**Pruebas:** 913/913 pasando (7 nuevas, cubriendo el IDOR cerrado, el 409 de
`DELETE /api/users/[id]` y el nuevo endpoint de calidad del dato). `tsc`/
`eslint` en la misma baseline previa (2 errores/3 warnings preexistentes, sin
relación). `next build` exitoso.

**Archivos:** `src/lib/taskAccess.ts` (nuevo), `src/lib/recalcHours.ts`
(nuevo), `src/app/api/settings/data-quality/route.ts` (nuevo),
`src/components/settings/DataQualitySection.tsx` (nuevo), más ~25 archivos
modificados en `src/app/api/tasks/**`, `src/app/api/users/**`,
`src/app/api/meetings/**`, `src/app/api/ideas/route.ts`,
`src/app/api/analytics/operational-risk/team/route.ts`,
`src/app/api/settings/activity-reasons/**`, `src/app/api/dashboard/route.ts`,
`src/lib/roles.ts`, `src/lib/businessTime.ts`, `src/lib/utils.ts`,
`src/components/kpis/**`, `src/components/tasks/CommentPanel.tsx`,
`src/components/projects/{ProjectCard,ProjectCommentsTab,ProjectPhasesTab,ProjectActivitiesTab,PhaseDetailModal}.tsx`,
`src/components/UsersManager.tsx`.

---

## v1.14.3 — 2026-07-24

**Tipo:** FIX
**Módulo:** Migración perezosa de historial — `migrateFijaHistoryIfNeeded` (`src/app/api/tasks/[id]/activities/route.ts`)

**Implementado:** cierra una ventana teórica de condición de carrera en la
migración automática de historial de tareas Fijas (crea una `TaskActivity`
sintética la primera vez que se listan las actividades de una tarea Fija
con `realHours > 0` y cero actividades). El `count()` seguido de `create()`
original no tenía ninguna garantía transaccional entre ambas llamadas —
dos peticiones `GET /activities` concurrentes para la misma tarea podían,
en teoría, crear cada una su propia actividad migrada, duplicando esas
horas. Nunca se observó en los datos de producción auditados (ver
`docs/AUDIT_LOG.md` § de este mismo día), pero se cierra el hueco.

- **Cambio:** `count()` → `upsert()` (motivo de migración) → `create()`
  ahora corren dentro de una única `prisma.$transaction(...)` con nivel de
  aislamiento `Serializable`. Si dos transacciones concurrentes chocan,
  Postgres falla una de las dos por conflicto de serialización — la
  perdedora se captura y se ignora (la otra ya completó la migración), sin
  propagar el error al handler `GET`.
- **Sin cambio de comportamiento observable** en el caso normal (sin
  condición de carrera): mismo resultado, misma actividad creada.
- **No modifica** ninguna fórmula, el Analytics Engine, KPIs, permisos ni
  reglas de negocio — es una corrección de robustez/concurrencia sobre una
  migración de datos ya existente.
- **Pruebas:** `src/__tests__/api/tasks-activities-comments.test.ts`
  actualizado — el mock de Prisma ahora simula `$transaction` invocando el
  callback con el mismo cliente mockeado. Suite completa: 900/900 pasando.

**Impacto:** ninguno en el comportamiento normal observado por los
usuarios; cierra un riesgo teórico de duplicación de horas en un escenario
de concurrencia poco común.

**Archivos:** `src/app/api/tasks/[id]/activities/route.ts`,
`src/__tests__/api/tasks-activities-comments.test.ts`.

---

## v1.14.2 — 2026-07-24

**Tipo:** DATABASE / FIX
**Módulo:** Migración histórica única de datos — `Task.completedAt`

**Implementado:** backfill histórico de ejecución única, no una regla
permanente. Regulariza exclusivamente las **33 tareas** identificadas en la
auditoría de `isCompletedOnTime` (v1.14.1) con `status = COMPLETADA` y
`completedAt = NULL` — limitación del modelo de datos anterior a que NEXO
empezara a registrar automáticamente esa fecha (migración
`20260707004617`, sin backfill en su momento), no un error del usuario.

- **Alcance:** exactamente 33 tareas, verificadas por consulta directa
  antes de escribir (no reutilizado ciegamente el número de la auditoría
  previa) — coincidió. Ninguna tarea adicional, de ningún otro estado, fue
  tocada. Ningún otro campo de esas 33 tareas se modificó.
- **Actualización:** `completedAt = endDate` para cada una, dentro de una
  única transacción (todo o nada).
- **Validación post-migración:** 33 actualizadas · 0 tareas `COMPLETADA`
  con `completedAt` nulo restantes · total de tareas `COMPLETADA` sin
  cambios (121 → 121, confirma que no se creó/eliminó ninguna) ·
  "completadas a tiempo" (Definición B) 57/121 → 90/121 (+33, exactamente
  las regularizadas).
- **Prevención futura (§7):** se verificó que `PATCH /api/tasks/[id]` y
  `POST /api/tasks/import` ya no podían reproducir este problema; se
  encontró y corrigió un tercer camino con el mismo gap —
  `POST /api/tasks` (crear una tarea ya con estado inicial `COMPLETADA`) no
  fijaba `completedAt`. Corregido en el mismo cambio
  (`src/app/api/tasks/route.ts`).
- **No modifica** la fórmula de Cumplimiento, el Analytics Engine, el
  NormalizationEngine, Performance Score, Riesgo Operativo, pesos, curvas
  ni benchmarks — es exclusivamente una regularización de datos históricos
  más el cierre de un gap de comportamiento (no de fórmula) hacia adelante.
- **No se repetirá:** migración de una sola vez, sin mecanismo para
  reejecutarse.

**Impacto:** el indicador "Cumplimiento" (Definición B, vista personal)
sube para los colaboradores dueños de esas 33 tareas, reflejando ahora que
sí se completaron (aproximado a su fecha objetivo, único dato disponible).
No afecta la Definición A ni ningún otro indicador.

**Archivos:** `src/app/api/tasks/route.ts` (prevención futura); migración
de datos ejecutada vía script de una sola vez, no versionado en el
repositorio (no es una migración de schema de Prisma — no cambia
estructura, solo regulariza valores existentes).

**Autor:** Claude Code

---

## v1.14.1 — 2026-07-24

**Tipo:** FIX / ANALYTICS
**Módulo:** Analytics — Cumplimiento por prioridad / personal (`isCompletedOnTime`)

**Implementado:** corrección de un bug real de clasificación en "completado
A TIEMPO" (Definición B de Cumplimiento, `src/lib/priorityCompliance.ts`,
usada en `/api/kpis/[userId]` y `/api/kpis/me` — la vista personal). Se
ejecutó primero una auditoría de solo lectura (sin tocar fórmulas) que
confirmó el diagnóstico con datos reales de producción antes de corregir
nada, a pedido explícito.

- **Bug:** la comparación `completedAt.getTime() <= endDate.getTime()`
  (instante UTC crudo) clasificaba como tardía cualquier tarea cerrada
  durante el horario laboral real del propio día de vencimiento, porque
  medianoche UTC del día de vencimiento equivale a las 7pm del día ANTERIOR
  en huso de negocio (Ecuador/Colombia, UTC-5).
- **Verificación empírica:** de 65 tareas clasificadas como "fuera de
  tiempo" en producción, 33 (51%) se habían completado el mismo día
  calendario — mal clasificadas por el bug, no genuinamente tardías. El
  cumplimiento a tiempo real pasaba de 26% a 64% sobre esas tareas con la
  clasificación correcta.
- **Corrección:** `isCompletedOnTime` ahora compara por día calendario en
  huso de negocio (`businessCalendarDay(completedAt) <= utcCalendarDay(endDate)`),
  reutilizando el mismo patrón que ya usa `isTaskOverdue` para "vencida".
  `utcCalendarDay` (`src/lib/utils.ts`) se exportó (antes era privada) en
  vez de reimplementarse.
- **Versionado:** `FORMULA_VERSIONS.completadoATiempo = "1.0"` (nueva
  entrada — primera vez que esta fórmula se versiona formalmente).
  `FORMULA_SET_VERSION` 4.2 → 4.3.
- **Tests:** 3 casos nuevos en `src/__tests__/analytics-formulas.test.ts`
  cubren explícitamente el escenario del bug (mismo día calendario con
  timestamp posterior a medianoche UTC) para prevenir una regresión.
- **Hallazgo aparte, documentado pero no corregido:** 33 tareas
  `COMPLETADA` adicionales tienen `completedAt = NULL` (anteriores a la
  migración que agregó la columna, sin backfill) — es un problema de datos
  históricos faltantes, no de fórmula; backfillear un timestamp que nunca
  se registró requeriría inventar un valor.

**Impacto:** el "Cumplimiento" (Definición B) en `/api/kpis/[userId]`/`/api/kpis/me`
sube para la mayoría de los colaboradores, reflejando correctamente las
tareas cerradas el mismo día de vencimiento. **No afecta** la Definición A
(Health Score, Performance Score, panel ejecutivo/equipo, informes) — nunca
usó `completedAt`/`endDate`. No se modificó ningún otro cálculo, permiso,
regla de negocio ajena a esta fórmula, ni el schema de base de datos.

**Archivos:** `src/lib/priorityCompliance.ts`, `src/lib/utils.ts`,
`src/lib/analytics.ts` (versionado), `src/__tests__/analytics-formulas.test.ts`.

**Autor:** Claude Code

---

## v1.14.0 — 2026-07-24

**Tipo:** UX / FEATURE
**Módulo:** Sprint C — NEXO Experience (Product Excellence)

**Implementado:** refinamiento de interacción y fricción anclado en un
informe de hallazgos previo (3 agentes de investigación sobre flujos de
clics, contenido del Dashboard, y calidad de mensajes de error/éxito) — sin
tocar Analytics Engine, KPIs, base de datos, permisos, autenticación ni
reglas de negocio. Ver `docs/PRODUCT_REVIEW.md` para la auditoría de
producto completa (fortalezas/debilidades/deuda técnica y de UX/
recomendaciones futuras).

- **Fase 1 — Reducción de clics:** "+ Nueva nota" en el header de
  Escritorio Digital (visible desde cualquier pestaña, antes 4 clics);
  enlace "Ver mi desempeño" en Analytics para roles con KPIs individuales de
  ejecución (`isLeadershipRole`, sin lógica nueva); búsqueda de tareas
  ahora también compara descripción y responsable asignado.
- **Fase 2 — Consistencia de navegación:** `BackLink` compartido (antes 3
  implementaciones distintas de "volver"); selector de estado en Kanban
  como complemento del drag-and-drop existente (el único de los 4
  mecanismos de cambio de estado detectados que no tenía alternativa de
  clic).
- **Fase 3 — Error y éxito:** acción "Reintentar" en `Toast`; 3 fallos
  genuinamente silenciosos corregidos (`ProjectCommentsTab`,
  `ProjectHistoryTab`, `PhaseDetailModal`); fuga técnica cerrada en
  `AssistantModule`/`assistant/chat/route.ts`; nueva clase `RecoveryError`
  para que las rutas de Proyectos/Escritorio Digital/Papelera solo reenvíen
  `err.message` cuando es un error curado, no cualquier excepción
  inesperada; `useToast()` extendido a Ideas, Reuniones y el resto de
  Proyectos; `profile/page.tsx` migrado a `useToast()`.
- **Fase 4 — Dashboard:** nueva card "Mis proyectos" (reutiliza la regla de
  acceso ya existente de `GET /api/projects`, sin cálculo nuevo) — cierra el
  hueco más claro del audit; `jornada` rebalanceada (resumen de urgencia en
  el espacio más prominente en vez de un saludo decorativo); mensaje de
  bienvenida ahora descartable.
- **Fase 5 — Ayuda contextual y acciones inteligentes:** `InfoTooltip`
  (versión liviana del `HelpPopover` de Analytics) en 3 puntos de fricción
  real; búsquedas recientes en el buscador de Escritorio Digital
  (localStorage, sin IA — única instancia de "acciones inteligentes" de
  este sprint).
- **Fase 6 — Documentación:** `docs/PRODUCT_REVIEW.md` (nuevo).

**Impacto:** puramente de interacción/UX — todos los commits pasan
`npx tsc --noEmit`, `npx eslint` y `npm test` (897 tests) limpios. Cero
diff en `prisma/schema.prisma`, `src/lib/analytics.ts`, `src/lib/roles.ts`
(solo se **consumen** funciones existentes como `isLeadershipRole`, nunca se
modifican), `src/lib/session.ts`, `src/proxy.ts`, `src/lib/workload.ts` ni
`src/lib/capacityForecast.ts`.

**Deliberadamente fuera de alcance** (documentado como recomendación futura
en `docs/PRODUCT_REVIEW.md` §10): relajar `targetTimeHours` en Crear
Proyecto (requiere migración de schema), un buscador global unificado
tareas+proyectos+notas (feature nueva, no una unificación de UI), sistema de
onboarding/tour completo, y unificar el cambio de estado de Ideas (quedó
como el único de los 4 mecanismos detectados sin resolver).

**Autor:** Claude Code

---

## v1.13.0 — 2026-07-24

**Tipo:** UI / UX
**Módulo:** Design System — Sprint B (UX Consistente + Design System Foundation)

**Implementado:** unificación de la experiencia visual de la plataforma sin
tocar lógica de negocio, Analytics Engine, KPIs, permisos, autenticación ni
el esquema de base de datos. Ver `docs/DESIGN_SYSTEM.md` para la referencia
completa de cada primitivo y el informe de Design Review (§25 del sprint).

- **Fase 0 — Primitivos:** `Button` ampliado de 4 a 6 variantes
  (`tertiary`/`success` nuevas, más `size`/`loading`); `PriorityChip`/
  `StatusChip` (un único componente visual sobre `Badge`, parametrizado por
  `src/lib/chipConfig.ts` — un `ChipConfig` por enum real de
  `prisma/schema.prisma`, nunca valores inventados); `Table`/`TableHead`/
  `TableBody`/`TableRow`/`Th`/`Td` (chrome compartido, sin lógica de
  orden/filtro propia); `ToastProvider`/`useToast` (mensajes estandarizados,
  montado en `src/app/layout.tsx`); `Skeleton`/`SkeletonText`/`SkeletonRow`/
  `Spinner`; `EmptyState`; `SearchInput`; `formatTime()` en `src/lib/utils.ts`.
- **Fase 1 — Botones:** 102 `<button>` ad-hoc → `Button` en 45 archivos
  (Tareas, Dashboard, Escritorio Digital, Equipo, KPIs, Ajustes, Usuarios).
- **Fase 2 — Chips:** mapas locales de color/label de prioridad y estado
  duplicados (`PRIORITY_VARIANT`, `STATUS_STYLES`, `REMINDER_PRIORITY_COLOR`,
  etc.) → `PriorityChip`/`StatusChip` en 10 archivos.
- **Fase 3 — Tablas, loading, empty states:** 15 `<table>` hand-rolled →
  `Table`; texto suelto "Cargando..."/spinners ad-hoc → `Skeleton`/`Spinner`;
  mensajes "sin resultados" sueltos → `EmptyState`, en 28 archivos.
- **Fase 4 — Toasts:** banners inline de guardado/error por componente
  ("Guardado correctamente", "Error al guardar") → `useToast()`, en 14
  archivos. Se preservaron inline los errores de validación de formulario
  que deben permanecer visibles mientras el formulario sigue abierto.
- **Fase 5 — Modales e iconografía:** 5 overlays hand-rolled (`TaskFormModal`,
  `CorrectArchivedTaskModal`, `NewReminderModal`, `NoteToReminderModal`,
  `CreateProjectModal`) → `Modal`/`ModalHeader`; `<svg>` inline ad-hoc →
  `lucide-react` en 8 archivos.
- **Fase 6 — Documentación:** `docs/DESIGN_SYSTEM.md` oficial (nuevo),
  incluyendo el informe de Design Review con backlog explícito para
  Sprint C — NEXO Experience (Ideas, Reuniones, Proyectos parcial,
  Repositorio, Nova, Login, Perfil quedan sin tocar).

**Impacto:** puramente visual/estructural — 100% de los commits de este
sprint pasan `npx tsc --noEmit` y `npx eslint` limpios (solo persisten 2
errores preexistentes no relacionados en `src/__tests__/**`). No se modificó
`src/lib/analytics.ts`, `src/lib/roles.ts`, `src/lib/session.ts`,
`src/proxy.ts` ni `prisma/schema.prisma` en ningún commit de este sprint.

**Archivos:** ver los 6 commits de este sprint (`feat(design-system):
primitivos...` y 5 `refactor(ui): ...`) para el detalle archivo por archivo
de cada fase — no se repiten aquí para no duplicar `git log`.

**Autor:** Claude Code

---

## v1.12.0 — 2026-07-23

**Tipo:** FEATURE / ANALYTICS
**Módulo:** Analytics — capa de explicabilidad (Sprint A: Analytics Explicativo)

**Implementado:** capa de interpretación/visualización ENCIMA del Analytics
Engine existente — **cero cambios de fórmula, peso, curva o umbral**;
`analytics.ts`, `capacityForecast.ts`, `workload.ts`, `targetTime.ts` y
`normalizationEngine.ts` permanecen intactos.

- **Insights de Performance Score (fortalezas/oportunidades):**
  `computePerformanceInsights` (nuevo, `insightsEngine.ts`) traduce
  `PerformanceScoreResult.factors[]` YA calculados a `Insight[]` en ambas
  direcciones — factor con `normalizedValue` Alto/Muy alto → fortaleza
  (`tone: "positive"`); Bajo → oportunidad con acción concreta e impacto
  (`weight - points`, nunca inventado). Antes `insightsEngine.ts` solo
  traducía factores de Riesgo Operativo (siempre negativos por diseño).
- **Bloques "Fortalezas detectadas" / "Oportunidades de mejora"**
  (`InsightsPanel.tsx`): subconjuntos del mismo `insights[]` ya calculado,
  filtrados por `tone` — oportunidades ordenadas por impacto, máx. 5.
- **Explicación de tendencias:** `explainScoreTrend`/`getScoreTrendExplanation`
  (nuevo, `insightsEngine.ts`) comparan `factors[]` actuales vs. un snapshot
  histórico de `AnalyticsAuditLog` y narran qué factor subió/bajó más — nunca
  recalcula el score. Se muestra junto al Performance Score
  (`InsightsPanel`) y al Riesgo Operativo (`OperationalRiskCard`), donde el
  ▲/▼/= ya existente ahora viene acompañado de texto, no solo el número.
- **Ayuda contextual de 4 partes:** `INDICATOR_HELP` (nuevo,
  `analyticsExplain.ts`) + componente `HelpPopover` (click, no solo hover)
  para 6 indicadores principales (Performance Score, Score de Salud, Riesgo
  Operativo, Consistencia, Trazabilidad, Tiempo Objetivo) — qué significa/
  cómo se calcula/por qué importa/buenas prácticas, redactado desde
  `docs/ANALYTICS_FORMULAS.md`.
- **Histórico de evolución con selector de período:** nuevo endpoint
  `GET /api/analytics/history/[userId]?kind=&months=1|3|6|12` sobre
  `src/lib/analyticsAuditHistory.ts` (capa de solo lectura NUEVA sobre
  `AnalyticsAuditLog`, no forma parte del motor) + componente
  `ScoreHistoryChart.tsx` (recharts), montado en `MyKpisModule`,
  `KpisModule` y `OperationalRiskCard`.
- **Simulador "¿Qué pasaría si...?" personal:** `simulate/[userId]/route.ts`
  gana 4 escenarios nuevos (completar tareas, reducir vencidas, subir
  consistencia, registrar horas adicionales) que recalculan UN factor de
  Performance Score o Carga/Score de Salud con las MISMAS funciones puras
  del motor (`normalize`, `weightedPoints`, `classifyPerformanceScore`,
  `cargaHealthScore`) — nunca persiste nada. Nuevo componente standalone
  `WhatIfSimulator.tsx`, montado en `MyKpisModule` (el simulador de equipo
  existente en `TeamWorkloadCards.tsx` no se tocó). Respuesta incluye
  `diff` explícito (actual → simulado → diferencia).

**Archivos creados:** `src/lib/analyticsAuditHistory.ts`,
`src/app/api/analytics/history/[userId]/route.ts`,
`src/components/kpis/ScoreHistoryChart.tsx`,
`src/components/kpis/WhatIfSimulator.tsx`.

**Archivos modificados:** `src/lib/insightsEngine.ts` (+insights de
Performance Score, +explicación de tendencia),
`src/lib/analyticsExplain.ts` (+`INDICATOR_HELP`),
`src/components/kpis/AdvancedAnalytics.tsx` (+`HelpPopover`),
`src/components/kpis/InsightsPanel.tsx`,
`src/components/kpis/OperationalRiskCard.tsx`,
`src/components/kpis/TargetTimePrecisionCard.tsx`,
`src/components/kpis/KpiCharts.tsx` (`useChartTheme` exportado, sin cambio
de comportamiento), `src/components/kpis/MyKpisModule.tsx`,
`src/components/kpis/KpisModule.tsx`,
`src/app/api/analytics/insights/[userId]/route.ts`,
`src/app/api/analytics/operational-risk/[userId]/route.ts`,
`src/app/api/analytics/simulate/[userId]/route.ts`.

**Impacto:** ningún cambio en `ANALYTICS_ENGINE_VERSION` (1.5.0) ni
`FORMULA_SET_VERSION` (4.2) — se confirmó explícitamente que ningún archivo
del motor central (`analytics.ts`, `capacityForecast.ts`, `workload.ts`,
`targetTime.ts`, `normalizationEngine.ts`) fue modificado; los KPIs, scores y
clasificaciones existentes no cambian de valor para ningún usuario. Todo el
código nuevo es de solo lectura/composición sobre resultados ya calculados
(`PerformanceScoreResult.factors`, `AnalyticsAuditLog`) o recombinación con
las mismas funciones puras ya exportadas por el motor. Verificado con
`npm run build`, `npx tsc --noEmit` y `npx vitest run` (897 tests, sin
regresiones) tras cada bloque. `TeamWorkloadCards.tsx` (simulador de equipo
existente) no se modificó, por decisión explícita de minimizar riesgo sobre
un flujo ya en producción.

**Autor:** Claude Code (dirigido por Anthony Jácome).

---

## v1.11.0 — 2026-07-23

**Tipo:** FEATURE / BREAKING CHANGE / DATABASE
**Módulo:** Escritorio Digital (refinamiento — notas rápidas y recordatorios)

**Implementado:**
- **Lectura automática (§1):** se eliminó el botón "Marcar como leída" — abrir
  la tarjeta de la nota (nuevo `NoteDetailModal`) es lo único que la marca
  como leída, sin acción adicional. Sigue registrando usuario/fecha/hora
  (`readAt`, ya existía).
- **Confirmación de lectura (§2):** al leerse, el remitente recibe una
  notificación in-app ("Fulano leyó tu Nota Rápida.") — únicamente en la
  Campana, sin correos ni notas nuevas. Idempotente: reabrir una nota ya
  leída no vuelve a notificar.
- **Indicador visual (§3):** sin cambios de comportamiento — el punto rojo
  del sidebar (Sprint anterior) ya desaparecía solo cuando no quedan notas
  sin leer, que es exactamente lo que ahora dispara la lectura automática.
- **Respuestas cortas (§4):** nuevo modelo `DeskNoteReply` — máximo 2
  respuestas por nota entre remitente y destinatario, gestionadas desde
  `NoteDetailModal`. Al llegar al límite, la API responde 409 con el
  mensaje exacto pedido ("Esta conversación alcanzó el límite permitido.")
  y la interfaz sugiere convertir la nota en Recordatorio o Tarea. Cada
  respuesta notifica a la otra parte y queda auditada (`REPLIED`).
- **Convertir en Recordatorio reemplaza a Convertir en Tarea (§5, BREAKING):**
  el puente directo Nota→Tarea del sprint anterior se retiró por completo.
  Ahora una nota se convierte en `PersonalReminder` (`convertedToReminderId`
  en `DeskNote`, reemplaza a `convertedToTaskId`) — la nota permanece
  intacta y visible, nunca se elimina.
- **Crear tarea desde un Recordatorio (§6, nuevo):** `PersonalReminder` gana
  `convertedToTaskId`/`convertedToTaskAt` — acción opcional "Crear tarea" en
  cualquier recordatorio (completado o no), copia título/descripción/
  prioridad y referencia el adjunto por nombre (Trabajo sigue sin campo de
  adjunto). El recordatorio permanece disponible para auditoría.
- **Adjunto copiado en cada conversión, no referenciado:** `PersonalReminder`
  gana sus propios `attachmentName`/`attachmentMime`/`attachmentData` — al
  convertir una nota con adjunto, el archivo se copia al recordatorio para
  que sobreviva aunque la nota original se archive y se purgue a los 15
  días (§8).
- **Archivado con retención de 15 días (§7/§8):** nueva `purgeExpiredArchivedNotes()`
  (barrido perezoso, sin cron dedicado) elimina en duro las notas archivadas
  hace más de 15 días calendario. Desde Archivadas, el destinatario también
  puede eliminar definitivamente antes de tiempo (vía directa, sin pasar
  por el Centro de Recuperación — esa papelera sigue siendo exclusiva del
  remitente al eliminar una nota que envió).
- **Buscador único, sin cambiar de sección (§9):** se retiró la pestaña
  "Buscar" — ahora es un overlay (`GlobalSearchOverlay`) accesible desde
  cualquier pestaña del Escritorio. Extendido para localizar también el
  contenido de las respuestas de notas, no solo el mensaje original.
- **Auditoría ampliada (§10):** nuevas acciones `REPLIED` y
  `CONVERTED_TO_REMINDER`; `DELETED` distingue origen manual/automático en
  `metadata`. Nuevo endpoint `GET /api/desk-notes/[id]/history` (paralelo al
  ya existente de recordatorios) y modal de historial compartido
  (`DeskHistoryModal`) entre notas y recordatorios.

**Archivos afectados:** `prisma/schema.prisma` (+`DeskNoteReply`,
+adjunto/`convertedToTaskId` en `PersonalReminder`,
`DeskNote.convertedToTaskId` → `convertedToReminderId`, +`REPLIED`/
`CONVERTED_TO_REMINDER` en `DeskAuditAction`),
`prisma/migrations/20260723151707_desk_replies_and_reminder_task_bridge/`,
`src/lib/deskNotes.ts` (nuevo, select/serialize compartido),
`src/lib/personalReminders.ts` (nuevo, ídem para recordatorios),
`src/lib/deskNoteRetention.ts` (nuevo), `src/app/api/desk-notes/[id]/route.ts`
(+GET detalle, notificación de lectura, DELETE con dos vías),
`src/app/api/desk-notes/[id]/replies/` (nuevo),
`src/app/api/desk-notes/[id]/convert-to-reminder/` (nuevo, reemplaza a
`convert-to-task`), `src/app/api/desk-notes/[id]/history/` (nuevo),
`src/app/api/desk-reminders/[id]/convert-to-task/` (nuevo),
`src/app/api/desk-reminders/[id]/history` (sin cambios, reutilizado),
`src/app/api/desk/search/route.ts` (busca también respuestas),
`src/components/desk/NoteDetailModal.tsx`,
`NoteToReminderModal.tsx`, `ConvertReminderToTaskModal.tsx`,
`DeskHistoryModal.tsx` (nuevos, reemplazan a `ConvertToTaskModal.tsx` y
`ReminderHistoryModal.tsx`), `GlobalSearchOverlay.tsx` (reemplaza a
`SearchPanel.tsx`), `DeskNotePostIt.tsx`, `NotesPanel.tsx`,
`ReminderCard.tsx`, `RemindersPanel.tsx`, `DeskBoard.tsx`, `types.ts`.

**Impacto:** `BREAKING CHANGE` sobre la conversión directa Nota→Tarea del
sprint anterior (nunca llegó a usarse en producción — verificado antes de
migrar: 0 notas con `convertedToTaskId`). Sin cambios en Analytics, KPIs ni
el módulo Trabajo salvo la creación de tareas ya existente (§11
Consistencia). Verificado en vivo con cuentas descartables sobre la base de
datos compartida con producción (11 notas y 21 recordatorios reales
verificados intactos antes y después): lectura automática + notificación
idempotente, hilo de respuestas con bloqueo exacto al llegar a 2, pipeline
completo Nota→Recordatorio→Tarea (ambas notas y recordatorios permanecen
disponibles y marcados, nunca eliminados), archivado con bloqueo de
eliminación definitiva hasta archivar, y búsqueda unificada encontrando una
nota por el contenido de una respuesta. Un bug real se encontró y corrigió
durante esta verificación: `convertedToTaskId`/adjunto faltaban en el
`select` de listado de recordatorios (`/api/desk-reminders`), ver
`docs/AUDIT_LOG.md`.

**Autor:** Claude Code (dirigido por Anthony Jácome).

---

## v1.10.0 — 2026-07-23

**Tipo:** FEATURE / DATABASE
**Módulo:** Escritorio Digital — recordatorios (refinamiento de ciclo de vida)

**Implementado:**
- **"Completado" deja de ser un estado definitivo:** todo recordatorio
  completado ahora muestra la acción **↩ Reabrir**. Al usarla, el estado
  vuelve a `PENDIENTE` sobre la **misma fila** (mismo `id`) — nunca se crea
  un registro nuevo, nunca se pierde el historial previo.
- **Diálogo de reapertura con dos opciones:** (A) mantener la fecha/hora
  original, o (B) elegir una nueva — sin cerrar el diálogo con una tercera
  vía que cree un recordatorio duplicado.
- **Historial de completados independiente del archivo:** `PersonalReminder`
  gana `archived`/`archivedAt` (mismo patrón que `DeskNote`) — un
  recordatorio completado puede archivarse para salir del historial visible
  sin eliminarse ni perder auditoría. Nueva pestaña "Archivados" en
  Recordatorios, junto a Pendientes/Completados.
- **Eliminar sigue siendo una acción independiente del estado** — nunca
  ocurre automáticamente al completar (ya era así; se mantiene explícito
  como requisito de este refinamiento).
- **Auditoría visible:** nuevo endpoint `GET
  /api/desk-reminders/[id]/history` (lee `DeskAuditLog`, no duplica datos)
  y un modal de "Historial" en cada recordatorio con la línea de tiempo
  completa (creación, completado, reapertura, reprogramación, archivado…)
  en el mismo tono narrativo del pedido ("Recordatorio creado.",
  "Reabierto.", "Nueva fecha programada: …").
- Nueva acción de auditoría `REOPENED`; reabrir con una nueva fecha registra
  **dos** eventos (`REOPENED` + `POSTPONED`), igual que el ejemplo del
  pedido muestra como dos líneas separadas.

**Archivos afectados:** `prisma/schema.prisma` (+`archived`/`archivedAt` en
`PersonalReminder`, +`REOPENED` en `DeskAuditAction`),
`prisma/migrations/20260723125944_reminder_reopen_archive/`,
`src/app/api/desk-reminders/route.ts` (filtro `archived`, default
`false`), `src/app/api/desk-reminders/[id]/route.ts` (acciones `reopen`,
`archive`, `unarchive`), `src/app/api/desk-reminders/[id]/history/route.ts`
(nuevo), `src/components/desk/ReopenReminderModal.tsx` (nuevo),
`src/components/desk/ReminderHistoryModal.tsx` (nuevo),
`src/components/desk/ReminderCard.tsx`, `RemindersPanel.tsx`, `types.ts`.

**Impacto:** sin cambios en notificaciones, recordatorios recurrentes,
conversión de notas, Analytics ni KPIs (§7 Compatibilidad) — reabrir un
recordatorio que generó automáticamente su siguiente ocurrencia al
completarse no afecta ni elimina esa ocurrencia ya creada (documentado en
`docs/AUDIT_LOG.md`). Verificado en vivo con una cuenta descartable
(`*@verify.local`, eliminada al finalizar): ciclo completo
creado→completado→reabierto (opción A)→completado→reabierto con nueva
fecha (opción B)→completado→archivado→reabierto (des-archiva
automáticamente), con el historial de auditoría completo y en orden
mostrando las 9 transiciones sin perder ninguna.

**Autor:** Claude Code (dirigido por Anthony Jácome).

---

## v1.9.0 — 2026-07-23

**Tipo:** FEATURE / BREAKING CHANGE / DATABASE
**Módulo:** Escritorio Digital (evolución — "centro personal de trabajo")

**Implementado:**
- **Notas — nuevos atributos:** color del Post-it independiente de la
  prioridad (`DeskNoteColor`: Amarillo/Rosado/Celeste/Verde/Naranja/Lila —
  la prioridad sigue viviendo solo en la franja superior), adjunto opcional
  (mismo patrón base64 que `ImprovementIdea`, descarga bajo demanda vía
  `GET /api/desk-notes/[id]/attachment`, nunca incluido en el listado para
  no inflar el payload).
- **Alerta visual de notas nuevas:** punto rojo sobre el ícono "Escritorio
  Digital" del sidebar (`GET /api/desk-notes/unread-count`, sondeado cada
  30s) — desaparece únicamente cuando ya no quedan notas sin leer, nunca
  solo por entrar al módulo.
- **Confirmación de lectura:** el remitente ve ✓ Entregada / ✓✓ Leída (con
  fecha/hora de lectura) en la pestaña "Enviadas" — reutiliza `readAt`
  (ya existía desde el Sprint 1), sin tabla nueva.
- **Convertir nota en tarea (opcional):** botón en cada nota recibida que
  abre un formulario mínimo (título editable, Fija/Seguimiento, frecuencia,
  fechas, tiempo objetivo) y crea la tarea reutilizando `POST /api/tasks`
  tal cual. La nota original **nunca se edita ni se elimina** — solo queda
  marcada `convertedToTaskId`/`convertedAt`. La prioridad de la nota se
  traduce a la escala de Trabajo (Urgente/Importante → Alta, Recordatorio →
  Media, Información → Baja).
- **Recordatorios personales — reemplazo completo de `FollowUpReminder`:**
  nuevo modelo `PersonalReminder`, independiente de Task/Project (título,
  descripción, fecha/hora, prioridad, repetición, estado). Los 18
  `FollowUpReminder` activos en producción se migraron automáticamente sin
  pérdida de historial (ver `docs/AUDIT_LOG.md`) y la sección "Seguimiento
  planificado" se retiró por completo del panel de actividades de Trabajo.
- **Repetición** (una vez/diario/semanal/mensual): al completar un
  recordatorio repetitivo se genera automáticamente la siguiente ocurrencia
  (`advanceRepeat()`), auditada como una fila `CREATED` nueva.
- **Recordatorios vencidos:** banda roja "Recordatorio pendiente" dentro de
  Escritorio Digital; acciones Completar/Posponer (15min/30min/1h/mañana/
  fecha elegida)/Editar/Eliminar.
- **Widget del Dashboard reemplazado:** ahora muestra únicamente "Mis
  próximos recordatorios" (máx. 5, ordenados por fecha, sin completados) —
  las notas dejaron de tener preview en el Dashboard, se surfacean vía el
  punto rojo del sidebar en su lugar (ver Decisiones).
- **Calendario personal** (`CalendarPanel.tsx`): recordatorios + notas
  pendientes propias en una grilla mensual — no lee ni modifica Reuniones.
- **Búsqueda unificada** (`GET /api/desk/search`): texto, prioridad, fecha,
  remitente/destinatario (solo notas), estado — combina notas y
  recordatorios propios.
- **"Bandeja Hoy"** (mejora adoptada, no pedida explícitamente): pestaña
  por defecto al entrar al módulo con 4 bloques — notas pendientes,
  recordatorios de hoy, tareas próximas a vencer (Trabajo, solo lectura) y
  proyectos con actividad reciente (Proyectos, solo lectura, ventana fija
  de 7 días — ver Decisiones).
- **Auditoría central** (`DeskAuditLog`, un solo modelo para notas y
  recordatorios, mismo criterio que `RecoveryAuditLog`): creación, edición,
  lectura, fijado/desfijado, archivado, eliminación, conversión en tarea,
  cambio de prioridad, posposición, completado — todas con usuario y fecha.

**Archivos afectados:** `prisma/schema.prisma` (+`DeskNoteColor`,
+adjunto/`convertedToTaskId` en `DeskNote`, +`PersonalReminder`,
+`DeskAuditLog`, −`FollowUpReminder`),
`prisma/migrations/20260723054447_desk_center_evolution_additive/`,
`prisma/migrations/20260723054842_remove_followup_reminder/`,
`src/lib/deskAudit.ts` (nuevo), `src/lib/deskReminders.ts` (nuevo),
`src/lib/storage.ts` (`saveIdeaAttachment` → `saveAttachment`, ahora
compartido con notas), `src/app/api/desk-notes/**` (color/adjunto,
`[id]/attachment`, `[id]/convert-to-task`, `unread-count`),
`src/app/api/desk-reminders/**` (nuevo), `src/app/api/desk/today` y
`src/app/api/desk/search` (nuevos), `src/components/desk/**`
(`ConvertToTaskModal`, `ReminderCard`, `NewReminderModal`, `NotesPanel`,
`RemindersPanel`, `CalendarPanel`, `SearchPanel`, `TodayInbox`, `DeskBoard`
reestructurado en pestañas), `src/components/dashboard/RemindersWidget.tsx`
(reemplaza a `DeskNotesWidget.tsx`), `src/components/shell/Sidebar.tsx`
(punto rojo), `src/components/tasks/ActivityPanel.tsx` (se retira
"Seguimiento planificado"), `src/components/reminders/` (eliminado —
`ReminderNotifier.tsx`), `src/app/api/reminders/**` (eliminado).

**Impacto:** cambio de comportamiento intencional (`BREAKING CHANGE`) sobre
el sistema de recordatorios anterior — quien esperaba "Seguimiento
planificado" dentro de una tarea ahora encuentra sus recordatorios en
Escritorio Digital. Sin cambios en Analytics/KPIs/carga laboral (§Reglas).
Verificado en vivo con cuentas descartables (`*@verify.local`, eliminadas
al finalizar): nota con color+adjunto, descarga, confirmación de lectura,
conversión a tarea (bloquea doble conversión, preserva la nota), creación/
completado/generación automática de la siguiente ocurrencia/posposición de
recordatorios, Bandeja Hoy, punto rojo, búsqueda, y confirmación de que las
rutas antiguas de `/api/reminders` ya no existen (404).

**Autor:** Claude Code (dirigido por Anthony Jácome).

---

## v1.8.0 — 2026-07-23

**Tipo:** FEATURE / DATABASE
**Módulo:** Escritorio Digital (nuevo, Sprint 1)

**Implementado:**
- Nuevo módulo **Escritorio Digital**: notas rápidas informales entre
  colaboradores, equivalente digital de un Post-it dejado sobre el
  escritorio físico de alguien cuando no está disponible — deliberadamente
  NO es correo/chat (sin asunto, sin hilos, sin destinatarios múltiples) y
  no participa en Analytics/KPIs/carga laboral.
- Nuevo modelo `DeskNote` (`prisma/schema.prisma`): remitente, destinatario,
  mensaje (máx. 500 caracteres), prioridad (`DeskNotePriority`:
  Información/Recordatorio/Importante/Urgente), estados `read`/`pinned`/
  `archived` controlados únicamente por el destinatario, y `deletedAt` como
  bandera local del Centro de Recuperación.
- **Diseño tipo Post-it ejecutivo** (`DeskNotePostIt.tsx`): rotación sutil
  determinística (1°-3°, no aleatoria por render), franja superior pastel
  según prioridad (el resto de la nota permanece neutro/limpio, según el
  pedido), elevación + enderezado al pasar el mouse (framer-motion),
  acciones (✓ marcar leída, 📌 fijar, 🗃 archivar) ocultas hasta hover.
  Compatible con modo claro/oscuro vía tokens de diseño existentes
  (`--surface`/`--border`/`--shadow`), sin tablas ni listas tradicionales.
- **Widget del Dashboard** (`DeskNotesWidget.tsx`): últimas 4 notas
  recibidas activas + botón "Ver todas" hacia la página completa (no modal).
- **Página completa** `/desk` (`DeskBoard.tsx`): tablero en grilla
  responsiva con pestañas Escritorio/Fijadas/Archivo/Enviadas (esta última
  para que el remitente pueda ver el estado de lectura y eliminar sus
  propias notas).
- **Permisos:** todos los roles excepto Administrador pueden crear/recibir/
  leer/fijar/archivar notas (`canUseDeskNotes()` en `src/lib/roles.ts`), sin
  restricción de jerarquía entre colaboradores no-Administrador (a
  diferencia de `VISIBLE_ROLES`, que sí es jerárquico). El destinatario
  controla el estado de su copia; solo el remitente puede eliminarla.
- **Eliminación vía Centro de Recuperación:** `DELETE
  /api/desk-notes/[id]` llama a `recoveryCenter.moveToTrash()` (adaptador
  `DESK_NOTE` nuevo en `ENTITY_REGISTRY`) en vez de un borrado directo —
  Escritorio Digital es el segundo módulo integrado, después de Proyectos.
- Notificación in-app (no de desempeño) al destinatario cuando recibe una
  nota nueva, reutilizando el modelo `Notification` existente.

**Archivos afectados:** `prisma/schema.prisma`,
`prisma/migrations/20260723045035_add_desk_notes/`, `src/lib/roles.ts`
(`canUseDeskNotes`), `src/lib/recoveryCenter.ts` (adaptador `DESK_NOTE`),
`src/lib/navLinks.ts`, `src/app/api/desk-notes/**` (route.ts, `[id]`,
`recipients`), `src/app/(protected)/desk/page.tsx`,
`src/components/desk/**` (types.ts, DeskNotePostIt.tsx, NewNoteModal.tsx,
DeskBoard.tsx), `src/components/dashboard/DeskNotesWidget.tsx`,
`src/components/dashboard/DashboardModule.tsx` (card `escritorio`),
`src/app/(protected)/dashboard/page.tsx`.

**Impacto:** módulo nuevo, sin cambios de comportamiento en Trabajo,
Proyectos ni Analytics. Verificado en vivo con cuentas descartables
(`*@verify.local`, eliminadas al finalizar la verificación): creación,
lectura/fijado/archivado por el destinatario, exclusión del Administrador
(nav, widget y página), y eliminación por el remitente vía la papelera del
Centro de Recuperación.

**Autor:** Claude Code (dirigido por Anthony Jácome).

---

## v1.7.0 — 2026-07-23

**Tipo:** UX / UI / BREAKING CHANGE / DATABASE
**Módulo:** Proyectos (Sprint 2.1 — refinamiento)

**Implementado:**
- **Historial consolidado (§1):** ya no se registra un evento genérico
  "ACTUALIZADO" por cada edición de campo, ni un evento por cada comentario
  o por cada actividad registrada individualmente — el Historial solo
  guarda eventos relevantes de negocio (creación, cambio de estado/
  responsable, alta/baja de fase o participante, documento, papelera/
  restauración). El cambio de estado de una fase sigue auditándose; los
  ajustes de progreso/notas/fechas de una fase ya NO generan una fila por
  cada edición (antes se disparaba en cada tick del slider de progreso).
- **Responsable ≠ Participante (§2):** al crear un proyecto, el responsable
  principal y el creador ya NO se agregan automáticamente como
  participantes. Se es participante únicamente por asignación explícita o
  por registrar una actividad (que ahora enrola automáticamente al autor si
  todavía no figuraba, dejando constancia en el historial).
- **Eliminación restringida al creador (§3):** mover a la papelera,
  restaurar y eliminar definitivamente ahora requieren ser el creador del
  proyecto — antes cualquier responsable o liderazgo (nivel ≥ 3) también
  podía. La retención automática de 48h no cambió. La Papelera sigue
  visible para liderazgo (supervisión) pero sin acciones si no son también
  el creador.
- **Fases en tarjetas (§4):** el listado de fases pasó de filas a una
  grilla de tarjetas independientes, cada una con nombre, estado,
  responsable, participantes (derivados de quién registró actividad ahí),
  tiempo objetivo, tiempo registrado, % de avance, fecha objetivo y una
  acción "Ver detalle" (nuevo modal con el desglose completo de la fase y
  sus actividades).
- **Fases visibles acotadas (§5):** el selector de fase al registrar una
  actividad ahora solo muestra fases donde el usuario es responsable, ya
  participó, o la fase no tiene responsable asignado (abierta) — el resto
  se oculta.
- **Registro de tiempo por rango horario (§6, BREAKING):** se eliminó el
  campo de duración manual (horas/minutos) — se registra únicamente hora
  inicio/hora fin y la duración se calcula siempre desde ese rango.
  `ProjectActivity.time` (String suelto) se reemplazó por `startTime`/
  `endTime`.
- **Descripción obligatoria (§7):** mínimo 15 caracteres, validado en
  cliente y servidor.
- **Timeline cronológico por día (§8):** las actividades ahora se agrupan
  por día calendario con encabezado, y cada registro muestra usuario, rango
  horario, duración calculada, descripción, comentarios y archivos
  adjuntos (con descarga inline).
- **Tarjeta de tiempo acumulado (§9):** reemplaza el indicador simple —
  ahora muestra horas registradas, tiempo objetivo, horas restantes, barra
  de progreso y % ejecutado.
- **Resumen como dashboard ejecutivo (§10):** la pestaña Resumen ahora
  abre con 8 tarjetas KPI (Estado, Avance, Participantes, Tiempo objetivo,
  Tiempo registrado, Fases, Última actividad, Próximo vencimiento) antes
  del detalle/observaciones existentes. "Avance" es el promedio de
  progreso de fases (o % de tiempo ejecutado si no hay fases) — cálculo
  puramente derivado en el cliente, sin leer ni modificar el Analytics
  Engine (preparado para la integración del Sprint 3, sin adelantarla).

**Archivos afectados:** `prisma/schema.prisma`,
`prisma/migrations/20260723041452_project_activity_start_end_time/`,
`src/lib/projectAccess.ts` (`isProjectCreator`),
`src/lib/projectPhaseStats.ts` (nuevo),
`src/app/api/projects/**` (route.ts, activities, comments, phases,
phases/[phaseId], restore, permanent, trash),
`src/components/projects/ProjectSummaryTab.tsx`,
`ProjectPhasesTab.tsx`, `PhaseDetailModal.tsx` (nuevo),
`ProjectActivitiesTab.tsx`, `ProjectDetailView.tsx`, `ProjectTrashPanel.tsx`,
`types.ts`.

**Impacto:** Cambio de comportamiento intencional en 3 frentes (historial,
membresía de participantes, permisos de eliminación) pedido explícitamente
por el sprint — no afecta Task/TaskActivity ni el Analytics Engine.
Verificado de punta a punta contra la base de datos compartida con
usuarios `@verify.local` desechables: participantes vacíos al crear,
auto-alta al registrar actividad, bloqueo de papelera/restaurar/eliminar
para quien no es el creador (incluido un responsable con permisos previos),
validación de descripción/hora inicio-fin, y ausencia de eventos de
historial para comentarios, actividades individuales y ediciones de
progreso repetidas. Datos de prueba eliminados al finalizar. Solo existía
un proyecto real en producción al momento del cambio (creado hoy mismo,
sin actividades registradas) — riesgo de migración nulo.

**Autor:** Claude Code
**Estado:** Implementado

---

## v1.6.0 — 2026-07-23

**Tipo:** FEATURE / DATABASE / SECURITY
**Módulo:** Centro de Recuperación (arquitectura corporativa, interno) / Proyectos

**Implementado:**
- Servicio corporativo centralizado `src/lib/recoveryCenter.ts` (**Centro de
  Recuperación**, nombre puramente arquitectónico — el usuario solo ve
  "Papelera" en cada módulo) que administra el ciclo de vida de CUALQUIER
  entidad eliminada temporalmente en NEXO: `moveToTrash`, `restore`,
  `deletePermanently`, `purgeExpiredItems`, `getRemainingRetentionTime`,
  `registerAuditEvent`.
- Diseño abierto/cerrado: agregar un módulo nuevo (Trabajo, Escritorio
  Digital, Documentos, Repositorios, Plantillas, Comunicados) requiere
  únicamente una entrada de datos en `ENTITY_REGISTRY` — cero cambios de
  lógica en el servicio central y cero migraciones de schema (`entityType`
  es un `String` libre, no un enum de Prisma).
- Modelos Prisma nuevos: `RecoveryItem` (estado/retención de cada elemento
  en papelera) y `RecoveryAuditLog` (auditoría central única de TODA
  operación, para cualquier módulo — nunca una tabla de auditoría por
  módulo), más los enums `RecoveryStatus`, `RecoveryOperation`,
  `RecoveryOrigin`.
- **Proyectos** es el primer (y único, por ahora) módulo integrado:
  `Project.deletedAt` (bandera local mantenida por el adaptador del
  registro, para filtrar sin join), nuevas rutas
  `DELETE /api/projects/[id]` (mover a la papelera),
  `POST /api/projects/[id]/restore`, `DELETE /api/projects/[id]/permanent`
  (irreversible) y `GET /api/projects/trash` (listado con cuenta regresiva
  de retención, visibilidad acotada a responsable/creador/liderazgo).
  Eventos `ELIMINADO`/`RESTAURADO` agregados al historial propio del
  proyecto (`ProjectHistory`), sin duplicar la auditoría central.
- Período de retención (48 horas por defecto) configurable vía el mismo
  mecanismo genérico de `SystemConfigHistory` que ya usan
  horas efectivas/límites de carga/política de retención LOPDP — sin
  valores hardcodeados en la lógica de negocio (`CONFIG_KEY_RECOVERY_RETENTION_HOURS`
  en `src/lib/systemConfig.ts`).
- Purga automática de elementos expirados implementada como barrido
  perezoso e idempotente disparado al abrir la Papelera (mismo criterio que
  la migración perezosa de historial de tareas Fijas, ver
  `docs/AUDIT_LOG.md` § 2026-07-21) — no se implementó un cron dedicado
  este sprint.
- Interfaz de "Papelera" para Proyectos: panel deslizante con lista,
  cuenta regresiva de vencimiento, restaurar y "eliminar definitivamente";
  botón "Mover a la papelera" en el resumen del proyecto (Zona de peligro).
- **No implementado a propósito, según el pedido:** consola administrativa
  unificada que liste elementos eliminados de todos los módulos a la vez —
  la arquitectura queda preparada (`RecoveryItem`/`RecoveryAuditLog` ya
  son transversales a cualquier `entityType`), pero la pantalla en sí queda
  para un sprint futuro.

**Archivos afectados:** `prisma/schema.prisma`,
`prisma/migrations/20260723033102_add_recovery_center/`,
`src/lib/recoveryCenter.ts`, `src/lib/systemConfig.ts`,
`src/app/api/projects/[id]/route.ts` (DELETE),
`src/app/api/projects/[id]/restore/route.ts`,
`src/app/api/projects/[id]/permanent/route.ts`,
`src/app/api/projects/trash/route.ts`, `src/app/api/projects/route.ts`
(filtro `deletedAt`), `src/app/(protected)/projects/page.tsx`,
`src/components/projects/ProjectTrashPanel.tsx`,
`src/components/projects/ProjectSummaryTab.tsx`,
`src/components/projects/ProjectsModule.tsx`.

**Impacto:** Nuevo mecanismo de plataforma, sin cambios en el
comportamiento de ningún módulo existente salvo Proyectos (que gana
capacidad de eliminación/restauración que antes no existía en absoluto).
Verificado de punta a punta contra la base de datos compartida con
usuarios `@verify.local` desechables: mover a papelera, listar papelera,
bloqueo de acceso para quien no es responsable/creador/liderazgo,
restaurar, eliminar definitivamente (con cascada real sobre fases/
participantes/actividades/comentarios/documentos/historial del proyecto),
y purga automática de un elemento con retención vencida — auditoría
central (`RecoveryAuditLog`) e historial propio del proyecto verificados
en cada paso. Datos de prueba eliminados al finalizar.

**Autor:** Claude Code
**Estado:** Implementado

---

## v1.5.0 — 2026-07-23

**Tipo:** FEATURE / DATABASE
**Módulo:** Proyectos (nuevo)

**Implementado:**
- Nuevo módulo "Proyectos", dominio completamente independiente del módulo
  Trabajo (Task/TaskActivity) — iniciativas transversales de mediana/larga
  duración con fases, participantes propios y ciclo de vida que no se cierra
  por cambio de mes.
- Modelos Prisma nuevos: `Project`, `ProjectParticipant`, `ProjectPhase`,
  `ProjectActivity`, `ProjectComment`, `ProjectDocument`, `ProjectHistory`
  (enums `ProjectStatus`, `ProjectDocumentCategory`, `ProjectHistoryEvent`) —
  reutiliza `TaskStatus`/`TaskPriority` para fases/prioridad en vez de
  duplicar enums.
- Ciclo de vida: Pendiente → Planificación → En ejecución → En revisión →
  Suspendido → Completado/Cancelado, editable solo por el responsable
  principal, el creador o liderazgo (nivel ≥ 3) — ver
  `src/lib/projectAccess.ts`.
- Fases con responsable, progreso, tiempo objetivo y estado propios.
- Registro de actividades por participante (descripción, fecha, hora,
  tiempo invertido, comentarios) con la misma ventana de registro
  retroactivo de 2 días hábiles que Seguimiento — reutiliza
  `src/lib/businessTime.ts` sin modificarlo.
- Comentarios y repositorio de documentos (PDF/Excel/Word/Imagen/Correo/
  Acta, versionado simple) propios del proyecto, sin tocar los del módulo
  Trabajo.
- Bitácora de auditoría (`ProjectHistory`) para todo evento relevante:
  creación, cambio de estado/responsable, alta/baja de participante, fase,
  comentario, actividad, documento.
- `Project.realHours`/`targetTimeHours` preparados con la misma convención
  que `Task` para una futura integración con el Analytics Engine — **no se
  modificó ninguna fórmula ni cálculo existente** (§13 del pedido).
- Nueva entrada "Proyectos" en el menú lateral (`src/lib/navLinks.ts`).

**Archivos afectados:** `prisma/schema.prisma`,
`prisma/migrations/20260723024646_add_projects_module/`,
`src/lib/projectAccess.ts`, `src/lib/projectHistory.ts`, `src/lib/roles.ts`
(`canCreateProject`), `src/lib/mask-email.ts` (`maskEmailUnless`),
`src/lib/navLinks.ts`, `src/app/api/projects/**`,
`src/app/(protected)/projects/**`, `src/components/projects/**`.

**Impacto:** Nuevo dominio funcional, sin cambios en APIs, esquema o
comportamiento del módulo Trabajo ni del motor de Analytics. Verificado de
punta a punta (crear proyecto, fases, participantes, comentarios, actividad
normal y retroactiva, documentos, historial, límites de permisos) contra la
base de datos compartida con usuarios `@verify.local` desechables,
eliminados al finalizar la prueba.

**Autor:** Claude Code
**Estado:** Implementado

---

## v1.4.0 — 2026-07-22

**Tipo:** DOCUMENTATION
**Módulo:** Documentación / Administración

**Implementado:**
- Estructura oficial `/docs` (README, CHANGELOG, AUDIT_LOG, ROADMAP,
  ARCHITECTURE, DECISIONS, ANALYTICS_FORMULAS, VERSION).
- Reconstrucción retroactiva del historial completo de Nexo desde Git.
- Panel de solo lectura "Documentación" dentro de Administración, que lee
  los `.md` directamente (sin base de datos nueva).
- Mecanismo de actualización de documentación como parte del flujo de
  trabajo habitual de Claude Code (ver `CLAUDE.md`).

**Archivos afectados:** `docs/*.md` (nuevos), `package.json` (versión),
`src/app/(protected)/settings/*`, componente de visor de documentación,
`CLAUDE.md`.

**Impacto:** Trazabilidad completa del proyecto para auditorías internas y
continuidad del desarrollo. No modifica ninguna funcionalidad de negocio,
API, Prisma ni Analytics.

**Autor:** Claude Code
**Estado:** Implementado

---

## v1.3.0 — 2026-07-21

**Tipo:** FEATURE / REFACTOR
**Módulo:** Trabajo (Tareas)

**Implementado:**
- Las tareas Fijas ahora usan el mismo componente de registro
  (`ActivityPanel`/`TaskActivity`) que Seguimiento, en vez de un campo
  `realHours` editado a mano sin historial.
- Máximo 2 registros por tarea Fija (uno para el valor original/migrado,
  uno para correcciones), reforzado en servidor y en UI.
- Migración perezosa e idempotente del historial existente (sin script
  masivo contra la base de datos): la primera vez que se abre el panel de
  actividades de una tarea Fija con horas reales y cero actividades, se
  genera automáticamente un registro "Registro migrado automáticamente".
- Corrección del último texto residual que aún decía "estimación" en vez de
  "Tiempo Objetivo" (`insightsEngine.ts`).

**Archivos afectados:** `src/app/api/tasks/[id]/activities/route.ts`,
`src/components/tasks/{ActivityPanel,TableView,TaskCard}.tsx`,
`src/components/team/TeamModule.tsx`, `src/lib/insightsEngine.ts`.

**Impacto:** Analytics consume un único modelo de datos para ambos tipos de
tarea; las tareas Fijas ganan auditoría/historial que nunca tuvieron. Sin
cambios en Prisma Schema, APIs públicas, Operational Risk Score ni
Performance Score (decisión explícita de alcance).

**Autor:** Claude Code
**Estado:** Implementado

---

## v1.2.0 — 2026-07-21

**Tipo:** ANALYTICS / REFACTOR / FEATURE
**Módulo:** Analytics / Trabajo / Dashboard

**Implementado:**
- Evolución de "Horas estimadas" a "Tiempo Objetivo" en todo el sistema:
  el valor inicial (`Task.estimatedHours`) coexiste con un valor validado
  opcional (`Task.targetTimeValidated`), con auditoría propia
  (`TargetTimeAuditLog`) y regularización asistida (`/tiempo-objetivo`).
- Registro de auditoría del Analytics Engine
  (`docs/ANALYTICS_CALCULATION_REGISTRY.md`): inventario completo de
  cálculos, 10 duplicaciones detectadas y 8 resueltas (consolidación de
  "Cumplimiento", clasificación de Performance Score, aritmética de
  ponderación, días hábiles con feriados, heurísticas de confianza/madurez).
- Invalidación granular del caché de Analytics por usuario (antes era
  global).
- **Sprint 0A — modelo de Analytics diferenciado para roles de dirección:**
  Administrador y Jefe Nacional dejan de evaluarse como ejecutores de
  tareas — sin KPIs personales de ejecución, sin aparecer como destino de
  redistribución de carga, Dashboard Home y mensaje diario de Nova sin
  carga laboral individual, pestaña "Mi actividad" inexistente para esos
  roles (no solo oculta su contenido).

**Archivos afectados:** `src/lib/{analytics,roles,targetTime,riskAlerts,
analyticsExplain}.ts`, `src/components/kpis/*`, `src/components/dashboard/
DashboardModule.tsx`, `src/app/api/{kpis,analytics,dashboard,reports}/**`,
`docs/ANALYTICS_CALCULATION_REGISTRY.md` (nuevo).

**Impacto:** Terminología de negocio consistente ("Tiempo Objetivo" en vez
de estimación subjetiva); motor de Analytics con menos duplicación y caché
más preciso; los indicadores de dirección dejan de distorsionar promedios y
recomendaciones del equipo.

**Autor:** Claude Code
**Estado:** Implementado

---

## v1.1.0 — 2026-07-20

**Tipo:** ANALYTICS / FEATURE
**Módulo:** Analytics

**Implementado:**
- **Sprint 5:** Performance Score separado del Índice de Riesgo Operativo
  (antes mezclados en un solo "Score"); NormalizationEngine (curvas
  configurables por indicador); motor v1.3.
- **Sprint 6 — Decision Intelligence Engine:** motor de insights de
  4 bloques (hallazgo/explicación/evidencia/impacto), relaciones entre
  indicadores, benchmarks personales, reevaluación de recomendaciones
  anteriores, priorización — todo determinista, Groq/IA nunca calcula.
- **Sprint 7 — Motor de Benchmarks Inteligente v1.5:** 3 niveles de
  comparación (cargo / cargo-limitado / personal) para no mostrar "sin
  compañeros del mismo rol" cuando un cargo es único en la organización.
- **Sprint 6.5:** explicabilidad, transparencia y confianza — modal
  "Ver cálculo" con desglose completo, estrellas de madurez del dato.

**Archivos afectados:** `src/lib/{analytics,insightsEngine,
capacityForecast}.ts`, `src/components/kpis/{SmartBenchmark,
InsightsPanel,AdvancedAnalytics}.tsx`, `prisma/schema.prisma`
(`AnalyticsAuditLog`).

**Impacto:** Analytics pasa de "tarjetas con números" a un sistema de apoyo
a la decisión que explica el por qué, no solo el qué — con respaldo
matemático auditable, sin depender de IA para ningún cálculo de negocio.

**Autor:** Claude Code
**Estado:** Implementado

---

## v1.0.0 — 2026-07-19/20

**Tipo:** ANALYTICS / BREAKING CHANGE
**Módulo:** Analytics

**Implementado:**
- **Analytics Engine v1** (`src/lib/analytics.ts`, `ANALYTICS_ENGINE_VERSION`
  desde entonces): Score de Salud, Índice de Riesgo Operativo, alertas,
  tendencias, consistencia, anomalías, predicción, calidad de datos —
  centralizados en un único motor con auditoría (`AnalyticsAuditLog`) y
  configuración versionada (21 claves en Ajustes).
- People Analytics v2: balance de carga del equipo, capacidad disponible,
  cumplimiento por prioridad.
- Capacidad proyectada hacia adelante con simulador de asignación
  (`capacityForecast.ts`).
- Dashboard ejecutivo ampliado (antes solo Jefe Nacional; ahora también
  Administrador y Coordinador Nacional), Nova Insights con IA (Groq),
  panel de alertas de riesgo real.

**Impacto:** Salto de arquitectura — Analytics deja de ser un conjunto de
KPIs sueltos calculados ad hoc por ruta y pasa a ser una plataforma con
motor propio, versionado y auditoría, por eso se marca como versión mayor
(v1.0.0) en este historial reconstruido.

**Autor:** Claude Code
**Estado:** Implementado

---

## v0.19.0 — 2026-07-18

**Tipo:** ANALYTICS / FEATURE
**Módulo:** Analytics / Ajustes

**Implementado:** Dashboard ejecutivo ampliado a Administrador/Coordinador
Nacional; Nova Insights generados con Groq (4 bullets deterministas +
recomendación de IA, tiered por nivel de rol); panel de alertas de riesgo
real (`riskAlerts.ts`); desglose de tareas por estado en vez de conteo
plano; filtrado de meses sin datos en tendencias.

**Autor:** Claude Code · **Estado:** Implementado

---

## v0.18.0 — 2026-07-17

**Tipo:** FEATURE
**Módulo:** Ajustes / Trabajo

**Implementado:** Notificaciones configurables, motivos de actividad
dinámicos (antes enum fijo), feriados administrables, permisos por rango,
mensaje de bienvenida configurable, acordeones colapsables en Ajustes,
estado especial de maternidad/lactancia con límites de carga laboral
configurables por registro.

**Autor:** Claude Code · **Estado:** Implementado

---

## v0.17.0 — 2026-07-15/16

**Tipo:** FEATURE
**Módulo:** Trabajo

**Implementado:** Preferencia de formato de registro de actividad
(duración vs. hora inicio/fin), registro retroactivo de horas, edición de
horas por Administrador con comentario obligatorio, comentarios
bidireccionales por actividad, validador de solapamiento horario,
limpieza de `LoginAttempt` expirados.

**Autor:** Claude Code · **Estado:** Implementado

---

## v0.16.0 — 2026-07-14/15

**Tipo:** SECURITY / DATABASE
**Módulo:** Cumplimiento (LOPDP) / Infraestructura

**Implementado:** Solicitudes de titulares de datos (acceso/rectificación/
eliminación), política de retención de datos, rate limiting persistente
contra fuerza bruta de login, logs sanitizados. **Framework de pruebas
automatizadas con Vitest** — desde cero hasta ~271 tests cubriendo la
mayoría de `src/lib/` y las rutas de API principales (auth, usuarios,
tareas, actividades, comentarios, ideas, KPIs, reuniones, ajustes,
dashboard, informes, repositorio).

**Autor:** Claude Code · **Estado:** Implementado

---

## v0.15.0 — 2026-07-13/14

**Tipo:** FIX / FEATURE
**Módulo:** Trabajo / Analytics

**Implementado:** Fecha de generación de informes corregida, PDF sin
autoprint, Analytics responsive en mobile; tarjetas Kanban en grid de 2
columnas; nuevo formulario de actividad por horas/minutos para tareas
SEGUIMIENTO.

**Autor:** Claude Code · **Estado:** Implementado

---

## v0.14.0 — 2026-07-11/12

**Tipo:** ANALYTICS / FIX
**Módulo:** Analytics (Carga laboral)

**Implementado:** Sistema de carga laboral de 5 zonas (Subutilización /
Moderado / Óptimo / Carga elevada / Sobrecarga) con 4 límites
independientes configurables, gráficos de barras y línea, corrección de
superposición de etiquetas en mobile, techo de 100% en el rango óptimo,
semáforo desactivado para el KPI diario en fin de semana.

**Autor:** Claude Code · **Estado:** Implementado

---

## v0.13.0 — 2026-07-10/11

**Tipo:** SECURITY / DOCUMENTATION
**Módulo:** Seguridad / Infraestructura

**Implementado:** Control de acceso reforzado en API, consentimiento
vinculante, subida a la base de conocimiento RAG restringida a
Administrador; README reescrito con changelog automático (nace el hook
`post-commit` + `update-changelog.js`, con guarda de idempotencia contra
el amend); formato HH.MM para horas en toda la aplicación.

**Autor:** Claude Code · **Estado:** Implementado

---

## v0.12.0 — 2026-07-08/09

**Tipo:** FEATURE / FIX
**Módulo:** Nova (Asistente IA) / Infraestructura

**Implementado:** Configuración de carga laboral con historial; base de
conocimiento de Nova migrada de Google Drive a un repositorio GitHub
dedicado. Serie de fixes de despliegue en Vercel: `pdfjs-dist` y
`onnxruntime-node` fallaban silenciosamente en producción (Linux) aunque
funcionaban en desarrollo (Windows) — resuelto incluyendo los binarios
nativos en el bundle serverless (`outputFileTracingIncludes`) y
procesando embeddings en lotes concurrentes.

**Autor:** Claude Code · **Estado:** Implementado

---

## v0.11.0 — 2026-07-06/07

**Tipo:** FEATURE / REFACTOR
**Módulo:** Usuarios / Ajustes

**Implementado:** Rol Administrador (aislado del resto de la jerarquía);
rol Asistente de Nómina; resolución de **todos** los errores/warnings de
ESLint sin cambiar comportamiento; módulo de Ajustes; manuales de usuario
exportables en PDF; 5 mejoras operativas en cierre mensual, repositorio,
usuarios, reuniones y seguimiento.

**Autor:** Claude Code · **Estado:** Implementado

---

## v0.10.0 — 2026-07-05/06

**Tipo:** ANALYTICS / FIX
**Módulo:** Analytics (Carga laboral)

**Implementado:** Carga laboral con base dinámica de días hábiles (en vez
de un valor fijo), cálculo de "hoy" usando el huso horario de negocio
(no el del servidor), carga laboral dinámica reflejada en informes y
recordatorios de seguimiento.

**Autor:** Claude Code · **Estado:** Implementado

---

## v0.9.0 — 2026-07-04/05

**Tipo:** SECURITY
**Módulo:** Cumplimiento (LOPDP)

**Implementado:** Enmascarado de correos electrónicos, consentimiento de
datos personales (LOPDP) y ajustes de privacidad — primera entrega formal
de cumplimiento normativo.

**Autor:** Claude Code · **Estado:** Implementado

---

## v0.8.0 — 2026-07-03/05

**Tipo:** UI / UX
**Módulo:** Sistema de diseño

**Implementado:** Sistema de diseño completo con modo claro/oscuro (v1);
días después, rediseño visual premium con sidebar, tokens de diseño y
nueva iconografía (v2); formato de fechas `YYYY-MM-DD` centralizado en
toda la aplicación; avance en Seguimiento con buscador y cierre mensual.

**Autor:** Claude Code · **Estado:** Implementado

---

## v0.7.0 — 2026-07-02

**Tipo:** FEATURE / SECURITY
**Módulo:** Mejora Continua / Seguridad

**Implementado:** Módulo de ideas de mejora continua; primera auditoría de
seguridad del proyecto; selección múltiple y acciones masivas en la vista
Tabla de tareas.

**Autor:** Claude Code · **Estado:** Implementado

---

## v0.6.0 — 2026-07-01

**Tipo:** FEATURE
**Módulo:** Dashboard / Reuniones

**Implementado:** Nuevo inicio (Dashboard) con tarjetas drag-and-drop y
resumen de Analytics; módulo de Reuniones con integración real de Zoom y
notas automáticas de Otter.ai; Nova ("Asistente" renombrado) accesible
para todos los niveles de rol en su modo RRHH.

**Autor:** Claude Code · **Estado:** Implementado

---

## v0.5.0 — 2026-06-30

**Tipo:** FEATURE
**Módulo:** Nova (Asistente IA)

**Implementado:** Asistente de IA con 3 modos, base de conocimiento RAG y
citación de fuentes; ajustado para no señalar individuos en modo RRHH y
mantener una perspectiva de consultor integral de gestión de personal.

**Autor:** Claude Code · **Estado:** Implementado

---

## v0.4.0 — 2026-06-29/30

**Tipo:** FEATURE
**Módulo:** Analytics / KPIs

**Implementado:** Informes mensuales consolidados con análisis de IA
(Groq); informe de rango con gráfico de evolución y tendencias; "Mis
KPIs" — dashboard personal accesible a todos los roles, con descargas
individuales por mes e informe de rango personal.

**Autor:** Claude Code · **Estado:** Implementado

---

## v0.3.0 — 2026-06-29

**Tipo:** FEATURE
**Módulo:** Analytics / KPIs

**Implementado:** Módulo de KPIs con visualizaciones dinámicas y
visibilidad basada en rol — primera entrega de Analytics como concepto
propio dentro de Nexo (antes de esto, no existía ningún tablero de
indicadores).

**Autor:** Claude Code · **Estado:** Implementado

---

## v0.2.0 — 2026-06-28/29

**Tipo:** FEATURE
**Módulo:** Trabajo / Usuarios / Equipo

**Implementado:** Módulo completo de gestión de tareas (Kanban, Tabla,
Gantt); clasificación de tareas FIJA/SEGUIMIENTO con registro de
actividades (el origen del modelo unificado en v1.3.0); comentarios con
avatares/roles y notificaciones jerárquicas; página de perfil editable;
módulo Equipo con vista de subordinados y asignación de tareas; edición
de usuarios con validación jerárquica en `/admin/users`.

**Autor:** Claude Code · **Estado:** Implementado

---

## v0.1.0 — 2026-06-28

**Tipo:** FEATURE / BREAKING CHANGE
**Módulo:** Núcleo del sistema

**Implementado:** Proyecto renombrado a Nexo; sistema de autenticación
completo (JWT, cookies httpOnly, bcrypt) — punto de partida de todo el
historial documentado en este archivo.

**Autor:** Claude Code · **Estado:** Implementado

---

_Commits totales al 2026-07-22: 155+. Ver `git log --oneline` para el
detalle línea por línea de cualquier período no cubierto explícitamente
arriba. Este documento se actualiza hacia adelante con cada implementación
relevante — ver `CLAUDE.md` § Documentación para el procedimiento._
