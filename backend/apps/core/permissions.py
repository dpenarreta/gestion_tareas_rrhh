from rest_framework.permissions import IsAuthenticated


class IsAdministrador(IsAuthenticated):
    """Solo ADMINISTRADOR (`is_superuser` — mismo bypass ya establecido
    desde la Fase 1: ADMINISTRADOR no recibe permisos del catálogo, el
    bypass real es `is_superuser`). Vive en `apps.core` porque ninguna
    app de dominio es su dueña natural — usado hoy por
    `TaskViewSet.correct` (Fase 3d, ver docs/AUDIT_LOG.md § 2026-08-07),
    más estrecho que `usuarios.editar`/`CanCloseMonth`."""

    def has_permission(self, request, view) -> bool:
        if not super().has_permission(request, view):
            return False
        return request.user.is_superuser
