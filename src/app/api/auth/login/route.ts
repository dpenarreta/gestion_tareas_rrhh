import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { createSession } from "@/lib/session";
import { isRateLimited, registerFailedAttempt, clearAttempts, getClientIp } from "@/lib/rate-limit";

export async function POST(request: NextRequest) {
  const clientIp = getClientIp(request.headers);

  try {
    if (isRateLimited(clientIp)) {
      return NextResponse.json(
        { error: "Demasiados intentos fallidos. Intenta nuevamente en 15 minutos" },
        { status: 429 }
      );
    }

    const { email, password, rememberMe = false } = await request.json();

    if (!email || !password) {
      return NextResponse.json(
        { error: "Email y contraseña requeridos" },
        { status: 400 }
      );
    }

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      registerFailedAttempt(clientIp);
      return NextResponse.json(
        { error: "Credenciales inválidas" },
        { status: 401 }
      );
    }

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) {
      registerFailedAttempt(clientIp);
      return NextResponse.json(
        { error: "Credenciales inválidas" },
        { status: 401 }
      );
    }

    clearAttempts(clientIp);

    await prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    await createSession(
      { userId: user.id, role: user.role, name: user.name, email: user.email },
      Boolean(rememberMe)
    );

    return NextResponse.json({
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
    });
  } catch {
    return NextResponse.json({ error: "Error del servidor" }, { status: 500 });
  }
}
