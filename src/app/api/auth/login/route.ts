import { NextRequest, NextResponse } from "next/server";
import type { Role } from "@/lib/roles";
import { createSession } from "@/lib/session";
import { djangoApiFetch, loginToDjango, setDjangoTokenCookies } from "@/lib/djangoSession";

// Fase 6a de la migración de stack (ver docs/AUDIT_LOG.md § 2026-08-14):
// el login real deja de decidirse contra Prisma/bcrypt — Django es ahora
// la única fuente de verdad para validar credenciales (login + rate
// limiting por IP y por `identifier`, ambos ya resueltos del lado Django).
// La sesión de Next.js (`nexo-session`) guarda `djangoUserId` — el id
// numérico de Django, único identificador de sesión desde el retiro
// completo del `cuid` legado de Postgres (`legacy_postgres_id`, decisión
// explícita del usuario, ver docs/AUDIT_LOG.md § 2026-08-31). Antes de ese
// retiro, un usuario sin `legacy_postgres_id` (no importado desde Postgres)
// no podía iniciar sesión — ese gap queda cerrado: cualquier usuario
// creado directo en el panel de Django ya puede loguearse.
type DjangoMe = {
  id: number;
  username: string;
  email: string;
  first_name: string;
  roles: { id: number; name: string }[];
  permissions: string[];
};

export async function POST(request: NextRequest) {
  try {
    const { email, password, rememberMe = false } = await request.json();

    if (!email || !password) {
      return NextResponse.json({ error: "Email y contraseña requeridos" }, { status: 400 });
    }

    const result = await loginToDjango(email, password);
    if (!result.ok) {
      return NextResponse.json({ error: result.message }, { status: result.status === 503 ? 503 : 401 });
    }

    await setDjangoTokenCookies(result.tokens);

    const meResponse = await djangoApiFetch("/auth/me/");
    if (!meResponse || !meResponse.ok) {
      return NextResponse.json({ error: "Error del servidor" }, { status: 500 });
    }
    const me: DjangoMe = await meResponse.json();

    const roleName = me.roles[0]?.name;
    if (!roleName) {
      return NextResponse.json({ error: "Error del servidor" }, { status: 500 });
    }
    // Los 11 roles de Nexo ya están sembrados 1:1 en Django (mismos nombres
    // que el enum `Role` de Prisma, ver docs/AUDIT_LOG.md § 2026-08-07) —
    // el cast es seguro salvo un `Group` corrupto/renombrado a mano.
    const role = roleName as Role;
    const name = me.first_name || me.username;
    const durationHours = rememberMe ? result.tokens.session_policy.remember_hours : result.tokens.session_policy.default_hours;

    await createSession(
      { role, name, email: me.email, djangoUserId: me.id, permissions: me.permissions },
      Boolean(rememberMe),
      durationHours
    );

    return NextResponse.json({ id: me.id, name, email: me.email, role });
  } catch {
    return NextResponse.json({ error: "Error del servidor" }, { status: 500 });
  }
}
