from datetime import date

import pytest
from django.contrib.auth.models import Group
from rest_framework.test import APIClient

from apps.notifications.models import Notification
from apps.novedades.access import NovedadesAccess
from apps.users.models import User

TODAY = date(2026, 10, 12)  # período vigente: Octubre 2026 (23/09 → 22/10)


@pytest.fixture(autouse=True)
def fixed_today(monkeypatch):
    monkeypatch.setattr("apps.novedades.services.today", lambda: TODAY)
    monkeypatch.setattr("apps.novedades.views.today", lambda: TODAY)


@pytest.fixture(autouse=True)
def immediate_on_commit(monkeypatch):
    """Las notificaciones se envían en `transaction.on_commit`; dentro del
    test (una transacción que nunca se confirma) se ejecutan al instante."""
    monkeypatch.setattr("apps.novedades.services.transaction.on_commit", lambda fn, *a, **k: fn())


def _user(username, role, *, superuser=False):
    user = User.objects.create_user(
        username=username,
        email=f"{username}@example.com",
        password="clave-de-prueba-123",
        first_name=username.title(),
    )
    user.groups.set([Group.objects.get(name=role)])
    if superuser:
        user.is_superuser = True
        user.save(update_fields=["is_superuser"])
    return user


@pytest.fixture
def admin(db):
    return _user("admin", "ADMINISTRADOR", superuser=True)


@pytest.fixture
def supervisor(db):
    return _user("sup1", "SUPERVISOR_OPERACIONES")


@pytest.fixture
def supervisor2(db):
    return _user("sup2", "SUPERVISOR_OPERACIONES")


@pytest.fixture
def assistant(db):
    return _user("asis", "ASISTENTE_OPERACIONES")


@pytest.fixture
def other_user(db):
    return _user("otro", "ASISTENTE_GH")


def access(user):
    """Usuario recién leído de la base, como en cada request real (Django
    cachea los permisos en la instancia: ver `get_user_permission_codenames`)."""
    user = User.objects.get(pk=user.pk)
    return NovedadesAccess.for_user(user)


@pytest.fixture
def client_for():
    def _client(user):
        client = APIClient()
        client.force_authenticate(user=User.objects.get(pk=user.pk))
        return client

    return _client


def admin_notifications(admin_user):
    return list(Notification.objects.filter(user=admin_user).values_list("message", flat=True))
