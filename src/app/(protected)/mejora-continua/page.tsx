import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { djangoApiFetch, resolveDjangoUserId } from "@/lib/djangoSession";
import { mapDjangoIdeaListItemToNexoShape, type DjangoIdeaListItem } from "@/lib/djangoIdeasAdapter";
import IdeasModule from "@/components/ideas/IdeasModule";

// Cutover de stack (ver docs/AUDIT_LOG.md § 2026-08-21): esta página hacía
// su propia consulta a Prisma (no vía `/api/ideas`) — pasa a Django, mismo
// criterio que `tasks/page.tsx` (Fase 3a). `currentUserId` ahora es
// `djangoUserId` (Fase 40): `IdeaCard`/`IdeasModule` comparan `idea.author.id`
// (id numérico de Django, ya que Ideas se corta en esta misma fase) contra
// este prop para decidir "¿es mía?" — con el `cuid` de Postgres esa
// comparación dejaría de funcionar silenciosamente, mismo caso que
// `NotificationBell` en la Fase 41.
export default async function MejoraContinuaPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const [response, djangoUserId] = await Promise.all([djangoApiFetch("/ideas/"), resolveDjangoUserId(session)]);

  const ideas: DjangoIdeaListItem[] = response?.ok ? await response.json() : [];
  const serializedIdeas = ideas.map(mapDjangoIdeaListItemToNexoShape);

  return (
    <div>
      <IdeasModule
        initialIdeas={serializedIdeas}
        currentUserId={djangoUserId !== null ? String(djangoUserId) : ""}
        currentUserRole={session.role}
      />
    </div>
  );
}
