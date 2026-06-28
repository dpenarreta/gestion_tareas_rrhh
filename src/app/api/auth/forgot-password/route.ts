import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function POST(request: NextRequest) {
  const { email } = await request.json();

  if (!email) {
    return NextResponse.json({ error: "Email requerido" }, { status: 400 });
  }

  const user = await prisma.user.findUnique({ where: { email } });

  // Always return success (don't reveal if email exists)
  if (!user) {
    return NextResponse.json({
      message: `Si el email ${email} existe en el sistema, recibirás un enlace para restablecer tu contraseña.`,
      simulatedEmail: email,
    });
  }

  return NextResponse.json({
    message: `Se enviaría un correo de recuperación a: ${email}`,
    simulatedEmail: email,
  });
}
