import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { getConfigFavoritesForUser, setConfigFavorite } from "@/lib/configFavorites";

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const favorites = await getConfigFavoritesForUser(session.userId);
  return NextResponse.json({ favorites });
}

export async function PATCH(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  let body: { settingId?: string; pinned?: boolean };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Cuerpo inválido" }, { status: 400 });
  }

  if (typeof body.settingId !== "string" || !body.settingId || typeof body.pinned !== "boolean") {
    return NextResponse.json({ error: "settingId y pinned son requeridos" }, { status: 400 });
  }

  await setConfigFavorite(session.userId, body.settingId, body.pinned);
  return NextResponse.json({ ok: true });
}
