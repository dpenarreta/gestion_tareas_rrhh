"""Reintenta las notificaciones del módulo que no pudieron entregarse en el
momento (ver `NotificationService.notify_admins`). Pensado para correr de
forma programada; reintentar nunca repite la operación original."""

from django.core.management.base import BaseCommand

from apps.novedades.services import NotificationService


class Command(BaseCommand):
    help = "Reintenta las notificaciones pendientes del módulo Control Operativo de Novedades."

    def handle(self, *args, **options):
        result = NotificationService.retry_pending()
        self.stdout.write(f"Entregadas: {result['delivered']} — Fallidas: {result['failed']}")
