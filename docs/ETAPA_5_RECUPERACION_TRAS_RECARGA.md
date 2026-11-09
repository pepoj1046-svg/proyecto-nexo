# 5A.4-A — Diseño de recuperación tras recarga

Estado: **propuesta para revisión; ninguna funcionalidad implementada**.
Fecha de revisión documental: 9 de noviembre de 2026.

Repositorio `pepoj1046-svg/proyecto-nexo`. Base exacta:
`3d16680f491ff2c516eb1796b0954a717b49a153`, 5A.3, [PR #9](https://github.com/pepoj1046-svg/proyecto-nexo/pull/9).
Rama exclusivamente documental: `planificacion/etapa-5a4-a`, desde ese SHA.
La autorización de este diseño prevalece sobre el alcance histórico 4A.6 de
AGENTS.md; sus reglas de aislamiento siguen vigentes.

## 1. Conclusión y alcance de la propuesta

**La base permite repetir una operación con su cuerpo original, pero no ofrece
una consulta web por cuenta, familia y clave sin ese cuerpo.** Los recibos existen
en PostgreSQL; no deben exponerse directamente ni leerse con el pool propietario.
Recargar pierde la RAM de 5A.2/5A.3 y, por tanto, también el cuerpo necesario para
repetir. Guardar solamente una clave no elimina esa limitación.

Se recomienda un primer contrato para **reservas APP**, tanto QUEUE como ENROUTE,
incluidos expreso y división ya admitidos. La recuperación nueva sería únicamente
de lectura. Consultar un recibo no repite una reserva ni registra presencia,
abordaje, salida, recepción, custodia o consentimiento.

La propuesta necesita, tras aprobación expresa:

1. Una proyección SQL aditiva y cerrada de recibos APP, sin tablas nuevas.
2. Un endpoint de consulta que la utilice con autenticación renovada.
3. Emisión previa de un ticket con integridad y fechas del servidor. Una fecha
   editable en sessionStorage no acredita por sí sola un máximo de treinta minutos.
4. Un arranque de documento privado que exija reautenticación y oculte todos los
   datos anteriores, independientemente de que el almacenamiento exista o sea válido.

Los puntos 3 y 4 son contratos nuevos a revisar, no capacidades existentes. Su
impacto sobre sesiones y pestañas compartidas se expone en la sección 10. No se
inicia 5A.4-B al aprobar o publicar este documento.

### Decisiones del propietario ya aceptadas

- Recuperación tras recargar y restaurar la misma pestaña cuando el navegador lo permita.
- Vigencia local máxima de treinta minutos desde la creación, sin renovación automática.
- sessionStorage como candidato mínimo, sin promesa de restauración universal.
- Dispositivo compartido, con reautenticación de la cuenta original antes de mostrar datos privados.
- Ningún reenvío automático, operación offline, cuerpo, contraseña, cookie, CSRF,
  consentimiento, manifiesto ni dato de menores almacenado en el ticket.
- PostgreSQL conserva la autoridad de operaciones, recibos, permisos y capacidad.

No se vuelven a solicitar esas decisiones. Lo pendiente es aprobar el mecanismo
concreto que puede cumplirlas y el alcance inicial por familia.

## 2. Evidencia estática de la base exacta

Las rutas siguientes pertenecen al SHA base. La inspección de código es evidencia
estática, no una prueba de ejecución de los contratos nuevos.

| Evidencia | Capacidad comprobada y límite |
| --- | --- |
| [reservation-attempt.ts](../apps/web/src/reservation-attempt.ts#L28) | Attempt conserva cuenta, clave y cuerpo; received conserva respuesta, todo en RAM. submit llama write con el intento original; consult solo consulta. No serializa un ticket. |
| [use-command.ts](../apps/web/src/use-command.ts) | Mapa RAM con clave, cuenta, cuerpo congelado y recibo. retry necesita el intento; consult no reemplaza un resultado incierto por una prueba de éxito. |
| [private-api.ts](../apps/web/src/private-api.ts) | Cookie same-origin, CSRF e Idempotency-Key; límite de espera de 18 s. Agrupa solo GET de sesión en vuelo y ordena login/logout; no almacenamiento persistente. |
| [private-read.ts](../apps/web/src/private-read.ts#L4) | POST de lectura ligado al CSRF original y comprobación posterior de accountRef; evita sustituir la consulta por datos B durante A → B → A. |
| [web-gateway.mjs](../src/http/web-gateway.mjs) | Tabla cerrada de handlers. Los POST privados pasan CSRF y actor. No registra rutas recovery/ticket o recovery/receipt. |
| [web-sessions.mjs](../src/http/web-sessions.mjs) | Handles y CSRF opacos en RAM; login crea sesión web nueva. session puede devolver una cuenta ya autenticada sin pedir otra contraseña. No expone un identificador de ejecución ni una atestación de reautenticación por documento. |
| [001_core.sql](../database/migrations/001_core.sql#L78) | actions tiene actor_id, action_key, payload y result; PK(actor_id, action_key). **No tiene created_at, familia como columna ni TTL de ticket.** |
| [002_operations.sql](../database/migrations/002_operations.sql#L13) | action_start serializa actor+clave con advisory lock y compara todo el payload antes de devolver result. action_finish inserta el recibo dentro de la transacción de negocio. |
| [001, permisos](../database/migrations/001_core.sql#L133) y [002, ACL](../database/migrations/002_operations.sql#L227) | actions tiene RLS habilitada, sin política/grant SELECT para nexo_app. action_start/action_finish son helpers internos, sin EXECUTE concedido a runtime. No abrirlos para esta función. |
| [012_business_operations.sql](../database/migrations/012_business_operations.sql#L2) | reserve_business delega en reserve y valida la cotización dentro de la transacción; su enriquecimiento no es una consulta independiente por clave. |
| [029_queue_assignment.sql](../database/migrations/029_queue_assignment.sql) | reserve y reserve_enroute conservan las claves originales y ajustan recibos dentro de la misma transacción para asignación directa. No convertir recibos históricos HELD en CONFIRMED por inferencia. |
| [web-reservation-service.mjs](../src/db/web-reservation-service.mjs) | reserve confirma el núcleo y luego enriquece la respuesta mediante otras consultas: un fallo HTTP posterior puede ocurrir después del COMMIT. me deriva accountRef de SHA-256 del UUID del actor, truncado a 32 hexadecimales; no es identidad legal. |
| [031_care_responsibilities.sql](../database/migrations/031_care_responsibilities.sql#L73) | care_link_code guarda un código en el result de actions, ligado a la sesión que lo creó. Un nuevo login no renueva ese código ni permite devolverlo mediante una consulta genérica de recibos. |
| [041_administrative_receipt_reads.sql](../database/migrations/041_administrative_receipt_reads.sql) | La lectura del recibo de flota/configuración evita depender de un lock ajeno, pero ocurre dentro del comando, después de action_start(k,p). Exige el cuerpo original; admin_receipt_actor exige permisos administrativos, no sirve como lector universal. |
| [PostgreSQL, 5A2-PG1/PG2](../tests/integration/postgres.test.mjs#L2675) | Ya hay escenarios de COMMIT con enriquecimiento fallido y replay concurrente de grupo dividido. Demuestran recibo con reenvío autorizado del cuerpo original, no recuperación tras recarga sin cuerpo. |
| [contrato 5A.2](ETAPA_5_RECUPERACION_RESERVAS.md), [inventario 5A.3](ETAPA_5_MOVIL_Y_COMANDOS.md) y [ratificación](https://github.com/pepoj1046-svg/proyecto-nexo/pull/9#issuecomment-6620847244) | Son antecedentes. Sus resultados históricos no se atribuyen a una ejecución nueva de 5A.4-A. |

**Demostración de la brecha:** las rutas actuales solo ofrecen listas/consultas
por entidades y comandos con cuerpo validado; ninguna recibe exclusivamente una
clave para leer un recibo. El runtime no puede seleccionar actions ni invocar sus
helpers internos. action_start necesita el payload completo y rechaza otro con
IDEMPOTENCY_CONFLICT. Un operador propietario podría consultar SQL, pero eso no
constituye una capacidad segura del gateway. Coincidir por ruta, precio, grupo o
primera página tampoco identifica qué solicitud produjo la reserva.

## 3. Inventario por familia

Leyenda: **P** = candidato al piloto propuesto; **D** = material suficiente para
diseñar una proyección posterior, pero autorización/DTO por revisar; **X** = no
recuperable por este mecanismo. En la base **ninguna** de estas familias tiene
consulta web de recibo sin cuerpo. P/D no significan funcionalidad implementada.

| Familia web | Recibo nativo / discriminación comprobada | Clasificación y condiciones |
| --- | --- | --- |
| Reservas APP QUEUE, grupo unido, expreso/dividido | reserve: payload.op=reserve y request.source=APP; result con groupId, bookingIds y estado original. 002/012/029; web-reservation-service. | **P**. Cuenta creadora y pasajera actual de todas las partes; conservar tarifa, grupo y asignación. |
| APP ENROUTE | reserve_enroute con trip y request.source=APP; resultado con bookingId/groupId y estado. 019/029. | **P**. Misma propiedad y lectura actual autorizada; no reabrir recogidas ya sobrepasadas ni ofertas vencidas. |
| Reserva presencial WALK_IN | reserve con request.source=WALK_IN; created_by es el operador, passenger_id puede ser NULL. web-terminal-service y 012/029. | **D**. Solo operador original con alcance vigente por asociación/ruta/terminal. Una referencia no permite al responsable reclamar ese recibo; su acceso propio usa el vínculo existente. Fuera del piloto. |
| Presencia, verificación y solicitudes de recogida | correct_arrival / terminal_command y episodio; web-operations-service, 015/016. | **D**. Leer el registro no renueva su vigencia ni demuestra abordaje. Autorizar por reserva y tipo de actor, no solo por ser autor del recibo. |
| BOARD/ALIGHT individuales o de grupo | web_observation y recibo interno derivado; 024 y núcleo de observaciones. | **D**. Consultar solo la clave exterior y proyección mínima. Chofer/operador debe conservar permiso actual; no reconstruir un hecho físico desde el ticket. |
| Aceptación/rechazo de oferta | respond; 013/019/029 y servicios operations/terminal. | **D**. No restaurar ofertas expiradas ni rechazo discrecional de terminales. Autor original y asignación/permiso de lectura vigentes. |
| Salida, progreso, recogidas urbanas, retorno a fila | depart, progress, begin_urban, fleet_command, request_queue; 003/017/019/026. | **D**. Estado histórico distinto de estado actual. Recibo no autoriza otra salida, regreso o movimiento. Las claves internas derivadas no se enumeran. |
| Sustituciones, rescates, traslado y rehabilitación | group_consent, approve_terminal_transfer, terminal_incident_reassign, road_command, fleet_command, restore_vehicle; servicios recovery y 016–019/030. | **D**. Permisos actuales sobre entidades resultantes y origen/destino. No devolver manifiestos o snapshots internos ni reutilizar consentimientos. |
| Recepción segura y discrepancias | handoff / passenger_discrepancy; web-safety-service y 030/032. | **D**. Recepción requiere chofer receptor; reporte requiere responsabilidad actual. Solo confirmación del registro, nunca rectificación o custodia automática. |
| Cancelación/revisión administrativa | web_admin_cancel, cancel, condition_decision; web-management-service y 027. | **D**. Revalidar todas las partes y alcance de terminal; sin reembolso, multa o nueva cancelación. |
| Condiciones y decisiones del responsable | web_declare_condition, web_condition_choice; 028/032 y web-condition-service. | **D**. No convertir una decisión histórica en consentimiento para otra versión/responsable. |
| Responsables, menores, ausencias, excepciones y revisiones | care_responsibility, care_minor, care_absence, care_review, care_exception, care_account; 031/032/035 y web-care-service. | **D**, excluidas del piloto. Hace falta un DTO sin datos de menores y predicados de care_access vigentes. Ni un recibo propio concede autoridad tras corregir el vínculo; ausencia no libera plazas. |
| Código de vinculación de responsable | care_link_code; result.code está ligado a una sesión anterior. | **X** para recuperar el código/capacidad. No almacenarlo, devolverlo ni regenerarlo desde un ticket. Nueva emisión necesita otra actuación explícita; el historial no renueva autoridad. |
| Administración de choferes/contacto | existing_driver_access / association_contact; 035. | **D**. Autor original más driver_admin_lock/ámbito vigente. Proyección futura excluye datos de contacto del ticket y no vuelve a cambiar permisos. |
| Plataforma, flota, rutas/tarifas | platform_admin / fleet_admin / route_and_fare_config; 036/038/039/041. | **D**. Las familias son distintas de la URL y de los subcomandos. Revalidar platform_actor/config_actor y asociación/alcance; excluir body, códigos, motivos y contexto privado de cualquier retorno genérico. |
| Login/logout, contraseña, recuperación de cuenta, mantenimiento | Sesiones/eventos propios de identidad; no son recibos de reserva recuperables por familia+clave. | **X**. No recuperar contraseñas, sesiones revocadas ni capacidades de identidad. El mantenimiento CLI no se expone al navegador. |
| Catálogo, cotización, páginas y manifiestos de lectura | Consultas, no una actuación idempotente registrada en actions por la clave HTTP. | **X** como recibo. Reconsultar según permiso actual; no persistir resultados, parámetros privados o cursores para aparentar continuidad. |

La PK es **actor+clave, no actor+familia+clave**. Cambiar family no permite reutilizar
la clave en otro dominio. El servidor debe verificar el discriminador real y sus
subcampos; nunca devolver result porque solo coincidan actor y clave. Las claves
externas e internas que generan wrappers tampoco son intercambiables.

## 4. Ticket v1 mínimo y plazo fijo

### 4.1 Campos serializados propuestos

Un solo namespace propio de sessionStorage: `nexo:recovery:v1`. Contenedor
versionado con entradas estrictas; sin escribir ni limpiar claves de otros módulos.

| Campo | Contrato |
| --- | --- |
| v | Entero 1. Otras versiones no se interpretan con un esquema permisivo. |
| app | Constante `proyecto-nexo/lab`; no una URL que el ticket pueda seleccionar. |
| environmentId | UUID aleatorio de esta ejecución del gateway. No es el puerto, el hash de cuenta ni X-Request-Id. |
| accountRef | 32 hexadecimales derivados por el servidor con el contrato existente; pseudónimo, no credencial. |
| family | Enumeración cerrada. Piloto: únicamente RESERVATION_APP. |
| key | UUID aleatorio generado por el servidor antes del primer envío. Compatible con actionKey actual; no se admite una clave antigua como entrada de emisión. |
| createdAt | Milisegundos enteros de creación del descriptor, emitidos por servidor. |
| expiresAt | Exactamente createdAt + 1 800 000 ms. Nunca se actualiza al leer, autenticar o recargar. |
| seal | HMAC-SHA-256 en base64url, sobre todos los campos y el origen esperado; clave de firma solo en RAM del servidor. No concede acceso sin login y autorización SQL. |

No serializar received, estado de reserva, resultado, nombres, teléfono, ruta,
precio, IDs de reservas/viajes/miembros, cuerpos, huellas de cuerpos/consentimientos,
contraseñas, cookie, CSRF, token SQL, códigos de vinculación, manifiestos ni datos
de menores. El recibo consultado después de autenticar se conserva únicamente en RAM.
Un hash del cuerpo también puede filtrar decisiones de baja entropía: se excluye.

El sello es integridad de un localizador, no un secreto de autenticación ni un
token bearer. El pseudónimo y la clave siguen siendo metadatos sensibles y no se
muestran antes del login original. No se promete cifrado del almacenamiento.
El ticket no acredita el cuerpo perdido ni firma un consentimiento: el recibo
describe lo registrado por PostgreSQL, no una reconstrucción de lo que el cliente
pretendía enviar.

Propuesta de límites técnicos: ocho entradas y 8 KiB máximos del contenedor UTF-8,
512 bytes por ticket. Validar esquema, tipos, tamaño, UUID, campos permitidos y
fechas; rechazar campos extra y objetos anidados inesperados. No sobrescribir ni
expulsar silenciosamente un ticket vigente para aceptar otra operación. La revisión
puede reducir estos límites sin convertirlos en políticas comerciales.

### 4.2 Emisión previa e integridad del plazo

La base no contiene created_at en actions. No estimar la creación a partir de una
reserva, auditoría, estado local, reloj del navegador o UUID. Tampoco añadir una
fecha retrospectiva inventada a recibos históricos.

Se propone que el servidor emita **clave nueva y descriptor juntos**, antes del
primer comando. Firma una representación canónica con tipos/orden definidos,
incluyendo v, app, origen loopback esperado, environmentId, accountRef, family,
key y ambas fechas. Genera un secreto independiente de sesiones/CSRF al iniciar
el gateway. Verifica longitudes y compara MAC en tiempo constante. Reiniciarlo
invalida el secreto y environmentId; no guardar esa clave en Git, disco o navegador.

La emisión no acepta key ni fechas del cliente: no puede envolver una clave
incierta antigua con otros treinta minutos. Cada emisión tiene otra clave. Leer
un ticket devuelve las mismas fechas; no lo vuelve a firmar. Si se pierde la
respuesta de emisión, aún no hay comando de negocio autorizado por ese flujo:
una emisión manual nueva no recupera ni renueva la anterior.

Se necesita guardar el descriptor correctamente **antes** de despachar el primer
comando, revalidar la cuenta y conservar el cuerpo original solo en RAM durante
ese documento. Recargar entre emisión y envío conduce a consulta, nunca a completar
automáticamente el envío. No convertir un intento 5A.3 sin descriptor previo en
uno recuperable tras perder su cuerpo.

La confirmación inicial congela ese cuerpo en RAM y activa la guardia antes del
primer await, incluida la emisión. Doble clic o navegación no pueden iniciar otro
envío. Antes de persistir y despachar se comprueban cuenta de cotización, descriptor,
boot y contexto actuales; una respuesta tardía de emisión no presta el intento a
otra cuenta. No recalcular cotización, grupos o consentimientos mientras se espera.

El servidor es autoridad del vencimiento lógico. Proponer reloj de proceso
monótono anclado al inicio para medir el intervalo, con fechas de referencia
firmadas. Ante retroceso/anomalía del reloj del servidor o suspensión no evaluable,
invalidar la época de recuperación y fallar cerrado; no extender plazos. Cambiar
el reloj del cliente no extiende la validez. Esta propiedad debe demostrarse con
reloj controlado en B; no está implementada por Date.now de la base.

La vida del laboratorio acopla gateway y base: reiniciar/restaurar/reemplazar la
DB requiere detener el listener y crear otra época de recuperación. No se soporta
intercambiar datos bajo un gateway activo manteniendo su secreto. Pérdida de la
vinculación del pool o duda sobre esa ejecución debe invalidar la recuperación,
no reconectar silenciosamente aceptando tickets del entorno anterior.

**Vigencia no significa borrado físico garantizado:** al estar el navegador cerrado
no corre un temporizador que borre sessionStorage a los treinta minutos. El servidor
rechaza el ticket vencido y la aplicación lo limpia al volver a ejecutarse. Si se
exigiera destrucción física verificable al minuto treinta, este almacenamiento no
puede prometerla y habría que revisar el requisito antes de B.

### 4.3 Limpieza y fallo de almacenamiento

- Comprobar/restaurar solo el namespace propio. Dato corrupto, versión desconocida,
  plazo vencido, otra ejecución u origen incompatible: invalidar sin reenviar.
- Logout explícito elimina los tickets de la cuenta del documento y borra su RAM.
  En la terminal compartida, cambiar de cuenta cierra la recuperación anterior y
  purga sus tickets; no muestra la cuenta anterior ni transfiere la referencia.
  Un login equivocado durante recuperación muestra un rechazo genérico y permite
  volver a autenticar A, sin renderizar datos de A o B. A → B → A nunca restaura
  una respuesta antigua sin consulta nueva.
- Un recibo válido con lectura actual fallida conserva el ticket hasta resolver,
  descartar explícitamente o vencer, con sus fechas originales. Una consulta
  completa autorizada puede retirarlo. Limpiar el ticket no borra el recibo SQL.
- Descartar una referencia requiere explicar que solo elimina ayuda local; no
  cancela, libera plazas, prueba rollback o habilita repetir una actuación distinta.
- Acceso a sessionStorage, parseo y escritura pueden fallar. Para el modo de
  recuperación propuesto, fallar antes del primer envío y comunicarlo; no enviar
  silenciosamente una operación prometiendo que se recuperará tras recarga.
  Una alternativa explícita RAM-only sería una decisión adicional de producto.
- No existe garantía de exclusividad de pestaña: duplicar/window.open puede copiar
  sessionStorage. Ni tabId ni una bandera local prueban unicidad. El clon exige el
  mismo login y solo consulta; no se propone un bloqueo distribuido ficticio.

## 5. Propuesta mínima de transporte y RPC

Todos los nombres siguientes son **propuestos e inexistentes en la base**.
No se ha creado ningún endpoint, RPC, tabla o ticket. La revisión debe aprobar
también el arranque de sesión de 5.1 antes de habilitar lectura privada restaurada.

### 5.1 Arranque y reautenticación en equipo compartido

GET /api/session con authenticated=true **no demuestra una contraseña introducida
en el documento restaurado**. Un gate activado solo por presencia del ticket puede
evadirse borrando o corrompiendo el almacenamiento; no basta para la garantía de
privacidad solicitada.

Se propone un arranque de documento con estas condiciones:

1. Cada carga completa del HTML de la aplicación crea una época de documento
   (bootId) y un contexto web anónimo. Se retira de la RAM del gateway el handle
   previo de esa cookie antes de servir el documento; no se cancela ni revierte
   ninguna operación SQL. El token SQL nunca estuvo en el navegador.
   Este cambio ocurre después de los controles de transporte/origen, solo para
   HTML de la aplicación; un asset, origen ajeno o petición rechazada no reinicia
   sesiones. No invalida todas las sesiones SQL de una cuenta.
2. La respuesta HTML contiene solo la pantalla pública/bloqueada. Ningún panel
   privado, código, recibo, familia de ticket o consulta privada se monta o publica
   antes de una contraseña válida mediante el login existente. En recuperación,
   los demás paneles permanecen bloqueados hasta verificar también sello y cuenta
   original en servidor; no basta comparar el accountRef editable del ticket.
   La regla no depende
   del ticket; evita saltarse el gate borrándolo. Navegación SPA dentro del documento
   ya autenticado conserva el contrato existente.
3. El servidor asocia el nuevo login a ese bootId en su RAM. GET de sesión o una
   bandera en Web Storage no sustituyen esa evidencia. Sesión/login pueden exponer
   environmentId y bootId no sensibles; CSRF continúa solo en memoria/cookie según
   el mecanismo actual. No agregar secretos al ticket ni nuevos proveedores.
4. La restauración desde bfcache exige el mismo gate: ocultar/limpiar datos en
   pagehide antes de congelar, invalidar generaciones y volver al arranque anónimo
   del servidor al restaurar. No reutilizar una captura DOM o una promesa en vuelo
   como prueba de reautenticación. Debe probarse pageshow.persisted; el no-store
   existente no se toma como garantía universal de ausencia de bfcache.
5. El lector de recuperación comprueba que el handle/bootId siguen registrados y
   ligados a esa autenticación **antes y después** de la lectura SQL. El actor del
   context capturado no prueba por sí solo que su entrada siga en el Map después
   de una espera; createWebSessions.actor actual no comprueba esa pertenencia.
6. La UI compara cuenta original, época de ejecución/documento, CSRF en RAM,
   identificador de consulta y generación antes de publicar. Un cambio de sesión,
   logout o A → B → A descarta respuestas antiguas y exige una lectura nueva.

Es un cambio deliberado del ciclo de sesión a revisar: otra pestaña que compartía
esa cookie puede recibir 401 y debe conservar sus intenciones RAM según 5A.3.
No se afirma aislamiento de cookies entre pestañas ni se revocan por recuperar
todos los dispositivos de una cuenta. Las operaciones SQL ya autorizadas pueden
terminar; el gate no prueba su rollback. El manejo de HTML/pagehide/bfcache es un
gate de aceptación, no una capacidad demostrada con la inspección actual.

Este mecanismo protege la vista restaurada y el acceso mediante el handle retirado.
No borra fotografías, miniaturas del navegador/SO, datos ya vistos ni otra pestaña
previamente autenticada y abierta. La entrega física del equipo requiere un cierre
de sesión efectivo; no prometer privacidad forense ni protección contra XSS activo.

### 5.2 Emisión: POST /api/recovery/ticket

- Entrada cerrada: `{v:1,family:"RESERVATION_APP"}`. Sin actor, key anterior, fechas,
  associationId, SQL, URL de retorno o parámetros del comando.
- Exige sesión web autenticada mediante login de ese boot, todavía vigente, CSRF/Origin y actor SQL
  vigentes. Genera key, fechas y seal; devuelve exclusivamente el ticket v1.
- La consulta de identidad usa el pool correspondiente existente; firmar metadatos
  no inserta actions ni modifica reservas, recibos o auditoría de negocio.
- Un ticket emitido no confirma que se haya enviado ni recibido una reserva. No se
  reutiliza la caducidad de la sesión de una hora como TTL del ticket de treinta minutos.
- No hay reemisión con otra fecha para una clave existente. Retomar un ticket usa
  únicamente el endpoint siguiente. Esta emisión previa adicional es necesaria
  para acreditar el plazo sin una nueva tabla de metadatos.

### 5.3 Consulta: POST /api/recovery/receipt

- Entrada cerrada: `{v:1,ticket:<ticket v1>}`. Lectura explícita de **una** clave;
  sin body original, filtros, lotes, roles, asociaciones o paginación de actions.
- Pasar por los handlers privados cerrados: Origin exacto, CSRF del contexto nuevo,
  cookie HttpOnly/SameSite, JSON y límites actuales. No GET, query string, URL
  derivada del ticket o Idempotency-Key que invoque una escritura.
- Tras autenticar, validar sello, versión, aplicación, origen esperado, ejecución, plazo fijo y
  familia; derivar actor de sesión SQL y comparar accountRef. Revalidar handle y
  boot. Comprobar nuevamente el plazo justo antes de responder: una consulta
  iniciada antes de vencer no extiende la referencia mientras espera. Una firma
  válida no reemplaza permisos o reautenticación.
- El HTTP 200 es una respuesta a la consulta, no una nueva reserva. Respuestas
  privadas usan no-store. No registrar claves completas, sellos, cuerpos o resultados
  en URLs, telemetría, consola, eventos ni mensajes de error.

| Respuesta propuesta | Significado y DTO permitido |
| --- | --- |
| 200 / RECORDED | Hay recibo APP de esa cuenta, de la familia esperada y con referencias actualmente autorizadas. Devolver family, key, environmentId, observedAt y `receipt:{operation,groupId,bookingIds,originalStatus}`. operation solo reserve/reserve_enroute; IDs completos y únicos, sin campos arbitrarios. |
| 200 / NOT_OBSERVED | No se observó un recibo autorizado en esta consulta, incluida contención no resuelta. Sin IDs ni resultado. **No significa no ejecutada ni autoriza un reenvío.** |
| 401 / REAUTHENTICATION_REQUIRED | No hay autenticación original vigente en el boot actual; ocultar datos y recuperar acceso mediante login. |
| 403 / RECOVERY_UNAVAILABLE | Cuenta distinta, permiso/propiedad insuficiente, familia real diferente o resultado no proyectable. Igual forma sin confirmar existencia del recibo ajeno o motivo privado. |
| 400 / INVALID_RECOVERY_TICKET | Esquema/firma no válidos; no consultar actions con datos no verificados. |
| 410 / RECOVERY_TICKET_EXPIRED o ENVIRONMENT_CHANGED | Referencia inválida para recuperación. No renovar ni consultar el entorno anterior. |
| 429 o 503 | Mantener incertidumbre y ofrecer consulta manual posterior sin cambiar key/fechas; respetar límites existentes, sin tormenta de consultas. |

El DTO de recibo no es el ReservationReceipt enriquecido de 5A.2 y no se inyecta
en su máquina como si tuviera cuerpo original o estado actual. Se necesita una
máquina de consulta restaurada separada. `originalStatus` es el valor guardado,
no CONFIRMED por defecto. No devolver payload ni result crudos: podrían contener
un código de vinculación, datos de otros grupos o subcomandos incompatibles.

El cliente tampoco publica una respuesta entregada tarde si la referencia ya no
es válida. Para representar tiempo restante puede usar observedAt del servidor
y un margen conservador que reste el RTT medido con reloj monótono; nunca asignar
otros treinta minutos al recibirla. Si no puede evaluar la vigencia, vuelve al
gate y la consulta manual, sin mostrar un recibo como recién recuperado.

Para consultar estado actual se reutiliza POST /api/reservations/page y su
paginación OWN, con CSRF original y generación vigente. Identificar por bookingIds
autorizados, no coincidencias de precio/ruta. Una página incompleta no prueba ausencia;
no se requiere que todos los IDs estén en sus primeros cincuenta registros. Si esa
consulta falla, distinguir recibo observado de lectura actual pendiente; nunca
convertir ese fallo en un nuevo POST de reserva.

### 5.4 RPC aditiva propuesta y límites de RLS

Propuesta: `nexo.web_app_reservation_receipt(k text)` devuelve únicamente la
proyección anterior o NOT_OBSERVED, en una transacción READ COMMITTED READ ONLY.
La familia del piloto es fija: no pasar nombre de función, tabla, actor ni SQL.

Contrato SQL requerido antes de implementarla:

1. require_actor y revalidación de sesión real/identidad vigente, usando el token
   de contexto establecido exclusivamente por el servidor. nexo_app conserva
   NOSUPERUSER/NOBYPASSRLS y no adquiere credenciales de identidad o propietario.
2. Buscar la PK **actor_id=actor actual AND action_key=k**, con una sola fila
   candidata. La familia deriva de payload.op y source, no de un campo del cliente.
   Solo reserve/reserve_enroute y request.source=APP. Otros formatos fallan cerrado.
3. Validar groupId/bookingIds del resultado y todas sus referencias. Cada reserva
   debe ser APP, de la cuenta creadora/pasajera actual y pertenecer al grupo esperado;
   no devolver partes de otro actor ni respuestas parciales de un grupo dividido.
   Aplicar el ámbito de lectura vigente y las restricciones de ruta que correspondan,
   sin usar autoría del recibo para saltar revocación o RLS.
4. SECURITY DEFINER con search_path fijo pg_catalog,nexo,pg_temp y objetos
   cualificados, según el patrón del núcleo. Su lectura interna de actions necesita
   filtro explícito: el dueño puede eludir RLS. No asumir que SELECT bajo el dueño
   aplica las políticas de nexo_app; verificar propiedad y alcance antes del DTO.
5. REVOKE de PUBLIC y de roles identidad/provisión/mantenimiento; solo EXECUTE
   específico para nexo_app. Mantener sin SELECT/DML a actions y sin EXECUTE a
   action_start/action_finish. No añadir una política amplia de lectura propia a
   actions, pues expondría todos los tipos de payload/result del actor.
6. Consultar el registro de reserva, no volver a evaluar disponibilidad como si
   se fuera a reservar. No expire_holds, action_finish, mutadores, versiones nuevas,
   marcas de consumo, auditoría de negocio ni actualizaciones por lectura.

La asociación/ruta del ticket nunca concede permisos. Tampoco se requiere que una
ruta histórica siga vendiéndose para leer lo que las consultas OWN ya autorizan;
no confundir autorización de lectura con elegibilidad para una reserva nueva.
Si no puede demostrarse una proyección compatible con la lectura vigente, responder
RECOVERY_UNAVAILABLE y bloquear ese perfil, no ampliar las reglas para recuperarlo.

### 5.5 Concurrencia y consistencia

El escritor nativo ya serializa actor+clave con el hash de action_start. Proponer
al lector `pg_try_advisory_xact_lock_shared` sobre **el mismo** identificador, sin
espera: si no lo obtiene, NOT_OBSERVED. No afirmar que la clave está ejecutándose,
pues puede existir contención o colisión de hash. Lectura acotada y liberación al
cerrar la transacción; no introducir otro orden de locks de rutas/inventario.

Si obtiene el lock, proyectar solo filas confirmadas, en un snapshot coherente.
Revalidar sesión, expiración por reloj real y propiedad al final. Definir la función
VOLATILE para no reutilizar una lectura de autorización anterior tras una espera.
No usar FOR SHARE/UPDATE en una transacción READ ONLY: no se copia sin más el
helper administrativo 041, que usa locks de fila y exige administrador.

Una petición puede llegar al escritor **después** de que el lector no observe nada.
Un rollback y una petición aún no recibida no se distinguen por NOT_OBSERVED. El
cliente restaurado no conserva el cuerpo y, por tanto, no tiene botón de replay.
Ofrece consulta manual o revisión; no crea automáticamente otra clave.

La revocación se comprueba antes de publicar y las respuestas tardías se descartan.
No se promete retirar bytes ya entregados ni abortar retroactivamente una operación
autorizada. Los tests deben fijar barreras reales de concurrencia para demostrar
esa frontera y no presentar un estado local como autorización SQL.

### 5.6 Necesidad de migración y alternativa descartada

Se necesita una **migración aditiva 042 o siguiente libre**, solo si se aprueba B,
para crear la proyección/ACL. La PK existente basta; no se justifica otro índice,
tabla de recibos, campo created_at inventado, segundo inventario ni cambiar 001–041.
El ticket firmado y su caducidad son del protocolo de recuperación, no una política
de retención o borrado de actions. Los recibos históricos siguen bajo sus contratos.

Un ticket cliente sin sello permitiría editar fechas/cuenta/familia y no acreditar
el plazo. Una tabla nueva podría anclar el tiempo, pero requeriría escrituras,
retención y mantenimiento adicionales. Se propone la emisión firmada previa para
evitar esa tabla. No es posible simultáneamente conservar claves antiguas sin fecha,
ofrecer creación acreditada no renovable y añadir solamente una consulta por clave:
si se rechaza la emisión previa, esa garantía queda bloqueada y debe revisarse.

## 6. Amenazas, garantías y límites

| Amenaza / caso | Tratamiento exigido | Garantía que no se promete |
| --- | --- | --- |
| XSS, dependencia comprometida o extensión privilegiada | Mantener CSP sin scripts externos, renderizado sin HTML inyectado, datos mínimos, sello y reautenticación. No guardar credenciales ni claves de firma. | XSS activo puede leer sessionStorage, DOM y capturar credenciales nuevas. Ni cifrar con una clave en el mismo navegador ni HttpOnly lo resuelven. Requiere auditoría y riesgo residual reconocido. |
| Otra persona usa el equipo con cookie A | Arranque anónimo y pantalla bloqueada independientes del ticket; contraseña original antes de datos. Logout y limpieza explícitos al ceder terminal. | Una bandera local no prueba que el humano actual sea A; miniaturas/SO y otra pestaña ya abierta quedan fuera de esa promesa. |
| Ticket editado, copiado, fecha futura o reloj cliente atrás | Esquema cerrado, MAC, ejecución, cuenta real y plazo del servidor. Manipulación no consulta ni modifica otra cuenta. | El ticket no es confidencial ni prueba custodia, identidad legal o autorización de un responsable. |
| Pestaña duplicada / window.open | Suponer copia del ticket; nuevo documento exige login. Dos lectores autorizados no escriben. No usar tabId como ACL. | Exclusividad de pestaña o recuperación de una pestaña que el navegador no restaura. |
| A → B → A y respuesta lenta | CSRF ligado al contexto, handle/boot vigentes, cuenta original y generación de consulta; invalidar callbacks viejos antes de publicar. | Una comparación aislada de accountRef antes/después no detecta todos los cambios de contexto. |
| Sesión caducada/revocada, permisos retirados o responsable corregido | Reautenticar y revalidar SQL; negar lectura si el perfil actual no la permite. No usar sello/autoría para ampliar acceso. | Recuperar una sesión revocada, un código anterior o autoridad de tutela. |
| COMMIT con respuesta perdida; lectura antes del COMMIT | RECORDED solo por recibo SQL autorizado; NOT_OBSERVED conserva incertidumbre. | Rollback por timeout, página vacía o lock libre; cancelación o liberación automática. |
| Recibo confirmado, estado actual fallido o cambiado | Mostrar registro histórico y consulta pendiente por separado, ambos solo después de login. Reintentar lectura. | Que el estado original siga vigente, que HELD sea CONFIRMED o que seis plazas signifiquen salida. |
| Reinicio del gateway/DB, mismo puerto o IDs reutilizados | Nueva época y secreto; invalidar tickets anteriores incluso si la cuenta parece igual. Si cambia puerto, sessionStorage pertenece a otro origen y puede no estar accesible. | Continuidad del ticket entre ejecuciones de laboratorio, migrarlo o resignarlo automáticamente. |
| Enumeración o abuso | Emisor no acepta claves elegidas; lector MAC+actor+familia cerrada; errores opacos, límites actuales 120/min y seis simultáneas, respuesta acotada. | Constancia temporal absoluta o protección distribuida/productiva que la base no ofrece. |
| Caída tras emisión y antes de envío; cuota/almacenamiento bloqueado | Persistir antes del primer envío, parar si falla. Restore consulta únicamente. | Que haya una reserva por existir ticket, o envío posterior automático del cuerpo perdido. |
| Caducidad, limpieza manual o navegador cerrado | Invalidez lógica por servidor, limpieza local al ejecutar; no renovar. Revisión normal con permisos actuales. | Borrado físico verificable en navegador cerrado ni borrado de operaciones/recibos SQL a los treinta minutos. |

## 7. Máquina de estados y mensajes accesibles

Son estados del cliente de recuperación, no nuevas columnas/estados de reserva.
El estado inicial siempre oculta datos privados; el recibo y el estado actual
solamente existen en RAM después de la autorización.

```mermaid
stateDiagram-v2
    [*] --> Bloqueada
    Bloqueada --> Autenticar: arranque anónimo del documento
    Autenticar --> Lista: login del documento y referencia local candidata
    Autenticar --> Autenticar: cuenta distinta o sesión inválida
    Lista --> Consultando: consulta manual explícita
    Consultando --> Recibo: recibo SQL autorizado observado
    Consultando --> Incierta: no observado o transporte interrumpido
    Consultando --> Revision: permiso o proyección insuficiente
    Recibo --> Actualizada: consulta actual autorizada completada
    Recibo --> LecturaPendiente: falla consultar estado actual
    LecturaPendiente --> Consultando: consulta manual con la misma referencia
    Incierta --> Consultando: consulta manual sin reenviar
    Lista --> Invalida: vence plazo o cambia ejecución
    Incierta --> Invalida: vence plazo o cambia ejecución
    LecturaPendiente --> Invalida: vence plazo o cambia ejecución
    Consultando --> Autenticar: sesión o contexto cambian
    Actualizada --> Cerrada: retirar referencia resuelta
    Revision --> Cerrada: descarte local explícito
    Invalida --> Cerrada: limpieza local sin cancelar operación
    Cerrada --> [*]
```

Lista no certifica el MAC ni la cuenta original de un objeto local: esa comprobación
es del servidor, y solo una consulta autorizada puede desbloquear la información
privada del flujo restaurado. El gate de caducidad/contexto se evalúa también antes
de cualquier transición o publicación, aunque el diagrama no repita todas sus flechas. Consultando se serializa
por ticket para evitar consultas simultáneas accidentales. No hay transición a
reservar, reenviar, confirmar oferta, abordar, salir o aceptar condiciones.

| Estado | Mensaje propuesto / acción |
| --- | --- |
| Bloqueada / Autenticar | «Inicia sesión con la cuenta original para consultar una operación anterior». Sin nombre, cuenta, familia, ruta, número de referencias o resumen privado. |
| Lista | «Iniciaste sesión. Puedes consultar esta referencia; el servidor todavía debe verificarla. La operación no se repetirá». Botón «Consultar resultado». |
| Consultando | «Consultando el resultado autorizado. La operación no se está reenviando». aria-busy y botones de consulta deshabilitados durante la petición. |
| Incierta | «Todavía no se observó un recibo. La operación pudo ejecutarse o seguir pendiente. Puedes volver a consultar». Sin botón «Reservar otra vez». |
| Recibo / LecturaPendiente | «El servidor confirmó un registro anterior; falta consultar su estado actual». La condición original se identifica como histórica, sin presentarla como disponibilidad actual. |
| Revision | «No podemos recuperar esta referencia con los permisos actuales. Requiere revisión». No afirmar recibo ajeno, sanción, cancelación o reembolso. |
| Invalida | «La referencia temporal caducó o corresponde a otra ejecución. No se canceló ninguna operación». Consulta normal solo tras autenticar. |
| Error de almacenamiento antes del envío | «No se pudo guardar la referencia temporal. Esta solicitud no se ha enviado desde este intento». No prometer continuidad tras recarga. |
| Descarte | «Eliminar esta referencia solo borra la ayuda local. No demuestra que la operación haya fallado ni cancela reservas». Confirmación explícita. |

Usar role=status/aria-live=polite para progreso y confirmación, alert para errores
que bloquean una acción, etiquetas explícitas y foco visible. No anunciar en bucle
una cuenta regresiva; el plazo no se renueva por mantener la pantalla abierta.
Devolver foco al botón o título apropiado sin saltos por respuestas tardías. Probar
teclado, 320 px, zoom de layout 200 %, texto largo y lector de pantalla como revisión
adicional; axe no certifica todos los recorridos. No se envían comandos de negocio
ni consultas automáticas de recibos por online, pageshow, restauración de ticket,
temporizador o cambio de pestaña. El arranque de seguridad y la limpieza local sí
ocurren, sin reenvíos de actuaciones.

## 8. Matriz de pruebas propuesta para B

**Ningún caso nuevo de esta tabla ha sido ejecutado ni implementado en A.**
Se reutilizarán tests de 5A.2/5A.3 y testigos PostgreSQL independientes, incorporando
solo las brechas nuevas. No sustituir PostgreSQL por respuestas simuladas del gateway.

| ID | Frontera y caso | Resultado exigido |
| --- | --- | --- |
| T01 | Unitario: ticket v1 válido, campos extras, tipo/versión inválidos, prototipo, tamaño y contenedor lleno | Esquema cerrado; no desalojo silencioso ni envío tras fallo de persistencia. |
| T02 | Reloj controlado: 29:59.999, 30:00, reloj cliente manipulado, login/recarga/consulta repetidos | A treinta minutos no es válido, incluso si la consulta comenzó antes; createdAt/expiresAt/key/seal no se renuevan. |
| T03 | MAC: editar individualmente cuenta, familia, entorno, fechas, clave o aplicación; sello truncado | Rechazo antes de buscar recibos; no caída ni comparación insegura de buffers. |
| T04 | RPC real: reserva APP QUEUE de una/seis plazas, expreso, dividido y ENROUTE | Recibo correcto sin cuerpo y sin cambios de precios, partes, inventario, turnos o auditoría. |
| T05 | Key usada con otro op, source WALK_IN, care_link_code o clave interna derivada | No result crudo, código, manifiesto ni acceso por cambiar family. |
| T06 | Cuenta B con ticket A; claves conocidas y desconocidas; asociación extranjera | Negativa opaca, sin IDs ajenos ni diferencia de existencia del recibo. |
| T07 | Perfil propio más rol administrativo restringido; permisos revocados antes de consultar | No saltar restricciones vigentes mediante SECURITY DEFINER o autoría histórica. |
| T08 | Sesión/identidad revocada o caducada en barreras antes/después del lookup | No publicar datos si falla revalidación; preservar límites de operaciones ya autorizadas. |
| T09 | Lookup dentro de BEGIN READ COMMITTED READ ONLY; ACL/catálogo/role tests | Funciona sin DML ni locks FOR SHARE/UPDATE; runtime no puede leer actions o invocar helpers internos. |
| T10 | Escritor pausado antes del COMMIT, lector simultáneo y rollback alternativo | NOT_OBSERVED no significa fracaso; tras COMMIT lectura manual recupera el único recibo. |
| T11 | Dos replays originales RAM concurrentes con lector restaurado; petición original llega después del lookup | Sin duplicados, cambios parciales, deadlock o falsa conclusión por ausencia. |
| T12 | Fallo después de COMMIT/enriquecimiento del servicio, recarga real y login original | Recibo recuperado con la clave persistida; **cero nuevos POST de reserva tras recarga**. |
| T13 | Recarga después de ISSUE pero antes del envío y otra antes de persistir | Ticket no equivale a envío; sin cuerpo no se ejecuta ni se reconstituye el comando. |
| T14 | RECORDED seguido de consulta actual 503/403/401 o grupo fuera de primera página | Separar recibo/estado; paginación autorizada real; ninguna escritura adicional. |
| T15 | Cliente A → B → A durante consulta, respuesta tardía del login y de recibo | CSRF+boot+generación descartan datos viejos aunque accountRef termine otra vez en A. |
| T16 | Mismo equipo con cookie A, ticket inexistente/corrupto/borrado y restauración de documento | Ninguna vista/API privada se carga desde el gate antes de reautenticar; no bypass por Web Storage. |
| T17 | bfcache, pagehide/pageshow, back/forward y restauración de pestaña, cuando Chromium lo permita | Pantalla bloqueada sin flash privado; nuevo arranque antes de consultar. Registrar si un tipo de restauración no pudo reproducirse. |
| T18 | Duplicar pestaña / window.open con sessionStorage copiado; login A/B en ambas | No asumir exclusividad; lectores no mutan; handle invalidado y respuestas antiguas se descartan. |
| T19 | Reinicio solo gateway con DB conservada; reinicio completo, mismo puerto y nuevos IDs | Entorno anterior inválido; ningún resignado, lookup cruzado o autenticación restaurada por coincidencia local. |
| T20 | Logout, cambio de cuenta y descarte con petición en vuelo | Limpiar namespace/RAM y callbacks sin cancelar, liberar capacidad o borrar recibos. |
| T21 | Storage disabled/QuotaExceeded, datos truncados o escrituras interrumpidas | Fallo anterior al envío; el texto distingue pérdida de referencia de resultado incierto ya enviado. |
| T22 | Origin/CSRF ausentes o B+CSRF A, query extra, Authorization, familia/objeto arbitrarios | Rechazo en gateway sin invocar RPC indebida; preservar límites actuales y no-store. |
| T23 | Saturación de 120/min/seis simultáneas; doble clic y online repetido | Sin tormentas ni renovación; reintento solo lectura manual, no ampliar límites o timeouts. |
| T24 | Inspección Web Storage y artefactos/logs en todas las fases | Solo campos autorizados; cero cuerpos, códigos, CSRF, contraseñas, menores, manifiestos o datos reales. |
| T25 | E2E escritorio/móvil con teclado, foco, 320 px y zoom 200 %, errores y sesiones | Controles utilizables, sin datos antes del gate; mensajes y estados accesibles. |
| T26 | Upgrade ficticio poblado 001–041 → migración aditiva, instalación limpia y reaplicación | Filas/recibos previos, checksums, OID/ACL de funciones existentes y contratos intactos. |
| T27 | Snapshot SQL antes/después de lecturas, errores y consultas concurrentes | Ninguna diferencia de negocio, acciones o auditoría. Eventos de autenticación del login se verifican separadamente como efectos esperados. |
| T28 | Regresión completa y CodeQL del futuro SHA funcional | Unitarias/PG/E2E/build/cierre, Ubuntu y Windows Node 22/24, CodeQL, con resultados exactos y fallos documentados. |

Al estabilizar B, comandos existentes: npm run test:all, npm run test:web,
npm run web:check/web:build según runners. Ejecuciones dirigidas durante desarrollo;
matriz completa al finalizar sin retries/timeouts ampliados para ocultar errores.
Los totales futuros dependen de los casos implementados; no se dan por aprobadas
las 94 unitarias/408 PG/86 por proyecto históricas de 5A.3 sin ejecutarlas de nuevo.

Los workflows actuales de [pruebas](../.github/workflows/etapa-1-tests.yml) y
[CodeQL](../.github/workflows/codeql.yml) no incluyen PRs hacia desarrollo/etapa-5a3
en sus filtros; CodeQL filtra además cambios de código. **Este PR documental no
acredita una ejecución nueva de CI/CodeQL.** La rama/base de B tendrá que incluirse
en los filtros durante el incremento funcional autorizado, o elegir una ejecución
permitida por el workflow tras revisar ese contrato. No modificar workflows aquí.

## 9. Criterios de aceptación y bloqueos

El diseño puede recomendarse para implementación solo cuando la revisión acepte:

- Piloto cerrado APP; ninguna familia D/X se habilita por analogía.
- Descriptor previo firmado, sin reemisión de claves antiguas y treinta minutos
  acreditados por servidor; almacenamiento estrictamente mínimo.
- Gate de reautenticación que no depende del ticket y tratamiento probado de
  documentos restaurados, cookies compartidas, bfcache y callbacks tardíos.
- RPC exclusivamente de consulta, least privilege, DTO mínimo y rechazo de
  referencias no autorizadas; nunca un replay disfrazado de consulta.
- Prueba tras COMMIT real y recarga sin cuerpo, con cero escrituras de negocio en
  recuperación, y conservación de seis plazas por segmento, tarifas/grupos/FIFO.
- Resultados reales de todas las capas y límites claros antes de proponer cierre B.

Bloqueos para una promesa segura: ausencia de la RPC; ticket sin integridad/tiempo
acreditado; confiar en cookie existente o bandera local como reautenticación;
mostrar DOM privado restaurado; autorizar por ser creador sin permiso actual;
pretender recuperar secretos ligados a sesión; interpretar NOT_OBSERVED como
rollback; prometer borrado físico puntual o protección contra XSS activo.

Si un gate no puede demostrarse, se mantiene la recuperación RAM 5A.3 y se deja
la nueva capacidad inactiva. No crear otro inventario ni relajar permisos para
eliminar un bloqueo de UX.

## 10. Decisiones pendientes para la revisión del propietario

| Decisión nueva a revisar | Recomendación y efecto |
| --- | --- |
| Alcance inicial | Aprobar solo reservas APP QUEUE/ENROUTE; dejar las demás familias bajo sus contratos RAM hasta su revisión específica. No se consideran todas recuperables por tener actions. |
| Emisión previa firmada + RPC | Aprobar los dos contratos HTTP y la futura proyección aditiva. No basta una consulta por clave para garantizar fechas de un intento sin metadatos acreditados. |
| Reautenticación por documento y pestañas compartidas | Aceptar arranque anónimo en cargas completas y su efecto en otras pestañas que comparten cookie. Si se exige conservar sus sesiones sin ese efecto, debe diseñarse otra vinculación por documento antes de B, no simularla con tabId. |
| Garantía temporal | Confirmar que treinta minutos es vigencia lógica del ticket; no destrucción física verificable del almacenamiento cuando el navegador está cerrado. El plazo de treinta minutos ya está aprobado y no se propone cambiarlo. |
| Almacenamiento no disponible | Propuesta: bloquear el nuevo envío en modo recuperable. Decidir aparte si se permite continuar explícitamente con el modo RAM de 5A.3 y sus límites, sin prometer recuperación tras recarga. |
| Terminal compartida | Revisar procedimiento operativo de cierre de sesión al entregar el equipo y límites de otras pestañas/miniaturas. No inventar identidad legal o retención comercial. |

No dependen de decisiones nuevas las reglas actuales de reservas, tarifa, menores,
custodia, ausencias o despacho: se conservan. Retención comercial/legal de recibos,
historial y evidencias sigue pendiente de sus decisiones propias; el TTL local no
autoriza eliminarlos. Nada de este diseño exige proveedores o recursos de pago.

## 11. Verificación realizada en 5A.4-A

- Inspección estática de los módulos y migraciones citados, permisos, tablas de
  handlers, discriminadores de actions y pruebas existentes. No conexión a una DB,
  migración, servidor, prueba PostgreSQL/Playwright o batería funcional nueva.
- Revisión de AGENTS.md, instrucciones locales trufis-dev, requisitos, arquitectura,
  modelo, seguridad, plan de pruebas y contratos/informes 5A.2/5A.3. Las instrucciones
  locales se leyeron como archivos; no se afirma activación nativa de skills Nexo.
  Se consultó la guía disponible de PostgreSQL sobre mínimos privilegios y RLS.
- Validación documental y de Git al publicar: solo este Markdown nuevo respecto
  del SHA exacto; enlaces locales, cercas y referencias de evidencia verificadas;
  código funcional, tests, workflows, 001–041, dependencias y datos intactos.
  Comprobaciones estáticas aprobadas: 20 enlaces locales con sus líneas de anclaje,
  una cerca Mermaid equilibrada (sin renderizar el diagrama), 41 migraciones
  históricas sin cambios y ausencia de las dos rutas propuestas en el gateway.
- La validación documental no ejecuta la máquina, verifica un HMAC o demuestra un
  ataque E2E; esos resultados quedan pendientes de B y de su autorización expresa.

**Dictamen de A:** propuesta lista para revisión del contrato y sus gates. No hay
implementación funcional ni declaración de seguridad de una capacidad aún inexistente.
No fusionar PR #5–#9 o este PR; no desplegar ni iniciar B, 5A.5 u otra etapa.
