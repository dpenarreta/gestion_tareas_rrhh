from django.contrib import admin

from .models import LoginAttempt, PasswordResetToken, Session


@admin.register(Session)
class SessionAdmin(admin.ModelAdmin):
    list_display = (
        "id",
        "user",
        "device",
        "ip_address",
        "created_at",
        "last_used_at",
        "revoked_at",
    )
    list_filter = ("device", "revoked_at")
    search_fields = ("user__username", "user__email", "ip_address")
    readonly_fields = [f.name for f in Session._meta.fields]

    def has_add_permission(self, request):
        return False


@admin.register(LoginAttempt)
class LoginAttemptAdmin(admin.ModelAdmin):
    list_display = ("id", "identifier", "user", "ip_address", "successful", "created_at")
    list_filter = ("successful",)
    search_fields = ("identifier", "ip_address")
    readonly_fields = [f.name for f in LoginAttempt._meta.fields]

    def has_add_permission(self, request):
        return False


@admin.register(PasswordResetToken)
class PasswordResetTokenAdmin(admin.ModelAdmin):
    list_display = ("id", "user", "expires_at", "used_at", "created_at")
    list_filter = ("used_at",)
    search_fields = ("user__username", "user__email")
    readonly_fields = [f.name for f in PasswordResetToken._meta.fields]

    def has_add_permission(self, request):
        return False
