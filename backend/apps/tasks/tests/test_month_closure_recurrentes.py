"""Una recurrente que no se cerró en el mes sigue viva Y genera la del siguiente.

Antes el cierre hacía una cosa o la otra según el tipo, nunca las dos:

- una FIJA recurrente sin terminar se archivaba y la copia del mes siguiente
  nacía desde cero, así que el trabajo a medias quedaba sepultado en el mes
  cerrado;
- una de SEGUIMIENTO sin terminar seguía viva, pero NO generaba la instancia
  del mes siguiente, de modo que la cadencia mensual se perdía.

Regla desde 2026-10-02: si es recurrente y no se cerró, sigue viva con su
progreso y además se crea la del mes siguiente.
"""

from datetime import datetime
from datetime import timezone as dt_timezone

import pytest
from django.contrib.auth.models import Permission
from django.contrib.contenttypes.models import ContentType
from rest_framework.test import APIClient

from apps.permissions.models import ModulePermission
from apps.tasks.models import MonthClosure, Task
from apps.users.models import User

pytestmark = pytest.mark.django_db

YEAR, MONTH = 2026, 1
CERRAR = "/api/v1/tasks/close-month/"


@pytest.fixture
def manager():
    user = User.objects.create_user(
        username="cierre_manager", email="cierre@example.com", password="Sup3r-Secr3t!"
    )
    content_type = ContentType.objects.get_for_model(ModulePermission)
    user.user_permissions.add(
        Permission.objects.get(content_type=content_type, codename="tareas.cerrar_mes")
    )
    return user


@pytest.fixture
def client(manager):
    api = APIClient()
    api.force_authenticate(user=manager)
    return api


@pytest.fixture
def colaborador():
    return User.objects.create_user(
        username="cierre_colab", email="colab_cierre@example.com", password="Sup3r-Secr3t!"
    )


def _dt(day: int, month: int = MONTH, year: int = YEAR) -> datetime:
    return datetime(year, month, day, tzinfo=dt_timezone.utc)


def _tarea(colaborador, manager, **overrides) -> Task:
    campos = {
        "title": "Recurrente",
        "priority": "MEDIA",
        "frequency": "MENSUAL",
        "type": "FIJA",
        "status": "PENDIENTE",
        "start_date": _dt(5),
        "end_date": _dt(20),
        "estimated_hours": 5,
        "assigned_to": colaborador,
        "created_by": manager,
    }
    campos.update(overrides)
    return Task.objects.create(**campos)


def _cerrar(client, year=YEAR, month=MONTH):
    return client.post(CERRAR, {"year": year, "month": month}, format="json")


# --- La original sigue viva ---------------------------------------------------


@pytest.mark.parametrize("tipo", ["FIJA", "SEGUIMIENTO"])
@pytest.mark.parametrize("estado", ["PENDIENTE", "EN_PROGRESO"])
def test_una_recurrente_sin_cerrar_no_se_archiva(client, manager, colaborador, tipo, estado):
    tarea = _tarea(colaborador, manager, type=tipo, status=estado, progress=40, real_hours=3)

    respuesta = _cerrar(client)

    assert respuesta.status_code == 200
    tarea.refresh_from_db()
    # Lo que se perdía en FIJA: el avance quedaba enterrado en el mes cerrado.
    assert tarea.archived_month is None
    assert tarea.progress == 40
    assert tarea.real_hours == 3


def test_una_recurrente_completada_si_se_archiva(client, manager, colaborador):
    tarea = _tarea(colaborador, manager, status="COMPLETADA")

    _cerrar(client)

    tarea.refresh_from_db()
    assert tarea.archived_month == "2026-01"


def test_una_puntual_fija_sin_terminar_se_sigue_archivando(client, manager, colaborador):
    """No es recurrente: no hay cadencia que mantener y el mes la cierra, igual
    que antes de este cambio."""
    tarea = _tarea(colaborador, manager, frequency="PUNTUAL", type="FIJA")

    _cerrar(client)

    tarea.refresh_from_db()
    assert tarea.archived_month == "2026-01"


# --- Y además se crea la del mes siguiente ------------------------------------


@pytest.mark.parametrize("tipo", ["FIJA", "SEGUIMIENTO"])
def test_una_recurrente_sin_cerrar_genera_la_del_mes_siguiente(
    client, manager, colaborador, tipo
):
    original = _tarea(colaborador, manager, type=tipo, progress=40)

    respuesta = _cerrar(client)

    assert respuesta.data["duplicated_count"] == 1
    sucesora = Task.objects.get(end_date__month=2)
    assert sucesora.id != original.id
    assert sucesora.title == original.title
    assert sucesora.frequency == original.frequency
    assert sucesora.type == original.type
    # Arranca limpia: el avance se queda en la original, que sigue viva.
    assert sucesora.status == "PENDIENTE"
    assert sucesora.progress == 0
    assert sucesora.real_hours == 0
    assert sucesora.start_date == _dt(5, month=2)
    assert sucesora.end_date == _dt(20, month=2)


def test_quedan_las_dos_vivas(client, manager, colaborador):
    """El pedido es explícito: seguirse Y auto crearse."""
    _tarea(colaborador, manager, type="SEGUIMIENTO")

    _cerrar(client)

    vivas = Task.objects.filter(archived_month__isnull=True)
    assert vivas.count() == 2
    assert sorted(t.end_date.month for t in vivas) == [1, 2]


def test_una_de_seguimiento_abierta_ya_no_se_queda_sin_sucesora(client, manager, colaborador):
    """El hueco reportado: seguía viva pero la cadencia mensual se cortaba."""
    _tarea(colaborador, manager, type="SEGUIMIENTO", status="EN_PROGRESO")

    respuesta = _cerrar(client)

    assert respuesta.data["duplicated_count"] == 1
    assert Task.objects.filter(end_date__month=2).count() == 1


# --- Que no se multiplique mes a mes -----------------------------------------


def test_la_que_sigue_viva_no_genera_una_copia_en_cada_cierre_posterior(
    client, manager, colaborador
):
    """Sin `successor_created_at` esto era un desborde: la original conserva su
    fecha fin en enero y nunca recibe `archived_month`, así que volvería a
    entrar como candidata en febrero, marzo y cada mes siguiente."""
    original = _tarea(colaborador, manager)

    _cerrar(client, month=1)
    _cerrar(client, month=2)
    _cerrar(client, month=3)

    original.refresh_from_db()
    assert original.archived_month is None
    assert original.successor_created_at is not None
    # Una sola sucesora nacida de la de enero (la de febrero genera la suya de
    # marzo, y la de marzo la de abril: una por mes, no una por mes POR tarea).
    assert Task.objects.filter(end_date__month=2).count() == 1
    assert Task.objects.filter(end_date__month=3).count() == 1
    assert Task.objects.filter(end_date__month=4).count() == 1


def test_el_resumen_del_cierre_distingue_las_que_siguen_vivas(client, manager, colaborador):
    _tarea(colaborador, manager, type="FIJA", status="PENDIENTE")  # recurrente, sigue
    _tarea(colaborador, manager, type="FIJA", status="COMPLETADA")  # se archiva
    _tarea(colaborador, manager, frequency="PUNTUAL", type="FIJA")  # se archiva

    respuesta = _cerrar(client)

    cierre = MonthClosure.objects.get(year=YEAR, month=MONTH)
    assert cierre.summary["continuedActive"] == 1
    assert cierre.summary["continuedRecurring"] == 1
    assert respuesta.data["archived_count"] == 2
    # Solo las dos recurrentes generan sucesora; la puntual no.
    assert respuesta.data["duplicated_count"] == 2


def test_el_preview_anticipa_cuantas_se_van_a_crear(client, manager, colaborador):
    _tarea(colaborador, manager)
    _tarea(colaborador, manager, frequency="PUNTUAL")

    respuesta = client.get(f"{CERRAR}?year={YEAR}&month={MONTH}")

    assert respuesta.data["to_duplicate"] == 1


# --- Aviso de meses sin cerrar ------------------------------------------------
#
# El cierre es manual y nada lo dispara solo. Un mes que nadie cerró no avisa
# de ninguna forma: sus recurrentes no generan la instancia del mes siguiente y
# el mes no entra al Repositorio.


def test_un_mes_terminado_sin_cerrar_aparece_como_pendiente(client, manager, colaborador):
    _tarea(colaborador, manager, start_date=_dt(5), end_date=_dt(20))

    respuesta = client.get(f"{CERRAR}?year={YEAR}&month={MONTH}")

    assert {"year": YEAR, "month": MONTH} in respuesta.data["pending_closures"]


def test_un_mes_ya_cerrado_no_aparece(client, manager, colaborador):
    _tarea(colaborador, manager, start_date=_dt(5), end_date=_dt(20))
    _cerrar(client)

    respuesta = client.get(f"{CERRAR}?year={YEAR}&month={MONTH}")

    assert {"year": YEAR, "month": MONTH} not in respuesta.data["pending_closures"]


def test_un_mes_sin_tareas_no_genera_aviso(client, manager, colaborador):
    """Avisar por un mes en el que nadie registró nada sería puro ruido."""
    respuesta = client.get(f"{CERRAR}?year={YEAR}&month={MONTH}")

    assert respuesta.data["pending_closures"] == []


def test_los_pendientes_vienen_del_mas_viejo_al_mas_reciente(client, manager, colaborador):
    _tarea(colaborador, manager, start_date=_dt(5, month=1), end_date=_dt(20, month=1))
    _tarea(colaborador, manager, start_date=_dt(5, month=2), end_date=_dt(20, month=2))

    respuesta = client.get(f"{CERRAR}?year={YEAR}&month={MONTH}")

    # Comparar contra `sorted()` de la propia lista seria tautologico: se
    # compara contra el orden esperado explicito.
    pendientes = [(p["year"], p["month"]) for p in respuesta.data["pending_closures"]]
    assert pendientes == [(YEAR, 1), (YEAR, 2)]
