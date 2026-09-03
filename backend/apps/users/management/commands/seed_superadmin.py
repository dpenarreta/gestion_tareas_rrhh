"""Crea el usuario ADMINISTRADOR inicial en una base de datos vacía
(bootstrap de despliegue — ver docs/DEPLOYMENT_IIS.md).

Reutiliza `UserAdminService.create_user` (con `actor=None`, el único caso
legítimo de "sin actor humano": no existe todavía ningún usuario que pueda
serlo) para no reimplementar el hasheo de contraseña, la sincronización de
`is_superuser` con el grupo ADMINISTRADOR ni el registro de auditoría —
misma lógica que crear un usuario desde la UI de Usuarios.

Idempotente: si ya existe un usuario con ese username o email, no hace nada
(seguro de re-ejecutar en un script de despliegue).

Uso:
    python manage.py seed_superadmin --email admin@empresa.com [--username admin] [--password ...]

Si no se pasa `--password`, la toma de la variable de entorno
`SUPERADMIN_PASSWORD` (para scripts de despliegue no interactivos) o, si
tampoco está, la pide de forma interactiva (oculta, sin hacer eco en
pantalla) — nunca queda un valor por defecto adivinable.
"""

import os
from getpass import getpass

from django.contrib.auth.models import Group
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError as DjangoValidationError
from django.core.management.base import BaseCommand, CommandError
from django.db.models import Q

from apps.users.models import User
from apps.users.services import UserAdminService

ADMINISTRADOR_GROUP_NAME = "ADMINISTRADOR"


class Command(BaseCommand):
    help = "Crea el usuario ADMINISTRADOR inicial (bootstrap) en una base de datos vacía."

    def add_arguments(self, parser):
        parser.add_argument("--email", required=True, help="Correo del administrador inicial.")
        parser.add_argument("--username", default="admin", help="Username (por defecto: 'admin').")
        parser.add_argument(
            "--password",
            default=None,
            help="Si se omite, se toma de SUPERADMIN_PASSWORD o se pide interactivamente.",
        )
        parser.add_argument("--first-name", default="", dest="first_name")
        parser.add_argument("--last-name", default="", dest="last_name")

    def handle(self, *args, **options):
        email = options["email"].strip()
        username = options["username"].strip()

        existing = User.objects.filter(
            Q(username__iexact=username) | Q(email__iexact=email)
        ).first()
        if existing:
            self.stdout.write(
                self.style.WARNING(
                    f"Ya existe un usuario con ese username o email ({existing.username} / "
                    f"{existing.email}) — no se crea de nuevo. Nada que hacer."
                )
            )
            return

        try:
            admin_group = Group.objects.get(name=ADMINISTRADOR_GROUP_NAME)
        except Group.DoesNotExist as exc:
            raise CommandError(
                f"El grupo '{ADMINISTRADOR_GROUP_NAME}' no existe todavía — corré "
                "'python manage.py migrate' primero (lo crea la migración de datos "
                "apps.hierarchy.0002_seed_nexo_roles)."
            ) from exc

        password = options["password"] or os.environ.get("SUPERADMIN_PASSWORD")
        if not password:
            password = getpass("Contraseña para el administrador inicial: ")
            password_confirm = getpass("Repetí la contraseña: ")
            if password != password_confirm:
                raise CommandError("Las contraseñas no coinciden.")

        try:
            validate_password(password)
        except DjangoValidationError as exc:
            raise CommandError("Contraseña inválida: " + "; ".join(exc.messages)) from exc

        user = UserAdminService.create_user(
            actor=None,
            username=username,
            email=email,
            password=password,
            first_name=options["first_name"],
            last_name=options["last_name"],
            role_ids=[admin_group.id],
        )
        # Bootstrap con contraseña elegida en el momento del despliegue, no en
        # la UI — se fuerza a cambiarla en el primer login real, mismo campo
        # que ya usa `PasswordResetService.admin_initiate_reset`.
        user.must_change_password = True
        user.save(update_fields=["must_change_password"])

        self.stdout.write(
            self.style.SUCCESS(
                f"Usuario ADMINISTRADOR creado: {user.username} ({user.email}). "
                "Deberá cambiar la contraseña en su primer login."
            )
        )
