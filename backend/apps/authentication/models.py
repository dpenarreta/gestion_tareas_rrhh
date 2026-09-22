import uuid
from datetime import timedelta

from django.conf import settings
from django.db import models
from django.utils import timezone

from apps.core.models import BaseModel


class Session(BaseModel):
    """Sesión de autenticación ligada a un refresh token concreto.

    Revocar esta fila invalida de inmediato tanto el refresh token asociado
    (por `refresh_token_jti`) como cualquier access token emitido bajo su
    `id` (claim `sid`), ya que ambos se validan contra esta tabla en cada
    request (ver `apps.authentication.authentication.SessionAuthentication`).
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="sessions"
    )
    refresh_token_jti = models.CharField(max_length=255, unique=True)
    # El jti inmediatamente anterior y el instante en que se rotó. Sirven
    # para tolerar el reintento concurrente: al caducar el access token, el
    # navegador dispara varias peticiones a la vez y todas presentan el mismo
    # refresh. Sin esta ventana, la primera rota y las demás se toman por
    # reutilización, revocando la sesión de alguien que no hizo nada malo —
    # pasó 18 veces en un solo día en producción (ver docs/AUDIT_LOG.md §
    # 2026-09-14). No debilita la detección de robo: un token viejo de hace
    # horas sigue revocando.
    previous_refresh_token_jti = models.CharField(max_length=255, blank=True, default="")
    rotated_at = models.DateTimeField(null=True, blank=True)
    device = models.CharField(max_length=100, blank=True)
    user_agent = models.CharField(max_length=255, blank=True)
    ip_address = models.GenericIPAddressField(null=True, blank=True)
    last_used_at = models.DateTimeField(auto_now=True)
    expires_at = models.DateTimeField()
    revoked_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at"]

    @property
    def is_active(self) -> bool:
        return self.revoked_at is None and self.expires_at > timezone.now()

    def revoke(self) -> None:
        if self.revoked_at is None:
            self.revoked_at = timezone.now()
            self.save(update_fields=["revoked_at"])

    def is_idle(self, as_of=None) -> bool:
        """La persona lleva demasiado tiempo sin dar señales de vida.

        Cuánto es "demasiado" se configura desde Ajustes → Seguridad
        (`session_idle_timeout_hours`), no por variable de entorno: es una
        decisión de negocio y quien la toma no despliega.

        Se mide contra `last_used_at`, que solo avanza con actividad real: el
        sondeo automático del frontend viaja marcado y no lo toca (ver
        `SessionAuthentication`). Sin esa distinción una pestaña olvidada
        abierta nunca caducaría, porque la campana de notificaciones sola ya
        alcanza para mantener la sesión viva indefinidamente.
        """
        # Import perezoso: `apps.configuration.services` arrastra modelos de
        # varias apps y esto corre en cada request autenticada.
        from apps.configuration.services import get_effective_session_idle_timeout_hours

        as_of = as_of or timezone.now()
        limite = timedelta(hours=get_effective_session_idle_timeout_hours(as_of))
        return (as_of - self.last_used_at) >= limite

    def touch(self, as_of=None) -> bool:
        """Registra actividad real. Devuelve si llegó a escribir en la base.

        Con throttle porque `last_used_at` no necesita precisión de segundos
        para una ventana de horas, y sin él cada request sería un UPDATE.
        """
        as_of = as_of or timezone.now()
        transcurrido = (as_of - self.last_used_at).total_seconds()
        if transcurrido < settings.SESSION_ACTIVITY_THROTTLE_SECONDS:
            return False
        # `last_used_at` es `auto_now`: nombrarlo en `update_fields` basta
        # para que Django lo ponga al instante actual.
        self.save(update_fields=["last_used_at", "updated_at"])
        return True


class PasswordResetToken(BaseModel):
    """Token de un solo uso para el restablecimiento autónomo de contraseña.

    Solo se persiste el hash (`token_hash`, SHA-256 del valor crudo) — el
    valor crudo viaja únicamente en la URL del correo enviado y nunca se
    guarda en texto plano. `used_at` marca tanto el consumo exitoso como la
    invalidación de un token anterior cuando se genera uno nuevo (ver
    `PasswordResetService.request_reset`), en vez de borrar la fila, para
    conservar el rastro. A diferencia de `LoginAttempt`, se elimina en
    cascada junto con el usuario: no tiene valor histórico propio.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="password_reset_tokens"
    )
    token_hash = models.CharField(max_length=64, unique=True)
    expires_at = models.DateTimeField()
    used_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [models.Index(fields=["user", "used_at"])]

    @property
    def is_valid(self) -> bool:
        return self.used_at is None and self.expires_at > timezone.now()


class LoginAttempt(BaseModel):
    """Registro de todo intento de inicio de sesión (exitoso o no).

    Se indexa por `identifier` tal cual lo escribió el usuario (no por el
    usuario resuelto) para que el bloqueo por fuerza bruta se comporte
    igual exista o no la cuenta — evita filtrar existencia de usuarios.
    """

    identifier = models.CharField(max_length=255, db_index=True)
    ip_address = models.GenericIPAddressField(null=True, blank=True)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="login_attempts",
    )
    successful = models.BooleanField(default=False)

    class Meta:
        ordering = ["-created_at"]
