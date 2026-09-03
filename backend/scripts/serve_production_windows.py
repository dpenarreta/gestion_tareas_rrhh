"""Arranque de producción del backend en Windows, detrás de IIS (reverse
proxy) — ver docs/DEPLOYMENT_IIS.md. Equivalente Windows de entrypoint.sh
(Docker/Linux): espera la base de datos, recolecta estáticos, aplica
migraciones y recién ahí sirve la app — nunca con valores ficticios en
tiempo de "build", mismo criterio (`_fail_fast_on_missing_env` en
config/settings/base.py ya exige las variables de entorno reales antes de
llegar acá).

`gunicorn` (usado en entrypoint.sh) depende de `fcntl`, exclusivo de Unix
— en Windows el servidor WSGI de producción es `waitress` (puro Python).
Waitress no tiene el concepto de "workers" (procesos) de gunicorn, solo
threads dentro de un único proceso — se usa `--threads` más alto para
compensar (mismo razonamiento que "--threads" en entrypoint.sh: la carga
es de I/O — espera de red/SQL Server —, no de CPU, así que varios threads
por proceso alcanzan sin necesitar procesos adicionales).

Uso (con el venv activado, DJANGO_SETTINGS_MODULE=config.settings.production
y el .env de producción ya presente):
    python scripts/serve_production_windows.py [--host 127.0.0.1] [--port 8000] [--threads 8]
"""

import argparse
import os
import subprocess
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings.production")


def _run(cmd: list[str]) -> None:
    print(f"$ {' '.join(cmd)}")
    subprocess.run(cmd, check=True)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--threads", type=int, default=8)
    parser.add_argument("--wait-db-timeout", type=int, default=30)
    args = parser.parse_args()

    python = sys.executable
    _run(
        [python, os.path.join("scripts", "wait_for_db.py"), "--timeout", str(args.wait_db_timeout)]
    )
    _run([python, "manage.py", "collectstatic", "--noinput"])
    _run([python, "manage.py", "migrate", "--noinput"])

    import django

    django.setup()
    from waitress import serve

    from config.wsgi import application

    print(f"Sirviendo en http://{args.host}:{args.port} con {args.threads} threads (waitress)...")
    serve(application, host=args.host, port=args.port, threads=args.threads)


if __name__ == "__main__":
    main()
