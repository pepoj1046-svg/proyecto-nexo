# Cierre técnico — Etapa 1 de 10, Trufis Bolivia

Fecha: **26/10/2026, America/La_Paz**. Repositorio exclusivo
`pepoj1046-svg/proyecto-nexo`; rama `desarrollo/etapa-1`; PR #1 abierto.
Base de esta última revisión: `023a18f0c5844102baeb9e389eed5506349780f9`.
Se revisaron AGENTS.md, requisitos, arquitectura, modelo, resultados, seguridad,
auditoría HTTP y el [dictamen ChatGPT más reciente](https://github.com/pepoj1046-svg/proyecto-nexo/pull/1#issuecomment-6422297782).

## Dictamen y alcance del cierre

**La Etapa 1 está técnicamente completa en su alcance de laboratorio local**, una
vez comprobada la matriz final indicada abajo. No se identificaron errores técnicos
demostrables pendientes que impidan cerrar ese alcance. Se entrega el cierre para
aceptación formal del propietario; no se fusiona ni se cierra el PR y no se inicia
Etapa 2. Este dictamen no declara preparación para producción ni cierre comercial.

La revisión consiste en inspección técnica del código y permisos más pruebas
automatizadas reales; no equivale a una certificación externa de seguridad.
Las limitaciones y decisiones reservadas de este documento siguen vigentes.

## Funcionalidades implementadas

| Área | Implementado y verificado |
|---|---|
| Aislamiento | Asociación/membresías, referencias compuestas, RLS A/B, chofer propio, reservas propias, SQL sin DML para runtime |
| Inventario | 1–6 plazas, capacidad por segmento, presenciales y APP sobre el mismo inventario, expreso, grupos juntos o división voluntaria atómica |
| Tarifas | Tarifas por tramo y vigencia, detección de ambigüedad, importe/versión conservados en reserva; sin cobro |
| Filas/despacho | Primer vehículo compatible, aceptación/rechazo/caducidad, salida exclusiva del chofer, manifiesto confirmado, incompletos conservan orden y retorno a fila |
| Geografía | Catálogo versionado departamento→provincia→municipio→localidad, rutas/paradas, permisos con vigencia y auditoría; clasifica internamente |
| Búsqueda | Solo origen/destino, servicios existentes con permiso/tarifa/plazas; sugerencias acotadas VERIFIED/ACTIVE, tildes/ñ y homónimos con jerarquía/IDs/versión |
| Identidad local | Registro de pasajero, scrypt, sesiones opacas, caducidad, cierre individual/todas, recuperación de un uso y bloqueo/reactivación |
| Roles | Provisión offline de administradores/revisores, chofer de asociación propia; sin autoasignación ni revisión de solicitudes propias |
| Seguridad | Pools separados, autoridad efectiva comprobada, ACL/DEFINER/search_path, límites de intentos y scrypt, eventos privados/inmutables sin secretos |
| Mantenimiento | Simulación y limpieza por lotes/cutoff obligatorio de sesiones y recuperación inválidas y ventanas terminadas; sin borrar negocio/auditoría |
| Transporte de pruebas | HTTP solo 127.0.0.1 con JSON/Bearer, límites, validación de origen/Host, errores sanitizados y cierre controlado |

Las reglas de menores, pagos, licencias, GPS y la operación comercial no se dan
por implementadas por aparecer en los requisitos. Los supuestos de oferta/manifiesto
son los documentados del prototipo, sujetos a decisión antes de un uso real.

## Arquitectura y base de datos existente

Backend modular Node.js ESM (`.mjs`) y PostgreSQL real como fuente transaccional.
No hay aplicaciones móviles/web, proveedor remoto ni API pública. Los frameworks
de aplicaciones descritos en ARQUITECTURA.md continúan siendo propuestas futuras.

| Componente | Fuente ejecutable y responsabilidad |
|---|---|
| Dominio | src/domain/dispatch.mjs, search.mjs, localities.mjs: reglas puras y contratos |
| Negocio SQL | database/migrations: integridad, bloqueos, inventario, idempotencia y RLS |
| Adaptadores | src/db/service.mjs, runtime.mjs, maintenance.mjs: transacciones y guardas |
| Identidad | src/auth/identity.mjs, passwords.mjs, work-limit.mjs: verificador confiable y trabajo acotado |
| HTTP local | src/http/local-api.mjs y test-runtime.mjs: superficie de laboratorio sin provisión administrativa |
| Instalación/pruebas | scripts/migrate.mjs, test-postgres.mjs, local-demo.mjs, verify-test-exit.mjs, verify-local-api.mjs |

El esquema `nexo` tiene 25 tablas operativas/técnicas, agrupadas así:

- Identidad/roles: users, sessions, memberships, identity_accounts,
  identity_attempts, identity_recovery, operation_reviewers.
- Asociaciones/geografía: associations, geo_catalogs, departments, provinces,
  municipalities, localities, routes, stops.
- Operación: vehicles, trips, fares, bookings, actions.
- Permisos/auditoría: route_authorizations, authorization_events, audit_events,
  identity_events, security_events.

`public.nexo_migrations` registra nombre/checksum y fecha de aplicación. El ejecutor
serializa migraciones con advisory lock, aplica cada archivo en transacción y
rechaza checksums alterados. Las relaciones operativas incluyen asociación para
impedir referencias cruzadas. El inventario usa bloqueos de ruta y READ COMMITTED;
la idempotencia evita duplicados. schema.sql solo remite a las migraciones.

Conexiones separadas: `nexo_app`, `nexo_identity`, `nexo_provisioner` y
`nexo_maintenance`, con grupos NOLOGIN y logins locales limitados. El propietario
solo instala y mantiene el esquema. Los pools de aplicación no usan superusuario,
BYPASSRLS, propiedad de objetos ni grupos privilegiados combinados.

## Migraciones preservadas

| Número | Archivo y alcance |
|---|---|
| 001 | core: entidades, claves compuestas, sesión/actor, RLS y guardas |
| 002 | operations: inventario, reservas/grupos, tarifas, ofertas, cancelación, despacho e idempotencia |
| 003 | queue: retorno a fila y auditoría inmutable |
| 004 | isolation_guard: READ COMMITTED obligatorio para operaciones |
| 005 | geography_authorizations: catálogo geográfico, rutas/paradas y permisos |
| 006 | search_authorization_functions: elegibilidad, búsqueda y revisión |
| 007 | eligibility_rls: puerta transaccional y lectura histórica/elegible |
| 008 | locality_lookup: sugerencias, índices y defaults/lectura seguros |
| 009 | identity_and_provisioning: cuentas, sesiones, recuperación y roles |
| 010 | security_and_abuse: límites, eventos, caducidad tras lock, logout y search_path |
| 011 | identity_maintenance: mantenimiento acotado e índices |

**001–011 intactas**, verificadas por SHA-256. No fue necesaria una 012 ni se
reimplementaron funciones SQL probadas para esta última revisión.

## Compatibilidad de Node y correcciones finales

Soporte declarado: **Node 22.x y 24.x**, mínimo **22.0.0**. package.json y el
metadato raíz de package-lock.json usan `^22.0.0 || ^24.0.0`; el workflow prueba
esas dos familias en Ubuntu y Windows. README y guía HTTP indican el mismo soporte.
Otras familias, incluida Node 20, no están declaradas soportadas en esta entrega.

La observación previa era una discrepancia entre `>=20`, la guía y la cobertura
real, no una prueba de que todo Node 20 falle. Se conserva `String.isWellFormed()`
y los controles Unicode; no se debilitan validaciones para simular soporte no probado.
También se revisaron las API de HTTP/streams, TextDecoder, crypto y node:test usadas
por el laboratorio. No se modifican versiones de dependencias ni se agregan servicios.

Defecto HTTP menor demostrado: Origin/Sec-Fetch-Site vacíos se interpretaban como
ausentes. La regresión se ejecutó antes del arreglo y falló; ahora cualquier Origin
presente se rechaza y Sec-Fetch-Site solo admite ausencia o `none`. La prueba también
verifica que no se invoquen adaptadores ante esas solicitudes.

La revisión de 010–011, sesiones, roles y mantenimiento no mostró otro defecto
demostrable bloqueante dentro del laboratorio. Se mantienen las correcciones
anteriores de presupuestos, límites, caducidad tras lock, logout concurrente,
privilegios efectivos y privacidad de eventos, con sus regresiones.

## Pruebas finales y evidencia

Ejecución local real: Linux x64, Node **24.19.0**, npm **11.9.0**, PostgreSQL **18.4**.

```text
npm run test:all
  unitarias:           23/23 aprobadas
  PostgreSQL real:     66/66 aprobadas
  omitidas/canceladas: 0; fallos: 0
  runner:              fallo intencional 9 conservado; PostgreSQL detenido
  launcher HTTP:       registro/login/logout y cierre HTTP/PostgreSQL aprobados
exit: 0
git diff --check
exit: 0
```

La matriz remota final es Node 22/24 × Ubuntu/Windows. Su enlace/resultado se
incorporará tras observar los cuatro jobs; no se da por aprobada de antemano.
No se han probado otras versiones PostgreSQL ni una base productiva.

Cobertura que permite evaluar el cierre:

- Instalación 001–011 en orden, no-op/checksum/rollback y ejecutores concurrentes.
- Reaplicación sobre base 001–011 poblada con reserva confirmada, cuenta/sesión
  gestionada y contexto de asociación: todas las tablas se conservan fila a fila.
- Actualizaciones históricas pobladas desde 001–004 y 001–009; seis plazas por tramo,
  precios e identidad previa preservados; séptima plaza rechazada.
- RLS A/B, claves compuestas, roles mínimos, ACL exactas, search_path/pg_temp,
  credenciales inaccesibles y rechazo de escalamiento/revisión propia.
- Carrera de 24 conexiones por la última plaza, grupos atómicos, aceptación,
  cancelación, filas y salida idempotentes, retiros/revocaciones concurrentes.
- Sesiones/códigos vencidos o revocados, recuperación y logout concurrentes,
  mantenimiento con filas bloqueadas y preservación de sesiones/presupuestos válidos.
- HTTP en sockets reales, contratos, encabezados, límites, Unicode y sanitización;
  launcher completo aislado sin consumir DATABASE_URL externa.
- 20.000 localidades ficticias, índice observado con EXPLAIN ANALYZE BUFFERS,
  sugerencias concurrentes acotadas; no representa carga ni catálogo nacional real.

## Límites y riesgos conocidos

1. Laboratorio con datos ficticios, seis plazas como modelo del piloto, sin
   validación de vehículos/rutas/personas reales. VERIFIED es un estado interno,
   no acreditación oficial ni un catálogo nacional verificado.
2. `nexo_identity` es una autoridad confiable de emisión: controlar esa conexión
   o el proceso verificador permite suplantar cuentas gestionadas. RLS no contiene
   al propietario, al aprovisionador autorizado ni al administrador del SO.
3. Revocación no aborta una sentencia ya autorizada; sí impide sentencias posteriores.
   Un token Bearer válido es reutilizable hasta caducar/revocarse, como está diseñado.
4. Los límites locales pueden causar denegación deliberada de un login/global;
   no constituyen protección distribuida. Loopback no contiene a procesos locales
   maliciosos. La API de laboratorio no debe promoverse como API pública.
5. Sin proveedor real, TLS público, MFA, canal real de recuperación, cliente seguro,
   monitorización externa, disponibilidad operativa o restauración de producción probadas.
6. Sin retención legal aprobada ni cron: cutoff explícito/dry-run para mantenimiento;
   no se borran auditoría, reservas ni idempotencia. Backups y eliminación de personas
   necesitan diseño y aprobación correspondientes.
7. Siguen pendientes menores/responsables, abordaje individual, ausencias/incidentes,
   notificaciones, plazo definitivo de ofertas/manifiesto, servicios completamente
   intramunicipales y reservas futuras después de revocar permisos.
8. T12/T15/T16, cobros/QR/conciliación, licencias comerciales, devoluciones y GPS
   no están implementados como módulos reales. No se certifica normativa/operación comercial.

Estos puntos limitan un uso comercial; no se ocultan como funciones terminadas ni
se convierten en cambios automáticos de negocio para cerrar el laboratorio.

## Condiciones para iniciar Etapa 2

- Aceptación explícita del propietario del cierre y del alcance de laboratorio.
- Revisión de la entrega/CI, con PR #1 abierto hasta que se autorice su gestión;
  este cierre no implica permiso para fusionar main.
- Aprobación expresa del alcance y criterios de aceptación de la siguiente etapa,
  manteniendo simulación y las fronteras de identidad/datos/costos autorizadas.
- Resolver decisiones funcionales antes de implementar las partes que dependan de
  ellas; continuar las partes independientes solo tras autorizar Etapa 2.

Se entrega únicamente [propuesta de alcance y plan](PROPUESTA_ETAPA_2.md), sin código,
migraciones, ramas ni recursos de Etapa 2. No hay despliegues, gastos ni datos reales.
