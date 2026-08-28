"""Serializers de entrada del Simulador (Fase 9c, ver
docs/AUDIT_LOG.md § 2026-08-18) — primeros endpoints POST-con-cuerpo
de `apps.analytics` (el resto del app es de solo lectura). Réplica de
las validaciones inline de los 3 `route.ts` de
`/api/predictive/simulate/**`."""

from rest_framework import serializers


class AdjustTargetTimeSimulationSerializer(serializers.Serializer):
    """Réplica de la validación inline de `simulate/[userId]/route.ts`:
    `newTargetTimeHours` en [0, 1000]."""

    task_id = serializers.IntegerField()
    new_target_time_hours = serializers.FloatField(min_value=0, max_value=1000)


class AddParticipantsSimulationSerializer(serializers.Serializer):
    """Réplica de `simulate/project/[projectId]/route.ts`:
    `additionalParticipants` en (0, 20]."""

    additional_participants = serializers.FloatField(max_value=20)

    def validate_additional_participants(self, value: float) -> float:
        if value <= 0:
            raise serializers.ValidationError("Debe ser mayor a 0.")
        return value


class RedistributeLoadSimulationSerializer(serializers.Serializer):
    """Réplica de `simulate/redistribute/route.ts`: `hours` en (0, 200],
    `fromUserId` != `toUserId`."""

    from_user_id = serializers.IntegerField()
    to_user_id = serializers.IntegerField()
    hours = serializers.FloatField(max_value=200)

    def validate_hours(self, value: float) -> float:
        if value <= 0:
            raise serializers.ValidationError("Debe ser mayor a 0.")
        return value

    def validate(self, attrs: dict) -> dict:
        if attrs["from_user_id"] == attrs["to_user_id"]:
            raise serializers.ValidationError("from_user_id y to_user_id deben ser distintos.")
        return attrs
