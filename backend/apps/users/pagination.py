from django.conf import settings
from rest_framework.pagination import PageNumberPagination


class UserAdminPagination(PageNumberPagination):
    page_size_query_param = "page_size"
    max_page_size = 100

    @property
    def page_size(self):
        # Propiedad (no atributo de clase) para leer el valor vigente en
        # settings en cada request, en vez de congelarlo al importar el
        # módulo.
        return settings.ADMIN_USERS_PAGE_SIZE
