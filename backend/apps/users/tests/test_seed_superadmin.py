"""Cobertura de `python manage.py seed_superadmin` (ver
docs/DEPLOYMENT_IIS.md) — bootstrap del primer usuario ADMINISTRADOR en una
base de datos vacía."""

import io

import pytest
from django.contrib.auth.models import Group
from django.core.management import call_command
from django.core.management.base import CommandError

from apps.core.models import AuditLog
from apps.users.models import User

pytestmark = pytest.mark.django_db

VALID_PASSWORD = "Sup3r-Secr3t!Bootstrap"


def _call(**kwargs):
    out = io.StringIO()
    call_command("seed_superadmin", stdout=out, **kwargs)
    return out.getvalue()


def test_crea_el_administrador_con_grupo_y_superuser():
    output = _call(email="admin@empresa.com", username="admin", password=VALID_PASSWORD)

    user = User.objects.get(username="admin")
    assert user.email == "admin@empresa.com"
    assert user.is_superuser is True
    assert user.groups.filter(name="ADMINISTRADOR").exists()
    assert user.must_change_password is True
    assert user.check_password(VALID_PASSWORD)
    assert "creado" in output.lower()


def test_registra_auditoria_con_actor_nulo():
    _call(email="admin@empresa.com", username="admin", password=VALID_PASSWORD)

    user = User.objects.get(username="admin")
    entry = AuditLog.objects.get(action="user.created", target_id=str(user.id))
    assert entry.actor is None


def test_es_idempotente_si_ya_existe_el_username_o_email():
    _call(email="admin@empresa.com", username="admin", password=VALID_PASSWORD)
    assert User.objects.count() == 1

    output = _call(email="otro-correo@empresa.com", username="admin", password=VALID_PASSWORD)
    assert User.objects.count() == 1
    assert "ya existe" in output.lower()

    output = _call(email="admin@empresa.com", username="otro-username", password=VALID_PASSWORD)
    assert User.objects.count() == 1
    assert "ya existe" in output.lower()


def test_falla_rapido_si_el_grupo_administrador_no_existe():
    Group.objects.filter(name="ADMINISTRADOR").delete()

    with pytest.raises(CommandError, match="ADMINISTRADOR"):
        _call(email="admin@empresa.com", username="admin", password=VALID_PASSWORD)


def test_rechaza_una_contraseña_que_no_cumple_los_validadores():
    with pytest.raises(CommandError, match="[Cc]ontraseña inválida"):
        _call(email="admin@empresa.com", username="admin", password="123")

    assert User.objects.count() == 0


def test_toma_la_contraseña_de_la_variable_de_entorno_si_no_se_pasa_por_argumento(monkeypatch):
    monkeypatch.setenv("SUPERADMIN_PASSWORD", VALID_PASSWORD)

    _call(email="admin@empresa.com", username="admin")

    user = User.objects.get(username="admin")
    assert user.check_password(VALID_PASSWORD)
