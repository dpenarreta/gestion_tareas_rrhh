import { NextRequest, NextResponse } from "next/server";
import type { Role } from "@/lib/roles";
import { getSession, createSession } from "@/lib/session";
import { djangoApiFetch, extractDjangoFieldErrorMessage } from "@/lib/djangoSession";
import { sessionPermissionsFor } from "@/lib/permissions";

// Fase 6b de la migración de stack (ver docs/AUDIT_LOG.md § 2026-08-17):
// identidad (name/email/role/createdAt) pasa a Django. `activityFormat`
// cerró su excepción híbrida en la Fase 55 (ver docs/AUDIT_LOG.md §
// 2026-08-25) — `ActivityFormatView` ya expone `view_preferences` de
// Django con el mismo truco de prefijo (`ACTIVITY_FORMAT:`) que usaba
// Prisma.
const DJANGO_SESSION_REQUIRED_MESSAGE =
  "Tu sesión no tiene aún acceso a este módulo. Cierra sesión y volvé a iniciar sesión.";

type DjangoMe = {
  id: number;
  username: string;
  email: string;
  first_name: string;
  date_joined: string;
  roles: { id: number; name: string }[];
  permissions: string[];
};

type DjangoActivityFormat = { activity_format: "duration" | "timerange" };
type DjangoSeguridadConfig = { session_duration_default_hours: number };

// Mismo default que Django (`DEFAULT_SESSION_DURATION_DEFAULT_HOURS`,
// `backend/apps/configuration/services.py`) — solo se usa si Django no
// tiene sesión disponible en este request puntual.
const DEFAULT_SESSION_DURATION_HOURS = 168;

/** Duración (horas) para la sesión re-emitida tras editar el perfil —
 * Fase 62 de la migración de stack (ver docs/AUDIT_LOG.md § 2026-08-25):
 * antes leía `getEffectiveSessionDurationDefaultHours` (Postgres, vía
 * `session.ts`); ahora se resuelve acá contra Django
 * (`GET /settings/seguridad-config/`, mismo endpoint que el login ya usa
 * indirectamente vía `session_policy`) y se pasa como
 * `durationHoursOverride` — preserva el comportamiento preexistente de
 * usar siempre la duración "default", nunca "recordarme", sin importar
 * cómo se creó la sesión original (quirk heredado, no corregido acá). */
async function fetchSessionDurationDefaultHours(): Promise<number> {
  const response = await djangoApiFetch("/settings/seguridad-config/");
  if (!response || !response.ok) return DEFAULT_SESSION_DURATION_HOURS;
  const data = (await response.json()) as DjangoSeguridadConfig;
  return Number.isFinite(data.session_duration_default_hours) ? data.session_duration_default_hours : DEFAULT_SESSION_DURATION_HOURS;
}

function mapDjangoMe(me: DjangoMe) {
  return {
    id: String(me.id),
    name: me.first_name || me.username,
    email: me.email,
    role: (me.roles[0]?.name ?? null) as Role | null,
    createdAt: me.date_joined,
  };
}

/** `"duration"` best-effort si Django no tiene el dato disponible — mismo
 * default que usaba `getActivityFormat` cuando `viewPreferences` no traía
 * la clave. */
async function readActivityFormat(): Promise<"duration" | "timerange"> {
  const response = await djangoApiFetch("/users/activity-format/");
  if (!response || !response.ok) return "duration";
  const data = (await response.json()) as DjangoActivityFormat;
  return data.activity_format;
}

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const response = await djangoApiFetch("/auth/me/");
  if (!response) {
    return NextResponse.json({ error: DJANGO_SESSION_REQUIRED_MESSAGE }, { status: 401 });
  }
  if (!response.ok) {
    return NextResponse.json({ error: "Usuario no encontrado" }, { status: 404 });
  }

  const me: DjangoMe = await response.json();
  const activityFormat = await readActivityFormat();
  return NextResponse.json({ ...mapDjangoMe(me), activityFormat });
}

export async function PATCH(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const { name, email, activityFormat } = await request.json();
  const hasProfileFields = name !== undefined || email !== undefined;

  if (hasProfileFields) {
    if (!name?.trim()) {
      return NextResponse.json({ error: "El nombre es requerido" }, { status: 400 });
    }
    if (!email?.trim()) {
      return NextResponse.json({ error: "El correo es requerido" }, { status: 400 });
    }
  }
  if (activityFormat !== undefined && activityFormat !== "duration" && activityFormat !== "timerange") {
    return NextResponse.json({ error: "Formato de actividad inválido" }, { status: 400 });
  }

  const response = hasProfileFields
    ? await djangoApiFetch("/auth/me/", {
        method: "PATCH",
        body: JSON.stringify({ first_name: name.trim(), email: email.trim().toLowerCase() }),
      })
    : await djangoApiFetch("/auth/me/");

  if (!response) {
    return NextResponse.json({ error: DJANGO_SESSION_REQUIRED_MESSAGE }, { status: 401 });
  }
  if (!response.ok) {
    const message = await extractDjangoFieldErrorMessage(response);
    return NextResponse.json({ error: message ?? "Ese correo ya está en uso" }, { status: 400 });
  }

  const me: DjangoMe = await response.json();
  const identity = mapDjangoMe(me);

  if (hasProfileFields) {
    const durationHours = await fetchSessionDurationDefaultHours();
    await createSession(
      {
        role: identity.role as Role,
        name: identity.name,
        email: identity.email,
        djangoUserId: me.id,
        permissions: sessionPermissionsFor(identity.role as Role, me.permissions),
      },
      false,
      durationHours
    );
  }

  if (activityFormat !== undefined) {
    await djangoApiFetch("/users/activity-format/", {
      method: "PATCH",
      body: JSON.stringify({ activity_format: activityFormat }),
    });
  }

  const finalActivityFormat = await readActivityFormat();
  return NextResponse.json({ ...identity, activityFormat: finalActivityFormat });
}
