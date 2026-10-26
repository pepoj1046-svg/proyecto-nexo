# Trufis Bolivia — Proyecto Nexo

Backend local de Etapa 1 con datos ficticios: PostgreSQL, aislamiento por asociación,
reservas por segmentos, aceptación del chofer y despacho. Sin despliegue, pagos ni GPS.
Trabajo en `desarrollo/etapa-1`; [PR de revisión #1](https://github.com/pepoj1046-svg/proyecto-nexo/pull/1), sin fusionar.

## Ejecutar

Requisitos: Node.js 22 o superior, npm, usuario local sin privilegios root en Linux.
No hace falta instalar PostgreSQL ni Docker: las pruebas usan binarios PostgreSQL
reales fijados en el lockfile, descargados desde npm.

```sh
npm ci --no-fund
npm test
npm run test:integration
# Ambos conjuntos:
npm run test:all
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
endpoint público, proveedor remoto ni aplicaciones publicadas.
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
npm run test:all ejecuta 17 unitarias, 54 integraciones y la comprobación del ejecutor.
