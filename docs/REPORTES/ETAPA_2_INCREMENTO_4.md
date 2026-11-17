# Etapa 2 — Incremento 4: recuperación y correcciones por episodio

26/10/2026, UTC. Repositorio exclusivo `pepoj1046-svg/proyecto-nexo`, rama
`desarrollo/etapa-2`; punto inicial verificado **b7303036743c6695ab425f918976c564e53a475f**,
árbol limpio y referencia remota coincidente. Se revisaron AGENTS, contratos,
decisiones, reporte 3 y [última revisión ChatGPT](https://github.com/pepoj1046-svg/proyecto-nexo/pull/2#issuecomment-6425278787).
[PR #2](https://github.com/pepoj1046-svg/proyecto-nexo/pull/2) conserva base
`desarrollo/etapa-1`. Sin cambios en main, fusiones, cierre de PRs ni Etapa 3.

## 1. Funcionalidades implementadas

**Incidencia visible y recuperación supervisada.** Un rechazo o vencimiento de una
oferta trasladada produce `RECOVERY_PENDING` en las vistas del pasajero y del
administrador, incluso si el núcleo todavía no materializó EXPIRED. No se presenta
como una reserva confirmada. `booking.assignment`, assignment-status y recovery-queue
permiten revisar la incidencia sin crear otra reserva ni vender plazas.

La consulta RECOVER busca vehículos de la misma ruta/sentido/asociación por orden
de fila, con conductor habilitado, plazas por segmento y tarifa original aún
compatible. La ejecución exige aprobación del administrador y vuelve a validar
bajo el bloqueo de ruta. Si el vehículo original ya salió o se llenó, queda excluido;
si aún es el primer candidato elegible, solo puede elegirse explícitamente. No hay
restauración automática. La nueva propuesta vuelve a requerir aceptación del chofer.
Sin alternativa, la incidencia y toda la historia permanecen; no se inventa una
confirmación, compensación ni capacidad disponible.

**Episodios inmutables.** 015 añade assignment_episodes, assignment_outcomes,
episode_terminal_events y terminal_config_changes, más una vista de lectura con
RLS del invocador. El episodio 0 es una instantánea de la asignación existente;
los nuevos episodios registran origen, destino, administrador, fecha, grupo completo,
segmento y precio/tarifa/version preservados. Se registran aceptación, rechazo,
vencimiento materializado y cancelación explícita mediante el núcleo existente.
Los vencimientos no materializados se muestran como evaluación efectiva, sin
fabricar un evento persistido. Cada cambio añade un episodio; no se sobrescribe
historia ni se generan nuevos integrantes o reservas.

Se admiten visitas repetidas A→B→A→B con episodios diferentes. **Límite técnico de
laboratorio: ocho nuevas propuestas por reserva tras el episodio base**, sumando
traslados y recuperaciones. Al agotarlo, las vistas indican episodeLimitReached;
una incidencia fallida sigue pendiente de revisión. No se reinicia el contador ni
se cancelan reservas por alcanzar ese límite. Es un límite defensivo de ejecución,
no un plazo, recargo ni política comercial definitiva.

**Llegada efectiva y corrección.** El administrador propio puede retirar una
DECLARED o VERIFIED del episodio actual con un motivo codificado obligatorio:
OPERATOR_ERROR, WRONG_RESERVATION o PASSENGER_CORRECTION. Se añade un evento que
referencia la prueba original, con actor y hora. La prueba no se elimina ni modifica.
Solo puede retirarse la última verificación efectiva; una verificación nueva puede
atestiguar nuevamente la presencia tras corregir. Reintentar la corrección de una
prueba vieja no retira una prueba posterior. Nunca se corrige en viaje, con BOARD/
ALIGHT registrados o con una reserva que ya no está confirmada/en fila. No se toca
pago, estado de reserva ni movimiento observado.

Cada nuevo episodio comienza sin DECLARED, VERIFIED, READY, respuesta ni reloj de
recogida heredados. Se necesita evidencia nueva. El episodio base mantiene la lectura
compatible de eventos antiguos, incluida la presencia que 014 había conservado;
no se presenta como una comprobación nueva. El historial legado se conserva aparte,
sin reconstruir episodios históricos que no pueden probarse con esos datos.

**Vencimiento configurable y ausencia inactiva.** DECLARED conserva una sola fecha
de caducidad por episodio; ni reintentos, ni cambio de configuración, ni su retirada
reinician ese plazo. VERIFIED válida prevalece sobre una declaración vencida. La
configuración sigue siendo obligatoria, sin default comercial, y ahora registra
actor, valor anterior, valor nuevo y hora en una bitácora inmutable. Configuraciones
anteriores a 015 no reciben cambios históricos inventados.

Continúan 0/5/8 desde READY explícito y cinco minutos desde PICKUP_ARRIVED. La
corrección modifica la evaluación efectiva, **no ejecuta una cancelación**. Todas
las respuestas siguen indicando delivery=DISABLED y automaticCancellationEnabled=false.
La cancelación explícita previa sigue siendo independiente; no hay scheduler,
notificaciones, sanciones, cobros ni liberación automática por ausencia.

## 2. Problemas encontrados y solucionados

- En 014, REJECTED/EXPIRED tras un traslado podía confundirse con pérdida definitiva
  sin una tarea visible de recuperación. Ahora existe incidencia consultable y
  una propuesta posterior aprobada, sin restaurar automáticamente el origen.
- La unicidad antigua por reserva/viaje impedía cambios repetidos y habría mezclado
  relojes si se reutilizaba el vehículo. Los nuevos eventos y estados efectivos
  pertenecen a un episodio; el contrato nuevo incluye su versión esperada.
- VERIFIED era una afirmación irreversible y podía seguir priorizando una reserva
  tras un error del operador. Los eventos compensatorios cambian la presencia
  efectiva utilizada por evaluación y propuestas de adelanto.
- La auditoría de configuración previa no conservaba los dos valores de duración.
  Se registra ese cambio sin alterar la caducidad de declaraciones ya emitidas.
- Una prueba ampliada detectó una variable SQL `kind` ambigua en la nueva corrección.
  Se renombró; esa ejecución fallida no se contabiliza como aprobada. Las operaciones
  concurrentes de esa prueba se esperan con allSettled antes de limpiar fixtures:
  el primer fallo dejaba solicitudes pendientes y causaba bloqueos durante TRUNCATE.
  No se atribuye ese fallo de limpieza al protocolo transaccional de producción.

Se conserva el orden clave de idempotencia → ruta → viaje. La respuesta versionada
al chofer adquiere también su clave interna antes del bloqueo de ruta, evitando
invertir ese protocolo al delegar al núcleo. Los helpers privados no son ejecutables
por nexo_app; SECURITY DEFINER fija search_path y no concede ejecución a PUBLIC.

## 3. Pruebas realizadas y resultados

Comando reproducible: `npm run test:all`. Linux x64, Node **24.19.0**, npm **11.9.0**,
PostgreSQL **18.4 real**, clúster efímero exclusivamente en 127.0.0.1. Todos los
usuarios, sesiones, reservas y catálogos son ficticios. La primera compatibilidad
mantuvo las **134 pruebas anteriores**; se añade una unitaria y K01–K16.

```text
unitarias:                29/29 aprobadas
integración PostgreSQL:  122/122 aprobadas
fallos/omitidas/canceladas: 0
runner: salida intencional 9 conservada; PostgreSQL detenido
smoke: identidad/negocio separados, ambos listeners y PostgreSQL detenidos
npm run test:all: salida 0
git diff --check: salida 0
```

Cobertura nueva:

| Escenarios | Evidencia |
|---|---|
| K01–K03 | Rechazo, vencimiento aún no materializado, origen ya en viaje, ausencia de capacidad, incidencia visible y recuperación sin duplicar IDs/grupos/precios |
| K04–K05 | Dos administradores, doce solicitudes concurrentes, reintentos, conflictos, ocho cambios sucesivos y rechazo de versiones antiguas; relojes/pruebas de llegada nuevos |
| K06–K08 | Declaración vencida y reintentos, verificación que prevalece, retiro y nueva verificación, motivo, evidencia original, auditoría y duración inmutable |
| K09–K11 | Corrección/salida concurrentes, abordaje inalterado, candidato que pierde capacidad bajo un lock concurrente, tarifa incompatible y autorización revocada |
| K12 | HTTP real: versiones obligatorias, motivos, UUIDs, roles, lecturas acotadas y conflictos seguros |
| K13 | Actualización poblada 001–014→015: todas las filas anteriores idénticas, incidente legado detectado, precio y continuación de BOARD/ALIGHT conservados, reaplicación vacía |
| K14–K15 | Revocación de administrador mientras espera ruta, otra asociación, ACL/RLS/inmutabilidad y carrera vencimiento/recuperación/cancelación/llegada sin duplicar capacidad |

K16 comprueba que la aceptación del nuevo chofer espera una modificación concurrente
de tarifa y la rechaza si ya no es compatible, conservando importe/miembros y sin
confirmación parcial. La validación final también comprueba paradas, membresía,
inventario y caducidad después de adquirir los bloqueos de tarifa/paradas/viaje.
Una incompatibilidad devuelve TRANSFER_CONDITIONS_CHANGED; rechazar la oferta
continúa permitido y deja la incidencia para revisión.

La unitaria adicional rechaza versiones ausentes/fuera de rango, motivos libres,
confirmación omitida, paginación excesiva y campos de asociación no permitidos.
G12 fija SHA-256 de **001–014**. Se mantienen reservas 1–6, APP/presenciales, filas,
segmentos/tarifas, búsqueda sin selector de categoría, identidad y todas las
actualizaciones pobladas de etapas anteriores.

Commit de implementación **a0cb6a7898a1d542691c5e5ee13b95fbca87bfe7**:
[CI del PR #2](https://github.com/pepoj1046-svg/proyecto-nexo/actions/runs/40389925988)
finalizó con los cuatro jobs en **success**. Se inspeccionaron sus logs:

| Plataforma | Node | Unitarias | PostgreSQL 18.4 real | Runner/listeners |
|---|---|---|---|---|
| Ubuntu | 22 | 29/29 | 122/122 | Aprobados |
| Ubuntu | 24 | 29/29 | 122/122 | Aprobados |
| Windows | 22 | 29/29 | 122/122 | Aprobados |
| Windows | 24 | 29/29 | 122/122 | Aprobados |

La evidencia corresponde al código del incremento 4; no se reutilizan resultados
de 014. El commit documental posterior registra estos resultados, sin cambios de
código, y tiene sus propios checks en el PR. main y desarrollo/etapa-1 conservaron
sus referencias remotas y el árbol de trabajo quedó limpio tras publicar.

## 4. Compatibilidad y archivos

001–014 permanecen byte a byte intactas. 015 no cambia filas previas ni añade
columnas a reservas: incorpora tablas, índices, vista, triggers de seguimiento y
adapta solo las operaciones que necesitan conocer el episodio/estado efectivo.
El inventario, miembros, movimientos, aceptación/rechazo, vencimiento, cancelación,
salida y tarifas del núcleo existente se reutilizan. Las firmas anteriores siguen
disponibles; las rutas nuevas usan versión explícita para trabajo supervisado.

| Archivo | Cambio |
|---|---|
| database/migrations/015_assignment_recovery.sql | Episodios, resultados, correcciones, recuperación, aislamiento y auditoría |
| src/db/business-service.mjs | Estado visible de asignación, incidencias, historial y operaciones versionadas |
| src/domain/business.mjs, src/http/business-api.mjs, src/http/local-transport.mjs | Contratos estrictos, endpoints locales y conflicto STALE_ASSIGNMENT |
| tests/business.test.mjs, tests/integration/postgres.test.mjs | Contratos, K01–K16, upgrade poblado y checksums |
| AGENTS.md, README.md, contratos/decisiones y este reporte | Alcance vigente, evidencia y límites |

## 5. Riesgos y límites del laboratorio

RECOVERY_PENDING **no garantiza** plaza ni asignación confirmada: no reserva capacidad
hasta aprobar otra propuesta y esta aún requiere aceptación. assignedTripId es el
último viaje persistido de la reserva; confirmedTripId solo existe cuando está
CONFIRMED y proposedTripId solo cuando hay HELD vigente. No se debe presentar un
recibo idempotente antiguo como el estado actual: consultar assignment-status.

Las consultas son READ COMMITTED y no retienen plazas. La ejecución revalida todo;
el cliente nuevo envía episode esperado. Las firmas heredadas conservan idempotencia
y captura del episodio en servidor, pero no sustituyen la versión del contrato
nuevo para una interfaz que pueda trabajar con pantallas antiguas.

Grupos ya divididos no se recomponen ni reasignan por partes automáticamente. Los
miembros de una reserva de una sola parte viajan juntos; corregir presencia atestigua
la reserva completa, no la identidad individual de personas. Faltan procedimientos
de evidencia/retirada de presencia para operación real, correcciones de movimientos
observados y verificación de menores. No se falsean descensos para desbloquear BOARD.

La etapa base de una reserva previa es una instantánea, no una reconstrucción de
aceptaciones/rechazos históricos. Los registros 014 originales se conservan para
revisión. No se han probado otras versiones PostgreSQL fuera de 18.4 ni operación
pública, distribuida o real. Ninguna bitácora nueva tiene limpieza destructiva
activada; retención y acceso comercial requieren aprobación.

## 6. Decisiones pendientes para cerrar la etapa

- Plazos comerciales de oferta/declaración; evidencia, excepciones y revisión antes
  de habilitar ausencia, comunicación o consecuencias. 120 s sigue provisional.
- Tratamiento de incidencias sin alternativa y tras agotar el límite técnico;
  ninguna compensación, promesa de viaje ni cancelación definitiva se inventa.
- Revisión de llegada al cambiar de vehículo, menores, recomposición voluntaria
  de grupos ya divididos y corrección compensatoria de BOARD/ALIGHT.
- Regla de salida/manifiesto con recogidas posteriores, reservas futuras ante
  revocación, recorridos intramunicipales completos y retención/comercialización.
- Revisión funcional del incremento y aceptación de alcance antes del cierre de
  Etapa 2. PR #1/#2 permanecen abiertos; no hay autorización de merge con este reporte.

**Evaluación:** recuperación y correcciones ejecutables en laboratorio con estados
explícitos y supervisión; Etapa 2 sigue abierta. Sin producción, gastos adicionales,
datos reales, GPS, proveedores de notificaciones, cobros ni Etapa 3.
