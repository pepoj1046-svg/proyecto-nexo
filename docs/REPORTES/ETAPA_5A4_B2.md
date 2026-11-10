# 5A.4-B2 — tickets firmados y consulta de recibos APP

Estado: implementación de laboratorio en verificación; PR en borrador. B3 no iniciado.
Base exacta: `49ff4ed4897f15986dfc2083f22d2f1a7ebc60d1` (B1 y auditoría nativa).
Rama: `desarrollo/etapa-5a4-b2`, hacia `desarrollo/etapa-5a4-b1`.
Contrato de referencia: `docs/ETAPA_5_RECUPERACION_TRAS_RECARGA.md`, revisión
`076662c5490834b5e08bb5dd101caaad4866a360`.

## Implementación y reutilización

Se reutilizan las sesiones B1 por documento, las reservas QUEUE/ENROUTE nativas,
la idempotencia actor/clave, `nexo.actions`, grupos y precios originales. No se crea
otro inventario, tabla de recibos o lógica de custodia. Las migraciones 001–041
se conservan byte por byte.

El gateway emite una referencia antes del primer envío APP. Congelados cuerpo y
cuenta en RAM, el cliente valida el ticket y confirma su escritura/lectura en
`sessionStorage` antes del POST. El encabezado `X-Nexo-Recovery-Ticket` y la clave
original son obligatorios en `/api/reservations`. Un almacenamiento fallido bloquea
el envío; un reintento manual conserva el ticket ya emitido y el cuerpo congelado.
No existe fallback silencioso ni renovación. CLI/SQL y reservas WALK_IN conservan
sus contratos, sin este encabezado web.

No hay formulario de restauración, listado de tickets ni consulta automática en
la aplicación. Las pruebas consultan el endpoint explícitamente después de
reautenticar. Una recarga pierde el cuerpo RAM, como antes: B2 conserva solamente
la referencia técnica. La experiencia de recuperación queda para B3, sin autorizarla.

## Contrato HTTP cerrado

Ambos endpoints son POST JSON, mismo origen loopback y `Cache-Control: no-store`.
Exigen cookie contenedora B1, documento/generación, CSRF y sesión SQL activa;
la firma por sí sola no autentica. Se mantienen 120 solicitudes/minuto y seis
solicitudes simultáneas, los tamaños, tiempos y retries anteriores.

| Endpoint | Entrada exacta | Resultado |
| --- | --- | --- |
| `/api/recovery/ticket` | `{v:1,family:"RESERVATION_APP"}` | Ticket nuevo; no acepta claves ni fechas del cliente; no escribe negocio. |
| `/api/recovery/receipt` | `{v:1,ticket}` | `{state,family,key,environmentId,observedAt,receipt?}` autorizado; no requiere cuerpo original. |

Ticket v1, máximo 512 bytes: `v`, `app:"proyecto-nexo/lab"`, `environmentId`,
`accountRef` opaco, `family:"RESERVATION_APP"`, `key` UUID generado por servidor,
`createdAt`, `expiresAt=createdAt+1800000` y `seal` HMAC-SHA-256/base64url.
La firma incluye además el origen esperado. Secreto aleatorio de 256 bits sólo
RAM; no se registran secreto, cookies, CSRF, tokens SQL o contraseñas.
No hay cuerpo/hash de cuerpo, consentimientos, manifiestos, menores o recibos.

`RECORDED` incluye sólo `receipt:{operation,groupId,bookingIds,originalStatus}`.
`operation` es `reserve` o `reserve_enroute`; IDs completos, propios y únicos.
`originalStatus` es el estado del recibo original, nunca una promesa de estado
actual, salida, custodia o plazas vigentes. Un fallo de consulta posterior no
transforma un recibo en rollback.

`NOT_OBSERVED` significa ausencia observable o escritor aún en curso; nunca
rollback, cancelación, liberación ni permiso para generar otra intención.
Errores cerrados: 401 `REAUTHENTICATION_REQUIRED`; 403 `RECOVERY_UNAVAILABLE`;
400 `INVALID_RECOVERY_TICKET`; 410 `RECOVERY_TICKET_EXPIRED` o
`ENVIRONMENT_CHANGED`. Errores de transporte, 429/503 conservan incertidumbre.

## Proyección SQL 042 y concurrencia

No existía una consulta APP segura por actor/familia/clave: `nexo.actions` no tiene
SELECT para `nexo_app`; los recibos administrativos 041 tienen otra autoridad y
sus operaciones pueden bloquear/escribir. Se añade exclusivamente
`nexo.web_app_reservation_receipt(text)` y su adaptador cerrado.

Función VOLATILE SECURITY DEFINER con `search_path=pg_catalog,nexo,pg_temp`,
EXECUTE sólo `nexo_app`; revocado PUBLIC/identity/provisioner/maintenance. Actor
obtenido por sesión SQL. Verifica operación, source APP, IDs del grupo completo,
propiedad actual y creador, y `can_read_route`; no confía en RLS implícita del
propietario ni expone payload/result arbitrario. Un vínculo cambiado no concede
recuperación al nuevo responsable por conocer una referencia.

Transacción READ COMMITTED READ ONLY, actor antes/después, bloqueo asesor compartido
try-only en el mismo namespace del escritor. Nunca ejecuta expiración de holds,
reserva, enriquecimiento comercial ni auditoría de negocio. Un escritor que aún
posee el bloqueo devuelve NOT_OBSERVED; después de COMMIT puede leerse el recibo;
tras ROLLBACK sigue incierto. Actor y contexto B1 se revalidan tras esperas SQL y
la firma/vigencia se comprueban antes de devolver información privada.

## Reloj, reinicio, almacenamiento y límites

El plazo de treinta minutos no se renueva por consulta, login, recarga o reintento.
Se usa tiempo monotónico anclado al reloj del servidor; retroceso, divergencia
superior a un segundo o suspensión no evaluable invalidan la época completa.
Esa tolerancia detecta anomalías de reloj: no amplía el TTL ni el timeout HTTP.

Reiniciar el gateway cambia secreto y environmentId. Fallos de los pools invalidan
la época; además se compara `pg_postmaster_start_time()` y OID de la base antes de
emitir/consultar/escribir y después de consultar. Una restauración en caliente
bajo el mismo postmaster/OID queda fuera de soporte: detener y reiniciar el
listener es condición del laboratorio, nunca reutilizar una época tras restaurar.

Namespace único `nexo.lab.recovery.v1`, envoltura cerrada v1, hasta ocho tickets,
máximo 8192 bytes; sin almacenamiento persistente adicional. Si está corrupto,
lleno o bloqueado, no se envía negocio ni se elimina un intento válido para
hacer sitio. Logout/cambio de cuenta elimina referencias propias; login conserva
sólo cuenta y entorno originales; recibo y consulta actual confirmados retiran
su ticket. No se afectan otras claves del navegador. Si el navegador prohíbe
limpiar, no se promete borrado físico: el descriptor es inerte sin autenticación
y su validez termina en servidor. B2 no implementa limpieza visual tras recarga.

SessionStorage puede copiarse al duplicar una pestaña y XSS puede robar capacidades
del documento. Ni ticket ni identificador de documento sustituyen password,
CSRF y sesión SQL. No se promete seguridad universal de navegadores, recuperación
tras cierre/destrucción del entorno ni restauración de reservas a los treinta
minutos. No usar en producción.

## Pruebas y evidencias (se actualiza al completar)

- 26 pruebas dirigidas unitarias aprobadas: firma, alteraciones, vencimiento exacto,
  anomalías de reloj, almacenamiento mínimo/bloqueado/lleno, preflight, cuerpo
  original, respuestas tardías y orden de autenticación B1.
- 11 pruebas dirigidas PostgreSQL 18.4 aprobadas (B2-01–11): recibos
  propios, familias, split/expreso/enroute, permisos, COMMIT/ROLLBACK bajo bloqueo,
  cuatro replay concurrentes, revocación real durante espera, HTTP y reinicio.
- Actualización 041 poblada →042: mismas tablas/datos/checksums, firmas, OID y ACL
  de todas las funciones existentes; sólo una función nueva, reejecución vacía.
- Batería unitaria inicial completa: 114/114 aprobadas.
- PostgreSQL local completo: 418/418 aprobadas en la batería inicial más B2-10/11
  dirigidas, 2/2. CI ejecutó 420/420 en Ubuntu/Windows con Node 22/24.
- E2E B2 dirigidas: 3/3 por proyecto, escritorio y móvil; SIGINT y reinicio real
  aprobados, incluyendo invalidación del ticket anterior.
- CodeQL de la implementación inicial `77fc27b`: aprobado.
- Primera matriz CI `42735726694`: los cuatro trabajos de dominio/PG aprobaron;
  los trabajos web detectaron una petición antigua sin ticket en operations.
  Se corrige exclusivamente la petición de prueba, conservando NO_CAPACITY/409
  y todos los testigos de inventario, custodia y auditoría. No es sobreventa ni
  se elimina el preflight B2. Se repite la batería web afectada y la matriz del
  commit corregido; resultados finales en el informe de verificación del PR #12.

Pruebas nuevas: `tests/recovery-tickets.test.mjs`,
`tests/recovery-ticket-storage.test.mjs`, adiciones B2 a
`tests/integration/postgres.test.mjs`, `tests/web/recovery-ticket-contract.spec.mjs`
y `tests/web/recovery-ticket-storage.spec.mjs`. Se conservan las regresiones
5A.2/5A.3/B1. Evidencias ficticias E2E en `.local/5a4-b2-evidence/`, artefactos CI
sin credenciales ni trazas completas. No publicar `.local` entero.

Incidencias de desarrollo: se ajustaron fixtures de split/FIFO al contrato vigente,
el login después de recarga a la pantalla existente, y el selector de error al
`role=alert` real. No se elevaron tiempos ni se debilitaron aserciones de integridad.
Se reprodujo además un defecto de presentación nuevo: consultar el listado tras
un almacenamiento fallido cambiaba a «incierto» aunque no se hubiera enviado nada.
Se conserva REFERENCE_REQUIRED después de esa lectura, con cero POST y el mismo
ticket, comprobado por regresión unitaria y E2E. La validación web intermedia
se detuvo para estabilizar esta corrección antes de la ejecución final.
Una espera real sobre actions demostró clasificación genérica tras revocación:
la revalidación inmediatamente después de leer actions ahora exige sesión vigente.

## Reproducción Windows

Con Node 22 o 24 y herramientas del laboratorio instaladas:

```powershell
npm ci --no-fund
npm run test:all
npx --no-install playwright install chromium
node scripts/test-web.mjs --suite=recovery-ticket-contract.spec.mjs,recovery-ticket-storage.spec.mjs
npm run test:web
```

`npm run dev:web` crea sólo base local ficticia y muestra el acceso temporal.
Elegir viaje, login, revisar y confirmar: se emite y guarda ticket antes del POST.
Con almacenamiento bloqueado no se envía reserva. La interfaz no ofrece recuperar
un ticket tras recargar: ése es el límite deliberado de B2, no una función omitida
que deba simularse. Las pruebas consultan el recibo por HTTP autenticado y usan
un testigo SQL independiente de sólo lectura.

## Dictamen provisional y pendientes

No declarar cerrado B2 hasta completar las verificaciones del commit final y la
revisión del propietario. B3 y etapas posteriores no autorizadas. Ningún PR previo
se modifica o fusiona; la API sigue exclusivamente local, sin gastos ni datos reales.
