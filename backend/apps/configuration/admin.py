from django.contrib import admin

from .models import Holiday, LeaveRecord, SpecialStatus, SystemConfigHistory


@admin.register(Holiday)
class HolidayAdmin(admin.ModelAdmin):
    list_display = ("date", "name", "year")
    list_filter = ("year",)
    search_fields = ("name",)
    ordering = ("date",)


@admin.register(SystemConfigHistory)
class SystemConfigHistoryAdmin(admin.ModelAdmin):
    list_display = ("key", "value", "valid_from", "valid_until", "updated_by", "created_at")
    list_filter = ("key",)
    search_fields = ("key",)
    ordering = ("-valid_from",)


@admin.register(LeaveRecord)
class LeaveRecordAdmin(admin.ModelAdmin):
    list_display = ("user", "type", "date", "is_full_day", "duration_minutes", "created_by")
    list_filter = ("type", "is_full_day")
    search_fields = ("user__username", "user__email")
    ordering = ("-date",)


@admin.register(SpecialStatus)
class SpecialStatusAdmin(admin.ModelAdmin):
    list_display = ("user", "type", "start_date", "end_date", "is_active", "daily_hours")
    list_filter = ("type", "is_active")
    search_fields = ("user__username", "user__email")
    ordering = ("-start_date",)
