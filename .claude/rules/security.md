# Security Rules

- No almacenes secretos en código ni en documentación committeada — solo en
  `.env`/`.env.local` (ambos gitignored). `.env.example` es la plantilla,
  siempre sin valores reales.
- No registres tokens, contraseñas ni API keys en logs. `src/lib/logger.ts`
  (`safeLog`) ya redacta patrones conocidos (`ghp_`, `github_pat_`,
  `AIzaSy...`, `sk-`) — si agregás una integración con un proveedor nuevo,
  sumá su patrón de token ahí.
- La jerarquía de permisos vive en `src/lib/roles.ts` (frontend, solo para
  UI/UX) y se **revalida siempre en Django** (`permission_classes` en
  `views.py`) — nunca confíes solo en que el frontend oculte un botón.
- Datos de salud (permisos médicos, maternidad/lactancia — Art. 26 LOPDP)
  tienen visibilidad restringida a un segundo nivel, distinta de la
  jerarquía normal de roles (ver `redactSensitiveWorkloadDetail` en
  `src/lib/workload.ts` y su equivalente en Django). No expandas quién ve
  este detalle sin confirmarlo explícitamente con el usuario.
- Si un cambio agrega o quita un proveedor externo que procesa datos
  personales (nueva integración, cambio de proveedor de IA, etc.),
  actualizá `docs/RAT.md`/`docs/PENDIENTES_LEGALES.md` en el mismo cambio
  — ver `docs/CLAUDE.md`.
- No introduzcas secretos reales (contraseñas, API keys) en tests — usá
  valores dummy (`"test-key"`, ya es el patrón en los mocks existentes).
- Contraseña por defecto de usuarios nuevos: `123456` — es un valor de
  desarrollo/prueba documentado, no un hallazgo de seguridad a "corregir"
  sin que te lo pidan.
