# Etapa 2 — Incremento de reservas, filas y adaptador de negocio

26/10/2026, America/La_Paz. Repositorio exclusivo `pepoj1046-svg/proyecto-nexo`.
Rama `desarrollo/etapa-2`, creada desde **`918813947267ff0a2353b8154729a07d1c15a8df`**,
último commit verificado de `desarrollo/etapa-1`; no se partió de main. Árbol inicial
limpio, ramas comprobadas, documentos requeridos y revisión de ChatGPT
[6422855684](https://github.com/pepoj1046-svg/proyecto-nexo/pull/1#issuecomment-6422855684) leídos.
El propietario acepta el cierre técnico de Etapa 1 y autoriza este trabajo local.

## 1. Funciones nuevas o completadas

- Contratos estrictos para 1–6 plazas, grupos juntos, división voluntaria, expreso,
  presenciales, cancelación, respuesta del chofer, salida, progreso y retorno.
  Sesión/rol/asociación derivan del servidor y PostgreSQL, no del payload.
- Consulta de tarifa y reserva con precondición opcional de importe/tarifa/versión;
  rechazo atómico si cambian. Respuesta con precio pactado por parte y total en BOB.
- Cola y manifiesto paginados/ordenados y reserva individual sujetos a RLS, con
  proyecciones sin identidad personal del pasajero ni consultas globales ilimitadas.
- Registros de recogida/descenso por reserva en parada habilitada, con unicidad,
  locks, RLS y auditoría; estado UNRECORDED para datos antiguos sin inventar historia.
- Listener local de negocio independiente del de identidad/catálogo. Solo usa
  nexo_app, Bearer y claves de idempotencia para mutaciones; errores seguros.
- Launcher inicia/detiene ambos listeners sobre la misma base efímera y pools
  separados. No hay conexión propietaria/provisionadora en el listener de negocio.

Se reutilizan inventario, asignación, aceptación/rechazo, cancelación, filas y
despacho SQL anteriores. No se reimplementan esas funciones ni se amplía a público
la API de Etapa 1. APP y presenciales comparten la misma capacidad por segmento.

## Archivos del incremento

| Archivos | Alcance |
|---|---|
| database/migrations/012_business_operations.sql | Wrapper de reserva con precio esperado y bitácora de movimientos, RLS/ACL/locks |
| src/domain/business.mjs | Contratos, grupos/expreso, quote, IDs, claves y paginación |
| src/db/business-service.mjs | Reutilización de operaciones SQL, lecturas RLS y precios sin DML directo |
| src/http/business-api.mjs, local-transport.mjs, local-api.mjs | Listener separado y extracción del transporte ya probado, preservando rutas de Etapa 1 |
| scripts/local-demo.mjs, test-postgres.mjs, verify-local-api.mjs | Arranque/cierre y smoke de ambos puertos locales |
| tests/business.test.mjs, integration/postgres.test.mjs | Tres unitarias y B01–B13 PostgreSQL/HTTP, compatibilidad y concurrencia |
| .github/workflows/etapa-1-tests.yml | Misma suite Node 22/24 × Ubuntu/Windows en ramas/PR de ambas etapas |
| AGENTS.md, README.md y docs de Etapa 2 | Autorización actual, contratos, decisiones, resultados y trabajo restante |

## 2. Pruebas ejecutadas y resultados

Linux x64, Node **24.19.0**, npm **11.9.0**, PostgreSQL **18.4 real** del lockfile.
La prueba crea un clúster nuevo solo en 127.0.0.1 y lo detiene al finalizar. Todos
los operadores, catálogos, reservas, credenciales y movimientos son ficticios.

```text
npm run test:all
  unitarias:              26/26 aprobadas
  integración PostgreSQL: 79/79 aprobadas
  fallos/omitidas/canceladas: 0
  runner:                 fallo intencional 9 conservado; PostgreSQL detenido
  launcher:               identidad y negocio separados; HTTP/PostgreSQL detenidos
exit: 0
git diff --check
exit: 0
```

- Se conservan las 23 unitarias y 66 integraciones de Etapa 1; nueva cobertura:
  tres unitarias de contratos y 13 integraciones B01–B13.
- B01: precio esperado, rollback completo de quote distinta, reintentos y tarifa
  histórica conservada pese a cambios de importe/versión. SQL rechaza quote no objeto.
- B02: **24 solicitudes mixtas APP/presencial** por última plaza: **un éxito**;
  ocupación máxima seis en todos los segmentos, roles ajenos denegados.
- B03/B04: partes de grupo atómicas, rechazo/cancelación vinculada, expreso,
  juntos por defecto, 12 reintentos con una reserva y conflicto de payload.
- B05/B06: RLS de cola/manifiesto/reserva, paginación/orden, sesiones inválidas y
  aceptaciones/rechazos concurrentes con una sola transición/auditoría.
- B07–B09: recogida/descenso, diez registros de BOARD concurrentes sin duplicar,
  choferes A/B, parada/progreso/permiso, inmutabilidad y carrera contra progreso.
- B10/B11: reutilización de plazas en segmentos disjuntos, cancelación, HTTP real
  Bearer/idempotencia/quote, denegación de source/actor y ausencia de SQL/provisión.
- B12: actualización poblada **001–011 → 012**, sin cambiar tablas/filas previas;
  reservas antiguas mantienen precio y pueden despacharse y registrar movimientos.
- B13: ciclo HTTP presencial → aceptación → salida → BOARD → progreso → ALIGHT →
  retorno voluntario a ruta IN de destino; cola OUT incompleta preservada y B aislada.
- G12 conserva SHA-256 de **001–011**; siguen las actualizaciones desde 001–004 y
  001–009, inventario concurrente, permisos, precio/segmentos, sesiones y mantenimiento.

La CI remota Node 22/24 × Ubuntu/Windows se verificará sobre el commit publicado
y se incorporará el enlace/resultado observado. No se acredita antes de ejecutarla.

## 3. Problemas encontrados y corregidos

El adaptador anterior delegaba payloads de reserva al SQL sin un contrato de negocio
estricto ni proyecciones de precio/fila/manifiesto para el consumidor. Se añade una
capa tipada por validación con fuente APP/WALK_IN fijada por operación, sin confiar
en IDs de asociación/actor del cliente.

Una consulta de tarifa y una reserva son instantes distintos: el precio puede
cambiar entre ambos. La precondición quote compara la instantánea reservada dentro
de la transacción; un cambio revierte también acciones/auditoría. No se presenta una
consulta de tarifa como retención de plazas.

El recibo idempotente anterior puede conservar HELD tras una aceptación. La nueva
respuesta llama a ese dato initialStatus y muestra estados observados por parte,
sin confundir el recibo con estado actual ni cambiar la idempotencia del núcleo.

La bitácora no existía para reservas antiguas. Se mantiene vacía/UNRECORDED tras
migrar, sin backfill ficticio ni modificación de estados/plazas. Se usan los locks
de ruta/viaje existentes para no registrar una parada pasada durante una carrera.

La validación separa quote no objeto y limita versión/decimales antes de casts.
Las diferencias entre contrato de quote y moneda de respuesta se normalizan sin
admitir otra moneda. Las regresiones completas aprobaron; no se han observado
fallos de prueba pendientes ni se atribuyen fallos ficticios a la versión anterior.

## 4. Compatibilidad con Etapa 1

001–011 no se modifican; 012 es aditiva. Las filas existentes se conservan, las
sesiones siguen autorizando según sus reglas y la lectura operativa continúa bajo
RLS. La API de identidad conserva rutas/contratos y sus pruebas; el transporte se
comparte como código, no como autoridad ni superficie pública.
No se decide por nuevo código el plazo definitivo, ausencias, menores o manifiesto;
se conservan los supuestos de laboratorio y la finalización de viajes iniciados.
No se modifica main ni la rama de Etapa 1, no se fusiona/cierra PR #1.

## 5. Decisiones pendientes

Ver [registro separado](../DECISIONES_PENDIENTES_ETAPA_2.md): plazo de oferta,
ausencias/tolerancias, menores, manifiesto/recogidas posteriores, reservas futuras
tras revocación y servicios completos intramunicipales. También permanecen fuera
de esta entrega proveedores públicos, permisos/fuentes reales, GPS, cobros y gastos.

## 6. Trabajo restante para cerrar Etapa 2

1. Revisión funcional/técnica de contratos, proyecciones, bitácora por reserva y
   límites actuales. Confirmar que la observación por grupo satisface el incremento;
   el abordaje de personas individuales no está modelado ni verificado.
2. Resolver las decisiones reservadas antes de implementar reglas dependientes;
   no se fija automáticamente una política comercial por pasar tests.
3. Completar escenarios adicionales derivados de esa revisión, incluido tratamiento
   de correcciones operativas de movimientos si se autoriza, sin inventar historia.
4. Revisar la CI y el PR independiente hacia desarrollo/etapa-1 y aceptar el alcance
   de cierre de la etapa. No se inicia Etapa 3 ni se autoriza merge con este informe.

Este incremento deja las operaciones técnicas independientes ejecutables y probadas
en el laboratorio. No declara la Etapa 2 cerrada ni el sistema apto para producción.
