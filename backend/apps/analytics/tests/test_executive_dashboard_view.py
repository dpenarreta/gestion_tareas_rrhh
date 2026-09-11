"""Cobertura HTTP de `GET /api/v1/kpis/executive/` — Fase 21 (ver
docs/AUDIT_LOG.md § 2026-08-20), réplica de
`src/app/api/kpis/executive/route.ts`. Compone 100% sobre motor ya
cubierto por sus propios tests (`test_performance_score.py`/
`test_operational_risk.py`/`test_workload_carga_tiempo.py`/etc.) — se
prueba con datos reales para validar el ensamblado HTTP/auth/
visibilidad y la forma de la respuesta, no cada fórmula de negocio ya
verificada por separado."""

from datetime import datetime, timedelta

import pytest
from django.contrib.auth.models import Group
from django.utils import timezone as django_timezone
from rest_framework.test import APIClient

from apps.ideas.models import ImprovementIdea
from apps.tasks.models import Task
from apps.users.models import User

pytestmark = pytest.mark.django_db


def _first_of_current_month() -> datetime:
    """Primer instante del mes en curso, en UTC.

    Las fechas de este archivo son relativas al reloj y no literales: el
    endpoint agrupa las tareas por `end_date` dentro del mes en curso
    (`_month_bounds`, que trabaja en UTC igual que `django_timezone.now()`)
    y, a diferencia de `build_executive_dashboard_payload`, no acepta un
    `now` inyectado — es una vista HTTP. Con fechas fijas el test caducaba
    al cambiar el mes: quedó rojo el 2026-09-01 porque usaba agosto.
    """
    now = django_timezone.now()
    return now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)


def _client_for(user: User) -> APIClient:
    client = APIClient()
    client.force_authenticate(user=user)
    return client


@pytest.fixture
def coordinador_nacional():
    user = User.objects.create_user(username="coord_nac", email="coord_nac@example.com", password="Sup3r-Secr3t!")
    user.groups.set([Group.objects.get(name="COORDINADOR_NACIONAL")])
    return user


@pytest.fixture
def analista():
    user = User.objects.create_user(username="analista", email="analista@example.com", password="Sup3r-Secr3t!", first_name="Ana")
    user.groups.set([Group.objects.get(name="ANALISTA_CC")])
    return user


@pytest.fixture
def coordinador_zs():
    user = User.objects.create_user(username="coord_zs", email="coord_zs@example.com", password="Sup3r-Secr3t!")
    user.groups.set([Group.objects.get(name="COORDINADOR_ZS")])
    return user


def _create_task(*, assigned_to: User, created_by: User, **overrides) -> Task:
    payload = dict(
        title="Tarea", priority=Task.Priority.MEDIA, frequency=Task.Frequency.PUNTUAL, type=Task.Type.FIJA,
        start_date=_first_of_current_month(), end_date=django_timezone.now(), estimated_hours=5,
        assigned_to=assigned_to, created_by=created_by, status=Task.Status.PENDIENTE,
    )
    payload.update(overrides)
    return Task.objects.create(**payload)


def test_requires_authentication():
    response = APIClient().get("/api/v1/kpis/executive/")
    assert response.status_code == 401


def test_requires_leadership_level(coordinador_zs):
    """`is_leadership` exige `ROLE_LEVEL>=3` — Coordinador ZS (nivel 2)
    no accede, aunque sí pase `can_view_team` (nivel>=2)."""
    response = _client_for(coordinador_zs).get("/api/v1/kpis/executive/")
    assert response.status_code == 403


def test_empty_response_shape_without_real_subordinates(coordinador_nacional):
    """En esta BD de test solo existe el actor — `get_subordinate_executor_groups`
    devuelve grupos válidos, pero no hay usuarios reales en ellos."""
    response = _client_for(coordinador_nacional).get("/api/v1/kpis/executive/")
    assert response.status_code == 200
    assert response.data["month"] == ""
    assert response.data["overview"] == {
        "avg_cumplimiento": 0, "avg_cumplimiento_color": "red", "sobrecarga_count": 0,
        "subutilizacion_count": 0, "total_horas": 0, "total_consultas": 0,
    }
    assert response.data["trend"] == []
    assert response.data["ranking"] == []
    assert response.data["ceo"]["estado"] == "green"
    assert response.data["ceo"]["estado_label"] == "Sin datos"


def test_200_includes_subordinate_snapshot_and_ceo_block(coordinador_nacional, analista):
    _create_task(
        assigned_to=analista, created_by=coordinador_nacional, status=Task.Status.COMPLETADA
    )

    response = _client_for(coordinador_nacional).get("/api/v1/kpis/executive/")
    assert response.status_code == 200

    entry = next(m for m in response.data["ranking"] if m["id"] == analista.id)
    assert entry["name"] == "Ana"
    assert entry["role"] == "ANALISTA_CC"
    assert entry["total_tasks"] == 1
    assert entry["completed"] == 1
    assert "score_trend" in entry

    workload_entry = next(w for w in response.data["workload"] if w["id"] == analista.id)
    assert "real_hours" in workload_entry and "base_hours" in workload_entry

    ceo = response.data["ceo"]
    for key in ("estado", "estado_label", "cambios", "atender", "performance", "operational_risk"):
        assert key in ceo
    assert set(ceo["performance"]) == {"avg", "classification", "color"}
    assert set(ceo["operational_risk"]) == {"avg", "classification", "color"}


def test_pending_ideas_only_includes_proposed_and_in_review(coordinador_nacional, analista):
    ImprovementIdea.objects.create(title="Propuesta abierta", description="x", impact="MEDIO", status=ImprovementIdea.Status.PROPUESTA, author=analista)
    ImprovementIdea.objects.create(title="En revisión", description="x", impact="MEDIO", status=ImprovementIdea.Status.EN_REVISION, author=analista)
    ImprovementIdea.objects.create(title="Ya implementada", description="x", impact="MEDIO", status=ImprovementIdea.Status.IMPLEMENTADA, author=analista)

    response = _client_for(coordinador_nacional).get("/api/v1/kpis/executive/")
    titles = {i["title"] for i in response.data["alerts"]["pending_ideas"]}
    assert titles == {"Propuesta abierta", "En revisión"}


def test_trend_and_ranking_reflect_month_over_month_change(coordinador_nacional, analista):
    # Mes en curso: una tarea completada — cumplimiento 100%. Mes anterior
    # (dentro de la ventana de 6 meses del snapshot): una pendiente — 0%.
    _create_task(
        assigned_to=analista, created_by=coordinador_nacional, status=Task.Status.COMPLETADA
    )
    _create_task(
        assigned_to=analista,
        created_by=coordinador_nacional,
        status=Task.Status.PENDIENTE,
        end_date=_first_of_current_month() - timedelta(days=1),
    )

    response = _client_for(coordinador_nacional).get("/api/v1/kpis/executive/")
    assert response.status_code == 200
    assert response.data["overview"]["avg_cumplimiento"] == 100
    assert response.data["month"] != ""

    # El mes en curso es el último punto de la tendencia, y el anterior
    # entra con su propio valor — que es lo que el nombre del test promete.
    trend = response.data["trend"]
    assert [point["avg_cumplimiento"] for point in trend[-2:]] == [0, 100]
    assert trend[-1]["month"] == response.data["month"]
