import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { getVisibleIdeaAuthorIds } from "@/lib/ideas";
import IdeasModule from "@/components/ideas/IdeasModule";

export default async function MejoraContinuaPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const visibleIds = await getVisibleIdeaAuthorIds(session);
  const ideas = await prisma.improvementIdea.findMany({
    where: { authorId: { in: visibleIds } },
    select: {
      id: true,
      title: true,
      description: true,
      impact: true,
      status: true,
      attachmentUrl: true,
      createdAt: true,
      updatedAt: true,
      author: { select: { id: true, name: true, role: true } },
      history: {
        where: { toStatus: "RECHAZADA" },
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { comment: true },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  const serializedIdeas = ideas.map(({ history, ...i }) => ({
    ...i,
    createdAt: i.createdAt.toISOString(),
    updatedAt: i.updatedAt.toISOString(),
    latestRejectionComment: history[0]?.comment ?? null,
  }));

  return (
    <div>
      <h1 className="text-2xl font-bold text-title mb-6">Mejora Continua</h1>
      <IdeasModule
        initialIdeas={serializedIdeas}
        currentUserId={session.userId}
        currentUserRole={session.role}
      />
    </div>
  );
}
