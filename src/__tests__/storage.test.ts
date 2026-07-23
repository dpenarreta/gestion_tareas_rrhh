import { describe, expect, it } from "vitest";
import { saveAttachment, AttachmentError } from "@/lib/storage";

function makeFile(name: string, content: string, type: string): File {
  return new File([content], name, { type });
}

describe("saveAttachment", () => {
  it("codifica un archivo válido como data URL base64 y conserva el nombre original", async () => {
    const file = makeFile("foto.png", "hola-mundo", "image/png");
    const result = await saveAttachment(file);
    expect(result.fileName).toBe("foto.png");
    expect(result.attachmentData.startsWith("data:image/png;base64,")).toBe(true);

    const base64Part = result.attachmentData.split(",")[1];
    expect(Buffer.from(base64Part, "base64").toString("utf-8")).toBe("hola-mundo");
  });

  it("rechaza archivos con extensión no permitida", async () => {
    const file = makeFile("script.exe", "contenido", "application/octet-stream");
    await expect(saveAttachment(file)).rejects.toThrow(AttachmentError);
  });

  it("acepta cada una de las extensiones permitidas", async () => {
    for (const ext of ["png", "jpg", "jpeg", "pdf", "doc", "docx", "xls", "xlsx"]) {
      const file = makeFile(`documento.${ext}`, "x", "application/octet-stream");
      await expect(saveAttachment(file)).resolves.toBeDefined();
    }
  });

  it("rechaza un archivo que supera los 8MB", async () => {
    const bigContent = "x".repeat(8 * 1024 * 1024 + 1);
    const file = makeFile("grande.png", bigContent, "image/png");
    await expect(saveAttachment(file)).rejects.toThrow(AttachmentError);
    await expect(saveAttachment(file)).rejects.toThrow(/tamaño máximo/);
  });

  it("acepta un archivo de exactamente 8MB (límite inclusive)", async () => {
    const exactContent = "x".repeat(8 * 1024 * 1024);
    const file = makeFile("limite.png", exactContent, "image/png");
    await expect(saveAttachment(file)).resolves.toBeDefined();
  });

  it("usa 'application/octet-stream' como mime type de respaldo si el archivo no trae uno", () => {
    const file = makeFile("sin-tipo.pdf", "contenido", "");
    return expect(saveAttachment(file)).resolves.toMatchObject({
      attachmentData: expect.stringContaining("data:application/octet-stream;base64,"),
    });
  });

  it("la extensión se evalúa sin distinguir mayúsculas/minúsculas", async () => {
    const file = makeFile("FOTO.PNG", "contenido", "image/png");
    await expect(saveAttachment(file)).resolves.toBeDefined();
  });
});
