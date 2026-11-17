# Trufis Bolivia — Etapa 4, Incremento 4A.1

Fecha: 01/11/2026, America/La_Paz. Solo laboratorio y datos ficticios.
Base `42236753b6614e876c6d3bcf14067126d3b92f6b`, hijo directo del cierre `1f07fd9`.
Rama `desarrollo/etapa-4`; [PR #5](https://github.com/pepoj1046-svg/proyecto-nexo/pull/5)
hacia `planificacion/etapa-4a`, abierto sin fusión. PR #3 y ramas previas intactos.

## Entrega y validez de resultados

Directorio administrativo de solo lectura implementado. La entrega se refiere
al commit final y a los resultados que ratifique el [registro de verificación](https://github.com/pepoj1046-svg/proyecto-nexo/pull/5#issuecomment-6565076483).
Mientras ese registro indique CI pendiente, no se presenta como aprobación final
de plataformas. Se actualiza el registro tras CI para conservar el mismo SHA
verificado, sin commits posteriores de solo resultados. No se reutiliza la CI de
Etapa 3 como validación de código nuevo.

El primer commit de la rama, `5d3a7d6`, publica exclusivamente el contrato para
abrir un borrador independiente y enlazar su registro. Los filtros anteriores no
ejecutan matrices en ese checkpoint documental. El commit de implementación
estabilizada incluye los filtros nuevos y la evidencia local; no se programan
matrices completas para cada corrección dirigida.

## Funcionalidades completadas

- Directorio accesible desde Administración, sin elegir vehículo ni tener viajes.
  Selección paginada de asociaciones que administra realmente la cuenta.
- Choferes DRIVER activos/inactivos, identificadores/etiquetas técnicos mínimos;
  vehículos registrados, incluidos los que nunca tuvieron viaje, capacidad y estado
  verificable. Sin servicio activo no se promete aptitud ni plazas libres.
- Rutas dirigidas, origen/destino registrados, versión, permiso técnico vigente y
  elegibilidad para solicitudes. Puntos con orden, localidad, subida/descenso y
  perfiles TERMINAL/URBAN/ROAD reales; sin perfil se indica UNCLASSIFIED.
- Tarifas ordinarias/expresas por segmento, importe, versión, vigencia futura,
  actual o vencida. No habilita ventas ni modifica importes pactados.
- Páginas anterior/siguiente y refresco, más de 50 filas por colección, carga,
  vacío, errores y ámbito comprensibles; teclado, escritorio y móvil. Error o
  cambio de consulta/cuenta no conserva filas privadas de la consulta anterior.

Se reutilizan membresías, vehículos, rutas, puntos, perfiles, tarifas, bloqueos y
viajes existentes. No tablas nuevas, inventario paralelo, altas, edición, rol
general nuevo ni cambios de reglas operativas. No se implementa 4A.2.

## Arquitectura, archivos y migración

| Archivo | Cambio |
|---|---|
| database/migrations/034_admin_directory.sql | RPC web_admin_directory y tres helpers privados: actor/alcance, huella de permisos y filas. Solo proyecciones; 001–033 intactas. |
| src/db/web-directory-service.mjs | Contrato cerrado de seis colecciones y cursor; transacción READ COMMITTED READ ONLY sobre nexo_app. |
| src/http/web-gateway.mjs | POST /api/directory/page específico con wrapper existente autenticado/CSRF; sin segundo servidor o API pública. |
| apps/web/src/Directory.tsx | Selección de asociación, cinco apartados y paginación; generaciones y borrado de datos obsoletos. |
| apps/web/src/Operations.tsx, styles.css | Enlace y sección antes del selector de viaje, componentes de página existentes y adaptación móvil. |
| scripts/seed-directory-fixture.mjs, seed-web-demo.mjs | Fixture ficticio opcional previo al listener: entidades sin viajes, >50 por colección y asociación vacía. No endpoint de alta. |
| scripts/test-web.mjs | Añade suite dirigida y testigo SQL privado en el ciclo de arranque/cierre existente. |
| tests/directory.test.mjs, integration/postgres.test.mjs | Contrato, PostgreSQL/HTTP real, ACL, concurrencia de revocación, paginación, no mutación y actualización poblada. Expectativas de migraciones añaden 034. |
| tests/web/administrative-directory.spec.mjs, support/directory-evidence.mjs | E2E por dispositivo; contraste independiente de IDs y hashes de negocio desde conexión READ ONLY. |
| .github/workflows/etapa-1-tests.yml, codeql.yml | Cobertura de desarrollo/etapa-4 y PR de planificación; conservan plataformas, tiempos y retries existentes. |
| AGENTS.md, README.md y planes | Autorización actual, instrucciones y vínculo con planificación anterior sin renombrar informes históricos. |

[Contrato detallado](../ETAPA_4_DIRECTORIO_ADMINISTRATIVO.md). 034 no hace DML,
backfill, cambios de precios/filas/reservas, ni materializa vencimientos. Se prueba
instalación limpia, 033 poblada → 034 y reaplicación vacía, preservando datos y
registro/checksums previos. Los hashes de 001–033 se contrastan con el cierre.

## Permisos y consistencia

ASSOCIATION_ADMIN activo de la asociación, derivado de sesión SQL, es obligatorio.
DRIVER/PASSENGER/REVIEWER sin ADMIN son denegados. Asociación del body no acredita
autoridad. ADMIN limitado consulta solo rutas/puntos/tarifas de manage_route;
DRIVER/VEHICLES completos exigen scope_allows(NULL), conservando su restricción
global por cuenta aunque exista otra membresía. No se infiere padrón por viajes.

Helpers sin EXECUTE para runtime/PUBLIC; RPC única con search_path fijo. No grants
de DML ni provisión/identidad. Tras esperar el advisory lock de ámbito se revalida
sesión con clock_timestamp y membresía. require_actor conserva la prohibición de
REPEATABLE READ/SERIALIZABLE de 004. No se promete abortar toda lectura ya autorizada
al revocar; cada lectura/página posterior se autoriza de nuevo.

Cursor ligado a sesión, actor, asociación, colección, tamaño, permisos y revisión
del conjunto; quitar/restaurar ámbitos idénticos invalida el anterior. Total,
revisión, página y cola se calculan desde la misma proyección materializada.
No es una credencial ni HMAC: elegir otra cola existente puede navegar dentro
del listado ya autorizado; no concede lectura ajena. Se rechazan claves inexistentes.

No datos de pasajeros, hashes de credenciales, contraseñas, tokens, códigos o detalles privados de
permisos en la respuesta. Las consultas no añaden acciones/auditoría de escritura;
los snapshots por tabla comprueban no mutación del negocio. Auth conserva sus propios
eventos/sesiones normales y se distingue de esos snapshots.
Las huellas técnicas de consulta/revisión del cursor no son autenticadores ni hashes
de contraseña. Se recalculan sobre el conjunto visible: esta entrega no certifica
carga nacional ni un catálogo de tamaño ilimitado con ese costo de revisión.

## Hallazgos y correcciones

Los dos auditores genéricos trabajaron solo en lectura; el principal fue único
editor, ejecutor e integrador. No se afirma carga automática de perfiles TOML.

`e4a1_seguridad` identificó una colisión de claves en POINTS con lpad de cinco
caracteres: índices 10000 y 100000 compartían clave. La regresión falló realmente
con cinco filas frente a seis; ancho diez cubre integer no negativo y la regresión
ahora exige ambos puntos. Retiró la hipótesis de aislamiento inseguro al comprobar
la guarda heredada de 004; se añadió caso RPC de snapshots fijos como evidencia.

`e4a1_pruebas` pidió cubrir también >50 asociaciones, navegación anterior/siguiente,
limpieza ante errores y acotar el significado del cursor no firmado. Se incorporó.
Detectó la necesidad de mantener REVIEWER ficticio solo en el fixture nuevo.

En E2E, un test compartía cookies entre roles: el segundo login encontraba una
sesión ya autenticada y agotaba el tiempo. Se corrigió el test con contextos
independientes, sin ampliar timeout, reintentar silenciosamente o modificar permisos.
El test HTTP ajustó su expectativa al código 401 AUTHENTICATION_REQUIRED del wrapper
existente; la denegación no cambió. Las ejecuciones fallidas no se cuentan como aprobadas.

La primera pasada integral detectó un reemplazo accidental de esa expectativa en
la prueba histórica I11 de la API CLI. Se restauró exactamente UNAUTHENTICATED
en I11, conservando AUTHENTICATION_REQUIRED en el caso nuevo del gateway web.
No se cambió el backend ni se relajaron aserciones; se repiten ambos casos afectados
y la batería final para entregar una ejecución completa aprobada.

La pasada E2E integral local aprobó 74 casos y falló en el login de terminal-return
móvil con net::ERR_EMPTY_RESPONSE, antes de la operación de retorno. La traza no
registró respuesta HTTP y no se determinó la causa concreta. El laboratorio cerró
normalmente; no hubo OOM en los contadores del entorno. Se conserva esa ejecución
fallida y se ejecutan solo el afectado y las suites pendientes (14 casos móviles),
sin cambiar código, tiempos, aserciones ni retries de Playwright. No se presenta
la primera pasada como una ejecución integral verde. La CI final debe ejecutar
la batería completa sobre el SHA publicado.

## Pruebas y evidencia

Pruebas dirigidas ya ejecutadas: 2 unitarias nuevas, 13 PostgreSQL/HTTP reales y
3 E2E de escritorio + 3 móviles, con apagado/reinicio. Incluyen A/B, roles, sesiones,
revocación/caducidad tras espera, cambio/restauración de ámbitos, las seis colecciones
>50, entidades sin viaje, igualdad con SQL, página obsoleta y actualización poblada.

Resultado local sobre el código estabilizado: **443 casos únicos aprobados**,
64 unitarias + 291 PostgreSQL reales + 88 E2E (44 escritorio, 44 móvil).
Unitarias/integración finales: cero fallos/omisiones, compilación TypeScript/web,
propagación de errores del runner y smokes HTTP aprobados. E2E: 74 aprobadas y
un fallo de login en la primera pasada; 14 aprobadas en la continuación del
caso afectado y las suites restantes, sin cambiar código. No se presenta la
primera pasada como verde ni se cuentan repeticiones como casos nuevos.
32 laboratorios cerraron en la primera pasada, incluido el fallido, y nueve en
la continuación; SIGINT real y reinicio sin sesión/contraseña/reserva anterior
aprobados al completar esta última. Los 422 anteriores están preservados y
verificados de nuevo dentro de esos 443; no se usa solo su cantidad para validar.
Entorno real: Debian13, Node24.19.0, PostgreSQL18.4, Playwright1.64.1,
Chromium154.0.8037.57. Windows/Ubuntu y Node22 se verifican separadamente en CI.

Comandos:

```text
node --test tests/directory.test.mjs
npm run web:build
node scripts/test-postgres.mjs --test-name-pattern=4A1
node scripts/test-web.mjs --suite=administrative-directory.spec.mjs
npm run test:all
npm run test:web
```

[Cuatro capturas y huellas de esta entrega](evidencias/etapa-4-4a1.json), sin
credenciales, cookies, conexiones, códigos o trazas privadas. La procedencia
escritorio/continuación móvil está diferenciada. El testigo obtiene su configuración únicamente
por IPC del clúster ficticio y nunca mediante HTTP. No es una función de producto.

[Vehículos escritorio](evidencias/etapa-4-4a1/vehiculos-desktop.png) ·
[Vehículos móvil](evidencias/etapa-4-4a1/vehiculos-mobile.png) ·
[Vacío escritorio](evidencias/etapa-4-4a1/vacio-desktop.png) ·
[Vacío móvil](evidencias/etapa-4-4a1/vacio-mobile.png).

CI conserva Ubuntu/Windows × Node22/24, sin aumentar tiempos ni retries. CodeQL
analiza JavaScript/TypeScript, no certifica SQL. Runs, jobs, SHA y resultados finales
constarán en el [registro del PR #5](https://github.com/pepoj1046-svg/proyecto-nexo/pull/5#issuecomment-6565076483).
No se afirma enumeración/cierre de alertas históricas no accesibles al conector.

## Prueba sencilla en Windows

Con Node22 o24 y checkout de desarrollo/etapa-4:

```powershell
npm ci --no-fund
npx --no-install playwright install chromium
$env:NEXO_WEB_ADMIN_DIRECTORY_FIXTURE='1'
npm run dev:web
# Ctrl+C al terminar
Remove-Item Env:NEXO_WEB_ADMIN_DIRECTORY_FIXTURE
```

Abrir solo la URL 127.0.0.1 indicada y leer accesos del archivo privado de esa
ejecución. En Administración entrar con admin y consultar directorio sin elegir
vehículo; seleccionar Horizonte, recorrer los cinco apartados y todas las páginas.
El fixture crea las entidades reales de prueba antes del listener. Asociación
FICTICIO-DIRECTORIO-SIN-REGISTROS demuestra vacío, sin crear datos de respuesta.

En perfil separado, adminH solo ve rutas autorizadas y no puede consultar padrones
completos. driver5 y operativo0 no acceden al directorio administrativo. Consultas
de tarifa no cambian precio ni reserva. No ejecutar builds mientras haya navegador
de pruebas activo. No se afirma prueba manual Windows por el agente; la evidencia
automatizada corresponde a Actions. La demostración es efímera, no instalación comercial.

## Límites y pendientes para 4A.2

No CRUD, provisión web, solicitud/alta de chofer, administrador general, edición
de ruta/tarifa, GPS, pagos, anuncios, avisos externos o despliegue. Disponible sin
viaje no significa apto para servicio; membresía activa no acredita identidad o
habilitación jurídica. Sigue pendiente bootstrap transferible y política de último
ADMIN, revocación en servicio, versionado de configuración y retención/exportación.

4A.2 necesita otro encargo: desacoplar controles existentes del viaje, con contratos
seguros de revocación/restauración y casos activos bloqueados hasta decisión. Este
incremento no los implementa y no declara cerrada Etapa 4 ni inicia etapas 5–10.
