"""Señales del dominio de usuarios.

Garantiza el invariante "usuario deshabilitado ⇒ sin sesiones activas",
sin importar por qué vía se deshabilitó (admin, management command, un
futuro endpoint): cualquier `save()` con `is_active=False` revoca todas
sus sesiones. Es idempotente — si ya no había sesiones activas, no hace
nada.
"""

from django.db.models.signals import post_save
from django.dispatch import receiver

from apps.authentication.services import SessionService

from .models import User


@receiver(post_save, sender=User)
def revoke_sessions_when_user_disabled(sender, instance: User, **kwargs) -> None:
    if not instance.is_active:
        SessionService.logout_all(instance)
