# backend/CLAUDE.md

Django/DRF + SQL Server. Fuente de verdad de negocio y autenticación de todo
Nexo — el frontend Next.js (raíz del repo) nunca accede a datos directo,
siempre vía `djangoApiFetch`. Contexto global del proyecto en `/CLAUDE.md`.

## Stack

- Django 5.1 + DRF, `djangorestframework-simplejwt` (JWT propio del backend,
  distinto de la cookie de sesión de Next.js).
- SQL Server vía `mssql-django`/`pyodbc` — **no** PostgreSQL, **no** Prisma.
  Toda la infraestructura de migración de datos desde el Postgres/Prisma
  legacy (los 41 comandos `migrate_*_from_postgres`, `apps/core/legacy_migration.py`,
  `LEGACY_POSTGRES_URL`, `psycopg2-binary`) se retiró por completo —
  decisión explícita del usuario (2026-08-31): nunca se migraron datos
  históricos reales, y el proyecto pasa a una base SQL Server nueva en un
  servidor distinto. `PASSWORD_HASHERS` es solo `Argon2PasswordHasher` +
  `PBKDF2*` (sin `BCryptPasswordHasher`, por el mismo motivo).
- `ruff`/`black`/`isort` — configurados en `pyproject.toml`. No reinventes
  reglas de estilo que ya cubren.

## Arquitectura: flujo de una request

`urls.py → views.py (ViewSet/APIView, permission_classes) → serializers.py
(validación) → services.py (lógica de negocio) → models.py (ORM)`

**No existe capa de repositorios** — el ORM de Django ya es la abstracción
de persistencia. No la agregues.

- **`views.py`**: define el endpoint, resuelve permisos por acción
  (`get_permissions()`), delega a `services.py`. Sin lógica de negocio.
  Puede hacer queries de filtrado simples (`get_queryset`), pero cálculos y
  reglas de negocio van en `services.py`.
- **`serializers.py`**: valida entrada y serializa salida. Es la capa
  "validator" — usa `serializers.Serializer`/`ModelSerializer` de DRF, no
  inventes otro mecanismo de validación.
- **`permissions.py`** (por app) + `apps/core/permissions.py` (transversales,
  como `IsAdministrador`): clases `BasePermission` de DRF. Verifica primero
  si ya existe el permiso que necesitás antes de crear uno nuevo.
- **`services.py`**: lógica de negocio real. Clases con métodos estáticos o
  de instancia (patrón ya establecido, ej. `TaskService`, `CommentService`
  en `apps/tasks/services.py`) — sigue ese patrón, no una función suelta.
- **`models.py`**: ORM. El campo `legacy_postgres_id` (puente cuid↔id-Django)
  se retiró por completo (decisión explícita del usuario, ver
  docs/AUDIT_LOG.md § 2026-08-31) — `User.id` (numérico) es ahora el único
  identificador de sesión en todo el sistema, de punta a punta. No queda
  ningún puente de id que coordinar.

## Errores

Contrato uniforme para toda la API, centralizado en
`apps/core/exceptions.py` (`api_exception_handler`, `error_response`):

```json
{"error": {"code": "...", "message": "...", "details": {...}}}
```

No inventes otro formato de error. Las excepciones estándar de DRF
(`ValidationError`, `PermissionDenied`, etc.) ya se envuelven solas — no
captures y reformatees a mano salvo que necesites un `code` específico.

## Base de datos / migraciones

- `mssql-django` **no soporta `ignore_conflicts`** en `bulk_create` — si
  necesitás idempotencia en una carga masiva, prefiltrá los registros ya
  existentes antes de insertar, no dependas de ese parámetro.
- `bulk_create` SÍ dispara `auto_now`/`auto_now_add` (verificado
  empíricamente, no es el comportamiento típico esperado en otros ORMs).
- No alteres una migración ya aplicada — creá una nueva para cualquier
  cambio de esquema.
- `config/settings/`: `base.py` (común) + `development.py`/`production.py`
  (override). No dupliques configuración entre ambos.

## Comandos

```bash
cd backend
./.venv/Scripts/python.exe -m pytest apps/           # suite completa (pytest-django, --reuse-db)
./.venv/Scripts/python.exe -m pytest apps/tasks/      # una app puntual
./.venv/Scripts/python.exe -m ruff check .
./.venv/Scripts/python.exe -m black --check .
./.venv/Scripts/python.exe -m isort --check .
./.venv/Scripts/python.exe manage.py makemigrations
./.venv/Scripts/python.exe manage.py migrate
```

(En Windows el venv se activa con esa ruta explícita — si el shell ya tiene
el venv activado, `python -m pytest ...` alcanza.)

## Trampas conocidas

- Los cálculos de Analytics/KPIs son 100% deterministas — Gemini (Nova)
  nunca calcula un número, solo redacta texto sobre JSON ya calculado. Si
  ves una discrepancia numérica, el bug está en `apps/analytics/`, nunca en
  el texto generado.
- El redondeo usa `apps/core/rounding.py::round_half_up` en todo el
  backend (no el `round()` nativo de Python, que usa banker's rounding) —
  para que coincida con `Math.round()` de JS en el frontend.
- `apps.assistant`/Nova no viven en Django — el backend nunca llama a
  Gemini directo. Cualquier mención a Nova/IA en un docstring de esta
  carpeta es solo una nota de límite de alcance, no código real.
