"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Role } from "@/generated/prisma/client";
import { canManageUsers, canViewTeam } from "@/lib/roles";

type Props = { role: Role };

export default function NavMenu({ role }: Props) {
  const pathname = usePathname();
  const isLevel1 = !canViewTeam(role);

  const links = isLevel1
    ? [
        { href: "/dashboard", label: "Inicio" },
        { href: "/tasks", label: "Tareas" },
        { href: "/my-kpis", label: "Mi actividad" },
        { href: "/assistant", label: "Asistente" },
      ]
    : [
        { href: "/dashboard", label: "Inicio" },
        { href: "/tasks", label: "Tareas" },
        { href: "/team", label: "Equipo" },
        { href: "/kpis", label: "Analytics" },
        { href: "/assistant", label: "Asistente" },
        ...(canManageUsers(role) ? [{ href: "/admin/users", label: "Usuarios" }] : []),
      ];

  return (
    <nav className="flex items-center gap-1">
      {links.map((link) => (
        <Link
          key={link.href}
          href={link.href}
          className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
            pathname === link.href || pathname.startsWith(link.href + "/")
              ? "bg-indigo-50 text-indigo-700"
              : "text-slate-600 hover:text-slate-900 hover:bg-slate-100"
          }`}
        >
          {link.label}
        </Link>
      ))}
    </nav>
  );
}
