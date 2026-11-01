# Etapa 4A.1 — contrato del directorio administrativo local

Base autorizada: `42236753b6614e876c6d3bcf14067126d3b92f6b`, hijo directo del
cierre `1f07fd9`. Desarrollo: `desarrollo/etapa-4`; revisión independiente hacia
`planificacion/etapa-4a`. PR #3 y ramas anteriores se conservan. Solo datos ficticios.

## Propósito y límites

Consulta administrativa independiente de viajes. No da de alta ni edita asociaciones,
cuentas, membresías, vehículos, rutas, puntos o tarifas. No modifica reservas,
capacidad, filas, precios, grupos, menores, responsables, movimientos o custodia.
No existe un rol nuevo GENERAL_ADMIN ni se amplían facultades del REVIEWER.

## Consulta privada

POST `/api/directory/page` en el gateway existente, con sesión web, cookie y CSRF.
Cuerpo cerrado: `section`, `associationId`, `limit`, `cursor`. No acepta actor,
rol, pertenencia, SQL, comandos ni campos de escritura del navegador.

| section | associationId | Proyección y permiso |
|---|---|---|
| ASSOCIATIONS | null u omitida | Asociaciones con membresía ASSOCIATION_ADMIN activa del actor; selección paginada, sin directorio global. |
| DRIVERS | UUID de asociación | Membresías DRIVER existentes, activas/inactivas, ID y etiqueta mínimos. Requiere ADMIN de esa asociación y alcance completo. No consulta identidad/credenciales. |
| VEHICLES | UUID de asociación | Padrón original de vehículos, capacidad técnica y bloqueo/servicio. Requiere ADMIN y alcance completo; incluye unidades sin viajes. |
| ROUTES | UUID de asociación | Rutas propias administrables, origen/destino, sentido, versión y estado técnico de permiso/elegibilidad. |
| POINTS | UUID de asociación | Puntos de esas rutas, orden, localidad registrada, subida/descenso y perfil existente TERMINAL/URBAN/ROAD; ausente → UNCLASSIFIED, sin clasificación inferida. |
| FARES | UUID de asociación | Tarifas existentes por segmento, ordinarias/expresas, importe, versión y fechas; vigentes, futuras o vencidas identificadas. La consulta no las habilita para vender. |

Un ADMIN limitado ve ROUTES/POINTS/FARES únicamente donde `manage_route` lo permite;
no obtiene padrón de choferes o vehículos por asociación o por viajes pasados. Se
conserva la semántica global conservadora de `admin_limits`: una restricción de
la cuenta no desaparece por añadir otra membresía. DRIVER, PASSENGER y REVIEWER
sin ADMIN son denegados. Un `associationId` ajeno no concede autoridad.

Respuesta: `association`, `section`, `scope`, `items`, `total`, `limit`, `nextCursor`,
`readOnly`, `snapshotOnly`. El ámbito diferencia FULL_ASSOCIATION de AUTHORIZED_ROUTES.
Se separan estado comercial, adhesión, operación, permiso de ruta y vigencia de tarifa.

Un vehículo sin servicio activo se muestra como NO_ACTIVE_TRIP, **sin prometer
aptitud para asignación ni plazas libres de un recorrido**. La capacidad de seis
proviene del modelo actual, sin generalización a futuros vehículos. Los datos
ausentes se indican como no registrados; no se crean entidades de respuesta.

## PostgreSQL y paginación

034 añade exclusivamente funciones de lectura sobre las entidades originales.
001–033 son inmutables. Solo `web_admin_directory` tiene EXECUTE para nexo_app;
helpers privados, PUBLIC revocado y search_path fijo pg_catalog,nexo,pg_temp.
No tablas, inventarios paralelos, DML ni backfills. El adaptador usa transacción
READ COMMITTED READ ONLY con los límites SQL existentes.

Después de esperar el lock compartido de ámbito, se revalidan actor, sesión con
hora actual y membresía ADMIN. `require_actor` conserva la prohibición de snapshots
fijos de 004. La revocación no promete abortar una lectura ya autorizada en curso;
cada consulta posterior y página vuelve a autorizarse. No se consulta el catálogo
público como sustituto de una proyección administrativa.

Tamaño predeterminado 50, permitido 1–100. Orden por UUID; puntos por ruta e índice
entero con clave sin truncamiento. Total, revisión, filas y cursor proceden de la
misma proyección materializada. No OFFSET acotado que impida alcanzar registros.

Cursor cerrado: v, scope, permissions, revision, size, key. Vinculado a sesión,
actor, asociación, colección, tamaño, membresías/ámbitos y eventos de provisión.
Cambiar alcance y restaurarlo idéntico invalida páginas anteriores. Si cambian
permisos o datos: PAGE_CHANGED, sin mezclar páginas. Sesión revocada/caducada: 401;
rol o asociación ajenos: 403; colección de padrón con alcance limitado: FORBIDDEN_SCOPE.
Cursor de otra consulta/sesión o forma inválida: INVALID_CURSOR.

El cursor no es una credencial ni una firma. La clave debe existir en el conjunto;
un usuario autorizado puede elegir otra clave existente para navegar dentro de su
propio listado, sin adquirir acceso. La enumeración normal se verifica sin omisiones
ni duplicados; no se afirma integridad criptográfica contra saltos de página elegidos.

## Interfaz y comprobación

Acceso desde Administración, enlace al directorio antes de elegir vehículo.
Selección de asociación y apartados propios; páginas anterior/siguiente, refresco,
vacío/carga/error y ámbito explícito. Cada nueva consulta borra los datos anteriores;
un error de autorización/página no conserva un padrón obsoleto. Cambiar cuenta o
desmontar invalida respuestas tardías. Es consulta manual, sin sondeo ni GPS.

Las pruebas deben contrastar PostgreSQL real, entidades sin viaje, más de 50 filas
en cada colección y selección de asociación, A/B, roles, scopes cambiantes, sesiones,
CSRF, ACL, upgrades poblados y ausencia de mutaciones. E2E de escritorio/móvil usa
testigo SQL READ ONLY; accesos, tokens y conexión permanecen privados en `.local`.
El informe de entrega indicará resultados ejecutados y CI del commit final.

No autoriza 4A.2, edición de tarifas/rutas, altas, bancos, avisos externos, servicios
pagados, despliegues o etapas 5–10. Las decisiones jurídicas/comerciales del plan
siguen pendientes; no bloquean este contrato de lectura autorizado.
