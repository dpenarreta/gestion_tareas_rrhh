from django.contrib.auth.password_validation import validate_password
from rest_framework import serializers

from apps.users.validators import validate_unique_email, validate_unique_username

from .models import Session


class RegisterSerializer(serializers.Serializer):
    """Valida los datos de entrada para el registro de un nuevo usuario."""

    username = serializers.CharField(max_length=150)
    email = serializers.EmailField()
    password = serializers.CharField(write_only=True)
    first_name = serializers.CharField(max_length=150, required=False, allow_blank=True)
    last_name = serializers.CharField(max_length=150, required=False, allow_blank=True)

    def validate_username(self, value):
        return validate_unique_username(value)

    def validate_email(self, value):
        return validate_unique_email(value)

    def validate_password(self, value):
        validate_password(value)
        return value


class LoginSerializer(serializers.Serializer):
    """Valida las credenciales de entrada para el inicio de sesión.

    `identifier` acepta indistintamente nombre de usuario o correo — la
    resolución ocurre en AuthenticationService, nunca aquí, para no acoplar
    la validación de forma con la lógica de negocio.
    """

    identifier = serializers.CharField()
    password = serializers.CharField(write_only=True)


class RefreshSerializer(serializers.Serializer):
    refresh = serializers.CharField()


class MeUpdateSerializer(serializers.Serializer):
    """Fase 6b (ver docs/AUDIT_LOG.md § 2026-08-17): auto-servicio de
    perfil (`PATCH /auth/me/`) — a diferencia de `UserAdminUpdateSerializer`
    (`apps.users`), no exige el permiso administrativo `usuarios.editar`,
    porque acá el usuario solo edita su propio registro. Reusa
    `validate_unique_email` — la exclusión del propio usuario se resuelve
    vía `context["request"].user.id`, ya que este es un `Serializer` plano
    (sin `instance` de por medio, a diferencia de `UserAdminUpdateSerializer`)."""

    first_name = serializers.CharField(max_length=150, required=False, allow_blank=True)
    email = serializers.EmailField(required=False)

    def validate_email(self, value):
        return validate_unique_email(value, exclude_user_id=self.context["request"].user.id)


class SessionSerializer(serializers.ModelSerializer):
    is_current = serializers.SerializerMethodField()

    class Meta:
        model = Session
        fields = [
            "id",
            "device",
            "user_agent",
            "ip_address",
            "created_at",
            "last_used_at",
            "is_current",
        ]
        read_only_fields = fields

    def get_is_current(self, obj: Session) -> bool:
        current_session_id = self.context.get("current_session_id")
        return current_session_id is not None and str(obj.id) == str(current_session_id)


class PasswordResetRequestSerializer(serializers.Serializer):
    """`identifier` acepta usuario o correo, igual que `LoginSerializer` — la
    resolución (y la decisión de no revelar si existe) ocurre en
    `PasswordResetService.request_reset`, nunca aquí."""

    identifier = serializers.CharField()


class PasswordResetConfirmSerializer(serializers.Serializer):
    """La validez del token (existe, no usado, no expirado) es una regla de
    negocio con estado — se resuelve en `PasswordResetService.confirm_reset`,
    no aquí. Este serializer solo valida la forma."""

    token = serializers.CharField()
    new_password = serializers.CharField(write_only=True)
    new_password_confirm = serializers.CharField(write_only=True)

    def validate_new_password(self, value):
        validate_password(value)
        return value

    def validate(self, attrs):
        if attrs["new_password"] != attrs["new_password_confirm"]:
            raise serializers.ValidationError(
                {"new_password_confirm": "Las contraseñas no coinciden."}
            )
        return attrs


class ChangeOwnPasswordSerializer(serializers.Serializer):
    """Usado por el flujo de cambio obligatorio (`must_change_password`).
    Exige la contraseña actual — el usuario ya está autenticado, pero
    confirmarla es una defensa adicional (ej. sesión abierta en un
    dispositivo compartido)."""

    current_password = serializers.CharField(write_only=True)
    new_password = serializers.CharField(write_only=True)
    new_password_confirm = serializers.CharField(write_only=True)

    def validate_current_password(self, value):
        user = self.context["request"].user
        if not user.check_password(value):
            raise serializers.ValidationError("La contraseña actual no es correcta.")
        return value

    def validate_new_password(self, value):
        validate_password(value)
        return value

    def validate(self, attrs):
        if attrs["new_password"] != attrs["new_password_confirm"]:
            raise serializers.ValidationError(
                {"new_password_confirm": "Las contraseñas no coinciden."}
            )
        return attrs


class AdminPasswordResetSerializer(serializers.Serializer):
    """Las opciones administrativas son independientes entre sí, pero al
    menos una debe elegirse — de lo contrario la acción no haría nada.

    `return_link` (2026-09-11) devuelve el enlace de recuperación en la
    respuesta en vez de mandarlo por correo, para que quien administra se lo
    haga llegar a la persona por el medio que tenga a mano. Existe porque
    sin él no había forma de que alguien que olvidó su contraseña volviera a
    entrar: `force_change_on_next_login` obliga a cambiarla *después* de
    iniciar sesión, que es justo lo que esa persona no puede hacer, y
    `send_link` depende de que el correo esté configurado. Ver
    docs/AUDIT_LOG.md § 2026-09-11.
    """

    send_link = serializers.BooleanField(default=False)
    return_link = serializers.BooleanField(default=False)
    force_change_on_next_login = serializers.BooleanField(default=False)
    revoke_sessions = serializers.BooleanField(default=False)

    def validate(self, attrs):
        if not any(attrs.values()):
            raise serializers.ValidationError("Debe seleccionar al menos una acción.")
        return attrs
