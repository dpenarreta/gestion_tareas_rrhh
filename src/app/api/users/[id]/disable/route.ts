import { NextRequest, NextResponse } from "next/server";
import { djangoApiFetch, extractDjangoFieldErrorMessage } from "@/lib/djangoSession";
import { resolveUserAdminAccess, DJANGO_SESSION_REQUIRED_MESSAGE } from "@/lib/userAdminAccess";

// Baja lógica de un usuario. Vivía en el `DELETE` de `../route.ts`, que es
// justamente lo que hacía imposible entender la pantalla: el botón decía
// "Eliminar", la ruta decía `DELETE`, y lo que pasaba era una baja. Desde
// 2026-09-11 cada operación tiene su verbo y su ruta — `DELETE` borra de
// verdad, esto da de baja (ver docs/AUDIT_LOG.md § 2026-09-11).
export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;

  // Darse de baja a uno mismo dejaría la sesión en curso sin cuenta activa.
  const access = await resolveUserAdminAccess(id, {
    selfActionError: "No puedes deshabilitar tu propia cuenta",
  });
  if (!access.ok) return access.response;

  const response = await djangoApiFetch(`/admin/users/${id}/disable/`, { method: "POST" });
  if (!response) {
    return NextResponse.json({ error: DJANGO_SESSION_REQUIRED_MESSAGE }, { status: 401 });
  }
  if (!response.ok) {
    // Django rechaza, por ejemplo, dar de baja al único administrador activo
    // — ese motivo concreto le sirve a quien lo está intentando.
    const message = await extractDjangoFieldErrorMessage(response);
    return NextResponse.json(
      { error: message ?? "No se pudo deshabilitar el usuario" },
      { status: response.status === 400 ? 400 : 500 }
    );
  }

  return NextResponse.json({ ok: true });
}
