"""Importación y exportación de Excel del módulo (openpyxl, mismo motor que
`apps.tasks.task_import`).

La importación es en dos pasos: `ImportService.preview` valida TODO el
archivo sin escribir nada y guarda el resultado en un `ImportBatch`;
`ImportService.confirm` aplica solo las filas válidas con la estrategia
elegida (omitir o actualizar existentes). Confirmar dos veces el mismo
lote no vuelve a aplicar nada, y reimportar el mismo archivo no duplica
registros porque cada fila se identifica por (colaborador, fecha).
"""

import hashlib
import io
import unicodedata
from datetime import date
from decimal import Decimal

import openpyxl
from django.db import transaction
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter

from apps.tasks.task_import import parse_date

from . import access as perms
from .access import NovedadesAccess
from .models import Collaborator, ImportBatch, OvertimeRecord, SupervisorPeriod, WorkedDay
from .periods import WEEKDAY_NAMES_ES, PeriodKey, is_weekend
from .services import (
    EventService,
    NotificationService,
    NovedadesError,
    OvertimeService,
    PeriodService,
    WorkedDayService,
    _fmt,
    _forbidden,
    normalize_cedula,
    parse_hours,
    user_display,
)

WORKED_DAYS_FIXED_HEADERS = ["Supervisor", "Cargo", "Corte anterior", "Cédula", "Empleado"]
OVERTIME_HEADERS = [
    "FECHA",
    "CEDULA",
    "NOMBRE DEL COLABORADOR",
    "REGIONAL",
    "ÁREA",
    "CARGO",
    "# HORAS EXTRAS",
    "# HORAS SABADO",
    "SABADO",
    "DOMINGO",
    "FERIADO",
    "TRABAJO REALIZADO",
    "OBSERVACIONES",
]
# Exportación del consolidado: SUPERVISOR después de CARGO (7.ª columna).
OVERTIME_EXPORT_HEADERS = OVERTIME_HEADERS[:6] + ["SUPERVISOR"] + OVERTIME_HEADERS[6:]

WEEKEND_FILL = PatternFill("solid", fgColor="FFF59D")
HEADER_FILL = PatternFill("solid", fgColor="E8EEF7")
MAX_IMPORT_ROWS = 5000


def _norm(text) -> str:
    """Encabezado comparable: sin tildes, mayúsculas, espacios simples."""
    value = unicodedata.normalize("NFKD", str(text or "")).encode("ascii", "ignore").decode()
    return " ".join(value.upper().split())


def _bool(value) -> bool | None:
    if value is None or (isinstance(value, str) and not value.strip()):
        return False
    if isinstance(value, bool):
        return value
    text = _norm(value)
    if text in {"SI", "S", "X", "1", "TRUE", "VERDADERO", "YES"}:
        return True
    if text in {"NO", "N", "0", "FALSE", "FALSO"}:
        return False
    return None


def _header_date(value) -> date | None:
    """Fecha de una celda/encabezado: date real, serial de Excel o texto
    (ISO o dd/mm/aaaa) — mismo parser que la importación de Tareas."""
    return parse_date(value)


def _sheet_bytes(wb) -> bytes:
    buffer = io.BytesIO()
    wb.save(buffer)
    return buffer.getvalue()


def _style_header(ws, ncols: int):
    for col in range(1, ncols + 1):
        cell = ws.cell(row=1, column=col)
        cell.font = Font(bold=True)
        cell.fill = HEADER_FILL
        cell.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
    ws.freeze_panes = "A2"


class ExportService:
    @staticmethod
    def overtime(acc: NovedadesAccess, qs) -> bytes:
        if not acc.can(perms.EXPORTAR):
            raise _forbidden("No tiene habilitada la exportación a Excel.")
        wb = openpyxl.Workbook()
        ws = wb.active
        ws.title = "Horas extras"
        ws.append(OVERTIME_EXPORT_HEADERS)
        for r in qs:
            ws.append(
                [
                    r.date,
                    r.collaborator.cedula,
                    r.collaborator.full_name,
                    r.collaborator.regional,
                    r.collaborator.area,
                    r.collaborator.cargo,
                    user_display(r.supervisor),
                    float(r.overtime_hours),
                    float(r.saturday_hours),
                    "SI" if r.is_saturday else "NO",
                    "SI" if r.is_sunday else "NO",
                    "SI" if r.is_holiday else "NO",
                    r.work_done,
                    r.observations,
                ]
            )
            ws.cell(row=ws.max_row, column=1).number_format = "DD/MM/YYYY"
        _style_header(ws, len(OVERTIME_EXPORT_HEADERS))
        for idx, width in enumerate([12, 14, 32, 16, 18, 20, 26, 10, 10, 8, 8, 8, 36, 36], start=1):
            ws.column_dimensions[get_column_letter(idx)].width = width
        return _sheet_bytes(wb)

    @staticmethod
    def worked_days(acc: NovedadesAccess, matrix: dict) -> bytes:
        if not acc.can(perms.EXPORTAR):
            raise _forbidden("No tiene habilitada la exportación a Excel.")
        wb = openpyxl.Workbook()
        ws = wb.active
        ws.title = "Días laborados"
        columns = matrix["columns"]
        dates = [date.fromisoformat(c["date"]) for c in columns]
        ws.append(WORKED_DAYS_FIXED_HEADERS + dates)
        fixed = len(WORKED_DAYS_FIXED_HEADERS)
        for idx in range(fixed + 1, fixed + len(dates) + 1):
            cell = ws.cell(row=1, column=idx)
            cell.number_format = "DD/MM/YYYY"
        supervisor_name = matrix["supervisor"]["name"]
        for row in matrix["rows"]:
            values = []
            for c in columns:
                cell = row["cells"].get(c["date"])
                values.append(float(cell["hours"]) if cell and cell["hours"] is not None else None)
            ws.append(
                [supervisor_name, row["cargo"], row["cut_label"], row["cedula"], row["full_name"]]
                + values
            )
        _style_header(ws, fixed + len(dates))
        for idx, d in enumerate(dates, start=fixed + 1):
            ws.column_dimensions[get_column_letter(idx)].width = 11
            if is_weekend(d):
                for r in range(1, ws.max_row + 1):
                    ws.cell(row=r, column=idx).fill = WEEKEND_FILL
        for idx, width in enumerate([26, 20, 34, 14, 32], start=1):
            ws.column_dimensions[get_column_letter(idx)].width = width
        ws.freeze_panes = ws.cell(row=2, column=fixed + 1)
        return _sheet_bytes(wb)

    @staticmethod
    def import_errors(batch: ImportBatch) -> bytes:
        wb = openpyxl.Workbook()
        ws = wb.active
        ws.title = "Errores"
        ws.append(["Fila", "Columna", "Error"])
        for err in batch.errors:
            ws.append([err.get("row"), err.get("column", ""), err.get("message")])
        _style_header(ws, 3)
        ws.column_dimensions["C"].width = 90
        return _sheet_bytes(wb)


class ImportService:
    @staticmethod
    def _check(acc: NovedadesAccess):
        if not acc.can(perms.IMPORTAR):
            raise _forbidden("No tiene habilitada la importación de Excel.")
        if not acc.can(perms.REGISTRAR):
            raise _forbidden("No tiene habilitado el registro de novedades.")
        if acc.is_assistant:
            raise _forbidden("El Asistente de Operaciones no modifica registros originales.")

    @staticmethod
    def _load(file) -> list[tuple]:
        try:
            wb = openpyxl.load_workbook(file, data_only=True, read_only=True)
        except Exception as exc:  # noqa: BLE001
            raise NovedadesError(
                "No se pudo leer el archivo: debe ser un Excel .xlsx válido."
            ) from exc
        ws = wb.worksheets[0]
        rows = list(ws.iter_rows(values_only=True))
        if not rows:
            raise NovedadesError("El archivo está vacío.")
        if len(rows) - 1 > MAX_IMPORT_ROWS:
            raise NovedadesError(f"El archivo supera el máximo de {MAX_IMPORT_ROWS} filas.")
        return rows

    @staticmethod
    def _collaborator_for(acc, cedula, by_cedula, errors, row_num, column="Cédula"):
        collaborator = by_cedula.get(cedula)
        if collaborator is None:
            errors.append(
                {
                    "row": row_num,
                    "column": column,
                    "message": f"La cédula {cedula} no existe en la base de colaboradores (regístrela primero).",
                }
            )
            return None
        if not acc.can_write_for_supervisor(collaborator.current_supervisor_id):
            errors.append(
                {
                    "row": row_num,
                    "column": column,
                    "message": f"La cédula {cedula} no pertenece a su equipo.",
                }
            )
            return None
        return collaborator

    @staticmethod
    def _open_supervisor_ids(key: PeriodKey, supervisor_ids: set[int]) -> set[int]:
        for sid in supervisor_ids:
            from django.contrib.auth import get_user_model

            PeriodService.ensure_current(get_user_model().objects.get(pk=sid))
        return set(
            SupervisorPeriod.objects.filter(
                period__year=key.year,
                period__month=key.month,
                supervisor_id__in=supervisor_ids,
                status=SupervisorPeriod.Status.OPEN,
            ).values_list("supervisor_id", flat=True)
        )

    @staticmethod
    def preview(
        acc: NovedadesAccess, *, kind: str, key: PeriodKey, file, file_name: str
    ) -> ImportBatch:
        ImportService._check(acc)
        content = file.read()
        file_hash = hashlib.sha256(content).hexdigest()
        rows = ImportService._load(io.BytesIO(content))
        if kind == ImportBatch.Kind.WORKED_DAYS:
            parsed, errors = ImportService._parse_worked_days(acc, key, rows)
        elif kind == ImportBatch.Kind.OVERTIME:
            parsed, errors = ImportService._parse_overtime(acc, key, rows)
        else:
            raise NovedadesError("Tipo de importación inválido.")
        already = ImportBatch.objects.filter(
            kind=kind,
            period__year=key.year,
            period__month=key.month,
            file_hash=file_hash,
            status=ImportBatch.Status.CONFIRMED,
        ).exists()
        error_rows = {e["row"] for e in errors}
        summary = {
            "total_rows": len(rows) - 1,
            "valid_rows": len({p["row"] for p in parsed} - error_rows),
            "invalid_rows": len(error_rows),
            "existing_items": sum(1 for p in parsed if p.get("existing")),
            "new_items": sum(1 for p in parsed if not p.get("existing")),
            "already_imported": already,
        }
        # Filas con algún error se descartan completas (nunca a medias).
        parsed = [p for p in parsed if p["row"] not in error_rows]
        return ImportBatch.objects.create(
            kind=kind,
            period=PeriodService.get_period(key),
            uploaded_by=acc.user,
            file_name=file_name[:255],
            file_hash=file_hash,
            rows=parsed,
            errors=errors,
            summary=summary,
        )

    @staticmethod
    def _parse_worked_days(acc, key: PeriodKey, rows):
        header = list(rows[0])
        fixed = len(WORKED_DAYS_FIXED_HEADERS)
        errors, parsed = [], []
        if [_norm(h) for h in header[:fixed]] != [_norm(h) for h in WORKED_DAYS_FIXED_HEADERS]:
            raise NovedadesError(
                "Encabezados inválidos. Las primeras columnas deben ser: "
                + " | ".join(WORKED_DAYS_FIXED_HEADERS)
            )
        date_cols: list[tuple[int, date]] = []
        for idx, raw in enumerate(header[fixed:], start=fixed):
            if raw is None or str(raw).strip() == "":
                continue
            d = _header_date(raw)
            if d is None:
                errors.append(
                    {"row": 1, "column": str(raw), "message": "Encabezado de fecha inválido."}
                )
                continue
            if not key.contains(d):
                errors.append(
                    {
                        "row": 1,
                        "column": f"{d:%d/%m/%Y}",
                        "message": f"La fecha no pertenece al período {key.label} "
                        f"({key.start_date:%d/%m/%Y} – {key.end_date:%d/%m/%Y}).",
                    }
                )
                continue
            date_cols.append((idx, d))
        if errors:
            return [], errors

        cedulas = {
            normalize_cedula(r[3]) for r in rows[1:] if len(r) > 3 and r[3] not in (None, "")
        }
        by_cedula = {c.cedula: c for c in Collaborator.objects.filter(cedula__in=cedulas)}
        existing = {
            (wd.collaborator_id, wd.date): wd
            for wd in WorkedDay.objects.filter(
                collaborator__cedula__in=cedulas, date__gte=key.start_date, date__lte=key.end_date
            )
        }
        seen = set()
        for offset, row in enumerate(rows[1:], start=2):
            if all(v in (None, "") for v in row):
                continue
            cedula = normalize_cedula(row[3] if len(row) > 3 else "")
            if not cedula:
                errors.append({"row": offset, "column": "Cédula", "message": "Cédula vacía."})
                continue
            if cedula in seen:
                errors.append(
                    {
                        "row": offset,
                        "column": "Cédula",
                        "message": f"Cédula {cedula} repetida en el archivo.",
                    }
                )
                continue
            seen.add(cedula)
            collaborator = ImportService._collaborator_for(acc, cedula, by_cedula, errors, offset)
            if collaborator is None:
                continue
            for idx, d in date_cols:
                raw = row[idx] if idx < len(row) else None
                if raw is None or (isinstance(raw, str) and raw.strip() == ""):
                    continue
                column = f"{d:%d/%m/%Y}"
                if is_weekend(d):
                    errors.append(
                        {
                            "row": offset,
                            "column": column,
                            "message": f"{WEEKDAY_NAMES_ES[d.weekday()]}: las columnas de sábado y domingo no "
                            "admiten valores en Días laborados.",
                        }
                    )
                    continue
                try:
                    value = parse_hours(raw, field_label="Horas")
                except NovedadesError as exc:
                    errors.append({"row": offset, "column": column, "message": exc.message})
                    continue
                if collaborator.status != Collaborator.Status.ACTIVE:
                    errors.append(
                        {
                            "row": offset,
                            "column": column,
                            "message": f"{collaborator.full_name} está {collaborator.get_status_display().lower()}.",
                        }
                    )
                    continue
                current = existing.get((collaborator.pk, d))
                parsed.append(
                    {
                        "row": offset,
                        "collaborator_id": collaborator.pk,
                        "supervisor_id": collaborator.current_supervisor_id,
                        "cedula": cedula,
                        "name": collaborator.full_name,
                        "date": d.isoformat(),
                        "hours": _fmt(value),
                        "existing": current is not None and current.hours is not None,
                        "existing_hours": (
                            _fmt(current.hours) if current and current.hours is not None else None
                        ),
                    }
                )
        return parsed, errors

    @staticmethod
    def _parse_overtime(acc, key: PeriodKey, rows):
        header = [_norm(h) for h in rows[0][: len(OVERTIME_HEADERS)]]
        if header != [_norm(h) for h in OVERTIME_HEADERS]:
            raise NovedadesError(
                "Encabezados inválidos. Deben ser exactamente: " + " | ".join(OVERTIME_HEADERS)
            )
        errors, parsed = [], []
        cedulas = {
            normalize_cedula(r[1]) for r in rows[1:] if len(r) > 1 and r[1] not in (None, "")
        }
        by_cedula = {c.cedula: c for c in Collaborator.objects.filter(cedula__in=cedulas)}
        existing = {
            (r.collaborator_id, r.date): r
            for r in OvertimeRecord.objects.filter(
                collaborator__cedula__in=cedulas,
                date__gte=key.start_date,
                date__lte=key.end_date,
                deleted_at__isnull=True,
            )
        }
        seen = set()
        for offset, row in enumerate(rows[1:], start=2):
            row = list(row) + [None] * (len(OVERTIME_HEADERS) - len(row))
            if all(v in (None, "") for v in row):
                continue
            d = _header_date(row[0])
            if d is None:
                errors.append({"row": offset, "column": "FECHA", "message": "Fecha inválida."})
                continue
            if not key.contains(d):
                errors.append(
                    {
                        "row": offset,
                        "column": "FECHA",
                        "message": f"{d:%d/%m/%Y} no pertenece a {key.label}.",
                    }
                )
                continue
            cedula = normalize_cedula(row[1])
            if not cedula:
                errors.append({"row": offset, "column": "CEDULA", "message": "Cédula vacía."})
                continue
            collaborator = ImportService._collaborator_for(
                acc, cedula, by_cedula, errors, offset, "CEDULA"
            )
            if collaborator is None:
                continue
            if collaborator.status != Collaborator.Status.ACTIVE:
                errors.append(
                    {
                        "row": offset,
                        "column": "CEDULA",
                        "message": f"{collaborator.full_name} está {collaborator.get_status_display().lower()}.",
                    }
                )
                continue
            if (cedula, d) in seen:
                errors.append(
                    {
                        "row": offset,
                        "column": "FECHA",
                        "message": f"Registro duplicado en el archivo ({cedula}, {d:%d/%m/%Y}).",
                    }
                )
                continue
            seen.add((cedula, d))
            try:
                overtime = parse_hours(row[6], field_label="# HORAS EXTRAS") or Decimal("0")
                saturday = parse_hours(row[7], field_label="# HORAS SABADO") or Decimal("0")
            except NovedadesError as exc:
                errors.append({"row": offset, "column": "HORAS", "message": exc.message})
                continue
            if overtime + saturday <= 0:
                errors.append(
                    {"row": offset, "column": "# HORAS EXTRAS", "message": "Sin horas registradas."}
                )
                continue
            flags = {}
            bad_flag = False
            for col, name in ((8, "is_saturday"), (9, "is_sunday"), (10, "is_holiday")):
                value = _bool(row[col])
                if value is None:
                    errors.append(
                        {
                            "row": offset,
                            "column": OVERTIME_HEADERS[col],
                            "message": "Use SI o NO (o deje vacío).",
                        }
                    )
                    bad_flag = True
                flags[name] = value
            if bad_flag:
                continue
            current = existing.get((collaborator.pk, d))
            parsed.append(
                {
                    "row": offset,
                    "collaborator_id": collaborator.pk,
                    "supervisor_id": collaborator.current_supervisor_id,
                    "cedula": cedula,
                    "name": collaborator.full_name,
                    "date": d.isoformat(),
                    "overtime_hours": _fmt(overtime),
                    "saturday_hours": _fmt(saturday),
                    **flags,
                    "work_done": str(row[11] or "").strip()[:500],
                    "observations": str(row[12] or "").strip()[:1000],
                    "existing": current is not None,
                    "existing_id": current.pk if current else None,
                }
            )
        return parsed, errors

    @staticmethod
    def confirm(acc: NovedadesAccess, batch_id, strategy: str, *, context=None) -> ImportBatch:
        ImportService._check(acc)
        batch = (
            ImportBatch.objects.select_related("period")
            .filter(pk=batch_id, uploaded_by=acc.user)
            .first()
        )
        if batch is None:
            raise NovedadesError("Importación no encontrada.", code="not_found", status=404)
        if batch.status == ImportBatch.Status.CONFIRMED:
            return batch  # idempotente
        if batch.status == ImportBatch.Status.CANCELLED:
            raise NovedadesError("La importación fue cancelada.", code="cancelled", status=409)
        if strategy not in ("skip", "update"):
            raise NovedadesError(
                "Estrategia inválida: use 'skip' (omitir existentes) o 'update' (actualizar)."
            )
        key = batch.period.key
        items = [i for i in batch.rows if strategy == "update" or not i.get("existing")]
        open_ids = ImportService._open_supervisor_ids(key, {i["supervisor_id"] for i in items})
        closed = [i for i in items if i["supervisor_id"] not in open_ids]
        if closed:
            raise NovedadesError(
                f"{key.label} está cerrado para alguno de los supervisores del archivo; no se importó nada.",
                code="period_closed",
                status=409,
            )
        applied = skipped = 0
        from django.contrib.auth import get_user_model

        users = {u.pk: u for u in get_user_model().objects.filter(pk__in=open_ids)}
        with transaction.atomic():
            if batch.kind == ImportBatch.Kind.WORKED_DAYS:
                by_supervisor: dict[int, list] = {}
                for item in items:
                    by_supervisor.setdefault(item["supervisor_id"], []).append(
                        {
                            "collaborator_id": item["collaborator_id"],
                            "date": date.fromisoformat(item["date"]),
                            "hours": item["hours"],
                        }
                    )
                for sid, cells in by_supervisor.items():
                    result = WorkedDayService.save_cells(
                        acc,
                        key,
                        users[sid],
                        cells,
                        source_file=batch.file_name,
                        context=context,
                        notify=False,
                    )
                    applied += result["saved"]
            else:
                for item in items:
                    data = {
                        "collaborator_id": item["collaborator_id"],
                        "date": date.fromisoformat(item["date"]),
                        "overtime_hours": item["overtime_hours"],
                        "saturday_hours": item["saturday_hours"],
                        "is_saturday": item["is_saturday"],
                        "is_sunday": item["is_sunday"],
                        "is_holiday": item["is_holiday"],
                        "work_done": item["work_done"],
                        "observations": item["observations"],
                    }
                    current = OvertimeRecord.objects.filter(
                        collaborator_id=item["collaborator_id"],
                        date=data["date"],
                        deleted_at__isnull=True,
                    ).first()
                    if current is None:
                        OvertimeService.create(
                            acc, data, source_file=batch.file_name, context=context, notify=False
                        )
                        applied += 1
                    elif strategy == "update":
                        OvertimeService.update(
                            acc,
                            current.pk,
                            data,
                            source_file=batch.file_name,
                            context=context,
                            notify=False,
                        )
                        applied += 1
                    else:
                        skipped += 1
            skipped += len(batch.rows) - len(items)
            batch.status = ImportBatch.Status.CONFIRMED
            batch.strategy = strategy
            batch.summary = {**batch.summary, "applied": applied, "skipped": skipped}
            batch.save(update_fields=["status", "strategy", "summary", "updated_at"])
            EventService.log(
                actor=acc.user,
                action="import.confirmed",
                period=batch.period,
                supervisor=acc.user if acc.is_supervisor else None,
                target_type="import",
                target_id=batch.pk,
                target_label=batch.file_name,
                new_value=f"{applied} aplicados, {skipped} omitidos, {len(batch.errors)} errores",
                source_file=batch.file_name,
                context=context,
            )
            NotificationService.notify_admins(
                f"Importación de {batch.get_kind_display()}: {user_display(acc.user)} importó "
                f"'{batch.file_name}' en {key.label} — {applied} aplicados, {skipped} omitidos, "
                f"{len(batch.errors)} con error.",
                exclude_user=acc.user,
            )
        return batch

    @staticmethod
    def cancel(acc: NovedadesAccess, batch_id) -> None:
        ImportBatch.objects.filter(
            pk=batch_id, uploaded_by=acc.user, status=ImportBatch.Status.PREVIEW
        ).update(status=ImportBatch.Status.CANCELLED)
