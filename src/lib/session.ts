import "server-only";
import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import type { Role } from "@/generated/prisma/client";
import { SESSION_SECRET } from "@/lib/session-secret";
import { getEffectiveSessionDurationDefaultHours, getEffectiveSessionDurationRememberHours } from "@/lib/systemConfig";

export type SessionPayload = {
  userId: string;
  role: Role;
  name: string;
  email: string;
  expiresAt: string;
};

const COOKIE_NAME = "nexo-session";
const secret = new TextEncoder().encode(SESSION_SECRET);

async function encrypt(payload: Omit<SessionPayload, "expiresAt">, durationMs: number) {
  const expiresAt = new Date(Date.now() + durationMs).toISOString();
  const days = Math.round(durationMs / (24 * 60 * 60 * 1000));
  return new SignJWT({ ...payload, expiresAt })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${days}d`)
    .sign(secret);
}

export async function decrypt(token: string): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, secret, {
      algorithms: ["HS256"],
    });
    return payload as unknown as SessionPayload;
  } catch {
    return null;
  }
}

export async function createSession(
  data: Omit<SessionPayload, "expiresAt">,
  rememberMe = false
) {
  // Configurable desde Sprint O (antes: literales 7d/30d fijos) — solo afecta
  // sesiones NUEVAS, los JWT ya emitidos conservan su `exp` original.
  const durationHours = rememberMe
    ? await getEffectiveSessionDurationRememberHours()
    : await getEffectiveSessionDurationDefaultHours();
  const durationMs = durationHours * 60 * 60 * 1000;
  const expiresAt = new Date(Date.now() + durationMs);
  const token = await encrypt(data, durationMs);
  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    expires: expiresAt,
    sameSite: "strict",
    path: "/",
  });
}

export async function deleteSession() {
  const cookieStore = await cookies();
  cookieStore.delete(COOKIE_NAME);
}

export async function getSession(): Promise<SessionPayload | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  if (!token) return null;
  return decrypt(token);
}

export async function getSessionFromToken(
  token: string | undefined
): Promise<SessionPayload | null> {
  if (!token) return null;
  return decrypt(token);
}
