from django.contrib.auth.models import AbstractUser
from django.db import models

from apps.core.models import BaseModel


def _default_view_preferences() -> list[str]:
    return ["KANBAN", "TABLA"]


class User(AbstractUser, BaseModel):
    """Modelo de usuario. El hashing de contraseñas lo gestiona Django
    (PASSWORD_HASHERS, ver settings) — nunca se manipulan hashes a mano.

    `status` es la fuente de verdad para habilitar/deshabilitar/bloquear una
    cuenta; `is_active` (usado internamente por Django y por
    SessionAuthentication) se mantiene sincronizado en `save()` para que
    ningún mecanismo existente (autenticación, señal de revocación de
    sesiones) tenga que conocer `status`.
    """

    class Status(models.TextChoices):
        ACTIVE = "active", "Activo"
        DISABLED = "disabled", "Deshabilitado"
        BLOCKED = "blocked", "Bloqueado"

    email = models.EmailField(unique=True)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.ACTIVE)
    # Forzado por un administrador (ver PasswordResetService.admin_initiate_reset):
    # exigido en cada request autenticado por SessionAuthentication.authenticate()
    # hasta que el usuario complete POST /api/auth/password/change/.
    must_change_password = models.BooleanField(default=False)
    created_by = models.ForeignKey(
        "self", on_delete=models.SET_NULL, null=True, blank=True, related_name="created_users"
    )
    updated_by = models.ForeignKey(
        "self", on_delete=models.SET_NULL, null=True, blank=True, related_name="updated_users"
    )
    # Ajuste puntual del Administrador (Fase 4a del motor de KPIs/
    # Analytics, ver docs/AUDIT_LOG.md § 2026-08-11): si está definida,
    # los KPIs mensuales/semanales de este usuario se calculan desde esta
    # fecha en vez del inicio real del período.
    kpi_start_date = models.DateTimeField(null=True, blank=True)
    # Gate de consentimiento LOPD (Fase 13, ver docs/AUDIT_LOG.md §
    # 2026-08-19) — réplica de `User.dataConsentAccepted`/
    # `dataConsentAcceptedAt` (`prisma/schema.prisma`). Bloquea el
    # render de toda la app en el frontend hasta aceptar (`ConsentGate.tsx`,
    # sin cutover todavía); acá solo se porta el estado, no ese gate de UI.
    data_consent_accepted = models.BooleanField(default=False)
    data_consent_accepted_at = models.DateTimeField(null=True, blank=True)
    # Gaps documentados desde la Fase 12 (LOPD, ver
    # `apps.data_requests.services.export_my_data`) — réplica de
    # `User.badges`/`User.viewPreferences` (`prisma/schema.prisma`),
    # cerrados en la Fase 25 (Dashboard, ver docs/AUDIT_LOG.md §
    # 2026-08-20) porque `GET /api/dashboard` y `PATCH
    # /api/dashboard/card-order` son sus primeros consumidores reales.
    # `String[]` de Postgres -> `JSONField(default=list)`, mismo criterio
    # que `Project.tags`/`Task.assigned_roles` (SQL Server no tiene array
    # nativo). `badges` lo calcula/persiste `GET /api/profile/badges`
    # (fuera de alcance de esta fase, ver su propio docstring futuro) —
    # acá solo se declara el campo y se lee, nunca se calcula.
    badges = models.JSONField(default=list, blank=True)
    view_preferences = models.JSONField(default=_default_view_preferences, blank=True)

    # Otro gap de la misma familia (Fase 12/25) — réplica de
    # `User.theme`/`ThemePreference` (`prisma/schema.prisma`), cerrado en
    # la Fase 26 (ver docs/AUDIT_LOG.md § 2026-08-20) porque `PATCH
    # /api/users/<id>/theme` es su primer consumidor real.
    class Theme(models.TextChoices):
        LIGHT = "LIGHT"
        DARK = "DARK"

    theme = models.CharField(max_length=5, choices=Theme.choices, default=Theme.LIGHT)
    # `User.lastLoginAt` (TS) NUNCA se escribe en ningún handler del
    # legacy (confirmado: grep completo de `lastLoginAt:` en
    # `src/app/api` solo tiene lecturas) — campo "muerto" en la práctica,
    # siempre `null`. Se reutiliza el `last_login` nativo de
    # `AbstractUser` en vez de declarar un campo redundante: esta app
    # tampoco llama nunca a `django.contrib.auth.login()` (auth 100% JWT
    # manual, ver `apps.authentication.services`), así que se comporta
    # exactamente igual — presente en el modelo, nunca poblado.

    USERNAME_FIELD = "username"
    REQUIRED_FIELDS = ["email"]

    def save(self, *args, **kwargs):
        self.is_active = self.status == self.Status.ACTIVE
        super().save(*args, **kwargs)

    def __str__(self) -> str:
        return self.username
