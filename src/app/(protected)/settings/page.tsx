import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import ConfigCenter from "@/components/settings/ConfigCenter";

// Acceso exclusivo de Administrador — antes este gate también dejaba pasar a
// Coordinador Nacional, pero SettingsManager.tsx (ahora ConfigCenter.tsx)
// escondía todo detrás de un segundo gate más estricto (isAdmin), y el link de
// navegación (navLinks.ts) ya era Administrador-only: 2 de 3 fuentes ya
// coincidían en este criterio, así que se corrige el tercero en vez de
// ampliar los otros dos (Sprint O — Centro de Configuración NEXO).
export default async function SettingsPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role !== "ADMINISTRADOR") redirect("/dashboard");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-title">Centro de Configuración NEXO</h1>
        <p className="text-secondary text-sm">
          Toda la configuración funcional de la plataforma, organizada por categoría — historial,
          restauración a valores predeterminados, búsqueda y favoritos.
        </p>
      </div>
      <ConfigCenter currentUserRole={session.role} />
    </div>
  );
}
