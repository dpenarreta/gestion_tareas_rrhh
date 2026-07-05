"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import type { Role } from "@/generated/prisma/client";
import { getNavLinks, NAV_SECTION_LABELS, type NavSection } from "@/lib/navLinks";

type Props = {
  role: Role;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  mobileOpen: boolean;
  onCloseMobile: () => void;
};

const SECTIONS: NavSection[] = ["general", "gestion", "inteligencia"];

export default function Sidebar({ role, collapsed, onToggleCollapsed, mobileOpen, onCloseMobile }: Props) {
  const pathname = usePathname();
  const links = getNavLinks(role);

  return (
    <>
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 lg:hidden"
          onClick={onCloseMobile}
          aria-hidden="true"
        />
      )}
      <aside
        className={`fixed lg:static inset-y-0 left-0 z-50 flex flex-col bg-surface border-r border-border shrink-0 w-[236px] transition-transform duration-200 ease-out lg:transition-[width] lg:duration-[220ms] lg:ease-in-out lg:translate-x-0 ${
          collapsed ? "lg:w-16" : "lg:w-[236px]"
        } ${mobileOpen ? "translate-x-0" : "-translate-x-full"}`}
      >
        <div className="h-[60px] flex items-center gap-2.5 px-4 border-b border-border shrink-0 overflow-hidden">
          <div
            className="w-8 h-8 rounded-[9px] shrink-0 flex items-center justify-center text-white font-bold text-sm"
            style={{ background: "var(--gradient-brand)" }}
          >
            N
          </div>
          <span className={`text-[16px] font-bold text-title truncate ${collapsed ? "lg:hidden" : ""}`}>
            Nexo
          </span>
        </div>

        <nav className="flex-1 overflow-y-auto overflow-x-hidden py-3 px-2 space-y-4">
          {SECTIONS.map((section) => {
            const items = links.filter((l) => l.section === section);
            if (items.length === 0) return null;
            return (
              <div key={section}>
                <p
                  className={`px-2.5 mb-1.5 text-[11px] font-semibold uppercase tracking-[.08em] text-disabled ${
                    collapsed ? "lg:hidden" : ""
                  }`}
                >
                  {NAV_SECTION_LABELS[section]}
                </p>
                <div className="space-y-0.5">
                  {items.map((link) => {
                    const active = pathname === link.href || pathname.startsWith(link.href + "/");
                    const Icon = link.icon;
                    return (
                      <Link
                        key={link.href}
                        href={link.href}
                        onClick={onCloseMobile}
                        className={`group relative flex items-center gap-2.5 px-2.5 py-2 rounded-[9px] text-[13px] transition-colors ${
                          active
                            ? "bg-primary-surface text-primary font-semibold"
                            : "text-secondary hover:text-title hover:bg-surface2"
                        } ${collapsed ? "lg:justify-center" : ""}`}
                      >
                        <Icon className="w-[18px] h-[18px] shrink-0" strokeWidth={1.8} />
                        <span className={collapsed ? "lg:hidden" : ""}>{link.label}</span>
                        {collapsed && (
                          <span className="hidden lg:group-hover:block absolute left-full ml-2 px-2 py-1 rounded-[7px] bg-title text-background text-xs whitespace-nowrap z-50">
                            {link.label}
                          </span>
                        )}
                      </Link>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </nav>

        <div className="p-2 border-t border-border shrink-0 hidden lg:block">
          <button
            onClick={onToggleCollapsed}
            className="w-full flex items-center justify-center gap-2 px-2.5 py-2 rounded-[9px] text-secondary hover:text-title hover:bg-surface2 transition-colors"
            aria-label={collapsed ? "Expandir menú" : "Contraer menú"}
          >
            <ChevronLeft
              className={`w-4 h-4 transition-transform duration-200 shrink-0 ${collapsed ? "rotate-180" : ""}`}
              strokeWidth={1.8}
            />
            {!collapsed && <span className="text-[13px]">Contraer</span>}
          </button>
        </div>
      </aside>
    </>
  );
}
