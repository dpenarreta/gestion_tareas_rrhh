"""Cobertura de la porción mínima de Feriados/Configuración portada para
el Motor de Cierre Inteligente (Fase 3d, ver docs/AUDIT_LOG.md §
2026-08-07)."""

from datetime import date, datetime
from datetime import timezone as dt_timezone

import pytest

from apps.configuration.models import Holiday, SystemConfigHistory
from apps.configuration.services import (
    CONFIG_KEY_DESK_NOTE_MAX_REPLIES,
    CONFIG_KEY_HORAS_EFECTIVAS,
    CONFIG_KEY_PASSWORD_MIN_LENGTH,
    CONFIG_KEY_SESSION_DURATION_DEFAULT_HOURS,
    CONFIG_KEY_SESSION_DURATION_REMEMBER_HOURS,
    DEFAULT_DESK_NOTE_MAX_REPLIES,
    DEFAULT_HORAS_EFECTIVAS,
    DEFAULT_SESSION_DURATION_DEFAULT_HOURS,
    DEFAULT_SESSION_DURATION_REMEMBER_HOURS,
    business_base_for_range,
    count_business_days,
    get_effective_config_value,
    get_effective_desk_note_max_replies,
    get_effective_password_min_length,
    get_effective_session_duration_default_hours,
    get_effective_session_duration_remember_hours,
    get_holiday_set,
    is_working_day,
    set_config_value,
)
from apps.users.models import User

pytestmark = pytest.mark.django_db


@pytest.fixture
def actor():
    return User.objects.create_user(username="admin", email="admin@example.com", password="Sup3r-Secr3t!")


def test_returns_fallback_when_no_history(actor):
    value = get_effective_config_value("NUNCA_CONFIGURADO", datetime.now(dt_timezone.utc), 42.0)
    assert value == 42.0


def test_set_config_value_then_read_reflects_new_value(actor):
    set_config_value(CONFIG_KEY_HORAS_EFECTIVAS, "7.0", actor)
    value = get_effective_config_value(CONFIG_KEY_HORAS_EFECTIVAS, datetime.now(dt_timezone.utc), DEFAULT_HORAS_EFECTIVAS)
    assert value == 7.0


def test_effective_value_is_never_retroactive(actor):
    past = datetime(2020, 1, 1, tzinfo=dt_timezone.utc)
    set_config_value(CONFIG_KEY_HORAS_EFECTIVAS, "7.0", actor)
    value_in_the_past = get_effective_config_value(CONFIG_KEY_HORAS_EFECTIVAS, past, DEFAULT_HORAS_EFECTIVAS)
    assert value_in_the_past == DEFAULT_HORAS_EFECTIVAS


def test_set_config_value_closes_previous_open_record(actor):
    set_config_value(CONFIG_KEY_HORAS_EFECTIVAS, "6.0", actor)
    set_config_value(CONFIG_KEY_HORAS_EFECTIVAS, "7.5", actor)
    from apps.configuration.models import SystemConfigHistory

    closed = SystemConfigHistory.objects.get(key=CONFIG_KEY_HORAS_EFECTIVAS, value="6.0")
    open_record = SystemConfigHistory.objects.get(key=CONFIG_KEY_HORAS_EFECTIVAS, value="7.5")
    assert closed.valid_until is not None
    assert open_record.valid_until is None


def test_holiday_excluded_from_working_days():
    Holiday.objects.create(date=date(2026, 1, 1), name="Año Nuevo", year=2026)
    holidays = get_holiday_set()
    assert not is_working_day(date(2026, 1, 1), holidays)  # feriado (jueves)
    assert is_working_day(date(2026, 1, 2), holidays)  # viernes normal


def test_weekend_excluded_from_business_days():
    holidays: set = set()
    # 2026-01-03 sábado, 2026-01-04 domingo
    assert not is_working_day(date(2026, 1, 3), holidays)
    assert not is_working_day(date(2026, 1, 4), holidays)


def test_count_business_days_full_week():
    # 2026-01-05 (lun) .. 2026-01-11 (dom) -> 5 días hábiles
    count = count_business_days(date(2026, 1, 5), date(2026, 1, 11), set())
    assert count == 5


def test_session_duration_default_hours_falls_back_to_default():
    value = get_effective_session_duration_default_hours(datetime.now(dt_timezone.utc))
    assert value == DEFAULT_SESSION_DURATION_DEFAULT_HOURS


def test_session_duration_remember_hours_falls_back_to_default():
    value = get_effective_session_duration_remember_hours(datetime.now(dt_timezone.utc))
    assert value == DEFAULT_SESSION_DURATION_REMEMBER_HOURS


def test_session_duration_hours_reflect_configured_value(actor):
    set_config_value(CONFIG_KEY_SESSION_DURATION_DEFAULT_HOURS, "24", actor)
    set_config_value(CONFIG_KEY_SESSION_DURATION_REMEMBER_HOURS, "48", actor)
    assert get_effective_session_duration_default_hours(datetime.now(dt_timezone.utc)) == 24
    assert get_effective_session_duration_remember_hours(datetime.now(dt_timezone.utc)) == 48


def test_desk_note_max_replies_falls_back_to_default():
    value = get_effective_desk_note_max_replies(datetime.now(dt_timezone.utc))
    assert value == DEFAULT_DESK_NOTE_MAX_REPLIES


def test_desk_note_max_replies_reflects_configured_value(actor):
    set_config_value(CONFIG_KEY_DESK_NOTE_MAX_REPLIES, "5", actor)
    assert get_effective_desk_note_max_replies(datetime.now(dt_timezone.utc)) == 5


def test_password_min_length_clamps_stale_value_below_the_django_floor(actor):
    """Fase 75 (ver docs/AUDIT_LOG.md § 2026-08-26): una fila guardada antes
    de esa fase con un valor menor a 10 no debe seguir mostrándose como el
    mínimo efectivo — `SeguridadConfigUpdateSerializer` ya rechaza guardar
    valores nuevos por debajo de 10, pero una fila histórica sigue siendo
    válida ante `get_effective_config_value` hasta que alguien la
    sobrescriba; el clamp en la LECTURA cierra ese gap sin migrar datos."""
    SystemConfigHistory.objects.create(
        key=CONFIG_KEY_PASSWORD_MIN_LENGTH, value="6",
        valid_from=datetime(2020, 1, 1, tzinfo=dt_timezone.utc), updated_by=actor,
    )
    assert get_effective_password_min_length(datetime.now(dt_timezone.utc)) == 10


def test_password_min_length_reflects_configured_value_at_or_above_the_floor(actor):
    set_config_value(CONFIG_KEY_PASSWORD_MIN_LENGTH, "12", actor)
    assert get_effective_password_min_length(datetime.now(dt_timezone.utc)) == 12


def test_business_base_for_range_uses_effective_hours_at_period_start(actor):
    # `valid_from` bien anterior al rango consultado (2026-01) — sin esto,
    # "8.0" no estaría vigente para esas fechas (nunca retroactivo, ver
    # test_effective_value_is_never_retroactive) y caería al default.
    SystemConfigHistory.objects.create(
        key=CONFIG_KEY_HORAS_EFECTIVAS, value="8.0",
        valid_from=datetime(2020, 1, 1, tzinfo=dt_timezone.utc), updated_by=actor,
    )
    result = business_base_for_range(date(2026, 1, 5), date(2026, 1, 9))  # 1 semana hábil
    assert result["business_days"] == 5
    assert result["hours_per_day"] == 8.0
    assert result["base_hours"] == 40.0
