# 4B.1 — Registro presencial por el chofer en turno fuera del horario con personal

Estado: **implementación de laboratorio para revisión del propietario**. PR #18 en borrador hacia
`main`. **No** autoriza producción, despliegue, fusión ni otro incremento.
Base exacta: `89ec52209e752085ab10bbcfec9e6c4714287e94` (`main`, cadena 5A.4-B3 integrada el
17-11-2026). Rama: `desarrollo/etapa-4b1`. Contratos: [decisión](../DECISION_REGISTRO_PRESENCIAL_CHOFER.md)
y [propuesta](../ETAPA_4B1_PROPUESTA.md).

Autorización del propietario (17-11-2026): «Autorizo 4B.1, solo laboratorio, con las
recomendaciones». Decisiones aplicadas: **R1** horario por asociación; **R2** solo el trufi en
turno, en su propio viaje; **M1** el chofer no registra menores y ve el protocolo del
propietario; **H1** solo el administrador completo cambia el horario; **H2** el cambio rige de
inmediato, con auditoría; **H3** el administrador conserva la venta presencial en cualquier
horario.

## Recorrido y reutilización

Chofer: panel `/chofer` → `DriverWalkInSale` (`apps/web/src/DriverWalkIn.tsx`) →
`/api/walk-in/driver-context|driver-quote|driver-register` → `web-driver-walk-in-service.mjs`
→ `business.walkIn` (existente) → `nexo.reserve_business` → `nexo.reserve` (029) →
`nexo.reserve_inventory` (núcleo 002, con la puerta `WALK_IN` ampliada en 043).
Administración: directorio → `UnstaffedHours` → `/api/unstaffed/schedule|command` y
`/api/walk-in/driver-registrations` → funciones `web_*` de 043.

Se reutilizan sin cambios: inventario por segmento, `fits`, orden de fila (`QUEUE_ORDER`),
tarifas vigentes, cotización, idempotencia por clave (`action_start`/`action_finish`),
asignación directa por turno en terminal (029) y la vista `DRIVER` de `web_trip_snapshot`.
No hay otro inventario ni otra fuente de verdad.

## Migración 043 (`database/migrations/043_driver_walk_in.sql`)

Aditiva y exclusiva de 4B.1. 001–042 intactas (`git diff 89ec522 -- database/migrations/0[0-3]*.sql
database/migrations/04[0-2]*.sql` vacío).

- Tablas `unstaffed_schedules` (revisión), `unstaffed_windows` (día ISO 1–7, inicio, fin; si el
  fin no es posterior al inicio, la franja cruza la medianoche) y `unstaffed_schedule_events`
  (inmutable). RLS activada y **sin** permisos directos para `nexo_app`.
- `unstaffed_at(asociación, instante)` y `unstaffed_now` (reloj del servidor, `America/La_Paz`;
  la hora del navegador nunca decide).
- `web_unstaffed_schedule` (lectura para cualquier administrador de la asociación; indica si
  puede editar) y `web_set_unstaffed_schedule` (solo administrador completo: sin
  `admin_limits`; reemplazo completo con revisión esperada, idempotente, bloqueo de la fila de
  la asociación y evento de auditoría).
- `driver_walk_in_allowed(ruta, petición)`, sin `EXECUTE` para nadie: el actor conduce el
  único viaje `QUEUED` de la petición, una sola parte, no expreso, sin división, subida en un
  punto `TERMINAL`, `containsMinors=false` explícito (M1) y dentro de una franja.
- La puerta `WALK_IN` de `reserve_inventory` se reescribe con el patrón de 039
  (`pg_get_functiondef` + un único reemplazo verificado): se conserva OID, ACL, firma, bloqueos y
  asignación; solo se añade `AND NOT nexo.driver_walk_in_allowed(r.id,p)`.
- `web_driver_walk_in_context` (orientación para la pantalla) y `web_driver_walk_ins` (lista de
  trazabilidad, filtrada por `manage_route`; sin identificadores internos de usuario).

Si alguna base local ya aplicó una versión anterior de 043 de esta rama, hay que recrearla: el
checksum cambió durante el desarrollo.

## Desviaciones respecto de la propuesta

1. **Registrador.** La propuesta hablaba de `group_responsibles`. La venta presencial existente
   no escribe allí automáticamente: quien registra queda en `bookings.created_by`. 4B.1 hace lo
   mismo y la lista de revisión identifica los registros de chofer por
   `created_by = trips.driver_id`. Un administrador que además condujera ese viaje aparecería
   como chofer en la lista (caso no presente en los datos de laboratorio).
2. **Trufi en turno.** La regla final es la del núcleo: la venta va al primer viaje de la fila
   donde cabe el grupo para ese tramo (`QUEUE_ORDER`). Si el primer trufi está lleno desde la
   terminal, el turno para ventas nuevas pasa al siguiente. La pantalla del chofer lo explica
   con la misma lógica (orientativa) y el servidor revalida al registrar.
3. **Recibo del chofer.** No hizo falta una lectura nueva: repetir el registro con la misma
   clave devuelve el mismo recibo nativo, incluso después de un cambio de horario.
4. **Código HTTP de `FORBIDDEN_SOURCE`.** Pasa a 403 en el gateway. Antes no estaba en la lista
   de códigos conocidos y se respondía 503 `SERVICE_UNAVAILABLE`; afecta también al rechazo de
   una venta presencial administrativa sin permiso, que ahora es 403. Ninguna prueba dependía
   del 503.

## Interfaz

- **Chofer** (`/chofer`, vehículo seleccionado): «Registrar pasajero en terminal». Primero
  «Comprobar si puedo registrar»; si el servidor no lo habilita, se explica el motivo (no está
  en fila, no es el que está en turno, horario con personal o sin terminal). Si lo habilita:
  subida en terminal, bajada, plazas, «Revisar importe», casilla obligatoria «Confirmo que en
  este grupo no viaja ningún menor de edad», casilla de confirmación del grupo y «Registrar
  grupo». El protocolo de menores del propietario se muestra en un desplegable. Reintento con
  la misma clave si la respuesta se pierde.
- **Administración** (directorio, asociación elegida): «Horario sin personal y registros de
  choferes». Franjas por día con inicio y fin, guardado con confirmación; un administrador
  restringido solo lo ve. Lista paginada «Registrados por choferes» (fecha, chofer, vehículo,
  ruta, plazas, importe y estado), solo para trazabilidad.

## Pruebas

Definidas en este incremento:

| Tipo | Archivo | Casos |
| --- | --- | --- |
| Unitarias | `tests/web-driver-walk-in.test.mjs` | 4B1-U1, 4B1-U2 |
| PostgreSQL real | `tests/integration/postgres.test.mjs` | 4B1-01 a 4B1-09 |
| E2E | `tests/web/driver-walk-in.spec.mjs` | 4B1-E1 (pasos E1a–E1d en serie) y 4B1-E2, escritorio y móvil |

Cobertura principal: autoridad del horario (completo, restringido, otra asociación, chofer,
pasajero), revisión obsoleta, validación en JS y en SQL, idempotencia, auditoría inmutable;
semántica horaria con instantes fijos (franjas que cruzan la medianoche, límites exactos, UTC
frente a La Paz); venta del chofer en turno con recibo repetible; rechazo al chofer que no está
en turno, de otra asociación o al pasajero; intentos de evasión por SQL directo (viaje ajeno,
expreso, menores, división, punto no terminal, sin partes); fuera de horario frente a la
administración (H3); carrera chofer + APP + administración con máximo seis por segmento y
traspaso del turno cuando el primero se llena; lista de trazabilidad con alcance; HTTP real
(CSRF, Origin, cuerpo cerrado, sesión revocada); actualización poblada de 042 a 043 con todos
los OID, ACL y definiciones históricas iguales salvo la puerta `WALK_IN`.

Ajustes en pruebas existentes, sin cambiar lo que comprueban: las listas de migraciones
aplicadas incluyen 043; el reinicio de datos trunca las tablas nuevas; las comparaciones de
actualización de 036–041 ignoran las tres tablas nuevas tras comprobar que están vacías; B2-09
vuelve a medir exactamente la actualización 041→042 y después aplica 043.

### Resultados locales (Linux, Node 22.23.4, PostgreSQL 16.15)

Entorno sin acceso al registro de npm: `pg`, sus dependencias, `async-exit-hook` y los tipos de
React se tomaron de sus repositorios públicos. `embedded-postgres` se sustituyó por el
PostgreSQL 16 del sistema, Playwright 1.59 con Google Chrome del sistema y **sin axe-core**
(las comprobaciones de accesibilidad solo cuentan en el CI). Nada de esto está en el repositorio.

- `npm run test:all`: unitarias **139/139**; PostgreSQL **433/433** (424 previas + 9 nuevas);
  `test:runner` y `test:local-api` aprobados.
- `web:check` (TypeScript 6 local, con `--noUncheckedSideEffectImports false` para igualar la
  semántica de TypeScript 5.9 del proyecto): sin errores.
- E2E `driver-walk-in.spec.mjs`: escritorio **5/5**, móvil **5/5** (móvil a 320 px, sin
  desbordamiento horizontal).
- E2E de otras suites en local, una por una: aprobadas las que se ejecutaron. Las que fallan
  aquí también fallan en `main` (`89ec522`) con este navegador local (por ejemplo
  `late-bfcache-native.spec.mjs`, que depende del bfcache nativo de Chromium de Playwright). La
  referencia válida para la batería web completa es el CI.

### CI de GitHub Actions

Ejecutado por GitHub sobre `fce63c7` (código y pruebas de este informe; el commit siguiente
solo añade documentación y vuelve a pasar por el CI):

| Trabajo | Resultado |
| --- | --- |
| Dominio y PostgreSQL 18.4 — Ubuntu y Windows, Node 22 y 24 (4 trabajos) | unitarias **139/139** y PostgreSQL **433/433** en cada uno |
| Web escritorio y móvil — Ubuntu y Windows, Node 22 y 24 (8 trabajos) | **113** E2E aprobados por trabajo, 0 fallidos; incluye `driver-walk-in.spec.mjs` con axe-core real |
| CodeQL (2 comprobaciones) | sin alertas |

Referencia anterior (ratificación de B3, `b5ebf13`): 137 unitarias, 424 PostgreSQL y 111 E2E
por trabajo. La diferencia corresponde exactamente a las pruebas nuevas de 4B.1 (2 + 9 + 2).
El primer commit funcional (`5caa134`, sin interfaz) también dio 14/14.

## Riesgos y límites

- El horario define cuándo puede actuar el chofer, no si de verdad falta personal: una franja
  mal configurada habilita o bloquea de más. Queda auditada.
- Una venta del chofer queda a su nombre. Su corrección usa los procesos existentes de la
  asociación (cancelación explícita del grupo antes de iniciar el viaje), no 4B.1.
- M1: un menor no puede viajar registrado por el chofer. La casilla es una declaración del
  chofer, no una verificación de edad.
- Revocar la membresía del chofer en paralelo a un registro se serializa como hoy con la
  reserva nativa; no se añadió un bloqueo nuevo sobre la membresía.
- El pendiente 4 de la ratificación de B3 sigue abierto (reinicio de PostgreSQL con el gateway
  en marcha). 4B.1 no usa tickets de recuperación.
- Las reglas sobre menores deben revisarse con un abogado o con la Defensoría antes de
  cualquier piloto. Solo laboratorio: sin producción, pagos, GPS, llamadas ni datos reales.

## Pendientes del propietario

- Revisión y ratificación de 4B.1.
- `AGENTS.md` sigue diciendo que el último incremento ratificado es 5A.4-B2 y que las nuevas
  migraciones empiezan en 043. Tras 4B.1, la siguiente libre es 044. Se propone actualizarlo
  con la ratificación.

## Reproducción

```powershell
npm ci --no-fund
npm run test:all
npx --no-install playwright install chromium
node scripts/test-web.mjs --suite=driver-walk-in.spec.mjs
```

Con `npm run dev:web`: entra como administrador completo, abre el directorio, elige la
asociación y guarda una franja que incluya la hora actual. Después entra como el chofer del
primer trufi de la fila en `/chofer`, elige su vehículo y usa «Registrar pasajero en terminal».
