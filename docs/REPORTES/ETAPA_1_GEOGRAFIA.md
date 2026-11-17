# Reporte de incremento geográfico — Etapa 1

Fecha: 25/10/2026 (America/La_Paz). Repositorio pepoj1046-svg/proyecto-nexo.
Rama exclusiva desarrollo/etapa-1; PR #1; base f441128.
Se leyeron AGENTS.md, documentos de requisitos/arquitectura/modelo/decisiones/
coordinación/resultados y observaciones del PR, en particular #6406741144 y #6406772652.
Trabajo local; no depende de activar Codex Cloud.

## Cambios

- Migraciones 005–007, sin modificar 001–004.
- Jerarquía departamento/provincia/municipio/localidad versionada y con fuente.
- Rutas/paradas geográficas y clasificación interna de tres tipos de recorrido.
- Búsqueda origen/destino con cupos por segmento, tarifa única, puntos habilitados
  y asociaciones adheridas, operativas y autorizadas para esa ruta.
- Solicitud/revisión de permisos, independencia de estados comerciales/operativos
  y auditoría inmutable.
- RLS de catálogos/permisos y contexto histórico de reservas propias.
- Índices de paradas, versiones, extremos e ingreso a fila por localidad protegidos.
- Propagación correcta de fallos del ejecutor de integración y errores de migración
  que identifican el archivo fallido.

Rutas principales: database/migrations/005 a 007; src/db/service.mjs;
src/domain/search.mjs; scripts/migrate.mjs, test-postgres.mjs y verify-test-exit.mjs;
tests/integration/postgres.test.mjs, tests/helpers/geography.mjs, tests/search.test.mjs
y documentación. El workflow existente ejecuta test:all, incluido el probe del ejecutor.

## Pruebas y evidencia local

Windows x64, Node 24.21.0, PostgreSQL 18.4 real, sin emulación.
Catálogos, asociaciones, referencias de permisos y usuarios ficticios.

    npm run test:all
      unitarias: 13 aprobadas, 0 fallos
      integración: 38 aprobadas, 0 fallos
      omitidas/canceladas: 0
      ejecutor: fallo intencional 9 del hijo preservado; comprobación aprobada
    resultado global: código 0

El mensaje bad option: --nexo-invalid-test-option es intencional. Acredita que
el ejecutor no ocultará un fallo del proceso de pruebas.

Las 25 integraciones anteriores se conservan: 24 conexiones compiten por la última
plaza (1 éxito, 23 rechazos), 16 reintentos idempotentes, grupos, expreso, seis plazas
por segmento, salida única, filas, suspensiones y permisos A/B.
Las nuevas G01–G13 verifican:
- Tres clasificaciones con idéntico contrato, sin selector.
- Servicios reales con precio/embarque y cero resultados si no hay servicio directo.
- Ausencia, caducidad, vigencia futura y revocación de permisos bloquean búsqueda/reserva.
- Adhesión, operación y acceso comercial son puertas independientes.
- A no solicita permiso para B ni se autoverifica; revisor autorizado verifica;
  el reintento no duplica auditoría.
- RLS oculta permisos ajenos y catálogos no elegibles; conserva reservas propias.
- Cupos llenos, puntos cerrados, chofer inactivo y tarifa ambigua no generan ofertas.
- Claves geográficas, extremos, stop_count y versiones protegidas.
- Suspensiones/revocaciones concurrentes se reevalúan después de esperar locks.
- Los viajes iniciados se pueden terminar.
- Checksums constantes 001–004, segunda aplicación sin efectos y actualización
  de una base poblada con reserva confirmada, conservando plazas/precios.

La evidencia remota actual está en los checks del
[PR #1](https://github.com/pepoj1046-svg/proyecto-nexo/pull/1).
Este reporte acredita la ejecución local; el PR registra la ejecución CI final.

## Errores encontrados y corregidos

1. Una variable llamada authorization colisionaba con una palabra SQL reservada;
   se corrigió antes de publicar las migraciones nuevas.
2. async-exit-hook podía sustituir el fallo del hijo por código 0 al emitir beforeExit.
   Se propaga el código después de detener PostgreSQL y se comprueba el fallo 9.
3. Los fixtures iniciales asignaban varias paradas a la localidad de origen y
   producían varias opciones legítimas de embarque. Se diferenciaron las localidades
   intermedias y se añadió prueba de tramo local; no se deduplican puntos a ciegas.
4. Los registros antiguos sin geografía podían quedar sin vía para completar un
   vehículo parcialmente reservado. Se admite completar una sola vez metadatos NULL
   sin modificar índices/dirección/versión/plazas, antes de verificar el permiso.
5. RLS anterior exponía todo el catálogo de una asociación activa. La publicación
   ahora exige elegibilidad; tarifas históricas quedan limitadas al operador o reserva.
6. Los códigos libres de terminal no acreditaban geografía; la fila de destino usa
   referencias a localidades del mismo catálogo y asociación.

## Pendientes de Etapa 1

Revisión técnica independiente; autenticación/login público y recuperación; altas
administrativas seguras; retención y recuperación operativa; vínculos verificados de
menores/responsables y abordaje individual; ausencias/notificaciones; revisión del
manifiesto de salida y timeout de ofertas.
No se cargó catálogo oficial ni se verificaron documentos o permisos reales.
Se debe definir el alcance de rutas completas intramunicipales y el tratamiento de
reservas futuras tras una revocación: no se inventa su cancelación automática.
T12/T15/T16 (QR, conciliación, licencias/horarios contractuales) siguen pendientes.
El estado comercial actual es un interruptor técnico, sin módulo contractual/bancario.

Riesgos RLS pendientes: propietario/superusuarios pueden cambiar o eludir políticas;
sesiones ficticias no equivalen a login público; la conexión de aplicación no debe
tener privilegios de propietario. Geografía activa se comparte deliberadamente;
revisores operativos tienen acceso explícito a permisos de todas las asociaciones.
Falta política de retención para referencias/motivos y medir carga/planes de consulta
con un catálogo de tamaño nacional autorizado. Búsqueda es informativa y se revalida.

Sin pasajeros, ubicaciones personales, permisos legales ni pagos reales; sin
despliegues, servicios de pago, cambios a main ni acceso a otros repositorios.
No se avanzará automáticamente a Etapa 2.
