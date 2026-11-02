# Trufis Bolivia — Proyecto Nexo

Backend local de Trufis Bolivia con datos ficticios: PostgreSQL, aislamiento por
asociación, reservas por segmentos, asignación por turno, recogidas y despacho. Etapa 3, auditoría y cierre técnico de laboratorio,
en `desarrollo/etapa-3`, desde `820fd1f` de Etapa 2. PR de esta etapa hacia
`desarrollo/etapa-2`; [PR #1](https://github.com/pepoj1046-svg/proyecto-nexo/pull/1)
permanece abierto y sin fusionar. Sin producción, pagos ni GPS real. Autorizado actualmente solo el Incremento 4A.2.

## Etapa 4A.1: directorio administrativo de lectura

Rama `desarrollo/etapa-4` desde planificación `4223675`. [PR #5](https://github.com/pepoj1046-svg/proyecto-nexo/pull/5)
hacia `planificacion/etapa-4a`; PR #3 y etapas anteriores se conservan.
En Administración, usar «Ir al directorio administrativo» y consultar asociación,
choferes, vehículos, rutas/puntos y tarifas sin elegir un viaje. No hay altas ni edición.

001–033 intactas; 034 añade solo proyecciones autorizadas. ADMIN limitado consulta
rutas/puntos/tarifas de su ámbito; padrones completos DRIVER/vehículos requieren
alcance completo. Las tarifas futuras/vencidas son configuración, no habilitación
para vender. Sin viaje activo no significa vehículo apto ni inventario libre.

Para el escenario ficticio completo en PowerShell:

```powershell
$env:NEXO_WEB_ADMIN_DIRECTORY_FIXTURE='1'
npm run dev:web
# Ctrl+C al terminar
Remove-Item Env:NEXO_WEB_ADMIN_DIRECTORY_FIXTURE
```

Leer accesos generados en el archivo privado indicado por la terminal. La cuenta
`admin` solo se publica en ese fixture local; `adminH` conserva su ámbito limitado.
El fixture crea más de 50 entidades por colección antes de escuchar; la API no
crea registros de respuesta. No compartir contraseñas ni archivos de `.local`.

[Contrato](docs/ETAPA_4_DIRECTORIO_ADMINISTRATIVO.md) y
[informe y resultados exactos](docs/REPORTES/ETAPA_4_INCREMENTO_4A1.md).
El corte 4A.1 no incluyó escrituras. La autorización posterior 4A.2 se limita a los controles descritos a continuación; no declara completada toda la Etapa 4.

## Etapa 4A.2: DRIVER existentes y contacto LAB

Desde el directorio, sin elegir vehículo: «Choferes y membresías» → «Gestionar
permiso» → «Consultar estado e historial administrativo». Exige motivo y
confirmación. Bloquea servicio/fila y custodia pendiente; restaurar no rehabilita
vehículos, sesiones revocadas o turnos. El contacto acepta solo códigos LAB.
Historia privada paginada y reintento de respuesta incierta con la misma clave.

[Contrato](docs/ETAPA_4_ADMINISTRACION_CHOFERES.md) ·
[Informe, evidencias y Windows](docs/REPORTES/ETAPA_4_INCREMENTO_4A2.md).
001–034 intactas; nueva035. Sin altas, identidad global, producción o 4A.3.

## Etapa 3: interfaz web local

React + TypeScript, búsqueda por origen/destino conectada a PostgreSQL, plazas por
tramo y estados independientes por ruta. Inicio/cierre de sesión de prueba, puntos
intermedios autorizados, solicitudes persistidas con idempotencia y «Mis reservas».
Las nuevas reservas de terminal y expresas se confirman por turno. `HELD` conserva su significado **pendiente** para recogidas autorizadas, puntos sin clasificar e historial anterior; solo el chofer asignado acepta esas ofertas en `/operador`.
Terminal, presencia, abordajes individuales/grupales, despacho y progreso conectados
a paneles de administrador y chofer con permisos reales. Sin OAuth ni despliegue.
001–027 intactas en 7A/7B; 028 añade estimaciones y decisiones de condiciones. 027 conserva paginación web y cancelación
administrativa con motivo, delegando la transición en el núcleo existente. Se mantienen las
proyecciones por rol y los contratos de reservas, despacho, incidencias y rescates.

```sh
npm ci --no-fund
npm run dev:web
# Abrir la dirección http://127.0.0.1:<puerto> que muestra el terminal.
# Ctrl+C detiene HTTP y PostgreSQL. Datos ficticios nuevos en cada arranque.
```

La terminal muestra también la ruta de `.local/accesos-<identificador>.json`.
En una segunda terminal PowerShell: `Get-Content -Raw <ruta-del-archivo>`.
Usar `viajero0` para reservar. Las nuevas reservas de terminal se confirman
por turno: no requieren aceptación en `/operador`. El chofer del vehículo asignado
consulta su manifiesto en `/chofer` y registra la salida explícitamente.
`/operador` conserva aceptación solo para recogidas autorizadas y ofertas históricas. No compartir ni
subir ese archivo: sus contraseñas se generan en cada arranque y se elimina al cerrar.
**La base es efímera: reiniciar pierde cuentas, sesiones y reservas.**

[Procedimiento del incremento 2](docs/REPORTES/ETAPA_3_INCREMENTO_2.md).
[Informe histórico del incremento 1](docs/REPORTES/ETAPA_3_INCREMENTO_1.md).

[Recorrido completo Windows, paneles y evidencia del incremento 3](docs/REPORTES/ETAPA_3_INCREMENTO_3.md):
`operativo0` declara presencia en Mis reservas; `adminH` verifica/observa en
Administración; `driver5` inicia salida con cuatro abordados, recoge dos en Palmar,
registra inicio del viaje principal, llegada final y descensos. Usar contextos de
navegador separados para cada rol. Seis confirmadas no provocan salida automática.
Para pruebas de navegador: `npx --no-install playwright install chromium` si hace
falta, y `npm run test:web`. Escritorio y móvil emulado, solo en loopback.

[Incremento 4: incidencias, sustituciones y rescates](docs/REPORTES/ETAPA_3_INCREMENTO_4.md).
El responsable consiente todo su grupo; administración revalida el traslado o asigna
una unidad libre desde la terminal autorizada. El chofer sustituto registra el
traslado seguro antes de continuar. Sin vehículo disponible queda revisión humana,
sin cancelaciones, cobros ni notificaciones automáticas. Cuentas y procedimientos
ficticios para Windows y resultados de la batería ampliada en el informe.

[Incremento 5: directorio, presenciales, rechazo, cancelación propia y retorno voluntario](docs/REPORTES/ETAPA_3_INCREMENTO_5.md).
Las reservas presenciales fijan su origen en servidor y comparten inventario con APP;
el chofer acepta o rechaza sin movimientos automáticos. El directorio pagina servicios
por ruta/estado y la rehabilitación ficticia respeta el procedimiento nativo. Gateway
con handlers privados protegidos por CSRF y regresión de respuestas de sesión tardías.
Resultados, CodeQL, capturas y recorridos Windows en el informe del incremento.

[Incremento 6: cancelación administrativa, revisión y paginación real](docs/REPORTES/ETAPA_3_INCREMENTO_6.md).
Administrador y chofer recorren todo el manifiesto; el pasajero navega sus reservas
propias y consulta su presencia aunque exceda el primer bloque de 50. Los cambios
concurrentes de listado exigen actualizar, sin concatenar páginas incompatibles.
Motivo y confirmación obligatorios para cancelar administrativamente el grupo;
revisión de condiciones separada de su aceptación por el responsable. Sin dinero.

## Incremento 8A: turnos y traslados seguros

Terminal, presencial y expreso se asignan sin rechazo discrecional. El chofer declara
una falla mecánica mediante incidencias; la unidad queda bloqueada. Una sustitución
con abordados exige recepción real y confirmación del chofer receptor antes de
continuar. El pasajero puede reportar discrepancias para revisión sin cambiar plazas,
hechos ni importes. [Informe y prueba en Windows](docs/REPORTES/ETAPA_3_INCREMENTO_8A.md).

## Etapa 2: reservas y negocio local

[Cierre técnico propuesto, alcance y evidencia](docs/REPORTES/ETAPA_2_CIERRE_TECNICO.md).
018–022 añaden rescate interurbano, reservas durante el viaje, condiciones de ruta,
permisos por ruta/terminal y contratos administrativos mínimos. Cierre formal
pendiente de revisión; no es una autorización de producción.

`npm run dev:local` muestra dos puertos loopback: identidad/catálogo y negocio.
El segundo requiere Bearer salvo la proyección anónima local de disponibilidad,
y claves Idempotency-Key en mutaciones; no tiene login,
SQL ni aprovisionamiento. Ambas superficies usan la misma base nueva de pruebas.
Los tests crean fixtures ficticios para todos los escenarios; el launcher no crea
operadores reales ni un catálogo nacional.

[Contratos y endpoints](docs/ETAPA_2_CONTRATOS.md) ·
[Decisiones pendientes](docs/DECISIONES_PENDIENTES_ETAPA_2.md) ·
[Primer incremento](docs/REPORTES/ETAPA_2_INCREMENTO_1.md) ·
[Segundo incremento](docs/REPORTES/ETAPA_2_INCREMENTO_2.md) ·
[Tercer incremento](docs/REPORTES/ETAPA_2_INCREMENTO_3.md) ·
[Cuarto incremento](docs/REPORTES/ETAPA_2_INCREMENTO_4.md) ·
[Quinto incremento: terminal y sustitución urbana](docs/REPORTES/ETAPA_2_INCREMENTO_5.md).

Se mantienen 001–015 intactas. 016 añade terminal, consentimiento grupal y
correcciones de abordaje; 017 incorpora sustitución urbana exclusiva con fases
distintas de recogida y viaje principal, sin GPS ni despacho real. 013 incluye integrantes técnicos, movimientos
individuales, ofertas reforzadas y borradores de ausencia sin envío ni efectos
sobre plazas. El núcleo de capacidad/fila/tarifas se reutiliza. Suite actual:
**66 unitarias y 311 integraciones PostgreSQL real**. La batería web ampliada
comprende 96 casos de escritorio/móvil. Resultados efectivamente ejecutados e
incidentes en el informe 4A.2; ratificación de CI en su registro del PR #5,
probe del runner y smoke de ambos listeners. Node 22/24 en Ubuntu/Windows.

## Ejecutar

Requisitos: Node.js **22.x o 24.x**, npm, usuario local sin privilegios root en Linux.
Mínimo soportado: 22.0.0; package.json/lockfile y CI admiten esas dos familias.
La matriz completa ejecuta Node 22 y 24 sobre Ubuntu y Windows. Node 20 y otras
familias no forman parte del soporte declarado; no se afirma que todas fallen.
No hace falta instalar PostgreSQL ni Docker: las pruebas usan binarios PostgreSQL
reales fijados en el lockfile, descargados desde npm.

```sh
npm ci --no-fund
npm test
npm run test:integration
# Ambos conjuntos:
npm run test:all
# API de pruebas con un clúster nuevo; Ctrl+C cierra HTTP y PostgreSQL:
npm run dev:local
```

El ejecutor crea un clúster nuevo en `.local/`, escucha exclusivamente en loopback,
genera credenciales de prueba aleatorias y lo detiene con `pg_ctl` al terminar.
Ignora `DATABASE_URL`: nunca se conecta a una base remota para pruebas. No crea
servicios del sistema, cuentas, proyectos en nube ni recursos de pago.
Los archivos de diagnóstico permanecen en `.local/`, ignorados por Git.
En Linux no ejecutar como root: el script no crea usuarios del sistema.

## Migraciones y uso desde servidor

Para una base **local vacía y dedicada a este proyecto**, configurar
`MIGRATION_DATABASE_URL` en el entorno (ver `.env.example`) y ejecutar:

```sh
npm run db:migrate
```

La conexión de migración es de confianza y necesita crear esquema/rol. La aplicación
usa otra conexión sin privilegios de propietario, superusuario ni BYPASSRLS, con
pertenencia al rol `nexo_app`. Nunca entregar esa conexión al cliente final.
`database/schema.sql` es un indicador de las migraciones, no una segunda fuente DDL.
No aplicar sobre bases de otros proyectos ni importar el antiguo borrador.

`src/db/service.mjs` expone `createService(pool)` con métodos `reserve`, `respond`,
`cancel`, `depart`, `progress`, `requestQueue` y `bookings`. Cada llamada recibe un
token opaco y las mutaciones reciben una clave de idempotencia. La identidad sale
de `sessions`, no de un ID de usuario/asociación del cliente. Ejemplo de solicitud:

```js
await service.reserve(sessionToken, actionKey, {
  routeId, from: 0, to: 3, seats: 2, source: 'APP'
}); // HELD; el chofer debe aceptar para llegar a CONFIRMED.
```

El módulo local `src/auth/identity.mjs` implementa registro de pasajeros, login con
scrypt y sesiones revocables. Usa un pool separado con `nexo_identity`; el negocio
usa `nexo_app` y las altas privilegiadas requieren `nexo_provisioner`. No hay
endpoint público, proveedor remoto ni aplicaciones publicadas. El adaptador HTTP de
pruebas solo escucha en loopback y tiene launcher con base efímera propia.
Consultar [operación y decisiones](docs/IMPLEMENTACION_ETAPA_1.md),
[seguridad pendiente](docs/SEGURIDAD_PENDIENTE.md) y
[resultados exactos](docs/RESULTADOS_ETAPA_1.md).

## Geografía y rutas habilitadas

La base admite departamentos, provincias, municipios y localidades versionados.
La búsqueda recibe origen/destino y clasifica internamente; solo publica servicios
con asociación adherida/operativa, acceso comercial activo, permiso de ruta verificado,
tarifa y plazas. Los catálogos de prueba son ficticios, no datos oficiales de Bolivia.

    await service.search(sessionToken, { originLocalityId, destinationLocalityId });

[Modelo y contrato](docs/GEOGRAFIA_Y_AUTORIZACIONES.md) ·
[Reporte del incremento](docs/REPORTES/ETAPA_1_GEOGRAFIA.md).

Autocompletado de nombres (catálogo VERIFIED/ACTIVE, máximo 20 sugerencias):

```js
await service.suggestLocalities(sessionToken, {query: 'San José', limit: 10});
// Cada resultado incluye localidad, municipio, provincia, departamento e IDs/versión.
// La selección alimenta search con originLocalityId y destinationLocalityId.
```

[Contrato de localidades, identidad y roles](docs/LOCALIDADES_Y_AUTENTICACION.md) ·
[Pruebas y límites del incremento 008–009](docs/REPORTES/ETAPA_1_LOCALIDADES_IDENTIDAD.md).
Las rutas previas no obtienen geografía ni permisos automáticamente. La actualización
con reservas preexistentes está probada; consultar el procedimiento y límites.
npm run test:all conserva la cobertura de Etapa 1 y ejecuta también los contratos,
actualización poblada y escenarios APP/presencial/despacho HTTP de Etapa 2.

[API local y mantenimiento](docs/HTTP_LOCAL_Y_MANTENIMIENTO.md) ·
[Auditoría y evaluación de cierre técnico](docs/REPORTES/ETAPA_1_AUDITORIA_HTTP.md).
Migraciones nuevas 010–011; 001–009 intactas. La limpieza requiere cutoff explícito
y por defecto solo simula. Cierre de laboratorio de Etapa 1 aceptado; Etapa 2 en desarrollo local.

[Cierre técnico de Etapa 1](docs/CIERRE_TECNICO_ETAPA_1.md) ·
[Propuesta original de Etapa 2](docs/PROPUESTA_ETAPA_2.md).
La revisión final conserva **001–011 intactas**, alinea Node y refuerza el rechazo
de encabezados HTTP vacíos. El PR permanece abierto hasta autorización del propietario.

Expresos y división voluntaria, declaración de condiciones y decisiones del responsable:
[7A](docs/REPORTES/ETAPA_3_INCREMENTO_7A.md) · [7B](docs/REPORTES/ETAPA_3_INCREMENTO_7B.md).
Solo laboratorio; revisar las limitaciones de aceptación conjunta y resolución administrativa.

## Incremento 8B: responsables y revisión humana

Reservas presenciales con responsable ficticio separado de su cuenta; vínculo y
corrección auditados, menores/acompañantes, ausencias observadas sin liberar plazas
y revisión de discrepancias con rectificación nativa limitada. No establece
requisitos legales ni consecuencias automáticas. 001–030 intactas; nuevas 031–032.
[Contrato](docs/ETAPA_3_CUIDADOS_Y_REVISIONES.md) ·
[Informe y Windows](docs/REPORTES/ETAPA_3_INCREMENTO_8B.md).

## Auditoría y cierre de Etapa 3

[Dictamen, matriz de requisitos y procedimiento Windows](docs/REPORTES/ETAPA_3_AUDITORIA_Y_CIERRE.md).
La validez del cierre de laboratorio depende del commit y checks aprobados del
[registro final](https://github.com/pepoj1046-svg/proyecto-nexo/pull/3#issuecomment-6561718192).
001–032 conservadas; 033 corrige el listado de responsables. No se autoriza producción,
merge ni Etapa 4. Los contratos comerciales/jurídicos pendientes siguen explícitos.
