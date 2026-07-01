import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import Groq from "groq-sdk";

const CACHE_TTL_MS = 90 * 60 * 1000;

const cache = new Map<string, { message: string; expiresAt: number }>();

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const cached = cache.get(session.userId);
  if (cached && cached.expiresAt > Date.now()) {
    return NextResponse.json({ message: cached.message, cached: true });
  }

  const context = await request.json().catch(() => ({}));

  try {
    const completion = await groq.chat.completions.create({
      model: "llama3-8b-8192",
      messages: [
        {
          role: "system",
          content:
            "Eres Nova, asistente de Nexo. Genera un mensaje profesional y útil de máximo 30 palabras. Sin saludo, directo al punto.",
        },
        {
          role: "user",
          content: JSON.stringify(context),
        },
      ],
      max_tokens: 60,
      temperature: 0.7,
    });

    const message =
      completion.choices[0]?.message?.content?.trim() ??
      "Revisa tus tareas pendientes y mantén el enfoque en tus prioridades del día.";

    cache.set(session.userId, { message, expiresAt: Date.now() + CACHE_TTL_MS });
    return NextResponse.json({ message, cached: false });
  } catch {
    const fallbacks = [
      "Revisa tus tareas pendientes y mantén el enfoque en tus prioridades del día.",
      "Un buen día empieza con claridad. Revisa tu agenda y prioriza lo urgente.",
      "Mantén el ritmo. Cada tarea completada te acerca a tus metas del mes.",
    ];
    const message = fallbacks[Math.floor(Math.random() * fallbacks.length)];
    cache.set(session.userId, { message, expiresAt: Date.now() + CACHE_TTL_MS });
    return NextResponse.json({ message, cached: false });
  }
}
