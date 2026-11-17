# Etapa 4A.4 — altas de choferes, vehículos y asignaciones base

Base aprobada: `b16844b9d4319001ba3d70e238f434b8c920874f`. Repositorio `pepoj1046-svg/proyecto-nexo`, rama `desarrollo/etapa-4`, [PR #5](https://github.com/pepoj1046-svg/proyecto-nexo/pull/5) abierto en borrador hacia `planificacion/etapa-4a`. Solo laboratorio con datos ficticios. No es habilitación profesional, certificación SQL ni preparación para producción.

El SHA definitivo y las URLs/resultados CI se ratifican en el cuerpo del mismo PR después de publicarlo y leer las ejecuciones. Un archivo no puede contener el hash del commit que lo contiene; la ratificación externa evita un commit documental posterior sin las mismas validaciones. El manifiesto de evidencias liga fuentes y migraciones por SHA256.

## Funciones implementadas y reutilización

- Solicitud de DRIVER sobre identidad técnica existente y atestada offline. Revisión PENDING→APPROVED/REJECTED; motivo, actor, tiempo e historial inmutable. Aprobación crea la membresía nativa mediante `set_driver_membership`; directorio y gestión de permisos 4A.2 conservados.
- No se crea una identidad por HTTP. Un código de reserva/usuario o el registro público no otorgan DRIVER. Una membresía ya existente, incluso inactiva, se gestiona en 4A.2, evitando reactivaciones por esta vía.
- Solicitud de vehículo con código LAB normalizado, tipo técnico VAGONETA_6, seis plazas exactas. La aprobación inserta solamente en `vehicles`; no crea viajes, filas, plazas vendibles o permisos de ruta. Pendiente/rechazado no participa en inventario.
- Códigos de vehículo reservados globalmente, incluso tras rechazo, y comparación opaca con etiquetas legacy normalizadas. Solicitud DRIVER fija UUID y revisión de la atestación; rebind o ABA no redirigen la identidad.
- Asignación base, cambio y retiro como metadatos administrativos con FK compuestas; un vehículo y un chofer por vínculo. Nunca modifica `trips.driver_id`, reservas, grupos, tarifas, movimientos ni custodia.
- Bloqueos por fila, servicio, reservas vivas incluso sin fila, pasajeros físicos, incidencias, rescate, recepción y recogidas. Revisa recursos entrantes y salientes; actividad del chofer en otra asociación produce un impedimento opaco. Chofer revocado/restringido no se reactiva ni se sustituye silenciosamente.
- Impedimento operativo autorizado conserva actor/motivo/resultado mediante recibo `applied=false, reviewRequired=true`, evento e historial; no modifica recursos. Una revisión no desbloquea el servicio. Denegaciones de permisos/validación/revisión obsoleta revierten sin crear un acto autorizado ficticio.
- Tres RPC HTTP específicas dentro del gateway y del directorio existentes: contexto, página y comando. Listas DRIVER/VEHICLE/asignaciones/historial con cursor real >50, ligado a sesión, asociación, apartado, tamaño, permisos y contenido.
- React adaptable: cargas, vacío, errores comprensibles, motivo, confirmación, teclado nativo, axe, protección doble clic y presentación del resultado bloqueado. Respuesta perdida o POST confirmado+refresco fallido conserva cuerpo/clave; el directorio no desmonta la intención pendiente.

GENERAL_ADMIN sigue limitado a 4A.3. Se exige ADMIN activo con alcance completo de la asociación. No se amplía REVIEWER ni se permite aprobación por DRIVER/PASSENGER. Solicitar y revisar por el mismo administrador está permitido técnicamente: no existe política aprobada de doble firma.

## Migración y archivos

001–037 conservadas byte por byte y verificadas por hashes. Nueva `038_fleet_administration.sql`:

- `fleet_requests`: proceso administrativo, no inventario adicional.
- `fleet_base_assignments`: relación base, separada de los viajes reales.
- `fleet_admin_events`: historia inmutable.
- RLS sin DML/SELECT directo del runtime; RPC SECURITY DEFINER con `search_path=pg_catalog,nexo,pg_temp`, helpers privados y grants mínimos explícitos. Sin conexión owner/provisioner en HTTP.

Archivos: `AGENTS.md` (autorización 4A.4), nueva migración038, `src/db/web-fleet-admin-service.mjs`, gateway, `FleetAdministration.tsx`, integración `Directory.tsx`, mensajes privados, fixtures/runner E2E, unitarias e integración PostgreSQL, tres suites E2E y sus dos helpers. Contrato y Windows en [ETAPA_4_CHOFERES_Y_VEHICULOS](../ETAPA_4_CHOFERES_Y_VEHICULOS.md).

Los contratos anteriores se reutilizan: identidades y atestación036/037, autoridad/ámbitos034/035, membresía nativa, inventario y capacidad, custodia017/019/030, auditoría/idempotencia y hook `useCommands`. Ninguna función operativa anterior se reconstruyó o sustituyó.

## Hallazgos de los dos auditores

Dos subagentes genéricos, instrucciones manuales, solo lectura. No editaron ni ejecutaron pruebas; el principal fue único editor/ejecutor/publicador. No se afirma carga automática de perfiles TOML.

Seguridad identificó:

1. Posible ciclo con acción/mutex/ámbito y contratos035/036. La nueva operación adquiere el mutex sin esperar y rutas UUID con NOWAIT: conflicto503, rollback y misma intención conservada. No cambia el núcleo ni aumenta timeouts. Los locks restantes revalidan permisos, caducidad y revisión tras la espera.
2. Identidad LAB mutable/ABA y recuperación concurrente: vinculación al UUID/atestación histórica y locks de identidad antes del consumo. Cambios de versión durante espera invalidan la intención de asignación.
3. Actividad global de chofer multi asociación y custodia ambigua: guardas globales opacas y bloqueos conservadores.
4. Fingerprint que incluía login/logout ordinarios y bloqueo perpetuo de WITHDRAWN resuelto: corregidos sin permitir actividad, reservas o custodia pendientes.
5. Desmontaje de intención incierta: bloqueo del padre mientras haya intento pendiente; reintento interno permanece disponible.

Funcionalidad/pruebas identificó:

1. Faltaba registrar resultado/motivo de una asignación bloqueada. Ahora hay recibo e historia explícita, incluidos sus textos web.
2. Dos llamadas del mismo actor no prueban dos administradores: regresión con segundo administrador gestionado y sesión independiente.
3. Un título de prueba no demostraba IN_TRANSIT/BOARD/recogida: se añadieron operaciones y aserciones reales, también HELD residual, original/receptor de custodia y rescate.

Última revisión estática no identificó defectos críticos/altos restantes dentro del alcance acotado. Esto no equivale a una auditoría final integral de Etapa4.

## Pruebas y resultados

Se ejecutaron primero validadores, PostgreSQL real y suites nuevas por separado. Las repeticiones no se cuentan como casos nuevos. El resultado integral final y CI deben distinguirse de los pases dirigidos.

Cobertura nueva:

| Área | Prueba |
|---|---|
| Normalización, campos cerrados, roles inyectados, seis plazas, clave | 3 unitarias `fleet-admin` |
| Alta DRIVER/directorio/4A.2, inexistente/bloqueado/restringido/duplicado/rechazo | PG4A4-01/02 |
| Vehículo sin viaje, códigos reservados, asociaciones | PG03 |
| Roles, ámbito limitado, sesiones revocadas | PG04/12/19/24 |
| Asignar/cambiar/retirar, saliente revocado, revisión visible | PG05/25; E2E asignación/revisión |
| Cola, reservas confirmadas y HELD, tránsito4+recogidas2 | PG06/20/21 |
| Custodia original/receptor/libre, avería y rescate | PG07/22 |
| Concurrencia de dos ADMIN, duplicados, mismos recibos | PG08/23 |
| Rebind/ABA y login ordinario | PG09/11/18 |
| Fallo de auditoría con rollback completo | PG10 |
| Mutex/rutas ocupados sin deadlock, versión tras espera | PG13/26 |
| Chofer en asociaciónB y vínculo global exclusivo | PG14 |
| >50 solicitudes DRIVER, VEHICLE, asignaciones e historial | PG15; E2E páginas |
| SQL directo, grants/RLS/helpers y capacidad incompatible | PG16 |
| Base037 poblada→038, checksums/datos/recibos, reaplicación vacía | PG17; regresiones históricas de migración |
| CSRF/Origin y recibo revocado en HTTP real | PG19; E2E sesiones independientes |
| Respuesta perdida, refresco403, claves/cuerpos idénticos, doble clic | E2E `fleet-admin-races` escritorio/móvil |
| Teclado Enter, axe, ancho móvil, panel sin viaje seleccionado | E2E `fleet-administration` |

**555 casos únicos aprobados localmente** =72 unitarios +363 PostgreSQL +120 E2E (60/dispositivo); conserva512 y añade43 (3+26+14). No se suman plataformas o repeticiones. E2E completo exit0 en `.local/4a4-web-full-final.log`:120/120,60 escritorio/60 móvil,54 laboratorios cerrados, SIGINT real, reinicio y eliminación de accesos anteriores verificados. La UI y el núcleo operativo se conservaron durante la batería; el endurecimiento final de tipo/capacidad nulos fue validado con PG16/17 y no cambia esos recorridos válidos. La matriz CI del SHA publicado constituye la repetición integral sobre todas las fuentes finales. **Backend local final exit0**, `.local/4a4-all-sealed-final.log`:72/72 unitarios y363/363 PostgreSQL, cero fallos/omisiones; compilación TypeScript/web, runner (propaga exit9 y detiene PostgreSQL) y smokes de ambos listeners aprobados. Incluye los últimos controles de tipo/propiedad propia de `kind` y CHECK contra capacidad/tipo nulos.170 fuentes verificadas por hash después de terminar. Lotes anteriores y pruebas dirigidas no se suman al conteo; CI del SHA final repetirá la batería completa.

## Fallos intermedios y correcciones de pruebas

- Dos fixtures dirigidos incorrectos: `configure_admin_scope` sobre no administrador y llamada de reserva con firma equivocada; se preparó el rol de fixture correcto y se reutilizaron `hold/acceptAll`. Después se corrigió un intento de usar `provision_role` para DRIVER: el contrato nativo es `set_driver_membership`.
- E2E llegó al límite real120 solicitudes/minuto al agrupar demasiados recorridos en un solo laboratorio. Se distribuyeron las mismas aserciones entre las suites de altas, reintentos y permisos/revisión, cada una con laboratorio aislado. No se aumentó el límite ni se esperó artificialmente para aparentar un pase.
- Aserción de claves contaba una llamada `APIRequestContext` como evento de página. Se corrigió para comprobar las dos solicitudes reales de React, claves diferentes y solicitud PENDING persistida. Las pruebas de respuesta perdida comparan cuerpo y clave completos.
- Integridad del esquema: CHECK de solicitud VEHICLE podía aceptar NULL por la lógica ternaria SQL, aunque la RPC ya lo rechazaba. Se exigen tipo/capacidad no nulos; PG16 comprueba inserts inválidos y PG17 repite la actualización poblada. No se cambia capacidad operativa ni migraciones anteriores.
- Revisión final del validador: claves heredadas (`constructor`, `toString`, `__proto__`) podían producir503 antes de llegar a PostgreSQL. Se exige tipo string y propiedad propia; ahora se rechazan con400. Regresión unitaria explícita y HTTP real para nombres heredados/null/array/objeto, sin acceso o cambios de datos.
- La primera batería integral encontró el conteo heredado37 en la prueba de reaplicación; la instalación contenía correctamente38. Se actualizó a38 conservando comparación completa de tablas y registro. La prueba dirigida aprobó; la repetición integral final también aprobó72/363 y las verificaciones del runner/listeners.

## Evidencias y límites

Capturas exclusivamente ficticias en `.local/4a4-evidence`, sin tokens, contraseñas o URLs PostgreSQL. El manifiesto público contiene hashes verificables; no se publican trazas, credenciales ni logs privados. **Publicación PNG bloqueada realmente**: un único intento de crear el blob exacto `mobile-historial.png` fue rechazado por revisión automática por riesgo de divulgar captura local en GitHub y falta de autorización específica según esa revisión. No se reintentó por otra vía. Se conservan seis PNG byte por byte en `.local/4a4-delivery-evidence` y ZIP `.local/4a4-evidencias.zip`; hashes en [manifiesto público](evidencias/etapa-4-4a4.json). Ninguna imagen, ZIP, traza o credencial privada forma parte del commit.

El laboratorio conserva seis plazas simultáneas por segmento, orden de filas, reservas, tarifas/versiones, grupos y custodia. Se comparan fingerprints operativos antes/después de las altas/asignaciones y revisiones. Alta aprobada no implica operación legal ni disponibilidad para una ruta. Adquisición global conservadora limita concurrencia administrativa y puede devolver503; requiere reintento explícito con la misma clave, sin retry automático.

Pendientes del comprador: verificación profesional/legal y tipo de datos estrictamente necesarios; documentos/licencias/inspección/seguros si corresponden; retención; doble firma; repetición/reutilización tras rechazo; futura planificación sobre asignaciones base. No se inventaron reglas o plazos. Las restricciones operativas necesitan resolverse por los procedimientos existentes, no mediante una aprobación de este panel.

Recomendación: aceptar técnicamente 4A.4 en laboratorio con las decisiones y restricción de publicación de imágenes indicadas, sujeto a la ratificación final de CI/CodeQL del SHA publicado en el cuerpo del PR5. Ese registro contiene el commit definitivo, enlaces de cada job Ubuntu/Windows × Node22/24 y conclusiones CodeQL; no se declara CI por una ejecución local. No cerrar toda la Etapa4. El siguiente incremento4A.5 requiere autorización separada y trataría rutas/tarifas ya planificadas; no fue iniciado. Sin fusión, producción, datos reales, comunicaciones, GPS, pagos, servicios contratados o gastos nuevos.


## Ratificación de CI y commit

Registro externo canónico: [PR5](https://github.com/pepoj1046-svg/proyecto-nexo/pull/5). Allí se consignan el SHA de este árbol, eventos push/PR, ocho jobs completos, comprobaciones CodeQL y posibles fallos intermedios, solo después de leer las ejecuciones reales. No se publica otro commit documental para cambiar el SHA ya validado. CodeQL analiza JS/TS; no certifica SQL ni sustituye PostgreSQL real. El manifiesto conserva hashes de fuentes, blobs y001–037, además de las seis capturas locales.

Se inspeccionó disco durante las baterías (más de14GB libres al final). No se necesitó borrar clústeres, bases activas o evidencias. Los54 launchers cerraron sus propios listeners y PostgreSQL; los archivos de accesos de reinicio fueron eliminados.
