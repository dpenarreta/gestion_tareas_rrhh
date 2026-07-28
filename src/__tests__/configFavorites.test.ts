import { describe, expect, it, vi, beforeEach } from "vitest";

const findUnique = vi.fn();
const update = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: { user: { findUnique, update } },
}));

const { getConfigFavoritesForUser, setConfigFavorite } = await import("@/lib/configFavorites");

describe("getConfigFavoritesForUser", () => {
  beforeEach(() => findUnique.mockReset());

  it("devuelve [] si el usuario no tiene favoritos", async () => {
    findUnique.mockResolvedValue({ viewPreferences: ["DASHBOARD_CARDS:a,b"] });
    expect(await getConfigFavoritesForUser("u1")).toEqual([]);
  });

  it("extrae solo las entradas con el prefijo CONFIG_FAVORITE:, sin el prefijo", async () => {
    findUnique.mockResolvedValue({
      viewPreferences: ["DASHBOARD_CARDS:a,b", "CONFIG_FAVORITE:holidays", "CONFIG_FAVORITE:nova-cache"],
    });
    expect(await getConfigFavoritesForUser("u1")).toEqual(["holidays", "nova-cache"]);
  });
});

describe("setConfigFavorite", () => {
  beforeEach(() => {
    findUnique.mockReset();
    update.mockReset().mockResolvedValue({});
  });

  it("agrega la entrada CONFIG_FAVORITE: al marcar como favorito", async () => {
    findUnique.mockResolvedValue({ viewPreferences: ["DASHBOARD_CARDS:a,b"] });
    await setConfigFavorite("u1", "holidays", true);
    expect(update).toHaveBeenCalledWith({
      where: { id: "u1" },
      data: { viewPreferences: ["DASHBOARD_CARDS:a,b", "CONFIG_FAVORITE:holidays"] },
    });
  });

  it("no duplica la entrada si ya estaba marcada como favorito", async () => {
    findUnique.mockResolvedValue({ viewPreferences: ["CONFIG_FAVORITE:holidays"] });
    await setConfigFavorite("u1", "holidays", true);
    expect(update).toHaveBeenCalledWith({
      where: { id: "u1" },
      data: { viewPreferences: ["CONFIG_FAVORITE:holidays"] },
    });
  });

  it("elimina la entrada al desmarcar como favorito", async () => {
    findUnique.mockResolvedValue({ viewPreferences: ["CONFIG_FAVORITE:holidays", "CONFIG_FAVORITE:nova-cache"] });
    await setConfigFavorite("u1", "holidays", false);
    expect(update).toHaveBeenCalledWith({
      where: { id: "u1" },
      data: { viewPreferences: ["CONFIG_FAVORITE:nova-cache"] },
    });
  });
});
