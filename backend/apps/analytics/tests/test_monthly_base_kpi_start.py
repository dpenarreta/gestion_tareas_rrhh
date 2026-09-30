"""La base mensual del equipo tiene que respetar `kpi_start_date`.

`monthly_business_base_for_users` arrancaba siempre el día 1 del mes, así que
el Resumen Ejecutivo y los KPIs del equipo mostraban el mes entero (143h
medidas en producción) para gente cuyo período de cálculo empezaba el 17.
`compute_carga_tiempo` sí lo aplicaba —daba 45,5h para la misma persona—, de
modo que las dos pantallas se contradecían entre sí.
"""

from datetime import datetime
from datetime import timezone as tz

import pytest
from django.contrib.auth.models import Group

from apps.analytics.workload import monthly_business_base_for_users
from apps.users.models import User

pytestmark = pytest.mark.django_db


def _usuario(username, kpi_start=None):
    u = User.objects.create_user(
        username=username, email=f"{username}@example.com", password="Sup3r-Secr3t!"
    )
    u.groups.set([Group.objects.get(name="ASISTENTE_GH")])
    if kpi_start:
        u.kpi_start_date = kpi_start
        u.save(update_fields=["kpi_start_date"])
    return u


def test_sin_ajuste_usa_la_base_del_equipo():
    sin = _usuario("sin_ajuste")

    biz = monthly_business_base_for_users([sin], 2026, 9)

    assert sin.id not in biz["per_user"], "sin ajuste no necesita base propia"
    assert biz["shared"]["base_hours"] > 0


def test_con_ajuste_la_base_se_recorta():
    quincena = datetime(2026, 9, 17, tzinfo=tz.utc)
    con = _usuario("con_ajuste", kpi_start=quincena)

    biz = monthly_business_base_for_users([con], 2026, 9)

    propia = biz["per_user"][con.id]
    compartida = biz["shared"]
    # Lo que se reportó: mostraba el mes entero en vez del tramo desde el 17.
    assert propia["base_hours"] < compartida["base_hours"]
    assert propia["business_days"] < compartida["business_days"]
    assert propia["start"] == quincena.date()


def test_una_fecha_de_otro_mes_no_recorta_nada():
    """Un ajuste de agosto no debe tocar septiembre: sin este filtro, una fecha
    vieja dejaría la base en cero o contaría días de más."""
    viejo = _usuario("ajuste_viejo", kpi_start=datetime(2026, 8, 3, tzinfo=tz.utc))

    biz = monthly_business_base_for_users([viejo], 2026, 9)

    assert viejo.id not in biz["per_user"]


def test_el_ajuste_de_una_persona_no_afecta_al_resto():
    con = _usuario("recortado", kpi_start=datetime(2026, 9, 17, tzinfo=tz.utc))
    sin = _usuario("completo")

    biz = monthly_business_base_for_users([con, sin], 2026, 9)

    assert biz["per_user"][con.id]["base_hours"] < biz["shared"]["base_hours"]
    assert sin.id not in biz["per_user"]
