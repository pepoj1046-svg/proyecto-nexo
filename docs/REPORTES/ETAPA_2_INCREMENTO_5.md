# Etapa 2 — Incremento 5: terminal, grupos y sustitución urbana

26/10/2026, America/La_Paz. Repositorio exclusivo `pepoj1046-svg/proyecto-nexo`,
rama `desarrollo/etapa-2`; base verificada **c947837979818cfa88b4584d3571ad9fabdb71ed**,
árbol inicialmente limpio y referencia remota coincidente. Se leyeron AGENTS,
contratos/decisiones e informes 1–4 y la [revisión del PR #2](https://github.com/pepoj1046-svg/proyecto-nexo/pull/2#issuecomment-6426224166).
PR #2 conserva base desarrollo/etapa-1. No se modifica main ni se fusionan/cierran
PR #1/#2. Solo PostgreSQL local, identificadores ficticios y simulación.

## 1. Funcionalidades y decisiones aprobadas implementadas

### Confirmación administrativa y consentimiento del responsable

016 añade un contrato explícito para activar reservas de terminal ya confirmadas
y para autorizar traslados completos. El responsable APP es el pasajero de sesión;
en WALK_IN el administrador registra explícitamente un usuario ficticio responsable.
No se confunde al creador administrativo de una reserva presencial con su pasajero.
Ese responsable puede consultar su grupo, recibir avisos simulados y consentir un
traslado a un vehículo concreto. El consentimiento conserva una instantánea de
todas las partes: ruta, paradas, plazas, precio/tarifa/versión, expreso, responsable,
asignación y episodio. No puede reutilizarse después de consumido o tras cambios.

El administrador ejecuta la reasignación compatible bajo bloqueo de ruta, tarifa,
paradas, vehículo/viaje y membresía. Se respeta el primer destino elegible de la fila,
excluyendo los viajes de origen, y se comprueba capacidad conjunta. Si adelanta al
grupo a una posición anterior, exige presencia verificada efectiva. Cada parte
conserva ID, miembros, plazas e importe. No hay separación automática ni recargo.
La recomposición de partes previamente divididas requiere responsable común,
consentimiento de todo el grupo, mismo recorrido/segmento y suma 1–6. Se soporta
recomponer en un tercer viaje compatible; no se recomponen automáticamente otras
situaciones ni se altera el consentimiento previo.

La asignación aprobada queda **CONFIRMED**, con evidencia del administrador. No
requiere otra aceptación discrecional. El indicador heredado driver_accepted queda
false al cambiar de vehículo: no se inventa una acción del nuevo chofer. La autoridad
se expone como ADMIN_APPROVED; el despacho usa el estado confirmado. Se generan
avisos inmutables al chofer y responsable con delivery=DISABLED. El rechazo arbitrario
se bloquea mediante TERMINAL_RESERVATION_BINDING. Los impedimentos legítimos se
registran como incidencias y requieren confirmación/gestión del administrador.

El contrato heredado de ofertas HELD y recuperación de 015 continúa funcionando.
Una incidencia anterior RECOVERY_PENDING también puede entrar al nuevo contrato
con consentimiento actualizado y aprobación compatible, sin otra aceptación del
chofer. No se resucitan cancelaciones voluntarias ni se prometen plazas inexistentes.
El límite de ocho episodios de asignación anterior sigue vigente.

### Pago simulado y estados separados

Pago por defecto UNVERIFIED; únicamente la asociación administrada puede añadir
VERIFIED_SIMULATED o REVOKED_SIMULATED, con actor, importe ficticio y hora. No se
interpreta llegada, reserva, consentimiento ni BOARD como pago. No se cobran bancos,
no se procesan comprobantes ni se guardan datos financieros sensibles. El pago
simulado no se convierte en una condición comercial nueva para abordar o salir.

Se distinguen reserva confirmada, DECLARED, VERIFIED y BOARD efectivo. La asociación
puede confirmar presencia sin conexión del pasajero. El nuevo terminal-arrival y
las reservas activadas en el contrato de terminal usan **120 segundos provisionales**
para nuevas declaraciones. Reintentos no renuevan ese plazo ni READY. Los contratos
heredados conservan su configuración y sus declaraciones previas, sin reescribir
historia; el cliente del incremento 5 utiliza las rutas nuevas. VERIFIED válida
prevalece sobre una declaración vencida. Continúan las correcciones auditables de
llegada, la tolerancia simulada 0/5/8 y cinco minutos desde PICKUP_ARRIVED. No se
activan cancelaciones ni liberación automática por ausencia.

### Abordaje y correcciones de movimientos

Chofer o administrador propio puede registrar una observación de terminal tras
confirmar código de reserva, destino y plazas esperadas. Se usan UUIDs y etiquetas
ficticias, sin nombres/documentos reales. BOARD puede registrarse antes de salir
en parada 0; los endpoints heredados conservan su contrato anterior.

movement_facts y effective_movements combinan historia original y compensaciones.
Una corrección exige administrador, motivo codificado, confirmación y la parada
actual exacta del hecho. Nunca se borra el BOARD/ALIGHT original. Tras retirar un
hecho erróneo, un hecho real posterior se añade como registro nuevo. El manifiesto,
estado observado y controles usan la vista efectiva, sin cambiar el inventario
contratado ni los precios. No se mezclan registros grupales e individuales dentro
de una reserva. Registrar todo el grupo atestigua todas sus plazas; para observar
solo parte del grupo se usa el modo individual desde el primer registro.

Retirar ALIGHT no puede elevar el total físico observado sobre seis; tampoco se
retira BOARD si tiene un descenso efectivo dependiente. No se corrigen paradas ya
pasadas, movimientos durante una unidad bloqueada/rescate, ni una carrera completada
si ese vehículo tiene otra carrera activa/posterior. Esos casos quedan para revisión,
sin descensos ficticios ni ajustes artificiales de ocupación. La cancelación ordinaria
no puede liberar plazas de una reserva con pasajeros efectivamente a bordo en fila.
La evaluación de ausencia tampoco considera ausente a un grupo con abordaje efectivo.

### Sustitución completa dentro de la ciudad

017 mantiene el **mismo trip_id lógico** y todas sus reservas, segmentos, miembros,
importes y movimientos. Añade fases operativas y bitácora de unidades/incidencias.

1. begin-urban registra salida urbana declarada y el índice ficticio donde comienza
   el tramo principal. El manifiesto del protocolo inicial tiene seis plazas
   confirmadas, recogidas urbanas y destinos posteriores a ese límite; no se deduce
   el límite urbano por GPS ni se reclasifican carreras antiguas automáticamente.
2. El chofer reporta la avería; la unidad se bloquea inmediatamente. El administrador
   la confirma y queda AWAITING_REPLACEMENT. Se impiden nuevos compromisos incompatibles,
   movimientos y progreso de la unidad afectada.
3. Se recomienda el primer viaje de fila de la misma asociación/ruta/sentido que
   esté en origen y completamente libre: sin reservas vivas, observaciones pendientes
   de pasajeros, operación urbana propia ni bloqueo de servicio. Las restricciones
   únicas impiden otra carrera activa del mismo vehículo o conductor.
4. El administrador aprueba. La entrada de fila del sustituto se marca WITHDRAWN,
   **no COMPLETED**: no se inventa que hizo un viaje. La carrera original pasa al
   vehículo/chofer sustituto con exclusividad y fase RESCUE. La retirada, cambio,
   evento, avisos y reserva de la unidad son una sola transacción. El antiguo chofer
   deja de poder conducir esa carrera; solo la nueva unidad la ejecuta.
5. Antes de continuar se registra SAFE_TRANSFER: un lugar seguro completamente
   ficticio y el número exacto observado, con declaración auditada del chofer o
   administrador. No genera nuevos BOARD/ALIGHT ni simula descensos de A o nuevas
   reservas. Es un evento de custodia física declarada, no evidencia GPS.
6. El sustituto continúa URBAN_COLLECTION y registra las recogidas pendientes.
   No puede pasar una parada con recogidas sin atender ni avanzar más allá del
   límite principal sin registrar MAIN_START. Este último exige todos los abordajes
   comprometidos y el chofer autorizado.
7. Solo entonces se registra MAIN_TRIP y mainStartedAt. Manifest/progress de este
   contrato exponen la fase operativa; legacyStatus conserva el estado técnico del
   núcleo, que significa carrera activa, no inicio del tramo principal.
8. El original sigue fuera de servicio. Su habilitación requiere reparación declarada
   por un administrador, tras terminar el trasbordo seguro y sin otra carrera activa
   de ese vehículo. No se lo devuelve automáticamente a una fila ni se cambia el
   orden de los demás conductores.

Si no hay unidad libre, la incidencia permanece visible sin prometer rescate. Los
impedimentos de terminal (incluso antes de llenar el vehículo) también se registran
como MECHANICAL_FAILURE, EMERGENCY_DECLARED u OPERATIONAL_BARRIER, sin rechazo ni
cancelación arbitrarios. No se ejecuta sustitución urbana automática de una carrera
sin contexto urbano conocido. Puede liberarse un impedimento de terminal por un
administrador con prueba simulada de reparación y sin pasajeros a bordo.

En una emergencia con lesiones o riesgo físico se prioriza asistencia y coordinación
humana; este laboratorio no es un sistema de respuesta de emergencia. No se recopilan
detalles médicos, ubicaciones reales ni contactos externos. La sustitución fuera de
la ciudad requiere otro procedimiento y no está implementada.

## 2. Arquitectura, migraciones y problemas corregidos

001–015 permanecen byte a byte intactas. Las migraciones nuevas no modifican las
filas anteriores durante la actualización. Se amplía CHECK de trips.status con
WITHDRAWN y se actualizan los índices de unidad/chofer activos y el control de
retorno a fila para distinguir retirada de finalización. No se rehacen reserva,
precio, vencimiento, asignación ni despacho del núcleo: se añaden contratos y
controles que delegan las reglas heredadas cuando corresponde.

| Archivos | Alcance |
|---|---|
| database/migrations/016_terminal_boarding.sql | Responsable, consentimiento, pago/avisos simulados, confirmación administrativa, llegada 120 s, hechos efectivos y compensaciones |
| database/migrations/017_urban_replacement.sql | Fases, incidentes, bloqueo de unidades, selección/sustitución exclusiva, custodia segura, inicio principal y restauración |
| src/db/business-service.mjs | Operaciones locales y proyecciones efectivas de grupo/manifiesto/ocupación/historial |
| src/domain/business.mjs, src/http/business-api.mjs, src/http/local-transport.mjs | Solicitudes estrictas, permisos por sesión, conflictos seguros y endpoints protegidos |
| tests/business.test.mjs, tests/integration/postgres.test.mjs | Dos unitarias, L01–L13/F01–F11 y actualización poblada |
| AGENTS.md, README.md, contratos/decisiones y este reporte | Reglas aprobadas, compatibilidad, evidencia y límites |

Correcciones relevantes:

- Se evita confundir autorización administrativa con aceptación personal del chofer.
- El flujo anterior no admitía BOARD presencial ni una corrección efectiva; ahora
  las vistas y el límite físico respetan compensaciones sin liberar inventario.
- BOARD en fila creó un caso nuevo de cancelación/ausencia: ambas se protegen para
  no liberar plazas de personas ya a bordo, manteniendo inactiva la automatización.
- El mismo vehículo con observaciones pendientes de otra carrera no admite nuevos
  abordajes ni se considera una unidad libre para rescate.
- Un registro presencial que espera detrás de un traslado comprueba de nuevo viaje,
  episodio y revisión operativa: no registra abordaje en una asignación antigua.
- La nueva retirada de C no crea una llegada/finalización ficticia ni bloquea su
  retorno legítimo a fila cuando realmente termine la carrera asumida.
- La regresión H08 detectó search_path incompleto en la adaptación de request_queue;
  se fijó pg_temp explícitamente. PostgreSQL detectó un alias ambiguo y un error de
  paréntesis en el nuevo traslado grupal; se corrigieron y se volvió a ejecutar todo.
  La prueba concurrente espera todos sus resultados antes de limpiar fixtures para
  que un primer error no deje operaciones pendientes durante TRUNCATE. Las pasadas
  fallidas intermedias no se presentan como aprobadas.

Todas las tablas nuevas tienen RLS/ACL y las bitácoras son inmutables. Los helpers
SECURITY DEFINER fijan search_path y no están abiertos a PUBLIC; las funciones
internas renombradas no son ejecutables por nexo_app. Responsabilidad, asociación,
chofer, capacidad y autorización se comprueban en servidor. Las solicitudes no pueden
activar entregas ni aportar GPS. Orden de bloqueo: acción/idempotencia, ruta y filas
de negocio/unidad; se vuelve a comprobar la autoridad después de esperar.

## 3. Pruebas ejecutadas

Comando: `npm run test:all`. Linux x64, Node 24.19.0, npm 11.9.0, PostgreSQL **18.4
real** efímero en 127.0.0.1. Sin consumo de DATABASE_URL externo, datos reales ni
proveedores. Resultado local de la ejecución final:

```text
unitarias:                31/31 aprobadas
integración PostgreSQL:  146/146 aprobadas
fallos/omitidas/canceladas: 0
runner: fallo intencional 9 propagado; PostgreSQL detenido
smoke: identidad y negocio separados, ambos listeners y PostgreSQL detenidos
npm run test:all: salida 0
git diff --check: salida 0
```

Se conservan las **151 pruebas anteriores** y se añaden 26: dos unitarias y 24 de
integración. G12 fija SHA-256 de 001–015. Las expectativas de registro de migraciones
se amplían a 017; no se debilitan las aserciones comerciales o de seguridad anteriores.

| Escenarios | Resultado comprobado |
|---|---|
| L01–L03 | Confirmación sin segunda aceptación, rechazo bloqueado, consentimiento completo y recomposición, responsable presencial explícito, pago desconocido/verificado/revocado solo simulado |
| L04–L07 | 120 segundos y reintentos sin renovar READY, BOARD presencial con controles, compensaciones inmutables, contrato HELD heredado y consentimiento invalidado sin movimientos parciales |
| L08–L09 | Corrección de ALIGHT y nueva observación real; rechazo de una corrección que pondría nueve personas a bordo |
| L10–L13 | Recuperación anterior convertida al contrato nuevo, bloqueo de cancelación/ausencia con BOARD, salida sin driver_accepted inventado y carrera entre abordaje y reasignación |
| F01 | A con cuatro a bordo y dos pendientes; B descartado; C libre, exclusivo y retirado de fila; sin avance durante rescate; recogidas pendientes y MAIN_START posterior; reservas/precios intactos |
| F02–F04 | Ausencia de sustituto visible, dos administradores, reserva concurrente sobre C, un solo ganador y capacidad máxima seis |
| F05–F06 | Fallo inyectado revierte unidad/fila/avisos/acción; reintento único y reparación autorizada posterior al trasbordo seguro |
| F07–F09 | Permiso revocado mientras espera, sesión revocada, otra asociación, dos carreras averiadas por el mismo C, HTTP sin GPS, versiones ni verificaciones falsas |
| F10 | Base ficticia poblada 001–015→016/017: todas las filas previas idénticas, episodios y movimientos preservados, reaplicación vacía y continuidad del contrato heredado |
| F11 | Impedimento legítimo de terminal documentado, confirmación del administrador y habilitación explícita sin inventar sustitución |

CI Node 22/24 × Ubuntu/Windows: pendiente de verificar sobre el commit publicado de
este incremento. No se atribuyen a 016/017 los checks del incremento 4.

## 4. Riesgos, límites y decisiones antes del cierre

- El alcance sigue siendo backend de laboratorio y declaraciones humanas auditadas,
  sin identidad personal verificada, posición física comprobada ni piloto con pasajeros.
- El protocolo urbano inicial exige declarar main_stop antes de salir y un manifiesto
  de seis plazas confirmadas con recogidas urbanas y destinos posteriores al límite.
  Las carreras antiguas en curso no se convierten en urbanas por inferencia. Manifiestos
  urbanos más complejos, unidades parciales ya en ruta o rescate fuera de ciudad requieren
  especificar su procedimiento; permanecen como incidencia, sin promesas de automatización.
- El contrato antiguo de ofertas/TTL permanece para compatibilidad e incidencias
  anteriores. Los clientes nuevos usan los endpoints de terminal; las declaraciones
  históricas y los overrides de laboratorio existentes no se reescriben como 120 s.
- El responsable común consiente expresamente todas las partes antes de recomponer;
  no se combina a diferentes responsables ni se elige como destino un viaje que ya
  contiene otra parte del grupo. Falta definir esos casos y verificación de menores.
- Las correcciones no cambian pagos, tarifas o reservas ni permiten superar seis.
  Si ya pasó la parada, hay otra carrera del vehículo o la unidad está bloqueada,
  se requiere revisión humana. No se inventan descensos o nuevas observaciones.
- Restaurar una unidad acredita únicamente que un administrador declaró su reparación
  en la simulación; no certifica condiciones mecánicas reales ni la reincorpora a fila.
- Sin unidad elegible se conserva la incidencia. Compensaciones, tratamiento tras
  agotar ocho episodios, retención de bitácoras, ausencia activa, excepciones y fuentes/
  permisos reales necesitan revisión comercial/operativa. No se inventan plazos legales.
- Permanecen pendientes recorridos intramunicipales completos, reservas futuras ante
  revocación, seguridad/operación real y revisión funcional de los nuevos contratos.

**Evaluación:** las reglas autorizadas están ejecutables y verificadas en laboratorio,
con compatibilidad del núcleo anterior. Etapa 2 permanece abierta a revisión; este
informe no autoriza cierre, merge, Etapa 3, despliegues ni uso con pasajeros reales.
Sin gastos adicionales, cobros, GPS o notificaciones externas.
