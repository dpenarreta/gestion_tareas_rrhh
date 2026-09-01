from django.conf import settings
from django.db import models

# Mismo valor que ANALYTICS_ENGINE_VERSION en src/lib/analytics.ts —
# actualizar aquí si esa constante cambia en una sub-fase futura.
ANALYTICS_ENGINE_VERSION = "1.5.0"

# Mismo valor que FORMULA_SET_VERSION en src/lib/analytics.ts.
FORMULA_SET_VERSION = "4.4"

# Réplica exacta de FORMULA_VERSIONS (analytics.ts) — versión de cada
# fórmula de negocio, independiente del motor como un todo. Nombres en
# snake_case (camelCase en el TS original). Solo se sube cuando la
# fórmula CAMBIA de resultado, no en cada refactor.
FORMULA_VERSIONS: dict[str, str] = {
    "carga_laboral": "1.0",
    "equilibrio_operativo": "1.1",
    "score_simple": "1.0",
    "capacidad_disponible": "1.1",
    "riesgo_operativo": "1.0",
    "cumplimiento": "2.0",
    "consistencia": "2.1",
    "prediccion": "2.0",
    "performance_score": "4.0",
    "trazabilidad": "4.0",
    "benchmark_inteligente": "1.0",
    "completado_a_tiempo": "1.0",
}

# Réplica de AUDIT_KIND_FORMULAS (analytics.ts) — kind de
# `AnalyticsAuditLog` → fórmulas de negocio involucradas. `validation_failure`
# audita con `formula_versions={}` (lista vacía) desde `validate_analytics_
# consistency` (Fase 4l, `pipeline.py`) vía este mapa — igual que el TS.
# `validate_cumplimiento_consistency` (Fase 4b, `scoring.py`) sigue
# auditando el mismo `kind` de forma inline, sin pasar por este mapa
# (predata la creación de `audit_calculation`, no se refactoriza) — mismo
# comportamiento que su equivalente TS.
AUDIT_KIND_FORMULAS: dict[str, list[str]] = {
    "performance_score": ["performance_score", "cumplimiento", "consistencia", "trazabilidad"],
    "health_score": ["equilibrio_operativo", "carga_laboral", "cumplimiento", "consistencia", "capacidad_disponible"],
    "operational_risk": ["riesgo_operativo"],
    "alerts": [],
    "validation_failure": [],
}


class AnalyticsAuditLog(models.Model):
    """Auditoría append-only de cálculos/validaciones del motor de KPIs/
    Analytics — Fase 4b (ver docs/AUDIT_LOG.md § 2026-08-11). Portado de
    `AnalyticsAuditLog` (Prisma). Sin `updated_at`: cada evento es una
    fila nueva, nunca se edita ni se borra."""

    user = models.ForeignKey(settings.AUTH_USER_MODEL, related_name="analytics_audit_logs", on_delete=models.CASCADE)
    kind = models.CharField(max_length=100)
    period = models.CharField(max_length=7)  # "YYYY-MM"
    inputs = models.JSONField(default=dict, blank=True)
    result = models.JSONField(default=dict, blank=True)
    engine_version = models.CharField(max_length=20)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        indexes = [models.Index(fields=["user", "kind", "period"])]
        ordering = ["-created_at"]

    def __str__(self) -> str:
        return f"{self.user_id}:{self.kind}:{self.period}"
