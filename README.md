# Trufis Bolivia — Proyecto Nexo

Backend local de Trufis Bolivia con datos ficticios: PostgreSQL, aislamiento por
asociación, reservas por segmentos, aceptación del chofer y despacho. Etapa 3, incremento 1,
en `desarrollo/etapa-3`, desde `820fd1f` de Etapa 2. PR de esta etapa hacia
`desarrollo/etapa-2`; [PR #1](https://github.com/pepoj1046-svg/proyecto-nexo/pull/1)
permanece abierto y sin fusionar. Sin producción, pagos, GPS ni incremento 2.

## Etapa 3: interfaz web local

React + TypeScript, búsqueda por origen/destino conectada a PostgreSQL, plazas por
tramo y tres estados de ruta. Selección de reserva **demostrativa**, sin escrituras.
Estructuras de pasajero, administrador y chofer pendientes de conexión; APIs privadas
bloqueadas en servidor. No OAuth ni despliegue. Migraciones 001–022 intactas.

```sh
npm ci --no-fund
npm run dev:web
# Abrir la dirección http://127.0.0.1:<puerto> que muestra el terminal.
# Ctrl+C detiene HTTP y PostgreSQL. Datos ficticios nuevos en cada arranque.
```

[Informe, pantallas, capturas y límites](docs/REPORTES/ETAPA_3_INCREMENTO_1.md).
Para pruebas de navegador: `npx --no-install playwright install chromium` si hace
falta, y `npm run test:web`. Escritorio y móvil emulado, solo en loopback.

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
**36 unitarias, 181 integraciones PostgreSQL real**, más 28 pruebas web de escritorio/móvil,
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
