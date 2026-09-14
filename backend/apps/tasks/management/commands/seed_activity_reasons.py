"""Carga inicial del catálogo de motivos de registro de actividades.

Existe por un vacío real: `ActivityReason` no tenía ninguna carga inicial —
ni migración de datos ni seed—, así que toda instalación nueva arrancaba con
el catálogo vacío. El síntoma no se parece a la causa: el selector de motivos
del registro de actividades aparece sin opciones, lo que se lee como un fallo
del filtro por rol y no como una tabla sin filas. Pasó en producción el
2026-09-14 (ver docs/AUDIT_LOG.md).

Es **idempotente**: se puede correr las veces que haga falta. Un motivo ya
existente no se toca — ni sus roles ni su estado—, porque el catálogo se
edita desde Ajustes y este comando no debe pisar esas ediciones. Solo crea
lo que falta.
"""

from django.core.management.base import BaseCommand
from django.db import transaction

from apps.tasks.models import ActivityReason

# `key` se genera con el mismo helper que usa `POST
# /settings/activity-reasons/`, para que un motivo sembrado sea
# indistinguible de uno creado a mano desde Ajustes.
from apps.tasks.views import _unique_activity_reason_key

ADMINISTRADOR = "ADMINISTRADOR"
JEFE_NACIONAL = "JEFE_NACIONAL"
COORDINADOR_NACIONAL = "COORDINADOR_NACIONAL"
COORDINADOR_ZS = "COORDINADOR_ZS"
ANALISTA_CC = "ANALISTA_CC"
ANALISTA_SELECCION = "ANALISTA_SELECCION"
ASISTENTE_SELECCION = "ASISTENTE_SELECCION"
ASISTENTE_GH = "ASISTENTE_GH"
ASISTENTE_GH_ZS = "ASISTENTE_GH_ZS"
TRABAJO_SOCIAL = "TRABAJO_SOCIAL"
ASISTENTE_NOMINA = "ASISTENTE_NOMINA"

TODOS = [
    ADMINISTRADOR,
    JEFE_NACIONAL,
    COORDINADOR_NACIONAL,
    COORDINADOR_ZS,
    ANALISTA_CC,
    ANALISTA_SELECCION,
    ASISTENTE_SELECCION,
    ASISTENTE_GH,
    ASISTENTE_GH_ZS,
    TRABAJO_SOCIAL,
    ASISTENTE_NOMINA,
]

# Catálogo provisto por Gestión Humana el 2026-09-14. El orden es el del
# documento original y se conserva a propósito: es el orden en que la gente
# espera ver los motivos en el selector.
CATALOGO: list[tuple[str, list[str]]] = [
    ("Seguimiento de documentación", TODOS),
    ("Solicitudes internas", TODOS),
    (
        "Reclutamiento y Selección",
        [ANALISTA_SELECCION, ASISTENTE_SELECCION, ASISTENTE_GH_ZS, COORDINADOR_ZS],
    ),
    (
        "Seguimiento de Ausentismos",
        [ANALISTA_CC, TRABAJO_SOCIAL, ASISTENTE_GH_ZS, COORDINADOR_ZS],
    ),
    ("Visita Domiciliaria", [TRABAJO_SOCIAL]),
    (
        "Novedades de Pago",
        [
            JEFE_NACIONAL,
            COORDINADOR_NACIONAL,
            COORDINADOR_ZS,
            ANALISTA_SELECCION,
            ASISTENTE_SELECCION,
            ASISTENTE_GH_ZS,
            TRABAJO_SOCIAL,
        ],
    ),
    # Facturas y Consulta de Operaciones son "todos menos Asistente de
    # Nómina" — está así en el documento original, no es un olvido.
    ("Facturas", [rol for rol in TODOS if rol != ASISTENTE_NOMINA]),
    ("Consulta de Operaciones", [rol for rol in TODOS if rol != ASISTENTE_NOMINA]),
    ("Aviso de entrada y Salida", [ASISTENTE_NOMINA]),
    ("Legalización de actas", [ASISTENTE_NOMINA]),
    ("Elaboración de actas", [ASISTENTE_NOMINA]),
    ("Seguimiento Liquidaciones", [ASISTENTE_GH]),
    ("Elaboración Paz y Salvo", [ASISTENTE_GH]),
    ("MEMOS-SANCIONES", [ASISTENTE_GH]),
    ("DESCUENTOS", [ASISTENTE_GH]),
    ("Elaboración de vacaciones", [ASISTENTE_GH]),
]


class Command(BaseCommand):
    help = (
        "Crea los motivos de actividad que falten, sin modificar los existentes. "
        "Idempotente: correrlo dos veces no duplica nada."
    )

    def add_arguments(self, parser):
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Mostrar qué se crearía, sin escribir en la base.",
        )

    def handle(self, *args, **options):
        dry_run = options["dry_run"]

        existentes = set(ActivityReason.objects.values_list("label", flat=True))
        a_crear = [(label, roles) for label, roles in CATALOGO if label not in existentes]

        if not a_crear:
            self.stdout.write(
                self.style.SUCCESS(
                    f"No hay nada que crear: los {len(CATALOGO)} motivos del catálogo ya existen."
                )
            )
            return

        for label, roles in a_crear:
            self.stdout.write(f"  + {label}  ({len(roles)} rol/es)")

        if dry_run:
            self.stdout.write(
                self.style.WARNING(f"\n--dry-run: no se creó nada ({len(a_crear)} pendientes).")
            )
            return

        with transaction.atomic():
            for label, roles in a_crear:
                ActivityReason.objects.create(
                    key=_unique_activity_reason_key(label),
                    label=label,
                    description="",
                    assigned_roles=roles,
                    is_active=True,
                )

        omitidos = len(CATALOGO) - len(a_crear)
        detalle = f"{len(a_crear)} motivo(s) creado(s)"
        if omitidos:
            detalle += f", {omitidos} ya existían y no se tocaron"
        self.stdout.write(self.style.SUCCESS(f"\n{detalle}."))
