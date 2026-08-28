import path from "path";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "server-only": path.resolve(__dirname, "./vitest.server-only-stub.ts"),
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
    // frontend/ (Vite/React) y backend/ (Django) son proyectos aparte de la
    // migración de stack, cada uno con su propio ecosistema — nunca deben
    // escanearse como parte de la suite de Next.js.
    exclude: ["**/node_modules/**", ".next/**", "frontend/**", "backend/**"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["src/**/*.{ts,tsx}"],
    },
  },
});
