"""Cobertura de `GET /api/v1/reports/roster/` — Fase 87 de la migración
de stack (ver docs/AUDIT_LOG.md § 2026-08-28). Réplica de
`resolveReportRoster` (`src/lib/executiveReporting/resolveRoster.ts`)."""

import pytest
from django.contrib.auth.models import Group
from rest_framework.test import APIClient

from apps.users.models import User

pytestmark = pytest.mark.django_db


def _client_for(user: User) -> APIClient:
    client = APIClient()
    client.force_authenticate(user=user)
    return client


def _user(username: str, role: str, legacy_id: str) -> User:
    user = User.objects.create_user(username=username, email=f"{username}@example.com", password="Sup3r-Secr3t!")
    user.groups.set([Group.objects.get(name=role)])
    user.legacy_postgres_id = legacy_id
    user.save(update_fields=["legacy_postgres_id"])
    return user


@pytest.fixture
def coordinador():
    return _user("coord", "COORDINADOR_NACIONAL", "cuid-coord")


@pytest.fixture
def sin_acceso():
    return _user("ana", "ASISTENTE_GH", "cuid-ana")


def test_requiere_autenticacion(coordinador):
    response = APIClient().get("/api/v1/reports/roster/")
    assert response.status_code == 401


def test_solo_can_access_reports(sin_acceso):
    response = _client_for(sin_acceso).get("/api/v1/reports/roster/")
    assert response.status_code == 403


def test_roster_consolidado_excluye_liderazgo_y_no_ejecutores(coordinador):
    _user("zs", "COORDINADOR_ZS", "cuid-zs")
    _user("cc", "ANALISTA_CC", "cuid-cc")
    _user("jefe", "JEFE_NACIONAL", "cuid-jefe")  # visible para coordinador? NO — VISIBLE_ROLES no lo incluye
    _user("admin", "ADMINISTRADOR", "cuid-admin")

    response = _client_for(coordinador).get("/api/v1/reports/roster/")

    assert response.status_code == 200
    roles = {u["role"] for u in response.data["users"]}
    assert roles == {"COORDINADOR_NACIONAL", "COORDINADOR_ZS", "ANALISTA_CC"}
    assert "JEFE_NACIONAL" not in roles
    assert "ADMINISTRADOR" not in roles
    assert response.data["scope"] == "COORDINADOR"
    assert response.data["roster_kind"] == "CONSOLIDADO"


def test_pedir_roles_de_liderazgo_explicitos_no_los_filtra_hacia_adentro(coordinador):
    """Réplica del caso borde de `buildSnapshotData.test.ts` (líneas
    497-516): pedir ADMINISTRADOR/JEFE_NACIONAL/COORDINADOR_ZS como
    COORDINADOR_NACIONAL nunca hace aparecer roles de liderazgo — solo
    COORDINADOR_ZS sobrevive al narrowing."""
    _user("zs", "COORDINADOR_ZS", "cuid-zs")

    response = _client_for(coordinador).get(
        "/api/v1/reports/roster/?roles=ADMINISTRADOR,JEFE_NACIONAL,COORDINADOR_ZS"
    )

    assert response.status_code == 200
    roles = {u["role"] for u in response.data["users"]}
    assert roles == {"COORDINADOR_ZS"}
    assert response.data["roster_kind"] == "POR_AREA"


def test_colaboradores_intersecta_ademas_del_filtro_de_rol(coordinador):
    zs = _user("zs", "COORDINADOR_ZS", "cuid-zs")
    _user("cc", "ANALISTA_CC", "cuid-cc")

    response = _client_for(coordinador).get(f"/api/v1/reports/roster/?colaboradores={zs.legacy_postgres_id}")

    assert response.status_code == 200
    assert response.data["users"] == [{"id": "cuid-zs", "name": "zs", "role": "COORDINADOR_ZS"}]
    assert response.data["user_ids"] == ["cuid-zs"]
    assert response.data["roster_kind"] == "INDIVIDUAL"


def test_varios_colaboradores_da_roster_kind_por_area(coordinador):
    zs = _user("zs", "COORDINADOR_ZS", "cuid-zs")
    cc = _user("cc", "ANALISTA_CC", "cuid-cc")

    response = _client_for(coordinador).get(
        f"/api/v1/reports/roster/?colaboradores={zs.legacy_postgres_id},{cc.legacy_postgres_id}"
    )

    assert response.status_code == 200
    assert {u["id"] for u in response.data["users"]} == {"cuid-zs", "cuid-cc"}
    assert response.data["roster_kind"] == "POR_AREA"


def test_areas_es_alias_literal_de_roles(coordinador):
    _user("zs", "COORDINADOR_ZS", "cuid-zs")
    _user("cc", "ANALISTA_CC", "cuid-cc")

    response = _client_for(coordinador).get("/api/v1/reports/roster/?areas=ANALISTA_CC")

    assert response.status_code == 200
    roles = {u["role"] for u in response.data["users"]}
    assert roles == {"ANALISTA_CC"}


def test_scope_jefe_para_jefe_nacional_y_administrador():
    admin = _user("admin2", "ADMINISTRADOR", "cuid-admin2")
    response = _client_for(admin).get("/api/v1/reports/roster/")
    assert response.status_code == 200
    assert response.data["scope"] == "JEFE"
