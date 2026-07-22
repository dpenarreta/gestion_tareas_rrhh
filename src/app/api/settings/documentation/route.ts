import { NextRequest, NextResponse } from "next/server";
import { readFile, stat } from "fs/promises";
import path from "path";
import { getSession } from "@/lib/session";

// Únicos documentos expuestos por este endpoint — nunca un path arbitrario
// del request, para evitar cualquier lectura fuera de /docs (Sprint de
// Documentación §9: "la información debe leerse directamente desde los
// archivos Markdown para evitar duplicidad", sin base de datos nueva).
const DOC_FILES: Record<string, string> = {
  version: "VERSION.md",
  changelog: "CHANGELOG.md",
  decisions: "DECISIONS.md",
  roadmap: "ROADMAP.md",
  architecture: "ARCHITECTURE.md",
  formulas: "ANALYTICS_FORMULAS.md",
};

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  if (session.role !== "ADMINISTRADOR") {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }

  const key = request.nextUrl.searchParams.get("doc") ?? "";
  const fileName = DOC_FILES[key];
  if (!fileName) {
    return NextResponse.json({ error: "Documento no reconocido" }, { status: 400 });
  }

  const filePath = path.join(process.cwd(), "docs", fileName);
  try {
    const [content, stats] = await Promise.all([
      readFile(filePath, "utf8"),
      stat(filePath),
    ]);
    return NextResponse.json({ content, updatedAt: stats.mtime.toISOString() });
  } catch (err) {
    console.error("[GET /api/settings/documentation]", err);
    return NextResponse.json({ error: "No se pudo leer el documento" }, { status: 500 });
  }
}
