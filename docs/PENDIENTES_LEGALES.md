# Pendientes Legales — Nexo

> Este documento consolida, en un solo lugar, los pendientes de validación legal/administrativa identificados durante la revisión técnica del sistema (ver `docs/RAT.md` y README, sección 16). No es una conclusión legal — es un listado de trabajo para el área legal/administrativa de la organización.

## 1. Identificación legal del responsable del tratamiento

- Definir la razón social y el RUC de la entidad responsable del tratamiento (`docs/RAT.md`, sección 1).
- Evaluar si corresponde designar un Delegado de Protección de Datos según el Art. 44 LOPDP.
- Completar el domicilio y el contacto formal para el ejercicio de derechos de los titulares.

## 2. Acuerdos de encargado de tratamiento con proveedores externos

Nexo utiliza cinco proveedores externos que procesan datos personales: **Groq** (IA), **GitHub** (almacenamiento documental), **Zoom** (videoconferencia), **Neon** (base de datos PostgreSQL gestionada) y **Vercel** (hosting/despliegue). Ninguno tiene hoy un acuerdo de encargado de tratamiento (o equivalente) formalizado. Esto es responsabilidad del área legal — el sistema no puede formalizar estos acuerdos por sí mismo (`docs/RAT.md`, sección 6).

## 3. Validación legal formal LOPDP y transferencias internacionales

- Validación formal del cumplimiento LOPDP por asesoría jurídica especializada en protección de datos en Ecuador.
- Evaluar si el uso de los cinco proveedores externos (todos con infraestructura fuera de Ecuador) constituye una transferencia internacional de datos personales bajo la LOPDP y, de ser así, qué garantías adicionales aplican (`docs/RAT.md`, sección 7).
- Validar que el flujo de eliminación de cuenta (gestión manual del Administrador tras la solicitud del titular) cumple los plazos y garantías exigidos por la ley (`docs/RAT.md`, sección 8).

## 4. Plazo de conservación de permisos médicos y personales (`LeaveRecord`)

Los permisos médicos y personales (`LeaveRecord`) no tienen hoy un plazo de conservación definido ni un mecanismo de depuración: se conservan indefinidamente una vez creados, salvo borrado manual individual por el Administrador. Al tratarse de datos de salud en el caso `MEDICO`, esto es un vacío a resolver — se debe definir el plazo de conservación aplicable y, si corresponde, extender la política de retención/depuración técnica del sistema para cubrir este modelo (`docs/RAT.md`, sección 9).

## 5. Tratamiento de datos de salud (URGENTE)

Con la implementación de permisos médicos y estados de maternidad/lactancia, Nexo ahora trata datos de categoría especial conforme al Art. 26 LOPDP. Esto requiere:

- **Base legal reforzada**: verificar que el consentimiento actual cumple los requisitos del Art. 26 para datos de salud (consentimiento explícito, por escrito, con finalidad específica).
- **Medidas de seguridad adicionales**: evaluar si las medidas técnicas actuales son suficientes para datos de salud.
- **Acceso restringido**: confirmar que solo el Administrador puede ver y gestionar estos datos (ya implementado técnicamente).
- **Minimización de datos**: evaluar si es necesario almacenar el tipo específico de permiso médico o si basta con registrar "ausencia justificada".
- **Validación legal urgente**: consultar con asesoría especializada en LOPDP antes de usar el sistema con datos de salud reales de colaboradores.

---

*Ver también `docs/RAT.md` (Registro de Actividades de Tratamiento) para el detalle técnico de qué datos trata el sistema y dónde se almacenan.*
