import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { djangoApiFetch } from "@/lib/djangoSession";
import { mapDjangoNovedadesPayloadToNexoShape } from "@/lib/djangoNovedadesAdapter";
import MovementsView, { type MovementAccess } from "@/components/novedades/MovementsView";

// Ingresos y Salidas. Qué pestañas ve cada persona lo decide Django en cada
// carga (`novedades.ingresos_ver` / `novedades.salidas_ver`): un permiso
// retirado en Ajustes corta el acceso sin esperar a un nuevo inicio de sesión.
export default async function IngresosSalidasPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const response = await djangoApiFetch("/novedades/movements/access/", {}, 15_000).catch(() => null);
  if (!response?.ok) {
    return <Message text="No se pudo cargar la consulta en este momento. Intente nuevamente." />;
  }
  const access = mapDjangoNovedadesPayloadToNexoShape(await response.json()) as MovementAccess;
  if (!access.entries && !access.exits) {
    return <Message text="No tiene acceso a Ingresos ni a Salidas. Si lo necesita, solicítelo al Administrador." />;
  }
  return <MovementsView access={access} />;
}

function Message({ text }: { text: string }) {
  return (
    <div className="max-w-xl mx-auto mt-16 text-center space-y-2">
      <h1 className="text-xl font-bold text-title">Ingresos y Salidas</h1>
      <p className="text-secondary text-sm">{text}</p>
    </div>
  );
}
