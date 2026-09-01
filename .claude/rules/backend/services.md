---
paths:
  - "backend/apps/**/services.py"
---

# Service Rules (backend)

- Toda la lógica de negocio real vive acá — no en `views.py`.
- No dependas de `HttpRequest`/`Response` de Django ni de objetos DRF
  (`Request`/`Response`) dentro de un service — recibí los datos ya
  extraídos como parámetros, para que el service sea testeable sin montar
  una request HTTP completa.
- Seguí el patrón existente: clases `*Service` con métodos estáticos o de
  instancia (ej. `TaskService`, `CommentService`, `MonthClosureService` en
  `apps/tasks/services.py`) — no una función suelta en el módulo.
- Antes de escribir un cálculo nuevo, buscá si ya existe una primitiva
  equivalente en `apps/analytics/` (`scoring.py`, `workload.py`,
  `history.py`) — hay precedente real de fórmulas que se reimplementaron
  sin darse cuenta de que ya existían portadas desde el frontend legado.
- Los cálculos de Analytics/KPIs son deterministas — nunca llames a un
  proveedor de IA desde acá para calcular un número.
- Redondeo: usá `apps/core/rounding.py::round_half_up`, no el `round()`
  nativo de Python (banker's rounding, difiere de `Math.round()` de JS).
