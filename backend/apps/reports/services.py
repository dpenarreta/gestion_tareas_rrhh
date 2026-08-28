"""Lógica de negocio de Reportes Ejecutivos — Fase 8 (ver
docs/AUDIT_LOG.md § 2026-08-18). Réplica campo por campo de
`src/app/api/reports/executive/list/route.ts` y
`src/app/api/reports/executive/[reportId]/route.ts` — solo lectura de
snapshots ya generados, ver docstring de `models.py`."""

import logging

from .models import ExecutiveReportAuditLog, ExecutiveReportSnapshot

logger = logging.getLogger("apps.reports")

DEFAULT_PAGE_SIZE = 20
MAX_PAGE_SIZE = 100


def log_report_audit(*, report_id: str, action: str, user, **fields) -> None:
    """Nunca lanza — la auditoría no debe poder tumbar la generación/
    lectura que audita, réplica de `logReportAudit`
    (`src/lib/executiveReporting/snapshotStore.ts`)."""
    try:
        ExecutiveReportAuditLog.objects.create(report_id=report_id, action=action, user=user, **fields)
    except Exception:  # noqa: BLE001
        logger.exception("[reports] no se pudo registrar el evento de auditoría")


def ensure_snapshot_meta(snapshot: ExecutiveReportSnapshot) -> dict:
    """Réplica de `ensureSnapshotMeta` (`[reportId]/route.ts`) — los
    `ExecutiveReportSnapshot` con `origin=LEGACY_MIGRATION` del backfill
    original se persistieron con `data` SIN el campo `meta` (gap del
    propio backfill TS, no de este puerto). Se repara en el LÍMITE DE
    LECTURA, reconstruyendo `meta` a partir de las columnas propias de
    la fila (que sí tienen toda la información), sin reescribir nada —
    garantiza que `data` devuelto acá sea SIEMPRE completo."""
    data = snapshot.data if isinstance(snapshot.data, dict) else {}
    if data.get("meta"):
        return data

    return {
        **data,
        "meta": {
            "reportId": snapshot.report_id,
            "origin": snapshot.origin,
            "integrityFlag": snapshot.integrity_flag,
            "type": snapshot.type,
            # MonthlyReport (el modelo legacy) nunca soportó roster filtrado
            # por rol/colaborador — CONSOLIDADO es el valor correcto para
            # todo reporte LEGACY_MIGRATION, no una suposición (réplica
            # exacta del comentario/decisión ya tomada en el TS).
            "rosterKind": "CONSOLIDADO",
            "scope": snapshot.scope,
            "periodLabel": snapshot.period_label,
            "periodStart": snapshot.period_start.isoformat(),
            "periodEnd": snapshot.period_end.isoformat(),
            "fechaCorte": snapshot.fecha_corte.isoformat(),
            "periodStatus": snapshot.period_status,
            "collaboratorIds": snapshot.collaborator_ids,
            "collaboratorCount": snapshot.collaborator_count,
            "generatedBy": {"userId": snapshot.generated_by_id, "name": snapshot.generated_by.first_name or snapshot.generated_by.username},
            "generatedAt": snapshot.generated_at.isoformat(),
            "generationMs": snapshot.generation_ms,
            "versions": {
                "analyticsEngineVersion": snapshot.analytics_engine_version,
                "formulaSetVersion": snapshot.formula_set_version,
                "reportingEngineVersion": snapshot.reporting_engine_version,
                "nexoVersion": snapshot.nexo_version,
            },
        },
    }
