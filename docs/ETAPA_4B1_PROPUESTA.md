# 4B.1 — Propuesta: registro presencial por el chofer en turno fuera del horario con personal

Estado: **autorizada por el propietario el 17-11-2026, solo laboratorio, con las recomendaciones
(M1, H1–H3)**. Implementación y desviaciones en [ETAPA_4B1](REPORTES/ETAPA_4B1.md).
Fecha: 17 de noviembre de 2026. Base: `main` en `89ec522`.
Decisión de origen: [DECISION_REGISTRO_PRESENCIAL_CHOFER.md](DECISION_REGISTRO_PRESENCIAL_CHOFER.md)
(respuestas del propietario del 17-11-2026, §4.1).

**Nombre propuesto:** 4B.1. Amplía la autonomía de las asociaciones, que la auditoría de la
Etapa 4 dejó como parcial, y añade configuración propia de cada asociación (su horario).
No pertenece a la Etapa 5 (experiencia de clientes). El propietario puede elegir otro nombre;
la autorización debe nombrarlo.

## 1. Punto de partida comprobado en `89ec522`

| Pieza | Estado |
| --- | --- |
| Venta presencial web | `/api/terminal/sale-context`, `/api/terminal/quote`, `/api/terminal/walk-in` → `web-terminal-service.mjs` (`sale`, `quote`, `walkIn`) → `business-service.mjs` (`reserve('WALK_IN')` → `nexo.reserve_business`). Exige cotización y confirmación. |
| Autoridad de `WALK_IN` | `019_journey_recovery.sql:208`: `src='WALK_IN' AND NOT nexo.manage_route(route)` → `FORBIDDEN`. Antes, `002_operations.sql:77` (`has_role ... 'ASSOCIATION_ADMIN'`). Un chofer no pasa ninguna de las dos. |
| Recogida en ruta presencial | `walk-in-enroute` → `nexo.reserve_enroute` (fuera del alcance de 4B.1). |
| Trufi en turno | Fila por `(association_id, route_id, position_no)` con índice único para `QUEUED` (001). El de menor `position_no` en `QUEUED` es el que está en turno. |
| Chofer del viaje | `nexo.drives(trip)` (001) y `trips.driver_id`. La vista `DRIVER` de `web_trip_snapshot` ya existe. |
| Responsable del grupo presencial | `group_responsibles` registra a quien hizo la venta (`require_actor()`, 020) y lo usa en 031–033. |
| Menores | Los casos de menores bloquean `BOARD` hasta su verificación ([ETAPA_2_CONTRATOS.md](ETAPA_2_CONTRATOS.md), «Los casos especiales de menores…»); revisiones en `care_review` (032). La marca no acredita edad ni autorización legal. |
| Horario de la asociación | **No existe** ningún modelo de horario o de personal en turno. |
| Última migración | 042. 5A.5 no prevé migración; si se autorizaran ambas, la numeración se asigna por orden de implementación. |

## 2. Alcance propuesto

Solo laboratorio, datos ficticios, web adaptable.

1. **Horario sin personal por asociación.** Tabla nueva con franjas semanales (día, hora de
   inicio, hora de fin; una franja puede cruzar la medianoche, como 18:00–06:00), en hora de
   `America/La_Paz`. La configura el administrador completo de la asociación desde
   Administración, con auditoría. Sin franjas configuradas, el chofer **no** puede registrar.
   La comprobación usa la hora del servidor PostgreSQL, nunca la del cliente.
2. **Registro por el chofer en turno.** El chofer ve en su panel «Registrar pasajero en
   terminal» solo si se cumplen todas las condiciones, comprobadas de nuevo en SQL bajo los
   mismos bloqueos de la reserva:
   - el viaje es suyo (`drives`), está `QUEUED` y es el primero de la fila de su ruta;
   - la asociación y la ruta están activas y la operación está permitida;
   - la hora del servidor está dentro de una franja sin personal de su asociación.

   Se reutiliza el flujo actual: puntos de subida y bajada, número de plazas, cotización con
   la tarifa vigente y confirmación explícita. El chofer no fija precio, no divide grupos sin
   consentimiento y no elige otro trufi.
3. **Mismo núcleo y mismo inventario.** La reserva se crea con `source='WALK_IN'` por el núcleo
   existente, con la misma idempotencia por clave y el mismo máximo de 6 por segmento. Se
   añade una función SQL nueva para la autoridad del chofer; **no se reescribe 019**. El
   mecanismo exacto (una puerta interna que acepte la autoridad del chofer sin abrir
   `WALK_IN` a otros roles) se diseña al implementar y se revisa antes de programarlo.
4. **Registrador y revisión.** El chofer queda como registrador en `group_responsibles`, como
   hoy el administrador. El administrador ve una lista «Registrados por choferes» con
   fecha, viaje, chofer, plazas e importe, solo como trazabilidad: revisarla no cancela ni
   modifica reservas.
5. **Recibo para el chofer.** El chofer puede releer el resultado de su propio registro con la
   misma clave (respuesta perdida tras COMMIT), igual que los recibos administrativos de 041,
   limitado a sus registros.
6. **Menores:** ver M1 (§4). En la propuesta recomendada, el chofer no registra menores y la
   pantalla muestra el protocolo del propietario.

**Fuera de 4B.1:** recogidas presenciales en ruta por el chofer, cancelaciones o cambios de
reservas por el chofer, ventas en otro trufi o en otra ruta, cobro, llamadas o mensajes desde
la app, entrega de menores en domicilio y cualquier dato real.

## 3. Trazado

| Paso | Archivo y función | Nuevo o reutilizado |
| --- | --- | --- |
| UI chofer | `Operations.tsx` (vista `DRIVER`): acción condicionada; reutiliza los componentes de venta de `Terminal.tsx` | Ampliado |
| UI administración | Configuración del horario; lista «Registrados por choferes» | Nuevo |
| API | `/api/driver/walk-in/context`, `/quote`, `/command` y `/api/admin/unstaffed-hours` (nombres orientativos) en `web-gateway.mjs` | Nuevo |
| Servicio | `web-terminal-service.mjs` (`sale` con vista `DRIVER`) o un servicio nuevo `web-driver-walk-in-service.mjs` | Reutilizado/ampliado |
| SQL | Migración siguiente libre: tabla de franjas, función de autoridad del chofer, lecturas de recibo y de revisión, `GRANT` mínimos | Nuevo, aditivo |
| Núcleo | `reserve_business`, `fits`, idempotencia, `group_responsibles` | Reutilizado sin cambios |

## 4. Decisiones del propietario

| ID | Decisión | Opciones | Recomendación |
| --- | --- | --- | --- |
| M1 | Menores en 4B.1 | (a) el chofer no registra menores; la pantalla muestra el protocolo: si un adulto lo envía, que el administrador lo gestione en horario con personal; si llega solo, llamar a padres o tutores (que deben presentarse) o a las autoridades; (b) el chofer registra el caso con los contactos del remitente y del receptor y la entrega en la parada, pero el abordaje queda bloqueado hasta que alguien autorizado lo verifique, como en el contrato vigente | **(a)**. El contrato actual bloquea el abordaje de un menor hasta su verificación, y de noche no hay quien verifique. Guardar contactos reales exige además D06. Con la baja probabilidad indicada, (b) puede ir en un incremento posterior, quizá con un revisor de guardia a distancia. |
| H1 | Quién configura el horario | (a) solo el administrador completo; (b) también el de alcance limitado, en sus rutas | **(a)**: el horario es de toda la asociación. |
| H2 | Cambios de horario | (a) se aplican al instante; (b) desde el día siguiente | **(a)**, con auditoría de quién cambió qué y cuándo. |
| H3 | Administrador conectado dentro de la franja | (a) ambos pueden registrar; (b) solo el chofer | **(a)**: el horario habilita al chofer, no quita permisos al administrador. |
| N1 | Nombre del incremento | 4B.1 u otro | 4B.1. |

## 5. Pruebas previstas

**Unitarias:** validación de franjas (formato, cruce de medianoche, solapes, días), cuerpo de
las peticiones y respuestas sin datos de otros viajes.

**HTTP:** sesión, CSRF, documento, origen, método, tamaño; chofer sin viaje; administrador
de otra asociación; cuerpo con campos de más.

**PostgreSQL real:**
- chofer en turno dentro de la franja registra; fuera de la franja, en el segundo puesto de la
  fila, en un viaje ajeno, en otra asociación o con la asociación suspendida → rechazo;
- franja que cruza la medianoche y cambio de franja durante una transacción en espera;
- el trufi deja de estar en turno (otro sale antes, se retira) entre la cotización y la
  confirmación → rechazo sin efecto;
- carrera chofer + app + administrador sobre el mismo trufi: nunca más de 6 por segmento;
- grupo que no cabe; tarifa cambiada (`FARE_CHANGED`/`QUOTE_CHANGED`);
- misma clave → mismo resultado; respuesta perdida tras COMMIT → el recibo la recupera;
- el chofer no puede leer recibos ni registros de otro chofer;
- con M1 = (a): intento de registrar un menor → rechazo;
- conservación de 001–042 byte por byte, instalación limpia, upgrade poblado ficticio,
  ACL/OID y `GRANT` mínimos de la migración nueva.

**E2E (escritorio y móvil):** configuración del horario; el chofer ve la acción solo cuando
corresponde; venta completa con cotización y confirmación; el administrador ve la lista de
registros; reautenticación y bfcache como en B1.

**Regresión:** `npm run test:all`, `npm run test:web` y CI completo con CodeQL del SHA final.

## 6. Criterios de aceptación

- Solo el chofer del trufi en turno, en su propio trufi y dentro de una franja configurada
  por su asociación, puede registrar; todo lo comprueba el servidor bajo bloqueo.
- Un único inventario; máximo 6 por segmento; tarifa vigente; grupos juntos.
- Fila intacta: el registro del chofer no cambia `position_no` ni el orden de salida.
- Sin efectos fuera de la reserva creada; ninguna escritura se reenvía sola.
- 001–042 intactas; la migración nueva es aditiva y exclusiva de 4B.1.
- Solo laboratorio: sin producción, pagos, GPS, llamadas, mensajes ni datos reales.

## 7. Flujo de ramas y PR

- Propuesta: rama `planificacion/etapa-4b1` desde `89ec522` con este documento y la nota de
  decisión, PR en borrador hacia `main`.
- Implementación, si se autoriza **4B.1** por su nombre: rama `desarrollo/etapa-4b1` desde el
  SHA ratificado, añadida a `pull_request.branches` de `etapa-1-tests.yml` y `codeql.yml` en
  un commit aparte, PR en borrador hacia `main` e informe en `docs/REPORTES/ETAPA_4B1.md`.
- Si 4B.1 y 5A.5 avanzan en paralelo, la segunda en integrarse se rebasa sobre la primera.

## 8. Riesgos y límites

- El horario define cuándo puede actuar el chofer, no si de verdad falta personal: una
  franja mal configurada habilita o bloquea de más. La auditoría lo hace visible.
- El chofer pasa a vender: una venta equivocada queda registrada a su nombre y se corrige
  con los procesos existentes de la asociación, no desde 4B.1.
- Con M1 = (a), un menor no puede viajar de noche registrado por el chofer.
- El pendiente 4 de B3 sigue abierto: un reinicio de PostgreSQL bloquea las reservas APP
  hasta reiniciar el gateway. La venta presencial no usa tickets de recuperación, pero el
  pendiente debe resolverse antes de cualquier piloto.
- Las reglas sobre menores deben revisarse con un abogado o la Defensoría antes de un piloto.
