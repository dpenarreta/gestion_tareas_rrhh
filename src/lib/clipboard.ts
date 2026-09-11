/**
 * Copia texto al portapapeles, también cuando el sitio se sirve por http.
 *
 * `navigator.clipboard` **solo existe en contextos seguros** (https o
 * localhost). Nexo se despliega por http en la red interna —decisión
 * explícita, ver `src/lib/httpsPolicy.ts`—, así que en producción esa API
 * es `undefined` y llamarla directamente lanza un TypeError. Es exactamente
 * lo que pasó con el enlace de recuperación de contraseña: el botón
 * "Copiar" no copiaba nada (ver docs/AUDIT_LOG.md § 2026-09-11).
 *
 * Por eso hay dos caminos: la API moderna cuando está disponible, y
 * `document.execCommand("copy")` sobre un textarea temporal cuando no. Ese
 * segundo método está deprecado, pero es el único que funciona sin TLS y
 * los navegadores lo siguen soportando justamente por este motivo.
 *
 * Nunca lanza: devuelve si pudo copiar, para que quien llama decida qué
 * mostrar. Copiar es una comodidad — si falla, el texto siempre tiene que
 * quedar visible para seleccionarlo a mano.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  if (typeof document === "undefined") return false;

  if (navigator?.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Disponible pero rechazada (permiso denegado, documento sin foco):
      // se intenta igual el camino de abajo antes de darse por vencido.
    }
  }

  const area = document.createElement("textarea");
  area.value = text;
  // Fuera de la vista pero seleccionable: con `display:none` o `hidden` la
  // selección no funciona y `execCommand` no copia nada. `readonly` evita
  // que aparezca el teclado en dispositivos táctiles.
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.top = "-9999px";
  area.style.opacity = "0";
  document.body.appendChild(area);

  try {
    area.select();
    area.setSelectionRange(0, text.length);
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    document.body.removeChild(area);
  }
}
