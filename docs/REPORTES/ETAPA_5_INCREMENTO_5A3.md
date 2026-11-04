# Etapa 5 — Incremento 5A.3

## Alcance y base

Repositorio `pepoj1046-svg/proyecto-nexo`, rama independiente
`desarrollo/etapa-5a3`, desde exactamente
`1119ae55c48d96b865e15734867aee4153675bec`. PR de revisión:
[PR #9](https://github.com/pepoj1046-svg/proyecto-nexo/pull/9), en borrador hacia
`desarrollo/etapa-5a2`. No se fusionan ni modifican los PR anteriores.

Se consultaron AGENTS.md, trufis-dev local, PLAN_ETAPA_5.md, contrato/informe 5A.2,
su auditoría final y contratos de etapas 1–4. No se afirma activación nativa de
skills que no figuran en el catálogo. La autorización de 5A.3 prevalece sobre el
alcance histórico 4A.6 de AGENTS.md; se conserva su aislamiento de proyectos.

Este documento fija implementación, evidencia y procedimiento. Al preparar su
commit, la validación web completa y CI están en curso. Sus resultados y el
dictamen efectivo se ratifican en el comentario **«Ratificación final 5A.3» del
PR #9**, identificando el SHA final y enlaces concretos. Este documento no atribuye
aprobación anticipada a esas ejecuciones ni autoriza producción.

## A — Diagnóstico reproducido

1. Los paneles de pasajero, chofer y administrador funcionaron sin desbordamiento
   horizontal a 320 px y zoom de layout al 200 %, sin violaciones axe en los estados
   inspeccionados. No se rehizo su diseño ni se añadieron mejoras solo estéticas.
2. Escape no cerraba el menú ni devolvía foco. El caso falló antes de corregir.
3. Tres regresiones sobre el manejador real useCommands demostraron cuerpo anidado
   mutable durante la espera de sesión, POST repetido tras recibo conocido con
   refresh fallido y entrega de respuesta tardía tras cambiar la cuenta.

Resultado diagnóstico: web 3 aprobadas / 1 fallida; unitarias 0 / 3. Logs privados
conservados. Playwright generó trazas temporales; no se presentan como archivos
retenidos si una ejecución posterior los reemplazó. El inventario de comandos y contratos
está en [ETAPA_5_MOVIL_Y_COMANDOS.md](../ETAPA_5_MOVIL_Y_COMANDOS.md).

## B — Implementación

- Navegación móvil cerrable con Escape desde el menú o su botón; retorno de foco,
  aria-expanded y enlace de salto conservados. No se convierte el menú en un modal.
- Comandos con cuerpo clonado y congelado antes de esperar red. Se conservan cuenta,
  clave, cuerpo y recibo recibido. Doble clic se serializa; no hay reenvío automático.
- Un recibo conocido sobrevive al fallo de actualización: la siguiente recuperación
  utiliza el recibo retenido y consultas, sin otro POST de actuación.
- Revalidación de cuenta antes de entregar resultados. Una respuesta tardía no
  entrega un código privado a otra cuenta; la recuperación exige la cuenta original.
- Recuperación manual visible y conservación del formulario en presencia, manifiesto,
  cuidados y códigos de responsables. Una intención diferente no reemplaza la que
  sigue pendiente en esos controladores.
- Lecturas revisadas ligadas al CSRF original y comprobación posterior de cuenta.
  El lote overview/manifiesto se publica después de validar identidad. Cookie B con
  CSRF A falla incluso cuando los controles exteriores observan A → B → A.
- Refresco del manifiesto sin desmontar el controlador durante recuperación de un
  recibo confirmado. Errores conservan el intento y ofrecen una lectura manual.
- Código de vinculación recuperado identificado como recibo original: una sesión
  nueva no renueva su capacidad ni sustituye la validación nativa del servidor.
- Formularios administrativos 4A.6 conservan su política explícita de rechazos
  definitivos y sus botones originales. Los tests de recibos conocidos se refuerzan
  para exigir cero POST adicionales y auditoría sin cambios.

No se rehizo ReservationAttempt 5A.2 ni se añadieron endpoints, migraciones,
dependencias, almacenes de pasajeros/asientos, colas offline o políticas nuevas.

### Extensión deliberadamente acotada

El indicador scopedRefresh solo se usa en operaciones, CarePanel,
PassengerRecovery, RecoveryConsole, DriverRescue y HandoffPanel: sus callbacks
ligan **todas** las lecturas a la sesión original y comprueban identidad antes de
publicar. Los demás mantienen las comprobaciones exteriores. No copiar ese
indicador a un callback no auditado.

Rescates, custodia, cancelaciones, decisiones y revisiones conservan sus contratos
nativos: no se interpreta una consulta como abordaje, salida o traslado seguro,
ni se generaliza otro procedimiento físico. Los controles adicionales de montaje
se aplican a los paneles identificados, no se promete una guardia universal nueva
para cualquier futura pantalla. La máquina de recuperación no concede permisos.

### Archivos y módulos afectados

- `apps/web/src/use-command.ts`, `CommandRecovery.tsx` y `private-read.ts`:
  recuperación RAM, separación recibo/consulta y lectura ligada a cuenta.
- `Operations.tsx`, `Care.tsx`, `Responsibles.tsx`, `Functional.tsx`,
  `Recovery.tsx` y `Safety.tsx`: integración individual de los paneles auditados,
  conservación de sus controladores y bloqueo de controles incompatibles.
- `main.tsx` y `styles.css`: teclado, foco, menú y contenedor de controles.
- `tests/use-command.test.mjs`, siete suites web nuevas, pruebas anteriores de
  recibos/consulta propia y helper de operaciones: regresiones y evidencias.
  Las suites separadas de permisos y solicitud de cancelación contienen casos
  anteriores íntegros, sin duplicarlos.
- `scripts/test-web.mjs` y los workflows de pruebas/CodeQL: registro de suites,
  base del PR y artefactos limitados a evidencias ficticias.
- Este informe y `docs/ETAPA_5_MOVIL_Y_COMANDOS.md`: diagnóstico y contratos.

No hay migraciones nuevas o modificadas, cambios de backend o dependencias.

## C — Pruebas y evidencia

Resultados ejecutados al preparar este informe:

| Prueba | Resultado verificado |
| --- | --- |
| Dirigidas unitarias: comandos, reservas 5A.2, orden de autenticación | 19/19, incluidas 8 nuevas |
| Dirigidas nuevas de interfaz móvil con PostgreSQL | 10/10 |
| Regresiones móviles relevantes previas: recorrido, responsables y permisos | 4/4 |
| Batería completa unitaria | 94/94 |
| Batería completa PostgreSQL real 18.4 | 408/408 |
| TypeScript y compilación web | Aprobados |
| Runner negativo y arranque/cierre de APIs locales | Aprobados dentro de test:all, exit final 0 |

La batería final web debe acreditar **86 casos por proyecto, 172 ejecuciones y
84 cierres de laboratorio**, además de apagado/reinicio. Estos son criterios de
completitud, no resultados atribuidos sin ejecución. La ratificación del SHA final
en el PR documenta sus resultados reales, el exit observado, la matriz Ubuntu/
Windows con Node 22/24 y CodeQL. No se suma una prueba repetida como definición nueva.

Se conservan huellas SHA-256 de 207 archivos funcionales para vincular las
pruebas locales al código publicado. Las ejecuciones intermedias no se atribuyen
al código posterior: tras estabilizar callbacks e interfaz se ejecutan de nuevo
las baterías completas, sin repetirlas por cambios exclusivamente documentales.

### Escenarios nuevos verificables

- Tres roles: acceso por teclado, etiquetas y orden de tabulación, 320 px, zoom de
  layout 200 %, axe WCAG 2 A/AA y 2.1 AA, sin overflow que impida operar.
- Escape desde navegación y desde el botón; foco visible y devuelto al control.
- BOARD real con respuesta perdida después de COMMIT: cuatro observados, seis plazas
  comprometidas por segmentos, sin salida inventada; reintento manual con idéntica
  clave/cuerpo y testigo SQL idéntico después del replay.
- VERIFY confirmado con consulta posterior 503: recuperación solo de lectura, sin
  otra actuación ni eventos duplicados en PostgreSQL.
- A → B → A durante consulta: control legítimo de adminU en su asociación y rechazo
  CSRF_REQUIRED de la consulta ligada a adminH. Recuperación de lectura con cuenta
  original y ningún POST adicional.
- Recibo privado tardío de un responsable: no se muestra a otra cuenta; login
  equivocado rechazado, recuperación original sin emitir otro código.
- Señal online sin reenvío; doble clic, cuerpo modificado, cambios de cuenta,
  caducidad y recibo conservado cubiertos por pruebas dirigidas.

Los testigos PostgreSQL son de solo lectura, independientes de la respuesta UI;
comparan reservas, miembros, tarifas/versiones, segmentos, movimientos, estado y
auditoría. Las bases y contraseñas de laboratorio son nuevas y ficticias.

### Fallos intermedios y correcciones

- Se reprodujo un 429 en el recorrido completo por lecturas redundantes de sesión.
  Se redujeron mediante lote ligado al CSRF y validación previa a publicación. El
  recorrido volvió a aprobar sin elevar 120/minuto, timeouts, retries ni esperas.
- Escenarios nuevos necesitaron sincronizar el login equivocado con su resultado
  observable, usar un actor realmente creado y no repetir una verificación ya
  registrada en el fixture compartido. Se corrigió el montaje del test.
- La primera pasada completa web se detuvo en una aserción antigua de tarifas que
  esperaba reenviar POST después de un recibo conocido. Se fortalecieron los casos
  de tarifas, flota, plataforma y permisos: cero POST de más, mismo estado/auditoría;
  se conserva el reenvío idéntico cuando realmente se perdió el recibo.
- Otra pasada detectó una regresión real de presentación: al denegar la consulta
  operativa de una cuenta autenticada sin ese rol, la UI conservaba el login en vez
  del estado autenticado y su cierre de sesión. Se restauró la publicación de la
  identidad comprobada para las consultas manuales, manteniendo separados permiso
  de negocio y datos privados. La consulta y RLS seguían devolviendo 403. Pasaron
  los casos existentes de permisos de configuración (2) y operación (1). Se repite
  la batería web y CI sobre el commit corregido; CodeQL de dad0aba es antecedente,
  no se atribuye como análisis del commit posterior.
- Se reprodujeron dos brechas adicionales en Mis reservas: la primera página GET
  no estaba ligada al CSRF original y el cierre de sesión del contenedor podía
  desmontar un intento pendiente de sus hijos. Se reutiliza ahora el POST paginado
  existente también en la primera página, con verificación posterior de identidad;
  actualizar, paginar y cerrar sesión comprueban la guardia compartida. Dos E2E
  nuevos fallaron antes de corregir y aprobaron después: A → B → A de reservas
  propias y recuperación exacta de un código con controles del contenedor bloqueados.
- El escenario independiente de permisos de plataforma agotaba el límite real de
  120 solicitudes tras otros dos escenarios del mismo clúster. Se trasladó íntegro
  a un laboratorio nuevo, conservando todas sus aserciones y roles. Las pruebas
  nativas de rate limit siguen vigentes; no se añade espera ni se cambia política.
  Los tres escenarios aprobaron con fixtures aislados.
- El panel de recuperación se ocultaba al limpiar el error antes de terminar el
  reintento. Ahora mantiene un estado de operación en curso y aria-busy hasta
  completarlo. Los E2E esperan el recibo o el error final observable antes de contar
  solicitudes; no confunden la desaparición transitoria de un mensaje con éxito.
- Mantener montado el manifiesto dejó controles secundarios habilitados durante
  una actualización retenida. Se bloquean con fieldset y las guardias de intención;
  se conservan los controladores y el botón manual de recuperación.
- Las pruebas largas de recepción y rescate expusieron consultas de sesión
  redundantes que agotaban 120/minuto. Se reutilizan la selección de la misma
  cuenta y los handoffs del snapshot recién autorizado; se consulta siempre el
  inventario actual y se comprueba identidad antes de publicar. No se amplían
  límites, tiempos ni reintentos. Pasaron terminal, carretera y recorrido completo.
- Un callback de traslado seguro no propagaba la sesión original: la guardia
  impedía actualizar el panel tras el recibo. Se transmite explícitamente a sus
  consultas autorizadas y se mantienen los controladores tras cambiar de estado.
- La consulta manual de una intención incierta conserva clave/cuerpo y no hace
  POST de actuación. Cuando hay recibo, recupera únicamente la lectura. La prueba
  de BOARD perdido comprueba también este camino y su testigo SQL sin cambios.
- Una ejecución dirigida encontró un 404 del bundle al abrir una cuarta sesión:
  la traza identificó que una compilación local paralela había eliminado el JS
  referenciado por el HTML servido. Fue un solapamiento del montaje de pruebas,
  no un rechazo de reservas o permisos. Se repitieron los casos afectados con el
  build estable, sin aumentar tiempos ni cambiar la aplicación. Se evita compilar
  fuentes distintas durante una ejecución web activa.
- La pasada completa llegó a condiciones y se detuvo por 429: sus dos escenarios
  acumulaban solicitudes en el mismo laboratorio. La traza del segundo recoge 78
  solicitudes API (44 de sesión), con dos 429 al consultar el resultado; el testigo
  SQL ya acreditaba CANCELLED, precio original y capacidad válida. Se separó
  íntegramente ese escenario en `conditions-request.spec.mjs`, con el mismo fixture
  de recorridos y testigo SQL. No se cambian contratos, límites ni aserciones.
- El caso de menores asumía que cada abordaje desmontaba y cerraba el detalle de
  integrantes. Al conservarlo montado para no perder intenciones, su siguiente
  clic lo cerraba y esperaba un botón oculto. La traza mostró ambos toggles y
  únicamente el primer BOARD. Se abre el detalle solo si está cerrado; se conservan
  las tres actuaciones, la revisión del acompañante, rectificación, ausencia y
  todos los testigos SQL, sin ampliar el timeout original de la prueba.
- La regresión de responsables aún pulsaba «Generar código» después de perder la
  respuesta; ese formulario queda bloqueado deliberadamente mientras existe una
  intención. Ahora usa el botón explícito «Reintentar únicamente la actuación
  original». Sigue exigiendo dos envíos con la misma clave, código distinto del
  intento anterior completado e historial exacto de vinculaciones y revocaciones.
- Se detectó disco casi lleno por clústeres efímeros anteriores. Se limpiaron 304
  clústeres locales PG18 detenidos anteriores a 5A.3, verificando raíz, versión,
  ausencia de PID/proceso. Se conservaron diez recientes, todos los activos y los
  logs/evidencias. No se borró trabajo versionado ni bases de otros proyectos.

### GitHub y artefactos

PR #9 apunta a desarrollo/etapa-5a2; los workflows anteriores no incluían esa base.
Se añadió el filtro de PR sin cambiar matrices, timeouts, retries ni permisos. Los
checkpoints documentales/dirigidos usan skip ci explícito para no repetir matrices;
el commit final sin esa marca requiere ejecución completa real.

Cada trabajo web guarda capturas y métricas ficticias de `.local/5a3-evidence/`
como artefacto `5a3-<sistema>-node<versión>-<proyecto>`, con retención técnica de siete
días. No se suben accesos, cookies, trazas, CSRF, conexión SQL ni contraseñas. La
ratificación enlaza los trabajos y CodeQL exactos; un check exitoso no sustituye
esta revisión ni demuestra seguridad universal.

## Compatibilidad y límites

001–041, src del backend, package.json y lock permanecen intactos respecto de la
base. No cambian reservas, tarifas, grupos, capacidad por segmento, filas, RLS,
auditoría ni custodia. PostgreSQL conserva la autoridad y el único inventario.

Solo RAM: cerrar, recargar forzosamente o perder proceso puede borrar la intención.
No hay persistencia ni recuperación 5A.4. Una operación ya autorizada puede terminar
tras caducar/revocarse sesión; no se promete rollback retrospectivo. Bloqueos por
permisos, versiones o política requieren consulta y revisión humana.

Zoom automatizado es CSS zoom de Chromium para reflow; no se presenta como prueba
manual de zoom nativo, lector de pantalla, Android/iOS/Safari o dispositivo físico.
Axe y pruebas dirigidas no son certificación de conformidad WCAG de toda la app.
Las advertencias de mantenimiento de acciones y la causa histórica desconocida del
fallo intermitente de configuración de rutas siguen documentadas; cualquier
reaparición se debe investigar, no ocultar con reintentos.

## Prueba sencilla en Windows

1. Checkout de desarrollo/etapa-5a3, Node 22/24 y dependencias fijadas con npm ci.
2. Ejecutar `npm run dev:web`. Usar solo URL 127.0.0.1 y archivo privado de accesos
   ficticios generado por el runner. No conectar DATABASE_URL reales.
3. En Chrome/Edge probar operativo0 en Mis reservas, adminH en Administración y
   driver5 en Chofer; elegir FICTICIO-OPERATIVO donde corresponda.
4. Recorrer Tab/Shift+Tab, formularios, enlace de salto y menú; Escape debe cerrar y
   devolver foco. Probar 320 px en herramientas de dispositivo y zoom nativo 200 %
   como revisión manual adicional, sin atribuir esa prueba manual a CI.
5. Para cortes deterministas después de COMMIT, usar las suites automatizadas:

```text
node scripts/test-web.mjs --suite=client-accessibility.spec.mjs,command-driver.spec.mjs,command-admin.spec.mjs,command-responsible.spec.mjs --project=mobile
node scripts/test-web.mjs --suite=client-accessibility.spec.mjs,command-driver.spec.mjs,command-admin.spec.mjs,command-responsible.spec.mjs --project=desktop
npm run test:all
npm run test:web
```

No intentar simular una confirmación desde el navegador: las suites interceptan
transporte después de una operación PostgreSQL real. Los runners cierran APIs y
PostgreSQL al terminar. Detener dev:web al concluir.

## Propuesta de cierre

Recomendar cierre técnico de laboratorio únicamente si la ratificación final del
PR acredita batería completa, CI y CodeQL del SHA entregado sin fallos pendientes.
Hasta entonces C queda pendiente, aunque A/B tengan evidencia dirigida. La revisión
final del propietario y cualquier auditoría externa no se sustituyen por este
informe del mismo asistente implementador. No se fusiona el PR, no se certifica
producción y no se inicia 5A.4 ni etapa posterior.
