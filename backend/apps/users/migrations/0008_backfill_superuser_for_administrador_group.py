"""Backfill: `is_superuser=True` para todo usuario que ya esté en el
grupo ADMINISTRADOR — hallazgo H-6 de la re-auditoría de datos personales
(ver docs/AUDIT_LOG.md § 2026-09-02). Desde este cambio,
`UserAdminService` mantiene `is_superuser` sincronizado con la
pertenencia al grupo ADMINISTRADOR en cada creación/reasignación de rol
(`_sync_superuser_with_administrador_group`), pero las cuentas YA
existentes en ese grupo antes de este cambio quedaban sin el flag —
exactamente el estado "ADMINISTRADOR-solo-por-grupo" que la migración
0004 de `apps.permissions` (`0004_seed_all_permissions_to_administrador`)
ya documentaba como alcanzable, sin que existiera entonces ningún camino
del producto para cerrarlo. Sin este backfill, cualquier Administrador
creado antes de esta fecha seguiría bloqueado de gestionar
`LeaveRecord`/`SpecialStatus` (Art. 26 LOPDP, gate `_is_true_superuser`
desde H-5)."""

from django.db import migrations


def backfill_superuser(apps, schema_editor):
    Group = apps.get_model("auth", "Group")
    User = apps.get_model("users", "User")
    try:
        administrador = Group.objects.get(name="ADMINISTRADOR")
    except Group.DoesNotExist:
        return
    User.objects.filter(groups=administrador, is_superuser=False).update(is_superuser=True)


def noop_reverse(apps, schema_editor):
    # No se revierte: es un backfill de estado, mismo criterio que
    # apps.permissions.migrations.0004_seed_all_permissions_to_administrador.
    pass


class Migration(migrations.Migration):
    dependencies = [
        ("users", "0007_remove_user_legacy_postgres_id"),
        # El grupo ADMINISTRADOR lo crea/siembra esta migración — sin
        # esta dependencia, una instalación nueva podría correr el
        # backfill antes de que el grupo exista (no falla, el `try` lo
        # cubre, pero no tendría nada que hacer).
        ("hierarchy", "0002_seed_nexo_roles"),
    ]

    operations = [
        migrations.RunPython(backfill_superuser, noop_reverse),
    ]
