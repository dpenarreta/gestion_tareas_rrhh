const ALLOWED_EXTENSIONS = new Set(["png", "jpg", "jpeg", "pdf", "doc", "docx", "xls", "xlsx"]);
const MAX_SIZE_BYTES = 8 * 1024 * 1024;

export class AttachmentError extends Error {}

export type SavedAttachment = {
  /** Full data: URL (data:<mime>;base64,<payload>) — stored in ImprovementIdea.attachmentData. */
  attachmentData: string;
  /** Original file name, stored in ImprovementIdea.attachmentUrl for display/download. */
  fileName: string;
};

/**
 * Encodes the file as a base64 data URL stored directly in the database.
 * Vercel's serverless filesystem is read-only/ephemeral, so writing to
 * public/uploads (the previous approach) silently failed in production —
 * see project history. Storing the attachment in the row itself avoids
 * needing any external file storage.
 */
export async function saveIdeaAttachment(file: File): Promise<SavedAttachment> {
  if (file.size > MAX_SIZE_BYTES) {
    throw new AttachmentError("El archivo supera el tamaño máximo permitido (8MB)");
  }
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    throw new AttachmentError("Tipo de archivo no permitido");
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const mimeType = file.type || "application/octet-stream";
  const attachmentData = `data:${mimeType};base64,${buffer.toString("base64")}`;

  return { attachmentData, fileName: file.name };
}
