"use client";

import { useCallback, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import type { Role } from "@/generated/prisma/client";
import Sidebar from "./Sidebar";
import Topbar from "./Topbar";
import CommandPalette from "./CommandPalette";
import NovaFab from "./NovaFab";
import ReminderNotifier from "@/components/reminders/ReminderNotifier";

type Props = {
  role: Role;
  userId: string;
  userName: string;
  roleLabel: string;
  onLogout: () => Promise<void>;
  children: React.ReactNode;
};

const SIDEBAR_COLLAPSED_KEY = "nexo-sidebar-collapsed";

export default function AppShell({ role, userId, userName, roleLabel, onLogout, children }: Props) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);

  useEffect(() => {
    queueMicrotask(() => {
      if (localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "1") setCollapsed(true);
    });
  }, []);

  const toggleCollapsed = useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev;
      localStorage.setItem(SIDEBAR_COLLAPSED_KEY, next ? "1" : "0");
      return next;
    });
  }, []);

  useEffect(() => {
    queueMicrotask(() => setMobileOpen(false));
  }, [pathname]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen(true);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const showNovaFab = pathname !== "/assistant";

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <Sidebar
        role={role}
        collapsed={collapsed}
        onToggleCollapsed={toggleCollapsed}
        mobileOpen={mobileOpen}
        onCloseMobile={() => setMobileOpen(false)}
      />
      <div className="flex-1 flex flex-col min-w-0">
        <Topbar
          role={role}
          userId={userId}
          userName={userName}
          roleLabel={roleLabel}
          onOpenMobileMenu={() => setMobileOpen(true)}
          onOpenPalette={() => setPaletteOpen(true)}
          onLogout={onLogout}
        />
        <main className="flex-1 overflow-y-auto">
          <div className="max-w-[1280px] mx-auto px-[18px] sm:px-7 py-[26px]">{children}</div>
        </main>
      </div>
      <CommandPalette role={role} open={paletteOpen} onClose={() => setPaletteOpen(false)} />
      {showNovaFab && <NovaFab />}
      <ReminderNotifier />
    </div>
  );
}
