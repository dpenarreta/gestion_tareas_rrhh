import "@testing-library/jest-dom/vitest";
import { vi } from "vitest";

// La base de datos configurada en .env es la de producción (ver memoria del
// proyecto) — se bloquea cualquier uso accidental de `@/lib/prisma` en tests
// que no la mockeen explícitamente, para que ningún test toque datos reales.
vi.mock("@/lib/prisma", () => ({
  prisma: new Proxy(
    {},
    {
      get(_target, prop) {
        throw new Error(
          `Uso no mockeado de prisma.${String(prop)} en un test. Mockea "@/lib/prisma" explícitamente en el archivo de test.`
        );
      },
    }
  ),
}));
