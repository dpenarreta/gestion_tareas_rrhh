"""Guardia de regresión sobre el estado REAL de la base (ambas migraciones
aplicadas en secuencia, `0003_seed_business_module_permissions` +
`0004_seed_all_permissions_to_administrador`) — ver docs/AUDIT_LOG.md §
2026-09-01 ("Catálogo dinámico de permisos extendido a todo el sistema" y
su entrada de seguimiento "SuperUsuario = ADMINISTRADOR explícito").

Los codenames derivados de una constante `Role[]` de `src/lib/roles.ts` se
verifican parseando el `.ts` real (mismo patrón que
`apps/hierarchy/tests/test_seed_matches_legacy_roles.py`, para detectar
divergencias futuras si alguien edita `roles.ts` sin actualizar la
migración) — incluyendo `ADMINISTRADOR`, que la constante SIEMPRE incluye.
Los codenames sin constante en `roles.ts` (derivados de una fórmula como
`canViewTeam`/`canUseDeskNotes`, o exclusivos del backend como
`tareas.*`/`comunicados.gestionar`) se verifican contra un set fijo,
documentado con su fuente exacta — `ADMINISTRADOR` se agrega a los 3 que
`0003` había excluido a propósito (`tareas.regularizar`/`tareas.cerrar_mes`/
`escritorio_digital.usar`), porque `0004` lo siembra explícitamente en
TODO el catálogo por pedido del usuario ("tenga asignado todo por
defecto"), sin excepciones."""

import json
import re
from pathlib import Path

import pytest
from django.contrib.auth.models import Group

from apps.hierarchy.services import ALL_ROLES

ROLES_TS_PATH = Path(__file__).resolve().parents[4] / "src" / "lib" / "roles.ts"

# "Superusuario" (apps/roles/migrations/0001_initial.py) es un grupo
# heredado del template, ajeno a los 11 roles de Nexo — en una base nueva,
# esa migración corre DESPUÉS de que esta (Fase 1) ya creó los codenames
# nuevos, así que absorbe todos los permisos del catálogo vía
# `Permission.objects.filter(content_type=...)`. No es parte de lo que
# esta guardia de regresión verifica — se excluye explícitamente.

# codename -> nombre de la constante `Role[]` en roles.ts que lo respalda.
CODENAME_TO_TS_CONSTANT = {
    "reuniones.crear": "CAN_CREATE_MEETINGS",
    "reportes.ver": "CAN_ACCESS_REPORTS",
    "mejora_continua.revisar": "CAN_REVIEW_IDEAS",
    "base_conocimiento.ver": "CAN_VIEW_KNOWLEDGE_BASE",
    "base_conocimiento.gestionar": "CAN_MANAGE_KNOWLEDGE_BASE",
    "inteligencia_preventiva.ver": "CAN_VIEW_OPERATIONAL_RISK",
}

# codename -> roles esperados, sin constante `Role[]` propia en roles.ts.
CODENAME_TO_FIXED_ROLES = {
    # canViewTeam(role) = ROLE_LEVEL[role] >= 2 (roles.ts:159-161) — incluye
    # ADMINISTRADOR (nivel 5) vía role_level(), que trata grupo=ADMINISTRADOR
    # igual que is_superuser.
    "equipo.ver": {
        "ADMINISTRADOR",
        "JEFE_NACIONAL",
        "COORDINADOR_NACIONAL",
        "COORDINADOR_ZS",
        "ANALISTA_CC",
        "ANALISTA_SELECCION",
    },
    # canCreateProject = canViewTeam (roles.ts:209-211), mismo set que equipo.ver.
    "proyectos.crear": {
        "ADMINISTRADOR",
        "JEFE_NACIONAL",
        "COORDINADOR_NACIONAL",
        "COORDINADOR_ZS",
        "ANALISTA_CC",
        "ANALISTA_SELECCION",
    },
    # canUseDeskNotes(role) = role !== "ADMINISTRADOR" (roles.ts:218-220) —
    # `0003` excluía a ADMINISTRADOR a propósito acá; `0004` lo agrega de
    # todas formas (pedido explícito del usuario: "todo por defecto", sin
    # excepciones — revierte esa exclusión solo para el caso
    # ADMINISTRADOR-por-grupo-sin-superusuario, ver docstring de `0004`).
    "escritorio_digital.usar": {
        "ADMINISTRADOR",
        "JEFE_NACIONAL",
        "COORDINADOR_NACIONAL",
        "COORDINADOR_ZS",
        "ANALISTA_CC",
        "ANALISTA_SELECCION",
        "ASISTENTE_SELECCION",
        "ASISTENTE_GH",
        "ASISTENTE_GH_ZS",
        "TRABAJO_SOCIAL",
        "ASISTENTE_NOMINA",
    },
    # CanRegularize (backend/apps/tasks/permissions.py) — comparaba
    # `is_superuser` directo, NUNCA `role_name()`/grupo: `0003` no se lo
    # daba a ADMINISTRADOR por grupo por ese motivo; `0004` lo agrega de
    # todas formas (mismo criterio "todo por defecto" que arriba).
    "tareas.regularizar": {"ADMINISTRADOR", "JEFE_NACIONAL"},
    # CanCloseMonth usaba "usuarios.editar" — mismo set ya sembrado a estos
    # 2 roles en apps/hierarchy/migrations/0002_seed_nexo_roles.py (que
    # tampoco le daba ese permiso a ADMINISTRADOR por grupo); `0004` lo
    # agrega de todas formas.
    "tareas.cerrar_mes": {"ADMINISTRADOR", "JEFE_NACIONAL", "COORDINADOR_NACIONAL"},
    # CAN_POST_OR_DELETE (backend/apps/announcements/permissions.py), vía
    # role_name() -> incluye ADMINISTRADOR por grupo.
    "comunicados.gestionar": {"ADMINISTRADOR", "JEFE_NACIONAL", "COORDINADOR_NACIONAL"},
}


def _parse_role_array_constant(source: str, constant_name: str) -> set[str]:
    match = re.search(
        rf"export const {constant_name}: Role\[\] = (\[.*?\]);",
        source,
        re.DOTALL,
    )
    if not match:
        raise AssertionError(f"No se encontró '{constant_name}' en {ROLES_TS_PATH}")
    block = re.sub(r",(\s*\])", r"\1", match.group(1))
    return set(json.loads(block))


@pytest.fixture(scope="module")
def legacy_roles_ts() -> str:
    if not ROLES_TS_PATH.exists():
        pytest.skip(f"roles.ts no encontrado en {ROLES_TS_PATH} (¿checkout parcial?)")
    return ROLES_TS_PATH.read_text(encoding="utf-8")


@pytest.mark.django_db
@pytest.mark.parametrize("codename,constant_name", CODENAME_TO_TS_CONSTANT.items())
def test_seed_matches_role_ts_constant(legacy_roles_ts, codename, constant_name):
    expected_roles = _parse_role_array_constant(legacy_roles_ts, constant_name)

    actual_roles = set(
        Group.objects.filter(permissions__codename=codename, name__in=ALL_ROLES).values_list(
            "name", flat=True
        )
    )

    assert actual_roles == expected_roles


@pytest.mark.django_db
@pytest.mark.parametrize("codename,expected_roles", CODENAME_TO_FIXED_ROLES.items())
def test_seed_matches_fixed_role_set(codename, expected_roles):
    actual_roles = set(
        Group.objects.filter(permissions__codename=codename, name__in=ALL_ROLES).values_list(
            "name", flat=True
        )
    )

    assert actual_roles == expected_roles


@pytest.mark.django_db
def test_administrador_receives_every_catalog_codename():
    """`0004_seed_all_permissions_to_administrador` — pedido explícito del
    usuario ("crea un rol de SuperUsuario que tenga control de todos los
    permisos, tenga asignado todo por defecto"), aclarado con
    `AskUserQuestion` como "ADMINISTRADOR explícito en la base", no un rol
    nuevo. `ADMINISTRADOR` debe tener TODO el catálogo (`all_codenames()`),
    sin excepciones — incluye el catálogo administrativo original
    (`usuarios.*`/`roles.*`/`permisos.*`/`configuracion.*`/`auditoria.*`)
    que nunca se le había sembrado explícitamente, y las 3 excepciones que
    `0003` había dejado fuera (ver `CODENAME_TO_FIXED_ROLES`)."""
    from apps.permissions.catalog import all_codenames

    admin = Group.objects.get(name="ADMINISTRADOR")
    codenames = set(admin.permissions.values_list("codename", flat=True))

    assert codenames == all_codenames()
