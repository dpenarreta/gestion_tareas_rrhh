---
paths:
  - "src/**/*.ts"
  - "src/**/*.tsx"
---

# Code Style Rules

Solo convenciones que ESLint **no** aplica automáticamente (`eslint.config.mjs`
usa `eslint-config-next`, sin Prettier — no hay regla de formato de
semicolons/comillas que respetar a mano, dejá que el linter lo maneje si
corresponde).

- Preferí `type` sobre `interface` para formas de objetos.
- Modo estricto ya está habilitado (`tsconfig.json`, `"strict": true") — no
  lo debilites ni agregues `any` para esquivar un error de tipos real.
- Co-locá tipos con el módulo dueño; extraé a un archivo de tipos
  compartido solo si el mismo tipo se usa en 3+ archivos.
- Los comentarios explican el **por qué** (una decisión no obvia, una
  restricción externa, un bug que se está evitando), nunca el qué —
  identificadores bien nombrados ya dicen el qué. Este codebase escribe
  comentarios en español explicando decisiones de diseño; identificadores
  (nombres de variables/funciones/tipos) en inglés — mantené esa mezcla,
  no la cambies a comentarios en inglés ni identificadores en español.
- Bindings intencionalmente sin usar: prefijo `_` (ya lo exige ESLint,
  `@typescript-eslint/no-unused-vars` con `argsIgnorePattern: "^_"`).
