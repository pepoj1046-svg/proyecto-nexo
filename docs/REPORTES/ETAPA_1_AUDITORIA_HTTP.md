# Etapa 1 — Auditoría, HTTP local y mantenimiento

26/10/2026, America/La_Paz. Exclusivamente `pepoj1046-svg/proyecto-nexo`, rama
`desarrollo/etapa-1`, base `33d991defde44e10e1e9936edfaa227ed7a1802b`, PR #1 abierto.
Antes de editar se verificaron remoto, rama, árbol limpio, SHA remoto y documentos
requeridos. Se leyó la revisión técnica más reciente del PR, comentario
[6421336689](https://github.com/pepoj1046-svg/proyecto-nexo/pull/1#issuecomment-6421336689).
El nuevo encargo directo autoriza HTTP únicamente local, conservando las demás restricciones.

## 1. Cambios implementados

| Archivos | Cambio |
|---|---|
| database/migrations/010_security_and_abuse.sql | Límites separados y acotados, eventos de seguridad, caducidad tras lock, logout sin doble evento y search_path explícito con pg_temp al final |
| database/migrations/011_identity_maintenance.sql | Rol de mantenimiento mínimo, índices, simulación y limpieza por lotes con cutoff obligatorio/SKIP LOCKED |
| src/db/runtime.mjs, service.mjs, maintenance.mjs | Validación de autoridad efectiva y pools, tokens acotados y adaptador de mantenimiento local |
| src/auth/identity.mjs, passwords.mjs, work-limit.mjs | Presupuestos por propósito/código, fallos auditados, SQL con timeout, Unicode válido y scrypt sin cola ilimitada |
| src/http/local-api.mjs, test-runtime.mjs | Transporte de pruebas loopback con validación, autorización, límites y errores sanitizados |
| scripts/local-demo.mjs, test-postgres.mjs, verify-local-api.mjs, package.json | API ejecutable con base nueva/roles aleatorios, cierre controlado y smoke test Ubuntu/Windows |
| tests/http.test.mjs, identity.test.mjs, helpers/http.mjs, integration/postgres.test.mjs | Regresiones de seguridad/HTTP, mantenimiento, actualización y sonda sintética de búsqueda |
| README y docs de arquitectura, modelo, contrato, seguridad, pruebas y resultados | Uso reproducible, amenazas, evidencia y evaluación de cierre |

Migraciones **001–009 intactas**. No se reescriben algoritmos de reservas, tarifas,
divisiones, filas, capacidad de seis plazas ni progreso/despacho. No se añade selector
de categoría al pasajero. No se crean APIs de administración ni recursos remotos.

## 2. Hallazgos y correcciones

| Hallazgo | Riesgo y corrección | Evidencia |
|---|---|---|
| Global agotado seguía insertando buckets individuales | Crecimiento de estado pese a rechazar intentos; retorno temprano y evento de umbral único | H10 demuestra el defecto en 009; S01 verifica la corrección |
| Registro compartía cupo de login; recuperación tenía un cupo común | Bloqueo cruzado evitable; separar propósitos, globales y hashes de códigos | S02, H02/H04/H09 y W02 |
| Guardas solo comprobaban parte de los privilegios | Configuración combinada/elevada o propiedad de objetos podía aceptarse; inspección de membresías/propiedad/CREATE/SET ROLE | S03 y listas exactas S08 |
| Identidad sin timeout SQL por llamada | Esperas que consumían conexiones indefinidamente; transacciones independientes con lock/statement timeout | Código auditado y carreras de emisión/recuperación, sin revertir intentos fallidos |
| Caducidad calculada antes del lock de cuenta | Vida útil consumida durante esperas; calcular después de adquirir lock y revalidar versión | S09 |
| Dos logout simultáneos podían auditar dos revocaciones | Escritura/evento solo si revoked_at era NULL | S07, H03 y HTTP |
| pg_temp implícito y falta de fallo-auth para sujetos desconocidos | Endurecer resolución y dejar trazas mínimas sin secretos; pg_temp explícito al final y security_events privado/inmutable | S06/S08 y H08 |
| Derivaciones de contraseña podían acumular trabajo sin límite propio | Máximo seis tareas de scrypt sin cola, más máximo cuatro operaciones HTTP | Unitario de trabajo y de concurrencia HTTP |
| Sustitución UTF-8 de surrogates inválidos | Rechazar contraseñas Unicode mal formadas y bytes UTF-8 inválidos antes de hashear | Unitarios de identidad/HTTP |

No se encontró una vía de autoasignación de administrador/revisor desde los
contratos públicos. No se concede SQL, DML ni provisión al transporte. Se probaron
RLS A/B, suplantación de contexto, shadowing temporal, ACL de funciones y acceso
denegado a credenciales/auditorías privadas. Las funciones SQL se revisaron junto
con sus grants, search_path y controles de actor, no solo su declaración DEFINER.

La autoridad de `nexo_identity` para emitir sesiones sigue siendo **confiable por
diseño**, no eliminada por RLS: comprometer esa conexión o el proceso verificador
permite suplantar cuentas gestionadas. Se reducen exposición y errores de configuración;
no se afirma contener al propietario, al SO o al aprovisionador. Una sentencia ya
autorizada puede finalizar tras revocar su sesión; las posteriores quedan bloqueadas.

## 3. Pruebas ejecutadas realmente

Linux x64, Node **24.19.0**, npm **11.9.0**, PostgreSQL **18.4 real** del lockfile.
Todos los datos son ficticios y el clúster se crea en loopback y se detiene al finalizar.

```text
npm run test:all
  npm test:                 23/23 aprobadas
  test:integration:         66/66 aprobadas
  test:runner:              fallo 9 del hijo conservado; PostgreSQL detenido
  test:local-api:           registro/login/logout aprobados; HTTP y PostgreSQL detenidos
  fail/skipped/cancelled:   0
exit: 0
git diff --check
exit: 0
```

- Se mantienen los 54 casos anteriores, ampliados donde corresponde; 12 integraciones
  nuevas: S01–S09, W01–W02 y P01. Se agregan cinco unitarias HTTP y una de trabajo limitado.
- H10 actualiza una base poblada **001–009 → 010–011**: sesiones gestionadas y
  antiguas, roles, catálogos, permisos y reservas confirmadas se preservan fila a fila;
  dos plazas anteriores más cuatro nuevas siguen siendo seis y la séptima se rechaza.
- G12 comprueba SHA-256 de 001–009. G13 conserva actualización desde 001–004.
- Continúan aprobadas las carreras de 24 conexiones por la última plaza, grupos
  atómicos, tarifas, filas/salida y suspensión/revocación de asociación/catálogo.
- S04/S05 prueban limpieza concurrente con lote, dry-run, filas bloqueadas y preservación
  de sesiones válidas, ventanas activas, reservas y auditorías.
- Los tests HTTP usan sockets reales y los W01/W02 conectan adaptadores con PostgreSQL
  y roles sin superusuario. El smoke ejecuta el comando completo y el cierre por IPC,
  ignorando DATABASE_URL/HOST/PORT deliberadamente inválidos para el servicio local.
- P01 genera **20.000 localidades ficticias**, confirma el índice de prefijo con
  EXPLAIN ANALYZE BUFFERS y realiza 12 búsquedas concurrentes consistentes. La consulta
  SQL selectiva registró **0,108 ms** en esta ejecución local; no es latencia HTTP,
  un SLA ni una prueba de carga nacional real. La consulta amplia conserva el límite.

Fallos de desarrollo: las primeras pruebas HTTP encontraron un 415 donde correspondía
413 y una segunda respuesta ante error de parser tras Connection: close. Se separó
el límite de cuerpo del formato y se evitó responder dos veces al mismo socket.
La ejecución completa posterior aprobó todos los casos. No se declaran como exitosas
pruebas pendientes ni se confunde el fallo intencional del runner con un fallo de suite.

### CI remota

El workflow Node 22 ejecuta la suite completa y el smoke del launcher. Para el
commit de implementación **`f1c4d84`**, [CI del PR verificada](https://github.com/pepoj1046-svg/proyecto-nexo/actions/runs/40364176149):
**Ubuntu y Windows aprobados**. Se inspeccionaron jobs y logs: cada plataforma
registró **23/23 unitarias, 66/66 integraciones PostgreSQL 18.4**, probe del ejecutor
y arranque/cierre del launcher HTTP/PostgreSQL, todos aprobados. Los commits solo
documentales posteriores tienen sus propios checks en el PR; esta evidencia
corresponde al commit de implementación. No se han probado otras versiones
PostgreSQL ni se ha ejecutado sobre producción.

## 4. Compatibilidad y fronteras

No se modifica main ni se fusiona el PR. No se borran datos previos durante la
migración. El mantenimiento es explícito y no alcanza usuarios, inventario, precios,
permisos, idempotencia o auditoría. La recuperación sigue siendo de consumo único
y una baja/reactivación no restaura tokens antiguos. Se conserva historial de
reservas y terminación de viajes iniciados tras revocar permisos.

API y launcher son de laboratorio: no interfaz de pasajero, panel, provisión por HTTP
ni despliegue público. No se cargan personas reales, datos GPS/pagos, catálogos
oficiales inventados ni credenciales externas. No se añaden dependencias ni servicios
de pago. La autorización comercial/legal no se sustituye por fixtures VERIFIED.

## 5. Decisiones del propietario y pendientes reservados

1. Aceptación/revisión formal del cierre y revisión independiente del incremento.
2. Proveedor/piloto y su arquitectura de despliegue, TLS, MFA, canal de recuperación,
   altas documentales, acceso operativo y protección de perímetro antes de exponer Internet.
3. Retención/borrado y acceso a sesiones, intentos, recuperación, auditorías,
   idempotencia y backups. No se fija un plazo comercial/legal ni un cron de borrado.
4. Fuente autorizada de geografía/permisos y cotejo con autoridades antes del piloto;
   medición con catálogo representativo, concurrencia sostenida y entorno objetivo.
5. Reglas operativas de menores, abordaje/ausencias, plazo de oferta/manifiesto,
   servicios completamente intramunicipales y reservas futuras tras revocación.
   Pagos/licencias/GPS y sus contratos/autorizaciones siguen fuera de este incremento.

## 6. Evaluación para cerrar Etapa 1

El alcance técnico **local y autorizado** queda implementado y preparado para
revisión de cierre: arquitectura y fronteras documentadas, migraciones repetibles,
aislamiento/RLS/ACL comprobados, identidad/recuperación/mantenimiento y HTTP local
ejecutables, compatibilidad/concurrencia verificadas y reporte reproducible.
Windows y Ubuntu se verificaron en la ejecución enlazada del commit de implementación.

Esto permite proponer el cierre técnico del laboratorio tras revisar la entrega;
no se da por cerrada formalmente la etapa ni se autoriza iniciar Etapa 2. Los puntos
reservados de arriba no se resuelven inventando políticas ni creando infraestructura.
No se certifica seguridad de producción. El propietario conserva la decisión de
cierre y cualquier autorización posterior.
