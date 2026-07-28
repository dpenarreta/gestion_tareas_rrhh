"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { Star } from "lucide-react";
import { getDescriptor } from "@/components/settings/registry";
import { SETTINGS_CATEGORY_LABEL } from "@/lib/settingsCategories";
import { slugify } from "@/lib/textSearch";

type FavoritesContextValue = {
  favorites: string[];
  isFavorite: (settingId: string) => boolean;
  toggleFavorite: (settingId: string) => void;
};

const FavoritesContext = createContext<FavoritesContextValue | null>(null);

/** Carga los favoritos del usuario una sola vez y los comparte entre FavoriteStarButton/FavoritesSection. */
export function FavoritesProvider({ children }: { children: React.ReactNode }) {
  const [favorites, setFavorites] = useState<string[]>([]);

  const load = useCallback(async () => {
    const res = await fetch("/api/settings/favorites");
    if (res.ok) {
      const data = await res.json();
      setFavorites(data.favorites ?? []);
    }
  }, []);

  useEffect(() => {
    queueMicrotask(load);
  }, [load]);

  const toggleFavorite = useCallback(
    (settingId: string) => {
      setFavorites((prev) => {
        const pinned = !prev.includes(settingId);
        const next = pinned ? [...prev, settingId] : prev.filter((id) => id !== settingId);
        fetch("/api/settings/favorites", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ settingId, pinned }),
        });
        return next;
      });
    },
    []
  );

  const isFavorite = useCallback((settingId: string) => favorites.includes(settingId), [favorites]);

  return (
    <FavoritesContext.Provider value={{ favorites, isFavorite, toggleFavorite }}>
      {children}
    </FavoritesContext.Provider>
  );
}

function useFavorites(): FavoritesContextValue {
  const ctx = useContext(FavoritesContext);
  if (!ctx) throw new Error("useFavorites debe usarse dentro de <FavoritesProvider>");
  return ctx;
}

export function FavoriteStarButton({ settingId }: { settingId: string }) {
  const { isFavorite, toggleFavorite } = useFavorites();
  const pinned = isFavorite(settingId);

  return (
    <button
      type="button"
      onClick={() => toggleFavorite(settingId)}
      aria-pressed={pinned}
      aria-label={pinned ? "Quitar de favoritos" : "Marcar como favorito"}
      title={pinned ? "Quitar de favoritos" : "Marcar como favorito"}
      className="p-1.5 rounded hover:bg-primary-surface transition-colors"
    >
      <Star className={`w-3.5 h-3.5 ${pinned ? "fill-warning text-warning" : "text-disabled"}`} strokeWidth={1.8} />
    </button>
  );
}

/** Lista de accesos directos a settings marcados como favoritos — navega/hace scroll a la sección real, no la duplica. */
export default function FavoritesSection({ onNavigate }: { onNavigate: (category: string, anchor: string) => void }) {
  const { favorites } = useFavorites();
  if (favorites.length === 0) return null;

  const descriptors = favorites.map((id) => getDescriptor(id)).filter((d): d is NonNullable<typeof d> => !!d);
  if (descriptors.length === 0) return null;

  return (
    <div className="mb-6">
      <h3 className="text-[11px] font-semibold text-secondary uppercase tracking-wider mb-2">Favoritos</h3>
      <div className="flex flex-wrap gap-2">
        {descriptors.map((d) => (
          <button
            key={d.id}
            type="button"
            onClick={() => onNavigate(d.category, slugify(d.id))}
            className="flex items-center gap-1.5 text-xs font-medium text-title bg-surface border border-border rounded-full px-3 py-1.5 hover:border-primary transition-colors"
          >
            <Star className="w-3 h-3 fill-warning text-warning" strokeWidth={1.8} />
            {d.label}
            <span className="text-disabled font-normal">· {SETTINGS_CATEGORY_LABEL[d.category]}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
