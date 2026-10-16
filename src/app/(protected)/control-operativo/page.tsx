import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { djangoApiFetch } from "@/lib/djangoSession";
import { mapDjangoNovedadesPayloadToNexoShape } from "@/lib/djangoNovedadesAdapter";
import NovedadesModule from "@/components/novedades/NovedadesModule";
import type { NovedadesMe } from "@/components/novedades/types";

// Control Operativo de Novedades. El acceso lo decide Django en cada request
// (`novedades.acceder` efectivo, con excepciones individuales): el rol de la
// sesión de Next.js no alcanza, porque un permiso revocado en Ajustes debe
// cortar el acceso sin esperar a que la persona vuelva a iniciar sesión.
export default async function ControlOperativoPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const response = await djangoApiFetch("/novedades/me/", {}, 15_000).catch(() => null);
  if (!response?.ok) {
    return (
      <div className="max-w-xl mx-auto mt-16 text-center space-y-2">
        <h1 className="text-xl font-bold text-title">Control Operativo de Novedades</h1>
        <p className="text-secondary text-sm">
          {response?.status === 403
            ? "No tiene acceso a este módulo. Si lo necesita, solicítelo al Administrador."
            : "No se pudo cargar el módulo en este momento. Intente nuevamente."}
        </p>
      </div>
    );
  }
  const me = mapDjangoNovedadesPayloadToNexoShape(await response.json()) as NovedadesMe;
  return <NovedadesModule me={me} />;
}
