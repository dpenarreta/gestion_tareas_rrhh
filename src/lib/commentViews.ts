import "server-only";
import { prisma } from "@/lib/prisma";

export async function attachUnreadComments<T extends { id: string }>(
  tasks: T[],
  userId: string
): Promise<(T & { hasUnreadComments: boolean })[]> {
  if (tasks.length === 0) return [];

  const taskIds = tasks.map((t) => t.id);
  const [otherComments, views] = await Promise.all([
    prisma.comment.findMany({
      where: { taskId: { in: taskIds }, authorId: { not: userId } },
      select: { taskId: true, createdAt: true },
    }),
    prisma.taskCommentView.findMany({
      where: { userId, taskId: { in: taskIds } },
      select: { taskId: true, viewedAt: true },
    }),
  ]);

  const viewMap = new Map(views.map((v) => [v.taskId, v.viewedAt]));
  const latestOtherCommentMap = new Map<string, Date>();
  for (const c of otherComments) {
    const cur = latestOtherCommentMap.get(c.taskId);
    if (!cur || c.createdAt > cur) latestOtherCommentMap.set(c.taskId, c.createdAt);
  }

  return tasks.map((t) => {
    const latest = latestOtherCommentMap.get(t.id);
    const viewedAt = viewMap.get(t.id);
    const hasUnreadComments = !!latest && (!viewedAt || latest > viewedAt);
    return { ...t, hasUnreadComments };
  });
}
