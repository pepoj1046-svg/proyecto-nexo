# Etapa 2 — Incremento 3: llegada, ausencia simulada y reasignación supervisada

Repositorio exclusivo `pepoj1046-svg/proyecto-nexo`, rama `desarrollo/etapa-2`.
Base revisada: `91eae3c`; PR #2 abierto hacia Etapa 1. Se revisaron AGENTS, contratos,
decisiones e informes previos y la revisión ChatGPT
[6424162045](https://github.com/pepoj1046-svg/proyecto-nexo/pull/2#issuecomment-6424162045).
No se modifica main ni se fusionan/cierra PR #1/#2. Solo laboratorio ficticio.

## Implementación

- Migración **014**: configuración explícita por asociación para vencimiento de
  llegada declarada, bitácora inmutable con actor/hora, RLS/ACL, operaciones de
  llegada, evaluación temporal, propuestas y transferencias supervisadas.
- DECLARED requiere confirmación explícita. No existe TTL comercial predeterminado:
  el administrador debe configurar segundos para la simulación (límite técnico
  1–86400). La primera declaración fija expires_at; reintentos con otra clave no
  renuevan el reloj. VERIFIED exige administrador propio y no necesita declaración
  previa: permite atender presencialmente a quien no tiene internet.
- La verificación es una **atestación del administrador** al comprobar la reserva
  y su destino/código técnico. No verifica automáticamente documentos/nombres reales.
  Los tests usan usuarios/etiquetas ficticios; no se añaden campos personales.
  Llegada, pago y BOARD son distintos: no se crea verificación de pago ni abordaje.
- READY es un evento explícito autorizado al chofer/administrador: viaje QUEUED con
  al menos seis plazas confirmadas y sin ofertas vigentes pendientes. Es una
  evidencia de preparación declarada por el operador, no prueba física/GPS.
  La creación de reserva no inicia el reloj. Se registra por reserva destinataria;
  preparar varias exige registrarlas explícitamente, sin envío masivo implícito.
- Evaluación terminal: minuto 0 aviso simulado, a 5 minutos alternativas, a 8
  elegibilidad **solo simulada** si continúa confirmada/en fila, origen terminal,
  sin llegada verificada, declaración vigente ni respuesta. No hay cancelador,
  scheduler, envío ni liberación por ausencia. La cancelación explícita anterior
  del pasajero/administrador sigue siendo una operación independiente.
- PICKUP registra respuesta. READY permite simular «en camino»; PICKUP_ARRIVED
  exige viaje IN_TRANSIT en el punto contratado. Solo ese evento inicia cinco
  minutos de espera. Su transcurso no libera plazas ni cancela.
- TRANSFER_REQUEST registra solicitud de retraso. El administrador consulta
  candidatos LATER en orden de fila y confirma el primero compatible. Si B no
  admite el grupo, aparece C. No hay modificación automática al consultar.
- Adelanto: advancement-candidates propone reservas con presencia VERIFIED en
  viajes posteriores, cuyo primer destino elegible anterior sea el viaje solicitado.
  Examina las primeras 50 reservas ordenadas de ese ámbito. Son alternativas,
  no plazas retenidas ni una selección acumulativa; cada ejecución revalida.
- Transferencia atómica bajo lock de ruta, mismo segmento/ruta/asociación,
  membresía activa, autorización vigente, capacidad por segmentos, tarifa original
  aún válida y precio/version compatibles. Conserva ID, grupo, integrantes, plazas,
  segmento e importe. No permite historial BOARD/ALIGHT ni divide grupos.
  Destino queda **HELD** por 120 segundos provisionales y requiere aceptación de
  su chofer: no se traslada la aceptación del chofer anterior. No altera posiciones.
  Si falla la selección/validación/transacción, permanece la reserva original.

## Límites explícitos y decisiones pendientes

- Grupos ya divididos entre varios vehículos no se reasignan aquí: falta definir
  recomposición conjunta y consentimiento. Se admiten grupos completos 1–6 de
  una sola parte y reservas independientes. No se promueve una parte aislada.
- El historial admite una transferencia desde cada viaje por reserva. Tras volver
  a un viaje ya abandonado no se propone otra transferencia desde él; falta un
  modelo de episodios para ciclos repetidos sin reutilizar relojes de ausencia.
- Rechazo/vencimiento de la nueva oferta conserva el comportamiento previo del
  núcleo. Falta aprobar recuperación de la asignación anterior tras ese resultado;
  no se promete restaurarla automáticamente ni se evita aceptar al nuevo chofer.
- La llegada verificada se conserva al cambiar de vehículo en la misma ruta/origen;
  el administrador debe comprobar presencia actual antes del adelanto. Falta una
  política de retirada/caducidad/corrección de esa atestación, por lo que no es
  evidencia admisible para operación comercial sin procedimiento aprobado.
- El historial READY y declaraciones se vincula a reserva/viaje; no se reinicia
  artificialmente por reintento. Las llegadas falsas no verificadas vencen, pero
  no existe detección de fraude ni sanción automática.
- La referencia 0/5/8 autorizada en este encargo sustituye **en esta simulación de
  terminal** a la propuesta anterior 10+5. Los borradores de 013 siguen intactos e
  inactivos; no se mezclan sus relojes ni se migra historia como nueva evidencia.
- El aviso es un dato de simulación, no un SMS/push/correo. El backend local no
  añade una interfaz de pasajero ni recopila nombres para identificar personas.
- Antes de activar efectos: aprobar TTL, evidencia de preparación/llegada, aviso
  efectivo, excepciones/menores/accesibilidad, revalidación atómica al ejecutar,
  revisión, retención y recuperación de ofertas de traslado rechazadas/vencidas.
  La elegibilidad leída puede cambiar: no autoriza una cancelación posterior sin
  revalidación. Ninguna cancelación definitiva por ausencia está implementada.

## Seguridad y correcciones

Se detectó una condición SQL de tres valores en la cancelación previa: un WALK_IN
con passenger_id NULL podía superar NOT(...) para un usuario ajeno. 014 conserva
el núcleo interno con ejecución revocada e interpone autorización explícita con
coalesce(false), también tras esperar el lock. J07 prueba el caso presencial y
accesos de otra asociación. La misma precaución se aplica a los nuevos comandos.
Sesiones, roles y asociaciones se derivan del servidor; las FK impiden mezclar
asociaciones y los eventos son inmutables. Ningún cliente tiene DML de tablas.

Durante el desarrollo se corrigió una FK que necesitaba una clave única compuesta
aditiva en trips. Una fixture de actualización 013 duplicaba los integrantes que
creaba su trigger; se corrigió la copia preservando sus UUIDs en la base desechable.
Estas comprobaciones fallidas no se presentan como aprobadas.

## Pruebas

Comando reproducible: `npm run test:all`, clúster PostgreSQL 18.4 real efímero en
127.0.0.1, Node 24 local. Se conserva la batería previa y se añaden contratos
unitarios y J01–J11: confirmación/configuración, verificación offline, vencimiento
sin renovación, relojes 0/5/8 y recogida, A→C saltando B completo, B→A supervisado,
reintentos, dos grupos compitiendo, permisos/sesiones, carrera llegada/cancelación/
despacho, HTTP estricto y actualización poblada 001–013→014.

Resultado local ejecutado: **28/28 unitarias y 106/106 integraciones**, cero fallos,
omitidas o canceladas; runner conserva salida intencional 9 y detiene PostgreSQL;
smoke de identidad y negocio aprobados, ambos listeners detenidos. npm run test:all
finalizó con salida 0; git diff --check con salida 0. Se conservan las 122 pruebas
anteriores y se añaden 12. La CI Node 22/24 × Ubuntu/Windows se verificará sobre
este nuevo commit antes de entregar; no se atribuyen checks anteriores a 014.

## Archivos

014_terminal_operations.sql; src/db/business-service.mjs; src/domain/business.mjs;
src/http/business-api.mjs y local-transport.mjs; tests/business.test.mjs y
integration/postgres.test.mjs; AGENTS.md, README.md, contratos/decisiones y este informe.
001–013 permanecen intactas y G12 fija sus SHA-256. Sin dependencias nuevas,
proveedores, datos reales, GPS, pagos o comunicaciones. Etapa 2 sigue abierta a
revisión funcional y decisiones; no se inicia Etapa 3 ni se declara producción.
