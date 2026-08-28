"""Filtros del listado de auditoría (función simple, no un backend de
filtros genérico: el conjunto de filtros es pequeño y fijo)."""

from django.db.models import QuerySet
from django.utils.dateparse import parse_date


def filter_audit_logs(queryset: QuerySet, params) -> QuerySet:
    actor = params.get("actor")
    if actor:
        queryset = queryset.filter(actor_id=actor)

    action = params.get("action")
    if action:
        queryset = queryset.filter(action__icontains=action)

    module = params.get("module")
    if module:
        queryset = queryset.filter(module=module)

    target_type = params.get("target_type")
    if target_type:
        queryset = queryset.filter(target_type=target_type)

    target_id = params.get("target_id")
    if target_id:
        queryset = queryset.filter(target_id=target_id)

    result = params.get("result")
    if result:
        queryset = queryset.filter(result=result)

    created_from = parse_date(params.get("created_from", ""))
    if created_from:
        queryset = queryset.filter(created_at__date__gte=created_from)

    created_to = parse_date(params.get("created_to", ""))
    if created_to:
        queryset = queryset.filter(created_at__date__lte=created_to)

    return queryset
