---
paths:
  - "src/__tests__/**/*"
  - "backend/apps/**/tests/**/*"
  - "backend/**/test_*.py"
---

# Testing Rules

- Frontend (Vitest, `src/__tests__/`): los `route.ts` ya cortados a Django
  se testean **mockeando `@/lib/djangoSession` (`djangoApiFetch`)**, nunca
  una base de datos — no hay ORM que mockear en el frontend.
- Al mockear `djangoApiFetch`, usá fixtures ya transformadas a camelCase
  como si vinieran de Django y pasaran por el adaptador (`mapDjango*`) —
  mockear con snake_case crudo no reproduce lo que la ruta real recibe tras
  pasar por el adaptador, y puede esconder un bug real (adaptador salteado).
- Backend (`pytest-django`, `backend/apps/*/tests/`): `--reuse-db` está
  activo por defecto (`pytest.ini`) — si cambiaste el esquema y los tests
  fallan de forma rara, corré con `--create-db` una vez.
- No modifiques un test únicamente para que pase — primero entendé por qué
  falla. Si el comportamiento cambió a propósito, actualizá la aserción
  reflejando el nuevo comportamiento esperado, no lo debilites.
- Agregá tests para comportamiento nuevo o para un bug real que corregiste
  (regresión). No es obligatorio para exploración/lectura de código.
- Reutilizá los helpers de mock ya existentes en el archivo de test
  (`mockSession`, `djangoResponse`, `mockDjangoRoutes`, etc.) antes de
  escribir uno nuevo — el patrón ya está establecido por archivo.
