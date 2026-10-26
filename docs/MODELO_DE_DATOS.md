# Modelo de datos — conceptual y alcance implementado

El esquema operativo ejecutable está en [migrations](../database/migrations).
Se ha aplicado y probado en PostgreSQL local aislado. [schema.sql](../database/schema.sql)
ahora solo indica esa fuente única; el DDL conceptual anterior no se aplica.

Implementado: usuarios ficticios/sesiones, asociaciones/membresías, vehículos, rutas
versionadas/paradas/tarifas, `trips` como unidad de fila+servicio, reservas APP/WALK_IN
con grupo e inventario por segmento, acciones idempotentes y auditoría inmutable.
Se usan claves compuestas de asociación en las relaciones operativas. La propuesta
y aceptación de asignación están en la reserva y sus eventos; no hay una tabla de
asignaciones separada. El resto de este documento es el catálogo conceptual futuro,
incluidos pagos, licencias y turnos con vigencia, **todavía no implementados**.

## Identidad y asociaciones
- `users`: identidad global y autenticación (sin contraseñas en texto).
- `associations`: razón social, contacto público, estado y reglas.
- `memberships`: relación usuario–asociación con rol específico. Un chofer podría pertenecer a más de una asociación bajo autorización.
- `vehicles`: capacidad habilitada (6 plazas en prototipo), placa única y asociación.
- `driver_vehicle_shifts`: chofer, vehículo, ruta, vigencia; evitar turnos incompatibles solapados.

## Rutas y tarifas
- `routes`: asociación, origen, destino, sentido y trazado/versionado.
- `stops`: paradas/terminales/puntos y coordenadas; orden en ruta.
- `fare_rules`: desde y hasta punto/tramo, tipo de servicio, importe, moneda, inicio/fin de vigencia. No editar precios históricos de reservas confirmadas.

## Filas y reservas
- `queue_entries`: asociación, ruta, vehículo, posición, estado. Solo una entrada activa por vehículo; una cola es combinación asociación/ruta/sentido.
- `bookings`: pasajero, asociación, ruta, origen/destino, plazas (1–6), expreso, tarifa congelada, estado y fecha.
- `walk_in_bookings`: registro de pasajero presencial desde administración, sin exigir cuenta de pasajero.
- `assignments`: relación reserva-vehículo/conductor. Mantener trazabilidad de propuestas rechazadas o expiradas.
- `trips` y `trip_events`: estado operacional y cronología; eventos por reserva para subida/bajada en diferentes tramos.

## Pagos y licencias
- `payment_parts`: efectivo/QR en componentes con estado, importe y referencia por reserva. QR va a asociación, no a plataforma.
- `refund_requests`: asociación responsable, pago, estado, contacto y comprobante de devolución.
- `licenses`, `license_events`: inicio/vencimiento, congelamientos, avisos, suspensión, recargos y verificaciones.

## Restricciones transversales
- Claves foráneas y asociación consistente; en servicios debe verificarse que vehicle, route, driver, queue y booking pertenezcan a la misma asociación.
- Capacidad se verifica **por segmentos con bloqueo transaccional**, no mediante una única restricción SQL del total de asientos.
- Proteger documentos, datos de pagos, GPS y notificaciones. El usuario no podrá modificar arbitrariamente `association_id`.
- Usar UUID, timestamps UTC, fechas/horas locales cuando la lógica contractual lo requiera.
- `audit_events` inmutables con motivo, actor y datos minimizados.

## Limitaciones actuales
Es un esquema de arranque, no el modelo de producción. Faltan el trazado geográfico detallado, constraints avanzados multi-tabla, política de retención GPS, versionado de tramos, reembolsos bancarios reales y DDL de índices optimizados. Se completarán antes de operar servicios reales.

## Entidades geográficas y permisos implementados

geo_catalogs, departments, provinces, municipalities y localities guardan jerarquía
por versión/fuente, sin mezclas de catálogo mediante claves compuestas.
routes y stops enlazan esas localidades; stop_count, extremos y topología usada
quedan protegidos. route_authorizations y authorization_events registran vigencia,
estado, actor y motivo; operation_reviewers delimita la verificación confiable.
La licencia/comercialización sigue representada por el interruptor técnico previo
de asociación; no sustituye la habilitación legal de una ruta.
[Especificación ejecutable y límites](GEOGRAFIA_Y_AUTORIZACIONES.md).

## Identidad local implementada en 009

`identity_accounts` separa identificador local, hash scrypt, versión y estado de
la identidad de las membresías; `identity_attempts` conserva presupuestos de
intentos por hash, `identity_recovery` códigos con hash/caducidad/consumo, y
`identity_events` auditoría inmutable con sujeto, asociación y principal SQL.
La tabla `sessions` anterior se reutiliza sin reescribir filas; no se añaden
columnas a users/sessions ni se pierde la identidad de reservas antiguas.
Las nuevas tablas no admiten DML ni lectura de credenciales desde nexo_app.
[Roles, RLS y límites](LOCALIDADES_Y_AUTENTICACION.md).
