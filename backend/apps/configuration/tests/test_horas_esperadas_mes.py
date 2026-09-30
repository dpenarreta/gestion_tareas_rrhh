"""Las horas esperadas de un mes de trabajo son un valor fijo (140h).

Antes la base salía de `días hábiles × HORAS_EFECTIVAS_DIA`, así que el
objetivo se movía solo con el calendario: 130h en febrero 2026 (20 hábiles),
143h en septiembre (22) y 136,5h en noviembre (21). El negocio define el mes
en 140h, y es ese total el que se prorratea cuando el período es parcial.
"""

from datetime import date, datetime
from datetime import timezone as dt_timezone

import pytest

from apps.configuration.models import SystemConfigHistory
from apps.configuration.services import (
    CONFIG_KEY_HORAS_EFECTIVAS,
    CONFIG_KEY_HORAS_ESPERADAS_MES,
    business_base_for_range,
    expected_hours_per_day_for_month,
    set_config_value,
)
from apps.users.models import User

pytestmark = pytest.mark.django_db


@pytest.fixture
def actor():
    return User.objects.create_user(
        username="config_actor", email="config_actor@example.com", password="Sup3r-Secr3t!"
    )


def _sembrar_vigente_desde_siempre(key: str, value: str, actor: User) -> None:
    """`set_config_value` fecha el cambio HOY y la configuración nunca es
    retroactiva, así que para que rija un período de 2026 hay que sembrar el
    `valid_from` atrás (mismo patrón que `test_effective_config.py`)."""
    SystemConfigHistory.objects.create(
        key=key,
        value=value,
        valid_from=datetime(2020, 1, 1, tzinfo=dt_timezone.utc),
        updated_by=actor,
    )


# (año, mes, días hábiles sin feriados sembrados)
MESES = [(2026, 2, 20), (2026, 9, 22), (2026, 11, 21), (2026, 1, 22)]


@pytest.mark.parametrize(("year", "month", "business_days"), MESES)
def test_un_mes_completo_suma_140_horas_sea_cual_sea_el_calendario(year, month, business_days):
    month_end = date(year, month, 28 if month == 2 else 30)
    if month in (1, 3, 5, 7, 8, 10, 12):
        month_end = date(year, month, 31)

    base = business_base_for_range(date(year, month, 1), month_end)

    assert base["business_days"] == business_days
    # Lo reportado: el objetivo cambiaba de mes a mes (130 / 143 / 136,5).
    assert base["base_hours"] == 140.0
    # La clasificación Moderado/Óptimo tiene que usar el MISMO número que se
    # exhibe, o la pantalla vuelve a mostrar 140 y clasificar contra otra cosa.
    assert base["limit_base_hours"] == 140.0


def test_un_tramo_de_mes_se_prorratea_sobre_las_140():
    # Del 17 al 30 de septiembre 2026 hay 10 días hábiles de los 22 del mes.
    base = business_base_for_range(date(2026, 9, 17), date(2026, 9, 30))

    assert base["business_days"] == 10
    assert base["base_hours"] == 63.64  # 10 × (140/22)
    # Con la regla vieja (10 × 6,5h) daban 65h.
    assert base["base_hours"] < 65


def test_la_tasa_diaria_esperada_se_adapta_al_mes():
    """Un mes corto exige más por día para llegar a las mismas 140h."""
    febrero = expected_hours_per_day_for_month(2026, 2)  # 20 hábiles
    septiembre = expected_hours_per_day_for_month(2026, 9)  # 22 hábiles

    assert febrero == pytest.approx(7.0)
    assert septiembre == pytest.approx(140 / 22)
    assert febrero > septiembre


def test_horas_efectivas_dia_ya_no_mueve_la_base_mensual(actor):
    """`HORAS_EFECTIVAS_DIA` sigue rigiendo el día y la semana; el mes no."""
    antes = business_base_for_range(date(2026, 9, 1), date(2026, 9, 30))["base_hours"]

    _sembrar_vigente_desde_siempre(CONFIG_KEY_HORAS_EFECTIVAS, "8.0", actor)
    despues = business_base_for_range(date(2026, 9, 1), date(2026, 9, 30))

    assert antes == despues["base_hours"] == 140.0
    assert despues["hours_per_day"] == 8.0


def test_las_horas_esperadas_del_mes_son_parametrizables(actor):
    _sembrar_vigente_desde_siempre(CONFIG_KEY_HORAS_ESPERADAS_MES, "160", actor)

    base = business_base_for_range(date(2026, 9, 1), date(2026, 9, 30))

    assert base["base_hours"] == 160.0


def test_un_rango_de_varios_meses_suma_el_objetivo_de_cada_mes():
    """Cada mes aporta sus 140h: una sola tasa promedio para todo el rango
    desviaría el total de los meses con más o menos días hábiles."""
    base = business_base_for_range(date(2026, 9, 1), date(2026, 11, 30))

    assert base["base_hours"] == 420.0


def test_los_limites_del_semaforo_siguen_siendo_umbrales_por_dia():
    """Los 3 límites externos (low/high/overload) los configura el negocio POR
    DÍA y no forman parte de la regla mensual — pero el orden del semáforo
    tiene que seguir siendo válido con la base en 140h."""
    base = business_base_for_range(date(2026, 9, 1), date(2026, 9, 30))

    assert base["limit_low_hours"] < base["base_hours"] < base["limit_high_hours"]
    assert base["limit_high_hours"] < base["limit_overload_hours"]


def test_la_tasa_expuesta_reconstruye_la_base_dia_a_dia():
    """`expected_hours_per_day` es lo que usan los cálculos que rearman la base
    día por día (estados especiales, ingresos a mitad de mes) — si no coincide
    con la base del rango, esas personas quedan medidas con otra regla."""
    base = business_base_for_range(date(2026, 9, 1), date(2026, 9, 30))

    reconstruida = base["expected_hours_per_day"] * base["business_days"]

    assert reconstruida == pytest.approx(140.0, abs=0.05)


def test_un_rango_sin_dias_habiles_no_divide_por_cero():
    sabado_domingo = business_base_for_range(date(2026, 9, 5), date(2026, 9, 6))

    assert sabado_domingo["business_days"] == 0
    assert sabado_domingo["base_hours"] == 0
    assert sabado_domingo["expected_hours_per_day"] == 0


def test_la_configuracion_del_mes_no_es_retroactiva(actor):
    """Mismo criterio que el resto del catálogo: el valor vigente al INICIO del
    período es el que rige, así un cambio de hoy no reescribe meses cerrados."""
    set_config_value(CONFIG_KEY_HORAS_ESPERADAS_MES, "160", actor)

    pasado = business_base_for_range(date(2020, 3, 1), date(2020, 3, 31))

    assert pasado["base_hours"] == 140.0
    assert (
        expected_hours_per_day_for_month(2020, 3)
        == 140.0 / business_base_for_range(date(2020, 3, 1), date(2020, 3, 31))["business_days"]
    )
    assert datetime(2020, 3, 1, tzinfo=dt_timezone.utc) < datetime.now(dt_timezone.utc)
