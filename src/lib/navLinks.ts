import {
  Home,
  ListTodo,
  CalendarDays,
  Lightbulb,
  Users,
  BarChart3,
  Sparkles,
  UserCog,
  Settings,
  Target,
  FolderKanban,
  type LucideIcon,
} from "lucide-react";
import type { Role } from "@/generated/prisma/client";
import { canManageUsers, canViewTeam } from "@/lib/roles";

export type NavSection = "general" | "gestion" | "inteligencia";

export type NavLink = {
  href: string;
  label: string;
  icon: LucideIcon;
  section: NavSection;
};

export const NAV_SECTION_LABELS: Record<NavSection, string> = {
  general: "General",
  gestion: "Gestión",
  inteligencia: "Inteligencia",
};

export function getNavLinks(role: Role): NavLink[] {
  const isLevel1 = !canViewTeam(role);

  const links: NavLink[] = [
    { href: "/dashboard", label: "Inicio", icon: Home, section: "general" },
    ...(role === "JEFE_NACIONAL"
      ? []
      : [{ href: "/tasks", label: "Trabajo", icon: ListTodo, section: "general" as const }]),
    { href: "/projects", label: "Proyectos", icon: FolderKanban, section: "general" },
    { href: "/meetings", label: "Reuniones", icon: CalendarDays, section: "general" },
    { href: "/mejora-continua", label: "Mejora Continua", icon: Lightbulb, section: "general" },
  ];

  if (isLevel1) {
    links.push({ href: "/my-kpis", label: "Mi actividad", icon: BarChart3, section: "general" });
  } else {
    links.push({ href: "/team", label: "Equipo", icon: Users, section: "gestion" });
    links.push({ href: "/kpis", label: "Analytics", icon: BarChart3, section: "gestion" });
    if (canManageUsers(role)) {
      links.push({ href: "/admin/users", label: "Usuarios", icon: UserCog, section: "gestion" });
    }
  }

  if (role === "ADMINISTRADOR" || role === "JEFE_NACIONAL") {
    links.push({ href: "/tiempo-objetivo", label: "Tiempo Objetivo", icon: Target, section: "gestion" });
  }

  if (role === "ADMINISTRADOR") {
    links.push({ href: "/settings", label: "Ajustes", icon: Settings, section: "gestion" });
  }

  links.push({ href: "/assistant", label: "Nova", icon: Sparkles, section: "inteligencia" });

  return links;
}

const EXTRA_TITLES: Record<string, string> = {
  "/profile": "Mi perfil",
};

export function getPageTitle(pathname: string, role: Role): string {
  const links = getNavLinks(role);
  const match = links.find((l) => pathname === l.href || pathname.startsWith(l.href + "/"));
  if (match) return match.label;
  return EXTRA_TITLES[pathname] ?? "Nexo";
}
