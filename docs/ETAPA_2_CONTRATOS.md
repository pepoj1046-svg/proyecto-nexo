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
que faltaron. Los estados de observación son UNRECORDED/BOARDED/ALIGHTED. No se
implementa aquí abordaje de personas individuales, corrección retroactiva de registros,
abordaje antes de salida, aviso de ausencia, liberación por ausencia o políticas
económicas. Progreso/salida no quedan condicionados a completar esta nueva bitácora:
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
