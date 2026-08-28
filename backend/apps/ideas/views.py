from rest_framework import generics
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from .models import ImprovementIdea
from .permissions import can_review_ideas
from .serializers import (
    IdeaCreateSerializer,
    IdeaDetailSerializer,
    IdeaHistoryEntrySerializer,
    IdeaListItemSerializer,
    IdeaProgressSerializer,
    IdeaSerializer,
    IdeaStatusActionSerializer,
)
from .services import change_idea_status, create_idea, get_visible_idea_author_ids, toggle_vote


def _idea_queryset():
    return ImprovementIdea.objects.select_related("author").prefetch_related("author__groups", "votes")


def _get_visible_idea(user, idea_id: int) -> ImprovementIdea | None:
    """`None` tanto si la idea no existe como si el autor no es
    visible para `user` — mismo mensaje "Idea no encontrada" para
    ambos casos, réplica fiel (no revela existencia)."""
    idea = _idea_queryset().filter(pk=idea_id).first()
    if idea is None:
        return None
    visible_ids = get_visible_idea_author_ids(user)
    if not visible_ids.filter(pk=idea.author_id).exists():
        return None
    return idea


class IdeaListCreateView(generics.GenericAPIView):
    """`GET/POST /api/v1/ideas/` — réplica de `route.ts`
    (`src/app/api/ideas/route.ts`) — Fase 11 (ver docs/AUDIT_LOG.md §
    2026-08-19). Crear una idea NO requiere ningún rol especial —
    cualquier usuario autenticado puede proponer una."""

    permission_classes = [IsAuthenticated]
    serializer_class = IdeaCreateSerializer

    def get(self, request):
        visible_ids = get_visible_idea_author_ids(request.user)
        ideas = _idea_queryset().filter(author_id__in=visible_ids).order_by("-created_at")
        serializer = IdeaListItemSerializer(ideas, many=True, context={"request": request})
        return Response(serializer.data)

    def post(self, request):
        serializer = self.get_serializer(data=request.data)
        if not serializer.is_valid():
            return Response({"error": "Faltan campos requeridos o son inválidos"}, status=400)

        data = serializer.validated_data
        idea = create_idea(
            author=request.user, title=data["title"], description=data["description"], impact=data["impact"],
            attachment_name=data.get("attachment_name"), attachment_mime=data.get("attachment_mime"),
            attachment_data=data.get("attachment_data"),
        )
        idea = _idea_queryset().get(pk=idea.id)
        return Response(IdeaSerializer(idea, context={"request": request}).data, status=201)


class IdeaDetailView(generics.GenericAPIView):
    """`GET/PATCH /api/v1/ideas/<idea_id>/` — réplica de `route.ts`
    (`src/app/api/ideas/[id]/route.ts`) — Fase 11 (ver docs/AUDIT_LOG.md
    § 2026-08-19). `GET` es de lectura general (cualquiera con
    visibilidad sobre el autor); `PATCH` (actualizar `progress`, NO el
    `status`) requiere `can_review_ideas`."""

    permission_classes = [IsAuthenticated]
    serializer_class = IdeaProgressSerializer

    def get(self, request, idea_id: int):
        idea = _get_visible_idea(request.user, idea_id)
        if idea is None:
            return Response({"error": "Idea no encontrada"}, status=404)

        data = IdeaDetailSerializer(idea, context={"request": request}).data
        if idea.status != ImprovementIdea.Status.PROPUESTA:
            data["attachment_name"] = None
            data["attachment_mime"] = None
            data["attachment_data"] = None
        return Response(data)

    def patch(self, request, idea_id: int):
        if not can_review_ideas(request.user):
            return Response({"error": "Sin permisos para actualizar el progreso"}, status=403)

        serializer = self.get_serializer(data=request.data)
        if not serializer.is_valid():
            return Response({"error": "Progreso inválido (debe ser un entero entre 0 y 100)"}, status=400)

        idea = _get_visible_idea(request.user, idea_id)
        if idea is None:
            return Response({"error": "Idea no encontrada"}, status=404)

        idea.progress = serializer.validated_data["progress"]
        idea.save(update_fields=["progress", "updated_at"])
        idea = _idea_queryset().get(pk=idea.id)
        return Response(IdeaDetailSerializer(idea, context={"request": request}).data)


class IdeaVoteView(generics.GenericAPIView):
    """`POST /api/v1/ideas/<idea_id>/vote/` — toggle de voto, réplica
    de `route.ts` (`src/app/api/ideas/[id]/vote/route.ts`) — Fase 11
    (ver docs/AUDIT_LOG.md § 2026-08-19). Sin restricción de rol:
    cualquier usuario con visibilidad sobre el autor puede votar."""

    permission_classes = [IsAuthenticated]

    def post(self, request, idea_id: int):
        idea = _get_visible_idea(request.user, idea_id)
        if idea is None:
            return Response({"error": "Idea no encontrada"}, status=404)

        vote_count, voted_by_me = toggle_vote(idea=idea, user=request.user)
        return Response({"vote_count": vote_count, "voted_by_me": voted_by_me})


class IdeaStatusView(generics.GenericAPIView):
    """`PATCH /api/v1/ideas/<idea_id>/status/` — máquina de estados,
    réplica de `route.ts` (`src/app/api/ideas/[id]/status/route.ts`) —
    Fase 11 (ver docs/AUDIT_LOG.md § 2026-08-19). A diferencia del
    resto de las rutas de detalle, ESTA no filtra por visibilidad del
    autor (solo `can_review_ideas`) — asimetría real del TS original,
    replicada fiel (ver docs/AUDIT_LOG.md para el detalle)."""

    permission_classes = [IsAuthenticated]
    serializer_class = IdeaStatusActionSerializer

    def patch(self, request, idea_id: int):
        if not can_review_ideas(request.user):
            return Response({"error": "Sin permisos para mover ideas"}, status=403)

        idea = _idea_queryset().filter(pk=idea_id).first()
        if idea is None:
            return Response({"error": "Idea no encontrada"}, status=404)

        serializer = self.get_serializer(data=request.data)
        if not serializer.is_valid():
            return Response({"error": "Acción inválida"}, status=400)

        try:
            idea = change_idea_status(
                idea=idea, actor=request.user,
                action=serializer.validated_data["action"], comment=serializer.validated_data.get("comment"),
            )
        except ValueError as exc:
            return Response({"error": str(exc)}, status=400)

        idea = _idea_queryset().get(pk=idea.id)
        return Response(IdeaSerializer(idea, context={"request": request}).data)


class IdeaHistoryView(generics.GenericAPIView):
    """`GET /api/v1/ideas/<idea_id>/history/` — réplica de `route.ts`
    (`src/app/api/ideas/[id]/history/route.ts`) — Fase 11 (ver
    docs/AUDIT_LOG.md § 2026-08-19)."""

    permission_classes = [IsAuthenticated]

    def get(self, request, idea_id: int):
        idea = _get_visible_idea(request.user, idea_id)
        if idea is None:
            return Response({"error": "Idea no encontrada"}, status=404)

        history = idea.history.select_related("changed_by").prefetch_related("changed_by__groups").order_by("created_at")
        return Response(IdeaHistoryEntrySerializer(history, many=True).data)
