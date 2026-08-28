"""Validaciones de unicidad reutilizadas entre el registro público y la
creación administrativa de usuarios."""

from rest_framework import serializers

from .models import User


def validate_unique_username(value: str, *, exclude_user_id: int | None = None) -> str:
    queryset = User.objects.filter(username__iexact=value)
    if exclude_user_id is not None:
        queryset = queryset.exclude(pk=exclude_user_id)
    if queryset.exists():
        raise serializers.ValidationError("Ese nombre de usuario ya está en uso.")
    return value


def validate_unique_email(value: str, *, exclude_user_id: int | None = None) -> str:
    queryset = User.objects.filter(email__iexact=value)
    if exclude_user_id is not None:
        queryset = queryset.exclude(pk=exclude_user_id)
    if queryset.exists():
        raise serializers.ValidationError("Ese correo ya está registrado.")
    return value
