import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import packageJson from "../../../../../package.json";

// Aproximación honesta de "fecha de último deploy": no hay timestamp de deploy
// expuesto por la plataforma en runtime, así que usamos el momento en que este
// módulo se cargó en frío (coincide con cada deploy nuevo en Vercel, aunque
// también se reinicia ante un cold start normal).
const SERVER_STARTED_AT = new Date().toISOString();

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  if (session.role !== "ADMINISTRADOR") {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }

  const [totalUsers, totalTasks, totalMeetings, totalIdeas] = await Promise.all([
    prisma.user.count(),
    prisma.task.count(),
    prisma.meeting.count(),
    prisma.improvementIdea.count(),
  ]);

  return NextResponse.json({
    version: packageJson.version,
    commitSha: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? null,
    serverStartedAt: SERVER_STARTED_AT,
    totalUsers,
    totalTasks,
    totalMeetings,
    totalIdeas,
  });
}
