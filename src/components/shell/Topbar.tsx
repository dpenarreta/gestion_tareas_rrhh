"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, Search, LogOut } from "lucide-react";
import type { Role } from "@/generated/prisma/client";
import { getPageTitle } from "@/lib/navLinks";
import ThemeToggle from "@/components/ThemeToggle";
import NotificationBell from "@/components/NotificationBell";

type Props = {
  role: Role;
  userId: string;
  userName: string;
  roleLabel: string;
  onOpenMobileMenu: () => void;
  onOpenPalette: () => void;
  onLogout: () => Promise<void>;
};

export default function Topbar({
  role,
  userId,
  userName,
  roleLabel,
  onOpenMobileMenu,
  onOpenPalette,
  onLogout,
}: Props) {
  const pathname = usePathname();
  const title = getPageTitle(pathname, role);

  return (
    <header className="h-[60px] shrink-0 flex items-center justify-between gap-3 px-4 sm:px-6 border-b border-border bg-surface">
      <div className="flex items-center gap-3 min-w-0">
        <button
          onClick={onOpenMobileMenu}
          className="lg:hidden p-2 -ml-2 rounded-[9px] text-secondary hover:text-title hover:bg-surface2 transition-colors shrink-0"
          aria-label="Abrir menú"
        >
          <Menu className="w-5 h-5" strokeWidth={1.8} />
        </button>
        <h1 className="text-[20px] font-bold text-title truncate">{title}</h1>
      </div>

      <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
        <button
          onClick={onOpenPalette}
          className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-[9px] border border-border2 text-secondary hover:text-title hover:bg-surface2 transition-colors text-[13px]"
        >
          <Search className="w-[14px] h-[14px]" strokeWidth={2} />
          <span>Buscar</span>
          <kbd className="text-[11px] px-1.5 py-0.5 rounded bg-surface2 border border-border text-disabled">
            Ctrl K
          </kbd>
        </button>
        <button
          onClick={onOpenPalette}
          className="sm:hidden p-2 rounded-[9px] text-secondary hover:text-title hover:bg-surface2 transition-colors"
          aria-label="Buscar"
        >
          <Search className="w-[18px] h-[18px]" strokeWidth={1.8} />
        </button>

        <ThemeToggle userId={userId} />
        <NotificationBell />

        <Link
          href="/profile"
          className="hidden sm:flex items-center gap-2 pl-2 pr-1 py-1 rounded-[9px] hover:bg-surface2 transition-colors"
        >
          <div
            className="w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-semibold shrink-0"
            style={{ background: "var(--gradient-brand)" }}
          >
            {userName.charAt(0).toUpperCase()}
          </div>
          <div className="text-left leading-tight">
            <p className="text-[13px] font-medium text-title">{userName}</p>
            <p className="text-[11px] text-secondary">{roleLabel}</p>
          </div>
        </Link>

        <form action={onLogout}>
          <button
            type="submit"
            title="Salir"
            aria-label="Salir"
            className="p-2 rounded-[9px] text-secondary hover:text-danger hover:bg-danger-soft transition-colors"
          >
            <LogOut className="w-[18px] h-[18px]" strokeWidth={1.8} />
          </button>
        </form>
      </div>
    </header>
  );
}
