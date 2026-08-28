"""Serializers de Centro de Configuración — Fases 13/28/29/31/32 (ver
docs/AUDIT_LOG.md § 2026-08-19/2026-08-20/2026-08-21)."""

from rest_framework import serializers

from apps.hierarchy.services import ALL_ROLES

from .models import LeaveRecord, SpecialStatus
from .services import (
    ARCHIVED_TASKS_OPTIONS,
    KNOWLEDGE_DOCS_OPTIONS,
    MONTHLY_REPORTS_OPTIONS,
    PREDICTION_WINDOW_OPTIONS,
    RETENTION_LOGIN_ATTEMPTS_OPTIONS,
)


class PredictionWindowUpdateSerializer(serializers.Serializer):
    """Réplica de la validación inline de `PUT
    /api/settings/prediction-window` (`isValidPredictionWindow`)."""

    window_weeks = serializers.ChoiceField(choices=PREDICTION_WINDOW_OPTIONS)


class WelcomeMessageUpdateSerializer(serializers.Serializer):
    """Réplica de la validación inline de `PUT
    /api/settings/welcome-message`."""

    message = serializers.CharField(allow_blank=True)
    active = serializers.BooleanField()


class FavoriteUpdateSerializer(serializers.Serializer):
    """Réplica de la validación inline de `PATCH
    /api/settings/favorites`."""

    setting_id = serializers.CharField(allow_blank=False)
    pinned = serializers.BooleanField()


class RoleTargetFieldsSerializer(serializers.Serializer):
    """Réplica de `isValidTarget`: cada campo es `null` o un número en
    `[0, 100]` — nunca un objetivo inventado."""

    performance = serializers.FloatField(min_value=0, max_value=100, allow_null=True)
    riesgo_max = serializers.FloatField(min_value=0, max_value=100, allow_null=True)
    cumplimiento = serializers.FloatField(min_value=0, max_value=100, allow_null=True)


class RoleTargetUpdateSerializer(serializers.Serializer):
    """Réplica de la validación inline de `PATCH
    /api/settings/role-targets`."""

    role = serializers.ChoiceField(choices=ALL_ROLES)
    target = RoleTargetFieldsSerializer()


class RoleCompatibilityUpdateSerializer(serializers.Serializer):
    """Réplica de la validación inline de `PATCH
    /api/settings/role-compatibility` — la Regla 4 (nunca cruzar
    `ROLE_LEVEL`) se valida aparte, en la vista (necesita `ROLE_LEVEL`,
    fuera del alcance de un serializer de forma)."""

    role = serializers.ChoiceField(choices=ALL_ROLES)
    compatible_roles = serializers.ListField(child=serializers.ChoiceField(choices=ALL_ROLES))


class HolidayCreateSerializer(serializers.Serializer):
    """Réplica de la validación inline de `POST /api/settings/holidays`."""

    date = serializers.DateField()
    name = serializers.CharField(allow_blank=False)


class LeaveRecordCreateSerializer(serializers.Serializer):
    """Réplica de la validación inline de `POST
    /api/settings/leave-records`. La validación de "hay al menos un día
    laborable en el rango" queda fuera (vive en la vista, que consulta
    el feriadario) — igual criterio que `RoleCompatibilityUpdateSerializer`
    con la Regla 4."""

    user_id = serializers.IntegerField()
    type = serializers.ChoiceField(choices=LeaveRecord.Type.choices)
    start_date = serializers.DateField()
    end_date = serializers.DateField()
    is_full_day = serializers.BooleanField()
    duration_minutes = serializers.IntegerField(required=False, allow_null=True, min_value=1, max_value=1440)
    observation = serializers.CharField(required=False, allow_null=True, allow_blank=True)

    def validate(self, attrs):
        if attrs["end_date"] < attrs["start_date"]:
            raise serializers.ValidationError("La fecha fin debe ser igual o posterior a la fecha inicio")
        if attrs["type"] == LeaveRecord.Type.VACACIONES and not attrs["is_full_day"]:
            raise serializers.ValidationError("Las vacaciones siempre son de día completo")
        if not attrs["is_full_day"] and attrs.get("duration_minutes") is None:
            raise serializers.ValidationError("La duración debe ser un número de minutos entre 1 y 1440")
        return attrs


class SpecialStatusCreateSerializer(serializers.Serializer):
    """Réplica de la validación inline de `POST
    /api/settings/special-status`."""

    user_id = serializers.IntegerField()
    type = serializers.ChoiceField(choices=SpecialStatus.Type.choices)
    start_date = serializers.DateField()
    end_date = serializers.DateField(required=False, allow_null=True)
    daily_hours = serializers.FloatField()
    limit_low = serializers.FloatField()
    limit_base = serializers.FloatField()
    limit_high = serializers.FloatField()
    limit_overload = serializers.FloatField()

    def _validate_hours_field(self, value, label):
        if value <= 0 or value > 24:
            raise serializers.ValidationError(f"El campo {label} debe ser un número entre 0 y 24 horas")
        return value

    def validate_daily_hours(self, value):
        return self._validate_hours_field(value, "dailyHours")

    def validate_limit_low(self, value):
        return self._validate_hours_field(value, "limitLow")

    def validate_limit_base(self, value):
        return self._validate_hours_field(value, "limitBase")

    def validate_limit_high(self, value):
        return self._validate_hours_field(value, "limitHigh")

    def validate_limit_overload(self, value):
        return self._validate_hours_field(value, "limitOverload")

    def validate(self, attrs):
        if attrs.get("end_date") and attrs["end_date"] < attrs["start_date"]:
            raise serializers.ValidationError("La fecha fin debe ser igual o posterior a la fecha inicio")
        if not (
            attrs["limit_low"] < attrs["limit_base"] <= attrs["limit_high"] < attrs["limit_overload"]
        ):
            raise serializers.ValidationError(
                "Los límites deben cumplir: Subutilización < Moderado/Óptimo ≤ Óptimo/Elevada < Elevada/Sobrecarga"
            )
        return attrs


class KpiStartDateUpdateSerializer(serializers.Serializer):
    """Réplica de la validación inline de `PATCH
    /api/settings/kpi-start-date` — Fase 31 (ver docs/AUDIT_LOG.md §
    2026-08-21)."""

    user_id = serializers.IntegerField()
    kpi_start_date = serializers.DateField(required=False, allow_null=True)


class RetentionPolicyUpdateSerializer(serializers.Serializer):
    """Réplica de la validación inline de `PUT
    /api/settings/retention-policy` — Fase 31. Todos los campos
    opcionales (solo se actualiza lo presente)."""

    monthly_reports_months = serializers.ChoiceField(choices=MONTHLY_REPORTS_OPTIONS, required=False)
    archived_tasks_months = serializers.ChoiceField(choices=ARCHIVED_TASKS_OPTIONS, required=False)
    knowledge_docs_months = serializers.ChoiceField(choices=KNOWLEDGE_DOCS_OPTIONS, required=False)


class EscritorioDigitalConfigUpdateSerializer(serializers.Serializer):
    """Réplica de la validación inline de `PUT
    /api/settings/escritorio-digital-config` — Fase 31. Todos los
    campos opcionales."""

    archive_retention_days = serializers.IntegerField(required=False, min_value=1, max_value=365)
    max_replies = serializers.IntegerField(required=False, min_value=1, max_value=20)
    snooze_presets_minutes = serializers.ListField(
        child=serializers.IntegerField(min_value=1, max_value=43200), required=False, allow_empty=False
    )

    def validate(self, attrs):
        if not attrs:
            raise serializers.ValidationError("Nada que guardar")
        return attrs


class SeguridadConfigUpdateSerializer(serializers.Serializer):
    """Réplica de la validación inline de `PUT
    /api/settings/seguridad-config` — Fase 32 (ver docs/AUDIT_LOG.md §
    2026-08-21). Todos los campos opcionales; a diferencia de
    `EscritorioDigitalConfigUpdateSerializer`, el TS NO exige al menos
    un campo presente — un `PUT` sin cuerpo es válido (no-op) y
    devuelve 200 con los valores vigentes.

    `password_min_length` tiene un piso de 10 (Fase 75, ver
    docs/AUDIT_LOG.md § 2026-08-26) — el mismo que
    `AUTH_PASSWORD_VALIDATORS.MinimumLengthValidator` ya impone siempre
    en `apps.authentication`, hardcodeado e independiente de este
    valor. Antes el piso era 4, lo que permitía configurar un mínimo
    que Django nunca respetaba en la práctica."""

    password_min_length = serializers.IntegerField(required=False, min_value=10, max_value=128)
    session_duration_default_hours = serializers.IntegerField(required=False, min_value=1, max_value=8760)
    session_duration_remember_hours = serializers.IntegerField(required=False, min_value=1, max_value=8760)
    retention_login_attempts_days = serializers.ChoiceField(choices=RETENTION_LOGIN_ATTEMPTS_OPTIONS, required=False)


class TrabajoAvanzadoUpdateSerializer(serializers.Serializer):
    """Réplica de la validación inline de `PUT
    /api/settings/trabajo-avanzado` — Fase 32. Todos los campos
    opcionales, sin exigir al menos uno (mismo criterio que
    `SeguridadConfigUpdateSerializer`)."""

    retroactive_window_days = serializers.IntegerField(required=False, min_value=1, max_value=10)
    workday_end_hour = serializers.IntegerField(required=False, min_value=0, max_value=23)


class NovaCacheUpdateSerializer(serializers.Serializer):
    """Réplica de la validación inline de `PUT /api/settings/nova-cache`
    — Fase 34 (ver docs/AUDIT_LOG.md § 2026-08-21). `cache_ttl_minutes`
    es obligatorio (a diferencia de `TrabajoAvanzadoUpdateSerializer`,
    el TS no tiene otros campos opcionales que lo acompañen)."""

    cache_ttl_minutes = serializers.IntegerField(min_value=1, max_value=10080)
