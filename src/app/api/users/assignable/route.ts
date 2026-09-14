import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { fetchDjangoAssignableUsers } from "@/lib/djangoUsersAdapter";

// Cutover de stack (ver docs/AUDIT_LOG.md § 2026-08-21): esta lista alimenta
// selectores cuyo destino final YA espera ids numéricos de Django
// (`RegularizeTargetTimeManager` filtra Tareas por `userId`, `DashboardModule`
// la pasa a `TaskFormModal` para `assignedToId`, ambos contra endpoints ya
// cutover con `Number(...)`) — devolver el `cuid` de Postgres los rompía
// silenciosamente (bug activo, no introducido acá). `AssignableUsersView`
// (Fase 26 del backend) es réplica exacta.
export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const users = await fetchDjangoAssignableUsers();
  if (users === null) {
    return NextResponse.json(
      { error: "Tu sesión no tiene aún acceso a este módulo. Cierra sesión y volvé a iniciar sesión." },
      { status: 401 }
    );
  }

  return NextResponse.json(users);
}
