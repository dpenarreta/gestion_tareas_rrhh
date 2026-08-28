#!/bin/sh
# Entrypoint del contenedor de producción: espera la base de datos, aplica
# migraciones y recolecta estáticos con las variables de entorno reales del
# contenedor (nunca con valores ficticios en tiempo de build — este proyecto
# falla rápido si falta una variable obligatoria, ver
# config/settings/base.py::_fail_fast_on_missing_env), y recién ahí arranca
# gunicorn.
set -e

python scripts/wait_for_db.py
python manage.py collectstatic --noinput
python manage.py migrate --noinput

# Fase 77 (ver docs/AUDIT_LOG.md § 2026-08-27): con --workers 3 y sin
# --threads (gunicorn usa el worker sync por defecto, 1 request a la vez por
# worker), N llamadas concurrentes de un solo reporte MENSUAL a
# /analytics/<id>/ (una por colaborador, ver buildMonthlySnapshotData)
# exceden ampliamente los 3 slots disponibles y hacen cola — medido: 5-9s
# por llamada con 9-11 colaboradores contra `manage.py runserver`, cifra que
# coincide con el número de workers de ESTA config, no con un cuello de
# botella distinto (conexión a SQL Server, cómputo, etc. — aislados y
# descartados por separado). La carga es de I/O (espera de red/DB, no CPU:
# el cómputo puro mide ~0.3s), así que se suma "--threads" en vez de subir
# "--workers" — gthread reutiliza el mismo proceso/memoria de Django para
# varios requests I/O-bound concurrentes, mucho más barato que clonar el
# proceso completo. Sin verificar contra gunicorn real todavía (decisión
# explícita del usuario: aplicar el ajuste razonado ahora, no bloquear en
# una re-medición) — revisar `docs/AUDIT_LOG.md` § 2026-08-27 antes de
# ajustar estos valores.
exec gunicorn config.wsgi:application \
    --bind 0.0.0.0:8000 \
    --worker-class gthread \
    --workers "${GUNICORN_WORKERS:-3}" \
    --threads "${GUNICORN_THREADS:-4}"
