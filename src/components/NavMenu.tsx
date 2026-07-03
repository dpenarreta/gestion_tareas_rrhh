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
        { href: "/tasks", label: "Trabajo" },
        { href: "/meetings", label: "Reuniones" },
        { href: "/mejora-continua", label: "Mejora Continua" },
        { href: "/my-kpis", label: "Mi actividad" },
        { href: "/assistant", label: "Nova" },
      ]
    : [
        { href: "/dashboard", label: "Inicio" },
        { href: "/tasks", label: "Trabajo" },
        { href: "/meetings", label: "Reuniones" },
        { href: "/mejora-continua", label: "Mejora Continua" },
        { href: "/team", label: "Equipo" },
        { href: "/kpis", label: "Analytics" },
        { href: "/assistant", label: "Nova" },
        ...(canManageUsers(role) ? [{ href: "/admin/users", label: "Usuarios" }] : []),
      ];

  return (
    <nav className="flex items-center gap-1">
      {links.map((link) => (
        <Link
          key={link.href}
          href={link.href}
          className={`px-3 py-1.5 rounded-lg text-[15px] font-medium transition-colors ${
            pathname === link.href || pathname.startsWith(link.href + "/")
              ? "bg-primary-surface text-primary"
              : "text-secondary hover:text-title hover:bg-black/5 dark:hover:bg-white/5"
          }`}
        >
          {link.label}
        </Link>
      ))}
    </nav>
  );
}
