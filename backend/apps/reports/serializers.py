"""Serializers de Reportes Ejecutivos — Fase 8 (ver docs/AUDIT_LOG.md §
2026-08-18). `ExecutiveReportCreateSerializer`/`ExecutiveReportAuditCreateSerializer`
agregados en la Fase 56 (ver docs/AUDIT_LOG.md § 2026-08-25)."""

from rest_framework import serializers

from .models import (
    ExecutiveReportAuditLog,
    ExecutiveReportIntegrityIncident,
    ExecutiveReportSnapshot,
)


class ExecutiveReportListItemSerializer(serializers.ModelSerializer):
    """Réplica de la forma de fila de `GET /reports/executive/list` —
    SIN `data`/`nova`/`dataQuality` (el listado nunca trae el documento
    completo, solo metadata — mismo criterio que el TS)."""

    generated_by = serializers.SerializerMethodField()

    class Meta:
        model = ExecutiveReportSnapshot
        fields = [
            "report_id", "type", "scope", "origin", "integrity_flag",
            "period_label", "period_status", "collaborator_count", "generated_by", "generated_at",
        ]
        read_only_fields = fields

    def get_generated_by(self, obj: ExecutiveReportSnapshot) -> str:
        return obj.generated_by.first_name or obj.generated_by.username


class ExecutiveReportCreateSerializer(serializers.ModelSerializer):
    """`POST /reports/executive/` — Fase 56. `generated_by` NUNCA viene del
    body (evita que un cliente atribuya un reporte a otro usuario) — lo fija
    la vista desde `request.user`, igual que el resto de escrituras de esta
    migración que resuelven el actor desde el JWT, nunca desde el payload.
    `collaborator_count` tampoco es de entrada — se deriva de
    `len(collaborator_ids)`, mismo criterio que `createSnapshot`
    (`collaboratorCount: input.collaboratorIds.length`, nunca un campo
    propio de `CreateSnapshotInput`)."""

    # `null=True` en el modelo no alcanza para que DRF acepte `None` — se
    # declara a mano, único campo de este serializer con esa necesidad
    # (todos los demás siempre vienen informados desde `snapshotStore.ts`).
    nova = serializers.JSONField(required=False, allow_null=True)
    # Sin `UniqueValidator` automático (DRF lo agrega por default para
    # cualquier campo `unique=True`) — la colisión de `report_id` se
    # detecta a propósito recién en la escritura (`IntegrityError` en la
    # vista, traducido a 409), no acá como 400: el reintento con un id
    # nuevo lo maneja Next.js, necesita distinguir "colisión, reintentar"
    # de "dato inválido, no reintentar".
    report_id = serializers.CharField(validators=[])

    class Meta:
        model = ExecutiveReportSnapshot
        fields = [
            "report_id", "type", "scope", "origin", "integrity_flag",
            "generated_at", "period_label", "period_start", "period_end",
            "fecha_corte", "period_status", "filters", "collaborator_ids",
            "analytics_engine_version", "formula_set_version", "reporting_engine_version",
            "nexo_version", "data", "nova", "nova_degraded", "data_quality", "generation_ms",
        ]


class MonthlyTeamReportRequestSerializer(serializers.Serializer):
    """`POST /reports/executive/monthly-team-kpis/` — Fase 68 (ver
    docs/AUDIT_LOG.md § 2026-08-26). `user_ids` son ids numéricos de
    Django — el roster (`GET /reports/roster/`) ya los expone directo,
    sin traducción intermedia (retiro del bridge cuid↔Django, decisión
    explícita del usuario, ver docs/AUDIT_LOG.md § 2026-08-31)."""

    user_ids = serializers.ListField(child=serializers.IntegerField(), allow_empty=True)
    year = serializers.IntegerField(min_value=2000, max_value=2100)
    month = serializers.IntegerField(min_value=1, max_value=12)
    fecha_corte = serializers.DateTimeField(required=False, allow_null=True)


class TeamSubutilizationRequestSerializer(serializers.Serializer):
    """`POST /reports/executive/team-subutilization/` — Fase 85 (ver
    docs/AUDIT_LOG.md § 2026-08-27). `user_ids` son ids numéricos de
    Django (mismo criterio que `MonthlyTeamReportRequestSerializer`) —
    a diferencia de `apps.analytics.views.TeamSubutilizationView` (que
    deriva la lista del equipo jerárquico visible del actor), acá el
    roster lo define el caller explícitamente: el roster de un Reporte
    Ejecutivo puede no coincidir con el equipo de quien lo genera."""

    user_ids = serializers.ListField(child=serializers.IntegerField(), allow_empty=True)
    as_of = serializers.DateTimeField(required=False, allow_null=True)


class CustomRangeTeamReportRequestSerializer(serializers.Serializer):
    """`POST /reports/executive/custom-range-team-kpis/` — Fase 69 (ver
    docs/AUDIT_LOG.md § 2026-08-26). `period_start`/`period_end` son
    instantes UTC ya resueltos por el caller (réplica de `parseDayUTC`
    — inicio/fin de día del rango elegido), mismo contrato que
    `MonthlyTeamReportRequestSerializer` para `user_ids`/`fecha_corte`."""

    user_ids = serializers.ListField(child=serializers.IntegerField(), allow_empty=True)
    period_start = serializers.DateTimeField()
    period_end = serializers.DateTimeField()
    fecha_corte = serializers.DateTimeField(required=False, allow_null=True)


class RangeTeamReportRequestSerializer(serializers.Serializer):
    """`POST /reports/executive/range-team-kpis/` — Fase 69. `from_*`/
    `to_*` son mes/año calendario (inclusive), mismo contrato que
    `compute_range_member_kpis`."""

    user_ids = serializers.ListField(child=serializers.IntegerField(), allow_empty=True)
    from_year = serializers.IntegerField(min_value=2000, max_value=2100)
    from_month = serializers.IntegerField(min_value=1, max_value=12)
    to_year = serializers.IntegerField(min_value=2000, max_value=2100)
    to_month = serializers.IntegerField(min_value=1, max_value=12)
    fecha_corte = serializers.DateTimeField(required=False, allow_null=True)


class ExecutiveReportAuditCreateSerializer(serializers.ModelSerializer):
    """`POST /reports/executive/audit/` — Fase 56. `user` NUNCA viene del
    body, mismo criterio que `ExecutiveReportCreateSerializer`. Réplica de
    `ReportAuditEntry` (`snapshotStore.ts`): casi todos los campos son
    opcionales — cada acción de auditoría (`generated`/`generation_failed`/
    `nova_degraded`/...) informa un subconjunto distinto."""

    step = serializers.CharField(required=False, allow_null=True, allow_blank=True)
    message = serializers.CharField(required=False, allow_null=True, allow_blank=True)
    period = serializers.CharField(required=False, allow_null=True, allow_blank=True)
    fecha_corte = serializers.DateTimeField(required=False, allow_null=True)
    filters_applied = serializers.JSONField(required=False, allow_null=True)
    collaborator_count = serializers.IntegerField(required=False, allow_null=True)
    generation_ms = serializers.IntegerField(required=False, allow_null=True)
    analytics_engine_version = serializers.CharField(required=False, allow_null=True, allow_blank=True)
    formula_set_version = serializers.CharField(required=False, allow_null=True, allow_blank=True)
    nexo_version = serializers.CharField(required=False, allow_null=True, allow_blank=True)

    class Meta:
        model = ExecutiveReportAuditLog
        fields = [
            "report_id", "action", "step", "message", "period", "fecha_corte",
            "filters_applied", "collaborator_count", "generation_ms",
            "analytics_engine_version", "formula_set_version", "nexo_version",
        ]


class ExecutiveReportIntegrityIncidentCreateSerializer(serializers.ModelSerializer):
    """`POST /reports/executive/integrity-incidents/` — Sprint R (Fase 79,
    ver docs/AUDIT_LOG.md § 2026-08-27). Réplica de
    `verifySnapshotIntegrity.ts` — best-effort del lado de Next.js, mismo
    criterio que `ExecutiveReportAuditCreateSerializer`."""

    user_id = serializers.IntegerField(required=False, allow_null=True)

    class Meta:
        model = ExecutiveReportIntegrityIncident
        fields = ["report_id", "field_path", "expected_value", "actual_value", "source", "user_id"]
