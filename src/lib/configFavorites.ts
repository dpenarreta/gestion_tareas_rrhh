import "server-only";
import { prisma } from "@/lib/prisma";

// Favoritos del Centro de Configuración — reusa User.viewPreferences con un
// prefijo, exactamente el mismo patrón ya usado por el orden de tarjetas del
// Dashboard (ver src/app/api/dashboard/card-order/route.ts). Un elemento del
// array por favorito (no un valor único unido con comas, como sí hace
// card-order) porque los favoritos son un conjunto, no un orden.

const PREFIX = "CONFIG_FAVORITE:";

export async function getConfigFavoritesForUser(userId: string): Promise<string[]> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { viewPreferences: true } });
  return (user?.viewPreferences ?? [])
    .filter((v) => v.startsWith(PREFIX))
    .map((v) => v.slice(PREFIX.length));
}

export async function setConfigFavorite(userId: string, settingId: string, pinned: boolean): Promise<void> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { viewPreferences: true } });
  const existing = user?.viewPreferences ?? [];
  const entry = `${PREFIX}${settingId}`;
  const withoutEntry = existing.filter((v) => v !== entry);
  const updated = pinned ? [...withoutEntry, entry] : withoutEntry;

  await prisma.user.update({ where: { id: userId }, data: { viewPreferences: updated } });
}
