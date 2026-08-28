"""Cobertura de apps.reports.member_kpis — Fases 64/65 de la migración
de stack (ver docs/AUDIT_LOG.md § 2026-08-25). Sub-fases 1 y 2 del port
del motor de CÁLCULO de Reportes Ejecutivos: solo las primitivas nuevas
+ los assemblers mensual/rango-personalizado, sin ningún endpoint HTTP
todavía (ver docstring del módulo)."""

from datetime import date, datetime, timedelta
from datetime import timezone as dt_timezone

import pytest

from apps.reports.member_kpis import (
    _local_month_bounds,
    _ts_local_period_end_date,
    as_of_fecha_corte,
    compute_custom_range_member_kpis,
    compute_effective_member_bases,
    compute_monthly_member_kpis,
    compute_principal_hallazgo,
    compute_range_member_kpis,
    derive_estado_operativo,
    resolve_closure_cutoff,
)
from apps.tasks.business_time import business_day_real_range
from apps.tasks.models import MonthClosure, Task, TaskActivity
from apps.users.models import User

pytestmark = pytest.mark.django_db

YEAR, MONTH = 2026, 3


@pytest.fixture
def user():
    return User.objects.create_user(username="target", email="target@example.com", password="Sup3r-Secr3t!")


def _task(user, *, status, end_date, completed_at=None, estimated_hours=5, real_hours=0.0, progress=0, type_="FIJA"):
    return Task.objects.create(
        title="T", priority="MEDIA", frequency="PUNTUAL", type=type_,
        start_date=datetime(YEAR, MONTH, 1, tzinfo=dt_timezone.utc), end_date=end_date,
        estimated_hours=estimated_hours, real_hours=real_hours, progress=progress,
        assigned_to=user, created_by=user, status=status, completed_at=completed_at,
    )


# --- as_of_fecha_corte -------------------------------------------------------


def _unsaved_task(*, status, completed_at):
    # Instancia de `Task` SIN guardar — `as_of_fecha_corte` recibe/devuelve
    # instancias reales (no dicts), mismo contrato que el resto de
    # `apps.analytics` (`is_task_overdue`/`compute_completed_pct_any`
    # esperan atributos). No hace falta persistirla para probar la
    # función pura.
    return Task(status=status, completed_at=completed_at)


def test_as_of_fecha_corte_reverts_task_completed_after_cutoff():
    cutoff = datetime(2026, 3, 15, tzinfo=dt_timezone.utc)
    tasks = [_unsaved_task(status="COMPLETADA", completed_at=datetime(2026, 3, 20, tzinfo=dt_timezone.utc))]
    result = as_of_fecha_corte(tasks, cutoff)
    assert result[0].status == "PENDIENTE"


def test_as_of_fecha_corte_keeps_task_completed_before_cutoff():
    cutoff = datetime(2026, 3, 15, tzinfo=dt_timezone.utc)
    tasks = [_unsaved_task(status="COMPLETADA", completed_at=datetime(2026, 3, 10, tzinfo=dt_timezone.utc))]
    result = as_of_fecha_corte(tasks, cutoff)
    assert result[0].status == "COMPLETADA"


def test_as_of_fecha_corte_ignores_tasks_without_completed_at():
    cutoff = datetime(2026, 3, 15, tzinfo=dt_timezone.utc)
    tasks = [_unsaved_task(status="PENDIENTE", completed_at=None)]
    result = as_of_fecha_corte(tasks, cutoff)
    assert result[0].status == "PENDIENTE"


def test_as_of_fecha_corte_does_not_mutate_original_instance():
    cutoff = datetime(2026, 3, 15, tzinfo=dt_timezone.utc)
    original = _unsaved_task(status="COMPLETADA", completed_at=datetime(2026, 3, 20, tzinfo=dt_timezone.utc))
    tasks = [original]
    as_of_fecha_corte(tasks, cutoff)
    assert original.status == "COMPLETADA"


# --- resolve_closure_cutoff ---------------------------------------------------


def test_resolve_closure_cutoff_explicit_wins_over_closure():
    now = datetime(2026, 3, 25, tzinfo=dt_timezone.utc)
    explicit = datetime(2026, 3, 10, tzinfo=dt_timezone.utc)
    cutoff = resolve_closure_cutoff(YEAR, MONTH, explicit, now, now)
    assert cutoff == explicit


def test_resolve_closure_cutoff_uses_closure_cutoff_date_when_present(user):
    MonthClosure.objects.create(
        month=MONTH, year=YEAR, closed_by=user,
        cutoff_date=datetime(YEAR, MONTH, 20, tzinfo=dt_timezone.utc), closure_type="EARLY",
        calendar_days_total=31, calendar_days_considered=20, working_days_considered=14,
        working_hours_considered=91.0, total_tasks=0, completed_tasks=0, summary={},
    )
    now = datetime(2026, 3, 25, tzinfo=dt_timezone.utc)
    fallback = datetime(2026, 3, 31, 23, 59, 59, tzinfo=dt_timezone.utc)
    cutoff = resolve_closure_cutoff(YEAR, MONTH, None, fallback, now)
    # Instante real de fin del día de negocio 20 (huso desplazado
    # BUSINESS_TZ_OFFSET_HOURS, ver business_day_real_range) — no medianoche
    # UTC del día 20, mismo criterio que el resto del motor.
    _, expected = business_day_real_range(date(2026, 3, 20))
    assert cutoff == expected


def test_resolve_closure_cutoff_falls_back_when_no_closure():
    now = datetime(2026, 3, 15, tzinfo=dt_timezone.utc)
    fallback = datetime(2026, 3, 31, 23, 59, 59, tzinfo=dt_timezone.utc)
    cutoff = resolve_closure_cutoff(YEAR, MONTH, None, fallback, now)
    # `now` es anterior al fallback → gana `now` (mismo criterio "lo que sea antes").
    assert cutoff == now


# --- compute_effective_member_bases ------------------------------------------


def test_effective_member_bases_no_history_clamps_to_period_start(user):
    # `created_at` (única señal disponible sin tareas/actividades) se
    # backdatea antes del período — de otro modo el usuario recién creado
    # por la fixture (con `created_at` = "ahora" real) siempre daría
    # `was_prorated=True` para un período fijado en el pasado (2026-03).
    User.objects.filter(id=user.id).update(created_at=datetime(2020, 1, 1, tzinfo=dt_timezone.utc))
    user.refresh_from_db()
    period_start, period_end = date(YEAR, MONTH, 1), date(YEAR, MONTH, 31)
    now = datetime(YEAR, MONTH, 31, tzinfo=dt_timezone.utc)
    result = compute_effective_member_bases([user], period_start, period_end, 6.5, 5.5, 7.5, 8.5, now=now)
    assert result[user.id]["was_prorated"] is False
    assert result[user.id]["base_hours"] > 0


def test_effective_member_bases_prorates_mid_period_join(user):
    # `created_at` del usuario es la única señal disponible en este test —
    # se fija a mitad del período para forzar el prorrateo.
    User.objects.filter(id=user.id).update(created_at=datetime(YEAR, MONTH, 15, tzinfo=dt_timezone.utc))
    user.refresh_from_db()
    period_start, period_end = date(YEAR, MONTH, 1), date(YEAR, MONTH, 31)
    now = datetime(YEAR, MONTH, 31, tzinfo=dt_timezone.utc)
    result = compute_effective_member_bases([user], period_start, period_end, 6.5, 5.5, 7.5, 8.5, now=now)
    assert result[user.id]["was_prorated"] is True
    assert result[user.id]["effective_start"].date() == date(YEAR, MONTH, 15)


def test_effective_member_bases_all_zero_when_joined_after_period(user):
    User.objects.filter(id=user.id).update(created_at=datetime(YEAR, MONTH + 1, 5, tzinfo=dt_timezone.utc))
    user.refresh_from_db()
    period_start, period_end = date(YEAR, MONTH, 1), date(YEAR, MONTH, 31)
    now = datetime(YEAR, MONTH + 1, 5, tzinfo=dt_timezone.utc)
    result = compute_effective_member_bases([user], period_start, period_end, 6.5, 5.5, 7.5, 8.5, now=now)
    assert result[user.id]["was_prorated"] is True
    assert result[user.id]["base_hours"] == 0.0


def test_effective_member_bases_empty_users_returns_empty_dict():
    assert compute_effective_member_bases([], date(YEAR, MONTH, 1), date(YEAR, MONTH, 31), 6.5, 5.5, 7.5, 8.5, now=datetime.now(dt_timezone.utc)) == {}


# --- compute_monthly_member_kpis (assembler, integración) --------------------


def test_compute_monthly_member_kpis_basic_score_and_completion(user):
    _task(user, status="COMPLETADA", end_date=datetime(YEAR, MONTH, 10, tzinfo=dt_timezone.utc), completed_at=datetime(YEAR, MONTH, 10, tzinfo=dt_timezone.utc), real_hours=5, estimated_hours=5)
    _task(user, status="PENDIENTE", end_date=datetime(YEAR, MONTH, 20, tzinfo=dt_timezone.utc), estimated_hours=3)

    now = datetime(YEAR, MONTH, 31, 23, 0, tzinfo=dt_timezone.utc)
    result = compute_monthly_member_kpis(user_ids=[user.id], year=YEAR, month=MONTH, now=now)

    member = result[user.id]
    assert member["total_tasks"] == 2
    assert member["completed_tasks"] == 1
    assert member["completed_pct"] == 50
    assert 0 <= member["score"] <= 100


def test_compute_monthly_member_kpis_respects_fecha_corte(user):
    """Una tarea completada DESPUÉS de la fecha de corte cuenta como
    pendiente para este snapshot — réplica del comportamiento de
    `asOfFechaCorte` end-to-end a través del assembler."""
    _task(
        user, status="COMPLETADA",
        end_date=datetime(YEAR, MONTH, 25, tzinfo=dt_timezone.utc),
        completed_at=datetime(YEAR, MONTH, 25, tzinfo=dt_timezone.utc),
        real_hours=5, estimated_hours=5,
    )
    now = datetime(YEAR, MONTH, 31, 23, 0, tzinfo=dt_timezone.utc)
    fecha_corte = datetime(YEAR, MONTH, 20, tzinfo=dt_timezone.utc)

    result = compute_monthly_member_kpis(user_ids=[user.id], year=YEAR, month=MONTH, explicit_fecha_corte=fecha_corte, now=now)

    member = result[user.id]
    assert member["completed_tasks"] == 0
    assert member["completed_pct"] == 0


def test_compute_monthly_member_kpis_counts_seguimiento_activities_by_reason(user):
    task = _task(user, status="EN_PROGRESO", end_date=datetime(YEAR, MONTH, 20, tzinfo=dt_timezone.utc), type_="SEGUIMIENTO")
    a1 = TaskActivity.objects.create(task=task, author=user, reason="REUNION", duration=60, description="")
    a2 = TaskActivity.objects.create(task=task, author=user, reason="REUNION", duration=30, description="")
    # `created_at` es `auto_now_add` (se fija a "ahora" real, no al mes de
    # prueba) — se retrocede a mano para que caiga dentro de la ventana
    # [start, dataUpperBound] que consulta el assembler para el período 2026-03.
    TaskActivity.objects.filter(id__in=[a1.id, a2.id]).update(created_at=datetime(YEAR, MONTH, 12, tzinfo=dt_timezone.utc))

    now = datetime(YEAR, MONTH, 31, 23, 0, tzinfo=dt_timezone.utc)
    result = compute_monthly_member_kpis(user_ids=[user.id], year=YEAR, month=MONTH, now=now)

    member = result[user.id]
    assert member["seguimiento_total"] == 2
    assert member["by_reason"] == [{"reason": "REUNION", "count": 2, "total_minutes": 90}]


def test_compute_monthly_member_kpis_empty_roster_returns_empty_dict():
    now = datetime(YEAR, MONTH, 31, tzinfo=dt_timezone.utc)
    assert compute_monthly_member_kpis(user_ids=[], year=YEAR, month=MONTH, now=now) == {}


def test_compute_monthly_member_kpis_no_tasks_gives_zeroed_member(user):
    now = datetime(YEAR, MONTH, 31, tzinfo=dt_timezone.utc)
    result = compute_monthly_member_kpis(user_ids=[user.id], year=YEAR, month=MONTH, now=now)
    member = result[user.id]
    assert member["total_tasks"] == 0
    assert member["completed_tasks"] == 0
    assert member["completed_pct"] == 0
    assert member["by_reason"] == []


# --- derive_estado_operativo --------------------------------------------------


def test_derive_estado_operativo_uses_equilibrio_score_when_present():
    result = derive_estado_operativo(completed_pct=10, carga_label="Sobrecarga", overdue_count=5, equilibrio_score=95)
    # Con `equilibrio_score` explícito, ignora por completo la aproximación
    # basada en completedPct/cargaLabel/overdueCount.
    assert result["estado"] == "Equilibrio Óptimo"


def test_derive_estado_operativo_approximates_from_completed_pct_and_carga():
    result = derive_estado_operativo(completed_pct=100, carga_label="Óptimo", overdue_count=0)
    assert result["estado"] == "Equilibrio Óptimo"


def test_derive_estado_operativo_penalizes_overdue_tasks():
    # approxScore = round(completedPct*0.5 + cargaLabelScore*0.5 - penalty).
    # Sin vencidas: round(70*0.5 + 80*0.5 - 0) = 75 → tier "Equilibrio Estable"
    # (75 es el mínimo de ese tier). Con 3 vencidas: penalidad tope
    # min(30, 3*10) = 30 → round(75 - 30) = 45 → tier "Riesgo Operativo"
    # (40-59) — 2 tiers más abajo, confirma que la penalidad SÍ mueve la
    # clasificación, no solo el score interno.
    sin_vencidas = derive_estado_operativo(completed_pct=70, carga_label="Moderado", overdue_count=0)
    con_vencidas = derive_estado_operativo(completed_pct=70, carga_label="Moderado", overdue_count=3)
    assert sin_vencidas["estado"] == "Equilibrio Estable"
    assert con_vencidas["estado"] == "Riesgo Operativo"


# --- compute_principal_hallazgo -----------------------------------------------


def test_compute_principal_hallazgo_no_tasks_returns_sin_datos():
    assert compute_principal_hallazgo(carga_label="Óptimo", completed_pct=0, overdue_count=0, total_tasks=0) == "Sin actividad registrada"


def test_compute_principal_hallazgo_sobrecarga_takes_priority_over_overdue():
    result = compute_principal_hallazgo(carga_label="Sobrecarga", completed_pct=50, overdue_count=2, total_tasks=5)
    assert result == "Sobrecarga"


def test_compute_principal_hallazgo_overdue_when_no_carga_issue():
    result = compute_principal_hallazgo(carga_label="Óptimo", completed_pct=50, overdue_count=1, total_tasks=5)
    assert result == "Retrasos recurrentes"


def test_compute_principal_hallazgo_high_completion_no_issues():
    result = compute_principal_hallazgo(carga_label="Óptimo", completed_pct=85, overdue_count=0, total_tasks=5)
    assert result == "Sin tareas vencidas"


def test_compute_principal_hallazgo_default_carga_equilibrada():
    result = compute_principal_hallazgo(carga_label="Óptimo", completed_pct=50, overdue_count=0, total_tasks=5)
    assert result == "Carga equilibrada"


# --- compute_custom_range_member_kpis (assembler, integración) ---------------


def test_custom_range_member_kpis_basic_score_and_completion(user):
    User.objects.filter(id=user.id).update(created_at=datetime(2020, 1, 1, tzinfo=dt_timezone.utc))
    user.refresh_from_db()
    _task(user, status="COMPLETADA", end_date=datetime(2026, 3, 20, tzinfo=dt_timezone.utc), completed_at=datetime(2026, 3, 20, tzinfo=dt_timezone.utc), real_hours=5, estimated_hours=5)
    _task(user, status="PENDIENTE", end_date=datetime(2026, 4, 5, tzinfo=dt_timezone.utc), estimated_hours=3)

    period_start = datetime(2026, 3, 15, tzinfo=dt_timezone.utc)
    period_end = datetime(2026, 4, 15, 23, 59, 59, tzinfo=dt_timezone.utc)
    now = datetime(2026, 4, 20, tzinfo=dt_timezone.utc)

    result = compute_custom_range_member_kpis(user_ids=[user.id], period_start=period_start, period_end=period_end, now=now)

    member = result[user.id]
    assert member["total_tasks"] == 2
    assert member["completed_tasks"] == 1
    assert member["completed_pct"] == 50
    assert 0 <= member["score"] <= 100
    assert member["estado_operativo"]["estado"]
    assert member["principal_hallazgo"]


def test_custom_range_member_kpis_respects_fecha_corte(user):
    User.objects.filter(id=user.id).update(created_at=datetime(2020, 1, 1, tzinfo=dt_timezone.utc))
    user.refresh_from_db()
    _task(user, status="COMPLETADA", end_date=datetime(2026, 4, 1, tzinfo=dt_timezone.utc), completed_at=datetime(2026, 4, 1, tzinfo=dt_timezone.utc), real_hours=5, estimated_hours=5)

    period_start = datetime(2026, 3, 15, tzinfo=dt_timezone.utc)
    period_end = datetime(2026, 4, 15, 23, 59, 59, tzinfo=dt_timezone.utc)
    now = datetime(2026, 4, 20, tzinfo=dt_timezone.utc)
    fecha_corte = datetime(2026, 3, 25, tzinfo=dt_timezone.utc)

    result = compute_custom_range_member_kpis(
        user_ids=[user.id], period_start=period_start, period_end=period_end, explicit_fecha_corte=fecha_corte, now=now
    )

    member = result[user.id]
    assert member["completed_tasks"] == 0
    assert member["completed_pct"] == 0


def test_custom_range_member_kpis_counts_seguimiento_activities_by_reason(user):
    User.objects.filter(id=user.id).update(created_at=datetime(2020, 1, 1, tzinfo=dt_timezone.utc))
    user.refresh_from_db()
    task = _task(user, status="EN_PROGRESO", end_date=datetime(2026, 4, 1, tzinfo=dt_timezone.utc), type_="SEGUIMIENTO")
    a1 = TaskActivity.objects.create(task=task, author=user, reason="CAPACITACION", duration=45, description="")
    a2 = TaskActivity.objects.create(task=task, author=user, reason="CAPACITACION", duration=15, description="")
    TaskActivity.objects.filter(id__in=[a1.id, a2.id]).update(created_at=datetime(2026, 3, 20, tzinfo=dt_timezone.utc))

    period_start = datetime(2026, 3, 15, tzinfo=dt_timezone.utc)
    period_end = datetime(2026, 4, 15, 23, 59, 59, tzinfo=dt_timezone.utc)
    now = datetime(2026, 4, 20, tzinfo=dt_timezone.utc)

    result = compute_custom_range_member_kpis(user_ids=[user.id], period_start=period_start, period_end=period_end, now=now)

    member = result[user.id]
    assert member["seguimiento_total"] == 2
    assert member["by_reason"] == [{"reason": "CAPACITACION", "count": 2, "total_minutes": 60}]


def test_custom_range_member_kpis_empty_roster_returns_empty_dict():
    period_start = datetime(2026, 3, 15, tzinfo=dt_timezone.utc)
    period_end = datetime(2026, 4, 15, 23, 59, 59, tzinfo=dt_timezone.utc)
    now = datetime(2026, 4, 20, tzinfo=dt_timezone.utc)
    assert compute_custom_range_member_kpis(user_ids=[], period_start=period_start, period_end=period_end, now=now) == {}


def test_custom_range_member_kpis_no_tasks_gives_zeroed_member(user):
    User.objects.filter(id=user.id).update(created_at=datetime(2020, 1, 1, tzinfo=dt_timezone.utc))
    user.refresh_from_db()
    period_start = datetime(2026, 3, 15, tzinfo=dt_timezone.utc)
    period_end = datetime(2026, 4, 15, 23, 59, 59, tzinfo=dt_timezone.utc)
    now = datetime(2026, 4, 20, tzinfo=dt_timezone.utc)

    result = compute_custom_range_member_kpis(user_ids=[user.id], period_start=period_start, period_end=period_end, now=now)

    member = result[user.id]
    assert member["total_tasks"] == 0
    assert member["completed_tasks"] == 0
    assert member["completed_pct"] == 0
    assert member["by_reason"] == []
    assert member["principal_hallazgo"] == "Sin actividad registrada"


def test_custom_range_member_kpis_spans_multiple_calendar_months_and_prorates_mid_range_join(user):
    # El rango cruza marzo→abril (NO es un mes calendario) — a diferencia del
    # builder mensual, acá `compute_effective_member_bases` prorratea contra
    # los límites del RANGO completo, no de un mes. `created_at` cae a mitad
    # del rango para forzar el prorrateo.
    User.objects.filter(id=user.id).update(created_at=datetime(2026, 3, 25, tzinfo=dt_timezone.utc))
    user.refresh_from_db()

    period_start = datetime(2026, 3, 15, tzinfo=dt_timezone.utc)
    period_end = datetime(2026, 4, 15, 23, 59, 59, tzinfo=dt_timezone.utc)
    now = datetime(2026, 4, 20, tzinfo=dt_timezone.utc)

    result = compute_custom_range_member_kpis(user_ids=[user.id], period_start=period_start, period_end=period_end, now=now)

    member = result[user.id]
    assert member["base_was_prorated"] is True
    assert member["base_effective_start"] is not None
    assert date.fromisoformat(member["base_effective_start"][:10]) == date(2026, 3, 25)


# --- compute_range_member_kpis (assembler, integración) -----------------------


def test_range_member_kpis_basic_two_months(user):
    User.objects.filter(id=user.id).update(created_at=datetime(2020, 1, 1, tzinfo=dt_timezone.utc))
    user.refresh_from_db()
    _task(user, status="COMPLETADA", end_date=datetime(2026, 2, 10, tzinfo=dt_timezone.utc), completed_at=datetime(2026, 2, 10, tzinfo=dt_timezone.utc), real_hours=5, estimated_hours=5)
    _task(user, status="PENDIENTE", end_date=datetime(2026, 3, 15, tzinfo=dt_timezone.utc), estimated_hours=3)

    now = datetime(2026, 3, 31, 23, 0, tzinfo=dt_timezone.utc)
    result = compute_range_member_kpis(user_ids=[user.id], from_year=2026, from_month=2, to_year=2026, to_month=3, now=now)

    assert [ms["month"] for ms in result["month_snapshots"]] == ["2026-02", "2026-03"]
    feb, mar = result["month_snapshots"]
    assert feb["member_snapshots"][user.id]["total_tasks"] == 1
    assert feb["member_snapshots"][user.id]["completed_pct"] == 100
    assert mar["member_snapshots"][user.id]["total_tasks"] == 1
    assert mar["member_snapshots"][user.id]["completed_pct"] == 0

    member = result["aggregated_members"][user.id]
    assert member["total_tasks"] == 2
    assert member["completed_tasks"] == 1
    # Promedio de los 2 meses activos (1 tarea cada uno): (100 + 0) / 2 = 50.
    assert member["completed_pct"] == 50


def test_range_member_kpis_respects_fecha_corte(user):
    User.objects.filter(id=user.id).update(created_at=datetime(2020, 1, 1, tzinfo=dt_timezone.utc))
    user.refresh_from_db()
    _task(
        user, status="COMPLETADA",
        end_date=datetime(2026, 3, 25, tzinfo=dt_timezone.utc),
        completed_at=datetime(2026, 3, 25, tzinfo=dt_timezone.utc),
        real_hours=5, estimated_hours=5,
    )

    now = datetime(2026, 3, 31, 23, 0, tzinfo=dt_timezone.utc)
    fecha_corte = datetime(2026, 3, 20, tzinfo=dt_timezone.utc)
    result = compute_range_member_kpis(
        user_ids=[user.id], from_year=2026, from_month=3, to_year=2026, to_month=3, explicit_fecha_corte=fecha_corte, now=now
    )

    member = result["aggregated_members"][user.id]
    assert member["completed_tasks"] == 0
    assert member["completed_pct"] == 0


def test_range_member_kpis_averages_only_active_months(user):
    User.objects.filter(id=user.id).update(created_at=datetime(2020, 1, 1, tzinfo=dt_timezone.utc))
    user.refresh_from_db()
    # Única tarea en marzo — enero/febrero quedan sin tareas ("meses inactivos").
    _task(user, status="COMPLETADA", end_date=datetime(2026, 3, 10, tzinfo=dt_timezone.utc), completed_at=datetime(2026, 3, 10, tzinfo=dt_timezone.utc), real_hours=5, estimated_hours=5)

    now = datetime(2026, 3, 31, 23, 0, tzinfo=dt_timezone.utc)
    result = compute_range_member_kpis(user_ids=[user.id], from_year=2026, from_month=1, to_year=2026, to_month=3, now=now)

    assert len(result["month_snapshots"]) == 3
    jan, feb, mar = result["month_snapshots"]
    assert jan["member_snapshots"][user.id]["total_tasks"] == 0
    assert feb["member_snapshots"][user.id]["total_tasks"] == 0
    assert mar["member_snapshots"][user.id]["total_tasks"] == 1

    member = result["aggregated_members"][user.id]
    # Promedio SOLO de marzo (único mes activo) — 100%, no se diluye por
    # enero/febrero sin actividad.
    assert member["completed_pct"] == 100


def test_range_member_kpis_empty_roster_returns_empty_dict():
    now = datetime(2026, 3, 31, tzinfo=dt_timezone.utc)
    result = compute_range_member_kpis(user_ids=[], from_year=2026, from_month=1, to_year=2026, to_month=3, now=now)
    assert result == {"month_snapshots": [], "aggregated_members": {}}


def test_range_member_kpis_no_tasks_gives_zeroed_aggregate(user):
    User.objects.filter(id=user.id).update(created_at=datetime(2020, 1, 1, tzinfo=dt_timezone.utc))
    user.refresh_from_db()
    now = datetime(2026, 3, 31, tzinfo=dt_timezone.utc)
    result = compute_range_member_kpis(user_ids=[user.id], from_year=2026, from_month=2, to_year=2026, to_month=3, now=now)

    member = result["aggregated_members"][user.id]
    assert member["total_tasks"] == 0
    assert member["completed_tasks"] == 0
    assert member["completed_pct"] == 0
    assert member["by_reason"] == []
    assert member["principal_hallazgo"] == "Sin actividad registrada"


def test_range_member_kpis_month_snapshot_labels(user):
    now = datetime(2026, 3, 31, tzinfo=dt_timezone.utc)
    result = compute_range_member_kpis(user_ids=[user.id], from_year=2026, from_month=2, to_year=2026, to_month=3, now=now)
    assert result["month_snapshots"][0]["month"] == "2026-02"
    assert result["month_snapshots"][0]["label"] == "febrero de 2026"
    assert result["month_snapshots"][1]["month"] == "2026-03"
    assert result["month_snapshots"][1]["label"] == "marzo de 2026"


# --- Fase 71 — _local_month_bounds / _ts_local_period_end_date ---------------
# Hallazgo real, verificado con datos sintéticos en ambos lados (Postgres +
# Django) contra `buildSnapshotData.ts` (ver docs/AUDIT_LOG.md § 2026-08-26):
# `monthBounds()` de TS construye sus límites en hora LOCAL del negocio
# (`America/Guayaquil`, UTC-5 en producción), no UTC puro — y RANGO_MESES es
# el único builder que pasa ese resultado directamente a consultas de
# tareas/actividades y al prorrateo de base horaria.


def test_local_month_bounds_shifts_by_business_tz_offset():
    start, end = _local_month_bounds(2025, 11)
    assert start == datetime(2025, 11, 1, 5, tzinfo=dt_timezone.utc)
    assert end == datetime(2025, 12, 1, 5, tzinfo=dt_timezone.utc) - timedelta(microseconds=1)


def test_ts_local_period_end_date_adds_extra_day_when_clamped_start_time_of_day_fits():
    # Caso real verificado: clamped_start = 2025-11-10T00:00:00Z (hora del
    # día 00:00, cae dentro de la ventana de desplazamiento de 5h) — el loop
    # de 24h de TS termina incluyendo el 1 de diciembre (lunes hábil).
    _, period_end = _local_month_bounds(2025, 11)
    clamped_start = datetime(2025, 11, 10, tzinfo=dt_timezone.utc)
    assert _ts_local_period_end_date(clamped_start, period_end) == date(2025, 12, 1)


def test_ts_local_period_end_date_no_extra_day_when_clamped_start_at_business_offset():
    # clamped_start = el propio period_start (hora del día = exactamente el
    # offset del negocio, 05:00) — colaborador SIN prorrateo real. El día
    # extra NO se agrega (mismo caso que un colaborador con historial
    # completo, verificado sin discrepancia para MENSUAL/RANGO_PERSONALIZADO).
    period_start, period_end = _local_month_bounds(2025, 11)
    assert _ts_local_period_end_date(period_start, period_end) == date(2025, 11, 30)


def test_ts_local_period_end_date_empty_range_returns_clamped_start_date():
    period_start, _ = _local_month_bounds(2025, 11)
    clamped_start = period_start + timedelta(days=365)
    period_end = period_start
    assert _ts_local_period_end_date(clamped_start, period_end) == clamped_start.date()


# --- Fase 71 — compute_range_member_kpis replica el desplazamiento local ----


def test_range_member_kpis_excludes_task_before_local_month_start(user):
    User.objects.filter(id=user.id).update(created_at=datetime(2020, 1, 1, tzinfo=dt_timezone.utc))
    user.refresh_from_db()
    # 2025-09-01T02:00:00Z cae DENTRO del mes calendario UTC de septiembre,
    # pero ANTES de _local_month_bounds(2025, 9).start (05:00 UTC) — TS lo
    # excluye del rango, aunque un chequeo UTC-puro lo incluiría.
    _task(user, status="COMPLETADA", end_date=datetime(2025, 9, 1, 2, tzinfo=dt_timezone.utc), completed_at=datetime(2025, 9, 1, 2, tzinfo=dt_timezone.utc), real_hours=1, estimated_hours=1)
    _task(user, status="COMPLETADA", end_date=datetime(2025, 9, 15, 12, tzinfo=dt_timezone.utc), completed_at=datetime(2025, 9, 15, 12, tzinfo=dt_timezone.utc), real_hours=1, estimated_hours=1)
    now = datetime(2025, 12, 5, tzinfo=dt_timezone.utc)

    result = compute_range_member_kpis(user_ids=[user.id], from_year=2025, from_month=9, to_year=2025, to_month=9, now=now)

    september = result["month_snapshots"][0]
    assert september["total_tasks"] == 1
    assert september["member_snapshots"][user.id]["total_tasks"] == 1


def test_range_member_kpis_includes_task_after_utc_month_end_but_within_local_end(user):
    User.objects.filter(id=user.id).update(created_at=datetime(2020, 1, 1, tzinfo=dt_timezone.utc))
    user.refresh_from_db()
    # 2025-11-01T02:00:00Z queda FUERA del mes calendario UTC de octubre,
    # pero DENTRO de _local_month_bounds(2025, 10).end (2025-11-01T04:59:59.999999Z)
    # — TS la incluye, bucketeada como octubre.
    _task(user, status="COMPLETADA", end_date=datetime(2025, 11, 1, 2, tzinfo=dt_timezone.utc), completed_at=datetime(2025, 11, 1, 2, tzinfo=dt_timezone.utc), real_hours=1, estimated_hours=1)
    now = datetime(2025, 12, 5, tzinfo=dt_timezone.utc)

    result = compute_range_member_kpis(user_ids=[user.id], from_year=2025, from_month=10, to_year=2025, to_month=10, now=now)

    october = result["month_snapshots"][0]
    assert october["total_tasks"] == 1


def test_range_member_kpis_effective_bases_counts_extra_local_boundary_day(user):
    # Réplica exacta del caso real que expuso el hallazgo (ver
    # docs/AUDIT_LOG.md § 2026-08-26): colaborador prorrateado con
    # completed_at = 2025-11-10T00:00:00Z (hora del día 00:00, dentro de la
    # ventana de 5h) en un rango octubre-noviembre 2025 — TS cuenta 16 días
    # hábiles (Nov10-14, 17-21, 24-28, y el 1 de diciembre) = 104.0h a la
    # tasa default (6.5h/día); sin este fix, el port Python contaba 15 días
    # (sin el 1 de diciembre) = 97.5h.
    User.objects.filter(id=user.id).update(created_at=datetime(2020, 1, 1, tzinfo=dt_timezone.utc))
    user.refresh_from_db()
    _task(user, status="COMPLETADA", end_date=datetime(2025, 11, 10, tzinfo=dt_timezone.utc), completed_at=datetime(2025, 11, 10, tzinfo=dt_timezone.utc), real_hours=6, estimated_hours=8)
    now = datetime(2025, 12, 5, tzinfo=dt_timezone.utc)

    result = compute_range_member_kpis(user_ids=[user.id], from_year=2025, from_month=10, to_year=2025, to_month=11, now=now)

    assert result["aggregated_members"][user.id]["carga_base_hours"] == 104.0
