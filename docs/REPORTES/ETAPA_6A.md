# Etapa 6A — Seguimiento por paradas y avisos simulados dentro de la app

Estado: **implementado, pendiente de CI y de revisión del propietario**. Solo laboratorio.
Rama `desarrollo/etapa-6a`, sobre 5A.8. Decisiones provisionales P-6A-1 a P-6A-5 en
[DECISIONES_PROVISIONALES.md](../DECISIONES_PROVISIONALES.md).

## Qué añade

- **Migración 046:**
  - Tabla `notices`: avisos por pasajero, con canal fijo `IN_APP_SIMULATED` y caducidad de 24 horas. Tiene RLS activa y no tiene permisos directos.
    - Es inmutable salvo `read_at`, que solo se puede fijar una vez.
    - Solo se pueden borrar los avisos caducados.
    - Un índice único garantiza un aviso por reserva, tipo y parada.
  - Triggers `AFTER` en `bookings` (cambios de estado) y `trips` (salida y avance de parada). **Solo insertan** en `notices`: no modifican ninguna fila del núcleo.
  - `web_my_notices` lista los avisos vigentes del propio pasajero con el conteo de no leídos.
  - `web_mark_notices_read` marca solo los avisos propios; los ids ajenos se ignoran sin revelarlos.
  - `purge_expired_notices`, solo para `nexo_maintenance`.
- **Contrato de canales** (`src/notify/channels.mjs`): solo el canal dentro de la app entrega. SMS, correo, push y voz rechazan con `CHANNEL_NOT_ENABLED`. Las reglas para un proveedor futuro son idempotencia por id, sin reintentos pasada la caducidad y solo con consentimiento.
- **Endpoints** `POST /api/notices/mine` y `/api/notices/read`, con el envoltorio `authenticated`.
- **Panel «Avisos de tus viajes»** en «Mis reservas»:
  - Se consulta a pedido.
  - Marca todos los avisos como leídos.
  - Explica que no hay GPS ni envíos externos.

## Pruebas

| Prueba | Qué verifica |
| --- | --- |
| `6A-01` (PostgreSQL) | Secuencia confirmada → salió → terminada. Una salida repetida no duplica avisos. Nadie más los ve. Respuesta sin ids de usuario. Marcar ajenos no marca nada; los propios, una vez. Formas inválidas rechazadas. Inmutabilidad, caducidad y retención. ACL mínima. |
| `6A-02` (PostgreSQL) | La venta presencial sigue funcionando con los triggers y no genera avisos. |
| `6A-U1` | Los canales externos rechazan; el canal de la app respeta la caducidad. |
| `6A-U2` | Formas cerradas al marcar avisos. |
| `6A-E1` | El panel explica sus límites, no hace polling durante cinco segundos, consulta solo al pulsar y pasa axe. |

La 046 se aplicó en un PostgreSQL 16 local. Se simuló un viaje completo: la secuencia de
avisos fue correcta, sin duplicados, y se probaron la lectura propia, el marcado, la
inmutabilidad, el bloqueo de borrado y el acceso directo denegado. **No ejecutadas en local**
(la sesión no tiene npm). La batería completa la cubre el CI del PR.

## Límites

- No hay GPS, mapas ni canales externos (P-6A-1 y P-6A-2).
- Todavía no hay avisos de rescate o reasignación (P-6A-4).
