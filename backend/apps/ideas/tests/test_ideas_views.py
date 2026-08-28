"""Cobertura HTTP de `/api/v1/ideas/` — Fase 11 (ver docs/AUDIT_LOG.md
§ 2026-08-19), réplica de los 5 `route.ts` de `src/app/api/ideas/**`."""

import pytest
from django.contrib.auth.models import Group
from rest_framework.test import APIClient

from apps.ideas.models import ImprovementIdea
from apps.users.models import User

pytestmark = pytest.mark.django_db


def _client_for(user: User) -> APIClient:
    client = APIClient()
    client.force_authenticate(user=user)
    return client


def _user_with_group(username: str, group_name: str) -> User:
    user = User.objects.create_user(username=username, email=f"{username}@example.com", password="Sup3r-Secr3t!")
    user.groups.set([Group.objects.get(name=group_name)])
    return user


@pytest.fixture
def author():
    return _user_with_group("author", "ASISTENTE_GH")


@pytest.fixture
def reviewer():
    return _user_with_group("reviewer", "JEFE_NACIONAL")


def _idea(author, **overrides) -> ImprovementIdea:
    defaults = {"title": "Idea", "description": "Desc", "impact": ImprovementIdea.Impact.MEDIO, "author": author}
    defaults.update(overrides)
    return ImprovementIdea.objects.create(**defaults)


# --- IdeaListCreateView.get -------------------------------------------------------


def test_list_requires_authentication():
    response = APIClient().get("/api/v1/ideas/")
    assert response.status_code == 401


def test_list_scoped_to_visible_authors(author, reviewer):
    _idea(author)
    other_leaf = _user_with_group("other_leaf", "ASISTENTE_GH")
    other_leaf_idea_author = other_leaf
    _idea(other_leaf_idea_author)
    # `author` (nivel 1) solo ve las propias.
    response = _client_for(author).get("/api/v1/ideas/")
    assert response.status_code == 200
    assert len(response.data) == 1
    # `reviewer` (JEFE_NACIONAL) ve todas.
    response = _client_for(reviewer).get("/api/v1/ideas/")
    assert len(response.data) == 2


def test_list_orders_by_created_at_descending(author):
    first = _idea(author, title="Primera")
    second = _idea(author, title="Segunda")
    response = _client_for(author).get("/api/v1/ideas/")
    assert [i["id"] for i in response.data] == [second.id, first.id]


# --- IdeaListCreateView.post ------------------------------------------------------


def test_create_400_for_blank_title(author):
    response = _client_for(author).post(
        "/api/v1/ideas/", {"title": "  ", "description": "Desc", "impact": "ALTO"}, format="json"
    )
    assert response.status_code == 400


def test_create_400_for_invalid_impact(author):
    response = _client_for(author).post(
        "/api/v1/ideas/", {"title": "T", "description": "D", "impact": "URGENTE"}, format="json"
    )
    assert response.status_code == 400


def test_create_201_any_authenticated_user(author):
    response = _client_for(author).post(
        "/api/v1/ideas/", {"title": "Nueva idea", "description": "Desc", "impact": "ALTO"}, format="json"
    )
    assert response.status_code == 201
    assert response.data["status"] == ImprovementIdea.Status.PROPUESTA
    assert response.data["vote_count"] == 0
    assert response.data["voted_by_me"] is False


def test_create_400_for_attachment_with_disallowed_extension(author):
    response = _client_for(author).post(
        "/api/v1/ideas/",
        {
            "title": "T", "description": "D", "impact": "ALTO",
            "attachment_name": "virus.exe", "attachment_mime": "application/octet-stream",
            "attachment_data": "data:application/octet-stream;base64,AA==",
        },
        format="json",
    )
    assert response.status_code == 400


# --- IdeaDetailView.get -----------------------------------------------------------


def test_detail_404_for_missing_idea(author):
    response = _client_for(author).get("/api/v1/ideas/999999/")
    assert response.status_code == 404


def test_detail_404_for_non_visible_author(author):
    idea = _idea(author)
    other_leaf = _user_with_group("outsider", "TRABAJO_SOCIAL")
    response = _client_for(other_leaf).get(f"/api/v1/ideas/{idea.id}/")
    assert response.status_code == 404


def test_detail_masks_attachment_outside_propuesta(author):
    idea = _idea(
        author, status=ImprovementIdea.Status.EN_REVISION,
        attachment_name="a.png", attachment_mime="image/png", attachment_data="data:image/png;base64,AA==",
    )
    response = _client_for(author).get(f"/api/v1/ideas/{idea.id}/")
    assert response.status_code == 200
    assert response.data["attachment_name"] is None
    assert response.data["attachment_data"] is None


def test_detail_shows_attachment_while_propuesta(author):
    idea = _idea(author, attachment_name="a.png", attachment_mime="image/png", attachment_data="data:image/png;base64,AA==")
    response = _client_for(author).get(f"/api/v1/ideas/{idea.id}/")
    assert response.data["attachment_name"] == "a.png"
    assert response.data["attachment_data"] == "data:image/png;base64,AA=="


# --- IdeaDetailView.patch (progress) -----------------------------------------------


def test_patch_progress_403_without_review_permission(author):
    idea = _idea(author)
    response = _client_for(author).patch(f"/api/v1/ideas/{idea.id}/", {"progress": 50}, format="json")
    assert response.status_code == 403


def test_patch_progress_400_for_out_of_range(reviewer, author):
    idea = _idea(author)
    response = _client_for(reviewer).patch(f"/api/v1/ideas/{idea.id}/", {"progress": 150}, format="json")
    assert response.status_code == 400


def test_patch_progress_updates_value(reviewer, author):
    idea = _idea(author)
    response = _client_for(reviewer).patch(f"/api/v1/ideas/{idea.id}/", {"progress": 42}, format="json")
    assert response.status_code == 200
    idea.refresh_from_db()
    assert idea.progress == 42


# --- IdeaVoteView -------------------------------------------------------------------


def test_vote_requires_visibility(author):
    idea = _idea(author)
    outsider = _user_with_group("voter_outsider", "TRABAJO_SOCIAL")
    response = _client_for(outsider).post(f"/api/v1/ideas/{idea.id}/vote/")
    assert response.status_code == 404


def test_vote_toggle(author, reviewer):
    idea = _idea(author)
    response = _client_for(reviewer).post(f"/api/v1/ideas/{idea.id}/vote/")
    assert response.status_code == 200
    assert response.data == {"vote_count": 1, "voted_by_me": True}

    response = _client_for(reviewer).post(f"/api/v1/ideas/{idea.id}/vote/")
    assert response.data == {"vote_count": 0, "voted_by_me": False}


# --- IdeaStatusView -----------------------------------------------------------------


def test_status_403_without_review_permission(author):
    idea = _idea(author)
    response = _client_for(author).patch(f"/api/v1/ideas/{idea.id}/status/", {"action": "ADVANCE"}, format="json")
    assert response.status_code == 403


def test_status_404_for_missing_idea(reviewer):
    response = _client_for(reviewer).patch("/api/v1/ideas/999999/status/", {"action": "ADVANCE"}, format="json")
    assert response.status_code == 404


def test_status_400_for_invalid_action(reviewer, author):
    idea = _idea(author)
    response = _client_for(reviewer).patch(f"/api/v1/ideas/{idea.id}/status/", {"action": "TELEPORT"}, format="json")
    assert response.status_code == 400


def test_status_400_when_business_rule_violated(reviewer, author):
    idea = _idea(author)
    response = _client_for(reviewer).patch(f"/api/v1/ideas/{idea.id}/status/", {"action": "REJECT"}, format="json")
    assert response.status_code == 400


def test_status_advance_succeeds(reviewer, author):
    idea = _idea(author)
    response = _client_for(reviewer).patch(f"/api/v1/ideas/{idea.id}/status/", {"action": "ADVANCE"}, format="json")
    assert response.status_code == 200
    assert response.data["status"] == ImprovementIdea.Status.EN_REVISION


def test_status_reviewer_can_move_idea_of_author_they_do_not_normally_see(reviewer):
    # Asimetría real del TS: /status NO filtra por visibilidad del
    # autor, solo por can_review_ideas — un TRABAJO_SOCIAL en teoría no
    # es "visto" en el listado de JEFE_NACIONAL bajo ciertas jerarquías,
    # pero igual puede mover su idea. Para Mejora Continua, JEFE ve a
    # todos igual (ver get_visible_idea_author_ids), así que se fuerza
    # el caso pasando por un actor con menor alcance normal: aquí
    # confirmamos simplemente que no hay chequeo 404 de visibilidad.
    outsider_author = _user_with_group("outsider_author", "TRABAJO_SOCIAL")
    idea = _idea(outsider_author)
    response = _client_for(reviewer).patch(f"/api/v1/ideas/{idea.id}/status/", {"action": "ADVANCE"}, format="json")
    assert response.status_code == 200


# --- IdeaHistoryView ----------------------------------------------------------------


def test_history_404_for_missing_idea(author):
    response = _client_for(author).get("/api/v1/ideas/999999/history/")
    assert response.status_code == 404


def test_history_returns_transitions_in_order(reviewer, author):
    idea = _idea(author)
    _client_for(reviewer).patch(f"/api/v1/ideas/{idea.id}/status/", {"action": "ADVANCE"}, format="json")
    _client_for(reviewer).patch(f"/api/v1/ideas/{idea.id}/status/", {"action": "ADVANCE"}, format="json")
    response = _client_for(author).get(f"/api/v1/ideas/{idea.id}/history/")
    assert response.status_code == 200
    assert len(response.data) == 2
    assert response.data[0]["to_status"] == ImprovementIdea.Status.EN_REVISION
    assert response.data[1]["to_status"] == ImprovementIdea.Status.APROBADA
    assert response.data[0]["changer"]["id"] == reviewer.id
