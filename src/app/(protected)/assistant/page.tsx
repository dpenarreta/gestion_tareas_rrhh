import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import AssistantModule from "@/components/assistant/AssistantModule";

export default async function AssistantPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  return (
    <div className="flex flex-col gap-6 h-full">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Asistente IA</h1>
        <p className="text-slate-500 mt-1 text-sm">
          Consulta sobre tus tareas, tu equipo o cualquier tema de RRHH
        </p>
      </div>
      <AssistantModule currentUserRole={session.role} />
    </div>
  );
}
