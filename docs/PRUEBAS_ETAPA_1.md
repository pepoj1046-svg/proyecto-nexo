# Plan de pruebas de Etapa 1

Estado: **escenarios definidos, aún no ejecutados**. Antes de afirmar que la etapa está terminada, implementar ejecutor CI y comprobar PostgreSQL real de pruebas aislado, sin pagar servicios externos.

| ID | Caso | Resultado esperado |
|---|---|---|
| T01 | Administrador de asociación A intenta consultar vehículos B | 403 o respuesta sin datos de B |
| T02 | Pasajero intenta cambiar el número de asientos de otro | Denegado |
| T03 | Trufi A con 3 presenciales recibe reserva de 5 | A no sobrevende; ofrecer siguiente elegible |
| T04 | Dos reservas simultáneas consumen última plaza | A lo sumo una se confirma |
| T05 | Grupo de cinco no quiere dividirse | Solo trufi capaz de cinco |
| T06 | Grupo acepta división, falla segundo bloque | Ningún bloque queda confirmado |
| T07 | Expreso con un asiento ya reservado en vehículo | Vehículo incompatible |
| T08 | Trufi B en posición 2 se llena antes que A | B puede salir, A conserva lugar relativo |
| T09 | Repetir botón de salida con misma clave | Un solo evento y una única salida |
| T10 | Recogida posterior al vehículo / fuera de ruta | Rechazo o alternativa válida |
| T11 | Tramo tarifario ambiguo | No confirmar cobro antes de resolver tramo |
| T12 | QR reportado por imagen sin pago conciliado | Nunca VERIFIED |
| T13 | Asociación suspendida en búsqueda pública | Oculta; datos internos preservados |
| T14 | Suspensión con viaje ya en marcha | Viaje puede terminar |
| T15 | Congelamiento 18:00 / cancelación 20:00 | Solo reservas del día siguiente no iniciadas |
| T16 | Pago con confirmación bancaria o comprobante en revisión | Política diferenciada y auditada |
| T17 | Chofer en dos asociaciones | No cruzar turnos, colas ni autorizaciones |
| T18 | Reservas por tramo con subida y bajada intermedias | Máximo 6 plazas en cualquier segmento |

## Criterios de salida de Etapa 1
- Arquitectura y modelo de datos revisados, con amenazas y supuestos claros.
- Validación formal de aislamiento, permisos y asociaciones cruzadas en el diseño.
- Migraciones reproducibles creadas y comprobadas en PostgreSQL de prueba.
- Pruebas automatizadas de capacidad, despacho y acceso, con resultado reportado.
- Ningún servicio productivo ni pago real iniciado.

Lo que no se haya construido o ejecutado debe etiquetarse **pendiente**, no aprobado.
