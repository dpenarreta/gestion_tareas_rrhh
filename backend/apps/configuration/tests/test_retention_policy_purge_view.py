"""Cobertura HTTP + de servicio de `/api/v1/settings/retention-policy/purge/`
— Fase 83 (ver docs/AUDIT_LOG.md § 2026-08-27), réplica de
`retention-policy/purge/route.ts` y de los tests de
`src/lib/retentionPolicy.ts` (Vitest)."""

from datetime import timedelta

import pytest
from django.contrib.auth.models import Group
from django.utils import timezone
from rest_framework.test import APIClient

from apps.assistant.models import KnowledgeDocument
from apps.configuration.models import DataPurgeLog
from apps.configuration.services import execute_purge, find_purge_candidates
from apps.reports.models import ExecutiveReportSnapshot, MonthlyReport
from apps.tasks.models import Comment, Task
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


def _old_task(owner: User, months_ago: int) -> Task:
    task = Task.objects.create(
        title="Tarea archivada",
        priority="MEDIA",
        frequency="PUNTUAL",
        start_date=timezone.now(),
        end_date=timezone.now(),
        estimated_hours=1,
        assigned_to=owner,
        created_by=owner,
        archived_month="2020-01",
        archived_at=timezone.now() - timedelta(days=months_ago * 31),
    )
    return task


def _old_doc(owner: User, months_ago: int) -> KnowledgeDocument:
    doc = KnowledgeDocument.objects.create(
        title="Doc viejo",
        file_name="doc.pdf",
        github_path="docs/doc.pdf",
        github_sha="abc123",
        uploaded_by=owner,
    )
    # created_at es auto_now_add — .update() no dispara pre_save (ver
    # docs/AUDIT_LOG.md § 2026-08-27, Fase 80), único camino para simular un
    # documento viejo sin depender de migración de datos reales.
    KnowledgeDocument.objects.filter(pk=doc.pk).update(created_at=timezone.now() - timedelta(days=months_ago * 31))
    return doc


def _old_report(owner: User, year: int, month: int) -> MonthlyReport:
    return MonthlyReport.objects.create(
        month=month, year=year, generated_by=owner, scope=ExecutiveReportSnapshot.Scope.JEFE, data={"x": 1}
    )


def test_get_requires_authentication():
    response = APIClient().get("/api/v1/settings/retention-policy/purge/")
    assert response.status_code == 401


def test_get_requires_administrador():
    user = _user_with_group("analista0", "ANALISTA_CC")
    response = _client_for(user).get("/api/v1/settings/retention-policy/purge/")
    assert response.status_code == 403


def test_get_returns_zero_counts_with_no_candidates():
    admin = _user_with_group("admin0", "ADMINISTRADOR")
    response = _client_for(admin).get("/api/v1/settings/retention-policy/purge/")
    assert response.status_code == 200
    assert response.data["reportsToDelete"] == 0
    assert response.data["tasksToDelete"] == 0
    assert response.data["docsToDelete"] == 0


def test_get_counts_old_report_task_and_doc_past_default_cutoff():
    admin = _user_with_group("admin1", "ADMINISTRADOR")
    _old_report(admin, year=2020, month=1)  # default de informes: 24 meses
    _old_task(admin, months_ago=30)  # default de tareas archivadas: 24 meses
    # default de base de conocimiento: "indefinite" — no debería contar.
    _old_doc(admin, months_ago=48)

    response = _client_for(admin).get("/api/v1/settings/retention-policy/purge/")
    assert response.status_code == 200
    assert response.data["reportsToDelete"] == 1
    assert response.data["tasksToDelete"] == 1
    assert response.data["docsToDelete"] == 0  # política default = "indefinite"


def test_recent_report_and_task_are_not_candidates():
    user = _user_with_group("analista3", "ANALISTA_CC")
    _old_report(user, year=timezone.now().year, month=timezone.now().month)
    _old_task(user, months_ago=1)

    candidates = find_purge_candidates(timezone.now())
    assert candidates["report_ids"] == []
    assert candidates["task_ids"] == []


def test_post_requires_administrador():
    user = _user_with_group("jefe", "JEFE_NACIONAL")
    response = _client_for(user).post("/api/v1/settings/retention-policy/purge/")
    assert response.status_code == 403


def test_post_executes_purge_deletes_candidates_and_cascades():
    admin = _user_with_group("admin", "ADMINISTRADOR")
    report = _old_report(admin, year=2020, month=1)
    task = _old_task(admin, months_ago=30)
    Comment.objects.create(task=task, author=admin, text="comentario viejo")
    doc = _old_doc(admin, months_ago=48)

    response = _client_for(admin).post("/api/v1/settings/retention-policy/purge/")
    assert response.status_code == 200
    # docsToDelete=0 porque la política default de KB es "indefinite" —
    # el documento viejo NO se borra en esta corrida.
    assert response.data == {"reportsDeleted": 1, "tasksDeleted": 1, "docsDeleted": 0, "deletedDocs": []}

    assert not MonthlyReport.objects.filter(pk=report.pk).exists()
    assert not Task.objects.filter(pk=task.pk).exists()
    assert not Comment.objects.filter(task_id=task.pk).exists()  # cascada
    assert KnowledgeDocument.objects.filter(pk=doc.pk).exists()  # política "indefinite"

    log = DataPurgeLog.objects.get()
    assert log.executed_by_id == admin.pk
    assert (log.reports_deleted, log.tasks_deleted, log.docs_deleted) == (1, 1, 0)


def test_execute_purge_returns_github_info_for_deleted_docs(settings):
    admin = _user_with_group("admin2", "ADMINISTRADOR")
    doc = _old_doc(admin, months_ago=48)
    # Forzamos la política de KB a un valor con corte real (no "indefinite")
    # llamando al servicio directo con una política ya vigente vía config.
    from apps.configuration.services import set_config_value

    set_config_value("retention_knowledge_docs", "36", admin)

    result = execute_purge(admin)
    assert result["docs_deleted"] == 1
    assert result["deleted_docs"] == [{"github_path": doc.github_path, "github_sha": doc.github_sha}]
    assert not KnowledgeDocument.objects.filter(pk=doc.pk).exists()
