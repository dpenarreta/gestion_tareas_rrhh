"""Centro de Configuración — Fases 13/28/29/31/32/33/34/35 de la
migración de stack (ver docs/AUDIT_LOG.md §
2026-08-19/2026-08-20/2026-08-21). Primera superficie HTTP de
`apps.configuration` (hasta ahora 100% módulo de servicios internos,
consumido en proceso por el resto del backend): la Fase 13 portó
`prediction-window` (deferido de la Fase 9c); la Fase 28 agregó 6
endpoints más de bajo riesgo (backing ya existente o trivial); la
Fase 29 agregó CRUD completo de `Holiday`/`LeaveRecord`/`SpecialStatus`;
la Fase 30 cerró `activity-reasons` (en `apps.tasks`, dueña del
modelo); la Fase 31 agregó `workload-config`/`kpi-start-date`/
`retention-policy`/`escritorio-digital-config`/`analytics-config`; la
Fase 32 agregó `normalization-curves`/`seguridad-config`/
`system-info`/`trabajo-avanzado`; la Fase 33 agregó `config-history`/
`config-history/restore-default`/`documentation`; la Fase 34 agregó
`nova-cache`/`data-quality`; la Fase 35 agrega `notification-rules`
— SOLO la superficie de configuración (ver GAP DOCUMENTADO en
`apps.configuration.services.CONFIG_KEY_NOTIFICATION_RULES`): los
consumidores reales (`CommentService.create_comment`/
`RETROACTIVE_NOTIFY_ROLES`, `apps/tasks/services.py`) siguen sin
conectarse a esta configuración. La Fase 83 (ver docs/AUDIT_LOG.md §
2026-08-27) agrega `RetentionPolicyPurgeView` — con esto, el catálogo
`settings/*` queda cerrado por completo."""

import os
from datetime import date, datetime, timedelta
from datetime import timezone as dt_timezone
from pathlib import Path

from django.conf import settings as django_settings
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import generics
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.analytics.normalization import (
    DEFAULT_CURVES,
    CurveName,
    get_all_effective_curves,
    is_valid_curve,
    set_curve_config,
)
from apps.analytics.prediction import PREDICTION_MAX_DAYS
from apps.core.rounding import round_half_up
from apps.hierarchy.services import ALL_ROLES, ROLE_LABEL, ROLE_LEVEL
from apps.ideas.models import ImprovementIdea
from apps.meetings.models import Meeting
from apps.tasks.business_time import business_calendar_day
from apps.tasks.models import Task
from apps.users.models import User

from .data_quality import build_data_quality_report
from .models import Holiday, LeaveRecord, SpecialStatus, SystemConfigHistory
from .serializers import (
    ConsentTextUpdateSerializer,
    EscritorioDigitalConfigUpdateSerializer,
    FavoriteUpdateSerializer,
    HolidayCreateSerializer,
    KpiStartDateUpdateSerializer,
    LeaveRecordCreateSerializer,
    NovaCacheUpdateSerializer,
    PredictionWindowUpdateSerializer,
    RetentionPolicyUpdateSerializer,
    RoleCompatibilityUpdateSerializer,
    RoleTargetUpdateSerializer,
    SeguridadConfigUpdateSerializer,
    SpecialStatusCreateSerializer,
    TrabajoAvanzadoUpdateSerializer,
    WelcomeMessageUpdateSerializer,
)
from .services import (
    ANALYTICS_CONFIG_DEFAULTS,
    CONFIG_KEY_CONSENT_TEXT,
    CONFIG_KEY_NOVA_CACHE_TTL_MINUTES,
    CONFIG_KEY_PASSWORD_MIN_LENGTH,
    CONFIG_KEY_PREDICTION_WINDOW_WEEKS,
    CONFIG_KEY_RETENTION_LOGIN_ATTEMPTS,
    CONFIG_KEY_RETROACTIVE_WINDOW_DAYS,
    CONFIG_KEY_SESSION_DURATION_DEFAULT_HOURS,
    CONFIG_KEY_SESSION_DURATION_REMEMBER_HOURS,
    CONFIG_KEY_WELCOME_MESSAGE,
    CONFIG_KEY_WELCOME_MESSAGE_ACTIVE,
    CONFIG_KEY_WORKDAY_END_HOUR,
    PREDICTION_WINDOW_OPTIONS,
    execute_purge,
    find_purge_candidates,
    get_all_effective_role_compatibility,
    get_all_effective_role_targets,
    get_effective_analytics_config,
    get_effective_consent_text,
    get_effective_desk_archive_retention_days,
    get_effective_desk_note_max_replies,
    get_effective_horas_efectivas,
    get_effective_notification_rules,
    get_effective_nova_cache_ttl_minutes,
    get_effective_password_min_length,
    get_effective_prediction_window_weeks,
    get_effective_retention_login_attempts,
    get_effective_retention_policy,
    get_effective_retroactive_window_days,
    get_effective_session_duration_default_hours,
    get_effective_session_duration_remember_hours,
    get_effective_snooze_presets_minutes,
    get_effective_welcome_message,
    get_effective_welcome_message_active,
    get_effective_workday_end_hour,
    get_effective_workload_limit_high,
    get_effective_workload_limit_low,
    get_effective_workload_limit_overload,
    get_holiday_set,
    is_working_day,
    set_analytics_config_value,
    set_config_value,
    set_desk_archive_retention_days,
    set_desk_note_max_replies,
    set_notification_rules,
    set_role_compatibility,
    set_role_target,
    set_snooze_presets_minutes,
    validate_notification_rules_body,
)

_CAN_MANAGE_USERS = {"ADMINISTRADOR", "JEFE_NACIONAL", "COORDINADOR_NACIONAL"}
_CONFIG_FAVORITE_PREFIX = "CONFIG_FAVORITE:"

# Aproximación honesta de "fecha de último deploy" — igual criterio
# que el comentario original del TS (`SERVER_STARTED_AT`): no hay
# timestamp de deploy expuesto por la plataforma en runtime, así que
# se usa el momento en que este módulo se cargó en frío.
_SERVER_STARTED_AT = timezone.now().isoformat()


def _display_name(user: User) -> str:
    return user.first_name or user.username


def _first_error(errors: dict) -> str:
    """Aplana el diccionario de errores de un serializer al primer
    mensaje — los `route.ts` de `leave-records`/`special-status`
    devuelven un único `{ error: string }`, nunca una estructura
    anidada por campo."""
    for value in errors.values():
        if isinstance(value, list) and value:
            return str(value[0])
        if isinstance(value, dict):
            nested = _first_error(value)
            if nested:
                return nested
    return "Datos inválidos"


def _role_name(user) -> str:
    """`is_superuser` siempre resuelve a ADMINISTRADOR — mismo criterio
    que `apps.desk.permissions.role_name` y equivalentes en
    reports/meetings/ideas/data_requests."""
    if user.is_superuser:
        return "ADMINISTRADOR"
    group = user.groups.first()
    return group.name if group else ""


def _is_true_superuser(user) -> bool:
    """Gate deliberadamente MÁS estrecho que `_role_name(user) ==
    "ADMINISTRADOR"` (que también es verdadero para un usuario en el
    grupo ADMINISTRADOR sin `is_superuser=True`, estado real alcanzable
    — ver docs/DECISIONS.md § 2026-09-01). Usado solo en los 4 endpoints
    de `LeaveRecord`/`SpecialStatus` (datos de salud, Art. 26 LOPDP) para
    que coincida exactamente con el gate ya usado por
    `redact_sensitive_workload_detail` (`apps/analytics/workload.py`) —
    antes de este cambio, un ADMINISTRADOR-solo-por-grupo veía la lista
    cruda acá pero la versión redactada en KPIs (hallazgo de la auditoría
    de datos personales, ver docs/AUDIT_LOG.md § 2026-09-02)."""
    return user.is_superuser


def _can_manage_users(user) -> bool:
    """Réplica exacta de `canManageUsers`/`CAN_MANAGE_USERS`
    (`src/lib/roles.ts`) — mismo whitelist de 3 roles ya usado como
    patrón en `apps.announcements.permissions.CAN_POST_OR_DELETE`."""
    return _role_name(user) in _CAN_MANAGE_USERS


class PredictionWindowSettingsView(generics.GenericAPIView):
    """`GET/PUT /api/v1/settings/prediction-window/` — réplica exacta
    de `route.ts` (`src/app/api/settings/prediction-window/route.ts`).
    `GET` no requiere rol especial; `PUT` solo ADMINISTRADOR. Gap
    documentado: el TS invalida la caché de Analytics
    (`invalidateAnalyticsCache()`) tras escribir — esa capa de caché
    con TTL no está portada en Django (mismo gap ya aceptado desde la
    Fase 9a: los bundles de Analytics/Inteligencia Preventiva se
    calculan en vivo en cada request), así que no hay nada que
    invalidar acá."""

    permission_classes = [IsAuthenticated]
    serializer_class = PredictionWindowUpdateSerializer

    def get(self, request):
        window_weeks = get_effective_prediction_window_weeks(timezone.now())
        return Response({"window_weeks": window_weeks, "options": list(PREDICTION_WINDOW_OPTIONS)})

    def put(self, request):
        if _role_name(request.user) != "ADMINISTRADOR":
            return Response({"error": "Sin permisos"}, status=403)

        serializer = self.get_serializer(data=request.data)
        if not serializer.is_valid():
            return Response({"error": "Ventana histórica inválida"}, status=400)

        set_config_value(
            CONFIG_KEY_PREDICTION_WINDOW_WEEKS,
            serializer.validated_data["window_weeks"],
            request.user,
        )
        window_weeks = get_effective_prediction_window_weeks(timezone.now())
        return Response({"window_weeks": window_weeks, "options": list(PREDICTION_WINDOW_OPTIONS)})


class RetroactiveWindowView(generics.GenericAPIView):
    """`GET /api/v1/settings/retroactive-window/` — Fase 28 (ver
    docs/AUDIT_LOG.md § 2026-08-20), réplica exacta de `route.ts`:
    cualquier autenticado (no solo Administrador) — el modal de
    registro retroactivo lo usa cualquier rol."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        return Response({"days": get_effective_retroactive_window_days(timezone.now())})


class SnoozePresetsView(generics.GenericAPIView):
    """`GET /api/v1/settings/snooze-presets/` — Fase 28, réplica exacta
    de `route.ts`: cualquier autenticado (Escritorio Digital lo usa
    cualquier rol no-Administrador)."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        return Response({"minutes": get_effective_snooze_presets_minutes(timezone.now())})


class FavoritesView(generics.GenericAPIView):
    """`GET/PATCH /api/v1/settings/favorites/` — Fase 28, réplica
    exacta de `route.ts`: favoritos del Centro de Configuración,
    reutilizando `User.view_preferences` con el prefijo
    `CONFIG_FAVORITE:` — mismo truco ya usado por `PATCH
    /dashboard/card-order/` (Fase 25), un elemento del array por
    favorito (no un valor único unido con comas, porque los favoritos
    son un conjunto, no un orden)."""

    permission_classes = [IsAuthenticated]
    serializer_class = FavoriteUpdateSerializer

    def get(self, request):
        favorites = [
            v[len(_CONFIG_FAVORITE_PREFIX) :]
            for v in request.user.view_preferences
            if v.startswith(_CONFIG_FAVORITE_PREFIX)
        ]
        return Response({"favorites": favorites})

    def patch(self, request):
        serializer = self.get_serializer(data=request.data)
        if not serializer.is_valid():
            return Response({"error": "setting_id y pinned son requeridos"}, status=400)

        setting_id = serializer.validated_data["setting_id"]
        pinned = serializer.validated_data["pinned"]
        entry = f"{_CONFIG_FAVORITE_PREFIX}{setting_id}"
        without_entry = [v for v in request.user.view_preferences if v != entry]
        updated = [*without_entry, entry] if pinned else without_entry

        request.user.view_preferences = updated
        request.user.save(update_fields=["view_preferences"])
        return Response({"ok": True})


class WelcomeMessageView(generics.GenericAPIView):
    """`GET/PUT /api/v1/settings/welcome-message/` — Fase 28, réplica
    exacta de `route.ts`. `GET` no requiere rol especial; `PUT` solo
    ADMINISTRADOR."""

    permission_classes = [IsAuthenticated]
    serializer_class = WelcomeMessageUpdateSerializer

    def get(self, request):
        now = timezone.now()
        return Response(
            {
                "message": get_effective_welcome_message(now),
                "active": get_effective_welcome_message_active(now),
            }
        )

    def put(self, request):
        if _role_name(request.user) != "ADMINISTRADOR":
            return Response({"error": "Sin permisos"}, status=403)

        serializer = self.get_serializer(data=request.data)
        if not serializer.is_valid():
            return Response({"error": "Datos inválidos"}, status=400)

        message = serializer.validated_data["message"].strip()
        active = serializer.validated_data["active"]
        set_config_value(CONFIG_KEY_WELCOME_MESSAGE, message, request.user)
        set_config_value(CONFIG_KEY_WELCOME_MESSAGE_ACTIVE, str(active).lower(), request.user)
        return Response({"message": message, "active": active})


class ConsentTextView(generics.GenericAPIView):
    """`GET/PUT /api/v1/settings/consent-text/` — pedido explícito del
    usuario (ver docs/AUDIT_LOG.md § 2026-09-02, "Consentimiento de datos
    editable desde Ajustes"). `GET` sin rol especial (`ConsentGate.tsx` lo
    necesita para CUALQUIER usuario, no solo Administrador — es el aviso
    que se le muestra antes de dejarlo entrar); `PUT` solo ADMINISTRADOR,
    mismo criterio que `WelcomeMessageView`."""

    permission_classes = [IsAuthenticated]
    serializer_class = ConsentTextUpdateSerializer

    def get(self, request):
        return Response({"text": get_effective_consent_text(timezone.now())})

    def put(self, request):
        if _role_name(request.user) != "ADMINISTRADOR":
            return Response({"error": "Sin permisos"}, status=403)

        serializer = self.get_serializer(data=request.data)
        if not serializer.is_valid():
            return Response({"error": "Datos inválidos"}, status=400)

        text = serializer.validated_data["text"].strip()
        if not text:
            return Response({"error": "El texto no puede quedar vacío"}, status=400)
        set_config_value(CONFIG_KEY_CONSENT_TEXT, text, request.user)
        return Response({"text": text})


class RoleTargetsView(generics.GenericAPIView):
    """`GET/PATCH /api/v1/settings/role-targets/` — Fase 28, réplica
    exacta de `route.ts`. `GET` no requiere rol especial; `PATCH`
    requiere `can_manage_users` (mismo whitelist que gestión de
    usuarios, no un permiso del catálogo administrativo — así lo hace
    el TS). Gap documentado (mismo criterio que `prediction-window`):
    el TS invalida la caché de Analytics tras escribir — sin capa de
    caché con TTL en Django, no hay nada que invalidar."""

    permission_classes = [IsAuthenticated]
    serializer_class = RoleTargetUpdateSerializer

    def get(self, request):
        now = timezone.now()
        targets = get_all_effective_role_targets(ALL_ROLES, now)
        return Response({"targets": targets, "roles": ALL_ROLES, "role_labels": ROLE_LABEL})

    def patch(self, request):
        if not _can_manage_users(request.user):
            return Response({"error": "Sin permisos"}, status=403)

        serializer = self.get_serializer(data=request.data)
        if not serializer.is_valid():
            return Response(
                {"error": "Objetivo inválido: cada campo debe ser un número entre 0 y 100, o null"},
                status=400,
            )

        role = serializer.validated_data["role"]
        target = serializer.validated_data["target"]
        set_role_target(role, target, request.user)

        targets = get_all_effective_role_targets(ALL_ROLES, timezone.now())
        return Response({"targets": targets})


class RoleCompatibilityView(generics.GenericAPIView):
    """`GET/PATCH /api/v1/settings/role-compatibility/` — Fase 28,
    réplica exacta de `route.ts`. `GET` no requiere rol especial;
    `PATCH` requiere `can_manage_users`. Regla 4 (dura, defensa en
    profundidad): nunca configurable entre niveles jerárquicos
    distintos — se rechaza acá ADEMÁS del filtro absoluto en
    `apps.analytics.recommendations.compute_team_recommendations`."""

    permission_classes = [IsAuthenticated]
    serializer_class = RoleCompatibilityUpdateSerializer

    def get(self, request):
        now = timezone.now()
        matrix = get_all_effective_role_compatibility(ALL_ROLES, now)
        return Response(
            {
                "matrix": matrix,
                "roles": ALL_ROLES,
                "role_labels": ROLE_LABEL,
                "role_levels": ROLE_LEVEL,
            }
        )

    def patch(self, request):
        if not _can_manage_users(request.user):
            return Response({"error": "Sin permisos"}, status=403)

        serializer = self.get_serializer(data=request.data)
        if not serializer.is_valid():
            return Response(
                {"error": "compatible_roles debe ser una lista de cargos válidos"}, status=400
            )

        role = serializer.validated_data["role"]
        compatible_roles = serializer.validated_data["compatible_roles"]

        invalid_level = next(
            (r for r in compatible_roles if ROLE_LEVEL[r] != ROLE_LEVEL[role]), None
        )
        if invalid_level:
            return Response(
                {
                    "error": (
                        f'"{ROLE_LABEL[invalid_level]}" no es del mismo nivel jerárquico que '
                        f'"{ROLE_LABEL[role]}" — la redistribución entre niveles distintos nunca está permitida.'
                    )
                },
                status=400,
            )

        cleaned = [r for r in compatible_roles if r != role]
        set_role_compatibility(role, cleaned, request.user)

        matrix = get_all_effective_role_compatibility(ALL_ROLES, timezone.now())
        return Response({"matrix": matrix})


def _serialize_holiday(h: Holiday) -> dict:
    return {"id": h.id, "date": h.date.isoformat(), "name": h.name, "year": h.year}


class HolidayListView(generics.GenericAPIView):
    """`GET/POST /api/v1/settings/holidays/` — Fase 29 (ver
    docs/AUDIT_LOG.md § 2026-08-20). `GET` NO requiere ADMINISTRADOR —
    corregido en la Fase 52 (ver docs/AUDIT_LOG.md § 2026-08-24): el
    docstring original afirmaba "ambos verbos requieren ADMINISTRADOR,
    igual que el TS", pero el `route.ts` real nunca restringió `GET`
    (cualquier autenticado puede consultar el calendario de feriados,
    mismo criterio que `retroactive-window`/`snooze-presets`) — se
    detectó al investigar el cutover del `route.ts`. `POST` sigue
    exclusivo de ADMINISTRADOR."""

    permission_classes = [IsAuthenticated]
    serializer_class = HolidayCreateSerializer

    def get(self, request):
        year = request.query_params.get("year")
        queryset = Holiday.objects.all()
        if year:
            queryset = queryset.filter(year=year)
        return Response([_serialize_holiday(h) for h in queryset.order_by("date")])

    def post(self, request):
        if _role_name(request.user) != "ADMINISTRADOR":
            return Response({"error": "Sin permisos"}, status=403)

        serializer = self.get_serializer(data=request.data)
        if not serializer.is_valid():
            return Response({"error": "Faltan campos requeridos"}, status=400)

        date = serializer.validated_data["date"]
        if Holiday.objects.filter(date=date).exists():
            return Response({"error": "Ya existe un feriado registrado en esa fecha"}, status=409)

        holiday = Holiday.objects.create(
            date=date, name=serializer.validated_data["name"].strip(), year=date.year
        )
        return Response(_serialize_holiday(holiday), status=201)


class HolidayDetailView(generics.GenericAPIView):
    """`DELETE /api/v1/settings/holidays/<id>/` — Fase 29, réplica
    exacta de `route.ts`."""

    permission_classes = [IsAuthenticated]

    def delete(self, request, pk: int):
        if _role_name(request.user) != "ADMINISTRADOR":
            return Response({"error": "Sin permisos"}, status=403)

        holiday = get_object_or_404(Holiday, pk=pk)
        holiday.delete()
        return Response({"ok": True})


def _serialize_leave_record(r: LeaveRecord) -> dict:
    return {
        "id": r.id,
        "userId": r.user_id,
        "user": {"id": r.user_id, "name": _display_name(r.user)},
        "type": r.type,
        "date": r.date.isoformat(),
        "isFullDay": r.is_full_day,
        "durationMinutes": r.duration_minutes,
        "observation": r.observation,
    }


class LeaveRecordListView(generics.GenericAPIView):
    """`GET/POST /api/v1/settings/leave-records/` — Fase 29, réplica
    exacta de `route.ts`: `POST` crea UN registro por cada día laborable
    (lunes-viernes, sin feriado) dentro de `[start_date, end_date]` —
    nunca uno solo por todo el rango."""

    permission_classes = [IsAuthenticated]
    serializer_class = LeaveRecordCreateSerializer

    def get(self, request):
        if not _is_true_superuser(request.user):
            return Response({"error": "Sin permisos"}, status=403)

        queryset = LeaveRecord.objects.select_related("user")
        user_id = request.query_params.get("user_id")
        if user_id:
            queryset = queryset.filter(user_id=user_id)
        month = request.query_params.get("month")
        if month and len(month) == 7 and month[4] == "-":
            try:
                year, mm = int(month[:4]), int(month[5:7])
                month_start = date(year, mm, 1)
                month_end = (
                    date(year + 1, 1, 1) if mm == 12 else date(year, mm + 1, 1)
                ) - timedelta(days=1)
                queryset = queryset.filter(date__gte=month_start, date__lte=month_end)
            except ValueError:
                pass

        return Response([_serialize_leave_record(r) for r in queryset.order_by("-date")])

    def post(self, request):
        if not _is_true_superuser(request.user):
            return Response({"error": "Sin permisos"}, status=403)

        serializer = self.get_serializer(data=request.data)
        if not serializer.is_valid():
            return Response({"error": _first_error(serializer.errors)}, status=400)

        data = serializer.validated_data
        user = User.objects.filter(pk=data["user_id"]).first()
        if user is None:
            return Response({"error": "Usuario no encontrado"}, status=404)

        holidays = get_holiday_set()
        business_days = []
        current = data["start_date"]
        while current <= data["end_date"]:
            if is_working_day(current, holidays):
                business_days.append(current)
            current += timedelta(days=1)
        if not business_days:
            return Response(
                {"error": "El rango seleccionado no incluye días laborables"}, status=400
            )

        trimmed_observation = (data.get("observation") or "").strip() or None
        records = [
            LeaveRecord.objects.create(
                user=user,
                type=data["type"],
                date=day,
                is_full_day=data["is_full_day"],
                duration_minutes=None if data["is_full_day"] else data.get("duration_minutes"),
                observation=trimmed_observation,
                created_by=request.user,
            )
            for day in business_days
        ]
        return Response(
            {
                "records": [_serialize_leave_record(r) for r in records],
                "businessDaysCount": len(business_days),
            },
            status=201,
        )


class LeaveRecordDetailView(generics.GenericAPIView):
    """`DELETE /api/v1/settings/leave-records/<id>/` — Fase 29, réplica
    exacta de `route.ts`."""

    permission_classes = [IsAuthenticated]

    def delete(self, request, pk: int):
        if not _is_true_superuser(request.user):
            return Response({"error": "Sin permisos"}, status=403)

        record = get_object_or_404(LeaveRecord, pk=pk)
        record.delete()
        return Response({"ok": True})


def _serialize_special_status(s: SpecialStatus) -> dict:
    return {
        "id": s.id,
        "userId": s.user_id,
        "user": {"id": s.user_id, "name": _display_name(s.user)},
        "type": s.type,
        "startDate": s.start_date.isoformat(),
        "endDate": s.end_date.isoformat() if s.end_date else None,
        "isActive": s.is_active,
        "dailyHours": s.daily_hours,
        "limitLow": s.limit_low,
        "limitBase": s.limit_base,
        "limitHigh": s.limit_high,
        "limitOverload": s.limit_overload,
    }


class SpecialStatusListView(generics.GenericAPIView):
    """`GET/POST /api/v1/settings/special-status/` — Fase 29, réplica
    exacta de `route.ts`."""

    permission_classes = [IsAuthenticated]
    serializer_class = SpecialStatusCreateSerializer

    def get(self, request):
        if not _is_true_superuser(request.user):
            return Response({"error": "Sin permisos"}, status=403)

        queryset = SpecialStatus.objects.select_related("user")
        user_id = request.query_params.get("user_id")
        if user_id:
            queryset = queryset.filter(user_id=user_id)
        return Response([_serialize_special_status(s) for s in queryset.order_by("-start_date")])

    def post(self, request):
        if not _is_true_superuser(request.user):
            return Response({"error": "Sin permisos"}, status=403)

        serializer = self.get_serializer(data=request.data)
        if not serializer.is_valid():
            return Response({"error": _first_error(serializer.errors)}, status=400)

        data = serializer.validated_data
        user = User.objects.filter(pk=data["user_id"]).first()
        if user is None:
            return Response({"error": "Usuario no encontrado"}, status=404)

        record = SpecialStatus.objects.create(
            user=user,
            type=data["type"],
            start_date=data["start_date"],
            end_date=data.get("end_date"),
            daily_hours=data["daily_hours"],
            limit_low=data["limit_low"],
            limit_base=data["limit_base"],
            limit_high=data["limit_high"],
            limit_overload=data["limit_overload"],
            created_by=request.user,
        )
        return Response(_serialize_special_status(record), status=201)


class SpecialStatusDetailView(generics.GenericAPIView):
    """`PATCH/DELETE /api/v1/settings/special-status/<id>/` — Fase 29,
    réplica exacta de `route.ts`. `PATCH` finaliza el estado especial
    hoy (o antes, si su fecha fin ya estaba en el pasado) — nunca lo
    extiende."""

    permission_classes = [IsAuthenticated]

    def patch(self, request, pk: int):
        if not _is_true_superuser(request.user):
            return Response({"error": "Sin permisos"}, status=403)

        record = get_object_or_404(SpecialStatus, pk=pk)
        today = business_calendar_day(timezone.now())
        end_date = today if record.end_date is None or record.end_date > today else record.end_date

        record.is_active = False
        record.end_date = end_date
        record.save(update_fields=["is_active", "end_date"])
        return Response(_serialize_special_status(record))

    def delete(self, request, pk: int):
        if not _is_true_superuser(request.user):
            return Response({"error": "Sin permisos"}, status=403)

        record = get_object_or_404(SpecialStatus, pk=pk)
        record.delete()
        return Response({"ok": True})


_WORKLOAD_CONFIG_FIELDS = {
    "hours_per_day": (
        get_effective_horas_efectivas,
        "HORAS_EFECTIVAS_DIA",
        4,
        8,
        "Las horas efectivas",
    ),
    "workload_limit_low": (
        get_effective_workload_limit_low,
        "workload_limit_low",
        0,
        24,
        "El límite de Subutilización",
    ),
    "workload_limit_high": (
        get_effective_workload_limit_high,
        "workload_limit_high",
        0,
        24,
        "El límite superior óptimo",
    ),
    "workload_limit_overload": (
        get_effective_workload_limit_overload,
        "workload_limit_overload",
        0,
        24,
        "El límite de Sobrecarga",
    ),
}


def _effective_workload_config(now) -> dict[str, float]:
    return {
        name: getter(now)
        for name, (getter, _key, _min, _max, _label) in _WORKLOAD_CONFIG_FIELDS.items()
    }


class WorkloadConfigView(generics.GenericAPIView):
    """`GET/PUT /api/v1/settings/workload-config/` — Fase 31 (ver
    docs/AUDIT_LOG.md § 2026-08-21), réplica exacta de `route.ts`.
    `GET` no requiere rol especial; `PUT` solo ADMINISTRADOR. Validado
    manualmente (no con un `Serializer`) porque el orden válido de los
    4 límites depende de los valores YA vigentes para los campos que
    esta llamada no toca — lógica que necesita los valores efectivos
    ANTES de validar, fuera del alcance natural de un `Serializer`."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        return Response(_effective_workload_config(timezone.now()))

    def put(self, request):
        if _role_name(request.user) != "ADMINISTRADOR":
            return Response({"error": "Sin permisos"}, status=403)

        provided = {
            name: request.data[name] for name in _WORKLOAD_CONFIG_FIELDS if name in request.data
        }
        if not provided:
            return Response({"error": "Nada que guardar"}, status=400)

        for name, value in provided.items():
            _getter, _key, min_value, max_value, label = _WORKLOAD_CONFIG_FIELDS[name]
            if (
                not isinstance(value, (int, float))
                or isinstance(value, bool)
                or not (min_value <= value <= max_value)
            ):
                return Response(
                    {"error": f"{label} debe ser un número entre {min_value} y {max_value} horas"},
                    status=400,
                )

        current = _effective_workload_config(timezone.now())
        merged = {**current, **provided}
        if not (
            merged["workload_limit_low"]
            < merged["hours_per_day"]
            <= merged["workload_limit_high"]
            < merged["workload_limit_overload"]
        ):
            return Response(
                {
                    "error": (
                        f"Los límites deben mantener el orden: Subutilización ({merged['workload_limit_low']}) < "
                        f"Horas efectivas ({merged['hours_per_day']}) <= Límite óptimo ({merged['workload_limit_high']}) "
                        f"< Sobrecarga ({merged['workload_limit_overload']})"
                    )
                },
                status=400,
            )

        for name, value in provided.items():
            _getter, key, _min, _max, _label = _WORKLOAD_CONFIG_FIELDS[name]
            set_config_value(key, str(value), request.user)

        return Response(_effective_workload_config(timezone.now()))


def _serialize_kpi_start_date_user(user: User) -> dict:
    return {
        "id": user.id,
        "name": _display_name(user),
        "email": user.email,
        "role": _role_name(user),
        "kpi_start_date": user.kpi_start_date.date().isoformat() if user.kpi_start_date else None,
    }


class KpiStartDateView(generics.GenericAPIView):
    """`GET/PATCH /api/v1/settings/kpi-start-date/` — Fase 31, réplica
    exacta de `route.ts`. Ambos verbos requieren ADMINISTRADOR."""

    permission_classes = [IsAuthenticated]
    serializer_class = KpiStartDateUpdateSerializer

    def get(self, request):
        if _role_name(request.user) != "ADMINISTRADOR":
            return Response({"error": "Sin permisos"}, status=403)

        users = User.objects.all().prefetch_related("groups").order_by("first_name", "username")
        return Response([_serialize_kpi_start_date_user(u) for u in users])

    def patch(self, request):
        if _role_name(request.user) != "ADMINISTRADOR":
            return Response({"error": "Sin permisos"}, status=403)

        serializer = self.get_serializer(data=request.data)
        if not serializer.is_valid():
            return Response({"error": _first_error(serializer.errors)}, status=400)

        target = User.objects.filter(pk=serializer.validated_data["user_id"]).first()
        if target is None:
            return Response({"error": "Usuario no encontrado"}, status=404)

        kpi_start_date = serializer.validated_data.get("kpi_start_date")
        target.kpi_start_date = (
            datetime(
                kpi_start_date.year,
                kpi_start_date.month,
                kpi_start_date.day,
                tzinfo=dt_timezone.utc,
            )
            if kpi_start_date
            else None
        )
        target.save(update_fields=["kpi_start_date"])
        return Response(_serialize_kpi_start_date_user(target))


class RetentionPolicyView(generics.GenericAPIView):
    """`GET/PUT /api/v1/settings/retention-policy/` — Fase 31, réplica
    exacta de `route.ts` (solo la política; la ejecución de la purga
    vive en `RetentionPolicyPurgeView`, agregada en la Fase 83). `GET`
    no requiere rol especial; `PUT` solo ADMINISTRADOR."""

    permission_classes = [IsAuthenticated]
    serializer_class = RetentionPolicyUpdateSerializer

    def get(self, request):
        return Response(get_effective_retention_policy(timezone.now()))

    def put(self, request):
        if _role_name(request.user) != "ADMINISTRADOR":
            return Response({"error": "Sin permisos"}, status=403)

        serializer = self.get_serializer(data=request.data)
        if not serializer.is_valid():
            return Response({"error": _first_error(serializer.errors)}, status=400)

        key_by_field = {
            "monthly_reports_months": "retention_monthly_reports",
            "archived_tasks_months": "retention_archived_tasks",
            "knowledge_docs_months": "retention_knowledge_docs",
        }
        for field, value in serializer.validated_data.items():
            set_config_value(key_by_field[field], value, request.user)

        return Response(get_effective_retention_policy(timezone.now()))


class RetentionPolicyPurgeView(generics.GenericAPIView):
    """`GET/POST /api/v1/settings/retention-policy/purge/` — Fase 83
    (ver docs/AUDIT_LOG.md § 2026-08-27), réplica de
    `retention-policy/purge/route.ts`. Ambos métodos (vista previa Y
    ejecución) exigen ADMINISTRADOR — a diferencia de `RetentionPolicyView`
    (donde solo `PUT` lo exige), acá ni la vista previa está abierta a
    otros roles, réplica exacta del `route.ts` original. La confirmación
    explícita (`{confirm: true}` en el body) la exige el propio
    `route.ts`, no esta vista — acá no hay noción de "confirmar", solo
    ejecutar."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        if _role_name(request.user) != "ADMINISTRADOR":
            return Response({"error": "Sin permisos"}, status=403)

        candidates = find_purge_candidates(timezone.now())
        return Response(
            {
                "policy": candidates["policy"],
                "reportsToDelete": len(candidates["report_ids"]),
                "tasksToDelete": len(candidates["task_ids"]),
                "docsToDelete": len(candidates["docs"]),
            }
        )

    def post(self, request):
        if _role_name(request.user) != "ADMINISTRADOR":
            return Response({"error": "Sin permisos"}, status=403)

        result = execute_purge(request.user)
        return Response(
            {
                "reportsDeleted": result["reports_deleted"],
                "tasksDeleted": result["tasks_deleted"],
                "docsDeleted": result["docs_deleted"],
                "deletedDocs": [
                    {"githubPath": d["github_path"], "githubSha": d["github_sha"]}
                    for d in result["deleted_docs"]
                ],
            }
        )


class EscritorioDigitalConfigView(generics.GenericAPIView):
    """`GET/PUT /api/v1/settings/escritorio-digital-config/` — Fase 31,
    réplica exacta de `route.ts`. `GET` no requiere rol especial;
    `PUT` solo ADMINISTRADOR."""

    permission_classes = [IsAuthenticated]
    serializer_class = EscritorioDigitalConfigUpdateSerializer

    def get(self, request):
        now = timezone.now()
        return Response(
            {
                "archive_retention_days": get_effective_desk_archive_retention_days(now),
                "max_replies": get_effective_desk_note_max_replies(now),
                "snooze_presets_minutes": get_effective_snooze_presets_minutes(now),
            }
        )

    def put(self, request):
        if _role_name(request.user) != "ADMINISTRADOR":
            return Response({"error": "Sin permisos"}, status=403)

        serializer = self.get_serializer(data=request.data)
        if not serializer.is_valid():
            return Response({"error": _first_error(serializer.errors)}, status=400)
        data = serializer.validated_data

        if "archive_retention_days" in data:
            set_desk_archive_retention_days(data["archive_retention_days"], request.user)
        if "max_replies" in data:
            set_desk_note_max_replies(data["max_replies"], request.user)
        if "snooze_presets_minutes" in data:
            set_snooze_presets_minutes(data["snooze_presets_minutes"], request.user)

        now = timezone.now()
        return Response(
            {
                "archive_retention_days": get_effective_desk_archive_retention_days(now),
                "max_replies": get_effective_desk_note_max_replies(now),
                "snooze_presets_minutes": get_effective_snooze_presets_minutes(now),
            }
        )


_ANALYTICS_CONFIG_VALIDATION: dict[str, tuple[float, float]] = {
    "health_weight_cumplimiento": (0, 100),
    "health_weight_carga": (0, 100),
    "health_weight_vencidas": (0, 100),
    "health_weight_consistencia": (0, 100),
    "health_weight_capacidad": (0, 100),
    "perf_weight_cumplimiento": (0, 100),
    "perf_weight_vencidas": (0, 100),
    "perf_weight_consistencia": (0, 100),
    "perf_weight_trazabilidad": (0, 100),
    "risk_weight_sobrecarga": (0, 100),
    "risk_weight_vencidas_criticas": (0, 100),
    "risk_weight_tendencia_negativa": (0, 100),
    "risk_weight_horas_extra": (0, 100),
    "risk_weight_baja_capacidad": (0, 100),
    "risk_weight_variabilidad": (0, 100),
    "risk_weight_concentracion": (0, 100),
    "risk_weight_sin_planificacion": (0, 100),
    "risk_threshold_medio": (1, 99),
    "risk_threshold_alto": (1, 99),
    "risk_threshold_critico": (1, 100),
    "alert_overdue_task_threshold": (1, 50),
    "alert_consecutive_overload_days": (1, 30),
    "anomaly_variation_threshold_pct": (5, 200),
    "cache_ttl_minutes": (1, 1440),
    "prediction_min_weeks_media": (1, 10),
    "prediction_min_weeks_alta": (1, 20),
}

_HEALTH_WEIGHT_KEYS = (
    "health_weight_cumplimiento",
    "health_weight_carga",
    "health_weight_vencidas",
    "health_weight_consistencia",
    "health_weight_capacidad",
)
_PERF_WEIGHT_KEYS = (
    "perf_weight_cumplimiento",
    "perf_weight_vencidas",
    "perf_weight_consistencia",
    "perf_weight_trazabilidad",
)
_RISK_WEIGHT_KEYS = (
    "risk_weight_sobrecarga",
    "risk_weight_vencidas_criticas",
    "risk_weight_tendencia_negativa",
    "risk_weight_horas_extra",
    "risk_weight_baja_capacidad",
    "risk_weight_variabilidad",
    "risk_weight_concentracion",
    "risk_weight_sin_planificacion",
)


def _weight_sum_error(body: dict, merged: dict, keys: tuple[str, ...], label: str):
    if not any(k in body for k in keys):
        return None
    total = sum(merged[k] for k in keys)
    if round_half_up(total) != 100:
        return f"Las ponderaciones de {label} deben sumar 100 (suman {total})"
    return None


class AnalyticsConfigView(generics.GenericAPIView):
    """`GET/PATCH /api/v1/settings/analytics-config/` — Fase 31,
    réplica exacta de `route.ts`. `GET` no requiere rol especial;
    `PATCH` requiere `can_manage_users` (mismo whitelist de 3 roles
    que `role-targets`/`role-compatibility` — el TS reutiliza
    `canManageUsers` acá también). Validado manualmente: el cuerpo es
    un diccionario disperso de hasta 26 claves dinámicas con
    validaciones cruzadas (3 sumas de ponderación + orden de 3
    umbrales) que dependen de los valores YA vigentes para las claves
    que esta llamada no toca — fuera del alcance natural de un
    `Serializer` de forma fija."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        return Response(
            {
                "config": get_effective_analytics_config(timezone.now()),
                "defaults": ANALYTICS_CONFIG_DEFAULTS,
                "prediction_max_days": PREDICTION_MAX_DAYS,
            }
        )

    def patch(self, request):
        if not _can_manage_users(request.user):
            return Response({"error": "Sin permisos"}, status=403)

        body = request.data
        if not isinstance(body, dict) or not body:
            return Response({"error": "Nada que guardar"}, status=400)

        for key, value in body.items():
            rule = _ANALYTICS_CONFIG_VALIDATION.get(key)
            if rule is None:
                return Response({"error": f"Clave de configuración desconocida: {key}"}, status=400)
            min_value, max_value = rule
            if (
                not isinstance(value, (int, float))
                or isinstance(value, bool)
                or not (min_value <= value <= max_value)
            ):
                return Response(
                    {"error": f"{key} debe ser un número entre {min_value} y {max_value}"},
                    status=400,
                )

        current = get_effective_analytics_config(timezone.now())
        merged = {**current, **body}

        for keys, label in (
            (_HEALTH_WEIGHT_KEYS, "Equilibrio Operativo"),
            (_PERF_WEIGHT_KEYS, "Performance Score"),
            (_RISK_WEIGHT_KEYS, "Índice de Riesgo Operativo"),
        ):
            error = _weight_sum_error(body, merged, keys, label)
            if error:
                return Response({"error": error}, status=400)

        if not (
            merged["risk_threshold_medio"]
            < merged["risk_threshold_alto"]
            < merged["risk_threshold_critico"]
        ):
            return Response(
                {"error": "Los umbrales de riesgo deben cumplir Medio < Alto < Crítico"}, status=400
            )

        for key, value in body.items():
            set_analytics_config_value(key, value, request.user)

        return Response({"config": get_effective_analytics_config(timezone.now())})


_CURVE_NAMES: tuple[CurveName, ...] = (
    "cumplimiento",
    "vencidas",
    "carga",
    "capacidad",
    "consistencia",
    "trazabilidad",
)


class NormalizationCurvesView(generics.GenericAPIView):
    """`GET/PATCH /api/v1/settings/normalization-curves/` — Fase 32
    (ver docs/AUDIT_LOG.md § 2026-08-21), réplica exacta de
    `route.ts`. `GET` no requiere rol especial; `PATCH` requiere
    `can_manage_users` (mismo whitelist que `analytics-config` — el TS
    reutiliza `canManageUsers` acá también, "mismo grupo de acceso").
    Validado manualmente: `points` es una lista dinámica de `{x, y}`
    con su propia función de validación (`is_valid_curve`, ya
    portada), no un campo `Serializer` de forma fija."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        return Response(
            {"curves": get_all_effective_curves(timezone.now()), "defaults": DEFAULT_CURVES}
        )

    def patch(self, request):
        if not _can_manage_users(request.user):
            return Response({"error": "Sin permisos"}, status=403)

        name = request.data.get("name")
        points = request.data.get("points")
        if name not in _CURVE_NAMES:
            return Response({"error": f"Curva desconocida: {name}"}, status=400)
        if not is_valid_curve(points):
            return Response(
                {
                    "error": "Curva inválida: se requieren al menos 2 puntos con x/y finitos e y en [0,100]"
                },
                status=400,
            )

        set_curve_config(name, points, request.user)
        return Response({"curves": get_all_effective_curves(timezone.now())})


class SeguridadConfigView(generics.GenericAPIView):
    """`GET/PUT /api/v1/settings/seguridad-config/` — Fase 32, réplica
    exacta de `route.ts`. `GET` no requiere rol especial; `PUT` solo
    ADMINISTRADOR. Gap documentado (ver
    `apps.configuration.services.get_effective_password_min_length`):
    `password_min_length` no se enforce todavía en el flujo de cambio
    de contraseña de Django — esta fase solo porta la superficie de
    configuración."""

    permission_classes = [IsAuthenticated]
    serializer_class = SeguridadConfigUpdateSerializer

    def _payload(self, now) -> dict:
        return {
            "password_min_length": get_effective_password_min_length(now),
            "session_duration_default_hours": get_effective_session_duration_default_hours(now),
            "session_duration_remember_hours": get_effective_session_duration_remember_hours(now),
            "retention_login_attempts_days": get_effective_retention_login_attempts(now),
        }

    def get(self, request):
        return Response(self._payload(timezone.now()))

    def put(self, request):
        if _role_name(request.user) != "ADMINISTRADOR":
            return Response({"error": "Sin permisos"}, status=403)

        serializer = self.get_serializer(data=request.data)
        if not serializer.is_valid():
            return Response({"error": _first_error(serializer.errors)}, status=400)
        data = serializer.validated_data

        if "password_min_length" in data:
            set_config_value(
                CONFIG_KEY_PASSWORD_MIN_LENGTH, str(data["password_min_length"]), request.user
            )
        if "session_duration_default_hours" in data:
            set_config_value(
                CONFIG_KEY_SESSION_DURATION_DEFAULT_HOURS,
                str(data["session_duration_default_hours"]),
                request.user,
            )
        if "session_duration_remember_hours" in data:
            set_config_value(
                CONFIG_KEY_SESSION_DURATION_REMEMBER_HOURS,
                str(data["session_duration_remember_hours"]),
                request.user,
            )
        if "retention_login_attempts_days" in data:
            set_config_value(
                CONFIG_KEY_RETENTION_LOGIN_ATTEMPTS,
                data["retention_login_attempts_days"],
                request.user,
            )

        return Response(self._payload(timezone.now()))


class TrabajoAvanzadoView(generics.GenericAPIView):
    """`GET/PUT /api/v1/settings/trabajo-avanzado/` — Fase 32, réplica
    exacta de `route.ts`. `GET` no requiere rol especial; `PUT` solo
    ADMINISTRADOR."""

    permission_classes = [IsAuthenticated]
    serializer_class = TrabajoAvanzadoUpdateSerializer

    def _payload(self, now) -> dict:
        return {
            "retroactive_window_days": get_effective_retroactive_window_days(now),
            "workday_end_hour": get_effective_workday_end_hour(now),
        }

    def get(self, request):
        return Response(self._payload(timezone.now()))

    def put(self, request):
        if _role_name(request.user) != "ADMINISTRADOR":
            return Response({"error": "Sin permisos"}, status=403)

        serializer = self.get_serializer(data=request.data)
        if not serializer.is_valid():
            return Response({"error": _first_error(serializer.errors)}, status=400)
        data = serializer.validated_data

        if "retroactive_window_days" in data:
            set_config_value(
                CONFIG_KEY_RETROACTIVE_WINDOW_DAYS,
                str(data["retroactive_window_days"]),
                request.user,
            )
        if "workday_end_hour" in data:
            set_config_value(
                CONFIG_KEY_WORKDAY_END_HOUR, str(data["workday_end_hour"]), request.user
            )

        return Response(self._payload(timezone.now()))


class SystemInfoView(generics.GenericAPIView):
    """`GET /api/v1/settings/system-info/` — Fase 32, réplica exacta
    de `route.ts`. Solo ADMINISTRADOR. `commit_sha`/`server_started_at`
    no tienen el equivalente exacto de Vercel (`VERCEL_GIT_COMMIT_SHA`)
    en este entorno — se usa una variable de entorno genérica
    (`GIT_COMMIT_SHA`) y el momento de carga del módulo, mismo
    criterio honesto que el comentario original del TS ("no hay
    timestamp de deploy expuesto por la plataforma en runtime")."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        if _role_name(request.user) != "ADMINISTRADOR":
            return Response({"error": "Sin permisos"}, status=403)

        commit_sha = os.environ.get("GIT_COMMIT_SHA", "")[:7] or None
        return Response(
            {
                "version": django_settings.APP_VERSION,
                "commit_sha": commit_sha,
                "server_started_at": _SERVER_STARTED_AT,
                "total_users": User.objects.count(),
                "total_tasks": Task.objects.count(),
                "total_meetings": Meeting.objects.count(),
                "total_ideas": ImprovementIdea.objects.count(),
            }
        )


class ConfigHistoryView(generics.GenericAPIView):
    """`GET /api/v1/settings/config-history/` — Fase 33 (ver
    docs/AUDIT_LOG.md § 2026-08-21), réplica exacta de `route.ts`.
    Solo ADMINISTRADOR."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        if _role_name(request.user) != "ADMINISTRADOR":
            return Response({"error": "Sin permisos"}, status=403)

        keys = [k.strip() for k in request.query_params.get("keys", "").split(",") if k.strip()]
        if not keys:
            return Response({"error": "keys es requerido"}, status=400)

        rows = (
            SystemConfigHistory.objects.filter(key__in=keys)
            .select_related("updated_by")
            .order_by("-valid_from")
        )
        return Response(
            [
                {
                    "key": r.key,
                    "value": r.value,
                    "valid_from": r.valid_from.isoformat(),
                    "valid_until": r.valid_until.isoformat() if r.valid_until else None,
                    "updated_by_name": _display_name(r.updated_by),
                }
                for r in rows
            ]
        )


class ConfigHistoryRestoreDefaultView(generics.GenericAPIView):
    """`POST /api/v1/settings/config-history/restore-default/` — Fase
    33, réplica exacta de `route.ts`. Solo ADMINISTRADOR."""

    permission_classes = [IsAuthenticated]

    def post(self, request):
        if _role_name(request.user) != "ADMINISTRADOR":
            return Response({"error": "Sin permisos"}, status=403)

        defaults = request.data.get("defaults")
        if not isinstance(defaults, dict) or not defaults:
            return Response({"error": "defaults es requerido"}, status=400)

        for key, value in defaults.items():
            set_config_value(key, str(value), request.user)

        return Response({"ok": True})


# Únicos documentos expuestos por este endpoint — nunca un path arbitrario
# del request, para evitar cualquier lectura fuera de `docs/` (mismo
# whitelist que el TS: `DOC_FILES`).
_DOC_FILES = {
    "version": "VERSION.md",
    "changelog": "CHANGELOG.md",
    "decisions": "DECISIONS.md",
    "roadmap": "ROADMAP.md",
    "architecture": "ARCHITECTURE.md",
    "formulas": "ANALYTICS_FORMULAS.md",
}


class DocumentationView(generics.GenericAPIView):
    """`GET /api/v1/settings/documentation/` — Fase 33, réplica exacta
    de `route.ts`. Solo ADMINISTRADOR. `BASE_DIR.parent` (`config/
    settings/base.py`) ya es la raíz del repo — mismo path que usa
    `APP_VERSION` para leer el archivo `VERSION` en `settings/base.py`,
    así que `BASE_DIR.parent / "docs"` es el mismo `docs/` que sirve
    el TS."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        if _role_name(request.user) != "ADMINISTRADOR":
            return Response({"error": "Sin permisos"}, status=403)

        file_name = _DOC_FILES.get(request.query_params.get("doc", ""))
        if not file_name:
            return Response({"error": "Documento no reconocido"}, status=400)

        file_path = Path(django_settings.BASE_DIR).parent / "docs" / file_name
        try:
            content = file_path.read_text(encoding="utf-8")
            updated_at = datetime.fromtimestamp(
                file_path.stat().st_mtime, tz=dt_timezone.utc
            ).isoformat()
        except OSError:
            return Response({"error": "No se pudo leer el documento"}, status=500)

        return Response({"content": content, "updated_at": updated_at})


class NovaCacheView(generics.GenericAPIView):
    """`GET/PUT /api/v1/settings/nova-cache/` — Fase 34 (ver
    docs/AUDIT_LOG.md § 2026-08-21), réplica exacta de `route.ts`.
    `GET` no requiere rol especial; `PUT` solo ADMINISTRADOR. Solo se
    porta la configuración (TTL) — Nova/Gemini en sí sigue fuera de
    alcance, mismo criterio que `nova-message` (Fase 25)."""

    permission_classes = [IsAuthenticated]
    serializer_class = NovaCacheUpdateSerializer

    def get(self, request):
        return Response({"cache_ttl_minutes": get_effective_nova_cache_ttl_minutes(timezone.now())})

    def put(self, request):
        if _role_name(request.user) != "ADMINISTRADOR":
            return Response({"error": "Sin permisos"}, status=403)

        serializer = self.get_serializer(data=request.data)
        if not serializer.is_valid():
            return Response(
                {"error": "El TTL de caché debe ser un entero entre 1 y 10080 minutos (7 días)"},
                status=400,
            )

        set_config_value(
            CONFIG_KEY_NOVA_CACHE_TTL_MINUTES,
            str(serializer.validated_data["cache_ttl_minutes"]),
            request.user,
        )
        return Response({"cache_ttl_minutes": get_effective_nova_cache_ttl_minutes(timezone.now())})


class DataQualityView(generics.GenericAPIView):
    """`GET /api/v1/settings/data-quality/` — Fase 34, réplica exacta
    de `route.ts`. Solo ADMINISTRADOR. Ver
    `apps.configuration.data_quality.build_data_quality_report` para
    el detalle de los 7 chequeos."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        if _role_name(request.user) != "ADMINISTRADOR":
            return Response({"error": "Sin permisos"}, status=403)

        return Response(build_data_quality_report(timezone.now()))


class NotificationRulesView(generics.GenericAPIView):
    """`GET/PUT /api/v1/settings/notification-rules/` — Fase 35 (ver
    docs/AUDIT_LOG.md § 2026-08-21), réplica exacta de `route.ts`.
    `GET` no requiere rol especial; `PUT` solo ADMINISTRADOR. Sus 2
    consumidores reales (`CommentService.create_comment`/
    `ActivityService.create_retroactive_activity`, `apps/tasks/services.py`)
    se conectaron acá en 2026-08-28 — ver
    `apps.configuration.services.CONFIG_KEY_NOTIFICATION_RULES`."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        return Response(get_effective_notification_rules())

    def put(self, request):
        if _role_name(request.user) != "ADMINISTRADOR":
            return Response({"error": "Sin permisos"}, status=403)

        config, error = validate_notification_rules_body(request.data)
        if error:
            return Response({"error": error}, status=400)

        set_notification_rules(config, request.user)
        return Response(config)
