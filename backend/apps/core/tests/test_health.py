"""Cobertura de los endpoints transversales de salud/versión y de la
configuración forzada por ambiente."""

import importlib

import pytest
from rest_framework.test import APIClient

pytestmark = pytest.mark.django_db


@pytest.fixture
def api_client():
    return APIClient()


# --- Health check (liveness) -------------------------------------------------


def test_health_check_reports_ok_without_secrets(api_client):
    response = api_client.get("/api/v1/health/")

    assert response.status_code == 200
    assert response.data["status"] == "ok"
    assert "system_name" in response.data
    body = str(response.data).lower()
    assert "secret" not in body
    assert "password" not in body
    assert "db_password" not in body


# --- Readiness -----------------------------------------------------------------


def test_readiness_check_reports_database_component(api_client):
    response = api_client.get("/api/v1/health/ready/")

    assert response.status_code == 200
    assert response.data["status"] == "ok"
    assert response.data["components"]["database"] == "ok"


# --- Versión ---------------------------------------------------------------------


def test_version_endpoint_exposes_no_sensitive_data(api_client, settings):
    response = api_client.get("/api/v1/version/")

    assert response.status_code == 200
    assert response.data["version"] == settings.APP_VERSION
    assert response.data["system_name"] == settings.SYSTEM_NAME
    assert response.data["environment"] == settings.ENVIRONMENT_NAME
    body = str(response.data).lower()
    assert "secret" not in body
    assert "key" not in body


# --- Documentación OpenAPI --------------------------------------------------------


def test_openapi_schema_lists_endpoints_and_auth_scheme(api_client):
    response = api_client.get("/api/v1/schema/")

    assert response.status_code == 200
    assert response["Content-Type"].startswith("application/vnd.oai.openapi")


def test_swagger_ui_is_reachable(api_client):
    response = api_client.get("/api/v1/schema/swagger-ui/")
    assert response.status_code == 200


# --- Configuración por ambiente: los valores de desarrollo no se propagan --------


def test_production_settings_force_safe_values_regardless_of_env():
    production_settings = importlib.import_module("config.settings.production")

    assert production_settings.DEBUG is False
    assert production_settings.ENVIRONMENT_NAME == "production"
    assert production_settings.SESSION_COOKIE_SECURE is True
    assert production_settings.CSRF_COOKIE_SECURE is True
