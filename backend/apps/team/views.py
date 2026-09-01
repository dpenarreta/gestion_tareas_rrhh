"""Equipo — Fase 18 de la migración de stack (ver docs/AUDIT_LOG.md §
2026-08-20). Réplica de `src/app/api/team/route.ts` y
`src/app/api/team/[userId]/tasks/route.ts`. Primer módulo de negocio
nuevo desde Notificaciones (Fase 15) — sin dependencia del motor de
Analytics, solo `apps.hierarchy`/`apps.tasks`. Sin cutover de
`route.ts` todavía."""

from django.db.models import Count
from django.shortcuts import get_object_or_404
from rest_framework import generics
from rest_framework.response import Response

from apps.core.mask_email import mask_email
from apps.hierarchy.services import get_role_group, get_subordinate_groups
from apps.tasks.models import Task
from apps.users.models import User

from .permissions import TeamPermission


def _role_name(user) -> str:
    group = get_role_group(user)
    return group.name if group else ""


class TeamListView(generics.GenericAPIView):
    """`GET /api/v1/team/` — lista de subordinados visibles con conteo
    de tareas por estado y email enmascarado (`mask_email`), réplica
    exacta de `route.ts`. `getSubordinateRoles` (TS, sin filtro
    ejecutor/liderazgo) equivale a `get_subordinate_groups` — a
    diferencia de las rutas de Analytics de equipo (`kpis/team`, Fase
    19 futura), que SÍ excluyen roles de liderazgo (Sprint 0A,
    `isExecutorRole`)."""

    permission_classes = [TeamPermission]

    def get(self, request):
        groups = get_subordinate_groups(request.user)
        members = list(User.objects.filter(groups__in=groups).distinct().prefetch_related("groups"))
        members.sort(key=lambda m: m.first_name or m.username)
        member_ids = [m.id for m in members]

        counts: dict[int, dict[str, int]] = {}
        for row in Task.objects.filter(assigned_to_id__in=member_ids).values("assigned_to_id", "status"):
            entry = counts.setdefault(row["assigned_to_id"], {"total": 0, "completed": 0, "in_progress": 0, "pending": 0})
            entry["total"] += 1
            if row["status"] == Task.Status.COMPLETADA:
                entry["completed"] += 1
            elif row["status"] == Task.Status.EN_PROGRESO:
                entry["in_progress"] += 1
            elif row["status"] == Task.Status.PENDIENTE:
                entry["pending"] += 1

        empty_counts = {"total": 0, "completed": 0, "in_progress": 0, "pending": 0}
        payload = [
            {
                "id": m.id,
                "name": m.first_name or m.username,
                "email": mask_email(m.email),
                "role": _role_name(m),
                "tasks": counts.get(m.id, empty_counts),
            }
            for m in members
        ]
        return Response(payload)


def _serialize_team_member_task(task: Task, assigned_to_role: str) -> dict:
    return {
        "id": task.id,
        "title": task.title,
        "description": task.description,
        "type": task.type,
        "status": task.status,
        "priority": task.priority,
        "frequency": task.frequency,
        "start_date": task.start_date.isoformat(),
        "end_date": task.end_date.isoformat(),
        "estimated_hours": task.estimated_hours,
        "real_hours": task.real_hours,
        "target_time_validated": task.target_time_validated,
        "progress": task.progress,
        "color": task.color,
        "corrected": task.corrected,
        # Réplica fiel del `taskSelect` original: el email del asignado va SIN
        # enmascarar acá (a diferencia de `TeamListView`) — quien ve esta lista
        # ya es su superior directo, mismo criterio que el TS.
        "assigned_to": {
            "id": task.assigned_to_id,
            "name": task.assigned_to.first_name or task.assigned_to.username,
            "email": task.assigned_to.email,
            "role": assigned_to_role,
        },
        "created_by": {"id": task.created_by_id, "name": task.created_by.first_name or task.created_by.username},
        "comment_count": task.comment_count,
        "created_at": task.created_at.isoformat(),
        "updated_at": task.updated_at.isoformat(),
    }


class TeamMemberTasksView(generics.GenericAPIView):
    """`GET /api/v1/team/<user_id>/tasks/` — tareas activas (no
    archivadas) de un subordinado puntual, réplica exacta de
    `route.ts`. Nota del propio TS: esta ruta NO se migró en el
    cutover de Tareas (Fase 3a) porque Django solo expone las tareas
    del propio usuario autenticado, no las de un tercero — sigue
    siendo la única forma de ver la lista completa de tareas de un
    subordinado. 401→403(`can_view_team`)→404(usuario)→403(rol no
    subordinado)→200, mismo orden que el original."""

    permission_classes = [TeamPermission]

    def get(self, request, user_id: int):
        target = get_object_or_404(User, pk=user_id)
        target_group = get_role_group(target)
        subordinate_groups = get_subordinate_groups(request.user)
        if target_group is None or target_group not in subordinate_groups:
            return Response({"error": "Sin permisos para ver este usuario"}, status=403)

        tasks = (
            Task.objects.filter(assigned_to=target, archived_month__isnull=True)
            .select_related("assigned_to", "created_by")
            .annotate(comment_count=Count("comments"))
            .order_by("-created_at")
        )
        assigned_to_role = target_group.name
        return Response([_serialize_team_member_task(t, assigned_to_role) for t in tasks])
