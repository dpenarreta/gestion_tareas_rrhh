"""Backend SMTP que valida el certificado del servidor contra el almacén del
sistema **y** el conjunto de CA públicas de `certifi`.

Existe por un fallo real en producción (ver docs/AUDIT_LOG.md § 2026-09-11):
el envío moría con

    SSLCertVerificationError: [SSL: CERTIFICATE_VERIFY_FAILED]
    certificate verify failed: self-signed certificate in certificate chain

aunque el servidor SMTP presenta un certificado perfectamente legítimo
(`*.alphaside.com`, emitido por GlobalSign). El mismo servidor validaba sin
problema desde un equipo de escritorio de la misma red.

La diferencia está en el almacén de certificados, no en el certificado.
Windows Server trae muy pocas CA raíz preinstaladas y las descarga **bajo
demanda** cuando un componente del propio Windows las necesita; Python usa
OpenSSL, que lee ese almacén pero no dispara esa descarga. En un servidor
recién instalado —como el de este despliegue— la raíz de GlobalSign
simplemente no está, y la cadena queda sin ancla: de ahí el mensaje sobre un
"certificado autofirmado", que despista porque sugiere un certificado falso
cuando en realidad falta la raíz que lo respalda.

Se **suman** los dos orígenes en vez de reemplazar uno por otro:

- el almacén del sistema, porque puede contener CA internas de la empresa
  (un firewall con inspección TLS, por ejemplo) sin las cuales el envío
  dejaría de funcionar el día que se active una;
- `certifi`, que aporta las CA públicas que al servidor le faltan.

Lo que NO se hace es desactivar la verificación. El correo lleva enlaces de
recuperación de contraseña y viaja por internet hasta un proveedor externo:
sin validar el certificado, cualquiera en el camino podría interceptar esas
credenciales.
"""

import ssl

import certifi
from django.core.mail.backends.smtp import EmailBackend as SmtpEmailBackend
from django.utils.functional import cached_property


class CertifiSMTPEmailBackend(SmtpEmailBackend):
    @cached_property
    def ssl_context(self):
        # Con `ssl_certfile`/`ssl_keyfile` definidos, Django arma un contexto
        # para autenticación por certificado de CLIENTE: es otro caso de uso
        # y no hay que tocarlo.
        if self.ssl_certfile or self.ssl_keyfile:
            return super().ssl_context

        # `create_default_context()` ya carga el almacén del sistema;
        # `load_verify_locations` agrega las CA públicas sin quitar las
        # anteriores.
        context = ssl.create_default_context()
        context.load_verify_locations(cafile=certifi.where())
        return context
