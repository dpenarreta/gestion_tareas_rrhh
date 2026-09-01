import "server-only";

/**
 * pdfjs-dist (usado internamente por pdf-parse) referencia APIs de canvas del
 * navegador (DOMMatrix, ImageData, Path2D) incluso cuando solo se extrae
 * texto — las usa en su ruta opcional de renderizado. Si el binario nativo
 * de @napi-rs/canvas para la plataforma de destino no está disponible en el
 * `node_modules` desplegado (ej. lockfile generado en una máquina con otro
 * SO/arquitectura que la del servidor), pdfjs-dist lanza `ReferenceError:
 * DOMMatrix is not defined` al importarse, tumbando toda la ruta antes de
 * que corra cualquier try/catch. Como aquí nunca renderizamos PDFs a
 * imagen (solo extraemos texto), stubs mínimos son suficientes.
 */
if (typeof globalThis.DOMMatrix === "undefined") {
  // @ts-expect-error stub mínimo, no una implementación real de DOMMatrix
  globalThis.DOMMatrix = class DOMMatrix {};
}
if (typeof globalThis.ImageData === "undefined") {
  // @ts-expect-error stub mínimo
  globalThis.ImageData = class ImageData {};
}
if (typeof globalThis.Path2D === "undefined") {
  // @ts-expect-error stub mínimo
  globalThis.Path2D = class Path2D {};
}
