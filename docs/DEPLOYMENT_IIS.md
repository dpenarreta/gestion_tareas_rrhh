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
   - Binding HTTP en el puerto 80 para la primera verificación; agregar el
     binding HTTPS (443) con el certificado real antes de exponerlo a
     producción real (`SESSION_COOKIE_SECURE`/`CSRF_COOKIE_SECURE` están
     forzados a `True` en `config/settings/production.py` — sin HTTPS
     real, el navegador nunca manda esas cookies de vuelta y el login
     parece "no funcionar").
2. Confirmar que "Enable proxy" quedó tildado en ARR (prerrequisito 2) —
   es la causa más común de un 502/504 en este punto.
3. Navegar a `http://<host-del-binding>/` — debería mostrar la pantalla de
   login de NEXO.

## 6. Verificación end-to-end

1. Login con el usuario ADMINISTRADOR creado en el paso 2 (contraseña que
   configuraste) → debería pedir cambiarla (`must_change_password`).
2. Cambiar la contraseña, aceptar el aviso de Tratamiento de Datos
   Personales, confirmar que el Dashboard carga sin errores.
3. Ajustes → Seguridad → confirmar que "Ver historial" y el resto de
   secciones cargan (valida que Next.js efectivamente le habla a Django).
4. Crear un usuario de prueba desde Usuarios → confirmar que aparece con
   el rol asignado.

## Operación

- **Logs**: `backend\logs\NexoBackend.{out,err}.log` y
  `logs\NexoFrontend.{out,err}.log` (raíz del repo), rotados
  automáticamente por NSSM a los 10MB.
- **Reiniciar tras un cambio de código**: `git pull` (o copiar los
  archivos nuevos), `npm run build` (frontend) y/o
  `python manage.py migrate` (si hay migraciones nuevas), después
  `Restart-Service NexoFrontend, NexoBackend`.
- **Actualizar dependencias**: `pip install -r requirements\prod-windows.txt`
  / `npm install` antes de reiniciar los servicios.
- **Backups**: responsabilidad del servidor SQL Server (fuera de alcance
  de esta guía) — NEXO no persiste nada relevante fuera de la base de
  datos y `backend\staticfiles\` (regenerable con `collectstatic`).

## Checklist de seguridad antes de ir a producción real

- [ ] `SECRET_KEY`/`JWT_SECRET_KEY` generadas de nuevo (nunca las de
      desarrollo), y `backend\.env` fuera de control de versiones.
- [ ] Certificado TLS real instalado en el binding 443 de IIS (no
      autofirmado) — `SESSION_COOKIE_SECURE`/`CSRF_COOKIE_SECURE` lo
      exigen para que el login funcione.
- [ ] `ALLOWED_HOSTS`/`CORS_ALLOWED_ORIGINS`/`CSRF_TRUSTED_ORIGINS`
      apuntando al dominio público real, no a `localhost`.
- [ ] `EMAIL_BACKEND` real (SMTP), no el backend de consola de desarrollo
      — sin esto, "¿Olvidaste tu contraseña?" no envía nada.
- [ ] Contraseña del usuario ADMINISTRADOR inicial cambiada en el primer
      login (`must_change_password` ya lo fuerza).
- [ ] Firewall de Windows: solo 80/443 accesibles desde fuera del
      servidor — 3000/8000 deben quedar inalcanzables fuera de
      `127.0.0.1` (por defecto, un binding a `127.0.0.1` de por sí no es
      alcanzable desde otra máquina; no hace falta una regla de firewall
      adicional salvo que algo más en el servidor los exponga).
