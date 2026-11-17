# Resultados de Etapa 1

## Revisión final y cierre técnico del laboratorio

Base de revisión: `023a18f`. **23 unitarias y 66 integraciones PostgreSQL 18.4
aprobadas**, más probe del runner y smoke HTTP/PostgreSQL; código global 0.
Linux x64, Node 24.19.0, npm 11.9.0. Se preservan **001–011**, sin migración nueva.
G12 verifica las once mediante SHA-256; la reaplicación sobre una base poblada
con reservas confirmadas e identidades gestionadas conserva todas las tablas.

Soporte declarado alineado: Node **22.x o 24.x**, mínimo 22.0.0, con matriz
Ubuntu/Windows para ambas familias. Se corrige el rechazo de Origin/Sec-Fetch-Site
vacíos mediante regresión demostrada antes del arreglo. No se amplía el negocio.
[Acta técnica, evidencia CI y condiciones de cierre](CIERRE_TECNICO_ETAPA_1.md) ·
[Propuesta de Etapa 2, sin ejecutar](PROPUESTA_ETAPA_2.md).
El resultado técnico local se distingue de la aceptación formal del propietario
y de la preparación comercial/productiva.

## Evidencia del incremento de auditoría, HTTP local y mantenimiento (010–011)

**23 unitarias y 66 integraciones PostgreSQL 18.4 aprobadas**, cero fallos,
omitidas o canceladas, más probe del ejecutor y smoke del launcher HTTP/PostgreSQL.
Linux x64, Node 24.19.0 y npm 11.9.0. Migraciones 001–009 intactas.
Actualización poblada 001–009 → 010–011 conserva sesiones/roles/permisos/reservas
y las seis plazas por segmento. Prueba sintética de 20.000 localidades con índice
de prefijo y sugerencias concurrentes; no acredita catálogo oficial ni escala real.

[Informe de auditoría, resultados CI y cierre propuesto](REPORTES/ETAPA_1_AUDITORIA_HTTP.md) ·
[API local, recuperación y mantenimiento](HTTP_LOCAL_Y_MANTENIMIENTO.md).
Se propone revisión del cierre técnico del laboratorio, sin cierre formal,
despliegue ni inicio de Etapa 2.

## Evidencia histórica de localidades e identidad local (008–009)

**17 unitarias y 54 integraciones PostgreSQL 18.4 aprobadas**, sin fallos,
omitidas ni canceladas, más comprobación del fallo del ejecutor (9 preservado).
Entorno Linux x64, Node 24.19.0 y npm 11.9.0. Migraciones 001–007 intactas.
Se mantienen las 38 integraciones anteriores y se añaden 16; G09 ahora prueba
también la retirada concurrente de adhesión. Actualización poblada 001–007
verificada sin pérdida de sesiones, permisos, reservas ni capacidad por segmentos.

[Informe reproducible y estado CI](REPORTES/ETAPA_1_LOCALIDADES_IDENTIDAD.md) ·
[Contrato, fronteras y pendientes](LOCALIDADES_Y_AUTENTICACION.md).
El incremento permanece en Etapa 1: la autenticación local y el aprovisionamiento
no equivalen a un proveedor público, un despliegue o un piloto autorizado.

## Evidencia histórica del incremento geográfico 005–007

**13 unitarias y 38 integraciones aprobadas**, más comprobación del código de fallo
 del ejecutor. Migraciones 001–004 intactas; nuevas 005–007. Se verificaron búsqueda,
 tres coberturas, autorizaciones, RLS, concurrencia y actualización con reservas previas.
 Ver [reporte actual](REPORTES/ETAPA_1_GEOGRAFIA.md) y
 [modelo/contrato](GEOGRAFIA_Y_AUTORIZACIONES.md).

## Evidencia histórica del núcleo anterior

Validación local: **25/10/2026 (America/La_Paz)**. Rama: `desarrollo/etapa-1`.
Base de trabajo: `8207876a0614575e9304e855472af6ad9a0ffc2e`.
Antes de publicar se incorporó el avance documental `8d5c0836fdabb2854eb84e09baea606eb07d6c48`
con `COORDINACION_CHATGPT_CODEX.md`, leído y preservado sin cambios.
Se preservó también `DECISION_BUSQUEDA_PASAJERO.md`, añadido en `3f58e1d` durante
la revisión CI; no amplía el alcance ni activa una interfaz o servicios externos.
Entorno: Windows x64, Node.js 24.21.0, npm 11.19.0, PostgreSQL **18.4 real**.
No se usó emulación SQL. Datos y tokens generados exclusivamente para pruebas locales.

## Comandos y salida final

```text
npm install --no-fund
added 17 packages, and audited 18 packages
found 0 vulnerabilities

npm test
    tests 10
    pass 10
    fail 0
    cancelled 0
    skipped 0
    todo 0
npm run test:integration
    PostgreSQL real: 18.4
    tests 25
    pass 25
    fail 0
    cancelled 0
    skipped 0
    todo 0
exit code: 0

git diff --check
exit code: 0
```

Instalación repetible: `npm ci --no-fund`. El resultado de auditoría corresponde al
momento de instalación, no a una garantía de ausencia de vulnerabilidades futuras.
La CI existente ahora ejecuta esos mismos conjuntos en Ubuntu y Windows con Node 22;
su evidencia remota se consulta en los checks del [PR #1](https://github.com/pepoj1046-svg/proyecto-nexo/pull/1).
Este archivo acredita los resultados locales; no sustituye el estado de cada ejecución CI.
Tras la última defensa de aislamiento se volvió a ejecutar `npm run test:integration`:
**25/25 aprobadas**, cero fallos/omitidas/canceladas; código 0. Las 10 unitarias no
cambiaron y se mantienen aprobadas. Las migraciones ya publicadas se conservaron:
la defensa se incorporó como `004_isolation_guard.sql`.

## Evidencia cuantitativa de integración

- Carrera de **24 conexiones independientes** por la última plaza: **1 éxito, 23
  rechazos NO_CAPACITY**, ocupación `[6,6,6]` en el vehículo probado.
- **16 solicitudes simultáneas** con la misma clave: **1 grupo y 1 reserva**.
  Reutilizar la clave con otro payload produce `IDEMPOTENCY_CONFLICT`.
- Tramos: 6 personas en `[0,1)`, 4 en `[1,3)`, 12 competidores en `[1,2)`:
  **2 éxitos**, ocupación final **`[6,6,4]`**, nunca más de seis por segmento.
- **10 reintentos simultáneos** de salida: **1 evento DEPARTED**, posiciones de los
  vehículos incompletos intactas. Administrador y chofer ajeno no pueden registrar salida.
- **12 aceptaciones concurrentes** con claves diferentes: **1 evento OFFER_ACCEPTED**;
  no se multiplica el inventario. Cancelación contra reserva mantiene capacidad <=6.
- División voluntaria: falla el segundo bloque y no queda ninguna inserción parcial,
  acción exitosa ni evento huérfano; ambos bloques solo se confirman después de ambas
  aceptaciones. Se rechazan falta de consentimiento, menores declarados y expresos.
- Administrador A ve **3 vehículos**, B ve **1**, chofer ve **1 servicio/vehículo**.
  Pasajero ajeno no ve reservas ni puede cancelarlas; escritura directa, sesiones,
  membresías, helper interno e inventario quedan denegados al rol real de aplicación.
- Migraciones iniciales **4**, segunda aplicación **0**, ejecutores concurrentes **0/0**.
  DDL fallido revierte tabla y registro; alterar checksum se rechaza.
- Llamadas SQL directas con REPEATABLE READ o SERIALIZABLE se rechazan antes de
  escribir; el adaptador ejecuta las operaciones con READ COMMITTED.

## Correcciones detectadas durante desarrollo

- El dominio anterior usaba solo el primer segmento para salida y contaba retenciones
  como si fueran confirmaciones: ahora requiere manifiesto confirmado y admite recogidas
  posteriores; se agregaron regresiones unitarias y PostgreSQL.
- La asignación explícita podía proponer un vehículo posterior pese a existir uno
  compatible antes: ahora PostgreSQL valida el primer elegible también en las particiones.
- Una prueba de FK encontraba antes el índice de vehículo activo. Se creó un vehículo
  ficticio libre en B para demostrar la FK cruzada sin desactivar la otra garantía.
- El cierre inicial del binario en Windows no terminaba correctamente el ejecutor.
  Se reemplazó por `pg_ctl` y la ejecución completa finalizó con código 0.
- La primera CI Windows falló en `initdb` por permisos del directorio precreado
  bajo el usuario elevado del runner. Ahora `initdb` crea su propio subdirectorio;
  [la CI posterior aprobó Ubuntu y Windows](https://github.com/pepoj1046-svg/proyecto-nexo/actions/runs/40257663979).
- Se añadió una defensa del aislamiento para impedir snapshots antiguos mediante
  RPC directa, y `.gitattributes` fija LF para checksums consistentes entre sistemas.
- Se eliminó el DDL conceptual como instalador alternativo: las migraciones son la
  única fuente ejecutable y la documentación distingue diseño futuro de implementación.
- Se impide reutilizar una llegada antigua para solicitar una fila tras un viaje más
  reciente del vehículo o chofer; la regresión forma parte de la prueba de retorno.

## Pendientes al cierre del núcleo anterior (histórico)

T12, T15 y T16 no están implementadas ni aprobadas (QR/conciliación/licencias).
T10 solo valida paradas discretas autorizadas, no mapas/geografía real.
Faltan autenticación pública/HTTP, altas administrativas, validación real de vínculos
de menores, estados de abordaje por pasajero, ausencias, notificaciones y políticas
de retención. El plazo de ofertas y la interpretación del manifiesto requieren
revisión funcional. Consultar `SEGURIDAD_PENDIENTE.md` y `IMPLEMENTACION_ETAPA_1.md`.

Sin modificaciones a `main`, sin merge, sin despliegues ni recursos de pago y sin
acceso a proyectos ajenos. El PR permanece abierto para revisión.

Próximo incremento propuesto entonces: revisión técnica del PR y definición del emisor de
sesiones/altas administrativas, después adaptador HTTP con pruebas de autorización.
Decisiones del propietario antes de ampliar el piloto: plazo de ofertas, manifiesto
de salida con relevo de pasajeros por tramos y verificación de vínculos de menores.
Pagos, licencias, GPS y operación real conservan los bloqueos/autorizaciones originales.
