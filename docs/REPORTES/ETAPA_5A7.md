# 5A.7 — Valoraciones de laboratorio

Estado: **implementado, pendiente de CI y de revisión del propietario**. Solo laboratorio.
Rama `desarrollo/etapa-5a7`, sobre `desarrollo/etapa-5a6`. Decisiones provisionales P-5A7-1
a P-5A7-6 en [DECISIONES_PROVISIONALES.md](../DECISIONES_PROVISIONALES.md).

## Qué añade

- **Migración 045:**
  - Tabla `service_ratings`, con una fila por reserva. Es inmutable (trigger `immutable_audit`), tiene RLS activa y no tiene permisos directos.
  - `web_ratable_bookings` (pasajero, lectura) lista sus reservas APP terminadas de los últimos 30 días y si ya las valoró.
  - `web_rate_service` (pasajero, escritura):
    - Es idempotente por clave de acción y bloquea la reserva con `FOR SHARE`.
    - Exige que la reserva sea suya, de origen APP y en estado `COMPLETED`.
    - Si no, responde siempre `NOT_RATABLE`, para no revelar reservas ajenas.
    - Una segunda clave sobre la misma reserva responde `ALREADY_RATED`.
  - `web_service_ratings` (administración, lectura):
    - Muestra solo las rutas que el administrador gestiona (`has_role` y `manage_route`).
    - No incluye identificadores de pasajero, reserva, grupo ni viaje.
    - Incluye un resumen por ruta con conteo y promedio, y es paginada.
  - `EXECUTE` solo para `nexo_app`.
- **Endpoints:** `POST /api/ratings/mine`, `/api/ratings/rate` (con `Idempotency-Key`) y `/api/ratings/admin`, todos con el envoltorio `authenticated` y cuerpos cerrados.
- **Interfaz:**
  - Panel «Valora tus viajes terminados» en «Mis reservas». Usa una escala de 1 a 5 con etiquetas opcionales y reutiliza la clave al reintentar.
  - Panel «Valoraciones de pasajeros» en «Administración», con resumen por ruta y lista paginada.

## Pruebas

| Prueba | Qué verifica |
| --- | --- |
| `5A7-01` (PostgreSQL) | Nada se puede valorar antes de terminar el viaje. Solo valora el titular. El reintento con la misma clave da el mismo resultado; con otra clave, `ALREADY_RATED`. Chofer, administración y reservas abiertas: `NOT_RATABLE`. Formas inválidas rechazadas. Carrera de dos claves: exactamente una valoración. Reservas y viajes intactos. Inmutabilidad. |
| `5A7-02` (PostgreSQL) | La administración ve solo sus rutas, sin identificadores. Otra asociación no ve nada; chofer y pasajero reciben `FORBIDDEN`. Páginas acotadas, ACL mínima y sin acceso directo a la tabla. |
| `5A7-U1`, `5A7-U2` | Formas cerradas de la valoración y de la página. |
| `5A7-E1`, `5A7-E2` | Los paneles aparecen para el rol correcto, explican sus límites y pasan axe. |

Las listas de migraciones, el `TRUNCATE`, los helpers de tablas nuevas y la lista de
funciones de `4B1-09` incluyen ahora la 045. **No ejecutadas en local** (la sesión no tiene
npm): la 045 se probó en un PostgreSQL 16 local (valorar, reintento, `ALREADY_RATED`,
`NOT_RATABLE`, vista anónima de administración e inmutabilidad). La batería completa la
cubre el CI del PR.

## Límites

- Las E2E no recorren una valoración completa desde la interfaz, porque el laboratorio web
  no tiene viajes terminados para el pasajero. Ese recorrido lo cubre la prueba de integración.
- No hay texto libre, edición ni visibilidad para el chofer (P-5A7-4 y P-5A7-5).

## Corrección posterior (CI)

- **Defecto:** el panel de valoraciones del pasajero leía al montarse. El gateway de laboratorio tiene un límite global (120 solicitudes por minuto y 6 simultáneas), y esa lectura extra hacía fallar de forma determinista la prueba E2E «rescate en carretera» en las tres configuraciones que la ejecutaron: la última consulta del chofer seguía mostrando la fase anterior.
- **Corrección:** el panel lee solo a demanda («Consultar viajes para valorar»), igual que los demás paneles, y se vacía al cambiar de cuenta. La prueba 5A7-E1 ahora exige que no haya lecturas automáticas.
- **Pruebas:** también se corrigieron 5A7-01 y 5A7-02, que no respetaban las reglas del núcleo. La salida exige 6 plazas confirmadas y ninguna retención vigente, y una retención no puede adelantarse en la fila (`QUEUE_ORDER`).
