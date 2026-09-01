"""Modelos de Reportes Ejecutivos — Fase 8 de la migración de stack (ver
docs/AUDIT_LOG.md § 2026-08-18). Réplica de `prisma/schema.prisma`
(`ExecutiveReportSnapshot`/`ExecutiveReportAuditLog`) — el Executive
Reporting Engine 2.0 completo (`src/lib/executiveReporting/`, ~3200
líneas: `documentModel`/`estadoGeneral`/`indiceEjecutivo`/`resolveRoster`
+ narrativa NOVA vía Gemini + exportación Excel/HTML) NO se porta en esta
sub-fase — mismo criterio que el ROADMAP ya documentaba ("snapshots ya
generados se migran como datos congelados, nunca recalculados"). Acá
solo vive el modelo + lectura de snapshots ya generados
(`GET /reports/executive/`/`GET /reports/executive/<report_id>/`); la
GENERACIÓN (`POST /api/reports/executive`, que reconstruye Analytics +
IA para todo un roster) queda fuera, riesgo equivalente al Asistente
LLM/RAG (ROADMAP punto 6) — sin planificar en detalle todavía.

`MonthlyReport` (el modelo legacy que `ExecutiveReportSnapshot`
reemplaza, ver `legacy_monthly_report_id`) SÍ se porta acá, en la Fase
83 (ver docs/AUDIT_LOG.md § 2026-08-27) — corrige una premisa
equivocada de esta misma sub-fase (Fase 8): no es un dato histórico
congelado sin consumidor, `src/lib/retentionPolicy.ts` lo depura
activamente y `buildSnapshotData.ts` lo lee para la variación del
Índice Ejecutivo (ver `apps.configuration.services.find_purge_candidates`/
`execute_purge`). Sin `legacy_postgres_id` ni comando de importación —
decisión explícita del usuario en la Fase 82 de no migrar datos
históricos reales; el modelo arranca vacío en Django."""

from django.conf import settings
from django.db import models


class ExecutiveReportSnapshot(models.Model):
    """Snapshot INMUTABLE de un informe ejecutivo generado — a diferencia
    del resto de modelos de esta migración, sin `BaseModel` (no tiene
    `updated_at`: nunca se edita, coherente con el principio de
    inmutabilidad del motor original). Cada generación crea una fila
    nueva; ninguna se modifica jamás."""

    class Type(models.TextChoices):
        MENSUAL = "MENSUAL"
        RANGO_MESES = "RANGO_MESES"
        RANGO_PERSONALIZADO = "RANGO_PERSONALIZADO"

    class Scope(models.TextChoices):
        JEFE = "JEFE"
        COORDINADOR = "COORDINADOR"

    class PeriodStatus(models.TextChoices):
        EN_CURSO = "EN_CURSO"
        CERRADO = "CERRADO"
        HISTORICO = "HISTORICO"

    class Origin(models.TextChoices):
        GENERATED = "GENERATED"
        LEGACY_MIGRATION = "LEGACY_MIGRATION"

    class Integrity(models.TextChoices):
        FULL = "FULL"
        PARTIAL = "PARTIAL"

    # Fase 80 (ver docs/AUDIT_LOG.md § 2026-08-27): distinto de `report_id`
    # (el Report ID de negocio, formato NXR-...) — este es el `id` numérico
    # de Postgres/Prisma de la fila `ExecutiveReportSnapshot` original,
    # para el ETL de migración de datos reales.
    # Formato NXR-YYYYMMDD-HHMMSS-XXXX (o NXR-LEGACY-YYYYMMDD-XXXX para
    # filas migradas) — ver `src/lib/executiveReporting/reportId.ts`. Sin
    # generador propio en Django todavía: esta sub-fase no crea snapshots
    # nuevos, solo lee los existentes.
    report_id = models.CharField(max_length=40, unique=True)
    type = models.CharField(max_length=25, choices=Type.choices)
    scope = models.CharField(max_length=15, choices=Scope.choices)
    origin = models.CharField(max_length=20, choices=Origin.choices, default=Origin.GENERATED)
    integrity_flag = models.CharField(max_length=10, choices=Integrity.choices, default=Integrity.FULL)
    # Referencia SUELTA al `MonthlyReport` legacy que esta fila reemplaza
    # (backfill) — sin FK, `MonthlyReport` no se porta (ver docstring).
    legacy_monthly_report_id = models.CharField(max_length=40, null=True, blank=True)
    migrated_at = models.DateTimeField(null=True, blank=True)
    generated_by = models.ForeignKey(settings.AUTH_USER_MODEL, related_name="+", on_delete=models.PROTECT)
    generated_at = models.DateTimeField()
    period_label = models.CharField(max_length=255)
    period_start = models.DateTimeField()
    period_end = models.DateTimeField()
    fecha_corte = models.DateTimeField()
    period_status = models.CharField(max_length=15, choices=PeriodStatus.choices)
    filters = models.JSONField()
    # Lista de ids de colaboradores incluidos en el roster — referencia
    # suelta (sin FK): en filas `GENERATED` desde Next.js son cuid de
    # Postgres, no ids de Django: `dataQuality`/`data` es la fuente de
    # verdad del roster, este campo es solo metadata de conteo/filtro.
    collaborator_ids = models.JSONField(default=list, blank=True)
    collaborator_count = models.PositiveIntegerField(default=0)
    analytics_engine_version = models.CharField(max_length=20)
    formula_set_version = models.CharField(max_length=20)
    reporting_engine_version = models.CharField(max_length=20)
    nexo_version = models.CharField(max_length=20)
    # El documento completo (estadoGeneral/indiceEjecutivo/roster/etc.) —
    # opaco para Django en esta sub-fase, se sirve tal cual sin
    # interpretarlo (mismo criterio que el TS: "nunca se recalcula").
    data = models.JSONField()
    nova = models.JSONField(null=True, blank=True)
    nova_degraded = models.BooleanField(default=False)
    data_quality = models.JSONField()
    generation_ms = models.PositiveIntegerField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-generated_at"]
        indexes = [
            models.Index(fields=["generated_by", "created_at"]),
            models.Index(fields=["type", "period_start", "period_end"]),
            models.Index(fields=["origin"]),
        ]

    def __str__(self) -> str:
        return self.report_id


class ExecutiveReportAuditLog(models.Model):
    """Auditoría del Executive Reporting Engine — réplica de
    `ExecutiveReportAuditLog`. `report_id` es un `CharField` SUELTO, sin
    FK (sobrevive al borrado del snapshot referenciado, mismo patrón que
    `DeskAuditLog.entity_id`). Append-only — nunca se edita."""

    class Action(models.TextChoices):
        GENERATED = "generated"
        GENERATION_FAILED = "generation_failed"
        NOVA_DEGRADED = "nova_degraded"
        VIEWED = "viewed"
        EXPORTED_PDF = "exported_pdf"
        EXPORTED_EXCEL = "exported_excel"
        LEGACY_MIGRATED = "legacy_migrated"

    report_id = models.CharField(max_length=40)
    action = models.CharField(max_length=20, choices=Action.choices)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, related_name="+", on_delete=models.CASCADE)
    step = models.CharField(max_length=255, null=True, blank=True)
    message = models.TextField(null=True, blank=True)
    period = models.CharField(max_length=255, null=True, blank=True)
    fecha_corte = models.DateTimeField(null=True, blank=True)
    filters_applied = models.JSONField(null=True, blank=True)
    collaborator_count = models.PositiveIntegerField(null=True, blank=True)
    generation_ms = models.PositiveIntegerField(null=True, blank=True)
    analytics_engine_version = models.CharField(max_length=20, null=True, blank=True)
    formula_set_version = models.CharField(max_length=20, null=True, blank=True)
    nexo_version = models.CharField(max_length=20, null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["created_at"]
        indexes = [
            models.Index(fields=["report_id"]),
            models.Index(fields=["user", "created_at"]),
        ]

    def __str__(self) -> str:
        return f"{self.report_id}:{self.action}"


class ExecutiveReportIntegrityIncident(models.Model):
    """Sprint R — Snapshot Integrity Validation (ver docs/AUDIT_LOG.md §
    2026-08-27, Fase 79). FPS Parte IV §15 exige que los valores del
    reporte coincidan con Dashboard/Analytics para la misma fecha de
    corte, y que una discrepancia se registre como incidente.

    `report_id`/`user_id` son `CharField`/`PositiveIntegerField` SUELTOS,
    sin FK — mismo criterio que `ExecutiveReportAuditLog.report_id`
    ("sobrevive al borrado del snapshot referenciado"). Append-only, sin
    ciclo de vida de resolución (abierto/reconocido/resuelto) en esta
    primera versión — no se pidió explícitamente, evitar sobre-construir
    antes de que exista un consumidor real (mismo criterio ya usado en
    toda esta migración: CRUD/UI se agrega cuando hace falta, no antes).

    Solo se genera para reportes MENSUAL del mes calendario en curso SIN
    `fechaCorte` explícita — es el único caso donde la fuente de
    comparación (`TeamKpiView`, `GET /kpis/team/`) y el motor de reportes
    están mirando el mismo momento; `TeamKpiView` no es consciente de la
    fecha de corte de un reporte histórico, así que comparar contra
    reportes con corte explícito generaría discrepancias falsas por
    diseño, no bugs reales — alcance deliberado, no gap."""

    class Source(models.TextChoices):
        KPIS_TEAM = "kpis_team"

    report_id = models.CharField(max_length=40)
    field_path = models.CharField(max_length=255)
    expected_value = models.FloatField()
    actual_value = models.FloatField()
    source = models.CharField(max_length=20, choices=Source.choices, default=Source.KPIS_TEAM)
    user_id = models.PositiveIntegerField(null=True, blank=True)
    detected_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-detected_at"]
        indexes = [
            models.Index(fields=["report_id"]),
            models.Index(fields=["detected_at"]),
        ]

    def __str__(self) -> str:
        return f"{self.report_id}:{self.field_path}"


class MonthlyReport(models.Model):
    """Informe mensual LEGACY — réplica de `MonthlyReport` (Prisma),
    modelo que `ExecutiveReportSnapshot` reemplazó en el Executive
    Reporting Engine 2.0 pero que sigue vivo para 2 consumidores reales
    (Fase 83, ver docs/AUDIT_LOG.md § 2026-08-27):
    `apps.configuration.services.find_purge_candidates`/`execute_purge`
    (depuración periódica según la política de retención LOPDP) y, del
    lado Next.js, `buildSnapshotData.ts` (variación del Índice Ejecutivo
    contra el mes anterior). Ningún código actual crea filas nuevas acá
    (ni en TS ni en Django) — sin `legacy_postgres_id` ni comando de
    importación, decisión explícita del usuario (Fase 82) de no migrar
    datos históricos reales; el modelo arranca y permanece vacío salvo
    que algo vuelva a escribir en él."""

    month = models.PositiveSmallIntegerField()
    year = models.PositiveSmallIntegerField()
    generated_by = models.ForeignKey(settings.AUTH_USER_MODEL, related_name="+", on_delete=models.PROTECT)
    scope = models.CharField(max_length=15, choices=ExecutiveReportSnapshot.Scope.choices)
    data = models.JSONField()
    ai_analysis = models.TextField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        unique_together = ("month", "year", "scope")

    def __str__(self) -> str:
        return f"{self.year}-{self.month:02d}:{self.scope}"
