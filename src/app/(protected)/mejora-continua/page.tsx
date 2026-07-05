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
      progress: true,
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
      _count: { select: { votes: true } },
      votes: { where: { userId: session.userId }, select: { id: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  const serializedIdeas = ideas.map(({ history, _count, votes, ...i }) => ({
    ...i,
    createdAt: i.createdAt.toISOString(),
    updatedAt: i.updatedAt.toISOString(),
    latestRejectionComment: history[0]?.comment ?? null,
    voteCount: _count.votes,
    votedByMe: votes.length > 0,
  }));

  return (
    <div>
      <IdeasModule
        initialIdeas={serializedIdeas}
        currentUserId={session.userId}
        currentUserRole={session.role}
      />
    </div>
  );
}
