from django.conf import settings
from rest_framework.pagination import PageNumberPagination


class DefaultPagination(PageNumberPagination):
    """Paginación genérica reutilizable por cualquier listado del backend."""

    page_size_query_param = "page_size"
    max_page_size = 100

    @property
    def page_size(self):
        return settings.DEFAULT_PAGE_SIZE
