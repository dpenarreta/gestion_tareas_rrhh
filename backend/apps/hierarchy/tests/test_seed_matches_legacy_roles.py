"""Guardia de regresión: la seed de `RoleVisibility`/`RoleNotificationTarget`
(apps/hierarchy/migrations/0002_seed_nexo_roles.py) debe coincidir EXACTAMENTE
con `VISIBLE_ROLES`/`NOTIFICATION_TARGETS` de `src/lib/roles.ts` — la fuente
de verdad legacy mientras el Next.js siga sirviendo producción (ver plan de
Fase 1). Este test parsea el `.ts` real en cada corrida (no una copia
hardcodeada en Python) para detectar cualquier divergencia futura si alguien
edita `roles.ts` sin actualizar la migración de datos."""

import json
import re
from pathlib import Path

import pytest
from django.contrib.auth.models import Group

from apps.hierarchy.models import RoleNotificationTarget, RoleVisibility

ROLES_TS_PATH = Path(__file__).resolve().parents[4] / "src" / "lib" / "roles.ts"


def _parse_role_record(source: str, constant_name: str) -> dict[str, list[str]]:
    match = re.search(
        rf"export const {constant_name}: Record<Role, Role\[\]> = (\{{.*?\n\}});",
        source,
        re.DOTALL,
    )
    if not match:
        raise AssertionError(f"No se encontró '{constant_name}' en {ROLES_TS_PATH}")
    block = match.group(1)
    # Las claves del objeto TS son identificadores sin comillas
    # (ADMINISTRADOR: [...]) — JSON las exige entre comillas.
    block = re.sub(r"(?m)^(\s*)([A-Z_]+):", r'\1"\2":', block)
    # JSON no admite coma final antes de "]" o "}".
    block = re.sub(r",(\s*[\]}])", r"\1", block)
    return json.loads(block)


@pytest.fixture(scope="module")
def legacy_roles_ts() -> str:
    if not ROLES_TS_PATH.exists():
        pytest.skip(f"roles.ts no encontrado en {ROLES_TS_PATH} (¿checkout parcial?)")
    return ROLES_TS_PATH.read_text(encoding="utf-8")


@pytest.mark.django_db
def test_role_visibility_seed_matches_legacy_visible_roles(legacy_roles_ts):
    expected = _parse_role_record(legacy_roles_ts, "VISIBLE_ROLES")

    expected_pairs = {
        (viewer, visible) for viewer, visible_list in expected.items() for visible in visible_list
    }
    actual_pairs = set(
        RoleVisibility.objects.values_list("viewer_group__name", "visible_group__name")
    )

    assert actual_pairs == expected_pairs


@pytest.mark.django_db
def test_role_notification_target_seed_matches_legacy_notification_targets(legacy_roles_ts):
    expected = _parse_role_record(legacy_roles_ts, "NOTIFICATION_TARGETS")

    expected_pairs = {
        (source, target) for source, target_list in expected.items() for target in target_list
    }
    actual_pairs = set(
        RoleNotificationTarget.objects.values_list("source_group__name", "target_group__name")
    )

    assert actual_pairs == expected_pairs


@pytest.mark.django_db
def test_all_eleven_nexo_roles_are_seeded_as_groups(legacy_roles_ts):
    expected_role_names = set(_parse_role_record(legacy_roles_ts, "VISIBLE_ROLES").keys())

    assert expected_role_names.issubset(set(Group.objects.values_list("name", flat=True)))
