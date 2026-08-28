"""Importa los usuarios del Next.js legacy (tabla `User` de PostgreSQL,
gestionada por Prisma) hacia el nuevo `User` de Django, como parte de la
Fase 1 de la migración de stack.

Estrategia de contraseñas — fallback perezoso, sin resetear nada (ver plan):
los hashes bcryptjs de Postgres (`$2a$10$...`) son el mismo algoritmo que
`BCryptPasswordHasher` de Django, pero éste exige el prefijo literal
`"bcrypt$"` delante. Se importa tal cual con ese prefijo; Django lo
re-encripta a Argon2 automáticamente en el primer login exitoso posterior
(`check_password(..., setter=...)`), sin ninguna acción de este comando.

Solo LEE de Postgres (nunca escribe) y es idempotente: una fila ya importada
(identificada por `legacy_postgres_id`, el `cuid` original de Prisma) se
detecta y se omite en corridas posteriores, para no pisar un hash que el
usuario ya haya renovado a Argon2 con un login real tras una corrida previa.
"""

from datetime import timezone as dt_timezone

from django.conf import settings
from django.contrib.auth.models import Group
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.utils import timezone

from apps.users.models import User


class Command(BaseCommand):
    help = "Importa usuarios desde la tabla User de PostgreSQL (Next.js legacy)."

    def add_arguments(self, parser):
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Solo reporta qué se importaría, sin escribir en la base de datos.",
        )

    def handle(self, *args, **options):
        try:
            import psycopg2
            import psycopg2.extras
        except ImportError as exc:
            raise CommandError(
                "psycopg2-binary no está instalado (ver requirements/base.txt)."
            ) from exc

        dsn = settings.LEGACY_POSTGRES_URL
        if not dsn:
            raise CommandError(
                "LEGACY_POSTGRES_URL no está configurada (ver backend/.env.example)."
            )

        groups_by_role = {group.name: group for group in Group.objects.all()}

        connection = psycopg2.connect(dsn)
        try:
            connection.set_session(readonly=True)
            with connection.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cursor:
                cursor.execute(
                    'SELECT id, email, name, password, role, "createdAt" FROM "User" ORDER BY "createdAt"'
                )
                rows = cursor.fetchall()
        finally:
            connection.close()

        created, skipped, failed = 0, 0, []

        for row in rows:
            legacy_id = row["id"]
            role = row["role"]

            if User.objects.filter(legacy_postgres_id=legacy_id).exists():
                skipped += 1
                continue

            group = groups_by_role.get(role)
            if group is None:
                failed.append(f"{row['email']}: rol '{role}' sin Group sembrado en Django")
                continue

            if options["dry_run"]:
                created += 1
                continue

            created_at = row["createdAt"]
            if timezone.is_naive(created_at):
                created_at = timezone.make_aware(created_at, dt_timezone.utc)

            with transaction.atomic():
                user = User.objects.create(
                    username=row["email"],
                    email=row["email"],
                    first_name=row["name"],
                    password=f"bcrypt${row['password']}",
                    is_superuser=(role == "ADMINISTRADOR"),
                    legacy_postgres_id=legacy_id,
                    date_joined=created_at,
                )
                user.groups.set([group])
            created += 1

        self.stdout.write(
            self.style.SUCCESS(
                f"Importados: {created}. Ya existentes (omitidos): {skipped}. "
                f"Fallidos: {len(failed)}."
            )
        )
        for message in failed:
            self.stdout.write(self.style.ERROR(f"  - {message}"))
