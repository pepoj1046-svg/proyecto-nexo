# Decisiones reservadas — Etapa 2

Estas cuestiones se documentan sin inventar reglas comerciales o legales. La
autorización actual permite avanzar con contratos, inventario, permisos, adaptador
local y pruebas independientes usando datos ficticios. No autoriza un piloto real.

| Decisión | Comportamiento conservado | Falta acordar antes de completar la política |
|---|---|---|
| Plazo de aceptar propuestas | TTL técnico previo de dos minutos; vencimiento libera retenciones | Plazo definitivo, avisos, reintentos y criterios tras rechazo/no respuesta |
| Ausencias/tolerancias | No hay cancelación por ausencia ni cron; cancelación explícita previa al inicio libera grupo | Evidencia de ausencia, avisos, tolerancias, recursos económicos y revisión |
| Menores | División solo con declaración explícita containsMinors=false; no se recopilan edades/personas | Verificar edad/vínculos, quién autoriza, casos de grupo y privacidad |
| Manifiesto y recogidas posteriores | Salida con seis plazas confirmadas según núcleo previo, incluso en paradas posteriores; bitácora de movimientos no altera esa regla | Interpretación definitiva de ocupación/manifiesto, abordaje previo y qué hacer con observaciones incompletas |
| Reservas futuras tras revocación | Nuevas reservas/confirmaciones revalidan; no cancelación masiva ni interrupción de viajes iniciados | Aviso, revisión de reservas futuras, alternativas y consecuencias económicas |
| Recorrido completo intramunicipal | Clasificación NULL no crea un servicio completo; los tramos locales de rutas habilitadas continúan | Si soportarlo, categoría/condiciones y permisos correspondientes |

No se atribuye carácter definitivo a los plazos de laboratorio ni a los supuestos
de salida. Las observaciones BOARD/ALIGHT son por reserva y parada, no acreditación
personal, de edad ni de ausencia. No se sustituye una observación faltante por un
evento ficticio para poder cerrar un viaje.

También requieren aprobación para uso real: fuente geográfica y permisos oficiales,
altas documentales, proveedor de identidad, TLS/MFA/canal de recuperación,
retención/backups y operación. Cobros/QR/GPS/comunicaciones y gastos no se activan.
Etapa 3 no está autorizada. PR #1 permanece abierto y main no se modifica.
