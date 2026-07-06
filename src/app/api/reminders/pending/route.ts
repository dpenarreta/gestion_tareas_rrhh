import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";

export async function GET() {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "No autenticado" }, { status: 401 });
    }

    const now = new Date();
    const reminders = await prisma.followUpReminder.findMany({
      where: {
        userId: session.userId,
        completedAt: null,
        reminderAt: { lte: now },
        OR: [{ snoozedUntil: null }, { snoozedUntil: { lte: now } }],
      },
      select: {
        id: true,
        title: true,
        description: true,
        reminderAt: true,
        task: { select: { id: true, title: true } },
      },
      orderBy: { reminderAt: "asc" },
    });

    return NextResponse.json(reminders);
  } catch (err) {
    console.error("GET /api/reminders/pending error:", err);
    return NextResponse.json([], { status: 200 });
  }
}
