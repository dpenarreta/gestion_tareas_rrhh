"""Orquestación de Mejora Continua — Fase 11 (ver docs/AUDIT_LOG.md §
2026-08-19). Réplica exacta de `src/lib/ideas.ts` (visibilidad,
máquina de estados) y de los handlers `POST /api/ideas`/`PATCH
/api/ideas/[id]/status`."""

from django.db.models import Q, QuerySet

from apps.hierarchy.services import get_visible_groups, role_level
from apps.notifications.services import notify, notify_many
from apps.users.models import User

from .models import IdeaStatusHistory, IdeaVote, ImprovementIdea
from .permissions import role_name

IDEA_STATUS_LABELS = {
    ImprovementIdea.Status.PROPUESTA: "Propuesta",
    ImprovementIdea.Status.EN_REVISION: "En revisión",
    ImprovementIdea.Status.APROBADA: "Aprobada",
    ImprovementIdea.Status.EN_DESARROLLO: "En desarrollo",
    ImprovementIdea.Status.EN_PRUEBAS: "En pruebas",
    ImprovementIdea.Status.IMPLEMENTADA: "Implementada",
    ImprovementIdea.Status.RECHAZADA: "Rechazada",
}

# Máquina de estados lineal — NO incluye RECHAZADA (estado lateral,
# alcanzable desde cualquiera de estos salvo IMPLEMENTADA, ver
# `can_reject`). Réplica exacta de `IDEA_STATUS_ORDER`.
IDEA_STATUS_ORDER = [
    ImprovementIdea.Status.PROPUESTA,
    ImprovementIdea.Status.EN_REVISION,
    ImprovementIdea.Status.APROBADA,
    ImprovementIdea.Status.EN_DESARROLLO,
    ImprovementIdea.Status.EN_PRUEBAS,
    ImprovementIdea.Status.IMPLEMENTADA,
]


def next_idea_status(current: str) -> str | None:
    if current not in IDEA_STATUS_ORDER:
        return None
    idx = IDEA_STATUS_ORDER.index(current)
    if idx == len(IDEA_STATUS_ORDER) - 1:
        return None
    return IDEA_STATUS_ORDER[idx + 1]


def prev_idea_status(current: str) -> str | None:
    if current not in IDEA_STATUS_ORDER:
        return None
    idx = IDEA_STATUS_ORDER.index(current)
    if idx <= 0:
        return None
    return IDEA_STATUS_ORDER[idx - 1]


def can_reject(current: str) -> bool:
    return current not in (ImprovementIdea.Status.IMPLEMENTADA, ImprovementIdea.Status.RECHAZADA)


def get_visible_idea_author_ids(user) -> QuerySet:
    """Réplica exacta de `getVisibleIdeaAuthorIds`. Devuelve un
    `QuerySet` de `User.id` visibles como autores de ideas para `user`.

    `role_name(user)` ya trata `is_superuser` como ADMINISTRADOR (igual
    que el resto del backend) — a diferencia del TS, que compara contra
    un único campo `role` de enum, acá hay que cubrir explícitamente el
    caso de un superusuario sin ningún `Group` asignado (no lo cubre
    `get_visible_groups`, que depende de `user.groups.first()`)."""
    role = role_name(user)

    if role_level(user) == 1:
        return User.objects.filter(pk=user.id)

    # Mejora Continua es una excepción a la jerarquía general: Jefe
    # Nacional y Coordinador Nacional ven TODAS las ideas (el
    # Administrador es invisible para el resto, incluso en esta
    # excepción) — a diferencia de KPIs/Analytics/Informes.
    if role in ("JEFE_NACIONAL", "COORDINADOR_NACIONAL"):
        return User.objects.exclude(Q(groups__name="ADMINISTRADOR") | Q(is_superuser=True)).distinct()

    if role == "ADMINISTRADOR":
        return User.objects.all()

    visible_groups = get_visible_groups(user)
    if not visible_groups:
        return User.objects.none()
    return User.objects.filter(groups__in=visible_groups).distinct()


def create_idea(
    *, author, title: str, description: str, impact: str,
    attachment_name: str | None, attachment_mime: str | None, attachment_data: str | None,
) -> ImprovementIdea:
    """Réplica exacta del handler `POST /api/ideas`: notifica a TODOS
    los usuarios que pueden revisar ideas (`mejora_continua.revisar`,
    catálogo dinámico de permisos — ver docs/AUDIT_LOG.md § 2026-09-01).
    `is_superuser=True` (ADMINISTRADOR) se incluye aparte: ese rol nunca
    tiene el permiso sembrado explícitamente, su bypass es estructural."""
    idea = ImprovementIdea.objects.create(
        title=title, description=description, impact=impact, author=author,
        attachment_name=attachment_name, attachment_mime=attachment_mime, attachment_data=attachment_data,
    )
    reviewers = User.objects.filter(
        Q(groups__permissions__codename="mejora_continua.revisar") | Q(is_superuser=True)
    ).distinct()
    notify_many(
        users=reviewers,
        message=f'{author.first_name} propuso una nueva idea: "{title}"',
        task_title=title,
    )
    return idea


def change_idea_status(*, idea: ImprovementIdea, actor, action: str, comment: str | None) -> ImprovementIdea:
    """Réplica exacta del handler `PATCH /api/ideas/[id]/status`: crea
    el registro de historial, actualiza el estado (y purga el adjunto
    si salía de PROPUESTA), notifica al autor (si no fue quien hizo el
    cambio) y, si el nuevo estado es IMPLEMENTADA, asigna el badge
    "innovador" al autor (una sola vez — gap cerrado en la Fase 27, ver
    docs/AUDIT_LOG.md § 2026-08-20, ahora que `User.badges` existe
    desde la Fase 25)."""
    from_status = idea.status

    if action == "ADVANCE":
        to_status = next_idea_status(from_status)
        if to_status is None:
            raise ValueError("No se puede avanzar desde esta etapa")
    elif action == "RETREAT":
        to_status = prev_idea_status(from_status)
        if to_status is None:
            raise ValueError("No se puede retroceder desde esta etapa")
    elif action == "REJECT":
        if not can_reject(from_status):
            raise ValueError("No se puede rechazar esta idea desde su etapa actual")
        if not comment:
            raise ValueError("El motivo del rechazo es obligatorio")
        to_status = ImprovementIdea.Status.RECHAZADA
    elif action == "REOPEN":
        if from_status != ImprovementIdea.Status.RECHAZADA:
            raise ValueError("Sólo se puede reabrir una idea rechazada")
        to_status = ImprovementIdea.Status.EN_REVISION
    else:
        raise ValueError("Acción inválida")

    if action == "REJECT":
        message = f'Tu idea "{idea.title}" fue rechazada: {comment}'
    elif to_status == ImprovementIdea.Status.IMPLEMENTADA:
        message = f'🎉 ¡Felicidades! Tu idea "{idea.title}" fue implementada'
    else:
        message = f'Tu idea "{idea.title}" pasó a {IDEA_STATUS_LABELS[to_status]}'

    IdeaStatusHistory.objects.create(idea=idea, from_status=from_status, to_status=to_status, changed_by=actor, comment=comment)
    idea.status = to_status
    if from_status == ImprovementIdea.Status.PROPUESTA:
        idea.attachment_name = None
        idea.attachment_mime = None
        idea.attachment_data = None
    idea.save()

    if idea.author_id != actor.id:
        notify(user=idea.author, message=message, task_title=idea.title)

    if to_status == ImprovementIdea.Status.IMPLEMENTADA and "innovador" not in idea.author.badges:
        idea.author.badges = [*idea.author.badges, "innovador"]
        idea.author.save(update_fields=["badges"])

    return idea


def toggle_vote(*, idea: ImprovementIdea, user) -> tuple[int, bool]:
    """Réplica exacta de `POST /api/ideas/[id]/vote`: toggle simple.
    Devuelve `(vote_count, voted_by_me)`."""
    existing = IdeaVote.objects.filter(idea=idea, user=user).first()
    if existing:
        existing.delete()
    else:
        IdeaVote.objects.create(idea=idea, user=user)
    vote_count = IdeaVote.objects.filter(idea=idea).count()
    return vote_count, existing is None
