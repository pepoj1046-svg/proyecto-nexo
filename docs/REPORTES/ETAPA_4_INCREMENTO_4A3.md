# Trufis Bolivia — Etapa4, Incremento4A.3

02/11/2026, America/La_Paz. Laboratorio local y datos exclusivamente ficticios.
Base comprobada3a49f432b544686995c1e03e21dfe02dce9f68fc; árbol inicialmente limpio,
remoto correcto y rama desarrollo/etapa-4 al mismo SHA de GitHub. PR#5 abierto en
borrador hacia planificacion/etapa-4a. No main, ramas anteriores, fusión o4A.4.

## Validez de la entrega

El SHA final, CI y CodeQL se ratifican en la descripción del [PR#5](https://github.com/pepoj1046-svg/proyecto-nexo/pull/5),
bajo «Verificación4A.3». Se actualiza después de CI, sin un commit documental
posterior que cambie el SHA verificado. Mientras allí se indique pendiente, no se
declara aprobada la validación de plataformas ni completado este incremento.
Los registros históricos4A.1/4A.2 y sus resultados no se sustituyen por esta entrega.

## Modelo de autoridad y primer acceso

[ADR previo al código privilegiado](../ADR_ADMINISTRACION_GENERAL_ETAPA_4.md) y
[contrato/procedimiento Windows](../ETAPA_4_ADMINISTRACION_ASOCIACIONES.md).

GENERAL_ADMIN es autoridad explícita en marcador singleton privado, ligada a la
misma identidad existente. No REVIEWER, membresía automática, primer registro,
atributo de navegador ni acceso omnipotente a datos operativos. Faculta solo
catálogo administrativo, alta LAB inerte, ADMIN específico de asociación e historia.
Delegación global y sustitución de propietario no están implementadas: recuperación
por pérdida total requiere política del comprador; no hay reinicialización o clave maestra.

Instalador local nexo_provisioner explícito con --confirm, secreto aleatorio único,
scrypt, transacción y archivo privado exclusivo. No stdout de contraseña ni
endpoint de bootstrap. COMMIT incierto conserva el único archivo de acceso;
un fallo inequívoco anterior al intento de commit lo retira y revierte. Proceso
transferible, sin cuenta personal del desarrollador ni proveedor. Solo laboratorio.
La atestación técnica LAB se registra offline para una identidad existente;
no prueba autorización jurídica ni reúne documentos personales.

## Funcionalidades completadas y reutilizadas

- Consola /plataforma diferenciada, con login existente y roles validados en SQL.
- Lista global paginada de asociaciones y estados técnicos/comerciales, adhesión y
  operación separados. Alta con nombre/código LAB, motivo y confirmación; escribe
  SUSPENDED/PENDING/SUSPENDED, sin rutas, vehículos, tarifas, viajes o ventas.
- Administradores de asociación y candidatos atestados. Primera concesión y
  delegaciones ADMIN completas, concretas, auditadas; revocación local sin bloquear
  identidad global ni derechos en otra asociación. No crear choferes/vehículos.
- Identidad activa y atestación vigente para nuevas concesiones. Cuenta restringida
  exige revisión; no se borran límites para ampliar facultades en otra asociación.
  La baja conserva vínculo histórico y funciona aunque la identidad ya esté bloqueada,
  su versión cambió o tenga restricciones. No se rehabilita al destinatario para revocarlo.
- Último ADMIN recuperable protegido en membresía, bloqueo de identidad y ámbito,
  incluidos los contratos offline. Membresía sin login gestionado no es respaldo.
  No backfill de cuentas ni cambios históricos; asociaciones antiguas sin acceso
  recuperable requieren regularización humana separada.
- Motivos, confirmación, revisión esperada, recibos, rollback, historia inmutable
  y paginada >50; reautorización después de espera con clock_timestamp.
- Experiencia escritorio/móvil, etiquetas, teclado nativo, cargas/vacíos/errores,
  separación de cuentas/asociaciones e intenciones. Respuesta perdida o refresco403
  tras commit conservan cuerpo y clave; rechazo definitivo exige nueva revisión.
- Se reutilizan registro/login/scrypt/sesiones, action_start/finish, provisión de
  roles, ámbitos, RLS/ACL y gateway de mismo origen. Sin owner/provisionador HTTP.

STATE_REVIEW registra una solicitud auditada; **no modifica** habilitación/adhesión/
operación, ni resuelve una autorización legal. Las revisiones técnicas de REVIEWER
anteriores conservan sus facultades propias. Activación comercial/legal, licencias,
suspensiones y recuperación/sustitución global siguen bloqueadas hasta política.
Esto distingue la infraestructura implementada de decisiones no aprobadas.

## Migraciones y archivos

001–036 intactas tras la primera publicación.036_platform_administration.sql
añade cuatro tablas privadas;037_platform_identity_intents.sql corrige la
revisión de identidad conservando OID, sin tablas nuevas o DML:
platform_bootstrap, platform_verifications, platform_associations y platform_events.
RLS activada sin SELECT/DML de runtime; eventos/marcador inmutables. Helpers
privados, search_path pg_catalog,nexo,pg_temp; solo tres RPC nuevas para nexo_app.
Dos funciones offline específicas adicionales para nexo_provisioner. Sin cambio
has_role, RLS operativa, inventario, custodias o configuración de rutas/precios.

| Archivos | Responsabilidad |
|---|---|
| database/migrations/036_platform_administration.sql,037_platform_identity_intents.sql | Autoridad, bootstrap, atestaciones, guardas offline, comandos/proyecciones e historial; revisión ligada también a identidad.036 publicada se conserva. |
| scripts/platform-access.mjs | Instalación/atestación local, archivo privado y preservación ante COMMIT incierto. |
| src/db/web-platform-admin-service.mjs | Validación cerrada, parámetros SQL, runtime nexo_app y transacciones con límites existentes. |
| src/http/web-gateway.mjs | Tres handlers fijos privados, página y códigos de error seguros. |
| apps/web/src/PlatformAdministration.tsx, main.tsx, private-api.ts | Consola, navegación, formularios/páginas, idempotencia existente y mensajes claros. |
| scripts/seed-web-demo.mjs, test-web.mjs | Fixture optativa de plataforma/atestaciones/historia real previa al listener, suites y cierre del laboratorio. |
| tests/platform-admin.test.mjs, integration/postgres.test.mjs | Contratos y seguridad/concurrencia/actualización; compatibilidad de expectativas nuevas. |
| tests/web/platform-*.spec.mjs, support/platform-evidence.mjs | Diez E2E en dos dispositivos y testigo SQL READ ONLY separado. |
| ADR, contrato, informe, AGENTS, README y planes | Alcance vigente4A.3, límites, reproducción y transferencia. |

## Pruebas y evidencias

Objetivo de batería estabilizada: **512 casos únicos**:69 unitarios +337 PostgreSQL
reales +106 E2E (53 escritorio/53 móvil). Conserva473 previos y añade39:3+26+10.
No se cuentan repeticiones, jobs o plataformas como casos nuevos. Los resultados
finales exactos se ratifican en el PR citado; no basta este objetivo para afirmar éxito.

Pruebas dirigidas ejecutadas:

- Unitarias nuevas3/3.
- PostgreSQL inicial17/18; tras corregir conexión del test de upgrade,1/1. Segunda
  batería nueva22/22; guardas de aislamiento offline1/1; grupo de compatibilidad/
  aislamiento/paginación5/5 después de actualizar expectativas. Los26 casos nuevos
  se verifican de nuevo en batería final, incluida corrección037.
- Escritorio inicial1/3: faltaba nivel h2 antes del primer h3 (axe) y el selector del
  test usaba «Siguiente» frente al nombre accesible real de PageControls. Corrección
  semántica de encabezado y selector exacto, sin cambiar tiempos/retries.
- Tras corrección, escritorio5/5 y móvil5/5, dos laboratorios por dispositivo,
  cierre/reinicio y eliminación de accesos anteriores. Axe sin violaciones en la
  consola y sin desbordamiento horizontal; testigo independiente verifica hechos.
- Primera batería integral69 unitarios aprobados y330/333 PostgreSQL; fallaron la
  allowlist exacta del provisionador y dos upgrades que comparaban conjuntos de
  tablas antes/después. Se añaden solo dos funciones offline autorizadas a la
  allowlist; upgrades exigen las cuatro tablas nuevas vacías **y** todos los hashes
  anteriores idénticos. No se ignoran tablas antiguas ni se debilitan permisos.
- Primera batería E2E completa:36 casos aprobados y14 laboratorios cerrados; el
  siguiente clúster no pudo ejecutar initdb: «No space left on device». El disco
  conservaba clústeres ficticios detenidos de ejecuciones anteriores. Se archivaron
  sus server.log privadamente y se eliminaron solo directorios postgres-* locales
  sin postmaster.pid. Sin tocar código, tiempos o aserciones se repite la batería
  completa desde el principio; el primer intento no se presenta como aprobado.
- Un chequeo TypeScript inicial encontró delete sobre campo obligatorio del body
  temporal; se tipó el comando correctamente antes de E2E. No error omitido.

Cobertura adicional: bootstrap legítimo/doble/concurrente, registro público sin
roles, matriz de actores, atestación/versión/estado, primer y último ADMIN, scopes
cruzados, dos administradores y revocaciones, recibos/ABA offline, respuesta perdida,
rollback por auditoría, sesión revocada/caducada tras lock, aislamiento fijo denegado,
historial y asociaciones >50, permisos mínimos/secretos, actualización poblada035,
reaplicación y preservación de tablas operativas.

La batería completa ejecuta test:all (incluye TypeScript/web, unitarias, PostgreSQL,
runner y smokes) y test:web (48 laboratorios:24 suites ×2 dispositivos, apagado
real/reinicio). No se aumentan timeouts, budgets, solicitudes ni reintentos.
Ubuntu/Windows ×Node22/24 y CodeQL corresponden al SHA final indicado en PR;
CodeQL JS/TS no certifica SQL ni permite afirmar cerrar alertas históricas.

[Manifiesto de evidencias](evidencias/etapa-4-4a3.json): seis capturas de delegación,
último ADMIN e historia, escritorio/móvil, conservadas localmente en
.local/4a3-delivery-evidence. Su publicación remota fue rechazada dos veces por
revisión automática por posible divulgación en repositorio público, pese a
inspección visual y comparación SHA256 con Playwright. No se eludió el bloqueo ni
se utilizó otro canal; requiere aprobación específica antes de reintentar publicar
esas imágenes. La entrega local y los hashes quedan disponibles para revisión. Logs, contraseñas, configuraciones y trazas quedan en .local,
excluidos de Git. Datos e identificadores son exclusivamente ficticios.

## Auditorías y problemas corregidos

Dos subagentes genéricos de solo lectura, con instrucciones manuales; sin perfiles
TOML automáticos ni ediciones/pruebas/red. Principal único editor/ejecutor.

Seguridad/autoridad: distinguió REVIEWER de plataforma; defaults de alta; atestación
inexistente; tres caminos de pérdida del último ADMIN; scope conservador de toda la
cuenta; esperas y recibos. Revisión del código detectó y motivó seis correcciones:

1. Archivo secreto eliminado si COMMIT confirmó pero respuesta se perdió: preservado.
2. Requisitos de alta impedían revocar identidad bloqueada/restringida: contratos separados.
3. ABA offline no modificaba revisión: ahora incluye identidad/membresía/ámbito auditados.
4. Membresía legacy no recuperable contada como respaldo: exige identidad gestionada activa.
5. Mutex con REPEATABLE READ retenía snapshot obsoleto y podía perder último ADMIN:
   READ COMMITTED obligatorio centralmente, incluidos todos los caminos offline.
6. Código LAB reasignado podía dirigir una intención antigua a otra identidad:
  037 liga revisión a atestaciones globales y su historia; impide rebind/ABA.

Regresiones4A3-19–26 comprueban esos puntos. Pruebas/funcionalidad auditó integración
mínima, fixtures, TRUNCATE/FKs, allowlists, scopes, testigos separados, controles de
historia, errores, respuesta incierta y compatibilidad. No certifican producción.

El fixture heredado incorpora dos cuentas ADMIN de respaldo explícitas y gestionadas
para que revocar/restringir el administrador observado no deje la asociación huérfana.
Los casos originales conservan sus denegaciones y comprobaciones operativas. No se
introducen respaldos en instalaciones existentes ni administradores ocultos del producto.

## Límites y próximo incremento

Solo laboratorio: no identidad oficial, producción, cuentas reales, teléfono, correo,
GPS, dinero, devoluciones, hosting o servicios pagados. No matriz repetida para
ocultar inestabilidad; cualquier fallo de CI se conserva y se describe en el PR.
La causa de fallos intermitentes de4A.2 no se presume resuelta por este incremento.

Pendiente del comprador: verificación real de identidad, sustitución/recuperación de
autoridad global, facultades globales delegables, políticas legales/comerciales de
habilitación/suspensión, retención, operación e instalación productiva. La consola
registra revisión segura y mantiene bloqueadas las partes que necesitan esas decisiones.
No se declara cerrada Etapa4 ni software listo para producción.

4A.4 solo como próximo alcance propuesto: registro inicial de choferes/vehículos con
contratos aprobados; no está implementado ni autorizado por esta entrega. La venta
integral de diez etapas requiere aceptación y derechos transferibles acordados;
no se sustituye por la aprobación técnica de un laboratorio.

## Corrección posterior a primera publicación:037

El primer commit5f7cdcf aprobó510 casos localmente. Los cuatro jobs de push y
los otros tres del PR aprobaron510; Windows24 PR falló tras85 E2E/35 cierres:
/api/recovery/detail net::ERR_NO_BUFFER_SPACE en rescate heredado móvil, sin
respuesta HTTP. Causa del sistema no establecida. Se solicitó una única repetición
diagnóstica sin cambios; su resultado histórico se conserva en el PR. No se
presenta aquella CI como aprobación de la corrección037.

Antes del cierre se reprodujo un defecto alto distinto: el operador offline podía
renombrar un código LAB y asignarlo a otra identidad; DELEGATE/REVOKE con revisión
anterior resolvía el nuevo dueño sin detectar intención obsoleta.4A3-25 falló
realmente en5f7cdcf con «Missing expected rejection». El auditor confirmó el
problema y la solución mínima. Se conservó036 y se añadió037: mismo OID/cuerpo de
revisión, más snapshot global de atestaciones e historial inmutable ordenado.

El mutex ya existente impide rebind entre revisión y consumo. Toda nueva
atestación invalida conservadoramente las intenciones anteriores, incluso de
otras asociaciones; se requiere consultar y confirmar de nuevo. No se restringe
la corrección legítima de atestaciones ni se modifica historia o recibos previos.

Tras el arreglo, las ocho pruebas dirigidas pasaron:25 incluye delegación,
revocación y ABA;26 instala036, puebla identidad/asociación/atestación/recibo,
aplica037 y prueba datos/checksums/OID intactos, intención vieja rechazada y replay
autorizado sin duplicación. También pasaron H08/S08 y upgrades anteriores.
El auditor revisó037 implementada y no identificó otras ventanas concretas.
Se repiten backend y E2E completos, y CI/CodeQL en el nuevo commit final del PR.

Las seis capturas locales proceden de5f7cdcf; la UI, handlers y formatos RPC
permanecen idénticos en037. Cambia únicamente la guarda SQL de revisión; los
estados de las capturas se vuelven a validar con los E2E finales. No se declara
que las imágenes prueben por sí solas la regresión de identidad: la cubren25/26.

La batería final de backend de la corrección terminó exit0 con69/69 unitarios y
337/337 PostgreSQL, cero fallos/omisiones; TypeScript/web, runner y smokes
aprobados. Diez E2E dirigidos de plataforma aprobaron en escritorio/móvil, cuatro
laboratorios cerrados y reinicio. El E2E completo y CI del SHA corregido se
ratifican en el PR. El objetivo512 no se interpreta como resultado de una
batería pendiente. No hubo cambios de aserciones/timeouts/retries para ocultar fallos.
