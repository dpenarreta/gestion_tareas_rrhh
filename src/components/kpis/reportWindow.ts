// Ventana compartida para reportes/KPIs que se abren en una nueva pestaña
// como HTML autocontenido (Mi actividad, Analytics equipo, Informes mensuales).
// jsPDF y html2canvas se sirven como assets estáticos desde /public/vendor
// (en vez de vía CDN) porque la CSP del sitio (script-src 'self') se hereda
// en la pestaña about:blank abierta con window.open + document.write.

/**
 * Metadatos del motor de Analytics para el encabezado de exportaciones
 * (§19 — Exportaciones mejoradas): versión del motor, fecha/hora de
 * generación, calidad de datos y confianza de predicción. Best-effort — un
 * informe sigue siendo válido sin esta línea si la llamada falla.
 */
export async function fetchAnalyticsExportMeta(userId: string): Promise<string> {
  try {
    const res = await fetch(`/api/analytics/${userId}`);
    if (!res.ok) return "";
    const data = await res.json();
    const generatedAt = new Date(data.lastUpdated).toLocaleString("es-CL", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
    const confidence = data.prediction?.available ? ` &bull; Confianza de predicción: ${data.prediction.confidence}` : "";
    return ` &bull; Analytics Engine v${data.engineVersion} &bull; Generado: ${generatedAt} &bull; Calidad de datos: ${data.dataQuality.pct}%${confidence}`;
  } catch {
    return "";
  }
}

export function openReportWindow(opts: { title: string; styles: string; bodyHtml: string; pdfFileName: string }) {
  const { title, styles, bodyHtml, pdfFileName } = opts;

  const html = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<title>${title}</title>
<style>
${styles}
.report-toolbar{position:sticky;top:0;display:flex;gap:10px;justify-content:flex-end;padding:14px 0;margin-bottom:16px;background:#fff;border-bottom:1px solid #e2e8f0;z-index:20}
.report-toolbar button{cursor:pointer;border:none;border-radius:8px;padding:10px 18px;font-size:13px;font-weight:600;font-family:inherit}
.report-toolbar button:disabled{opacity:.55;cursor:wait}
.report-toolbar .btn-print{background:#4f46e5;color:#fff}
.report-toolbar .btn-pdf{background:#0f172a;color:#fff}
@media print{.report-toolbar{display:none}}
</style>
</head>
<body>
  <div class="report-toolbar">
    <button type="button" class="btn-print" onclick="window.print()">🖨️ Imprimir</button>
    <button type="button" class="btn-pdf" id="__pdfBtn" onclick="__downloadPdf()">⬇️ Descargar PDF</button>
  </div>
  <div id="__reportRoot">
${bodyHtml}
  </div>
  <script src="/vendor/html2canvas.min.js"><\/script>
  <script src="/vendor/jspdf.umd.min.js"><\/script>
  <script>
    function __downloadPdf() {
      var btn = document.getElementById('__pdfBtn');
      var original = btn.textContent;
      btn.disabled = true;
      btn.textContent = 'Generando…';
      function restore() { btn.disabled = false; btn.textContent = original; }
      try {
        var ctor = (window.jspdf && window.jspdf.jsPDF) || window.jsPDF;
        var doc = new ctor('p', 'pt', 'a4');
        var root = document.getElementById('__reportRoot');
        doc.html(root, {
          x: 0,
          y: 0,
          width: doc.internal.pageSize.getWidth(),
          windowWidth: root.scrollWidth || 900,
          autoPaging: 'text',
          html2canvas: { scale: 0.72, useCORS: true, backgroundColor: '#ffffff' },
          callback: function (pdf) {
            pdf.save(${JSON.stringify(pdfFileName)});
            restore();
          },
        });
      } catch (e) {
        console.error(e);
        alert('No se pudo generar el PDF: ' + (e && e.message ? e.message : e));
        restore();
      }
    }
  <\/script>
</body>
</html>`;

  const win = window.open("", "_blank");
  if (win) {
    win.document.write(html);
    win.document.close();
  }
}
