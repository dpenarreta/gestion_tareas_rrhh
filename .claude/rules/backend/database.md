---
paths:
  - "backend/apps/**/models.py"
  - "backend/apps/**/migrations/**/*"
  - "backend/config/settings/**/*"
  - "backend/apps/**/management/commands/*"
---

# Database Rules (backend)

- SQL Server (`mssql-django`), no PostgreSQL — sin conexión ni referencia
  a ninguna base Postgres legacy (retirada por completo el 2026-08-31).
  Algunas features de Django ORM comunes en Postgres/MySQL no están
  soportadas — verificado: `bulk_create(..., ignore_conflicts=True)` **no
  funciona** en `mssql-django`. Para idempotencia en una carga masiva,
  prefiltrá los registros a insertar en vez de confiar en
  `ignore_conflicts`.
- `bulk_create` SÍ dispara `auto_now`/`auto_now_add` (verificado
  empíricamente, no es el comportamiento típico esperado).
- No modifiques una migración ya aplicada — creá una nueva para cualquier
  cambio de esquema (`manage.py makemigrations`).
- `legacy_postgres_id` (puente cuid↔id-Django) se retiró por completo
  (decisión explícita del usuario, ver docs/AUDIT_LOG.md § 2026-08-31) —
  `User.id` (numérico) es el único identificador de sesión, tanto en
  Django como en `session.djangoUserId` del lado Next.js.
- `base.py`/`development.py`/`production.py`: no dupliques una config que
  ya está en `base.py` dentro de los otros dos — solo overrides.
