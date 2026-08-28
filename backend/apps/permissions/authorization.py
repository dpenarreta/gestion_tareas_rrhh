"""Resolución de permisos efectivos de un usuario contra el catálogo."""


def get_user_permission_codenames(user) -> set[str]:
    """Codenames (`"usuarios.ver"`, sin prefijo de app) que el usuario tiene,
    vía grupos (roles) o asignación directa. Este código no cachea nada
    propio: `user.get_all_permissions()` sí cachea en el atributo
    `_perm_cache` del objeto `User` en memoria, pero cada request
    autenticado obtiene una instancia nueva (ver
    `apps.authentication.authentication.SessionAuthentication.get_user`),
    así que revocar un permiso surte efecto en la siguiente petición, sin
    requerir relogin.

    No hace ningún bypass propio para `is_superuser` — pero Django's
    `ModelBackend` sí lo hace de forma transparente (`get_all_permissions()`
    devuelve `Permission.objects.all()` para cualquier usuario con
    `is_superuser=True`), así que un superusuario ve el catálogo completo
    igual, sin que este módulo tenga que duplicar esa lógica."""
    if user is None or not user.is_authenticated:
        return set()
    return {perm.partition(".")[2] for perm in user.get_all_permissions()}


def user_has_permission(user, codename: str) -> bool:
    """Chequeo de autorización real. El bypass explícito de `is_superuser`
    es redundante con el que ya hace Django internamente (ver docstring de
    `get_user_permission_codenames`) pero evita una consulta a la base de
    datos en el camino más común (superusuario administrando el sistema)."""
    if user is None or not user.is_authenticated:
        return False
    if user.is_superuser:
        return True
    return codename in get_user_permission_codenames(user)
