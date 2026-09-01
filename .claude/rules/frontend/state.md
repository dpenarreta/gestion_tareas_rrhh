---
paths:
  - "src/**/*.tsx"
---

# State Rules (frontend)

- No hay state manager global (sin Redux/Zustand) — no agregues uno. El
  patrón actual es: sesión/datos iniciales resueltos server-side (Server
  Components, `getSession()`) pasados como props, más `useState` local
  para interacción del componente.
- React Context se usa puntualmente para 2 casos transversales ya
  establecidos (tema — `ThemeProvider.tsx`, toasts — `Toast.tsx`). No
  agregues un Context nuevo para estado que puede vivir como prop o como
  estado local de un componente.
- Al agregar un setting nuevo a `ConfigCenter`, registralo también en
  `src/components/settings/registry.ts` (metadatos para
  búsqueda/favoritos/historial) — es un componente cliente, no puede
  importar módulos `server-only`, así que sus valores `DEFAULT_*` se
  mantienen manualmente en paralelo a los del backend/config server-only;
  mantenelos iguales si cambiás un default.
