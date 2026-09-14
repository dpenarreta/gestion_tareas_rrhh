"""Cobertura de `TaskUpdateSerializer` — el contrato de la edición de tareas.

Existe por un fallo real en producción (ver docs/AUDIT_LOG.md § 2026-09-14):
ninguna tarea sin descripción se podía guardar. El formulario manda `null`
cuando el campo queda en blanco, el serializador lo rechazaba, y el mensaje
que llegaba a la pantalla hablaba de permisos, así que no había forma de
relacionarlo con la descripción.

Estas pruebas no tocan la base a propósito: validan el contrato de entrada,
que es donde estaba el defecto.
"""

from apps.tasks.serializers import TaskUpdateSerializer


def _validado(**datos):
    serializador = TaskUpdateSerializer(data=datos)
    assert serializador.is_valid(), serializador.errors
    return serializador.validated_data


def test_acepta_descripcion_nula_y_la_normaliza_a_vacio():
    # El caso exacto que rompía: el formulario manda `null` cuando no hay
    # descripción, y el modelo es TextField(blank=True, default="").
    assert _validado(description=None)["description"] == ""


def test_acepta_descripcion_vacia():
    assert _validado(description="")["description"] == ""


def test_conserva_una_descripcion_con_texto():
    assert _validado(description="Revisión mensual")["description"] == "Revisión mensual"


def test_acepta_color_nulo_y_lo_normaliza():
    assert _validado(color=None)["color"] == ""


def test_no_inventa_campos_que_no_se_enviaron():
    # `update_task` decide qué tocar según los campos presentes: normalizar
    # no puede agregar una descripción vacía a una petición que no la incluía,
    # o editar el título borraría la descripción existente.
    validado = _validado(title="Solo el titulo")
    assert "description" not in validado
    assert "color" not in validado


def test_titulo_vacio_sigue_siendo_invalido():
    # La normalización es solo para los campos de texto libre opcionales.
    serializador = TaskUpdateSerializer(data={"title": ""})
    assert not serializador.is_valid()
    assert "title" in serializador.errors
