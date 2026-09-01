---
paths:
  - "src/app/api/**/*"
  - "src/lib/django*.ts"
---

# API Rules (frontend)

- Toda llamada a Django pasa por `djangoApiFetch` (`src/lib/djangoSession.ts`)
  — no hagas `fetch()` directo a la URL de Django desde una ruta o página.
- Django devuelve snake_case — pasá la respuesta por el
  `django*Adapter.ts` del dominio correspondiente (o
  `mapDjangoAnalyticsPayloadToNexoShape`/`mapDjangoKpiPayloadToNexoShape`
  si es genérico) antes de devolverla al cliente. Ver
  `.claude/rules/architecture.md` — saltar este paso no da error de tipos,
  falla en runtime.
- `session.djangoUserId` es el único id de sesión — úsalo directo, o
  `resolveDjangoUserId(session)`/`fetchDjangoCurrentUserId()` si necesitás
  resolverlo server-side sin depender de que ya esté en el JWT (ver
  `.claude/rules/architecture.md`).
- `djangoApiFetch` acepta un `timeoutMs` opcional (3er parámetro, default
  3s) — si el endpoint de Django que estás llamando no tiene caché con TTL
  y es pesado (agregados de equipo, bundles de Analytics), usá
  `ANALYTICS_BUNDLE_TIMEOUT_MS` (`src/lib/djangoSession.ts`) o un timeout
  explícito más generoso, y envolvé la llamada en `try/catch` — un
  `AbortError` no manejado produce un 500 con body vacío en vez de un
  error legible.
- Propagá 401 (sin sesión Django) / 404 / 403 tal como los devuelve
  Django — no los conviertas en un 500 genérico.
- Nova (chat, Insights, narrativa de Reportes Ejecutivos) usa
  `GEMINI_API_KEY` (`@google/genai`) — si falta la key, cada endpoint
  degrada a un fallback determinista, nunca rompe la respuesta. Seguí ese
  mismo patrón si agregás una llamada nueva a Gemini.
