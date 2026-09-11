# Despliegue en IIS (Windows) con SQL Server

> Guía operativa para instalar NEXO en un servidor Windows con IIS,
> conectado a una base de datos SQL Server de producción **vacía**. No es
> documentación de arquitectura (eso vive en `ARCHITECTURE.md`) — es la
> receta paso a paso para dejar el sistema corriendo. Decisión registrada
> en `AUDIT_LOG.md` § 2026-09-02 ("Despliegue en IIS nativo de Windows").

## Arquitectura del despliegue

IIS actúa **solo como reverse proxy** — nunca aloja Node.js ni Python
directamente (los módulos `iisnode`/`wfastcgi` están poco mantenidos y no
soportan bien las features modernas de Next.js 16). Dos procesos corren
por fuera de IIS, cada uno como Windows Service:

```
Internet/LAN → IIS (puerto 80/443, TLS) ──ARR + URL Rewrite──▶ Next.js (127.0.0.1:3000)
                                                                     │
                                                                     │ server-side, nunca desde el navegador
                                                                     ▼
                                                              Django (127.0.0.1:8000)
                                                                     │
                                                                     ▼
                                                              SQL Server (producción)
```

Django **no se expone vía IIS** — solo escucha en `127.0.0.1`, inalcanzable
desde fuera del servidor. Next.js le habla exclusivamente server-side
(`djangoApiFetch`, ver `.claude/rules/architecture.md`); toda la UI de
administración (Usuarios, Roles y Permisos, Ajustes) ya vive en el
frontend, así que no hace falta el admin de Django públicamente. Si en el
futuro hace falta acceso directo (soporte, debugging), se agrega una regla
de IIS aparte — no está en el alcance de este despliegue.

## El servidor de destino (verificado el 2026-09-08)

| | |
|---|---|
| Servidor de aplicaciones | **10.0.2.33** — Windows con **IIS 10.0** ya instalado y sirviendo |
| Base de datos | **10.0.2.51:1433**, SQL Server 2022 (`UIO-BD02`), base `ia_gestion_tareas` ya instalada y completa |
| Acceso de los usuarios | `http://10.0.2.33` — **sin TLS** (ver § 5b) |

Tres hechos comprobados sobre 10.0.2.33 que condicionan el paso 5:

1. **El puerto 80 ya está ocupado por el "Default Web Site"** de IIS (responde
   la página "IIS Windows Server"). Para que Nexo atienda en
   `http://10.0.2.33` hay que detener o quitar ese sitio, o darle a Nexo otro
   puerto. Como el acceso es por IP y no hay nombre DNS, un host header no es
   opción.
2. **El puerto 443 acepta conexiones pero no completa el handshake TLS**, así
   que hoy no hay HTTPS usable en esa máquina. Si en algún momento se instala
   un certificado válido, conviene pasar a https y quitar `REQUIRE_HTTPS=false`
   de los dos `.env`.
3. Los puertos 3000 y 8000 están cerrados desde fuera, que es lo correcto:
   Next.js y Django deben escuchar solo en `127.0.0.1`.

Queda por confirmar **desde el propio servidor** (no se puede desde otra
máquina): que 10.0.2.33 alcance `10.0.2.51:1433`, y que ARR + URL Rewrite
estén instalados (prerrequisito 2).

```powershell
# Ejecutar EN 10.0.2.33
Test-NetConnection 10.0.2.51 -Port 1433
Get-WebGlobalModule | Where-Object { $_.Name -match 'Rewrite|ApplicationRequestRouting' }
```

## Prerrequisitos (instalación manual, una sola vez)

Estos pasos requieren PowerShell **"Ejecutar como administrador"** y no
los puede hacer un agente sin esos privilegios — hacelos vos en el
servidor de destino.

1. **Rol IIS** (Panel de control → Programas → Activar o desactivar
   características de Windows → Internet Information Services), o por
   PowerShell elevado:
   ```powershell
   Enable-WindowsOptionalFeature -Online -FeatureName IIS-WebServerRole, IIS-WebServer, `
     IIS-CommonHttpFeatures, IIS-HttpRedirect, IIS-ApplicationDevelopment, `
     IIS-HealthAndDiagnostics, IIS-HttpLogging, IIS-Security, IIS-RequestFiltering, `
     IIS-Performance, IIS-WebServerManagementTools, IIS-ManagementConsole
   ```
2. **URL Rewrite Module** y **Application Request Routing (ARR)** — no son
   features de Windows, son instaladores aparte de Microsoft/IIS.net.
   Descargalos vos mismo desde las páginas oficiales:
   - `https://www.iis.net/downloads/microsoft/url-rewrite`
   - `https://www.iis.net/downloads/microsoft/application-request-routing`

   Después de instalar ARR, abrí IIS Manager → nodo del servidor →
   "Application Request Routing Cache" → "Server Proxy Settings..." →
   tildá **"Enable proxy"** (sin esto, IIS acepta la regla de rewrite pero
   nunca reenvía la petición al puerto 3000).
3. **Python 3.12** (ya instalado en esta máquina — confirmar en el
   servidor real con `python --version`) y **Node.js 20+** (ya instalado
   acá también — confirmar `node --version`/`npm --version`).
4. **Driver ODBC para SQL Server** — confirmar cuál hay instalado con
   `Get-OdbcDriver` en PowerShell; ajustar `DB_DRIVER` en `backend/.env`
   al nombre exacto (esta máquina tiene "ODBC Driver 17 for SQL Server").
5. **NSSM** (Non-Sucking Service Manager) — envuelve `python`/`npm` como
   servicios de Windows de verdad (con reinicio automático si el proceso
   muere). Descargalo de `https://nssm.cc/download`, extraé
   `win64\nssm.exe` a una carpeta del `PATH` (ej. `C:\Windows\System32`)
   o pasá su ruta explícita al script de registro (paso 4 más abajo).

## 1. Copiar el código al servidor

Cloná o copiá el repositorio completo a una carpeta del servidor, ej.
`C:\nexo`. El resto de esta guía asume esa ruta — ajustala si usás otra.

## 2. Backend (Django)

```powershell
cd C:\nexo\backend
python -m venv .venv
.venv\Scripts\pip install -r requirements\prod-windows.txt
copy .env.production.example .env
notepad .env   # completar SECRET_KEY, JWT_SECRET_KEY, DB_*, ALLOWED_HOSTS, etc.
```

Generar las claves (no reutilizar las de desarrollo):

```powershell
python -c "import secrets; print(secrets.token_urlsafe(50))"   # SECRET_KEY
python -c "import secrets; print(secrets.token_urlsafe(50))"   # JWT_SECRET_KEY (una clave DISTINTA)
```

Aplicar el esquema a la base vacía y verificar que arranca:

```powershell
$env:DJANGO_SETTINGS_MODULE = "config.settings.production"
python manage.py migrate --noinput
python manage.py collectstatic --noinput
```

`migrate` siembra automáticamente la jerarquía de roles y el catálogo de
permisos (migraciones de datos `apps.hierarchy.0002_seed_nexo_roles` y
`apps.permissions.0004_seed_all_permissions_to_administrador`) — el grupo
`ADMINISTRADOR` ya existe después de este paso, antes de crear ningún
usuario.

`migrate` asume que la base ya existe (vacía) y que la cuenta configurada en
`DB_*` puede crear tablas en ella. Si en el servidor de producción la base la
crea el DBA, o la cuenta de la aplicación no va a tener permisos de
`CREATE TABLE`, hay una alternativa que no necesita ninguno de los dos
comandos de arriba ni el de la sección siguiente: **un único script SQL** que
crea la base entera y la deja lista para entrar.

```bash
# En la máquina de desarrollo: generar el script
cd backend
./.venv/Scripts/python.exe manage.py sqlcreatedatabase --admin-email admin@miempresa.com
```

```bat
:: En el servidor: ejecutarlo conectado a master
sqlcmd -S <servidor> -d master -b -i nexo_create_database.sql
```

En la instancia de producción de Nexo la cuenta de la aplicación es
`db_owner` de su base pero **no tiene permiso para crear bases**, así que ahí
corresponde el flujo de dos pasos: el DBA crea la base vacía
(`crear_base_ia_gestion_tareas.sql`) y después se ejecuta
`nexo_solo_contenido_base_ya_creada.sql`. Ver `backend\scripts\sql\README.md`.

Crea la base con la collation del proyecto, las 59 tablas con todos sus
campos, la bitácora de migraciones, el catálogo de roles y permisos y el
usuario ADMINISTRADOR inicial — sin datos de negocio. Después de eso no hace
falta `migrate` ni `seed_superadmin`. El archivo generado lleva el hash de la
contraseña del administrador, así que es de un solo uso y no se versiona.
Detalle completo en `backend\scripts\sql\README.md`.

### Crear el usuario ADMINISTRADOR inicial

Único usuario que hace falta crear a mano — todos los demás se crean
después desde la UI (Usuarios → Nuevo usuario), ya logueado como este:

```powershell
python manage.py seed_superadmin --email admin@miempresa.com
# Pide la contraseña de forma interactiva y oculta (o SUPERADMIN_PASSWORD
# como variable de entorno para un script no interactivo). Fuerza a
# cambiarla en el primer login real (must_change_password).
```

Es **idempotente** — correrlo de nuevo con el mismo username/email no crea
un duplicado ni falla, solo avisa que ya existe.

## 3. Frontend (Next.js)

```powershell
cd C:\nexo
npm install
copy .env.production.example .env
notepad .env   # completar SESSION_SECRET, GEMINI_API_KEY, etc.
$env:NODE_ENV = "production"
npm run build
```

`npm run build` compila con las variables de `.env` ya presentes — como
cualquier `.env.production.example`/`.env`, revisalo antes del build si
cambiás algo (Next.js incrusta algunas variables en tiempo de build).

## 4. Registrar los dos servicios de Windows

Con NSSM ya descargado (prerrequisito 5) y en una consola **elevada**:

```powershell
cd C:\nexo\scripts\deploy
.\register-windows-services.ps1 -RepoRoot "C:\nexo"
# Si nssm.exe no está en el PATH: agregá -NssmPath "C:\ruta\a\nssm.exe"
```

Esto crea `NexoBackend` (waitress, puerto 8000, solo localhost) y
`NexoFrontend` (`next start`, puerto 3000), ambos con arranque automático
y reinicio si el proceso muere. Verificar:

```powershell
Get-Service NexoBackend, NexoFrontend
Invoke-WebRequest http://127.0.0.1:3000 -UseBasicParsing | Select-Object StatusCode
```

## 5. Configurar el sitio en IIS

1. IIS Manager → Sitios → Agregar sitio web.
   - Ruta física: `C:\nexo` (ahí vive `web.config`, ya incluido en el
     repo — no hace falta crearlo).
   - Binding HTTP en el puerto 80. Si el despliegue va a tener TLS, agregar
     además el binding HTTPS (443) con el certificado y dejar
     `REQUIRE_HTTPS` sin declarar (o en `true`) en los dos `.env`.
   - **Si se sirve por http, sin TLS** (el caso de este despliegue: red
     interna, por IP), hace falta `REQUIRE_HTTPS=false` en los dos `.env`
     — ver la sección siguiente. Sin eso, el navegador no devuelve la
     cookie de sesión (sale con `secure`) y el login parece "no
     funcionar", sin ningún error que lo explique.
2. Confirmar que "Enable proxy" quedó tildado en ARR (prerrequisito 2) —
   es la causa más común de un 502/504 en este punto.
3. Navegar a `http://<host-del-binding>/` — debería mostrar la pantalla de
   login de NEXO.

## 5b. Despliegue por http, sin TLS (red interna)

Este sistema se despliega en una red interna, accesible por la IP del
servidor de aplicaciones y **sin certificado TLS** (decisión explícita del
usuario, 2026-09-08). Por defecto la aplicación exige HTTPS en las tres
capas, así que hay que declararlo:

| Archivo | Variable |
|---|---|
| `.env` (raíz, Next.js) | `REQUIRE_HTTPS=false` |
| `backend\.env` (Django) | `REQUIRE_HTTPS=false` |

Los dos tienen que valer lo mismo. Si uno exige https y el otro no, el login
falla sin un error que lo explique.

Qué desactiva exactamente esa variable:

- `src/proxy.ts` deja de redirigir a `https://` (308);
- la cookie de sesión de Next.js sale sin `secure` (`src/lib/session.ts`);
- Django deja de forzar `SESSION_COOKIE_SECURE`/`CSRF_COOKIE_SECURE`/
  `SECURE_SSL_REDIRECT`, y no emite HSTS (`config/settings/production.py`).

Todo lo demás del endurecimiento sigue en pie: `DEBUG=False`, el CSP de
`next.config.ts`, `X-Frame-Options`, `httpOnly`+`sameSite=strict` en la
cookie, el rate limiting del login y la validación de `Origin` de las rutas
de API.

**El costo, para que quede escrito:** sin TLS, las credenciales del login y
la cookie de sesión viajan en claro por la red. Cualquiera con acceso al
tráfico del segmento puede leerlas o robar una sesión. Es aceptable solo en
una red interna controlada, y deja de serlo el día que el sistema se
publique fuera de ella. La fuente de verdad de esta política está en
`src/lib/httpsPolicy.ts`, con el mismo razonamiento escrito.

Además, `ALLOWED_HOSTS`, `FRONTEND_URL`, `CORS_ALLOWED_ORIGINS` y
`CSRF_TRUSTED_ORIGINS` van con la **IP del servidor de aplicaciones** y
esquema `http://` (ver `backend/.env.production.example`, que ya viene con
los marcadores en su lugar). `FRONTEND_URL`, `CORS_ALLOWED_ORIGINS` y
`CSRF_TRUSTED_ORIGINS` **tienen que incluir el puerto** (`:4080` en este
despliegue): un origen es host + puerto, y de `FRONTEND_URL` sale además el
enlace del correo de recuperación de contraseña (ver § 5c).

## 5c. Correo saliente (recuperación de contraseña)

Sin esto, "¿Olvidaste tu contraseña?" **no envía nada**, y el sistema no lo
avisa: crea el token, responde que envió el correo, y nadie lo recibe. El
silencio es deliberado — la respuesta del endpoint público tiene que ser
idéntica exista o no la cuenta, porque si no revelaría qué direcciones están
registradas (`apps/authentication/emails.py`). La contrapartida es que la
configuración hay que verificarla activamente; para eso están el check de
arranque y el comando de diagnóstico de más abajo.

### El servidor de correo de la empresa (verificado el 2026-09-09)

| Dato | Valor |
|---|---|
| Servidor | Zimbra (Postfix) — `mail.grupolaar.com` / `10.0.2.53` |
| Puerto 25 | **cerrado** — no hay relay sin autenticar |
| Puerto 587 | abierto, STARTTLS, `AUTH LOGIN PLAIN` tras cifrar |
| Puerto 465 | abierto, TLS implícito |
| Certificado | GlobalSign (público y válido), cubre `mail.grupolaar.com` |

Dos consecuencias prácticas:

- **Hace falta un buzón real.** Con el 25 cerrado no existe la opción de
  autorizar la IP del servidor de aplicaciones y enviar sin credenciales, así
  que hay que crear una cuenta en Zimbra para Nexo (ej.
  `nexo@grupolaar.com`) y ponerla en el `.env`.
- **Usá el nombre, no la IP**, en `EMAIL_HOST`. Django valida el certificado
  del servidor (cadena y nombre); el certificado cubre `mail.grupolaar.com`,
  así que con el nombre funciona sin configuración extra.

Zimbra solo anuncia `AUTH` **después** de STARTTLS, así que `EMAIL_USE_TLS`
no es opcional: sin cifrar, el envío falla con "SMTP AUTH extension not
supported by server".

### Configuración

En `backend\.env` (la plantilla ya trae todo menos las credenciales):

```ini
EMAIL_BACKEND=django.core.mail.backends.smtp.EmailBackend
EMAIL_HOST=mail.grupolaar.com
EMAIL_PORT=587
EMAIL_USE_TLS=true
EMAIL_USE_SSL=false
EMAIL_HOST_USER=nexo@grupolaar.com
EMAIL_HOST_PASSWORD=<la contraseña del buzón>
DEFAULT_FROM_EMAIL=nexo@grupolaar.com
EMAIL_TIMEOUT=10
```

`EMAIL_USE_TLS` y `EMAIL_USE_SSL` son mutuamente excluyentes: 587 con TLS, o
465 con SSL, nunca los dos en `true`.

### Verificación

```powershell
cd C:\nexo\backend
.\.venv\Scripts\python.exe manage.py check              # errores de configuración
.\.venv\Scripts\python.exe manage.py diagnose_email tu-cuenta@grupolaar.com
```

`manage.py check` corre solo en cada arranque del servicio (lo disparan el
`collectstatic` y el `migrate` de `serve_production_windows.py`) y avisa de
las siete formas conocidas de dejar el correo mal configurado —
`nexo.email.W001` a `W007`, definidas en `apps/core/checks.py`. Son
advertencias y no errores a propósito: no deben impedir que el sistema
arranque por una función secundaria.

`manage.py diagnose_email` es la verificación activa. Muestra la
configuración efectiva (sin revelar la contraseña), **el enlace que llevaría
el correo** — que depende de `FRONTEND_URL` y es lo que más veces queda
mal —, abre la conexión real al servidor y envía un correo de prueba con la
plantilla de producción. Si falla, dice en qué paso y qué significa el error
(credenciales, certificado, puerto cerrado, remitente rechazado, etc.) en vez
de mostrar una traza de `smtplib`. Con `--connection-only` verifica conexión
y autenticación sin enviar nada.

Al recibir el correo de prueba, revisá que **el enlace apunte al sitio real**
(`http://10.0.2.33:4080/...`). Su token es de prueba y no restablece nada.

## 6. Verificación end-to-end

1. Login con el usuario ADMINISTRADOR creado en el paso 2 (contraseña que
   configuraste) → debería pedir cambiarla (`must_change_password`).
2. Cambiar la contraseña, aceptar el aviso de Tratamiento de Datos
   Personales, confirmar que el Dashboard carga sin errores.
3. Ajustes → Seguridad → confirmar que "Ver historial" y el resto de
   secciones cargan (valida que Next.js efectivamente le habla a Django).
4. Crear un usuario de prueba desde Usuarios → confirmar que aparece con
   el rol asignado.
5. Correo: `manage.py diagnose_email tu-cuenta@grupolaar.com` (ver § 5c) →
   el correo tiene que llegar y su enlace apuntar al sitio real. Después,
   probar "¿Olvidaste tu contraseña?" desde el login con una cuenta de
   prueba y completar el restablecimiento con el enlace recibido.

## Operación

- **Logs**: `backend\logs\NexoBackend.{out,err}.log` y
  `logs\NexoFrontend.{out,err}.log` (raíz del repo), rotados
  automáticamente por NSSM a los 10MB.
- **Actualizar el despliegue con código nuevo** — `scripts\deploy\update-deployment.ps1`
  hace la secuencia completa (traer el código, dependencias, build,
  `check`, migraciones, estáticos y reinicio de los dos servicios), en el
  orden que importa: **compila antes de tocar los servicios**, así un build
  que falla deja el sistema corriendo con la versión anterior en vez de
  dejarlo caído a medio actualizar.

  ```powershell
  cd C:\nexo\scripts\deploy
  .\update-deployment.ps1 -RepoRoot "C:\nexo"

  # El código se copia a mano y no cambiaron las dependencias (más rápido):
  .\update-deployment.ps1 -RepoRoot "C:\nexo" -SkipGitPull -SkipInstall
  ```

  No toca los `.env` (viven solo en el servidor, con las credenciales
  reales) y verifica que existan antes de empezar. Si preferís hacerlo a
  mano, son los mismos pasos: `git pull`, `npm ci`, `npm run build`,
  `manage.py migrate`, `manage.py collectstatic --noinput` y
  `Restart-Service NexoFrontend, NexoBackend`.
- **Backups**: responsabilidad del servidor SQL Server (fuera de alcance
  de esta guía) — NEXO no persiste nada relevante fuera de la base de
  datos y `backend\staticfiles\` (regenerable con `collectstatic`).

## Checklist de seguridad antes de ir a producción real

- [ ] `SECRET_KEY`/`JWT_SECRET_KEY` generadas de nuevo (nunca las de
      desarrollo), y `backend\.env` fuera de control de versiones.
- [ ] **Decidido explícitamente si el sitio va por http o https.** Con
      https: certificado real en el binding 443 y `REQUIRE_HTTPS` sin
      declarar. Con http (red interna): `REQUIRE_HTTPS=false` en los dos
      `.env`, asumiendo que las credenciales y la cookie de sesión viajan en
      claro (ver § 5b). Este despliegue eligió http interno el 2026-09-08.
- [ ] `ALLOWED_HOSTS`/`CORS_ALLOWED_ORIGINS`/`CSRF_TRUSTED_ORIGINS`
      apuntando al host público real (dominio, o la IP del servidor de
      aplicaciones con esquema `http://` **y su puerto**), no a `localhost`.
- [ ] Correo configurado y **verificado con `manage.py diagnose_email`**
      (ver § 5c) — no alcanza con que `EMAIL_BACKEND` sea SMTP: si el host,
      las credenciales o el remitente están mal, el envío falla en silencio
      y "¿Olvidaste tu contraseña?" no le llega a nadie. `manage.py check`
      no debe reportar ninguna advertencia `nexo.email.*`.
- [ ] `FRONTEND_URL` con el puerto del sitio — de ahí sale el enlace del
      correo de recuperación.
- [ ] Contraseña del usuario ADMINISTRADOR inicial cambiada en el primer
      login (`must_change_password` ya lo fuerza).
- [ ] Firewall de Windows: solo 80/443 accesibles desde fuera del
      servidor — 3000/8000 deben quedar inalcanzables fuera de
      `127.0.0.1` (por defecto, un binding a `127.0.0.1` de por sí no es
      alcanzable desde otra máquina; no hace falta una regla de firewall
      adicional salvo que algo más en el servidor los exponga).
