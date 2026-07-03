import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import AssistantModule from "@/components/assistant/AssistantModule";

export default async function AssistantPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  return (
    <div className="flex flex-col gap-6 h-full">
      <div>
        <h1 className="text-2xl font-bold text-title">Nova</h1>
        <p className="text-secondary mt-1 text-sm">
          Asistente de RRHH — consulta políticas, procedimientos, gestión de personal y más
        </p>
      </div>
      <AssistantModule currentUserRole={session.role} />
    </div>
  );
}
