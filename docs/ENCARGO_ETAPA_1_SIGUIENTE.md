# Siguiente incremento de Etapa 1 — Localidades y autenticación segura

Estado: **criterios de aceptación**, no implementación aprobada. Este documento continúa el incremento geográfico (migraciones 005–007); la intención es preservar compatibilidad con el trabajo de Codex.

## Orden de trabajo

### A. Resolver localidades por nombre y seleccionar origen/destino
- El cliente mostrará solo dos campos al inicio: **¿De dónde sales?** y **¿A dónde vas?**. Nunca pedir tipo intermunicipal/interprovincial/interdepartamental.
- Diseñar búsqueda paginada o con límite fijo y orden determinista para localidades de catálogo **VERIFIED y ACTIVE**. Distinguir los homónimos mostrando localidad, municipio, provincia y departamento. No confiar en textos ambiguos: al elegir la sugerencia, guardar **localityId** y versión de catálogo.
- Aceptar Unicode español, tildes, espacios y variaciones razonables. Evitar consultas ilimitadas, coincidencias de un carácter muy amplias y fuga de información privada. No presentar datos ficticios como oficiales.
- El contrato existente `service.search(token,{originLocalityId,destinationLocalityId})` sigue siendo la búsqueda real de servicios. Resolver nombres es una operación distinta. Revalidar catálogo, permisos, tarifa y plazas antes de confirmar reserva.
- No generar rutas ni asociar automáticamente un punto geográfico a una carretera con solo similitud de nombres.

### B. Autenticación y aprovisionamiento
- Diseñar registro/inicio de sesión y gestión de sesiones mediante proveedor o módulo seguro **propuesto**, sin crear cuentas remotas ni desplegar recursos.
- Definir límites por rol: pasajero, chofer, administrador de asociación y revisor autorizado. Ningún cliente debe poder autoasignarse rol de administrador, revisor, membresía ni autorización.
- Credenciales no pueden quedar en GitHub. Incluir caducidad, revocación, recuperación y protección contra intentos abusivos; usar el rol de aplicación sin privilegios elevados ni BYPASSRLS.
- Identificar cuáles validaciones pueden demostrarse localmente y cuáles quedan pendientes hasta contar con un proveedor de identidad elegido y autorizado.

### C. Seguridad y concurrencia
- Probar acceso cruzado asociación A/B en operaciones nuevas y existentes, catálogo histórico, autorizaciones y lectura RLS.
- Verificar búsquedas, ofertas/aceptaciones y revocaciones simultáneas con bloqueos sin sobreventa, sin modificar migraciones 001–007 previamente aplicadas.
- Revisar funciones SECURITY DEFINER, `search_path`, concesiones EXECUTE, validación de sesión y efectos de revocar permisos con viajes ya iniciados.

## Reglas para un PR verificable
1. Nuevas migraciones a partir de **008**, nunca reescribir migraciones existentes aplicadas.
2. Tests unitarios e integración PostgreSQL en Ubuntu/Windows, con casos de nombres homónimos, acentos, catálogo no verificado, acceso ajeno y sin servicio.
3. Reporte con comandos, éxitos/fallos reales y limitaciones de seguridad; no presentar pruebas no ejecutadas como exitosas.
4. No incorporar datos de personas reales, credenciales o un catálogo nacional inventado.
5. No fusionar a `main`, contratar servicios, activar pagos/GPS ni crear recursos de producción.

## Decisiones reservadas para el propietario
- Qué proveedor de identidad y despliegue tendrá el piloto real, **antes** de crear recursos.
- La fuente y método de validación del catálogo oficial geográfico y las autorizaciones de transporte.
- Políticas contractuales o operativas que impliquen sanciones, devoluciones, cancelaciones de reservas preexistentes o uso de datos personales.

Referencia: `docs/DECISION_BUSQUEDA_PASAJERO.md`, `docs/GEOGRAFIA_Y_AUTORIZACIONES.md`, `docs/SEGURIDAD_PENDIENTE.md`, PR #1.
