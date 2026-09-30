"""`kpi_start_date` tiene que regir en TODOS los módulos que miden un mes.

`monthly_business_base_for_users` ya lo aplicaba (ver
`test_monthly_base_kpi_start.py`), pero siete módulos seguían llamando a
`monthly_business_base` —la variante global, que arranca el día 1— mientras
comparaban contra horas reales que sí arrancaban en la fecha configurada. El
resultado era un objetivo de mes entero contra horas de medio mes: score de
carga hundido, histórico con la base equivocada y proyecciones de ritmo
sesgadas.

Cada test acá compara la MISMA persona con y sin `kpi_start_date`: si el
módulo ignora el ajuste, los dos casos devuelven lo mismo.
"""

from datetime import datetime, timedelta
from datetime import timezone as dt_timezone

import pytest

from apps.analytics.health_score import compute_health_score
from apps.analytics.history import compute_monthly_history, compute_weekly_history
from apps.analytics.kpi_simulate import simulate_kpi_scenario
from apps.analytics.prediction import compute_prediction
from apps.analytics.prediction_engine import compute_cumplimiento_projection
from apps.tasks.models import Task, TaskActivity
from apps.users.models import User

pytestmark = pytest.mark.django_db

# Martes 29 de septiembre de 2026. Septiembre tiene 22 días hábiles; desde el
# 17 quedan 10, así que el objetivo mensual pasa de 140h a 63,64h.
NOW = datetime(2026, 9, 29, 10, 0, tzinfo=dt_timezone.utc)
QUINCENA = datetime(2026, 9, 17, tzinfo=dt_timezone.utc)


def _usuario(username, *, kpi_start=None):
    user = User.objects.create_user(
        username=username, email=f"{username}@example.com", password="Sup3r-Secr3t!"
    )
    if kpi_start:
        user.kpi_start_date = kpi_start
        user.save(update_fields=["kpi_start_date"])
    return user


def _horas(user, day: datetime, horas: float) -> Task:
    """Una tarea FIJA completada ese día con `horas` imputadas."""
    tarea = Task.objects.create(
        title="Fija",
        priority="MEDIA",
        frequency="PUNTUAL",
        type=Task.Type.FIJA,
        start_date=day,
        end_date=day,
        estimated_hours=horas,
        real_hours=horas,
        assigned_to=user,
        created_by=user,
        status=Task.Status.COMPLETADA,
        completed_at=day,
    )
    return tarea


def _par_de_usuarios(nombre):
    """Dos personas con exactamente las mismas horas cargadas desde el 17; una
    con el ajuste de fecha y otra sin él."""
    con = _usuario(f"{nombre}_con", kpi_start=QUINCENA)
    sin = _usuario(f"{nombre}_sin")
    for user in (con, sin):
        for dia in (21, 22, 23, 24, 25, 28):
            _horas(user, datetime(2026, 9, dia, 14, 0, tzinfo=dt_timezone.utc), 7.0)
    return con, sin


# --- health_score --------------------------------------------------------------


def test_health_score_mide_la_carga_contra_el_periodo_del_usuario():
    con, sin = _par_de_usuarios("health")

    score_con = compute_health_score(user=con, now=NOW)
    score_sin = compute_health_score(user=sin, now=NOW)

    def carga(score):
        return next(f for f in score["factors"] if f["name"] == "Carga laboral")

    # 42h reales contra 63,64h de objetivo (con ajuste) no puede puntuar igual
    # que 42h contra 140h (sin ajuste) — eso es lo que pasaba.
    assert carga(score_con)["points"] > carga(score_sin)["points"]


# --- kpi_simulate --------------------------------------------------------------


def test_el_simulador_parte_de_la_base_del_periodo_del_usuario():
    """El escenario "cambiar horas por día" reescala `limit_base_hours`: es el
    valor simulado (`after`), no el actual, el que salía del mes entero.
    `before` ya venía bien porque lo calcula `compute_carga_tiempo`, que sí
    aplicaba el ajuste — de ahí que las dos pantallas se contradijeran."""
    con, sin = _par_de_usuarios("sim")
    escenario = {"type": "daily_hours", "new_hours_per_day": 8}

    sim_con = simulate_kpi_scenario(user=con, body=escenario, now=NOW)
    sim_sin = simulate_kpi_scenario(user=sin, body=escenario, now=NOW)

    assert sim_con["before"]["carga_pct"] > sim_sin["before"]["carga_pct"]
    assert sim_con["after"]["carga_pct"] > sim_sin["after"]["carga_pct"]


# --- history -------------------------------------------------------------------


def test_el_historico_mensual_recorta_la_base_al_periodo_del_usuario():
    con, sin = _par_de_usuarios("hist")

    mes_con = compute_monthly_history(user=con, months_back=1, now=NOW)[-1]
    mes_sin = compute_monthly_history(user=sin, months_back=1, now=NOW)[-1]

    assert mes_con["carga_base_hours"] == 63.64
    assert mes_sin["carga_base_hours"] == 140.0
    assert mes_con["carga_pct"] > mes_sin["carga_pct"]


def test_el_historico_mensual_no_suma_horas_previas_al_periodo():
    """Las horas de antes del 17 no pertenecen al período de cálculo: si se
    cuentan, la persona aparece con más carga de la que se le mide."""
    con = _usuario("previas_con", kpi_start=QUINCENA)
    sin = _usuario("previas_sin")
    for user in (con, sin):
        _horas(user, datetime(2026, 9, 3, 14, 0, tzinfo=dt_timezone.utc), 7.0)
        _horas(user, datetime(2026, 9, 21, 14, 0, tzinfo=dt_timezone.utc), 7.0)

    mes_con = compute_monthly_history(user=con, months_back=1, now=NOW)[-1]
    mes_sin = compute_monthly_history(user=sin, months_back=1, now=NOW)[-1]

    assert mes_con["carga_real_hours"] == 7.0
    assert mes_sin["carga_real_hours"] == 14.0


def test_una_semana_anterior_al_periodo_no_tiene_base():
    """Sin esto la semana contaba 6,5h/día de objetivo con 0h reales y la
    persona aparecía subutilizada antes de que su período empezara."""
    con = _usuario("semana_con", kpi_start=QUINCENA)
    sin = _usuario("semana_sin")

    semanas_con = compute_weekly_history(user=con, weeks_back=6, now=NOW)
    semanas_sin = compute_weekly_history(user=sin, weeks_back=6, now=NOW)

    primera_con, primera_sin = semanas_con[0], semanas_sin[0]
    assert primera_con["week_start"] == primera_sin["week_start"]
    assert primera_con["business_days"] == 0
    assert primera_con["base_hours"] == 0
    assert primera_sin["business_days"] == 5
    assert primera_sin["base_hours"] > 0


def test_la_semana_que_contiene_la_fecha_se_prorratea():
    con = _usuario("semana_parcial", kpi_start=QUINCENA)

    semanas = compute_weekly_history(user=con, weeks_back=6, now=NOW)
    # Semana del lunes 14 al viernes 18: solo el 17 y el 18 entran.
    del_14 = next(s for s in semanas if s["week_start"] == "2026-09-14")

    assert del_14["business_days"] == 2


# --- prediction / prediction_engine --------------------------------------------


def _con_historial(username, *, kpi_start=None):
    """Necesitan varias semanas con registros para que la proyección exista.

    Una tarea pendiente por día además de la completada: con el 100% cumplido
    la extrapolación se satura en 100 y deja de distinguir un ritmo de otro."""
    user = _usuario(username, kpi_start=kpi_start)
    dia = datetime(2026, 8, 3, 14, 0, tzinfo=dt_timezone.utc)
    while dia < NOW:
        if dia.weekday() < 5:
            TaskActivity.objects.create(
                task=_horas(user, dia, 1.0), author=user, reason="OTRO", duration=180
            )
            Task.objects.create(
                title="Pendiente",
                priority="MEDIA",
                frequency="PUNTUAL",
                start_date=dia,
                end_date=dia,
                estimated_hours=2,
                assigned_to=user,
                created_by=user,
                status=Task.Status.PENDIENTE,
            )
        dia += timedelta(days=1)
    return user


def test_la_proyeccion_de_ritmo_usa_el_periodo_del_usuario():
    con = _con_historial("pace_con", kpi_start=QUINCENA)
    sin = _con_historial("pace_sin")

    proy_con = compute_prediction(user=con, now=NOW)
    proy_sin = compute_prediction(user=sin, now=NOW)

    assert proy_con["available"] and proy_sin["available"]
    # 10 días hábiles totales / 8 transcurridos (1,25) no es la misma
    # extrapolación que 22 / 20 (1,10).
    assert (
        proy_con["cumplimiento_estimado_cierre_mes"]
        != proy_sin["cumplimiento_estimado_cierre_mes"]
    )


def test_la_proyeccion_de_cumplimiento_usa_el_periodo_del_usuario():
    con = _con_historial("cierre_con", kpi_start=QUINCENA)
    sin = _con_historial("cierre_sin")

    proy_con = compute_cumplimiento_projection(user=con, now=NOW)
    proy_sin = compute_cumplimiento_projection(user=sin, now=NOW)

    assert proy_con["available"] and proy_sin["available"]
    assert (
        proy_con["cumplimiento_esperado_cierre_pct"]
        != proy_sin["cumplimiento_esperado_cierre_pct"]
    )
