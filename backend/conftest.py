import pytest
from django.core.cache import cache


@pytest.fixture(autouse=True)
def _clear_cache():
    """Evita que el throttling de DRF (basado en cache) contamine tests
    entre sí, ya que la cache por defecto vive en memoria del proceso."""
    cache.clear()
    yield
    cache.clear()
