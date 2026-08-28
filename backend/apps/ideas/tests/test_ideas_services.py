"""Cobertura de apps.ideas.services — Fase 11 (ver docs/AUDIT_LOG.md §
2026-08-19), réplica de src/lib/ideas.ts y los handlers de creación/
cambio de estado/voto."""

import pytest
from django.contrib.auth.models import Group

from apps.ideas.models import IdeaStatusHistory, IdeaVote, ImprovementIdea
from apps.ideas.services import (
    can_reject,
    change_idea_status,
    create_idea,
    get_visible_idea_author_ids,
    next_idea_status,
    prev_idea_status,
    toggle_vote,
)
from apps.notifications.models import Notification
from apps.users.models import User

pytestmark = pytest.mark.django_db


def _user_with_group(username: str, group_name: str) -> User:
    user = User.objects.create_user(username=username, email=f"{username}@example.com", password="Sup3r-Secr3t!")
    user.groups.set([Group.objects.get(name=group_name)])
    return user


def _idea(author, **overrides) -> ImprovementIdea:
    defaults = {"title": "Idea", "description": "Desc", "impact": ImprovementIdea.Impact.MEDIO, "author": author}
    defaults.update(overrides)
    return ImprovementIdea.objects.create(**defaults)


# --- next_idea_status / prev_idea_status / can_reject ---------------------------


def test_next_idea_status_advances_one_step():
    assert next_idea_status(ImprovementIdea.Status.PROPUESTA) == ImprovementIdea.Status.EN_REVISION


def test_next_idea_status_none_at_the_end():
    assert next_idea_status(ImprovementIdea.Status.IMPLEMENTADA) is None


def test_next_idea_status_none_for_rechazada_outside_linear_order():
    assert next_idea_status(ImprovementIdea.Status.RECHAZADA) is None


def test_prev_idea_status_retreats_one_step():
    assert prev_idea_status(ImprovementIdea.Status.EN_REVISION) == ImprovementIdea.Status.PROPUESTA


def test_prev_idea_status_none_at_the_start():
    assert prev_idea_status(ImprovementIdea.Status.PROPUESTA) is None


def test_can_reject_true_for_any_status_except_implementada_and_rechazada():
    assert can_reject(ImprovementIdea.Status.PROPUESTA) is True
    assert can_reject(ImprovementIdea.Status.EN_PRUEBAS) is True


def test_can_reject_false_for_implementada_and_rechazada():
    assert can_reject(ImprovementIdea.Status.IMPLEMENTADA) is False
    assert can_reject(ImprovementIdea.Status.RECHAZADA) is False


# --- get_visible_idea_author_ids -------------------------------------------------


def test_level_one_role_sees_only_self():
    asistente = _user_with_group("asist", "ASISTENTE_GH")
    other = _user_with_group("other", "ASISTENTE_GH")
    visible = set(get_visible_idea_author_ids(asistente).values_list("id", flat=True))
    assert visible == {asistente.id}
    assert other.id not in visible


def test_jefe_nacional_sees_everyone_except_administrador():
    jefe = _user_with_group("jefe", "JEFE_NACIONAL")
    admin_group_user = _user_with_group("admin_group", "ADMINISTRADOR")
    asistente = _user_with_group("asist2", "ASISTENTE_NOMINA")
    visible = set(get_visible_idea_author_ids(jefe).values_list("id", flat=True))
    assert jefe.id in visible
    assert asistente.id in visible
    assert admin_group_user.id not in visible


def test_coordinador_nacional_sees_everyone_except_administrador():
    coord = _user_with_group("coord", "COORDINADOR_NACIONAL")
    jefe = _user_with_group("jefe2", "JEFE_NACIONAL")
    visible = set(get_visible_idea_author_ids(coord).values_list("id", flat=True))
    # Excepción a la jerarquía general: Coordinador Nacional SÍ ve a Jefe Nacional.
    assert jefe.id in visible


def test_administrador_group_sees_absolutely_everyone_including_self():
    admin_group_user = _user_with_group("admin3", "ADMINISTRADOR")
    other = _user_with_group("other3", "ASISTENTE_GH")
    visible = set(get_visible_idea_author_ids(admin_group_user).values_list("id", flat=True))
    assert admin_group_user.id in visible
    assert other.id in visible


def test_superuser_without_any_group_sees_everyone():
    superuser = User.objects.create_user(username="root", email="root@example.com", password="Sup3r-Secr3t!")
    superuser.is_superuser = True
    superuser.save()
    other = _user_with_group("other4", "ASISTENTE_GH")
    visible = set(get_visible_idea_author_ids(superuser).values_list("id", flat=True))
    assert other.id in visible


def test_mid_level_role_uses_standard_hierarchy():
    analista = _user_with_group("analista", "ANALISTA_CC")
    asistente_gh = _user_with_group("asist_gh", "ASISTENTE_GH")
    asistente_seleccion = _user_with_group("asist_sel", "ASISTENTE_SELECCION")
    visible = set(get_visible_idea_author_ids(analista).values_list("id", flat=True))
    assert analista.id in visible
    assert asistente_gh.id in visible
    assert asistente_seleccion.id not in visible


# --- create_idea -------------------------------------------------------------------


def test_create_idea_notifies_all_reviewers():
    author = _user_with_group("autor", "ASISTENTE_GH")
    jefe = _user_with_group("jefe3", "JEFE_NACIONAL")
    coord = _user_with_group("coord3", "COORDINADOR_NACIONAL")
    non_reviewer = _user_with_group("nonrev", "ANALISTA_CC")

    idea = create_idea(
        author=author, title="Mejorar X", description="Detalle", impact=ImprovementIdea.Impact.ALTO,
        attachment_name=None, attachment_mime=None, attachment_data=None,
    )
    assert idea.status == ImprovementIdea.Status.PROPUESTA
    notified_user_ids = set(Notification.objects.values_list("user_id", flat=True))
    assert jefe.id in notified_user_ids
    assert coord.id in notified_user_ids
    assert non_reviewer.id not in notified_user_ids
    notification = Notification.objects.get(user=jefe)
    assert notification.message == f'{author.first_name} propuso una nueva idea: "Mejorar X"'
    assert notification.task_title == "Mejorar X"


# --- change_idea_status -------------------------------------------------------------


def test_change_idea_status_advance_creates_history_and_updates_status():
    author = _user_with_group("autor2", "ASISTENTE_GH")
    reviewer = _user_with_group("rev", "JEFE_NACIONAL")
    idea = _idea(author)

    updated = change_idea_status(idea=idea, actor=reviewer, action="ADVANCE", comment=None)
    assert updated.status == ImprovementIdea.Status.EN_REVISION
    history = IdeaStatusHistory.objects.get(idea=idea)
    assert history.from_status == ImprovementIdea.Status.PROPUESTA
    assert history.to_status == ImprovementIdea.Status.EN_REVISION
    assert history.changed_by == reviewer


def test_change_idea_status_advance_from_last_step_raises():
    author = _user_with_group("autor3", "ASISTENTE_GH")
    reviewer = _user_with_group("rev2", "JEFE_NACIONAL")
    idea = _idea(author, status=ImprovementIdea.Status.IMPLEMENTADA)
    with pytest.raises(ValueError, match="No se puede avanzar"):
        change_idea_status(idea=idea, actor=reviewer, action="ADVANCE", comment=None)


def test_change_idea_status_reject_requires_comment():
    author = _user_with_group("autor4", "ASISTENTE_GH")
    reviewer = _user_with_group("rev3", "JEFE_NACIONAL")
    idea = _idea(author)
    with pytest.raises(ValueError, match="motivo del rechazo"):
        change_idea_status(idea=idea, actor=reviewer, action="REJECT", comment=None)


def test_change_idea_status_reject_from_implementada_raises():
    author = _user_with_group("autor5", "ASISTENTE_GH")
    reviewer = _user_with_group("rev4", "JEFE_NACIONAL")
    idea = _idea(author, status=ImprovementIdea.Status.IMPLEMENTADA)
    with pytest.raises(ValueError, match="No se puede rechazar"):
        change_idea_status(idea=idea, actor=reviewer, action="REJECT", comment="motivo")


def test_change_idea_status_reopen_only_from_rechazada():
    author = _user_with_group("autor6", "ASISTENTE_GH")
    reviewer = _user_with_group("rev5", "JEFE_NACIONAL")
    idea = _idea(author, status=ImprovementIdea.Status.EN_REVISION)
    with pytest.raises(ValueError, match="Sólo se puede reabrir"):
        change_idea_status(idea=idea, actor=reviewer, action="REOPEN", comment=None)


def test_change_idea_status_reopen_from_rechazada_moves_to_en_revision():
    author = _user_with_group("autor7", "ASISTENTE_GH")
    reviewer = _user_with_group("rev6", "JEFE_NACIONAL")
    idea = _idea(author, status=ImprovementIdea.Status.RECHAZADA)
    updated = change_idea_status(idea=idea, actor=reviewer, action="REOPEN", comment=None)
    assert updated.status == ImprovementIdea.Status.EN_REVISION


def test_change_idea_status_purges_attachment_when_leaving_propuesta():
    author = _user_with_group("autor8", "ASISTENTE_GH")
    reviewer = _user_with_group("rev7", "JEFE_NACIONAL")
    idea = _idea(author, attachment_name="a.png", attachment_mime="image/png", attachment_data="data:image/png;base64,AA==")
    updated = change_idea_status(idea=idea, actor=reviewer, action="ADVANCE", comment=None)
    assert updated.attachment_name is None
    assert updated.attachment_mime is None
    assert updated.attachment_data is None


def test_change_idea_status_keeps_attachment_when_not_leaving_propuesta():
    author = _user_with_group("autor9", "ASISTENTE_GH")
    reviewer = _user_with_group("rev8", "JEFE_NACIONAL")
    idea = _idea(
        author, status=ImprovementIdea.Status.EN_REVISION,
        attachment_name="a.png", attachment_mime="image/png", attachment_data="data:image/png;base64,AA==",
    )
    updated = change_idea_status(idea=idea, actor=reviewer, action="ADVANCE", comment=None)
    assert updated.attachment_name == "a.png"


def test_change_idea_status_notifies_author_when_someone_else_changes_it():
    author = _user_with_group("autor10", "ASISTENTE_GH")
    reviewer = _user_with_group("rev9", "JEFE_NACIONAL")
    idea = _idea(author)
    change_idea_status(idea=idea, actor=reviewer, action="ADVANCE", comment=None)
    notification = Notification.objects.get(user=author)
    assert "pasó a En revisión" in notification.message


def test_change_idea_status_no_self_notification_when_author_changes_own_idea():
    author_reviewer = _user_with_group("autor_rev", "JEFE_NACIONAL")
    idea = _idea(author_reviewer)
    change_idea_status(idea=idea, actor=author_reviewer, action="ADVANCE", comment=None)
    assert Notification.objects.filter(user=author_reviewer).count() == 0


def test_change_idea_status_reject_message_includes_comment():
    author = _user_with_group("autor11", "ASISTENTE_GH")
    reviewer = _user_with_group("rev10", "JEFE_NACIONAL")
    idea = _idea(author)
    change_idea_status(idea=idea, actor=reviewer, action="REJECT", comment="No es viable")
    notification = Notification.objects.get(user=author)
    assert notification.message == 'Tu idea "Idea" fue rechazada: No es viable'


def test_change_idea_status_implemented_message_has_celebration_emoji():
    author = _user_with_group("autor12", "ASISTENTE_GH")
    reviewer = _user_with_group("rev11", "JEFE_NACIONAL")
    idea = _idea(author, status=ImprovementIdea.Status.EN_PRUEBAS)
    change_idea_status(idea=idea, actor=reviewer, action="ADVANCE", comment=None)
    notification = Notification.objects.get(user=author)
    assert "🎉" in notification.message


def test_change_idea_status_awards_innovador_badge_on_implementada():
    author = _user_with_group("autor13", "ASISTENTE_GH")
    reviewer = _user_with_group("rev12", "JEFE_NACIONAL")
    idea = _idea(author, status=ImprovementIdea.Status.EN_PRUEBAS)
    change_idea_status(idea=idea, actor=reviewer, action="ADVANCE", comment=None)
    author.refresh_from_db()
    assert author.badges == ["innovador"]


def test_change_idea_status_does_not_duplicate_innovador_badge():
    author = _user_with_group("autor14", "ASISTENTE_GH")
    author.badges = ["innovador"]
    author.save(update_fields=["badges"])
    reviewer = _user_with_group("rev13", "JEFE_NACIONAL")
    idea = _idea(author, status=ImprovementIdea.Status.EN_PRUEBAS)
    change_idea_status(idea=idea, actor=reviewer, action="ADVANCE", comment=None)
    author.refresh_from_db()
    assert author.badges == ["innovador"]


def test_change_idea_status_does_not_award_badge_for_non_implementada_transition():
    author = _user_with_group("autor15", "ASISTENTE_GH")
    reviewer = _user_with_group("rev14", "JEFE_NACIONAL")
    idea = _idea(author, status=ImprovementIdea.Status.PROPUESTA)
    change_idea_status(idea=idea, actor=reviewer, action="ADVANCE", comment=None)
    author.refresh_from_db()
    assert author.badges == []


# --- toggle_vote ---------------------------------------------------------------------


def test_toggle_vote_creates_then_removes():
    author = _user_with_group("autor13", "ASISTENTE_GH")
    voter = _user_with_group("voter", "ASISTENTE_GH")
    idea = _idea(author)

    count, voted = toggle_vote(idea=idea, user=voter)
    assert (count, voted) == (1, True)
    assert IdeaVote.objects.filter(idea=idea, user=voter).exists()

    count, voted = toggle_vote(idea=idea, user=voter)
    assert (count, voted) == (0, False)
    assert not IdeaVote.objects.filter(idea=idea, user=voter).exists()
