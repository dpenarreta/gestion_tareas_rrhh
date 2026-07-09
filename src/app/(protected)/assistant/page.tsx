import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import AssistantModule from "@/components/assistant/AssistantModule";

export default async function AssistantPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  return (
    <div className="flex flex-col gap-6 h-full">
      <p className="text-secondary text-sm">
        Asistente de RRHH — consulta políticas, procedimientos, gestión de personal y más
      </p>
      <AssistantModule />
    </div>
  );
}
