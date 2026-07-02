import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";

const ALLOWED_EXTENSIONS = new Set(["png", "jpg", "jpeg", "pdf", "doc", "docx", "xls", "xlsx"]);
const MAX_SIZE_BYTES = 8 * 1024 * 1024;
const UPLOAD_DIR = path.join(process.cwd(), "public", "uploads", "ideas");

function sanitizeBaseName(name: string): string {
  const base = name.replace(/\.[^./\\]+$/, "");
  const cleaned = base.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 60);
  return cleaned || "archivo";
}

export class AttachmentError extends Error {}

export async function saveIdeaAttachment(file: File): Promise<string> {
  if (file.size > MAX_SIZE_BYTES) {
    throw new AttachmentError("El archivo supera el tamaño máximo permitido (8MB)");
  }
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    throw new AttachmentError("Tipo de archivo no permitido");
  }

  await mkdir(UPLOAD_DIR, { recursive: true });
  const filename = `${randomUUID()}-${sanitizeBaseName(file.name)}.${ext}`;
  const buffer = Buffer.from(await file.arrayBuffer());
  await writeFile(path.join(UPLOAD_DIR, filename), buffer);

  return `/uploads/ideas/${filename}`;
}
