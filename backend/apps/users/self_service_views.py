"""Auto-servicio de usuario — Fases 26/27 de la migración de stack (ver
docs/AUDIT_LOG.md § 2026-08-20). Réplica exacta de `src/app/api/users/
assignable/route.ts`, `src/app/api/users/[id]/theme/route.ts` y
`src/app/api/profile/badges/route.ts`. Deliberadamente SEPARADO de
`UserAdminViewSet` (`views.py`, montado en `admin/users/`): son 2
superficies distintas del mismo modelo — esta es de auto-servicio
(cualquier autenticado, sin permiso administrativo), esa es de
administración (catálogo de permisos `usuarios.*`)."""

from django.utils import timezone
from rest_framework import generics
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.hierarchy.services import get_visible_groups

from .badges import compute_and_persist_badges
from .models import User


class AssignableUsersView(generics.GenericAPIView):
    """`GET /api/v1/users/assignable/` — réplica exacta de
    `users/assignable/route.ts`: usuarios visibles para el actor
    (INCLUYE al propio actor, a diferencia de otros consumidores de
    `get_visible_groups` como el Dashboard), usado para poblar
    selectores de asignación de tareas."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        visible_groups = get_visible_groups(request.user)
        users = (
            User.objects.filter(groups__in=visible_groups)
            .distinct()
            .prefetch_related("groups")
            .order_by("first_name", "username")
        )
        payload = [
            {
                "id": u.id,
                "name": u.first_name or u.username,
                "email": u.email,
                "role": (u.groups.all()[0].name if u.groups.all() else ""),
            }
            for u in users
        ]
        return Response(payload)


class UserThemeView(generics.GenericAPIView):
    """`PATCH /api/v1/users/<id>/theme/` — réplica exacta de
    `users/[id]/theme/route.ts`: solo el propio usuario puede cambiar
    su tema."""

    permission_classes = [IsAuthenticated]

    def patch(self, request, pk: int):
        if pk != request.user.id:
            return Response({"error": "Sin permisos"}, status=403)

        theme = request.data.get("theme")
        if theme not in User.Theme.values:
            return Response({"error": "theme debe ser LIGHT o DARK"}, status=400)

        request.user.theme = theme
        request.user.save(update_fields=["theme"])
        return Response({"theme": request.user.theme})


class UserViewPreferencesView(generics.GenericAPIView):
    """`PATCH /api/v1/users/<id>/view-preferences/` — réplica exacta de
    `users/[id]/view-preferences/route.ts` (Fase 55, ver
    docs/AUDIT_LOG.md § 2026-08-25): solo el propio usuario puede
    guardar sus vistas de Tareas preferidas (KANBAN/TABLA/...).

    Réplica FIEL de un bug preexistente del TS legacy, documentado y
    deliberadamente NO corregido acá: reemplaza `view_preferences` por
    completo, sin fusionar con otras claves de prefijo
    (`ACTIVITY_FORMAT:`/`DASHBOARD_CARDS:`/`CONFIG_FAVORITE:`) que
    convivan en el mismo array — a diferencia de `FavoritesView`/
    `DashboardCardOrderView`/`ActivityFormatView`, que sí las
    preservan.

    `GET` es ADITIVO, sin equivalente exacto en el TS legacy (que nunca
    tuvo esta ruta como `GET`): cierra el gap explícito documentado
    desde la Fase 3a en `tasks/page.tsx` — antes leía `viewPreferences`
    directo de Prisma para las vistas iniciales de Tareas y el formato
    de actividad; con este cutover necesita una forma de leer el array
    completo de Django."""

    permission_classes = [IsAuthenticated]

    def get(self, request, pk: int):
        if pk != request.user.id:
            return Response({"error": "Sin permisos"}, status=403)
        return Response({"view_preferences": request.user.view_preferences})

    def patch(self, request, pk: int):
        if pk != request.user.id:
            return Response({"error": "Sin permisos"}, status=403)

        view_preferences = request.data.get("viewPreferences")
        if not isinstance(view_preferences, list) or not view_preferences:
            return Response({"error": "viewPreferences debe ser un array con al menos una vista"}, status=400)

        request.user.view_preferences = view_preferences
        request.user.save(update_fields=["view_preferences"])
        return Response({"view_preferences": request.user.view_preferences})


_ACTIVITY_FORMAT_PREFIX = "ACTIVITY_FORMAT:"


class ActivityFormatView(generics.GenericAPIView):
    """`GET/PATCH /api/v1/users/activity-format/` — réplica exacta de
    la porción de `auth/me/route.ts` que lee/escribe `activityFormat`
    (Fase 55, ver docs/AUDIT_LOG.md § 2026-08-25 — cierra la excepción
    híbrida documentada desde la Fase 6b). Mismo truco de prefijo sobre
    `view_preferences` que `FavoritesView`/`DashboardCardOrderView`
    (`apps.configuration`/`apps.dashboard`), siempre sobre el propio
    actor — no existe un equivalente de "ver el de otro usuario"."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        return Response({"activity_format": self._read(request.user)})

    def patch(self, request):
        value = request.data.get("activity_format")
        if value not in ("duration", "timerange"):
            return Response({"error": "Formato de actividad inválido"}, status=400)

        existing = [v for v in request.user.view_preferences if not v.startswith(_ACTIVITY_FORMAT_PREFIX)]
        request.user.view_preferences = [*existing, f"{_ACTIVITY_FORMAT_PREFIX}{value}"]
        request.user.save(update_fields=["view_preferences"])
        return Response({"activity_format": value})

    @staticmethod
    def _read(user) -> str:
        pref = next((v for v in user.view_preferences if v.startswith(_ACTIVITY_FORMAT_PREFIX)), None)
        value = pref[len(_ACTIVITY_FORMAT_PREFIX):] if pref else None
        return "timerange" if value == "timerange" else "duration"


class BadgesView(generics.GenericAPIView):
    """`GET /api/v1/profile/badges/` — réplica exacta de `profile/
    badges/route.ts`: calcula las 6 insignias del actor, persiste las
    recién ganadas en `User.badges` y devuelve estadísticas de racha."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        return Response(compute_and_persist_badges(user=request.user, now=timezone.now()))
