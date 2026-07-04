# Nexo

Sistema interno de gestión de recursos humanos con jerarquía de roles, autenticación JWT y control de visibilidad por cargo.

## Stack

- **Framework**: Next.js 16 (App Router) con TypeScript
- **Styling**: Tailwind CSS v4
- **ORM**: Prisma 7 con driver adapter `@prisma/adapter-pg`
- **Base de datos**: PostgreSQL
- **Auth**: JWT (`jose`), cookies httpOnly, `bcryptjs` para hashing

## Requisitos previos

- Node.js 20 o superior
- Una base de datos PostgreSQL accesible (local o remota)

## Puesta en marcha

### 1. Clonar e instalar dependencias

```bash
git clone https://github.com/ajacome0494/nexo.git
cd nexo
npm install
```

### 2. Variables de entorno

Copiar el archivo de ejemplo y completar los valores reales:

```bash
cp .env.example .env
```

| Variable | Requerida | Descripción |
|---|---|---|
| `DATABASE_URL` | Sí | Cadena de conexión PostgreSQL |
| `SESSION_SECRET` | Sí | Secreto para firmar los JWT de sesión, **mínimo 32 caracteres**. La app no arranca si falta o es demasiado corto. |
| `GROQ_API_KEY` | No | Habilita el asistente Nova y el análisis con IA de los informes de KPIs |
| `ZOOM_ACCOUNT_ID` / `ZOOM_CLIENT_ID` / `ZOOM_CLIENT_SECRET` | No | Credenciales Server-to-Server OAuth de Zoom para crear reuniones reales. Sin ellas se genera un enlace simulado. |

Para generar un `SESSION_SECRET` seguro:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"
```

> Nunca commitear `.env` ni `.env.local` — ya están en `.gitignore`.

### 3. Base de datos

```bash
npx prisma generate         # genera el cliente Prisma (@/generated/prisma)
npx prisma migrate deploy   # aplica las migraciones existentes
npm run seed                # crea los usuarios iniciales
```

### 4. Levantar el servidor de desarrollo

```bash
npm run dev
```

Abrir [http://localhost:3000](http://localhost:3000).

## Usuarios iniciales (seed)

| Email | Contraseña | Rol |
|---|---|---|
| jefe@nexo.com | 123456 | JEFE_NACIONAL |
| coord.nacional@nexo.com | 123456 | COORDINADOR_NACIONAL |

## Scripts disponibles

```bash
npm run dev     # servidor de desarrollo
npm run build   # build de producción
npm run start   # servidor de producción (requiere build previo)
npm run lint    # ESLint
npm run seed    # ejecutar seed de usuarios iniciales
```

## Flujo de trabajo con Prisma

```bash
npx prisma migrate dev --name <nombre>  # crear y aplicar una nueva migración
npx prisma generate                     # regenerar el cliente tras cambios en el schema
npx prisma studio                       # explorador visual de la base de datos
```

> **Prisma 7**: requiere un driver adapter para conectar a la base de datos — `new PrismaClient()` sin opciones lanza error en runtime. Ver `src/lib/prisma.ts`. Los tipos se importan desde `@/generated/prisma/client` (no `@/generated/prisma`).

## Estructura del proyecto

```
src/
  app/
    login/              # página de login (pública)
    (protected)/        # rutas protegidas (dashboard, tareas, equipo, KPIs, etc.)
    api/                # route handlers (auth, tareas, usuarios, reuniones, ideas, KPIs...)
  components/           # componentes de UI por módulo
  lib/                  # sesión, roles, Prisma, utilidades, rate limiting
  proxy.ts              # protección de rutas (equivalente a middleware.ts en Next 16)
  generated/prisma/     # cliente Prisma generado (no editar, no versionado)
prisma/
  schema.prisma
  seed.ts
  migrations/
```

## Notas

- No hay framework de tests configurado.
- La cookie de sesión (`nexo-session`) es httpOnly, `SameSite=strict` y `Secure` en producción.
- El login tiene rate limiting: 5 intentos fallidos por IP bloquean nuevos intentos durante 15 minutos.
- Las contraseñas se almacenan con bcrypt (10 rondas), nunca en texto plano.
