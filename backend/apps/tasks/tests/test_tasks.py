"""Cobertura de apps.tasks (Fase 3a de la migración de stack — ver
docs/AUDIT_LOG.md § 2026-08-07): CRUD core + comentarios sobre Task."""

import pytest
from django.contrib.auth.models import Group, Permission
from django.contrib.contenttypes.models import ContentType
from django.utils import timezone
from rest_framework.test import APIClient

from apps.notifications.models import Notification
from apps.permissions.models import ModulePermission
from apps.tasks.models import Comment, Task, TaskCommentView
from apps.users.models import User

pytestmark = pytest.mark.django_db


def _grant_permission(user: User, codename: str) -> None:
    content_type = ContentType.objects.get_for_model(ModulePermission)
    user.user_permissions.add(Permission.objects.get(content_type=content_type, codename=codename))


@pytest.fixture
def collaborator():
    return User.objects.create_user(
        username="collab", email="collab@example.com", password="Sup3r-Secr3t!"
    )


@pytest.fixture
def collaborator_client(collaborator):
    client = APIClient()
    client.force_authenticate(user=collaborator)
    return client


@pytest.fixture
def manager():
    user = User.objects.create_user(
        username="manager", email="manager@example.com", password="Sup3r-Secr3t!"
    )
    _grant_permission(user, "usuarios.editar")
    return user


@pytest.fixture
def manager_client(manager):
    client = APIClient()
    client.force_authenticate(user=manager)
    return client


@pytest.fixture
def stranger():
    return User.objects.create_user(
        username="stranger", email="stranger@example.com", password="Sup3r-Secr3t!"
    )


@pytest.fixture
def stranger_client(stranger):
    client = APIClient()
    client.force_authenticate(user=stranger)
    return client


def _task_payload(assigned_to: User, **overrides) -> dict:
    payload = {
        "title": "Preparar informe",
        "priority": "ALTA",
        "frequency": "PUNTUAL",
        "start_date": "2026-08-01T00:00:00Z",
        "end_date": "2026-08-10T00:00:00Z",
        "estimated_hours": 5,
        "assigned_to": assigned_to.id,
    }
    payload.update(overrides)
    return payload


# --- Creación --------------------------------------------------------------


def test_manager_creates_task_assigned_to_collaborator(manager_client, manager, collaborator):
    # Grupos reales, solo para esta prueba (ver docs/AUDIT_LOG.md §
    # 2026-09-01, NEXO-01): `TaskService.create_task` ahora valida
    # `assigned_to` contra la jerarquía visible del actor. No se tocan las
    # fixtures compartidas `manager`/`collaborator` — otros tests dependen
    # de que sigan sin grupo (ver `test_commenting_does_not_notify_roles_without_a_target`).
    manager.groups.set([Group.objects.get(name="COORDINADOR_NACIONAL")])
    collaborator.groups.set([Group.objects.get(name="ANALISTA_CC")])

    response = manager_client.post("/api/v1/tasks/", _task_payload(collaborator), format="json")

    assert response.status_code == 201
    task = Task.objects.get(title="Preparar informe")
    assert task.created_by_id == manager.id
    assert task.assigned_to_id == collaborator.id
    assert task.status == Task.Status.PENDIENTE
    assert task.progress == 0


def test_creating_task_already_completed_sets_progress_and_completed_at(
    manager_client, manager, collaborator
):
    manager.groups.set([Group.objects.get(name="COORDINADOR_NACIONAL")])
    collaborator.groups.set([Group.objects.get(name="ANALISTA_CC")])

    response = manager_client.post(
        "/api/v1/tasks/", _task_payload(collaborator, status="COMPLETADA"), format="json"
    )

    assert response.status_code == 201
    task = Task.objects.get(title="Preparar informe")
    assert task.progress == 100
    assert task.completed_at is not None


def test_cannot_create_task_assigned_to_user_outside_visible_hierarchy():
    """Hallazgo real de la auditoría de seguridad (ver docs/AUDIT_LOG.md §
    2026-09-01, NEXO-01): antes de esta corrección, cualquier usuario
    autenticado podía asignar una tarea a cualquier otro usuario del
    sistema, sin importar su nivel/departamento — confirmado en vivo contra
    el servidor real durante la auditoría."""
    actor = User.objects.create_user(
        username="asist_gh", email="asist_gh@example.com", password="Sup3r-Secr3t!"
    )
    actor.groups.set([Group.objects.get(name="ASISTENTE_GH")])
    outsider = User.objects.create_user(
        username="asist_sel", email="asist_sel@example.com", password="Sup3r-Secr3t!"
    )
    outsider.groups.set([Group.objects.get(name="ASISTENTE_SELECCION")])
    client = APIClient()
    client.force_authenticate(user=actor)

    response = client.post("/api/v1/tasks/", _task_payload(outsider), format="json")

    assert response.status_code == 400
    assert not Task.objects.filter(title="Preparar informe").exists()


def test_cannot_reassign_task_to_user_outside_visible_hierarchy(
    manager_client, manager, collaborator
):
    manager.groups.set([Group.objects.get(name="COORDINADOR_NACIONAL")])
    outsider = User.objects.create_user(
        username="outsider", email="outsider@example.com", password="Sup3r-Secr3t!"
    )
    outsider.groups.set([Group.objects.get(name="ADMINISTRADOR")])
    task = Task.objects.create(
        title="Tarea de manager",
        priority="MEDIA",
        frequency="PUNTUAL",
        start_date=timezone.now(),
        end_date=timezone.now(),
        estimated_hours=1,
        assigned_to=manager,
        created_by=manager,
    )

    response = manager_client.patch(
        f"/api/v1/tasks/{task.id}/", {"assigned_to": outsider.id}, format="json"
    )

    assert response.status_code == 400
    task.refresh_from_db()
    assert task.assigned_to_id == manager.id


# --- Listado (solo propias) -------------------------------------------------


def test_list_only_returns_own_non_archived_tasks(collaborator_client, collaborator, stranger):
    own = Task.objects.create(
        title="Propia",
        priority="MEDIA",
        frequency="PUNTUAL",
        start_date=timezone.now(),
        end_date=timezone.now(),
        estimated_hours=1,
        assigned_to=collaborator,
        created_by=collaborator,
    )
    Task.objects.create(
        title="Archivada",
        priority="MEDIA",
        frequency="PUNTUAL",
        start_date=timezone.now(),
        end_date=timezone.now(),
        estimated_hours=1,
        assigned_to=collaborator,
        created_by=collaborator,
        archived_month="2026-07",
    )
    Task.objects.create(
        title="De otra persona",
        priority="MEDIA",
        frequency="PUNTUAL",
        start_date=timezone.now(),
        end_date=timezone.now(),
        estimated_hours=1,
        assigned_to=stranger,
        created_by=stranger,
    )

    response = collaborator_client.get("/api/v1/tasks/")

    assert response.status_code == 200
    titles = {item["title"] for item in response.data}
    assert titles == {own.title}


# --- Edición: campos restringidos al propio responsable --------------------


def test_assignee_can_edit_self_only_fields(collaborator_client, collaborator, manager):
    task = Task.objects.create(
        title="Tarea",
        priority="MEDIA",
        frequency="PUNTUAL",
        start_date=timezone.now(),
        end_date=timezone.now(),
        estimated_hours=1,
        assigned_to=collaborator,
        created_by=manager,
    )

    response = collaborator_client.patch(
        f"/api/v1/tasks/{task.id}/", {"status": "EN_PROGRESO"}, format="json"
    )

    assert response.status_code == 200
    task.refresh_from_db()
    assert task.status == Task.Status.EN_PROGRESO


def test_creator_without_being_assignee_cannot_edit_self_only_fields(
    manager_client, collaborator, manager
):
    task = Task.objects.create(
        title="Tarea",
        priority="MEDIA",
        frequency="PUNTUAL",
        start_date=timezone.now(),
        end_date=timezone.now(),
        estimated_hours=1,
        assigned_to=collaborator,
        created_by=manager,
    )

    response = manager_client.patch(
        f"/api/v1/tasks/{task.id}/", {"status": "EN_PROGRESO"}, format="json"
    )

    assert response.status_code == 400
    task.refresh_from_db()
    assert task.status == Task.Status.PENDIENTE


def test_creator_can_edit_non_restricted_fields(manager_client, collaborator, manager):
    task = Task.objects.create(
        title="Tarea",
        priority="MEDIA",
        frequency="PUNTUAL",
        start_date=timezone.now(),
        end_date=timezone.now(),
        estimated_hours=1,
        assigned_to=collaborator,
        created_by=manager,
    )

    response = manager_client.patch(
        f"/api/v1/tasks/{task.id}/", {"title": "Tarea editada"}, format="json"
    )

    assert response.status_code == 200
    task.refresh_from_db()
    assert task.title == "Tarea editada"


def test_changing_status_to_completada_sets_progress_100_and_completed_at(
    collaborator_client, collaborator, manager
):
    task = Task.objects.create(
        title="Tarea",
        priority="MEDIA",
        frequency="PUNTUAL",
        start_date=timezone.now(),
        end_date=timezone.now(),
        estimated_hours=1,
        assigned_to=collaborator,
        created_by=manager,
    )

    response = collaborator_client.patch(
        f"/api/v1/tasks/{task.id}/", {"status": "COMPLETADA"}, format="json"
    )

    assert response.status_code == 200
    task.refresh_from_db()
    assert task.progress == 100
    assert task.completed_at is not None


def test_stranger_cannot_view_or_edit_unrelated_task(stranger_client, collaborator, manager):
    task = Task.objects.create(
        title="Tarea",
        priority="MEDIA",
        frequency="PUNTUAL",
        start_date=timezone.now(),
        end_date=timezone.now(),
        estimated_hours=1,
        assigned_to=collaborator,
        created_by=manager,
    )

    response = stranger_client.patch(
        f"/api/v1/tasks/{task.id}/", {"title": "Hackeada"}, format="json"
    )

    assert response.status_code == 403
    task.refresh_from_db()
    assert task.title == "Tarea"


# --- Eliminación -------------------------------------------------------------


def test_creator_can_delete_own_task(manager_client, manager, collaborator):
    task = Task.objects.create(
        title="Tarea",
        priority="MEDIA",
        frequency="PUNTUAL",
        start_date=timezone.now(),
        end_date=timezone.now(),
        estimated_hours=1,
        assigned_to=collaborator,
        created_by=manager,
    )

    response = manager_client.delete(f"/api/v1/tasks/{task.id}/")

    assert response.status_code == 204
    assert not Task.objects.filter(id=task.id).exists()


def test_user_with_usuarios_editar_can_delete_others_task(
    manager_client, manager, collaborator, stranger
):
    task = Task.objects.create(
        title="Tarea",
        priority="MEDIA",
        frequency="PUNTUAL",
        start_date=timezone.now(),
        end_date=timezone.now(),
        estimated_hours=1,
        assigned_to=collaborator,
        created_by=stranger,
    )

    response = manager_client.delete(f"/api/v1/tasks/{task.id}/")

    assert response.status_code == 204


def test_assignee_without_usuarios_editar_cannot_delete_task_created_by_someone_else(
    collaborator_client, collaborator, stranger
):
    task = Task.objects.create(
        title="Tarea",
        priority="MEDIA",
        frequency="PUNTUAL",
        start_date=timezone.now(),
        end_date=timezone.now(),
        estimated_hours=1,
        assigned_to=collaborator,
        created_by=stranger,
    )

    response = collaborator_client.delete(f"/api/v1/tasks/{task.id}/")

    assert response.status_code == 403
    assert Task.objects.filter(id=task.id).exists()


# --- Comentarios y has_unread_comments --------------------------------------


def test_posting_comment_and_unread_flag_for_other_participant(
    collaborator_client, manager_client, collaborator, manager
):
    task = Task.objects.create(
        title="Tarea",
        priority="MEDIA",
        frequency="PUNTUAL",
        start_date=timezone.now(),
        end_date=timezone.now(),
        estimated_hours=1,
        assigned_to=collaborator,
        created_by=manager,
    )

    post_response = manager_client.post(
        f"/api/v1/tasks/{task.id}/comments/", {"text": "Hola"}, format="json"
    )
    assert post_response.status_code == 201
    assert Comment.objects.filter(task=task, text="Hola", author=manager).exists()

    list_response = collaborator_client.get(f"/api/v1/tasks/{task.id}/")
    assert list_response.status_code == 200
    assert list_response.data["has_unread_comments"] is True

    view_response = collaborator_client.get(f"/api/v1/tasks/{task.id}/comments/")
    assert view_response.status_code == 200
    assert TaskCommentView.objects.filter(task=task, user=collaborator).exists()

    after_view_response = collaborator_client.get(f"/api/v1/tasks/{task.id}/")
    assert after_view_response.data["has_unread_comments"] is False


# --- Notificación al comentar (cierra el gap documentado en la Fase 3a) -----


def test_commenting_notifies_role_notification_target(manager_client, manager, collaborator):
    # ANALISTA_CC -> COORDINADOR_NACIONAL, ya sembrado desde la Fase 1
    # (RoleNotificationTarget, equivalente a NOTIFICATION_TARGETS legacy).
    analista = User.objects.create_user(
        username="analista", email="analista@example.com", password="Sup3r-Secr3t!"
    )
    analista.groups.set([Group.objects.get(name="ANALISTA_CC")])
    coordinador = User.objects.create_user(
        username="coord", email="coord@example.com", password="Sup3r-Secr3t!"
    )
    coordinador.groups.set([Group.objects.get(name="COORDINADOR_NACIONAL")])
    analista_client = APIClient()
    analista_client.force_authenticate(user=analista)

    task = Task.objects.create(
        title="Tarea con jerarquía",
        priority="MEDIA",
        frequency="PUNTUAL",
        start_date=timezone.now(),
        end_date=timezone.now(),
        estimated_hours=1,
        assigned_to=analista,
        created_by=analista,
    )

    long_text = "x" * 80
    response = analista_client.post(
        f"/api/v1/tasks/{task.id}/comments/", {"text": long_text}, format="json"
    )

    assert response.status_code == 201
    notification = Notification.objects.get(user=coordinador)
    assert f'comentó en "{task.title}"' in notification.message
    assert notification.message.endswith("…")  # preview truncado a 60 caracteres + "…"
    assert notification.task_id == task.id


def test_commenting_does_not_notify_roles_without_a_target(collaborator_client, collaborator):
    # `collaborator` no tiene ningún grupo -> sin RoleNotificationTarget
    # aplicable, no debe crear ninguna notificación.
    task = Task.objects.create(
        title="Tarea sin jerarquía",
        priority="MEDIA",
        frequency="PUNTUAL",
        start_date=timezone.now(),
        end_date=timezone.now(),
        estimated_hours=1,
        assigned_to=collaborator,
        created_by=collaborator,
    )

    response = collaborator_client.post(
        f"/api/v1/tasks/{task.id}/comments/", {"text": "Hola"}, format="json"
    )

    assert response.status_code == 201
    assert not Notification.objects.exists()


# Cierre del gap notification_rules -> apps.tasks.services (ver
# docs/AUDIT_LOG.md § 2026-08-28): `CommentService.create_comment` ya lee
# `comment_targets`/`first_comment_role` de `get_effective_notification_rules()`
# en vez de la jerarquía fija (`RoleNotificationTarget`).
def _set_notification_rules(
    *, comment_targets=None, first_comment_role=None, retroactive_notify_roles=None, actor
):
    from apps.configuration.services import set_notification_rules

    set_notification_rules(
        {
            "comment_targets": comment_targets or {},
            "first_comment_role": first_comment_role,
            "retroactive_notify_roles": retroactive_notify_roles or [],
        },
        actor,
    )


def test_commenting_uses_custom_comment_targets_when_configured(collaborator):
    analista = User.objects.create_user(
        username="analista2", email="analista2@example.com", password="Sup3r-Secr3t!"
    )
    analista.groups.set([Group.objects.get(name="ANALISTA_CC")])
    coordinador = User.objects.create_user(
        username="coord2", email="coord2@example.com", password="Sup3r-Secr3t!"
    )
    coordinador.groups.set([Group.objects.get(name="COORDINADOR_NACIONAL")])
    trabajo_social = User.objects.create_user(
        username="ts", email="ts@example.com", password="Sup3r-Secr3t!"
    )
    trabajo_social.groups.set([Group.objects.get(name="TRABAJO_SOCIAL")])

    # Override: ANALISTA_CC notifica a TRABAJO_SOCIAL, NO al default (COORDINADOR_NACIONAL).
    _set_notification_rules(comment_targets={"ANALISTA_CC": ["TRABAJO_SOCIAL"]}, actor=analista)

    analista_client = APIClient()
    analista_client.force_authenticate(user=analista)
    task = Task.objects.create(
        title="Tarea con override",
        priority="MEDIA",
        frequency="PUNTUAL",
        start_date=timezone.now(),
        end_date=timezone.now(),
        estimated_hours=1,
        assigned_to=analista,
        created_by=analista,
    )

    response = analista_client.post(
        f"/api/v1/tasks/{task.id}/comments/", {"text": "Hola"}, format="json"
    )

    assert response.status_code == 201
    assert Notification.objects.filter(user=trabajo_social).exists()
    assert not Notification.objects.filter(user=coordinador).exists()


def test_first_comment_role_notifies_only_on_the_first_comment(collaborator_client, collaborator):
    jefe = User.objects.create_user(
        username="jefe3", email="jefe3@example.com", password="Sup3r-Secr3t!"
    )
    jefe.groups.set([Group.objects.get(name="JEFE_NACIONAL")])
    _set_notification_rules(first_comment_role="JEFE_NACIONAL", actor=collaborator)

    task = Task.objects.create(
        title="Tarea primer comentario",
        priority="MEDIA",
        frequency="PUNTUAL",
        start_date=timezone.now(),
        end_date=timezone.now(),
        estimated_hours=1,
        assigned_to=collaborator,
        created_by=collaborator,
    )

    first = collaborator_client.post(
        f"/api/v1/tasks/{task.id}/comments/", {"text": "Primero"}, format="json"
    )
    assert first.status_code == 201
    assert Notification.objects.filter(user=jefe).count() == 1

    second = collaborator_client.post(
        f"/api/v1/tasks/{task.id}/comments/", {"text": "Segundo"}, format="json"
    )
    assert second.status_code == 201
    assert Notification.objects.filter(user=jefe).count() == 1  # sin nueva notificación


def test_first_comment_role_and_comment_targets_union_without_duplicate_notification():
    analista = User.objects.create_user(
        username="analista4", email="analista4@example.com", password="Sup3r-Secr3t!"
    )
    analista.groups.set([Group.objects.get(name="ANALISTA_CC")])
    jefe = User.objects.create_user(
        username="jefe4", email="jefe4@example.com", password="Sup3r-Secr3t!"
    )
    jefe.groups.set([Group.objects.get(name="JEFE_NACIONAL")])
    # JEFE_NACIONAL aparece en AMBOS conjuntos (comment_targets del rol del
    # autor Y first_comment_role) para verificar que un mismo destinatario
    # no recibe 2 notificaciones por el mismo comentario.
    _set_notification_rules(
        comment_targets={"ANALISTA_CC": ["JEFE_NACIONAL"]},
        first_comment_role="JEFE_NACIONAL",
        actor=analista,
    )

    analista_client = APIClient()
    analista_client.force_authenticate(user=analista)
    task = Task.objects.create(
        title="Tarea unión",
        priority="MEDIA",
        frequency="PUNTUAL",
        start_date=timezone.now(),
        end_date=timezone.now(),
        estimated_hours=1,
        assigned_to=analista,
        created_by=analista,
    )

    response = analista_client.post(
        f"/api/v1/tasks/{task.id}/comments/", {"text": "Primero"}, format="json"
    )

    assert response.status_code == 201
    assert Notification.objects.filter(user=jefe).count() == 1


def test_commenting_never_notifies_the_author_even_if_configured_to_target_own_role(collaborator):
    analista = User.objects.create_user(
        username="analista3", email="analista3@example.com", password="Sup3r-Secr3t!"
    )
    analista.groups.set([Group.objects.get(name="ANALISTA_CC")])
    _set_notification_rules(comment_targets={"ANALISTA_CC": ["ANALISTA_CC"]}, actor=analista)

    analista_client = APIClient()
    analista_client.force_authenticate(user=analista)
    task = Task.objects.create(
        title="Tarea auto-notificación",
        priority="MEDIA",
        frequency="PUNTUAL",
        start_date=timezone.now(),
        end_date=timezone.now(),
        estimated_hours=1,
        assigned_to=analista,
        created_by=analista,
    )

    response = analista_client.post(
        f"/api/v1/tasks/{task.id}/comments/", {"text": "Hola"}, format="json"
    )

    assert response.status_code == 201
    assert not Notification.objects.exists()
