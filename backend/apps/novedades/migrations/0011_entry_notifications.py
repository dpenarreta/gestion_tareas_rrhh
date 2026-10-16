"""Notificación de ingreso (2026-10-15) y listas de destinatarios separadas.

No destructiva:
- `ExitNotificationRecipient` se RENOMBRA a `CollaboratorNotificationRecipient`
  (conserva sus filas) y gana `kind`; las direcciones existentes quedan como
  destinatarios de SALIDA, así que el correo de salida sigue llegando a los
  mismos. La unicidad pasa a ser por lista (`kind`, `email`), para que una
  dirección pueda estar en ambas.
- Los destinatarios guardados en eventos de salida ya enviados pasan de una
  lista de correos a un estado por destinatario (envío individual).
- Nueva tabla `CollaboratorEntryNotification`."""

import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


def recipients_to_state(apps, schema_editor):
    Event = apps.get_model("novedades", "CollaboratorExitNotification")
    for event in Event.objects.all():
        if event.recipients and isinstance(event.recipients[0], str):
            sent = event.status == "SENT"
            event.recipients = [
                {
                    "email": email,
                    "status": "SENT" if sent else "FAILED",
                    "sent_at": event.sent_at.isoformat() if sent and event.sent_at else None,
                    "error": "" if sent else event.last_error[:200],
                }
                for email in event.recipients
            ]
            event.save(update_fields=["recipients"])


def state_to_recipients(apps, schema_editor):
    Event = apps.get_model("novedades", "CollaboratorExitNotification")
    for event in Event.objects.all():
        if event.recipients and isinstance(event.recipients[0], dict):
            event.recipients = [r["email"] for r in event.recipients]
            event.save(update_fields=["recipients"])


class Migration(migrations.Migration):

    dependencies = [
        ("novedades", "0010_exit_notifications"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.RenameModel("ExitNotificationRecipient", "CollaboratorNotificationRecipient"),
        migrations.AlterField(
            model_name="collaboratornotificationrecipient",
            name="email",
            field=models.EmailField(max_length=254),
        ),
        migrations.AddField(
            model_name="collaboratornotificationrecipient",
            name="kind",
            field=models.CharField(
                choices=[("ENTRY", "Ingreso"), ("EXIT", "Salida")], default="EXIT", max_length=10
            ),
        ),
        migrations.AlterModelOptions(
            name="collaboratornotificationrecipient",
            options={"ordering": ["kind", "email"]},
        ),
        migrations.AddConstraint(
            model_name="collaboratornotificationrecipient",
            constraint=models.UniqueConstraint(
                fields=("kind", "email"), name="novedades_notif_recipient_uniq"
            ),
        ),
        migrations.RunPython(recipients_to_state, state_to_recipients),
        migrations.CreateModel(
            name="CollaboratorEntryNotification",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("first_day", models.DateField(blank=True, null=True)),
                ("second_day", models.DateField(blank=True, null=True)),
                ("triggered_at", models.DateTimeField(blank=True, null=True)),
                ("snapshot", models.JSONField(blank=True, null=True)),
                (
                    "status",
                    models.CharField(
                        choices=[
                            ("WAITING", "En espera del segundo día"),
                            ("PENDING", "Pendiente"),
                            ("SENDING", "Enviando"),
                            ("SENT", "Enviado"),
                            ("FAILED", "Fallido"),
                        ],
                        db_index=True,
                        default="WAITING",
                        max_length=10,
                    ),
                ),
                ("recipients", models.JSONField(default=list)),
                ("attempts", models.PositiveSmallIntegerField(default=0)),
                ("last_attempt_at", models.DateTimeField(blank=True, null=True)),
                ("last_error", models.CharField(blank=True, max_length=500)),
                ("sent_at", models.DateTimeField(blank=True, null=True)),
                (
                    "collaborator",
                    models.OneToOneField(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="entry_notification",
                        to="novedades.collaborator",
                    ),
                ),
                (
                    "created_by",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="+",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
                (
                    "period",
                    models.ForeignKey(
                        null=True,
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="+",
                        to="novedades.operationalperiod",
                    ),
                ),
                (
                    "supervisor",
                    models.ForeignKey(
                        null=True,
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="+",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
            ],
            options={"ordering": ["-created_at", "-id"]},
        ),
    ]
