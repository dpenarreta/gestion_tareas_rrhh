"""Puerto de `src/lib/mask-email.ts` — Fase 18 de la migración de stack
(ver docs/AUDIT_LOG.md § 2026-08-20). Primer consumidor: `apps.team`
(`GET /team/`, réplica de `maskEmail` sin condición). `maskEmailUnless`
(usada por Proyectos en el TS — `canSeeRealEmails`) no se porta todavía:
el `ProjectViewSet`/`ProjectSerializer` ya cortados a Django (Fase 5)
NO enmascaran el email en ningún punto — gap preexistente detectado
durante esta fase, fuera de alcance (tocaría un módulo ya en producción
sin que se pidiera), documentado en docs/AUDIT_LOG.md."""


def mask_email(email: str) -> str:
    """Réplica exacta de `maskEmail` — conserva el primer carácter de la
    parte local y de la etiqueta de dominio, enmascara el resto (hasta 5
    asteriscos), conserva el resto del dominio (`.com`, etc.) intacto."""
    at = email.find("@")
    if at == -1:
        return email

    local = email[:at]
    domain = email[at + 1 :]
    dot = domain.find(".")
    label = domain if dot == -1 else domain[:dot]
    rest = "" if dot == -1 else domain[dot:]

    def _mask(part: str) -> str:
        if len(part) <= 1:
            return part
        return part[0] + "*" * min(len(part) - 1, 5)

    return f"{_mask(local)}@{_mask(label)}{rest}"
