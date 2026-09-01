---
paths:
  - "src/components/**/*"
---

# Component Rules (frontend)

- Antes de crear un componente nuevo, buscá si ya existe uno equivalente
  en `src/components/ui/` (primitivos compartidos: botones, modales,
  tablas, toasts, etc.) o en el subdirectorio del módulo al que pertenece
  (`src/components/<módulo>/`).
- No dupliques un componente con comportamiento equivalente en dos módulos
  distintos — si necesita variar por contexto, agregale props, no lo
  copies.
- Mantené componentes chicos y enfocados en una responsabilidad visual. La
  lógica de negocio compleja (cálculos, transformación de datos de
  Django) va en `src/lib/`, no inline en el componente.
- `"use client"` solo en componentes que de verdad necesitan
  interactividad/estado en el browser — no lo agregues por defecto a un
  componente nuevo sin verificar si puede ser Server Component.
