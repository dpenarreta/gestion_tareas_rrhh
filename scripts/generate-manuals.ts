/**
 * Genera los 3 manuales de usuario de Nexo en PDF.
 * Ejecutar con: npx tsx scripts/generate-manuals.ts
 * Salida: public/manuales/*.pdf
 */
import fs from "fs";
import path from "path";
import PDFDocument from "pdfkit";

const PRIMARY = "#5155e5";
const PRIMARY_LIGHT = "#8b8ef6";
const INK = "#1e1b2e";
const SECONDARY = "#5b5770";
const DISABLED = "#8b869c";
const PAGE_MARGIN = 56;

type ManualSection = {
  heading: string;
  steps: string[];
};

type ManualDef = {
  fileName: string;
  title: string;
  subtitle: string;
  audience: string;
  sections: ManualSection[];
};

function drawLogo(doc: PDFKit.PDFDocument, x: number, y: number, size: number, onDark: boolean) {
  doc.save();
  doc.roundedRect(x, y, size, size, size * 0.28).fill(onDark ? "#ffffff" : PRIMARY);
  doc
    .fillColor(onDark ? PRIMARY : "#ffffff")
    .font("Helvetica-Bold")
    .fontSize(size * 0.58)
    .text("N", x, y + size * 0.16, { width: size, align: "center" });
  doc.restore();
}

function addCoverHeader(doc: PDFKit.PDFDocument, def: ManualDef) {
  const bandHeight = 168;
  doc.save();
  doc.rect(0, 0, doc.page.width, bandHeight).fill(PRIMARY);
  // subtle diagonal accent
  doc.opacity(0.16);
  doc.rect(doc.page.width - 220, 0, 220, bandHeight).fill(PRIMARY_LIGHT);
  doc.opacity(1);
  doc.restore();

  drawLogo(doc, PAGE_MARGIN, 34, 40, true);
  doc
    .fillColor("#ffffff")
    .font("Helvetica-Bold")
    .fontSize(20)
    .text("Nexo", PAGE_MARGIN + 52, 42);
  doc
    .fillColor("#ffffff")
    .font("Helvetica")
    .fontSize(10)
    .opacity(0.85)
    .text("Sistema de Gestión de Recursos Humanos", PAGE_MARGIN + 52, 66);
  doc.opacity(1);

  doc
    .fillColor("#ffffff")
    .font("Helvetica-Bold")
    .fontSize(26)
    .text(def.title, PAGE_MARGIN, 108, { width: doc.page.width - PAGE_MARGIN * 2 });
  doc
    .fillColor("#ffffff")
    .font("Helvetica")
    .fontSize(12)
    .opacity(0.9)
    .text(def.subtitle, PAGE_MARGIN, 140, { width: doc.page.width - PAGE_MARGIN * 2 });
  doc.opacity(1);

  doc.y = bandHeight + 34;
}

function addRunningHeader(doc: PDFKit.PDFDocument, def: ManualDef) {
  drawLogo(doc, PAGE_MARGIN, 30, 20, false);
  doc
    .fillColor(INK)
    .font("Helvetica-Bold")
    .fontSize(10)
    .text("Nexo", PAGE_MARGIN + 27, 34);
  doc
    .fillColor(SECONDARY)
    .font("Helvetica")
    .fontSize(9)
    .text(def.title, PAGE_MARGIN + 27, 46);
  doc
    .strokeColor("#e4e2f0")
    .lineWidth(1)
    .moveTo(PAGE_MARGIN, 62)
    .lineTo(doc.page.width - PAGE_MARGIN, 62)
    .stroke();
  doc.y = 78;
}

function ensureSpace(doc: PDFKit.PDFDocument, def: ManualDef, needed: number) {
  const bottom = doc.page.height - doc.page.margins.bottom;
  if (doc.y + needed > bottom) {
    doc.addPage();
    addRunningHeader(doc, def);
  }
}

function renderManual(def: ManualDef) {
  const doc = new PDFDocument({
    size: "A4",
    margins: { top: PAGE_MARGIN, bottom: PAGE_MARGIN, left: PAGE_MARGIN, right: PAGE_MARGIN },
    bufferPages: true,
    info: {
      Title: `${def.title} — Nexo`,
      Author: "Nexo",
      Subject: def.subtitle,
    },
  });

  const outPath = path.join(__dirname, "..", "public", "manuales", def.fileName);
  doc.pipe(fs.createWriteStream(outPath));

  addCoverHeader(doc, def);

  doc
    .fillColor(SECONDARY)
    .font("Helvetica")
    .fontSize(10.5)
    .text(`Dirigido a: ${def.audience}`, PAGE_MARGIN, doc.y, {
      width: doc.page.width - PAGE_MARGIN * 2,
    });
  doc.moveDown(1.4);

  const contentWidth = doc.page.width - PAGE_MARGIN * 2;

  def.sections.forEach((section, sIdx) => {
    ensureSpace(doc, def, 60);

    // Section heading
    doc
      .fillColor(PRIMARY)
      .font("Helvetica-Bold")
      .fontSize(13)
      .text(`${sIdx + 1}. ${section.heading}`, PAGE_MARGIN, doc.y, { width: contentWidth });
    doc.moveDown(0.5);

    section.steps.forEach((step, stIdx) => {
      const numberLabel = `${stIdx + 1}.`;
      const numberWidth = 20;
      const textX = PAGE_MARGIN + numberWidth;
      const textWidth = contentWidth - numberWidth;

      const heightEstimate = doc.heightOfString(step, { width: textWidth, align: "justify" });
      ensureSpace(doc, def, heightEstimate + 10);

      const startY = doc.y;
      doc
        .fillColor(PRIMARY_LIGHT)
        .font("Helvetica-Bold")
        .fontSize(10.5)
        .text(numberLabel, PAGE_MARGIN, startY, { width: numberWidth });
      doc
        .fillColor(INK)
        .font("Helvetica")
        .fontSize(10.5)
        .text(step, textX, startY, { width: textWidth, align: "justify" });
      doc.y = Math.max(doc.y, startY + heightEstimate) + 7;
    });

    doc.moveDown(0.6);
  });

  // Footer page numbers on every page. Written inside the bottom margin zone,
  // so the page's autopaging-on-overflow check is disabled during the write —
  // otherwise pdfkit treats text below the printable area as overflow and
  // silently inserts a blank extra page to "continue" it.
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(range.start + i);
    const originalBottomMargin = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    const footerY = doc.page.height - PAGE_MARGIN + 10;
    doc
      .fillColor(DISABLED)
      .font("Helvetica")
      .fontSize(8.5)
      .text(`Manual de Usuario Nexo — ${def.title}`, PAGE_MARGIN, footerY, {
        width: contentWidth / 2,
        align: "left",
        lineBreak: false,
      });
    doc
      .fillColor(DISABLED)
      .font("Helvetica")
      .fontSize(8.5)
      .text(`Página ${i + 1} de ${range.count}`, PAGE_MARGIN + contentWidth / 2, footerY, {
        width: contentWidth / 2,
        align: "right",
        lineBreak: false,
      });
    doc.page.margins.bottom = originalBottomMargin;
  }

  doc.end();
  return outPath;
}

const manualAdministrador: ManualDef = {
  fileName: "manual-administrador.pdf",
  title: "Manual de Usuario",
  subtitle: "Guía completa para el rol Administrador",
  audience: "Administrador",
  sections: [
    {
      heading: "Acceso y login",
      steps: [
        "Ingresa a la dirección web de Nexo desde tu navegador.",
        "Escribe tu correo institucional y tu contraseña en el formulario de inicio de sesión.",
        "Haz clic en \"Iniciar sesión\". Si es tu primer ingreso, tu contraseña por defecto es 123456; cámbiala de inmediato desde tu perfil.",
        "Si olvidaste tu contraseña, usa la opción \"¿Olvidaste tu contraseña?\" en la pantalla de login para iniciar el proceso de recuperación.",
      ],
    },
    {
      heading: "Gestión completa de usuarios",
      steps: [
        "Para crear un usuario, ve a Usuarios > Nuevo usuario, completa nombre, correo y rol, y guarda. La contraseña inicial siempre es 123456.",
        "Para editar un usuario, haz clic sobre su fila en la lista, modifica nombre, correo o rol, y confirma los cambios.",
        "Para eliminar un usuario, usa el botón de eliminar en su fila y confirma la acción; ten en cuenta que esta operación es irreversible.",
        "Para restablecer una contraseña olvidada, usa la opción \"Restablecer contraseña\" del usuario; esto la devuelve al valor por defecto (123456).",
        "Como Administrador, eres el único rol que puede crear, editar y eliminar cualquier usuario del sistema, incluyendo a otros Administradores y al Jefe Nacional.",
      ],
    },
    {
      heading: "Cierre mensual y repositorio",
      steps: [
        "Al finalizar cada mes, ve al módulo Trabajo y selecciona \"Cerrar mes\".",
        "Revisa el resumen que se presenta: total de tareas, completadas, pendientes y en progreso, antes de confirmar.",
        "Al confirmar, las tareas vencidas se archivan y las tareas recurrentes (mensuales, semanales, quincenales o diarias) se duplican automáticamente para el mes siguiente.",
        "Consulta el histórico de meses cerrados en el Repositorio, organizado por año y mes, en modo de solo lectura.",
      ],
    },
    {
      heading: "Informes consolidados con análisis IA",
      steps: [
        "Ve a Analytics > Informes mensuales.",
        "Selecciona el mes deseado y haz clic en \"Generar informe\" para obtener un consolidado de todo el equipo.",
        "Cada informe incluye un análisis narrativo generado por inteligencia artificial, con fortalezas, alertas y recomendaciones basadas en los datos reales del período.",
        "También puedes generar un informe de rango, seleccionando varios meses consecutivos, para analizar tendencias de cumplimiento y carga laboral en el tiempo.",
      ],
    },
    {
      heading: "Configuración del sistema",
      steps: [
        "Desde tu perfil puedes cambiar el tema visual (claro u oscuro) y tus preferencias de vista de tareas (Kanban o Tabla).",
        "Actualiza tu contraseña regularmente desde la sección \"Cambiar contraseña\" de tu perfil.",
        "Como Administrador tienes visibilidad y control total sobre todos los módulos del sistema, sin las restricciones de jerarquía que aplican a otros roles.",
      ],
    },
    {
      heading: "Módulo Analytics completo",
      steps: [
        "Ingresa a Analytics para ver los KPIs de cumplimiento, carga laboral, calidad y actividad de cada colaborador de la organización.",
        "Usa el selector de mes para navegar entre períodos y el ranking para comparar el desempeño del equipo completo.",
        "Como Administrador ves los datos de absolutamente todos los colaboradores, sin las exclusiones de jerarquía que aplican a otros roles de gestión.",
      ],
    },
    {
      heading: "Gestión de comunicados",
      steps: [
        "Ve al Dashboard y selecciona \"Nuevo comunicado\".",
        "Escribe el título y el contenido del comunicado, y define por cuántos días permanecerá visible.",
        "Marca la opción de \"fijado\" si deseas que el comunicado aparezca siempre primero en la lista.",
        "Al publicarlo, todos los usuarios visibles para tu rol reciben una notificación automática.",
      ],
    },
  ],
};

const manualJefeCoordinador: ManualDef = {
  fileName: "manual-jefe-coordinador.pdf",
  title: "Manual de Usuario",
  subtitle: "Guía completa para Jefe Nacional y Coordinador Nacional",
  audience: "Jefe Nacional y Coordinador Nacional",
  sections: [
    {
      heading: "Acceso y login",
      steps: [
        "Ingresa a la dirección web de Nexo desde tu navegador.",
        "Escribe tu correo institucional y tu contraseña, y haz clic en \"Iniciar sesión\".",
        "Si es tu primer ingreso, tu contraseña por defecto es 123456; cámbiala de inmediato desde tu perfil.",
      ],
    },
    {
      heading: "Dashboard y tarjetas personalizables",
      steps: [
        "El Dashboard muestra tarjetas de jornada, prioridades, agenda, actividad reciente, comunicados, acciones rápidas y resumen general.",
        "Puedes arrastrar cada tarjeta para reordenarla según tu preferencia; el nuevo orden se guarda automáticamente y se mantiene en tus próximas visitas.",
      ],
    },
    {
      heading: "Módulo Trabajo",
      steps: [
        "Para crear una tarea, ve a Trabajo > Nueva tarea, define si es Fija o de Seguimiento, su prioridad, frecuencia, fechas y horas estimadas, y asígnala a un colaborador.",
        "Usa las vistas Kanban o Tabla según prefieras visualizar el trabajo de tu equipo.",
        "Al finalizar el mes, usa \"Cerrar mes\" para archivar las tareas vencidas y generar automáticamente las tareas recurrentes del siguiente período.",
      ],
    },
    {
      heading: "Módulo Equipo",
      steps: [
        "Ingresa a Equipo para consultar las tareas de los colaboradores que están bajo tu jerarquía según tu rol.",
        "Selecciona un colaborador de la lista para ver el detalle completo de sus tareas y sus indicadores de desempeño.",
      ],
    },
    {
      heading: "Analytics e informes con IA",
      steps: [
        "En Analytics puedes revisar los KPIs de cumplimiento, carga laboral y calidad de tu equipo.",
        "En Informes mensuales, genera el consolidado de tu equipo con análisis narrativo elaborado por inteligencia artificial.",
        "El Coordinador Nacional visualiza el consolidado de su equipo (excluyendo al Jefe Nacional); el Jefe Nacional visualiza el consolidado de toda la organización.",
      ],
    },
    {
      heading: "Asistente Nova, modo RRHH",
      steps: [
        "Ingresa al módulo Nova y selecciona el modo \"RRHH\" para resolver dudas de gestión de personas, normativa laboral o procesos internos.",
        "Nova prioriza los documentos cargados en la base de conocimiento de la empresa como primera fuente de respuesta, citando la página exacta cuando corresponde.",
      ],
    },
    {
      heading: "Reuniones Zoom con Otter.ai",
      steps: [
        "Ve a Reuniones > Nueva reunión y define título, descripción, fecha, duración e invitados.",
        "Genera el enlace de Zoom de la reunión desde el mismo formulario.",
        "Activa la invitación a Otter.ai para que, al finalizar la reunión, se genere automáticamente una transcripción y un resumen.",
      ],
    },
    {
      heading: "Mejora Continua",
      steps: [
        "Revisa las ideas propuestas por el equipo en el módulo Mejora Continua.",
        "Cambia el estado de cada idea a medida que avanza: en revisión, aprobada, en desarrollo, en pruebas o implementada.",
        "Si rechazas una idea, incluye un comentario explicando el motivo; este quedará visible para el autor de la propuesta.",
      ],
    },
    {
      heading: "Gestión de usuarios",
      steps: [
        "Ve a Usuarios para crear, editar, eliminar o restablecer la contraseña de cualquier colaborador.",
        "El Coordinador Nacional puede gestionar a todos los roles excepto a otro Jefe Nacional; el Jefe Nacional puede gestionar a cualquier usuario.",
        "La contraseña inicial de todo usuario nuevo, y la de cualquier restablecimiento, es siempre 123456.",
      ],
    },
  ],
};

const manualColaboradores: ManualDef = {
  fileName: "manual-colaboradores.pdf",
  title: "Manual de Usuario",
  subtitle: "Guía completa para Colaboradores",
  audience: "Todos los demás roles (Coordinador ZS, Analistas, Asistentes y Trabajo Social)",
  sections: [
    {
      heading: "Acceso y login",
      steps: [
        "Ingresa a la dirección web de Nexo desde tu navegador.",
        "Escribe tu correo institucional y tu contraseña, y haz clic en \"Iniciar sesión\".",
        "Si es tu primer ingreso, tu contraseña por defecto es 123456; cámbiala de inmediato desde la sección \"Cambiar contraseña\" de tu perfil.",
      ],
    },
    {
      heading: "Dashboard personal",
      steps: [
        "Al iniciar sesión llegas a tu Dashboard, donde ves tus tareas del día, tus prioridades, tu agenda y los comunicados recientes de la organización.",
        "Puedes reordenar las tarjetas del Dashboard arrastrándolas según tu preferencia.",
      ],
    },
    {
      heading: "Módulo Trabajo: tareas Fijas y de Seguimiento",
      steps: [
        "Las tareas Fijas tienen una fecha de vencimiento y horas estimadas; actualiza su estado (pendiente, en progreso, completada) y registra las horas reales a medida que avanzas.",
        "Las tareas de Seguimiento no se completan registrando horas planificadas de antemano, sino registrando cada actividad atendida durante el período.",
        "Cambia entre las vistas Kanban y Tabla según prefieras organizar visualmente tu trabajo.",
      ],
    },
    {
      heading: "Registrar actividades de seguimiento",
      steps: [
        "Abre una tarea de tipo Seguimiento y haz clic en \"Agregar actividad\".",
        "Selecciona el motivo de la consulta atendida (novedades de pago, solicitud de vacaciones, visita domiciliaria, entre otros).",
        "Indica la hora de inicio y la hora de fin; la duración se calcula automáticamente al guardar.",
      ],
    },
    {
      heading: "Seguimientos planificados (recordatorios)",
      steps: [
        "Dentro del detalle de una tarea, abre la sección \"Seguimiento planificado\" y haz clic en \"Agregar recordatorio\".",
        "Escribe un título, la fecha y hora en que deseas que se te recuerde, y una descripción opcional.",
        "Recibirás una notificación dentro de la aplicación cuando llegue el momento programado del recordatorio.",
        "La sección de seguimientos planificados puede contraerse o expandirse haciendo clic en su encabezado, para ahorrar espacio cuando tengas varios recordatorios.",
      ],
    },
    {
      heading: "Mi actividad (KPIs propios)",
      steps: [
        "Ingresa a \"Mi actividad\" para revisar tu porcentaje de cumplimiento, tus tareas vencidas y tu calidad de trabajo.",
        "Consulta tu carga laboral diaria, semanal y mensual, calculada sobre la base de días hábiles del período.",
        "Revisa el detalle de consultas de Seguimiento atendidas, agrupadas por motivo.",
      ],
    },
    {
      heading: "Asistente Nova",
      steps: [
        "Ingresa al módulo Nova para conversar sobre tus tareas, resolver dudas generales o recibir recomendaciones de priorización.",
        "Nova puede analizar tu carga de trabajo actual y sugerirte cómo organizar tus próximas actividades.",
      ],
    },
    {
      heading: "Proponer ideas en Mejora Continua",
      steps: [
        "Ve a Mejora Continua y selecciona \"Nueva idea\".",
        "Describe tu propuesta, indica su impacto esperado (alto, medio o bajo) y adjunta un archivo de soporte si lo consideras necesario.",
        "Puedes votar las ideas propuestas por tus compañeros y hacer seguimiento a su estado (en revisión, aprobada, en desarrollo, implementada, entre otros).",
      ],
    },
    {
      heading: "Ver reuniones y transcripciones",
      steps: [
        "Ve a Reuniones para consultar las reuniones programadas en las que fuiste invitado.",
        "Únete a la reunión usando el enlace de Zoom incluido en la tarjeta correspondiente.",
        "Una vez finalizada la reunión, si se activó la integración con Otter.ai, podrás consultar su resumen y transcripción desde el mismo módulo.",
      ],
    },
  ],
};

const outDir = path.join(__dirname, "..", "public", "manuales");
fs.mkdirSync(outDir, { recursive: true });

for (const def of [manualAdministrador, manualJefeCoordinador, manualColaboradores]) {
  const outPath = renderManual(def);
  console.log(`Generado: ${outPath}`);
}
