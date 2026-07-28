// Solo para scripts standalone ejecutados con `tsx` (no pasan por el
// bundler de Next, que sí resuelve "server-only" de forma condicional según
// server/client — fuera de ahí, el paquete real siempre lanza). Mismo
// criterio que `vitest.server-only-stub.ts` (alias de Vitest) — aquí se
// logra pre-poblando el cache de `require` de Node ANTES de que cualquier
// módulo real pida "server-only", vía `NODE_OPTIONS=--require`. No modifica
// next.config.ts/tsconfig.json — el build/dev real de Next sigue usando el
// paquete real y su chequeo real.
const path = require.resolve("server-only");
require.cache[path] = { id: path, filename: path, loaded: true, exports: {} };
