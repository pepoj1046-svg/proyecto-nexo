# Etapa 4A.2 — permisos DRIVER existentes y contacto ficticio

Autorización del propietario: solo 4A.2, desde `dacb017`, en
`desarrollo/etapa-4`, PR #5 hacia `planificacion/etapa-4a`. Laboratorio local,
datos ficticios, sin gastos ni producción. 4A.3 requiere otra autorización.

## Autoridad y frontera

Se administra una membresía DRIVER **ya existente**, sin seleccionar un viaje.
La asociación y el usuario enviados son objetivos, nunca credenciales. Se exige
ASSOCIATION_ADMIN activo de esa asociación y `scope_allows(NULL)`. La semántica
conservadora de ámbitos de 020/034 permanece: otra membresía no elimina una
restricción de la cuenta. Pasajero, DRIVER y REVIEWER sin ADMIN no acceden.

No alta inicial, identidad global, rol GENERAL_ADMIN, vehículo, fila, tarifa o
ruta nuevos. No se conectan pools de identidad o provisión a estos servicios.
La primitiva nativa `set_driver_membership` conserva su UPSERT legado de 009
para compatibilidad de administración confiable; **el nuevo RPC web comprueba
existencia bajo bloqueo y nunca lo usa para dar de alta**. No se añade un endpoint
de provisión. Evaluar por separado ese contrato legado antes de comercializar.

## Operaciones privadas

Gateway existente, cookie y CSRF/Origin; cuerpos cerrados, UUID, booleanos reales,
motivo ficticio de 1–200 caracteres y confirmación explícita. Mutaciones con
Idempotency-Key obligatoria. Runtime `nexo_app`, SQL fijo y parámetros; no DML libre.

| POST | Cuerpo | Resultado |
|---|---|---|
| /api/driver-admin/context | associationId, userRef opcional | Membresía mínima, estado, revisión, impedimento; contacto LAB. Solo asociación sin userRef permite formulario de contacto. |
| /api/driver-admin/command | associationId, userRef, enabled, revision, reason, confirmed | Cambia únicamente DRIVER existente o registra resultado REVIEW_REQUIRED sin cambiarlo. |
| /api/driver-admin/contact | associationId, contactCode, confirmed | Reutiliza set_association_contact; exclusivamente LAB-[A-Z0-9_-]{1,40}. |
| /api/driver-admin/history | associationId, userRef opcional, limit, cursor | Historia autorizada, sin credenciales ni eventos de autenticación. |

Contexto/historia usan READ COMMITTED READ ONLY. Mutaciones usan transacción
READ COMMITTED. Se conservan lock_timeout10s, statement_timeout15s y los límites
del gateway: no se aumentan por la interfaz o las pruebas.

## Retirada y restauración seguras

No se retira ni restaura cuando el conductor conserva un viaje QUEUED o IN_TRANSIT,
personas observadas/físicas a bordo o reservas vivas en un viaje WITHDRAWN.
Un viaje COMPLETED histórico sin custodia no reactiva una fila; sus reservas,
precios, versiones y hechos no se reescriben. Una identidad técnica deshabilitada
no puede habilitarse mediante restaurar DRIVER.

**Límite conservador deliberado:** las sustituciones históricas no siempre
conservan el conductor original después de cambiar trips.driver_id. Mientras
exista una incidencia abierta, rescate no transferido o recepción sin confirmar
en la asociación, se bloquean cambios de DRIVER de esa asociación, incluso de
otro chofer. Evita afirmar que una persona quedó liberada de custodia cuando
la evidencia no lo demuestra. No se inventa una resolución ni se reconstruye
historia. Afinar esa relación y autorizar una retirada durante servicio requiere
otro contrato aprobado; no es una regla comercial de sanción o ausencia.

El nuevo RPC registra actor, sujeto, asociación, motivo y resultado del bloqueo,
devuelve applied=false/reviewRequired=true y un recibo; no lanza un error que
revierte ese registro. Errores técnicos revierten cambio, eventos y recibo juntos.
Las entradas nativa/CARE también rechazan cambios inseguros: no queda un atajo
para revocar desde el panel antiguo. No cancelación, rescate o desembarque ficticio.

Restaurar no rehabilita vehículo ni devuelve turno, otro rol o sesión revocada.
Revocar DRIVER no deshabilita la identidad global ni derechos de otra asociación
o de pasajero: cada operación comprueba el rol efectivo. Una sesión que no fue
revocada sigue siendo sesión, pero no concede funciones de conductor inactivo.

## Bloqueos, intención y auditoría

Ámbito compartido → recibo del actor/clave → rutas de asociación ordenadas por UUID
→ identidad del actor → sesión vigente con clock_timestamp → ADMIN → DRIVER.
No se retiene sesión/membresía mientras se espera una ruta. El contacto añade el
bloqueo de asociación después de rutas y antes de estabilizar la autoridad.
CARE ya no toma una ruta individual antes de solicitar todas las rutas.

La serialización por rutas es deliberadamente gruesa para el laboratorio. No
certifica una carga nacional ni un catálogo modificado en paralelo por setup
propietario. La autoridad se revalida después de esperar, incluso para un recibo.
La caducidad real no se deduce solo del statement_timestamp de actor().

La revisión esperada incluye estado y eventos nativos DRIVER_ENABLED/DISABLED.
Otra actuación, incluso revocar→restaurar, invalida la intención anterior.
Dos administradores no consumen dos veces la misma revisión. Un recibo autorizado
se devuelve antes de exigir coincidencia de revisión actual: reintentar un commit
no debe repetirlo. Un nuevo acto confirmado exige nueva clave y revisión.

La web reutiliza useCommands. Conserva cuerpo/clave frente a red incierta y
también si el POST respondió pero falla la lectura posterior. Solo 4A.2 activa
el retiro de una intención con POST rechazado definitivamente por HTTP4xx.
En ese caso borra contexto y exige consultar y confirmar nuevamente. Un error
4xx del refresco **no** significa que se rechazó el POST. No hay reintentos
automáticos ni almacenamiento duradero de credenciales o intenciones.

## Historia y paginación

Eventos mínimos de DRIVER_ENABLED, DRIVER_DISABLED, DRIVER_ACCESS_REVIEW_REQUIRED
y CONTACT_UPDATED. Actor/sujeto técnicos, motivo y fecha; se omiten performed_by,
sesiones, hashes, claves y demás eventos de identidad. Los contactos anteriores
de audit_events se muestran sin inventar un motivo y se deduplican frente al
evento de identidad añadido para las actuaciones nuevas.

Páginas 1–100 (50 por defecto), orden técnico estable por UUID, fecha en cada fila;
no se presenta como orden cronológico. Revisión/total/filas derivan de una sola
proyección materializada. Cursor cerrado v/scope/permissions/revision/size/key,
ligado a actor, sesión, asociación, sujeto, tamaño, ámbito y conjunto. Mismas
fronteras de 034: es cursor, no credencial ni firma; otra cola válida navega solo
dentro de los datos ya autorizados. Cambios invalidan páginas sin mezclarlas.

No se reescriben ni borran históricos. Retención, exportación, verificación legal,
custodia durante baja y recuperación de identidad siguen pendientes de decisiones
aprobadas; no se fijan edades, documentos, plazos, sanciones o cargos.

## Migración y compatibilidad

035 añade funciones y endurece las entradas existentes; no tablas paralelas,
DML de migración ni backfill. 001–034 son inmutables. Helpers privados, PUBLIC
revocado y search_path fijo. Solo tres RPC nuevos tienen EXECUTE para nexo_app;
el contacto conserva su contrato previo. No permisos de provisión nuevos.

Se conservan capacidad de seis por segmento, tarifas pactadas, grupos, fila,
asignación directa terminal/expreso, aceptación de recogidas, custodia real,
reservas y búsqueda solo origen/destino. Las pruebas antiguas de retirada de acceso
ahora usan un servicio histórico sin custodia; los casos activos deben rechazarse.
Ese cambio corrige una expectativa insegura, sin borrar los casos anteriores.

[Informe, ejecución y evidencias](REPORTES/ETAPA_4_INCREMENTO_4A2.md).
