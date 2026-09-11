# Creación de la base de datos (SQL Server)

Un solo script SQL crea la base de Nexo desde cero en un servidor nuevo y la
deja lista para entrar. No se versiona: se genera cuando se lo necesita, con
el correo y la contraseña del administrador de ese despliegue.

## 1. Generar el script

```bash
cd backend
./.venv/Scripts/python.exe manage.py sqlcreatedatabase --admin-email admin@miempresa.com
```

Deja `backend/scripts/sql/nexo_create_database.sql`. La contraseña del
administrador se pide de forma interactiva y oculta (o se toma de
`SUPERADMIN_PASSWORD`, para un script de despliegue no interactivo).

Opciones útiles:

| Opción | Para qué |
|---|---|
| `--database otra_base` | otro nombre de base (por defecto `ia_gestion_tareas`, la de producción) |
| `--admin-username jefe` | otro username (por defecto `admin`) |
| `--output C:\temp\x.sql` | otra ruta de salida |
| `--admin-password ...` | contraseña sin prompt (queda en el historial del shell) |
| `--no-force-password-change` | no exigir el cambio de contraseña al entrar |
| `--skip-create-database` | no incluir el `CREATE DATABASE`: la base ya existe |

Por defecto el administrador queda obligado a cambiar la contraseña en su
primer login (`must_change_password`), que es lo correcto cuando la eligió
quien despliega. Si la eligió el propio titular de la cuenta, pasá
`--no-force-password-change` y entra directo con ella.

El usuario queda con `is_superuser` **y** en el grupo `ADMINISTRADOR`: en
este sistema "administrador real se define por `is_superuser=True` y no por
la sola pertenencia a un rol" (`apps/roles/migrations/0001_initial.py`), y
`ADMINISTRADOR` es el rol que lleva el catálogo completo de permisos. Se
puede entrar con el correo o con el username, indistintamente
(`LoginSerializer.identifier`).

El nombre por defecto es `ia_gestion_tareas`, la base de producción, y tiene
que coincidir con `DB_NAME` del `backend\.env` de ese servidor (ya viene así
en `backend\.env.production.example`) — si no coinciden, el backend no la
encuentra. La base de desarrollo sigue llamándose `gestion_tareas` y este
script no la toca.

> ⚠️ **El script generado contiene el hash Argon2 de la contraseña del
> administrador.** Es de un solo uso: no se commitea (está en `.gitignore`),
> no se comparte y conviene borrarlo del servidor después de usarlo. La
> contraseña en claro no aparece en el archivo.

## 2. Ejecutarlo en el servidor

Conectado a `master`, con una cuenta que pueda crear bases:

```bat
sqlcmd -S <servidor> -d master -b -i nexo_create_database.sql
```

El `-b` es importante: sin él, `sqlcmd` sigue adelante después de un error y
deja la base a medio crear. SSMS **siempre** sigue con los batches
siguientes, así que el script trae dos guards propios: uno aborta si el
`CREATE DATABASE` no llegó a crear la base, y otro si el contexto no quedó
en la base esperada — sin ese segundo guard, un `USE` fallido haría que las
59 tablas se crearan en `master`. Al terminar imprime
`Nexo: base [ia_gestion_tareas] creada. Entrar como <usuario>.`

Eso es todo. La base queda con:

1. la base creada con la collation del proyecto (`SQL_Latin1_General_CP1_CI_AS`);
2. las 59 tablas con todos sus campos, índices, `CHECK` y claves foráneas;
3. `django_migrations` completa (95 filas), así ningún `migrate` posterior
   intenta re-crear nada;
4. el catálogo que en un despliegue normal siembran las migraciones de datos:
   56 content types, 246 permisos, 12 grupos de rol, 105 asignaciones de
   permiso y la jerarquía de visibilidad;
5. el usuario ADMINISTRADOR inicial, con `is_superuser` y —salvo que se pase
   `--no-force-password-change`— obligado a cambiar la contraseña en su primer
   login.

**No contiene datos de negocio**: ni tareas, ni proyectos, ni más usuarios.
Los demás usuarios se crean desde la aplicación (Usuarios → Nuevo usuario),
ya logueado con el administrador.

No hace falta correr `manage.py migrate` después. Si se corre, no hace nada
(`No migrations to apply`), que es justamente la señal de que el paso 3 quedó
bien.

## Los archivos de esta carpeta

| Archivo | Qué es |
|---|---|
| `nexo_create_database.sql` | **el habitual**: crea la base y todo su contenido, en un solo paso |
| `crear_base_ia_gestion_tareas.sql` | paso 1 de 2: solo crea la base vacía, con sus opciones |
| `nexo_solo_contenido_base_ya_creada.sql` | paso 2 de 2: el contenido, sobre una base que ya existe (NO crea la base) |
| `README.md` | esto |

Los dos últimos son para cuando la base la crea el DBA o la cuenta no puede
crear bases. `crear_base_ia_gestion_tareas.sql` se mantiene a mano (no lo
genera el comando): salió de un script de SSMS de la base de desarrollo,
corregido — nombre de producción, sin las rutas de archivo de Linux que
traía, collation explícita y las opciones ANSI en `ON` en vez de los `OFF`
obsoletos que hereda desarrollo.

## Si no tenés permiso para crear bases

Es el caso típico de un servidor productivo administrado por un DBA. Si el
`CREATE DATABASE` falla (`CREATE DATABASE permission denied in database
'master'`), el script aborta con un mensaje que lo dice, en vez de encadenar
errores: el `USE` posterior daría un `Msg 911 La base de datos no existe`
que no explica nada.

En ese caso, que el DBA cree la base vacía:

```sql
CREATE DATABASE [ia_gestion_tareas] COLLATE SQL_Latin1_General_CP1_CI_AS;
```

y usá el script generado con `--skip-create-database`, que hace todo lo demás
dentro de esa base y verifica que exista antes de empezar.

Para saber de antemano si la cuenta puede crear bases:

```sql
SELECT IS_SRVROLEMEMBER('sysadmin') AS es_sysadmin,
       IS_SRVROLEMEMBER('dbcreator') AS puede_crear_bases;
```

## Si falla a mitad

No hay rollback: el DDL corre en batches separados por `GO`. La salida
correcta es borrar la base y volver a ejecutar el script — que además se
niega a correr sobre una base que ya existe, para no dejar una instalación
mezclada.

```sql
ALTER DATABASE [ia_gestion_tareas] SET SINGLE_USER WITH ROLLBACK IMMEDIATE;
DROP DATABASE [ia_gestion_tareas];
```

## Codificación: el archivo lleva BOM a propósito

El script se escribe en UTF-8 **con BOM**, y eso no es decorativo: es lo
único que le dice a `sqlcmd` (y a SSMS) cómo leerlo. Doce de los 246 nombres
de permisos llevan acentos ("catálogo", "configuración", "contraseña"), y sin
BOM `sqlcmd` lee el archivo con la codepage ANSI del sistema y los inserta
con mojibake ("catÃ¡logo") — **terminando con exit 0 y sin ningún error**,
así que el problema recién se ve en la pantalla de Roles y Permisos.
Verificado en las dos variantes: con BOM los 242 permisos comparables quedan
idénticos al catálogo canónico y sin él 12 quedan corruptos.

Si el archivo se copia, se edita o se reenvía, hay que conservar el BOM. Si
alguna herramienta lo pierde, se puede forzar la codificación al ejecutarlo:

```bat
sqlcmd -S <servidor> -d master -b -f 65001 -i nexo_create_database.sql
```

## Si el DDL se aplica desde SSMS u otra herramienta

Hay que asegurarse de que la sesión tenga `QUOTED_IDENTIFIER` y `ANSI_NULLS`
en `ON`. El script ya lo fija en su cabecera, porque `sqlcmd` conecta con
`QUOTED_IDENTIFIER` en `OFF` y los índices filtrados del esquema (los
`CREATE UNIQUE INDEX ... WHERE ... IS NOT NULL` con que `mssql-django`
implementa un `unique_together` sobre columnas nullable) fallan con el error
1934.

## Cómo se genera, y por qué así

`apps/core/management/commands/sqlcreatedatabase.py`:

- **El esquema** sale de `schema_editor.create_model()` sobre el estado final
  del grafo de migraciones, no de concatenar las 95 migraciones (eso crearía
  columnas para borrarlas después, como `legacy_postgres_id`). Se usa el
  estado del grafo y no el registro de modelos en runtime porque
  `auth_group_permissions.id` difiere entre ambos (`bigint` vs `int`), y el
  del grafo es lo que crea `migrate`.
- **El catálogo** sale de una base temporal que el comando crea, migra, lee y
  borra. Es la única fuente canónica: la base de desarrollo divergió del seed
  (el grupo `Superusuario` tiene ahí 14 permisos donde una base nueva tiene
  26). `--catalog-source current` lee la base configurada — es lo que usan
  los tests, donde la base de pytest sí se crea con `migrate`.
- **El usuario** se serializa desde el modelo `User`, campo por campo con sus
  valores por defecto, en vez de una lista de columnas escrita a mano: así un
  campo nuevo en el modelo entra solo. La contraseña se hashea con
  `make_password` (Argon2, el hasher del proyecto).

`apps/core/tests/test_sqlcreatedatabase.py` cubre que el script incluya todas
las tablas de los modelos, el catálogo, el usuario, y que nunca contenga la
contraseña en claro.

## Verificación

Lo comprobado el 2026-09-08 (v1.150.0), ejecutando el script de verdad con
`sqlcmd` sobre una base nueva y comparándola contra otra creada con
`CREATE DATABASE + migrate`:

- **Esquema idéntico**: 573 columnas (tipo, longitud, precisión, nulabilidad
  y default), 213 índices (unicidad y columnas), 88 claves foráneas (con su
  acción de borrado), 56 constraints `CHECK`, 56 columnas `IDENTITY`.
- **Catálogo idéntico fila por fila** en las 7 tablas que lo componen
  (salteando las columnas de fecha, que reflejan el momento de la siembra).
  Los `id` de `django_migrations` difieren en el orden de inserción y nada
  los referencia.
- **Contenido de más: solo el administrador** — `users_user` y
  `users_user_groups`, una fila cada una.
- **Login real**: `POST /api/v1/auth/login/` responde 200 con tokens
  `access`/`refresh`, y 401 con la contraseña equivocada. El usuario queda
  `is_superuser`, en el grupo `ADMINISTRADOR`, con hash Argon2 y
  `must_change_password`.
