// Config vacía, deliberada: este frontend no usa Tailwind (solo Bootstrap).
// Sin este archivo, Vite/postcss-load-config sube al directorio padre y
// recoge el postcss.config.mjs del Next.js legacy (Tailwind v4), que no
// aplica aquí y rompe el build por depender de una dependencia que este
// proyecto no instala.
export default {
  plugins: {},
};
