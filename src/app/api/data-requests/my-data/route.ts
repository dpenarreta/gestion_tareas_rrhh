import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const userId = session.userId;

  const [user, tasks, activities, comments, meetingsHosted, meetingsInvited, ideas, votes, priorRequests] =
    await Promise.all([
      prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          theme: true,
          viewPreferences: true,
          badges: true,
          lastLoginAt: true,
          dataConsentAccepted: true,
          dataConsentAcceptedAt: true,
          createdAt: true,
        },
      }),
      prisma.task.findMany({
        where: { assignedToId: userId },
        select: {
          id: true, title: true, description: true, status: true, priority: true,
          frequency: true, type: true, startDate: true, endDate: true,
          estimatedHours: true, realHours: true, progress: true, completedAt: true, createdAt: true,
        },
      }),
      prisma.taskActivity.findMany({
        where: { authorId: userId },
        select: { id: true, taskId: true, reason: true, startTime: true, endTime: true, duration: true, description: true, createdAt: true },
      }),
      prisma.comment.findMany({
        where: { authorId: userId },
        select: { id: true, taskId: true, text: true, createdAt: true },
      }),
      prisma.meeting.findMany({
        where: { hostId: userId },
        select: { id: true, title: true, meetingDate: true, duration: true, status: true },
      }),
      prisma.meetingInvitee.findMany({
        where: { userId },
        select: { attended: true, meeting: { select: { id: true, title: true, meetingDate: true } } },
      }),
      prisma.improvementIdea.findMany({
        where: { authorId: userId },
        select: { id: true, title: true, description: true, impact: true, status: true, progress: true, createdAt: true },
      }),
      prisma.ideaVote.findMany({
        where: { userId },
        select: { ideaId: true, createdAt: true },
      }),
      prisma.dataSubjectRequest.findMany({
        where: { userId },
        select: { id: true, type: true, status: true, description: true, createdAt: true, resolvedAt: true },
      }),
    ]);

  if (!user) return NextResponse.json({ error: "Usuario no encontrado" }, { status: 404 });

  // El acceso directo queda registrado para trazabilidad, resuelto de inmediato
  // porque la exportación es autoservicio (no requiere gestión manual).
  await prisma.dataSubjectRequest.create({
    data: { userId, type: "ACCESO", status: "RESUELTA", resolvedAt: new Date() },
  });

  const exportPayload = {
    generadoEl: new Date().toISOString(),
    usuario: user,
    tareas: tasks,
    actividades: activities,
    comentarios: comments,
    reunionesOrganizadas: meetingsHosted,
    reunionesInvitado: meetingsInvited,
    ideasPropuestas: ideas,
    votosEnIdeas: votes,
    solicitudesPrevias: priorRequests,
  };

  return new NextResponse(JSON.stringify(exportPayload, null, 2), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="nexo-mis-datos-${userId}.json"`,
    },
  });
}
