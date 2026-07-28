# Design System del Executive Report

> Identidad visual oficial del documento Executive Report — describe el CSS
> ya implementado en `EXECUTIVE_REPORT_STYLES`
> (`src/lib/executiveReporting/renderReportHtml.ts`), la única hoja de
> estilos del motor. No confundir con `docs/DESIGN_SYSTEM.md` (sistema de
> diseño general de la aplicación NEXO — sidebar, botones, tablas de la UI
> de trabajo diario) — el Executive Report es deliberadamente un lenguaje
> visual distinto, propio de un documento de consultoría, no de un panel de
> administración.
>
> FPS Parte V, Capítulo 3.

---

## Principio rector: una sola implementación visual

Pantalla y PDF **comparten exactamente el mismo HTML** — `buildReportPages`
(`documentModel.ts`) produce el contenido, `buildExecutiveReportHtml`
(`renderReportHtml.ts`) lo renderiza una única vez, y ese mismo resultado se
inyecta tanto en `MonthlyReports.tsx` (pantalla, vía
`dangerouslySetInnerHTML` sobre contenido ya escapado) como en la ventana de
impresión (`openReportWindow`, `reportWindow.ts`, con jsPDF/html2canvas
vendorizados en `/public/vendor` por restricción de CSP). No existe un
segundo sistema de componentes React que renderice el documento de forma
paralela — decisión explícita, ver `docs/AUDIT_LOG.md` § 2026-07-28
Decisión 10a.

## Paleta de colores

```css
--er-primary:      #1e4a72   /* azul corporativo — acentos, tarjeta central de Portada */
--er-primary-dark: #123350   /* títulos (h1/h2), valores destacados */
--er-accent:       #2f6fa8   /* eyebrows, valores de indicador, gráfico de barras */
--er-bg:           #f6f8fa   /* fondo del documento completo */
--er-card:         #ffffff   /* fondo de cada página */
--er-border:       #e2e8f0   /* bordes, líneas divisorias */
--er-ink:          #1c2430   /* texto principal */
--er-ink-soft:     #4a5568   /* texto secundario, cuerpo de párrafo */
--er-ink-faint:    #7c8798   /* labels, metadatos, texto muted */
```

**Semáforo de estado** (5 niveles, coherente con `WorkloadColor`/
`EstadoOperativoColor` del resto de NEXO):

| Color | Texto | Fondo | Uso |
|---|---|---|---|
| Verde | `#16a34a` | `#e8f5ec` | Excelente/Bueno, Óptimo |
| Amarillo | `#ca8a04` | `#fdf3d8` | Atención, Moderado |
| Naranja | `#ea580c` | `#fde8d8` | Carga elevada |
| Rojo | `#dc2626` | `#fbe3e2` | Crítico, Sobrecarga |
| Gris | `#6b7280` | `#eef1f4` | Sin datos para el período |

La paleta es intencionalmente más contenida que el resto de NEXO — un
documento ejecutivo no usa el mismo lenguaje visual saturado que un
dashboard operativo de uso diario.

## Tipografía

Sistema operativo (`-apple-system, "Segoe UI", Arial, sans-serif`) — sin
webfont propio, consistente con el resto del sistema de diseño de NEXO
(evita el riesgo de un fallback silencioso de fuente al imprimir).

| Elemento | Tamaño | Peso | Notas |
|---|---|---|---|
| `.er-cover-title` (Portada) | 30px | 700 | Título del tipo de reporte |
| `.er-h1` | 26px | 700 | (reservado, no usado en las 11 páginas actuales) |
| `.er-h2` (título de página) | 19px | 700 | Con borde inferior de 2px |
| `.er-cover-score` | 44px | 800 | Score general en la tarjeta central de Portada |
| `.er-card-value` | 24px | 700 | Valor de una tarjeta KPI |
| `.er-indicator-value` | 18px | 700 | Valor de un bloque de indicador |
| `.er-eyebrow` (número de página) | 11px | 700 | Mayúsculas, `letter-spacing: .08em` |
| `.er-subtitle` / `.er-p` (cuerpo) | 13.5px | 400 | `line-height: 1.7` |
| `.er-card-label` / `.er-section-title` | 11-14px | 600-700 | Mayúsculas, tracking amplio |
| `.er-footer` | 10px | 400 | Pie de página con Report ID |

## Espaciado y layout

- Documento centrado, ancho máximo **880px** (`.er-doc`) — legible en
  pantalla y proporcionado en A4 impreso.
- Cada página (`.er-page`) es un bloque independiente con `border-radius:
  10px`, `padding: 40px 44px`, separado por `margin-bottom: 28px` y
  `page-break-after: always` — una página del documento es una página física
  al imprimir.
- Tarjetas (`.er-card`, `.er-indicator-block`) usan `break-inside: avoid` —
  nunca se cortan a la mitad entre dos páginas impresas.
- Grillas de tarjetas (`.er-grid`) son `repeat(auto-fit, minmax(180px,
  1fr))` — se adaptan al número de KPIs sin definir columnas fijas.

## Componentes visuales

- **Portada** (`.er-cover`): centrada, con logo textual "NEXO · Executive
  Reporting Engine", título del tipo de reporte, tarjeta central con Estado
  General + Score (badge de color), y una grilla de metadatos de 2 columnas
  (fecha de corte, generado, generado por, Report ID, versiones).
- **Badge de estado** (`.er-badge`): píldora de `border-radius: 100px`,
  texto en mayúscula-implícita por contexto, color según el semáforo de 5
  niveles.
- **Bloque de indicador** (`.er-indicator-block`): usado en Estado General,
  Distribución Operativa, Recomendaciones y Analytics Predictivo — nombre +
  valor en la cabecera, luego pares clave-valor (`.er-kv`) para
  Interpretación/Impacto/Recomendación u otros campos estructurados.
- **Gráfico de barras** (`svgBarChart`, `renderReportHtml.ts`): SVG inline
  generado a mano, sin librería de gráficos — barras horizontales
  minimalistas (fondo `--er-border`, relleno `--er-accent`) para la
  Distribución por Motivo. Coherente con el principio de "gráficos
  minimalistas" del documento — nunca un chart interactivo dentro del PDF.
- **Tabla** (`table.er-table`): encabezados en mayúscula/tracking amplio,
  filas alternadas (`tr:nth-child(even)`), `break-inside: avoid` por fila.
- **Pie de página** (`.er-footer`): inyectado en las 11 páginas vía
  `withFooter` — `NEXO · Executive Reporting Engine · {reportId} · Página X
  de 11`. Ver `REPORTING_AUDIT_MANUAL.md` § Report ID para por qué aparece
  en cada página, no solo en Portada/Metadatos.

## Impresión

```css
@media print {
  @page { size: A4; margin: 14mm; }
  .er-page { border: none; box-shadow: none; }
}
```

El único ajuste específico de impresión: se elimina el borde/sombra de cada
tarjeta de página (innecesario sobre papel) y se fija el tamaño A4 con
márgenes de 14mm — agregado en v1.22.3 (FPS Parte IV §4, "Report ID en pie
de página" trajo consigo la necesidad de un margen consistente).

## Iconografía

El documento no usa una librería de iconos (a diferencia del resto de NEXO,
que usa `lucide-react`) — el único glifo decorativo es el emoji ⚠️ en los
paneles de alertas complementarios de `MonthlyReports.tsx` (fuera del
documento renderizado en sí). Decisión implícita de diseño: un documento
ejecutivo impreso no depende de una fuente de iconos externa que pueda
fallar al exportar a PDF.

## Reglas de evolución

Cualquier cambio futuro a este sistema visual debe:

1. Modificarse **únicamente** en `EXECUTIVE_REPORT_STYLES`
   (`renderReportHtml.ts`) — nunca duplicar un estilo paralelo en
   `MonthlyReports.tsx` o en `ReportWizardModal.tsx`.
2. Mantener el principio de una sola implementación visual (pantalla = PDF).
3. Preservar `break-inside: avoid` en todo elemento que no deba cortarse al
   imprimir, y `page-break-after` en el contenedor de página.
4. No introducir una librería de gráficos externa sin registrar la decisión
   en `docs/AUDIT_LOG.md` — el precedente (`svgBarChart`) es SVG inline
   deliberado, no una limitación temporal.
