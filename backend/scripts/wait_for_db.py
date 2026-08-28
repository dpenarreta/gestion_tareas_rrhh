"""Espera a que la base de datos (SQL Server) acepte conexiones antes de continuar.

Uso: python scripts/wait_for_db.py [--timeout 30]
"""

import argparse
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings.development")

import django  # noqa: E402

django.setup()

from django.db import connections  # noqa: E402
from django.db.utils import OperationalError  # noqa: E402


def wait_for_db(timeout: int) -> None:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            connections["default"].ensure_connection()
            print("Base de datos disponible.")
            return
        except OperationalError:
            print("Base de datos no disponible todavía, reintentando...")
            time.sleep(1)
    print(f"No se pudo conectar a la base de datos tras {timeout}s.", file=sys.stderr)
    sys.exit(1)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--timeout", type=int, default=30)
    args = parser.parse_args()
    wait_for_db(args.timeout)
