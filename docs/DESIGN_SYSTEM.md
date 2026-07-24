# Design System de Nexo

> Referencia oficial para todo desarrollo de UI futuro en Nexo. Documenta los
> primitivos construidos/adoptados en el **Sprint B — UX Consistente + Design
> System Foundation** (2026-07-23/24) y las convenciones vigentes de tokens,
> tipografía y espaciado que ya existían (Sistema de diseño v2, 2026-07-05).
>
> Todo componente nuevo debe reutilizar estos primitivos en vez de crear
> variantes propias. Si una necesidad no está cubierta aquí, se extiende el
> primitivo existente (nueva variante/prop) — no se crea uno paralelo.

---

## 1. Colores

Tokens en `src/app/globals.css`, `@theme`/`:root`/`.dark` (Tailwind v4 CSS-first,
sin `tailwind.config.*`). `dark:` se activa por una clase `.dark` en `<html>`
(gestionada por `next-themes`), no por `prefers-color-scheme`.

**Semántica** (usar siempre estas clases, nunca el hex fijo):

| Uso | Clase Tailwind | Variable |
|---|---|---|
| Fondo de página | `bg-background` | `--bg` |
| Superficie (cards, modales) | `bg-surface` | `--surface` |
| Superficie secundaria (hover, headers de tabla) | `bg-surface2` | `--surface2` |
| Borde | `border-border` / `border-border2` | `--border` / `--border2` |
| Texto principal | `text-title` / `text-main` | `--text` |
| Texto secundario | `text-secondary` | `--text2` |
| Texto deshabilitado | `text-disabled` | `--text3` |
| Primario (marca) | `bg-primary` / `text-primary` | `--primary` |
| Superficie suave primaria | `bg-primary-surface` | `--primsoft` |
| Éxito | `bg-success` / `text-success` | `--success` |
| Advertencia | `bg-warning` / `text-warning` | `--warn` |
| Peligro/error | `bg-danger` / `text-danger` | `--danger` |
| Información | `bg-info` / `text-info` (= primario) | `--primary` |
| Nova (asistente IA) | `bg-nova` / `text-nova` | `--nova` |

**Regla de significado** (§2/§3/§4 del sprint): el mismo *significado* usa
siempre el mismo tono en cualquier módulo — `danger` = urgente/crítico/
cancelado/rechazado; `warning` = medio/en revisión/suspendido; `success` =
completado/aprobado/implementado/bajo riesgo; `neutral` = pendiente/backlog;
`primary`/`info` = en progreso/activo. Ver `src/lib/chipConfig.ts` (§4) para
la aplicación concreta a cada enum del dominio.

No existe un token `--secondary` propio distinto de `--primary` — el sistema
usa una sola escala de marca (`primary`) más los 4 semánticos de estado
(`success`/`warning`/`danger`/`info`) y los neutros. No introducir un color
"secundario" nuevo sin una necesidad real.

## 2. Tipografía

Fuente: Instrument Sans (`--font-instrument`, Google Fonts vía
`next/font/google` en `src/app/layout.tsx`). Escalas en uso (Tailwind
estándar, sin escala custom): `text-[11px]` (labels de tabla/badges),
`text-xs`/`text-[13px]` (UI densa, botones), `text-sm` (cuerpo estándar),
`text-title`/`font-semibold` (títulos de sección/card).

## 3. Espaciado y radios

- Radio estándar de controles: `rounded-[9px]` (Button) / `rounded-lg` (inputs) / `rounded-xl` (cards pequeñas) / `rounded-2xl` (modales).
- Padding de celdas de tabla: `px-4 py-3` (`Th`/`Td`).
- Padding de botones: `px-3.5 py-2` (`md`, default) / `px-2.5 py-1.5` (`sm`).
- Sombras: `--shadow` (sutil, cards) / `--shadow2` (elevada, modales/popovers).

## 4. Botones — `src/components/ui/Button.tsx`

6 variantes (spec §1: Primario/Secundario/Terciario/Ghost/Peligro/Éxito), 2
tamaños, estado `loading`:

```tsx
import { Button } from "@/components/ui/Button";

<Button variant="primary" size="md" loading={saving} onClick={...}>Guardar</Button>
```

| Variant | Uso |
|---|---|
| `primary` (default) | CTA principal / submit de formulario — "Guardar", "Crear", "Confirmar" |
| `secondary` | Acción secundaria con borde visible — "Cancelar" en un footer de modal |
| `tertiary` | Acción de texto de bajo énfasis, sin borde/fondo, color primario |
| `ghost` | Botón de icono/texto neutro en toolbars, sin fondo |
| `destructive` | Acciones irreversibles/negativas — "Eliminar", "Rechazar" |
| `success` | Confirmación positiva — "Aprobar", "Completar" |

`size="sm"` para contextos compactos (filas de tabla, headers de tarjeta);
`size="md"` (default) para formularios/modales. `loading` deshabilita el
botón, agrega `aria-busy` y muestra `Spinner` inline — no crear un estado de
carga manual por componente.

**Fuera de alcance deliberado:** afordancias de icono diminutas embebidas en
UI densa (~14-16px, `p-1`, ej. lápiz/basura en una fila de `TaskCard`) no se
migran a `Button` — su tamaño mínimo (~32-36px) rompería el layout. Esas
siguen siendo `<button className="p-1 ...">` ad-hoc; es una excepción
documentada, no un olvido.

## 5. Chips de prioridad y estado — `src/components/ui/Chip.tsx`

Un único componente visual (`PriorityChip`/`StatusChip` son el mismo
componente, dos nombres para claridad en el call site) sobre `Badge`,
parametrizado por un `config` de `src/lib/chipConfig.ts`:

```tsx
import { PriorityChip, StatusChip } from "@/components/ui/Chip";
import { TASK_PRIORITY_CONFIG, TASK_STATUS_CONFIG } from "@/lib/chipConfig";

<PriorityChip value={task.priority} config={TASK_PRIORITY_CONFIG} />
<StatusChip value={task.status} config={TASK_STATUS_CONFIG} />
```

Cada enum de negocio real (leído de `prisma/schema.prisma`) tiene su propio
`ChipConfig` — **nunca se inventan valores nuevos**, solo se les asigna
`{ label, tone }`: `TASK_PRIORITY_CONFIG`, `REMINDER_PRIORITY_CONFIG`,
`DESK_NOTE_PRIORITY_CONFIG`, `IDEA_IMPACT_CONFIG`, `TASK_STATUS_CONFIG`,
`PROJECT_STATUS_CONFIG`, `REMINDER_STATUS_CONFIG`, `IDEA_STATUS_CONFIG`,
`MEETING_STATUS_CONFIG`, `DATA_REQUEST_STATUS_CONFIG`. Para un enum nuevo,
agregar su propio `ChipConfig` en `chipConfig.ts` siguiendo la regla de tono
de la §1 — nunca reimplementar el mapa de color localmente en el componente.

## 6. Tablas — `src/components/ui/Table.tsx`

Chrome compartido, no un data-grid — cada módulo conserva su propia lógica de
orden/filtro/paginación:

```tsx
import { Table, TableHead, TableBody, TableRow, Th, Td } from "@/components/ui/Table";

<Table>
  <TableHead><TableRow><Th>Columna</Th></TableRow></TableHead>
  <TableBody>
    <TableRow><Td>Valor</Td></TableRow>
  </TableBody>
</Table>
```

`Table` envuelve en su propio `overflow-x-auto` — no duplicar ese wrapper
alrededor. `TableBody` ya aplica `divide-y divide-border` entre filas — no
agregar `border-b` manual a cada `TableRow`. Celdas decorativas sin padding
(ej. una barra de color de 1px) pueden seguir siendo `<td>`/`<th>` crudos
cuando `Td`/`Th` (que fuerzan `px-4 py-3`) rompan ese propósito — excepción
documentada, no inconsistencia.

## 7. Modales — `src/components/ui/Modal.tsx`

```tsx
import { Modal, ModalHeader } from "@/components/ui/Modal";

<Modal open={isOpen} onClose={onClose} size="md" variant="center">
  <ModalHeader title="Título" onClose={onClose} />
  {/* contenido */}
</Modal>
```

`size`: `sm` (`max-w-sm`) / `md` (`max-w-lg`, default) / `lg` (`max-w-2xl`).
`variant`: `center` (default) / `drawer` (panel lateral derecho). Backdrop,
click-outside-to-close y animación de entrada (`animate-pop`) ya incluidos —
no reimplementarlos. `ModalHeader` da el título + botón de cierre (×)
consistente — no crear un header custom con un ícono de cierre distinto.

## 8. Toasts — `src/components/ui/Toast.tsx`

Sistema único de mensajes del sistema (spec §11/§14), montado una vez en la
raíz (`ToastProvider` envuelve `{children}` en `src/app/layout.tsx`, cubre
login y rutas protegidas):

```tsx
import { useToast, TOAST_MESSAGES } from "@/components/ui/Toast";

const { showToast } = useToast();
showToast(TOAST_MESSAGES.saved, "success");   // o .updated / .deleted / .saveError / .deleteError
showToast("Mensaje específico.", "error");     // variantes: success (default) | error | info | warning
```

Apilados en la esquina inferior derecha, auto-dismiss ~4s + cierre manual,
región `aria-live="polite"`. Fondo neutro (`bg-surface`) con acento de color
por tono (borde izquierdo + ícono), no relleno sólido — mismo criterio de
contraste que `Badge`, válido en ambos temas.

**Regla toast vs. inline (importante, no confundir):** el toast es para
feedback *transitorio* de una acción ya ejecutada (guardar/eliminar/generar).
Los errores de **validación de formulario** que deben permanecer visibles
mientras el formulario sigue abierto para que el usuario los corrija (ej.
"El título es requerido") **se quedan inline**, junto al campo o al pie del
formulario — convertirlos a toast los haría desaparecer antes de que el
usuario pueda actuar, una regresión funcional, no solo de estilo.

## 9. Loading — `src/components/ui/Skeleton.tsx`

```tsx
import { Skeleton, SkeletonText, SkeletonRow, Spinner } from "@/components/ui/Skeleton";

<SkeletonRow columns={4} />      // fila de tabla pulsante
<SkeletonText lines={3} />       // párrafo/lista pulsante
<Spinner className="w-5 h-5" />  // spinner inline (usado también por Button loading)
```

Reemplaza texto suelto "Cargando..." y `animate-spin`/`animate-pulse`
hand-rolled — la forma del skeleton debe aproximarse al contenido que
reemplaza (unas pocas filas/líneas, sin pixel-matching exhaustivo de anchos).

## 10. Empty states — `src/components/ui/EmptyState.tsx`

```tsx
import { EmptyState } from "@/components/ui/EmptyState";
import { Inbox } from "lucide-react";

<EmptyState icon={Inbox} title="Sin tareas" description="Aún no hay tareas registradas." action={<Button>+ Nueva tarea</Button>} />
```

`icon`/`description`/`action` opcionales. Reemplaza texto suelto ("No hay X",
"Sin resultados") — icono + título + descripción opcional + acción
recomendada solo si existe un handler obvio ya disponible en ese contexto
(spec §16).

## 11. Buscadores — `src/components/ui/SearchInput.tsx`

```tsx
import { SearchInput } from "@/components/ui/SearchInput";

<SearchInput value={q} onChange={setQ} placeholder="Buscar…" />
```

Icono de lupa, botón de limpiar cuando hay texto, focus ring consistente —
generaliza el patrón que ya usaban `GlobalSearchOverlay`/`TasksModule`.

## 12. Fechas y horas

- **Fechas** (`YYYY-MM-DD`, campos de solo-fecha almacenados como
  UTC-medianoche): `formatDate()` en `src/lib/utils.ts` — usa getters UTC a
  propósito, nunca locales, para no desplazar el día calendario en huso
  horario UTC-5 (América/Bogotá). No usar `toLocaleDateString` directo sobre
  estos campos.
- **Horas** (formato 24h, sin AM/PM — spec §5, ya forzado en toda la
  plataforma): `formatTime()` en `src/lib/utils.ts`, centraliza el patrón
  `toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit", hour12:
  false })` que antes se repetía suelto por componente.
- **Registro de tiempo** (spec §6, ya cumplido antes de este sprint): siempre
  Hora Inicio → Hora Fin → cálculo automático de duración vía `TimeInput24`
  (`src/components/ui/TimeInput24.tsx`) + `ActivityPanel`. El modo alterno
  "duración directa" (`src/lib/activityFormat.ts`) es una preferencia de
  usuario explícita, no una inconsistencia — no se colapsa a un único modo.

## 13. Iconografía

Única librería: `lucide-react`. Tamaño estándar `w-4 h-4` (16px) para íconos
inline, `w-5 h-5`/`w-6 h-6` para íconos de estado más prominentes,
`strokeWidth={1.8}`–`{2}`. Preferir el ícono lucide equivalente sobre un
`<svg>` inline hardcodeado cuando exista un 1:1 claro (X, ChevronRight,
Check, Pencil, Trash2, Plus, Search, Clock, Archive, etc.). Íconos
decorativos/de marca sin equivalente claro pueden seguir siendo SVG custom.

## 14. Cards — dos primitivos de propósito distinto (no fusionar)

- `src/components/ui/Card.tsx` (`Card`/`CardHeader`/`CardTitle`/`CardBody`) —
  card genérica estática.
- `src/components/settings/SectionCard.tsx` — acordeón colapsable con estado
  expandido persistido en `localStorage` por sección, usado en Ajustes.

Son dos conceptos distintos (estático vs. colapsable con persistencia) — se
documentan por separado a propósito. Fusionarlos arriesgaría romper el
estado expandido persistido de Ajustes sin beneficio real de consistencia
visual (ya comparten radio/borde/sombra vía los mismos tokens).

## 15. Validaciones

Mismo patrón en todos los formularios: mensaje de error en `text-sm
text-danger` sobre `bg-danger/[.09]`, `rounded-lg`/`rounded-xl`, ubicado
inmediatamente antes de las acciones del formulario (no junto a cada campo
individual salvo que el error sea específico de ese campo). Ver §8 para la
distinción con toasts.

## 16. Responsive y accesibilidad

- Tablas: `overflow-x-auto` (vía `Table`) en vez de romper el layout en
  mobile.
- Focus: todos los inputs/botones usan `focus:ring-2 focus:ring-primary`
  consistente (heredado de antes de este sprint, preservado).
- `Button`/`Modal`/`Toast` incluyen `aria-label`/`aria-busy`/`aria-live`
  donde corresponde (botón de cierre de modal, toast region, botón en
  loading).
- No se realizó una auditoría dedicada de contraste/navegación por teclado
  fuera de los módulos tocados en este sprint — ver §17 (pendiente).

---

## 17. Informe de Design Review (spec §25)

**Alcance ejecutado este sprint:** primitivos completos (§1-§16) + adopción
completa en los módulos de alto tráfico: Tareas, Dashboard, Escritorio
Digital, Equipo, KPIs/Analytics, Ajustes, Usuarios (más 5 modales de
Proyectos/Escritorio Digital tocados puntualmente por compartir el mismo
enum de prioridad o el mismo patrón de modal).

### Componentes reutilizados
`Button`, `Badge`, `Modal`/`ModalHeader` existían pero casi sin adopción
(`Button` solo se usaba en su propio test) — ahora son la base de 45+
archivos. `PriorityChip`/`StatusChip`/`Table`/`Toast`/`Skeleton`/`EmptyState`/
`SearchInput` son nuevos, construidos sobre `Badge` para no duplicar la
paleta de tonos.

### Componentes/patrones duplicados eliminados
- ~10 mapas locales de color de prioridad (`PRIORITY_VARIANT`,
  `PRIORITY_STYLES`, `REMINDER_PRIORITY_COLOR` reimplementado por archivo) →
  `chipConfig.ts` centralizado.
- ~8 sitios que duplicaban `toLocaleTimeString(..., { hour12: false })` →
  `formatTime()`.
- Decenas de banners de "Guardado correctamente"/"Error al guardar"
  hechos a mano (estado local + JSX propio por componente) → `useToast()`.
- Grid de bordes por celda en `TableView.tsx` (`border` en cada `<td>`) →
  estilo de fila-con-divisor compartido (`TableBody` `divide-y`).

### Pantallas/módulos revisados
Tareas (Tabla/Kanban/Gantt/Repositorio/modales), Dashboard, Escritorio
Digital (notas, recordatorios, búsqueda), Equipo, KPIs/Analytics (individual,
rango, ejecutivo), Ajustes (13 secciones + panel principal), Usuarios.

### Mejoras de accesibilidad
`aria-busy` en botones en carga, `aria-live="polite"` en la región de
toasts, `aria-label` en botones de cierre de modal — antes inconsistente
(algunos cierres no tenían `aria-label`).

### Mejoras de rendimiento visual
Consolidación de spinners `animate-spin` hand-rolled (había implementaciones
ligeramente distintas por archivo) en un único `Spinner`; eliminación de
grid de bordes redundante por celda en tablas grandes (menos nodos con
`border` individual).

### Componentes pendientes de unificar (backlog para Sprint C)
Los siguientes módulos **no fueron tocados** en este sprint — quedan con los
patrones anteriores (botones/chips/tablas ad-hoc, sin toasts) y son el punto
de partida recomendado para Sprint C — NEXO Experience:
- **Ideas / Mejora Continua** (`src/components/ideas/*`)
- **Reuniones** (`src/components/meetings/*`)
- **Proyectos** — solo se tocaron los 3 archivos que comparten `TaskPriority`
  con Tareas y el modal de creación; `ProjectDocumentsTab`, `ProjectHistoryTab`,
  `ProjectCommentsTab`, `ProjectActivitiesTab`, `ProjectTrashPanel`,
  `PhaseDetailModal` siguen sin adoptar los primitivos.
- **Repositorio de documentos**, **Asistente Nova** (`AssistantModule`),
  **Login**, **Perfil** — sin tocar.
- Auditoría dedicada de **accesibilidad** (navegación por teclado completa,
  contraste medido, lectores de pantalla) y de **responsive** en los módulos
  no tocados.
- Iconografía: quedan `<svg>` inline sin reemplazar en los módulos no
  tocados (solo se estandarizó dentro de los 8 archivos de la Fase 5).

### Inconsistencias detectadas que no pudieron corregirse en este sprint
- `KanbanView.tsx` (Tareas) usaba `PENDIENTE = warning` mientras `TableView.tsx`
  usaba un tono distinto para el mismo estado antes de este sprint — se
  resolvió unificando a `neutral` vía `TASK_STATUS_CONFIG`, pero no se auditó
  si Proyectos/Ideas/Reuniones tienen el mismo tipo de divergencia en sus
  propios estados (no tocados).
- No existe todavía un componente `Card` único para reemplazar los ~4 casos
  de `rounded-xl border...shadow` ad-hoc restantes fuera de los módulos
  tocados (`login/page.tsx`, `IdeaCard.tsx`).
