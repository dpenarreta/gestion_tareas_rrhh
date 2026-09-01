---
paths:
  - "backend/apps/**/views.py"
  - "backend/apps/**/serializers.py"
  - "backend/apps/**/permissions.py"
  - "backend/apps/**/urls.py"
---

# Views/Serializers/Permissions Rules (backend)

- `views.py` no contiene lógica de negocio — delegá a la clase `*Service`
  correspondiente en `services.py`. Un `get_queryset()` con un filtro simple
  está bien; un cálculo o una regla de negocio no.
- Permisos por acción vía `get_permissions()` (patrón ya usado en todos los
  `ViewSet` existentes) — no hardcodees un chequeo de rol dentro del método
  de la acción.
- Antes de crear una clase de permiso nueva, revisá si ya existe una
  equivalente en `permissions.py` de la app o en `apps/core/permissions.py`
  (transversales, como `IsAdministrador`).
- `serializers.py` es la capa de validación — usá
  `Serializer`/`ModelSerializer` de DRF. No valides a mano en `views.py` lo
  que un serializer ya puede validar.
- No captures excepciones de DRF (`ValidationError`, etc.) solo para
  reformatearlas — `apps/core/exceptions.py` ya las envuelve en el
  contrato uniforme de error.
- Nombrá las rutas en `urls.py` siguiendo el patrón REST ya establecido en
  la app (revisá `urls.py` de una app similar antes de agregar una ruta
  nueva con una convención distinta).
