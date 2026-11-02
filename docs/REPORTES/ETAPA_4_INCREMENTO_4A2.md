# Trufis Bolivia — Etapa 4, Incremento 4A.2

Fecha: 02/11/2026, America/La_Paz. Solo PostgreSQL local y datos ficticios.
Base comprobada `dacb017ae6ffca3a38f94cc6931b2927a332ca19`, árbol inicialmente
limpio en `desarrollo/etapa-4`, coincidente con GitHub. [PR #5](https://github.com/pepoj1046-svg/proyecto-nexo/pull/5) abierto en borrador
hacia `planificacion/etapa-4a`; sin fusión. PR #3 y ramas anteriores se conservan.

## Entrega y validez

Administración de DRIVER existentes, contacto LAB e historial, sin elegir viaje.
El commit final y resultados de CI de este informe se ratifican en el
[registro de verificación de 4A.2](https://github.com/pepoj1046-svg/proyecto-nexo/pull/5#issuecomment-6576286717).
No se modifica el registro ratificado de 4A.1 ni se usa su CI para aprobar código
nuevo. Mientras el registro de 4A.2 indique pendiente, la aprobación de plataformas
permanece pendiente. Se actualiza ese registro después de CI, sin crear un commit
documental posterior distinto del código verificado.

## Funciones completadas y reutilización

- Seleccionar un DRIVER ya existente desde el directorio de 4A.1, incluso sin viajes.
  Consulta de estado, identidad técnica mínima, impedimentos y revisión actual.
- Revocar/restaurar con motivo ficticio y confirmación explícita. SQL valida
  sesión, asociación y ámbito completo; no altas ni cambios de identidad global.
- Bloquear revocación/restauración si conserva fila, servicio o custodia; también
  incidentes/recepción pendientes de asociación por historia ambigua. Resultado
  aplicado o revisión necesaria, actor y motivo auditados. No traslados sintéticos.
- Contacto técnico exclusivamente LAB-* con confirmación, consultable y editable
  reutilizando set_association_contact. No teléfono ni verificación legal/comercial.
- Historial paginado de DRIVER/contacto, más de 50 registros, mínimo y aislado.
  Fechas visibles y orden técnico por UUID, sin reescritura histórica.
- Carga, vacío, errores comprensibles, teclado, escritorio/móvil y limpieza de
  datos al cambiar asociación/cuenta. Interfaz y API protegen acciones sensibles.
- Reutilizar useCommands, gateway, sesiones/CSRF, recibos y auditoría. Un POST
  definitivo rechazado permite nueva consulta/intención; pérdida de respuesta o
  fallo del refresco después del commit conserva cuerpo y clave originales.

No se modifica inventario, tarifa, precio pactado, reservas, seis plazas por
segmento, grupos, presencia, movimientos, turno directo, aceptación de recogidas,
búsqueda origen/destino, menores o custodia. Los hashes de tablas independientes
se comparan excluyendo únicamente las tablas de administración/autenticación que
deben cambiar; esas modificaciones permitidas se verifican por separado.

## Arquitectura y archivos

| Archivo | Responsabilidad |
|---|---|
| database/migrations/035_existing_driver_administration.sql | Barrera de seguridad, bloqueos y autoridad reales; endurece set_driver_membership, CARE y contacto; RPC de contexto/comando/historia y helpers privados. |
| src/db/web-driver-admin-service.mjs | Cuerpos cerrados, claves/intención, runtime nexo_app, transacciones RW o READ ONLY y parámetros SQL. |
| src/http/web-gateway.mjs | Cuatro handlers privados fijos /api/driver-admin/* con wrapper autenticado/CSRF y errores seguros. |
| apps/web/src/DriverAdministration.tsx, Directory.tsx | Formularios e historial autónomos integrados, sin selector de viaje. |
| apps/web/src/private-api.ts, use-command.ts | Error HTTP tipado y retiro optativo de intención rechazada solo en 4A.2; compatibilidad del resto de formularios preservada. |
| scripts/seed-web-demo.mjs | Historia ficticia previa, DRIVER sin viajes y fixture histórico sin custodia para el control heredado. Solo setup antes del listener. |
| scripts/test-web.mjs | Dos suites nuevas aisladas; mismos límites, retries y ciclos de apagado/reinicio. |
| tests/driver-admin.test.mjs | Dos unitarias de contratos cerrados, datos ficticios y claves. |
| tests/integration/postgres.test.mjs | Veinte casos nuevos 4A2-01–20, expectativas de 035 e historia segura del caso T8B13. |
| tests/web/driver-administration.spec.mjs, driver-admin-races.spec.mjs | Ocho E2E nuevos en total, cuatro por dispositivo. |
| tests/web/support/directory-evidence.mjs, care-accounts.spec.mjs | Testigo SQL READ ONLY y éxito heredado sobre servicio histórico sin custodia. |
| AGENTS.md, README.md, planes y contrato | Autorización 4A.2, ejecución y límites, conservando informes anteriores. |

## Migraciones, permisos y concurrencia

**001–034 intactas; nueva035.** Sin tablas de negocio adicionales, DML de migración,
backfill, inventarios paralelos ni permisos de provisión. Instalación limpia,
actualización poblada desde034, reaplicación vacía y checksums previos comprobados.
[Contrato detallado](../ETAPA_4_ADMINISTRACION_CHOFERES.md).

ASSOCIATION_ADMIN activo y alcance completo, derivado de sesión SQL. Se niegan
ADMIN ajeno/limitado, pasajero, DRIVER y REVIEWER. UUID de body no acredita rol.
Helpers sin EXECUTE para PUBLIC/runtime y search_path fijo. El contrato legado
nativo conserva su UPSERT para compatibilidad confiable; el nuevo RPC web exige
existencia bajo bloqueo, sin exponer alta o un pool de provisión.

Orden de rutas por UUID antes de identidad, sesión y membresías; contacto añade
asociación después de rutas. CARE deja de bloquear una ruta antes de todas las
rutas. Revalidación tras espera, incluida caducidad clock_timestamp, autoridad
estabilizada y reautorización de recibos. Sesión revocada no se restaura con DRIVER.

Revisión esperada basada en estado e historia de DRIVER impide doble consumo y
ABA revocar/restaurar. Recibo original antes de comparar estado esperado, pero
después de autorizar de nuevo. La nueva RPC puede persistir una revisión bloqueada
sin tocar membresía; fallo de auditoría revierte estado, eventos y recibo.
Consultas/historia READ ONLY, cursores ligados a sesión, consulta, permisos y datos.

## Hallazgos de los dos auditores

Ambos subagentes genéricos trabajaron solo en lectura, sin pruebas, archivos,
commits o red; el principal fue único editor y ejecutor. Sin carga automática TOML.

**e4a2_seguridad:** identificó la falta de barrera en la primitiva heredada,
posible inversión de locks con CARE, vencimiento durante espera, fila residual al
restaurar y pérdida del chofer original en sustituciones históricas. Se añadieron
las guardas compartidas y el bloqueo conservador de asociación. La segunda revisión
estática focalizada no encontró defectos nuevos demostrables; no certifica producción.

**e4a2_pruebas:** pidió conservar pruebas antiguas cambiando el caso feliz inseguro
por historia sin custodia, verificar respuesta perdida y tabla independiente.
Detectó que una intención rechazada por STALE_DRIVER_ACCESS dejaba el formulario
bloqueado: se distingue rechazo del POST frente a error de refresco. La regresión
usa refresco **403 posterior a commit**, además de pérdida real de respuesta,
para demostrar que no se retira indebidamente una clave ya comprometida.

## Resultados de pruebas

Batería final local **473 casos únicos aprobados**: **66 unitarias**,
**311 PostgreSQL reales** y **96 E2E** (48 escritorio y48 móvil).
Cero fallos u omisiones en las baterías finales. Los443 anteriores se verificaron
de nuevo, con el caso de acceso heredado ajustado al contrato seguro; se añaden
30 casos: dos unitarias,20 PostgreSQL y ocho E2E. No se suman repeticiones.

`npm run test:all` terminó con código0: TypeScript/web, propagación real de fallo
del runner, smoke de identidad HTTP y listener de negocio aprobados.
`npm run test:web` terminó con96 aprobados en44 laboratorios aislados; cierre de
listener/PostgreSQL en todos, SIGINT real y reinicio sin accesos o datos anteriores.
Fuentes congeladas verificadas por hash entre las dos baterías.

Entorno local observado: Debian13, Node24.19.0, PostgreSQL18.4,
Playwright1.64.1, Chromium154.0.8037.57, pg8.23.1 y TypeScript5.9.3.
Windows/Ubuntu y Node22 se ratifican separadamente en CI del commit publicado.


Pruebas dirigidas: 20 casos PostgreSQL nuevos, H05/T8B13/Q15 de compatibilidad,
dos unitarias nuevas, E2E de directorio/permisos/contacto/historia y control heredado
en escritorio/móvil; regresión de intención obsoleta y refresco403 en ambos dispositivos.
No se suman repeticiones o entornos como casos únicos nuevos.

Comandos reproducibles:

```text
node --test tests/driver-admin.test.mjs
node scripts/test-postgres.mjs --test-name-pattern=4A2
node scripts/test-web.mjs --suite=driver-administration.spec.mjs,driver-admin-races.spec.mjs
npm run test:all
npm run test:web
```

### Fallos intermedios conservados

- PG dirigido: 22/23 pasaron; el nuevo test HTTP esperaba dos401 usando el mismo
  handle después de que el primer rechazo lo eliminara. La segunda petición caía
  correctamente en403 CSRF. La prueba ahora obtiene contexto anónimo/CSRF nuevo y
  exige401 AUTHENTICATION_REQUIRED en ambos endpoints. Afectado repetido1/1.
- E2E dirigido: dos ejecuciones de seis casos juntados al directorio terminaron
  cada una con3 aprobados/3 fallos. Hubo una espera de datos ausente en el selector
  del test y exceso del límite120 solicitudes/min del laboratorio. Se añadió la
  espera por estado real y se separaron suites/clústeres; **sin aumentar límites,
  sleeps, timeouts o retries**. Tras aislamiento aprobaron escritorio y móvil.
- Primera batería integral: 66 unitarias aprobadas; PostgreSQL310/311. La aserción
  histórica de número de migraciones aún decía34; se actualizó a35, manteniendo
  hashes e integridad. Caso afectado1/1 antes de repetir la batería final.

La revisión automática de publicación rechazó inicialmente un blob de pruebas
al interpretar la autorización como solo4A.1. Tras releer la autorización expresa
de4A.2 del adjunto y comprobar el diff y sus hashes, la misma acción fue aceptada.
No se cambió el alcance ni se eludió la revisión; todavía no se había movido la rama.

Las ejecuciones fallidas no se presentan como verdes ni se ocultan con el resultado
posterior. No se atribuye a 4A.2 una corrección de los fallos de transporte históricos
de 4A.1; su causa no fue demostrada y permanece documentada en su registro.

## Evidencias, CI y CodeQL

[Capturas, procedencia y huellas](evidencias/etapa-4-4a2.json). Seis capturas de
membresía, bloqueo por revisión e historial en escritorio/móvil; solo identificadores
y etiquetas ficticios, sin credenciales, cookies o trazas privadas. Testigo SQL
independiente READ ONLY y comparación de tablas operativas, con excepciones explícitas.

CI conserva Ubuntu/Windows × Node22/24. Los filtros de 4A.1 ya cubren esta rama/PR;
no se modifican workflows, límites o retries para 4A.2. Resultados de push/PR y
CodeQL **del commit final** en el [registro ratificado](https://github.com/pepoj1046-svg/proyecto-nexo/pull/5#issuecomment-6576286717).
CodeQL JS/TS no certifica SQL/RLS ni prueba que se cerraron alertas históricas.

[Membresía escritorio](evidencias/etapa-4-4a2/membresia-desktop.png) · [Membresía móvil](evidencias/etapa-4-4a2/membresia-mobile.png).

[Revisión escritorio](evidencias/etapa-4-4a2/revision-desktop.png) · [Revisión móvil](evidencias/etapa-4-4a2/revision-mobile.png).

[Historial escritorio](evidencias/etapa-4-4a2/historial-desktop.png) · [Historial móvil](evidencias/etapa-4-4a2/historial-mobile.png).

## Procedimiento sencillo en Windows

Con Node22/24, checkout actualizado de desarrollo/etapa-4 y solo laboratorio:

```powershell
npm ci --no-fund
npx --no-install playwright install chromium
$env:NEXO_WEB_ADMIN_DIRECTORY_FIXTURE='1'
npm run dev:web
# Ctrl+C al terminar
Remove-Item Env:NEXO_WEB_ADMIN_DIRECTORY_FIXTURE
```

Abrir exclusivamente la URL127.0.0.1 indicada; leer accesos del archivo privado de
esa ejecución. Entrar como admin → Administración → directorio → Horizonte →
Choferes y membresías. Sin elegir vehículo, gestionar FICTICIO-DIRECTORIO-001:
consultar, completar motivo/confirmación, revocar y restaurar. Ver historial.
driver5 conserva servicio activo: el formulario exige revisión y bloquea el cambio.
En «Gestionar contacto e historial de asociación», guardar LAB-PRUEBA, consultar
las páginas de historia y cambiar de asociación para comprobar limpieza.
adminH limitado no obtiene estos controles; driver5/operativo0 no adquieren permisos.

La semilla es setup confiable antes del listener, no un alta implementada. No se
afirma prueba manual Windows por el agente: la evidencia Windows procede de CI.
Para automatizar: los comandos E2E anteriores crean y cierran su propio laboratorio.

## Límites, riesgos y pendientes de 4A.3

La retirada con servicio/fila o custodia pendiente requiere contrato humano aprobado.
El bloqueo conservador puede afectar otros choferes de la asociación cuando falte
evidencia histórica precisa. No se inventa su liberación. Serialización por todas
las rutas y huellas de historia requieren evaluación de carga antes de producción.

Pendientes: ADR de autoridad/bootstrap de plataforma, primer/último ADMIN,
solicitud/alta inicial, facultades del revisor frente al administrador general,
identidad real, políticas de custodia, retención/exportación y recuperación comercial.
El native UPSERT legado y el setup propietario no equivalen a un instalador
comercial autónomo. No hay plazos legales, sanciones o costes nuevos inventados.

4A.2 no implementa 4A.3, CRUD general, edición de rutas/tarifas, GPS, pagos,
devoluciones, avisos externos o despliegue. No declara cerrada toda la Etapa4
ni habilitado el sistema para producción. El PR permanece abierto para revisión.
