"""Cobertura HTTP de `/api/v1/reports/executive/` — Fase 8 (ver
docs/AUDIT_LOG.md § 2026-08-18): solo lectura de snapshots ya generados.
`TestExecutiveReportCreate`/`TestExecutiveReportAuditCreate` agregados en
la Fase 56 (ver docs/AUDIT_LOG.md § 2026-08-25) — el cálculo del
snapshot sigue en Next.js, estos endpoints solo persisten el resultado
ya calculado. `TestUserLegacyIdLookup` agregado en la Fase 57 (ver
docs/AUDIT_LOG.md § 2026-08-25) — puente cuid→id numérico para poder
empezar a portar el CÁLCULO del snapshot."""

from datetime import timedelta

import pytest
from django.contrib.auth.models import Group
from django.utils import timezone
from rest_framework.test import APIClient

from apps.reports.models import (
    ExecutiveReportAuditLog,
    ExecutiveReportIntegrityIncident,
    ExecutiveReportSnapshot,
)
from apps.users.models import User

pytestmark = pytest.mark.django_db


def _client_for(user: User) -> APIClient:
    client = APIClient()
    client.force_authenticate(user=user)
    return client


@pytest.fixture
def jefe():
    user = User.objects.create_user(username="jefe", email="jefe@example.com", password="Sup3r-Secr3t!")
    user.groups.set([Group.objects.get(name="JEFE_NACIONAL")])
    return user


@pytest.fixture
def coordinador():
    user = User.objects.create_user(username="coord", email="coord@example.com", password="Sup3r-Secr3t!")
    user.groups.set([Group.objects.get(name="COORDINADOR_NACIONAL")])
    return user


@pytest.fixture
def sin_acceso():
    user = User.objects.create_user(username="ana", email="ana@example.com", password="Sup3r-Secr3t!")
    user.groups.set([Group.objects.get(name="ASISTENTE_GH")])
    return user


def _snapshot(*, generated_by: User, scope="JEFE", **overrides) -> ExecutiveReportSnapshot:
    now = timezone.now()
    defaults = dict(
        report_id=f"NXR-{now.strftime('%Y%m%d-%H%M%S')}-{overrides.pop('suffix', 'AAAA')}",
        type="MENSUAL",
        scope=scope,
        generated_by=generated_by,
        generated_at=now,
        period_label="Julio 2026",
        period_start=now - timedelta(days=30),
        period_end=now,
        fecha_corte=now,
        period_status="CERRADO",
        filters={"periodo": {"tipoReporte": "MENSUAL"}},
        collaborator_ids=["u1", "u2"],
        collaborator_count=2,
        analytics_engine_version="1.5.0",
        formula_set_version="4.4",
        reporting_engine_version="2.0",
        nexo_version="1.64.0",
        data={"meta": {"reportId": "x"}, "estadoGeneral": {}},
        nova=None,
        data_quality={"complete": True},
        generation_ms=1200,
    )
    defaults.update(overrides)
    return ExecutiveReportSnapshot.objects.create(**defaults)


class TestExecutiveReportList:
    def test_requires_authentication(self):
        response = APIClient().get("/api/v1/reports/executive/list/")
        assert response.status_code == 401

    def test_forbidden_for_role_without_access(self, sin_acceso):
        response = _client_for(sin_acceso).get("/api/v1/reports/executive/list/")
        assert response.status_code == 403

    def test_jefe_sees_only_jefe_scope(self, jefe, coordinador):
        _snapshot(generated_by=jefe, scope="JEFE", suffix="AAAA")
        _snapshot(generated_by=coordinador, scope="COORDINADOR", suffix="BBBB")

        response = _client_for(jefe).get("/api/v1/reports/executive/list/")
        assert response.status_code == 200
        assert response.data["total"] == 1
        assert response.data["reports"][0]["scope"] == "JEFE"

    def test_coordinador_nacional_sees_coordinador_scope(self, coordinador):
        _snapshot(generated_by=coordinador, scope="COORDINADOR", suffix="CCCC")
        response = _client_for(coordinador).get("/api/v1/reports/executive/list/")
        assert response.data["total"] == 1
        assert response.data["reports"][0]["scope"] == "COORDINADOR"

    def test_administrador_sees_jefe_scope(self, jefe):
        admin = User.objects.create_user(username="admin", email="admin@example.com", password="Sup3r-Secr3t!")
        admin.groups.set([Group.objects.get(name="ADMINISTRADOR")])
        _snapshot(generated_by=jefe, scope="JEFE", suffix="DDDD")

        response = _client_for(admin).get("/api/v1/reports/executive/list/")
        assert response.data["total"] == 1

    def test_pagination_defaults_and_page_size_cap(self, jefe):
        for i in range(3):
            _snapshot(generated_by=jefe, scope="JEFE", suffix=f"A{i:03d}")

        response = _client_for(jefe).get("/api/v1/reports/executive/list/?page=1&pageSize=2")
        assert response.data["page"] == 1
        assert response.data["page_size"] == 2
        assert len(response.data["reports"]) == 2
        assert response.data["total"] == 3

    def test_ordered_by_generated_at_descending(self, jefe):
        older = _snapshot(generated_by=jefe, scope="JEFE", suffix="OLD1", generated_at=timezone.now() - timedelta(days=10))
        newer = _snapshot(generated_by=jefe, scope="JEFE", suffix="NEW1", generated_at=timezone.now())

        response = _client_for(jefe).get("/api/v1/reports/executive/list/")
        ids = [r["report_id"] for r in response.data["reports"]]
        assert ids == [newer.report_id, older.report_id]

    def test_list_item_excludes_full_document(self, jefe):
        _snapshot(generated_by=jefe, scope="JEFE", suffix="EEEE")
        response = _client_for(jefe).get("/api/v1/reports/executive/list/")
        assert "data" not in response.data["reports"][0]
        assert "nova" not in response.data["reports"][0]


class TestExecutiveReportDetail:
    def test_requires_authentication(self, jefe):
        snapshot = _snapshot(generated_by=jefe, suffix="FFFF")
        response = APIClient().get(f"/api/v1/reports/executive/{snapshot.report_id}/")
        assert response.status_code == 401

    def test_forbidden_for_role_without_access(self, sin_acceso, jefe):
        snapshot = _snapshot(generated_by=jefe, suffix="GGGG")
        response = _client_for(sin_acceso).get(f"/api/v1/reports/executive/{snapshot.report_id}/")
        assert response.status_code == 403

    def test_returns_404_for_nonexistent_report(self, jefe):
        response = _client_for(jefe).get("/api/v1/reports/executive/NXR-DOES-NOT-EXIST/")
        assert response.status_code == 404

    def test_returns_403_when_scope_does_not_match_viewer(self, jefe, coordinador):
        snapshot = _snapshot(generated_by=coordinador, scope="COORDINADOR", suffix="HHHH")
        response = _client_for(jefe).get(f"/api/v1/reports/executive/{snapshot.report_id}/")
        assert response.status_code == 403

    def test_returns_full_report_and_logs_viewed(self, jefe):
        snapshot = _snapshot(generated_by=jefe, scope="JEFE", suffix="IIII")
        response = _client_for(jefe).get(f"/api/v1/reports/executive/{snapshot.report_id}/")
        assert response.status_code == 200
        report = response.data["report"]
        assert report["report_id"] == snapshot.report_id
        assert report["data_quality"] == {"complete": True}

        assert ExecutiveReportAuditLog.objects.filter(report_id=snapshot.report_id, action="viewed", user=jefe).exists()

    def test_data_with_existing_meta_is_returned_unchanged(self, jefe):
        snapshot = _snapshot(generated_by=jefe, scope="JEFE", suffix="JJJJ", data={"meta": {"reportId": "already-here"}, "x": 1})
        response = _client_for(jefe).get(f"/api/v1/reports/executive/{snapshot.report_id}/")
        assert response.data["report"]["data"] == {"meta": {"reportId": "already-here"}, "x": 1}

    def test_legacy_migration_without_meta_gets_meta_reconstructed(self, jefe):
        snapshot = _snapshot(
            generated_by=jefe, scope="JEFE", suffix="KKKK",
            origin="LEGACY_MIGRATION", data={"estadoGeneral": {"foo": "bar"}},
        )
        response = _client_for(jefe).get(f"/api/v1/reports/executive/{snapshot.report_id}/")
        data = response.data["report"]["data"]
        assert data["estadoGeneral"] == {"foo": "bar"}
        assert data["meta"]["reportId"] == snapshot.report_id
        assert data["meta"]["rosterKind"] == "CONSOLIDADO"
        assert data["meta"]["origin"] == "LEGACY_MIGRATION"


def _create_payload(**overrides) -> dict:
    now = timezone.now()
    payload = dict(
        report_id=f"NXR-{now.strftime('%Y%m%d-%H%M%S')}-ZZZZ",
        type="MENSUAL",
        scope="JEFE",
        origin="GENERATED",
        integrity_flag="FULL",
        generated_at=now.isoformat(),
        period_label="Julio 2026",
        period_start=(now - timedelta(days=30)).isoformat(),
        period_end=now.isoformat(),
        fecha_corte=now.isoformat(),
        period_status="CERRADO",
        filters={"periodo": {"tipoReporte": "MENSUAL"}},
        collaborator_ids=["cuid-1", "cuid-2"],
        analytics_engine_version="1.5.0",
        formula_set_version="4.4",
        reporting_engine_version="2.0",
        nexo_version="1.116.0",
        data={"meta": {"reportId": "x"}, "estadoGeneral": {}},
        nova=None,
        nova_degraded=False,
        data_quality={"complete": True},
        generation_ms=1200,
    )
    payload.update(overrides)
    return payload


class TestExecutiveReportCreate:
    def test_requires_authentication(self):
        response = APIClient().post("/api/v1/reports/executive/", _create_payload(), format="json")
        assert response.status_code == 401

    def test_forbidden_for_role_without_access(self, sin_acceso):
        response = _client_for(sin_acceso).post("/api/v1/reports/executive/", _create_payload(), format="json")
        assert response.status_code == 403

    def test_creates_snapshot_attributed_to_the_authenticated_user(self, jefe):
        payload = _create_payload()
        response = _client_for(jefe).post("/api/v1/reports/executive/", payload, format="json")
        assert response.status_code == 201
        assert response.data["report_id"] == payload["report_id"]

        snapshot = ExecutiveReportSnapshot.objects.get(report_id=payload["report_id"])
        assert snapshot.generated_by == jefe
        assert snapshot.collaborator_ids == ["cuid-1", "cuid-2"]
        assert snapshot.collaborator_count == 2
        assert snapshot.data == payload["data"]

    def test_ignores_generated_by_in_the_body(self, jefe, coordinador):
        payload = _create_payload(generated_by=coordinador.id)
        response = _client_for(jefe).post("/api/v1/reports/executive/", payload, format="json")
        assert response.status_code == 201
        snapshot = ExecutiveReportSnapshot.objects.get(report_id=payload["report_id"])
        assert snapshot.generated_by == jefe

    def test_returns_409_on_report_id_collision(self, jefe):
        payload = _create_payload()
        first = _client_for(jefe).post("/api/v1/reports/executive/", payload, format="json")
        assert first.status_code == 201

        second = _client_for(jefe).post("/api/v1/reports/executive/", payload, format="json")
        assert second.status_code == 409

    def test_400_for_missing_required_field(self, jefe):
        payload = _create_payload()
        del payload["period_label"]
        response = _client_for(jefe).post("/api/v1/reports/executive/", payload, format="json")
        assert response.status_code == 400


class TestExecutiveReportAuditCreate:
    def _payload(self, **overrides) -> dict:
        payload = {"report_id": "NXR-20260801-120000-AAAA", "action": "generated", "collaborator_count": 3, "generation_ms": 900}
        payload.update(overrides)
        return payload

    def test_requires_authentication(self):
        response = APIClient().post("/api/v1/reports/executive/audit/", self._payload(), format="json")
        assert response.status_code == 401

    def test_forbidden_for_role_without_access(self, sin_acceso):
        response = _client_for(sin_acceso).post("/api/v1/reports/executive/audit/", self._payload(), format="json")
        assert response.status_code == 403

    def test_creates_entry_attributed_to_the_authenticated_user(self, jefe):
        response = _client_for(jefe).post("/api/v1/reports/executive/audit/", self._payload(), format="json")
        assert response.status_code == 204
        entry = ExecutiveReportAuditLog.objects.get(report_id="NXR-20260801-120000-AAAA")
        assert entry.user == jefe
        assert entry.action == "generated"
        assert entry.collaborator_count == 3

    def test_accepts_minimal_payload_for_nova_degraded(self, jefe):
        response = _client_for(jefe).post(
            "/api/v1/reports/executive/audit/",
            self._payload(action="nova_degraded", step="nova", message="Secciones degradadas", collaborator_count=None, generation_ms=None),
            format="json",
        )
        assert response.status_code == 204
        entry = ExecutiveReportAuditLog.objects.get(report_id="NXR-20260801-120000-AAAA", action="nova_degraded")
        assert entry.step == "nova"


class TestExecutiveReportIntegrityIncidentCreate:
    """Sprint R — Snapshot Integrity Validation (Fase 79, ver
    docs/AUDIT_LOG.md § 2026-08-27)."""

    def _payload(self, **overrides) -> dict:
        payload = {
            "report_id": "NXR-20260801-120000-AAAA",
            "field_path": "members[3].completedPct",
            "expected_value": 82.0,
            "actual_value": 79.5,
            "source": "kpis_team",
            "user_id": 42,
        }
        payload.update(overrides)
        return payload

    def test_requires_authentication(self):
        response = APIClient().post("/api/v1/reports/executive/integrity-incidents/", self._payload(), format="json")
        assert response.status_code == 401

    def test_forbidden_for_role_without_access(self, sin_acceso):
        response = _client_for(sin_acceso).post(
            "/api/v1/reports/executive/integrity-incidents/", self._payload(), format="json"
        )
        assert response.status_code == 403

    def test_creates_incident(self, jefe):
        response = _client_for(jefe).post(
            "/api/v1/reports/executive/integrity-incidents/", self._payload(), format="json"
        )
        assert response.status_code == 204
        incident = ExecutiveReportIntegrityIncident.objects.get(report_id="NXR-20260801-120000-AAAA")
        assert incident.field_path == "members[3].completedPct"
        assert incident.expected_value == 82.0
        assert incident.actual_value == 79.5
        assert incident.source == "kpis_team"
        assert incident.user_id == 42

    def test_accepts_payload_without_user_id(self, jefe):
        payload = self._payload(field_path="teamSummary.cargaPct")
        payload.pop("user_id")
        response = _client_for(jefe).post("/api/v1/reports/executive/integrity-incidents/", payload, format="json")
        assert response.status_code == 204
        incident = ExecutiveReportIntegrityIncident.objects.get(field_path="teamSummary.cargaPct")
        assert incident.user_id is None
