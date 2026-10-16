"""Reintenta las notificaciones del módulo que no pudieron entregarse en el
momento: las alertas internas (ver `NotificationService.notify_admins`) y los
correos de ingreso y de salida de colaboradores (`CollaboratorMailService`). Pensado para
correr de forma programada; reintentar nunca repite la operación original ni
reenvía un correo ya aceptado por el servidor."""

from django.core.management.base import BaseCommand

from apps.novedades.services import CollaboratorMailService, NotificationService


class Command(BaseCommand):
    help = "Reintenta las notificaciones pendientes del módulo Control Operativo de Novedades."

    def handle(self, *args, **options):
        result = NotificationService.retry_pending()
        self.stdout.write(f"Entregadas: {result['delivered']} — Fallidas: {result['failed']}")
        mails = CollaboratorMailService.retry_pending()
        self.stdout.write(
            f"Correos de ingreso/salida enviados: {mails['sent']} — No enviados: {mails['failed']}"
        )
