# API de pruebas local y mantenimiento de identidad — 010–011

Alcance exclusivo de Etapa 1. No hay despliegue, proveedor remoto, cuentas reales,
GPS, pagos ni comunicaciones externas. 001–009 permanecen byte por byte intactas.
Este incremento sigue el encargo directo del propietario posterior a la revisión
del PR #1: se permite HTTP **solo en pruebas locales**.

## Ejecutar sin configurar credenciales

```sh
npm ci --no-fund
npm run dev:local
```

Requiere Node 22+ y un usuario no root en Linux. El ejecutor crea un clúster
PostgreSQL real nuevo en `.local/`, una base `nexo_test_<aleatorio>` y dos logins
aleatorios separados para aplicación e identidad. Aplica las migraciones y cierra
la conexión de setup antes de servir. Solo imprime la URL `http://127.0.0.1:<puerto>`.
No imprime contraseñas, tokens ni URLs de conexión. Ignora DATABASE_URL, HOST y PORT;
no reutiliza bases ni se conecta a servicios externos. No instala servicios del SO.
Ctrl+C cierra HTTP, pools y PostgreSQL. Los diagnósticos quedan en `.local/`, ignorada
por Git. No hay cuentas de pasajeros, catálogo oficial ni revisores precargados.
Registrar solo identificadores y contraseñas ficticios durante la prueba.

`npm run test:local-api` verifica automáticamente arranque, registro, login, logout
y cierre de ambos servidores. Usa IPC para detener el ejecutor también en Windows;
no depende de que SIGTERM sea capturable en esa plataforma.

## Contrato HTTP

Todos los endpoints aceptan POST, `Content-Type: application/json` exacto y
`X-Nexo-Local-Test: 1`. Las operaciones protegidas requieren
`Authorization: Bearer <token>`. No se usan cookies, parámetros URL para secretos
ni tokens persistidos en archivos. El marcador de prueba no es una credencial:
la autorización del usuario depende de la sesión.

| Ruta | JSON | Sesión | Resultado |
|---|---|---|---|
| /v1/register | login, password | No | 202, respuesta genérica también ante duplicados |
| /v1/login | login, password | No | 200, token opaco y expiresAt |
| /v1/recover | code, password | No | 200 si consume un código previamente provisionado |
| /v1/logout | objeto vacío | Sí | 200, cierre individual |
| /v1/logout-all | objeto vacío | Sí | 200, cierre de todas las sesiones |
| /v1/localities/suggest | query, limit opcional | Sí | lista limitada con jerarquía, IDs y versión |
| /v1/services/search | originLocalityId, destinationLocalityId; seats/express opcionales | Sí | servicios existentes o NO_DIRECT_SERVICE |

No hay endpoints de provisión, revisión de permisos, mantenimiento, SQL ni reservas
en esta superficie de pruebas. El backend transaccional anterior conserva sus
operaciones y pruebas. La búsqueda de viajes no acepta selector de categoría.

Se rechazan campos desconocidos en los contratos existentes, cuerpos que no sean
objetos JSON, UTF-8 inválido, contraseñas Unicode mal formadas, headers duplicados,
métodos y rutas no admitidos. No se normalizan ni recortan contraseñas; el login
permite únicamente ASCII antes de convertir mayúsculas a minúsculas.

HTTP 400 para solicitudes inválidas, 401 para credenciales/sesión inválida, 403
para solicitudes no locales, 404 para rutas inexistentes, 405 para métodos no
admitidos, 413 para cuerpos grandes, 415 para formato incorrecto, 429 ante abuso
y 503 ante fallos internos. No se devuelven SQL, stacks, hashes ni detalles de conexión.
Una sesión válida en login se entrega solo en su respuesta con `Cache-Control: no-store`.

## Límites y amenazas del transporte

- Escucha exclusivamente en IPv4 127.0.0.1 y puerto efímero; sin host configurable.
- Host debe ser exactamente la IP/puerto de escucha. Se rechazan Origin de navegador
  y Sec-Fetch-Site distintos de none, sin permisos CORS. Host no acredita identidad.
- Cuerpos de hasta 4096 bytes, también si llegan fragmentados; headers de hasta
  8192 bytes y 32 campos. Tiempo de solicitud/headers de 5 s; keep-alive de 1 s.
- Máximo 32 conexiones, 4 operaciones en curso, sin cola de solicitudes, y 60
  solicitudes por minuto por servidor. No se confía en X-Forwarded-For.
- El módulo de identidad admite hasta 6 tareas de scrypt en curso compartidas
  entre adaptadores del proceso; el exceso se rechaza, sin una cola ilimitada.
- Cada llamada SQL de identidad tiene transacción independiente READ COMMITTED,
  lock_timeout de 2 s y statement_timeout de 5 s. Los contadores de intentos se
  confirman antes de verificar la contraseña y no se revierten al fallar el login.

Estos límites son técnicos del laboratorio. Un proceso local con acceso al usuario
del SO puede llamar a la API; loopback no contiene a malware o al administrador del
equipo. HTTP local no acredita seguridad para Internet. Antes del piloto quedan
proveedor/canal de recuperación autorizados, TLS, MFA, diseño de cliente, protección
de cookies/CSRF/CORS si se usan, mitigación distribuida de abuso y revisión independiente.

## Privilegios y sesiones

Los adaptadores ahora comprueban pertenencias efectivas y alcanzables con SET ROLE,
no solo atributos del login. Rechazan combinación de grupos de aplicación,
identidad, provisión y mantenimiento; roles elevados/predefinidos de PostgreSQL;
CREATE en nexo; propietarios de esquema/tablas/funciones; y contextos SET ROLE.
La API ejecutable exige además pools separados sobre la misma base/puerto local
de prueba. No se entrega al servidor HTTP la conexión del propietario ni del
aprovisionador. Estas comprobaciones no contienen a quien controla el DDL o el SO.

`nexo_identity` sigue siendo una frontera confiable: SQL no verifica scrypt por sí
solo y quien controla esa conexión puede emitir sesiones de cuentas gestionadas.
Su EXECUTE se limita a cinco funciones: registro, intentos, emisión, recuperación y
registro de fallos. No tiene SELECT de credenciales, DML directo ni provisión de roles.
No se presenta este diseño como sustituto de un proveedor público autorizado.

La caducidad de una sesión nueva se calcula después de adquirir el lock de cuenta.
La emisión vuelve a comprobar estado/versión; cerrar todas las sesiones, recuperar
o deshabilitar una cuenta invalida versiones anteriores. Logout concurrente produce
una sola transición/evento para un mismo token. Las sesiones previas conservan
sus vencimientos. Revocar no aborta retroactivamente una sentencia ya autorizada;
las sentencias posteriores vuelven a validar. No se reactivan tokens antiguos.

Todas las funciones de nexo fijan ahora `search_path=pg_catalog,nexo,pg_temp`;
pg_temp queda explícitamente al final. No se publica EXECUTE a PUBLIC y se prueba
la lista exacta de funciones de identidad, provisión y mantenimiento.

## Recuperación, intentos y eventos

Se conservan códigos aleatorios de 32 bytes, SHA-256 almacenado, vigencia de 15
minutos y consumo único con lock de cuenta. La API local solo consume códigos:
no los genera, revela ni envía a nadie. Un proceso offline confiable debe verificar
al solicitante antes de `provision_recovery`. No se implementa un canal real.

Registro y login tienen presupuestos separados: 5 intentos por identificador y
1000 por propósito en ventanas de 15 minutos; también cuentan accesos correctos.
Recuperación limita cada hash de código por separado y tiene su propio global.
Agotar registros o un código inválido no bloquea login ni otros códigos válidos.
Al agotar un global se retorna antes de crear buckets para nuevos identificadores.
Los contadores se saturan y se emite un evento al cruzar el umbral, no uno por
cada repetición bloqueada. Sigue siendo posible provocar bloqueo de un login
conocido o agotar un global: el control de perímetro del piloto sigue pendiente.

`security_events` registra fallos de login/recuperación, umbrales y mantenimiento:
evento tipado, sujeto opcional, hash de bucket, contadores, fecha y principal SQL.
No contiene textos de login, contraseñas, códigos, tokens, IPs ni requests. Los
hashes son seudónimos, no una garantía de anonimato. La tabla tiene RLS sin lectura
para aplicación/identidad/provisión/mantenimiento y trigger contra UPDATE/DELETE.
La revisión local se realiza con la conexión de auditoría confiable del propietario.
Las auditorías de negocio, permisos y roles anteriores se conservan.

## Mantenimiento explícito, sin plazos legales inventados

Nuevo grupo `nexo_maintenance`: NOLOGIN, sin superusuario/BYPASSRLS/CREATEDB/CREATEROLE.
Solo EXECUTE de `maintain_identity`; no emisión, provisión, SELECT privado ni DML.
No hay cron ni limpieza automática. El adaptador local de servidor usa:

```js
const maintenance = createMaintenance(maintenancePool);
await maintenance.run({cutoff: approvedCutoff, batchSize: 100, dryRun: true});
// Tras revisar la política y el resultado:
await maintenance.run({cutoff: approvedCutoff, batchSize: 100, dryRun: false});
```

`approvedCutoff` es obligatorio; no hay retención implícita. Se rechaza un corte
futuro y lotes fuera de 1–1000. Por defecto solo cuenta, no modifica. Cada tabla
procesa hasta batchSize filas por transacción con FOR UPDATE SKIP LOCKED:
sesiones ya expiradas/revocadas, recuperación ya expirada/consumida y presupuestos
cuya ventana de 15 minutos terminó. No elimina sesiones válidas, presupuestos
activos, usuarios, roles, reservas, precios, inventario, permisos, idempotencia ni
auditorías. Cada ejecución que modifica registra cantidades en security_events.
Los locks de mantenimiento no adquieren después locks de cuenta, evitando invertir
el orden de recuperación/emisión. Se prueban trabajadores concurrentes y filas bloqueadas.

Antes de cualquier uso con personas se deben aprobar retención/borrado de sesiones,
recuperación, presupuestos, eventos, idempotencia y backups, tratamiento de reclamos,
acceso de auditores, obligaciones legales y eliminación de identidades. No se fija
un plazo definitivo ni se instala un borrado de auditoría o reservas. Los únicos
plazos expresados arriba son TTL/ventanas técnicas existentes, no retención legal.
