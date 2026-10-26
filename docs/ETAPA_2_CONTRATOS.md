# Etapa 2 — Contratos locales de reservas y despacho

El propietario aceptó el cierre de laboratorio de Etapa 1 y autorizó Etapa 2.
Base: `9188139`, rama `desarrollo/etapa-2`, revisión hacia `desarrollo/etapa-1`.
PR #1 y main se conservan. Sin Etapa 3, producción, gastos ni datos reales.

## Superficies y ejecución

```sh
npm ci --no-fund
npm run test:all
npm run dev:local
```

Node 22.x/24.x, usuario no root en Linux. El launcher crea un clúster PostgreSQL
efímero nuevo y anuncia **dos puertos distintos** en 127.0.0.1: identidad/catálogo
de Etapa 1 y negocio de Etapa 2. Ambos se cierran junto con pools/PostgreSQL al
detener el laboratorio. DATABASE_URL, HOST y PORT externos no se consumen.
No se precarga un catálogo oficial, operadores ni contraseñas remotas. Los tests
crean asociaciones, rutas, roles y sesiones ficticias para los casos completos.

El listener de negocio recibe **solo** el pool nexo_app. No tiene pool de identidad,
aprovisionador, mantenimiento ni propietario. No ofrece registro/login/provisión ni
SQL; una sesión emitida por el módulo confiable existente se utiliza como Bearer.
No se promueve la API de Etapa 1 a una API pública. Se comparte únicamente el
transporte local con sus límites y validaciones probadas.

Todas las rutas son POST, Content-Type: application/json, X-Nexo-Local-Test: 1,
Authorization: Bearer <sesión>. Las mutaciones requieren Idempotency-Key de 1–128
caracteres ASCII alfanuméricos o `._:-`. No usar nombres/personas en las claves.
No se acepta actorId, passengerId, associationId ni source como autenticación.

## Operaciones

| Ruta /business/... | Cuerpo | Permiso efectivo |
|---|---|---|
| quote | routeId, from, to, seats, express opcional | Sesión válida, ruta elegible y tarifa vigente única |
| reserve | segmento y opciones de grupo/quote | Reserva APP del actor de sesión |
| walk-in | mismo contrato de reserva | Administrador de la asociación real de la ruta; source fijado en servidor |
| booking | bookingId | Reserva visible por RLS: propia, creada, asociación administrada o viaje conducido |
| queue | routeId, limit/offset opcionales | RLS de viajes: administrador propio o chofer de su vehículo; pasajeros no ven fila privada |
| manifest | tripId, limit/offset opcionales | Administrador propio o chofer del viaje; sin listado público de pasajeros |
| respond | bookingId, accept booleano | Chofer asignado con membresía activa |
| cancel | bookingId | Pasajero/creador o administrador de su asociación, antes de iniciar el grupo |
| depart | tripId | Chofer del viaje, cumpliendo las reglas vigentes del núcleo |
| progress | tripId, stop | Chofer propio y progreso discreto válido |
| request-queue | previousTripId, routeId | Chofer propio llegado/disponible, destino y asociación compatibles |
| movement | bookingId, kind BOARD/ALIGHT | Chofer propio en la parada exacta habilitada y estado válido |

Validación estricta de claves, UUIDs, booleanos e enteros; sin strings numéricos
como sustituto de plazas. from/to son índices discretos, no coordenadas: from>=0,
to>from, to<=10000 como límite técnico del adaptador; SQL valida la topología real.
seats admite 1–6. express=true exige seis. Las lecturas paginadas usan límite 50,
máximo 100, offset 0–10000, con orden determinista. No se exponen identificadores
de identidad del pasajero en las proyecciones de reserva/manifiesto.

Los grupos viajan juntos por defecto. parts opcional es una lista de {tripId,seats},
con vehículos distintos y suma exacta. Dividir exige >=3 plazas, splitConsent=true,
containsMinors=false explícito y no expreso. La declaración ficticia no verifica
edad ni parentesco; esa decisión sigue pendiente. La operación asegura todas las
partes o revierte todo. No se inventa asignación automática tras rechazo.

APP y presencial llaman al mismo inventario SQL. Una solicitud que no cabe pasa al
primer vehículo compatible, respetando la fila. Expreso ocupa las seis plazas del
segmento contratado; no se cambia la semántica de segmentos del núcleo existente.

## Precio y reintentos

quote devuelve {fareId,fareVersion,totalBOB,currency:'BOB'}. No retiene plazas ni
garantiza disponibilidad futura. Para exigir el precio mostrado se envía ese objeto
en quote de reserve/walk-in:

```js
const quote = await business.quote(token, {routeId,from:0,to:3,seats:2});
const receipt = await business.reserve(token, actionKey, {
  routeId,from:0,to:3,seats:2,quote
});
```

012 reutiliza nexo.reserve y compara **las instantáneas realmente creadas** con el
importe, tarifa y versión esperados dentro de la misma transacción. Si difieren:
QUOTE_CHANGED y rollback de reservas, acciones e inventario/auditoría, sin efectos
parciales. Un cliente que omite quote conserva el comportamiento previo: precio
vigente al retener. No hay cobro ni un contrato legal de aceptación implementado.

La respuesta contiene groupId, bookingIds, initialStatus, bookings, totalPriceBOB y
currency. El dinero de este contrato se devuelve en decimales de dos posiciones como
texto. initialStatus describe el recibo original (HELD); bookings[].status describe
el estado persistido observado en el reintento. booking devuelve ese estado y su
expires_at. El núcleo materializa EXPIRED al operar (por ejemplo, al responder o
despachar); una lectura sola no muta reservas. Un HELD con expires_at pasado no
consume capacidad y no puede confirmarse: el consumidor debe considerar ambos
campos, sin interpretar la lectura como una renovación del plazo. Esto evita
mostrar HELD como si fuera estado actual después de una aceptación ya completada.

El núcleo conserva una clave por actor/payload de reserva; el mismo payload y clave
no duplican plazas. Un payload de reserva diferente con la misma clave produce
IDEMPOTENCY_CONFLICT. quote es una precondición adicional, no parte del payload de
idempotencia previo: cambiar solo quote puede producir QUOTE_CHANGED, nunca crear
otra reserva. Para una nueva reserva usar una nueva clave; no renovar automáticamente
un recibo cancelado/rechazado/vencido mediante su clave antigua.

## Recogida y descenso observados

Nueva tabla booking_movements: asociación, reserva, BOARD/ALIGHT, índice de parada,
actor y fecha, con FK compuesta, unicidad por reserva/tipo, RLS e inmutabilidad.
No guarda personas, GPS ni pagos. No modifica plazas, tarifa ni estado de reserva.

BOARD registra la recogida de **toda la reserva/parte del grupo**, confirmada y en
viaje IN_TRANSIT, exactamente en from y con boarding_allowed. ALIGHT exige BOARD
previo, parada to con alighting_allowed y viaje IN_TRANSIT o COMPLETED. Se admite
registrar descenso terminal después de progress, que ya completa las reservas.
Los reintentos con la misma u otra clave no duplican el evento. Ruta y viaje se
bloquean en el mismo orden que despacho/progreso; un movimiento no puede registrar
como actual una parada ya pasada durante la espera.

Los registros antiguos empiezan **UNRECORDED**, nunca se inventa que abordaron o
que faltaron. Los estados de observación son UNRECORDED/BOARDED/ALIGHTED. El incremento 1 no incluía movimientos individuales ni borradores de ausencia;
el incremento 2 los añade según el contrato al final de este documento. Siguen sin
implementarse correcciones retroactivas, abordaje antes de salida, liberación por
ausencia ni políticas económicas. Progreso/salida no quedan condicionados a completar esta nueva bitácora:
se preservan los supuestos previos hasta decisión del propietario.
La revocación de ruta no cancela ni impide terminar las reservas confirmadas ya
iniciadas; no se decide el tratamiento de reservas futuras.

## Errores y límites

400: contrato/clave inválidos; 401: sesión inválida; 403: actor sin autoridad;
404: recurso privado no visible/ruta HTTP inexistente; 409: conflicto de precio,
capacidad, idempotencia o estado operativo; 429: límite local; 503: fallo interno
sin detalles SQL. Se conservan los límites de cuerpo/headers/tiempo/frecuencia y
concurrencia del transporte de Etapa 1. La asignación, cancelación y lectura siguen
RLS/roles bajo transacciones READ COMMITTED. Una operación ya autorizada puede
finalizar después de revocar su sesión, según la frontera documentada previamente.

Proveedor público, protección distribuida, TLS/MFA, operación real y verificación
documental siguen fuera de este laboratorio. [Decisiones pendientes](DECISIONES_PENDIENTES_ETAPA_2.md).

## Incremento 2: integrantes, ofertas y borradores de ausencia

La migración **013** conserva 001–012 y añade `booking_members`, `member_movements`
y `absence_drafts`. Cada reserva tiene `seats` identificadores UUID y ordinales
1–6, creados transaccionalmente incluso para datos anteriores. Son **plazas técnicas
reservadas**: un expreso tiene seis identificadores de capacidad, sin afirmar que
viajan seis personas. No contienen nombres, documentos, edades ni comprobación de
menores. Una parte de un grupo dividido tiene sus propios identificadores.

`roster` y `booking.members` muestran `UNRECORDED`, `BOARDED` o `ALIGHTED`, historial
individual y marca `legacy_aggregate`. UNRECORDED significa que no existe evidencia
individual; no certifica ausencia. Migrar una observación grupal previa no inventa
observaciones de cada integrante. Una reserva que ya tiene movimientos grupales
continúa exclusivamente con `movement`; una que inicia movimientos individuales
continúa con `member-movement`. Las operaciones concurrentes no pueden mezclar ambos
modos. Reservas sin movimientos pueden elegir cualquiera; no se convierten modos
con historia ni se corrigen eventos mediante UPDATE/DELETE.

| Ruta /business/... | Cuerpo | Permiso/resultado |
|---|---|---|
| roster | bookingId | Reserva visible por RLS; hasta seis integrantes técnicos |
| member-movement | memberId, kind BOARD/ALIGHT | Chofer asignado activo; Idempotency-Key; parada exacta y habilitada |
| absence-draft | memberId, kind WAITING/WARNING_DRAFT/GRACE_DRAFT/RESOLVED | Chofer asignado o administrador propio; Idempotency-Key; borrador sin envío |
| absence-preview | memberId | Integrante visible por RLS; lectura de referencia sin insertar eventos |
| offers | tripId, limit/offset opcionales | Chofer propio o administrador; estado persistido y effective_status |
| refresh-offers | tripId | Chofer propio o administrador; Idempotency-Key; materializa vencimientos de retenciones de la ruta |

BOARD individual exige reserva CONFIRMED, viaje IN_TRANSIT, `current_stop=from_stop`
y `boarding_allowed`. ALIGHT exige BOARD previo de ese integrante, parada de destino
habilitada y viaje IN_TRANSIT/COMPLETED. El itinerario y precio son los de su reserva:
no se admiten paradas diferentes por integrante dentro de la misma reserva. Los
itinerarios distintos se representan con reservas por segmento; admitirlos dentro
de un mismo grupo requiere definir reparto de tarifas/capacidad y permanece pendiente.
Reintentar el mismo movimiento con otra clave no duplica hechos ni auditoría; usar
una clave para otro integrante/payload produce IDEMPOTENCY_CONFLICT.

El manifiesto añade integrantes, `segments[].reserved` y `observedOnboard` de todo
el viaje, incluso si la lista de reservas está paginada. El último combina eventos
individuales con eventos grupales heredados, evitando doble conteo. No es evidencia
de identidad ni un contador de reservas. Las lecturas operativas usan READ COMMITTED;
varias consultas/páginas pueden observar cambios concurrentes y no son un documento
firmado ni una autorización para salir. Toda mutación revalida estado bajo locks.

Un nuevo BOARD que superaría seis observados se rechaza, incluso entre reservas
individuales y grupales de segmentos disjuntos. Hay que registrar los descensos en
su parada antes de observar las nuevas subidas. Una observación faltante no libera
inventario ni se inventa automáticamente. Si ya se pasó la parada, la corrección
requiere un procedimiento aprobado: el prototipo no permite falsear la parada ni
editar la bitácora. Salida/progreso conservan su regla previa de plazas confirmadas,
incluidas recogidas posteriores; `departurePolicy` la identifica como
EXISTING_CONFIRMED_INVENTORY. Esto no resuelve todavía la política comercial.

### Ofertas

Se reutiliza `respond_offer` mediante un wrapper de validación, conservando su
implementación interna con ejecución revocada para nexo_app. Una aceptación HELD
no vencida revalida elegibilidad de ruta **también si es la primera parte de un grupo
dividido**. Tras esperar el lock vuelve a comprobar quién conduce. Rechazo y
vencimiento siguen disponibles tras revocar permisos de ruta; no resucitan el grupo.

TTL técnico: **120 segundos, provisional y sin aprobación comercial**. `offers`
expone EXPIRED como effective_status si el plazo pasó aunque el estado persistido
siga HELD. La lectura no renueva el plazo ni libera plazas por ausencia.
`refresh-offers` reutiliza el vencimiento existente de toda la ruta (puede alcanzar
otros viajes/grupos vinculados de esa ruta). `expiredBookings` cuenta el total ya
EXPIRED del viaje solicitado, no solo los vencidos por esa llamada. La respuesta
idempotente es un recibo histórico; consultar `offers` para el estado observado.
No hay reasignación, cron ni avisos reales nuevos.

### Ausencias: infraestructura inactiva

Todos los registros tienen `delivery=DISABLED` y respuestas `policyActive=false`.
No existe scheduler, canal de envío ni efecto sobre estado, precio o plazas.
WAITING se registra manualmente en la parada de recogida habilitada, con reserva
confirmada y vehículo QUEUED/IN_TRANSIT, sin BOARD previo. Ese instante del servidor
es una referencia técnica de simulación, no evidencia de llegada/ausencia de una
persona. WARNING_DRAFT requiere al menos **10 minutos** desde WAITING; GRACE_DRAFT
requiere al menos **15 minutos** y un WARNING_DRAFT explícito. No se adelantan relojes
mediante el cliente. RESOLVED cierra manualmente la referencia iniciada. Un BOARD
hace que la lectura sugiera RESOLVED sin fabricar un evento de ausencia adicional.

La vista previa no crea avisos: su sugerencia temporal puede requerir revisión del
estado/parada actual antes de registrar el borrador; SQL siempre lo revalida.
No se reutiliza una referencia resuelta ni se reinicia su reloj con reintentos.
Los valores 10+5 son referencias pendientes de aprobación. Antes de activar una
política se deben acordar inicio del reloj, presencia/llegada, quién observa,
verificación, comunicación/consentimiento, accesibilidad, excepciones, revisión,
retención y consecuencias. Ninguna cancelación, sanción, devolución, cobro o
liberación automática por ausencia está implementada.

## Incremento 3: terminal y reasignación supervisada

Contrato detallado, condiciones y límites en
[reporte 3](REPORTES/ETAPA_2_INCREMENTO_3.md). Todas las rutas conservan Bearer,
JSON estricto y loopback. Las mutaciones requieren Idempotency-Key.

| Ruta /business/... | Cuerpo | Alcance |
|---|---|---|
| terminal-config | associationId, declarationSeconds | Admin propio configura vencimiento de declaración; sin valor comercial predeterminado |
| terminal-command | bookingId, command, confirmed=true | DECLARED, VERIFIED, READY, PICKUP, TRANSFER_REQUEST, PICKUP_ARRIVED; permisos según operación |
| terminal-evaluation | bookingId | Pasajero/creador, administrador propio o chofer; evaluación sin efectos |
| transfer-candidates | bookingId, direction LATER/EARLIER | Admin propio; destinos por fila, sin retención |
| advancement-candidates | tripId | Admin propio; propuestas verificadas de las primeras 50 reservas posteriores |
| transfer | bookingId, targetTripId, direction LATER/EARLIER | Confirmación del administrador; solo primer candidato compatible, transacción atómica |

VERIFIED representa que el administrador comprobó presencialmente la reserva,
destino/código y la identidad ficticia del laboratorio; no hace validación documental.
No requiere conexión del pasajero ni DECLARED previo. No verifica pagos ni BOARD.
La referencia de terminal 0/5/8 se evalúa desde READY explícito y auditado; los
borradores 10+5 previos siguen inactivos y separados. Recogida inicia su espera
solo con PICKUP_ARRIVED en la parada real discreta, sin GPS.

Transferencias conservan grupo completo de una parte, integrantes, segmento y
precio; no reasignan pasajeros con movimientos ni grupos divididos previamente.
Destino exige nueva aceptación del chofer (HELD con TTL provisional anterior).
Error transaccional o falta de destino conserva original; rechazo/vencimiento de
la nueva oferta sigue el núcleo y requiere una política posterior de recuperación.
Las propuestas se revalidan al ejecutar; varias propuestas no garantizan capacidad
conjunta. Las transferencias repetidas desde un viaje ya abandonado se omiten hasta
modelar episodios de llegada/reasignación sin reutilizar relojes.

## Incremento 4: episodios, incidencias y correcciones

La migración 015 sustituye los límites por viaje del incremento 3 por episodios
inmutables. 001–014 se conservan. [Reporte y límites completos](REPORTES/ETAPA_2_INCREMENTO_4.md).
Cada nueva asignación tiene una versión `episode` y empieza sin relojes de llegada,
READY, respuesta o recogida anteriores; también exige nueva atestación de presencia.
El episodio base conserva los eventos heredados sin inventar historia.

| Ruta /business/... | Cuerpo | Alcance |
|---|---|---|
| assignment-status | bookingId | Pasajero/creador, admin propio o chofer; estado efectivo, incidencia y episodios |
| recovery-queue | routeId, limit/offset opcionales | Admin propio; incidencias ordenadas y acotadas |
| terminal-history | bookingId, limit/offset opcionales | Reserva visible; pruebas y correcciones, sin modificar historia |
| episode-command | bookingId, episode, command, confirmed=true | Mismos comandos/permisos de terminal, con versión explícita |
| correct-arrival | bookingId, episode, eventId, reason | Admin propio; retira prueba vigente con evento compensatorio |
| assignment-transfer | bookingId, targetTripId, direction, episode | Admin propio; primer candidato elegible, transacción atómica |
| assignment-respond | bookingId, episode, accept | Chofer asignado activo; aceptación/rechazo versionado |

Las mutaciones requieren Idempotency-Key. episode es entero 0–8, obligatorio en
las rutas nuevas; STALE_ASSIGNMENT devuelve 409. TRANSFER_CONDITIONS_CHANGED también devuelve 409
si cambian tarifa/paradas/condiciones antes de confirmar; el importe pactado no cambia. reason admite OPERATOR_ERROR,
WRONG_RESERVATION o PASSENGER_CORRECTION, sin texto personal libre. Correcciones
solo antes de salir, con reserva confirmada y sin movimientos. La prueba original
permanece; una nueva VERIFIED válida prevalece sobre una DECLARED vencida/retirada.
Reintentar DECLARED no renueva expires_at ni permite redeclarar tras su retirada
en ese episodio. La configuración registra actor y duración anterior/nueva.

transfer-candidates acepta ahora RECOVER, además de LATER/EARLIER. RECOVER solo
aplica a ofertas trasladadas rechazadas o vencidas; busca en toda la fila compatible,
sin devolver automáticamente al origen. La nueva propuesta conserva reserva,
integrantes, precio y segmento, queda HELD y requiere al nuevo chofer. No hay recargo.
Si no hay opción, RECOVERY_PENDING queda visible en booking.assignment y en las
consultas del pasajero/administrador. confirmedTripId es NULL en esa incidencia;
assignedTripId indica el último viaje persistido, sin afirmar que haya plaza confirmada.

Las firmas antiguas continúan por compatibilidad; los nuevos clientes deben usar
versión explícita. Las lecturas no bloquean ni garantizan disponibilidad. No se
sustituye el estado observado por el recibo original de una operación idempotente.
Límite técnico: ocho propuestas posteriores al episodio base; al alcanzarlo se
requiere revisión y no se ejecuta ninguna consecuencia económica ni cancelación.
La ausencia 0/5/8 y recogida cinco minutos siguen solo simuladas, sin envío ni
liberación automática. No se recomponen grupos previamente divididos.

## Incremento 5: reglas aprobadas de terminal y sustitución urbana

Las secciones anteriores documentan los contratos heredados. Los clientes del nuevo
flujo usan esta sección y [el reporte 5](REPORTES/ETAPA_2_INCREMENTO_5.md). 001–015
se conservan; se añaden 016 y 017. El transporte continúa solo en loopback, con Bearer,
JSON estricto e Idempotency-Key para mutaciones. No hay interfaz pública desplegada.

| Ruta /business/... | Cuerpo | Alcance |
|---|---|---|
| activate-terminal | bookingId | Admin activa una reserva ya confirmada como obligación de terminal |
| register-responsible | bookingId, responsibleId, confirmed=true | Admin registra responsable ficticio WALK_IN; APP conserva su pasajero |
| group-status | bookingId | Responsable, creador, admin o chofer; plazas, autoridad y pago simulado |
| group-consent | bookingId, targetTripId, episode, confirmed=true | Responsable consiente todas las partes y destino concreto |
| approve-terminal-transfer | consentId | Admin revalida y confirma conjuntamente, sin segunda aceptación |
| simulate-payment | bookingId, state, confirmed=true | Admin; VERIFIED_SIMULATED o REVOKED_SIMULATED, sin bancos |
| terminal-arrival | bookingId, episode, confirmed=true | Responsable declara llegada; nuevas declaraciones usan 120 s provisionales |
| terminal-observation | bookingId, memberId opcional, kind BOARD/ALIGHT, seats, destination, confirmed=true | Chofer/admin propio; verifica código, destino/plazas y parada |
| movement-history | bookingId | Historia original/efectiva y marcas de corrección |
| correct-movement | bookingId, factKey, reason, confirmed=true | Admin, parada exacta y límites físicos; motivo OPERATOR_ERROR/WRONG_RESERVATION/WRONG_MEMBER |
| begin-urban | tripId, mainStop, confirmed=true | Chofer autorizado declara comienzo de recogidas urbanas; no es MAIN_START |
| operational-status | tripId | Estado operativo, vehículo actual, incidencia, versión y ocupación observada |
| fleet-history | tripId, limit/offset opcionales | Historial sujeto a RLS, máximo 100 filas |
| fleet-command | tripId, version, command, confirmed=true; targetTripId solo ASSIGN; onboard solo SAFE_TRANSFER | REPORT/MAIN_START del chofer; CONFIRM/ASSIGN del admin; SAFE_TRANSFER del nuevo chofer/admin |
| free-replacement | incidentId | Admin; primer sustituto completamente libre o NULL; consulta sin retención |
| terminal-impediment | tripId, command REPORT/CONFIRM, reason, confirmed=true | Reporte legítimo en terminal; confirmar exige admin |
| restore-vehicle | vehicleId, confirmed=true | Admin registra recuperación simulada; sin reincorporación automática |
| notices | objeto vacío | Solo destinatario/admin propio; últimos 50 avisos DISABLED |

CONFIRMED con autoridad ADMIN_APPROVED es válido aunque driver_accepted sea false:
ese campo no inventa una aceptación personal. El chofer recibe un aviso simulado y
no puede rechazar arbitrariamente la asignación protegida. Reporta impedimentos
legítimos, que bloquean la unidad y quedan pendientes de confirmación/gestión.
Los contratos HELD y recuperación anteriores continúan por compatibilidad.

Los consentimientos son de responsable y grupo completos, con ruta/segmento, precio,
miembros estables por reserva y episodios actuales. La aprobación no divide ni cobra
recargos. Recomponer partes requiere mismo responsable, segmento y capacidad total
hasta seis, en un destino distinto de todos los viajes de origen. Adelantar requiere
presencia verificada efectiva. Un consentimiento consumido o desactualizado no se
reutiliza. Un traslado anterior fallido puede recuperarse por el contrato nuevo con
consentimiento y revisión actualizados; no se restablece automáticamente el origen.

Reserva, pago, DECLARED, VERIFIED y BOARD son estados distintos. No se supone un
pago por consentir, llegar o abordar. DECLARED de terminal-arrival/contrato activado
caduca provisionalmente en 120 s; reintentos no renuevan READY ni el plazo. Se
conservan declaraciones históricas y configuración del contrato heredado. La
cancelación/ausencia no libera plazas de pasajeros con BOARD efectivo en fila.
No se activan cancelaciones automáticas ni comunicaciones reales.

La carrera urbana conserva trip_id y todas sus reservas. La unidad sustituta pierde
su entrada de fila con WITHDRAWN, sin una finalización ficticia, y asume en exclusiva
la carrera del averiado. Debe registrarse SAFE_TRANSFER en el punto seguro ficticio
antes de continuar; no crea BOARD/ALIGHT nuevos para las personas ya observadas.
Se atienden las recogidas pendientes y el chofer registra MAIN_START. Manifest y
progress muestran fase URBAN_COLLECTION/RESCUE antes de MAIN_TRIP; legacyStatus es
solo el estado técnico heredado. mainStartedAt permanece NULL hasta entonces.
Los estados de posición son declaraciones auditadas, no comprobaciones GPS.

La avería sin sustituto permanece AWAITING_REPLACEMENT. Una incidencia de terminal
sin contexto urbano no se convierte en rescate automáticamente. Fuera de ciudad,
riesgo físico o lesiones requieren coordinación humana; la aplicación no reemplaza
la asistencia de emergencia. Ver límites de manifiesto/corrección en el informe.
