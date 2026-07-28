// Executive Reporting Engine 2.0 — Fase E — render a HTML/PDF de las 11
// páginas (FPS Parte II). Se alimenta EXCLUSIVAMENTE de `ReportPage[]`
// (documentModel.ts) — funciones puras, sin I/O, sin volver a tocar
// Analytics/NOVA. El HTML resultante se pasa sin modificar a
// `openReportWindow` (reportWindow.ts, Fase E no lo toca) — mismo mecanismo
// ya probado de jsPDF/html2canvas vendorizados por restricción de CSP.
//
// Lenguaje visual (FPS Parte II §"Arquitectura Visual"): azul corporativo,
// mucho espacio en blanco, tarjetas elegantes, semáforos discretos,
// tipografía limpia — inspiración consultora, no "exportación de sistema".
import type {
  ReportPage,
  CoverPage,
  ExecutiveSummaryPage,
  TeamStatusPage,
  StrategicIndicatorsPage,
  MemberDetailPage,
  OperationalDistributionPage,
  InsightsPage,
  AssessmentPage,
  RecommendationsPage,
  RecommendationRow,
  PredictivePage,
  MetadataPage,
} from "./documentModel";

function esc(value: string | number): string {
  return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function list(items: string[]): string {
  if (items.length === 0) return `<p class="er-muted">Sin elementos para este período.</p>`;
  return `<ul class="er-list">${items.map((i) => `<li>${esc(i)}</li>`).join("")}</ul>`;
}

const ESTADO_COLOR_CLASS: Record<string, string> = { green: "er-badge-green", yellow: "er-badge-yellow", orange: "er-badge-orange", red: "er-badge-red", gray: "er-badge-gray" };

export const EXECUTIVE_REPORT_STYLES = `
  :root{
    --er-primary:#1e4a72; --er-primary-dark:#123350; --er-accent:#2f6fa8;
    --er-bg:#f6f8fa; --er-card:#ffffff; --er-border:#e2e8f0;
    --er-ink:#1c2430; --er-ink-soft:#4a5568; --er-ink-faint:#7c8798;
    --er-green:#16a34a; --er-green-bg:#e8f5ec; --er-yellow:#ca8a04; --er-yellow-bg:#fdf3d8;
    --er-orange:#ea580c; --er-orange-bg:#fde8d8; --er-red:#dc2626; --er-red-bg:#fbe3e2; --er-gray:#6b7280; --er-gray-bg:#eef1f4;
  }
  .er-doc{font-family:-apple-system,"Segoe UI",Arial,sans-serif;color:var(--er-ink);background:var(--er-bg);max-width:880px;margin:0 auto;}
  .er-page{background:var(--er-card);border:1px solid var(--er-border);border-radius:10px;padding:40px 44px;margin-bottom:28px;page-break-after:always;break-after:page;}
  .er-page:last-child{page-break-after:auto;}
  .er-eyebrow{font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--er-accent);font-weight:700;margin:0 0 6px;}
  .er-h1{font-size:26px;font-weight:700;color:var(--er-primary-dark);margin:0 0 4px;text-wrap:balance;}
  .er-h2{font-size:19px;font-weight:700;color:var(--er-primary-dark);margin:0 0 18px;padding-bottom:10px;border-bottom:2px solid var(--er-border);}
  .er-subtitle{font-size:13.5px;color:var(--er-ink-soft);margin:0 0 24px;}
  .er-muted{color:var(--er-ink-faint);font-size:13px;font-style:italic;}
  .er-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:14px;margin-bottom:22px;}
  .er-card{background:#fbfcfd;border:1px solid var(--er-border);border-radius:8px;padding:16px 18px;break-inside:avoid;}
  .er-card-label{font-size:11px;letter-spacing:.05em;text-transform:uppercase;color:var(--er-ink-faint);font-weight:600;margin:0 0 6px;}
  .er-card-value{font-size:24px;font-weight:700;color:var(--er-primary-dark);margin:0;}
  .er-card-sublabel{font-size:12px;color:var(--er-ink-soft);margin:4px 0 0;}
  .er-badge{display:inline-block;font-size:11px;font-weight:700;padding:3px 10px;border-radius:100px;letter-spacing:.02em;}
  .er-badge-green{background:var(--er-green-bg);color:var(--er-green);}
  .er-badge-yellow{background:var(--er-yellow-bg);color:var(--er-yellow);}
  .er-badge-orange{background:var(--er-orange-bg);color:var(--er-orange);}
  .er-badge-red{background:var(--er-red-bg);color:var(--er-red);}
  .er-badge-gray{background:var(--er-gray-bg);color:var(--er-gray);}
  .er-list{margin:0;padding-left:18px;font-size:13.5px;line-height:1.7;color:var(--er-ink-soft);}
  .er-list li{margin-bottom:4px;}
  .er-section{margin-bottom:22px;break-inside:avoid;}
  .er-section-title{font-size:14px;font-weight:700;color:var(--er-primary-dark);margin:0 0 8px;}
  .er-p{font-size:13.5px;line-height:1.7;color:var(--er-ink-soft);margin:0 0 14px;}
  table.er-table{width:100%;border-collapse:collapse;font-size:12.5px;margin-bottom:8px;}
  table.er-table th{text-align:left;font-size:10.5px;letter-spacing:.04em;text-transform:uppercase;color:var(--er-ink-faint);font-weight:600;padding:8px 10px;border-bottom:2px solid var(--er-border);}
  table.er-table td{padding:9px 10px;border-bottom:1px solid var(--er-border);color:var(--er-ink-soft);vertical-align:top;}
  table.er-table tr:nth-child(even) td{background:#fbfcfd;}
  table.er-table tr{break-inside:avoid;}
  .er-indicator-block{border:1px solid var(--er-border);border-radius:8px;padding:16px 18px;margin-bottom:14px;break-inside:avoid;}
  .er-indicator-head{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:8px;}
  .er-indicator-name{font-size:14px;font-weight:700;color:var(--er-primary-dark);}
  .er-indicator-value{font-size:18px;font-weight:700;color:var(--er-accent);}
  .er-indicator-meta{font-size:11px;color:var(--er-ink-faint);}
  .er-kv{font-size:12.5px;line-height:1.6;color:var(--er-ink-soft);margin:4px 0 0;}
  .er-kv b{color:var(--er-ink);}
  .er-cover{text-align:center;padding:70px 44px;}
  .er-cover-logo{font-size:13px;letter-spacing:.12em;text-transform:uppercase;color:var(--er-accent);font-weight:700;margin-bottom:6px;}
  .er-cover-title{font-size:30px;font-weight:700;color:var(--er-primary-dark);margin:0 0 6px;}
  .er-cover-sub{font-size:14px;color:var(--er-ink-soft);margin:0 0 40px;}
  .er-cover-central{display:inline-block;border:2px solid var(--er-border);border-radius:14px;padding:28px 48px;margin:0 auto 40px;}
  .er-cover-central .er-card-label{font-size:12px;}
  .er-cover-central .er-score{font-size:44px;font-weight:800;color:var(--er-primary-dark);margin:6px 0;}
  .er-cover-meta{display:grid;grid-template-columns:repeat(2,1fr);gap:10px 32px;max-width:560px;margin:0 auto;text-align:left;font-size:12.5px;}
  .er-cover-meta div b{display:block;color:var(--er-ink-faint);font-size:10.5px;text-transform:uppercase;letter-spacing:.04em;font-weight:600;margin-bottom:2px;}
  .er-reportid{font-family:ui-monospace,Consolas,monospace;font-size:11.5px;color:var(--er-ink-faint);}
`;

function renderCoverPage(p: CoverPage): string {
  return `<section class="er-page er-cover">
    <div class="er-cover-logo">NEXO · Executive Reporting Engine</div>
    <h1 class="er-cover-title">${esc(p.tipoReporteLabel)}</h1>
    <p class="er-cover-sub">${esc(p.periodLabel)}</p>
    <div class="er-cover-central">
      <p class="er-card-label">Estado General</p>
      <p class="er-score">${esc(p.estadoGeneralLabel)}</p>
      ${p.scoreGeneral !== null ? `<span class="er-badge ${ESTADO_COLOR_CLASS[p.estadoGeneralColor]}">${p.scoreGeneral}/100</span>` : ""}
    </div>
    <div class="er-cover-meta">
      <div><b>Fecha de corte</b>${esc(p.fechaCorteLabel)}</div>
      <div><b>Generado</b>${esc(p.generatedAtLabel)}</div>
      <div><b>Generado por</b>${esc(p.generatedByName)}</div>
      <div><b>Report ID</b><span class="er-reportid">${esc(p.reportId)}</span></div>
      <div><b>Analytics Engine</b>v${esc(p.analyticsEngineVersion)}</div>
      <div><b>Formula Set</b>v${esc(p.formulaSetVersion)}</div>
    </div>
  </section>`;
}

function renderExecutiveSummaryPage(p: ExecutiveSummaryPage): string {
  return `<section class="er-page">
    <p class="er-eyebrow">Página 2</p>
    <h2 class="er-h2">Executive Summary</h2>
    <div class="er-section"><p class="er-section-title">Situación General</p><p class="er-p">${esc(p.situacionGeneral)}</p></div>
    <div class="er-section"><p class="er-section-title">Fortalezas</p><p class="er-p">${esc(p.fortalezas)}</p></div>
    <div class="er-section"><p class="er-section-title">Aspectos de Atención</p><p class="er-p">${esc(p.aspectosAtencion)}</p></div>
    <div class="er-section"><p class="er-section-title">Conclusión</p><p class="er-p">${esc(p.conclusion)}</p></div>
  </section>`;
}

function renderTeamStatusPage(p: TeamStatusPage): string {
  const blocks = p.indicators
    .map(
      (i) => `<div class="er-indicator-block">
      <div class="er-indicator-head">
        <span class="er-indicator-name">${esc(i.nombre)}</span>
        <span class="er-indicator-value">${esc(i.valor)}</span>
      </div>
      <p class="er-indicator-meta">Meta: ${esc(i.meta)} · Estado: ${esc(i.estado)}</p>
      <p class="er-kv"><b>Interpretación:</b> ${esc(i.interpretacion)}</p>
      <p class="er-kv"><b>Impacto:</b> ${esc(i.impacto)}</p>
      <p class="er-kv"><b>Recomendación:</b> ${esc(i.recomendacion)}</p>
    </div>`,
    )
    .join("");
  return `<section class="er-page">
    <p class="er-eyebrow">Página 3</p>
    <h2 class="er-h2">Estado General del Equipo</h2>
    ${blocks}
  </section>`;
}

function renderStrategicIndicatorsPage(p: StrategicIndicatorsPage): string {
  const cards = p.kpis.map((k) => `<div class="er-card"><p class="er-card-label">${esc(k.label)}</p><p class="er-card-value">${esc(k.valor)}</p><p class="er-card-sublabel">${esc(k.sublabel)}</p></div>`).join("");
  const rankingRows = p.ranking
    .slice(0, 15)
    .map((r, i) => `<tr><td>${i + 1}</td><td>${esc(r.name)}</td><td>${esc(r.role)}</td><td>${r.score}</td><td>${r.completedPct}%</td></tr>`)
    .join("");
  return `<section class="er-page">
    <p class="er-eyebrow">Página 4</p>
    <h2 class="er-h2">Indicadores Estratégicos</h2>
    <div class="er-grid">${cards}</div>
    <p class="er-section-title">Ranking</p>
    <table class="er-table"><thead><tr><th>#</th><th>Nombre</th><th>Rol</th><th>Score</th><th>Cumplimiento</th></tr></thead><tbody>${rankingRows}</tbody></table>
  </section>`;
}

function renderMemberDetailPage(p: MemberDetailPage): string {
  const rows = p.members
    .map(
      (m) => `<tr>
      <td>${esc(m.name)}</td>
      <td>${esc(m.role)}</td>
      <td>${m.completedPct}%</td>
      <td><span class="er-badge ${ESTADO_COLOR_CLASS[m.cargaColor] ?? "er-badge-gray"}">${esc(m.cargaLabel)}</span></td>
      <td>${m.overdueCount}</td>
      <td>${m.estadoOperativo ? esc(m.estadoOperativo.estado) : "—"}</td>
      <td>${m.principalHallazgo ? esc(m.principalHallazgo) : "—"}</td>
    </tr>`,
    )
    .join("");
  return `<section class="er-page">
    <p class="er-eyebrow">Página 5</p>
    <h2 class="er-h2">Detalle por Colaborador</h2>
    <table class="er-table">
      <thead><tr><th>Nombre</th><th>Rol</th><th>Cumplimiento</th><th>Carga</th><th>Vencidas</th><th>Equilibrio Operativo</th><th>Acción sugerida</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </section>`;
}

/** Barras horizontales minimalistas (SVG inline) — sin librería de gráficos, consistente con "gráficos minimalistas" del FPS. */
function svgBarChart(items: Array<{ label: string; pct: number }>): string {
  if (items.length === 0) return "";
  const rowHeight = 26;
  const chartWidth = 560;
  const barMaxWidth = 360;
  const height = items.length * rowHeight + 10;
  const bars = items
    .map((item, i) => {
      const y = i * rowHeight + 6;
      const barWidth = Math.max(2, (Math.min(100, item.pct) / 100) * barMaxWidth);
      return `
        <text x="0" y="${y + 13}" font-size="11.5" fill="var(--er-ink-soft)">${esc(item.label)}</text>
        <rect x="170" y="${y}" width="${barMaxWidth}" height="14" rx="3" fill="var(--er-border)"></rect>
        <rect x="170" y="${y}" width="${barWidth}" height="14" rx="3" fill="var(--er-accent)"></rect>
        <text x="${170 + barMaxWidth + 8}" y="${y + 13}" font-size="11.5" font-weight="700" fill="var(--er-primary-dark)">${item.pct}%</text>`;
    })
    .join("");
  return `<svg viewBox="0 0 ${chartWidth} ${height}" width="100%" height="${height}" style="max-width:${chartWidth}px" role="img" aria-label="Distribución por motivo">${bars}</svg>`;
}

function renderOperationalDistributionPage(p: OperationalDistributionPage): string {
  const chart = svgBarChart(p.consultasByReason.slice(0, 8).map((m) => ({ label: m.reason, pct: m.pct ?? 0 })));
  const motivos = p.consultasByReason
    .slice(0, 8)
    .map(
      (m) => `<div class="er-indicator-block">
      <div class="er-indicator-head"><span class="er-indicator-name">${esc(m.reason)}</span><span class="er-indicator-value">${m.pct ?? 0}%</span></div>
      <p class="er-indicator-meta">${m.count} consultas · ${m.totalMinutes} min totales${m.trendPct !== null && m.trendPct !== undefined ? ` · tendencia ${m.trendPct > 0 ? "+" : ""}${m.trendPct}%` : ""}</p>
      ${m.interpretation ? `<p class="er-kv">${esc(m.interpretation)}</p>` : ""}
    </div>`,
    )
    .join("");

  const quadrantCounts: Record<string, number> = {};
  for (const q of p.riskQuadrant) quadrantCounts[q.quadrant] = (quadrantCounts[q.quadrant] ?? 0) + 1;
  const quadrantCards = Object.entries(quadrantCounts)
    .map(([q, n]) => `<div class="er-card"><p class="er-card-label">${esc(q)}</p><p class="er-card-value">${n}</p></div>`)
    .join("");

  return `<section class="er-page">
    <p class="er-eyebrow">Página 6</p>
    <h2 class="er-h2">Distribución Operativa</h2>
    <p class="er-section-title">Distribución por Motivo</p>
    ${chart}
    ${motivos || `<p class="er-muted">Sin consultas registradas en este período.</p>`}
    <p class="er-section-title" style="margin-top:20px">Matriz de Riesgo (Cumplimiento × Carga)</p>
    <div class="er-grid">${quadrantCards}</div>
  </section>`;
}

function renderInsightsPage(p: InsightsPage): string {
  return `<section class="er-page">
    <p class="er-eyebrow">Página 7</p>
    <h2 class="er-h2">Executive Insights</h2>
    <div class="er-section"><p class="er-section-title">Patrones</p>${list(p.patrones)}</div>
    <div class="er-section"><p class="er-section-title">Cambios</p>${list(p.cambios)}</div>
    <div class="er-section"><p class="er-section-title">Anomalías</p>${list(p.anomalias)}</div>
    <div class="er-section"><p class="er-section-title">Relaciones Cruzadas</p>${list(p.relacionesCruzadas)}</div>
  </section>`;
}

function renderAssessmentPage(p: AssessmentPage): string {
  return `<section class="er-page">
    <p class="er-eyebrow">Página 8 · Sección Premium</p>
    <h2 class="er-h2">Executive Assessment by NOVA</h2>
    <div class="er-section"><p class="er-section-title">Diagnóstico General</p><p class="er-p">${esc(p.diagnosticoGeneral)}</p></div>
    <div class="er-section"><p class="er-section-title">Fortalezas Estratégicas</p>${list(p.fortalezasEstrategicas)}</div>
    <div class="er-section"><p class="er-section-title">Riesgos Detectados</p>${list(p.riesgosDetectados)}</div>
    <div class="er-section"><p class="er-section-title">Oportunidades</p>${list(p.oportunidades)}</div>
    <div class="er-section"><p class="er-section-title">Prioridades</p>${list(p.prioridades)}</div>
    <div class="er-section"><p class="er-section-title">Perspectiva Estratégica</p><p class="er-p">${esc(p.perspectivaEstrategica)}</p></div>
    <div class="er-section"><p class="er-section-title">Opinión Ejecutiva NOVA</p><p class="er-p"><em>${esc(p.opinionEjecutiva)}</em></p></div>
  </section>`;
}

function renderRecommendationGroup(title: string, badgeClass: string, rows: RecommendationRow[]): string {
  if (rows.length === 0) return "";
  const items = rows
    .map(
      (r) => `<div class="er-indicator-block">
      <div class="er-indicator-head"><span class="er-indicator-name">${esc(r.text)}</span><span class="er-badge ${badgeClass}">${title}</span></div>
      ${r.enrichment ? `<p class="er-kv"><b>Justificación:</b> ${esc(r.enrichment.justificacion)}</p>
      <p class="er-kv"><b>Impacto esperado:</b> ${esc(r.enrichment.impactoEsperado)}</p>
      <p class="er-kv"><b>Área afectada:</b> ${esc(r.enrichment.areaAfectada)}</p>
      <p class="er-kv"><b>Beneficio:</b> ${esc(r.enrichment.beneficio)}</p>
      <p class="er-kv"><b>Complejidad estimada:</b> ${esc(r.enrichment.complejidadEstimada)}</p>
      <p class="er-kv"><b>Tiempo estimado:</b> ${esc(r.enrichment.tiempoEstimado)}</p>
      <p class="er-kv"><b>Responsable sugerido:</b> ${esc(r.enrichment.responsableSugerido)}</p>` : ""}
    </div>`,
    )
    .join("");
  return `<div class="er-section"><p class="er-section-title">Prioridad ${title}</p>${items}</div>`;
}

function renderRecommendationsPage(p: RecommendationsPage): string {
  return `<section class="er-page">
    <p class="er-eyebrow">Página 9</p>
    <h2 class="er-h2">Recomendaciones</h2>
    ${renderRecommendationGroup("Alta", "er-badge-red", p.alta)}
    ${renderRecommendationGroup("Media", "er-badge-yellow", p.media)}
    ${p.alta.length === 0 && p.media.length === 0 ? `<p class="er-muted">Sin recomendaciones para este período.</p>` : ""}
  </section>`;
}

function renderPredictivePage(p: PredictivePage): string {
  if (!p.available) {
    return `<section class="er-page">
      <p class="er-eyebrow">Página 10</p>
      <h2 class="er-h2">Analytics Predictivo</h2>
      <p class="er-p">${esc(p.message)}</p>
    </section>`;
  }

  const summaryCards = `<div class="er-grid">
    <div class="er-card"><p class="er-card-label">Horizonte de proyección</p><p class="er-card-value">${p.horizonDays} días</p></div>
    <div class="er-card"><p class="er-card-label">Cumplimiento esperado al cierre</p><p class="er-card-value">${p.avgCumplimientoEsperadoCierrePct ?? "—"}${p.avgCumplimientoEsperadoCierrePct !== null ? "%" : ""}</p></div>
    <div class="er-card"><p class="er-card-label">Colaboradores en riesgo de sobrecarga</p><p class="er-card-value">${p.membersAtRiskSobrecarga}</p></div>
  </div>`;

  const rows = p.members
    .map(
      (m) => `<div class="er-indicator-block">
      <div class="er-indicator-head"><span class="er-indicator-name">${esc(m.name)}</span>${m.sobrecargaNivel !== "—" ? `<span class="er-badge ${m.sobrecargaNivel === "Alto" ? "er-badge-red" : m.sobrecargaNivel === "Medio" ? "er-badge-yellow" : "er-badge-green"}">Sobrecarga: ${esc(m.sobrecargaNivel)}</span>` : ""}</div>
      <p class="er-kv"><b>Cumplimiento:</b> ${esc(m.cumplimientoLabel)}</p>
      <p class="er-kv"><b>Carga:</b> ${esc(m.sobrecargaLabel)}</p>
      <p class="er-kv"><b>Subutilización:</b> ${esc(m.subutilizacionLabel)}</p>
      ${m.queHacer.length > 0 ? `<p class="er-kv"><b>Qué hacer:</b> ${esc(m.queHacer[0])}</p>` : ""}
    </div>`,
    )
    .join("");

  return `<section class="er-page">
    <p class="er-eyebrow">Página 10 · Proyección al ${esc(p.asOfLabel)}</p>
    <h2 class="er-h2">Analytics Predictivo</h2>
    ${summaryCards}
    <p class="er-section-title">Por colaborador</p>
    ${rows}
  </section>`;
}

function renderMetadataPage(p: MetadataPage): string {
  const rows: Array<[string, string]> = [
    ["Report ID", p.reportId],
    ["Generado por", p.generatedByName],
    ["Fecha de generación", p.generatedAtLabel],
    ["Fecha de corte", p.fechaCorteLabel],
    ["Período", p.periodLabel],
    ["Tipo de reporte", p.tipoReporteLabel],
    ["Estado del período", p.periodStatusLabel],
    ["Colaboradores incluidos", String(p.collaboratorCount)],
    ["Versión Analytics Engine", `v${p.analyticsEngineVersion}`],
    ["Versión Formula Set", `v${p.formulaSetVersion}`],
    ["Versión Executive Reporting Engine", `v${p.reportingEngineVersion}`],
    ["Versión NEXO", `v${p.nexoVersion}`],
    ["Calidad del dato", `${p.dataQualityPct}%`],
    ["Tiempo de generación", p.generationMsLabel],
  ];
  const tableRows = rows.map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`).join("");
  return `<section class="er-page">
    <p class="er-eyebrow">Última página</p>
    <h2 class="er-h2">Metadatos</h2>
    <table class="er-table"><tbody>${tableRows}</tbody></table>
  </section>`;
}

function renderPageHtml(page: ReportPage): string {
  switch (page.kind) {
    case "cover":
      return renderCoverPage(page);
    case "executiveSummary":
      return renderExecutiveSummaryPage(page);
    case "teamStatus":
      return renderTeamStatusPage(page);
    case "strategicIndicators":
      return renderStrategicIndicatorsPage(page);
    case "memberDetail":
      return renderMemberDetailPage(page);
    case "operationalDistribution":
      return renderOperationalDistributionPage(page);
    case "insights":
      return renderInsightsPage(page);
    case "assessment":
      return renderAssessmentPage(page);
    case "recommendations":
      return renderRecommendationsPage(page);
    case "predictive":
      return renderPredictivePage(page);
    case "metadata":
      return renderMetadataPage(page);
  }
}

export function buildExecutiveReportHtml(pages: ReportPage[]): string {
  return `<div class="er-doc">${pages.map(renderPageHtml).join("\n")}</div>`;
}
