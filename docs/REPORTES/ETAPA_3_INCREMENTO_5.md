# Etapa 3, incremento 5 — Consolidación operativa web de laboratorio

30/10/2026, America/La_Paz. Exclusivamente `pepoj1046-svg/proyecto-nexo`,
`desarrollo/etapa-3`, desde `dc07bbd472841f5e28b1bb6efcae046ac5fc654f`.
Árbol inicialmente limpio, origen/rama y PR #3 comprobados. La instrucción del
propietario autoriza este incremento y sustituye la restricción histórica de AGENTS;
no autoriza el incremento 6. Se utiliza `.agents/skills/trufis-dev/SKILL.md` local.
Se consultaron AGENTS, requisitos, arquitectura/modelo, seguridad/pruebas, contratos
vigentes de Etapa 2 y reportes/evidencias de los incrementos 1–4 de Etapa 3.

## Auditoría previa: conservar y conectar

| Área | Ya implementado y conservado | Pendiente identificado para este incremento |
| --- | --- | --- |
| Administración | Selección de servicios autorizados, manifiesto, verificación presencial, movimientos, confirmación de incidencias, consentimiento/reasignación y rescates | Directorio paginado por ruta/estado, presentación explícita de filas/histórico, registro presencial con precio confirmado y rehabilitación simulada permitida por el núcleo |
| Chofer | Ofertas aceptables, manifiesto grupal/individual, abordajes, descensos, recogidas, salida explícita, MAIN_START, llegada y traslado seguro de rescate | Rechazo explícito de ofertas y retorno voluntario a una fila compatible del destino tras los descensos |
| Pasajero | Búsqueda origen/destino, solicitud 1–6 juntos, reserva propia, Ya llegué, progreso, incidencias, consentimiento y cambios de vehículo | Cancelación explícita de su propio grupo; invalidar consultas anteriores tras cambios de asignación/estado y proteger de respuestas tardías al cerrar/cambiar sesión |
| Transporte | Cookie/CSRF, sesiones SQL revocables, RLS, límites loopback y errores seguros | Atender observación CodeQL sobre control de CSRF y probar cada ruta privada registrada |

No se reconstruye el motor de inventario, fila, reserva, despacho, sustitución o
rescate. Las lecturas acotadas del directorio reutilizan `web_trip_snapshot` y sus
segmentos, sin conceder EXECUTE sobre helpers privados ni publicar manifiestos en
las tarjetas. El directorio muestra servicios/fila/histórico, sin certificar que una
unidad sea apta para un rescate; esa elegibilidad sigue en los RPCs del incremento 4.

## Implementación

- Adaptador local `web-terminal-service.mjs`: contratos cerrados para directorio,
  contexto/cotización/registro presencial, opciones de retorno y comandos específicos.
  `source=WALK_IN` se fija en servidor y se conserva el contrato de precio y grupo.
  La reserva presencial queda pendiente de aceptación del chofer, sin inventar BOARD,
  verificación de identidad ni pago. Comparte inventario con APP bajo los mismos locks.
- Comandos de rechazo/cancelación delegan en `respond_offer`/`cancel`. El endpoint
  de pasajero solo admite APP propia; la cancelación afecta al grupo conforme al
  núcleo y no sustituye una solicitud de devolución ni actúa por ausencia.
- Retorno voluntario: `026_web_queue_return.sql` añade una envoltura mínima sobre
  `request_queue`: actor/scope actuales, misma clave/payload nativos, orden de locks
  de ambas rutas y cero personas observadas a bordo. La incorporación y posición al
  final las calcula el núcleo. Un reintento conserva el recibo incluso tras un cambio
  operativo posterior; revocación de autoridad sigue rechazando acceso. 001–025 intactas.
- Rehabilitación simulada: comando sobre `restore_vehicle`, confirmación explícita y
  precondiciones nativas. No certifica mecánica, crea carreras ni devuelve unidades
  retiradas a fila. La sustitución terminal ya realizada queda fuera de rehabilitación
  cuando el contrato nativo no admite ese estado; requiere procedimiento posterior.
- Interfaz móvil: controles con etiquetas, confirmaciones específicas, navegación
  paginada, estados pendientes/errores y consultas manuales, sin GPS ni ETA.
- Gateway: tablas fijas de handlers. Todos los POST privados se construyen con el
  mismo wrapper CSRF y los autenticados añaden la comprobación de sesión. Los paths
  no habilitan invocación dinámica de métodos ni eliminan la puerta de seguridad.

## Archivos principales

| Capa | Archivos y propósito |
| --- | --- |
| Interfaz | `apps/web/src/Terminal.tsx`, `Functional.tsx`, `Operations.tsx`, `Recovery.tsx`: nuevos flujos y conexión de paneles existentes |
| Transporte/estado de interfaz | `private-api.ts`, `use-command.ts`, `main.tsx`, `styles.css`: errores, intención de reintento, etiquetas y controles móviles |
| Servidor local | `src/db/web-terminal-service.mjs`, `web-recovery-service.mjs`, `src/http/web-gateway.mjs`: contratos, permisos, lecturas acotadas y CSRF |
| PostgreSQL | `database/migrations/026_web_queue_return.sql`: envoltura de retorno, sin modificar migraciones previas |
| Regresión | `tests/web-terminal.test.mjs`, `tests/integration/postgres.test.mjs`, suites web `terminal-sales`, `terminal-return`, `functional` y `app` |
| Ejecución | `scripts/test-postgres.mjs`, `scripts/test-web.mjs`, `.github/workflows/etapa-1-tests.yml`: selección local dirigida, nuevos laboratorios y presupuesto de job |
| Documentación | `AGENTS.md`, `README.md`, arquitectura, seguridad, este informe, evidencia JSON y seis capturas ficticias |

## Observación de CodeQL y regresiones

Se revisó el comentario de CodeQL del PR #3 (`discussion_r4425161756`,
`js/user-controlled-bypass`, gateway). La selección anterior de rutas públicas y
privadas dificultaba reconocer estáticamente la puerta de CSRF. Las mutaciones
existentes ya la exigían; no se afirma haber demostrado una explotación previa.
La refactorización hace explícitos los handlers protegidos, conserva el catálogo
anónimo de solo lectura y añade comprobaciones para cada POST privado, rutas
desconocidas/sufijos, sesión revocada y campos de autoridad falsificados.
En la base `dc07bbd`, el job de análisis terminaba correctamente, pero el check de
resultados **CodeQL** marcaba **1 alerta nueva de severidad alta**. Se comprueban
ambas cosas en esta entrega: ejecución del analizador y check de resultados; no se
equipara un workflow verde con ausencia de hallazgos. Resultado de esta entrega:
[analizador final sobre `12bec7e`](https://github.com/pepoj1046-svg/proyecto-nexo/actions/runs/41093021877)
aprobado, incluido el paso de análisis. El check separado de resultados **CodeQL**
(`124192029702`) también aprobó: «No new alerts in code changed by this pull request»,
**cero anotaciones**. Los análisis de los dos commits funcionales anteriores también
aprobaron. Esto no afirma ausencia de toda vulnerabilidad ni sustituye una auditoría externa.

Los primeros ensayos dirigidos detectaron una consulta nueva a un helper privado
(`live`) y errores de preparación/aserción de pruebas. Se corrigió la consulta
reutilizando el snapshot existente, sin ampliar permisos. Los fallos intermedios
se conservan en logs privados y no se contabilizan como aprobados.

## Pruebas y resultados

Versión funcional final **`12bec7ea3a51ea70a17d5d15c1d85b96b9b8ec52`**, descendiente
de `ec9d7d9` y `f4faf7d`. La entrega documental posterior no cambia este código.
Sobre esa versión se ejecutaron nuevamente ambas baterías completas:

| Batería | Resultado ejecutado |
| --- | --- |
| `npm run test:all` | **49/49 unitarias + 220/220 integraciones**, salida 0 |
| `npm run test:web` | **60/60 Chromium**, 30 escritorio + 30 móvil, salida 0 |
| Compilación/TypeScript | Aprobada, incluida en ambos comandos |
| Probes y smokes | Error 9 del hijo preservado; HTTP/negocio cerrados; SIGINT real, puertos cerrados y reinicio sin sesiones/credenciales/reservas anteriores |

Total: **329 casos**, conservando los **315 anteriores** y añadiendo 14. No se suman
las repeticiones como nuevos casos. Sin casos omitidos en las baterías finales.
Logs privados finales: `.local/i5-release-all.log` y `.local/i5-release-web.log`.
Node **24.19.0**, PostgreSQL **18.4 real**, Chromium **154.0.8037.57**, Playwright
**1.64.1**. Viewports 1440×1000 y móvil emulado 390×844; contextos adicionales de los
roles heredan la emulación del dispositivo. Axe WCAG 2 A/AA y 2.1 AA y controles
nuevos de tamaño táctil, sin atribuir validación manual de Windows o de campo.

Antes de la batería completa aprobaron los diez casos PostgreSQL dirigidos (Z01–Z08,
G12 y R08), el chequeo ACL y los dos validadores unitarios nuevos. El recorrido web
dirigido aprobó **14/14**, y el ajuste táctil **4/4**, incluidos cierres/reinicio.
La primera ejecución general web encontró una expectativa de texto anterior a la
tarjeta «Ámbito autorizado / Sesión requerida». Se actualizó esa aserción sin quitar
las comprobaciones de acceso privado; **28/28** casos afectados aprobaron y se repitió
la batería completa. La revisión visual posterior detectó filtros demasiado bajos;
se ajustaron a 44 px y se verifican sus dimensiones en ambos dispositivos.
El directorio inicialmente omitía las banderas nativas de salida y presentaba una
unidad completa como En fila. Ahora reutiliza `operationalLabel`, fase y elegibilidad
del snapshot para distinguir fila, completo/salida pendiente y viaje, sin inferir
movimientos ni exigir seis personas observadas; se añadieron aserciones SQL y E2E.

Se ejecutan primero pruebas dirigidas, después `npm run test:all` y
`npm run test:web`, con PostgreSQL local real y Chromium, escritorio/móvil.
No se sustituyen los casos anteriores. Los nuevos comprueban inventario APP/presencial,
reintentos, concurrencia, cancelación/rechazo, privacidad de sesión, filas/retorno,
rehabilitación y permisos por asociación/terminal.

CI Ubuntu/Windows × Node 22/24 de la versión final:
[ejecución 41093034472](https://github.com/pepoj1046-svg/proyecto-nexo/actions/runs/41093034472).
Ubuntu/22, Ubuntu/24 y Windows/24 aprobaron **49 + 220 + 60 casos cada uno**, con
sus logs de cierre y reinicio contrastados. Windows/22 agotó inicialmente los 90 s
del consentimiento de traslado en `recovery-transfer.spec.mjs`, esperando la respuesta
al comando; no se recibió esa respuesta en ese intento. Se solicitó repetir ese job
sobre el mismo commit, sin alterar timeouts, aserciones ni añadir reintentos a los tests.
La repetición (`124197329722`) aprobó **49 + 220 + 60**, incluidos cierre y reinicio;
la matriz final queda **4/4 aprobada**. Se contrastaron los cuatro logs finales.
El timeout no se reprodujo. No se atribuye una causa concreta sin evidencia ni se
presenta el primer intento como aprobado.

| Entorno de CI | Unitarias | PostgreSQL | Chromium | Resultado final |
| --- | --- | --- | --- | --- |
| Ubuntu / Node 22 | 49 | 220 | 60 | Aprobado |
| Ubuntu / Node 24 | 49 | 220 | 60 | Aprobado |
| Windows / Node 22 | 49 | 220 | 60 | Aprobado tras la repetición registrada |
| Windows / Node 24 | 49 | 220 | 60 | Aprobado |

Matrices anteriores: `ec9d7d9` aprobó 4/4 con sus cuatro logs contrastados
([41088045280](https://github.com/pepoj1046-svg/proyecto-nexo/actions/runs/41088045280)).
En `f4faf7d`, Windows/24 falló inicialmente con `page.goto: net::ERR_NO_BUFFER_SPACE`
al abrir Chromium; dominio/PostgreSQL y los otros 13 casos de ese archivo aprobaron.
Se solicitó repetir ese job al terminar el workflow: el mismo commit aprobó después
**49 + 220 + 60**, y la matriz terminó **4/4 aprobada**
([41089823316](https://github.com/pepoj1046-svg/proyecto-nexo/actions/runs/41089823316)).
Se conservan ambos fallos intermedios y sus resultados, sin sumarlos como casos nuevos.

[Evidencia SQL mínima y hashes de capturas](evidencias/etapa-3-incremento-5.json),
con cuatro estados finales de las pruebas (dos escenarios × dos dispositivos).
Las posiciones del retorno se comprueban mediante recibo nativo y directorio;
el testigo SQL actual no proyecta `position_no`. No se inventa esa columna en la evidencia.
Las dos capturas del directorio se tomaron adicionalmente con Chromium en otro
laboratorio nuevo del mismo código, sin sumarlas como casos nuevos.

- [Directorio administrativo, escritorio](capturas/etapa-3-incremento-5-directorio-desktop.png).
- [Directorio administrativo, móvil](capturas/etapa-3-incremento-5-directorio-mobile.png).
- [Reserva presencial con importe conservado](capturas/etapa-3-incremento-5-presencial-desktop.png).
- [Reserva propia cancelada, móvil](capturas/etapa-3-incremento-5-cancelacion-mobile.png).
- [Rehabilitación simulada resuelta](capturas/etapa-3-incremento-5-rehabilitacion-desktop.png).
- [Nueva entrada voluntaria sin salida automática](capturas/etapa-3-incremento-5-retorno-mobile.png).

Capturas originales, solo datos ficticios. Configuración SQL, archivos de acceso,
logs y trazas privadas permanecen en `.local/`, excluidos de Git.
La matriz conserva ambos sistemas y familias Node; el presupuesto del job pasa de
15 a 20 minutos por los cuatro laboratorios E2E aislados adicionales. Los timeouts
de cada laboratorio, las pruebas anteriores y los checks de cierre se conservan.
No se contrata ningún proveedor ni se inicia una infraestructura de pago.

## Reproducción sencilla en Windows

Node **22.x o 24.x**, npm y rama `desarrollo/etapa-3`. No hace falta instalar
PostgreSQL ni Docker. En PowerShell, dentro del repositorio:

```powershell
npm ci --no-fund
$env:NEXO_WEB_RECOVERY_SCENARIO = "DEFAULT"
npm run dev:web
```

Abrir `http://127.0.0.1:<puerto>` impreso. En una segunda consola usar
`Get-Content -Raw "<ruta de accesos indicada>"`. Son cuentas/contraseñas ficticias
nuevas en cada arranque; no copiarlas al repositorio. Usar tres perfiles/contextos
independientes de navegador. El procedimiento es una guía reproducible; la prueba
de Windows ejecutada se identifica en CI, sin atribuir una prueba manual de teclado.

1. Pasajero **terminal0**, `/pasajero`: tiene cuatro plazas confirmadas, Bs 140,
   en **FICTICIO-WEB-0-0**. Consultar presencia y viaje, sin registrar abordaje.
2. Administrador **adminH**, `/administracion`: elegir esa unidad. Consultar
   «Vehículos y filas», filtrar por ruta/estado. Los números son máximos por segmento
   y hechos observados; no se muestran vehículos de otra asociación/terminal.
3. «Preparar reserva presencial», terminal Yacuiba → Villa Montes, **dos plazas**.
   «Revisar importe presencial»: Bs 70. Confirmar recorrido/importe y registrar.
   La referencia aparece pendiente del chofer; ahora hay seis plazas comprometidas,
   cuatro confirmadas y cero observadas a bordo, sin salida automática.
4. Chofer **driver0**, `/chofer`, misma unidad: actualizar. La oferta presencial
   permite aceptación existente o rechazo explícito del grupo pendiente. Para repetir
   la secuencia automatizada, marcar el rechazo y ejecutarlo. Las dos plazas se liberan
   según el núcleo. No se crean recogidas, movimientos ni una asignación automática.
5. Pasajero: solicitar «Cancelar mi grupo» con confirmación explícita. Verificar
   Cancelada, misma referencia/Bs 140 e historial. El contacto/devolución no se simulan
   como dinero procesado. La cancelación con personas abordadas es rechazada por SQL.
6. Chofer reporta avería; administrador actualiza y confirma. En «Incidencias» elegir
   esa unidad, marcar verificación ficticia de reparación y registrar rehabilitación.
   Se elimina el bloqueo conforme al núcleo; sigue en fila, sin pasajeros inventados
   ni salida automática. Esta declaración no certifica una reparación real.

Para retorno, detener con Ctrl+C y arrancar un laboratorio independiente:

```powershell
$env:NEXO_WEB_RECOVERY_SCENARIO = "ROAD"
npm run dev:web
```

1. **driver5**, `/chofer`, **FICTICIO-OPERATIVO**: la fixture nativa está en el Paso
   del Chaco, con seis observados a bordo y viaje principal iniciado. Registrar
   llegada final a Villa Montes; todavía deben registrarse ambos descensos.
2. «Consultar fila de destino» informa que faltan descensos. Registrar el descenso
   del grupo de cuatro y del grupo de dos en el destino. Consultar de nuevo, elegir
   **Villa Montes → Yacuiba**, marcar la solicitud voluntaria e incorporarse.
3. La nueva entrada queda al final, **posición 2**, detrás de la unidad ficticia
   existente. Estado En fila, cero reservas y cero personas observadas, sin salida.
   La carrera anterior permanece COMPLETED y conserva grupos, importes y descensos.
4. **adminR** tiene alcance en ambos sentidos: consultar directorio, filtrar retorno
   y comprobar las posiciones 1/2. «Página siguiente» permite revisar el histórico.
   **operativo0**, `/pasajero`, mantiene su reserva finalizada de cuatro/Bs 140;
   no sigue la nueva carrera solo porque use el mismo vehículo.

La fixture ROAD se construye offline mediante RPCs existentes antes de servir HTTP;
no es un inicio automático del viaje de producto. Para el arranque habitual volver
al valor `DEFAULT`. `npm run test:all` y `npm run test:web` reproducen la batería;
si falta Chromium: `npx --no-install playwright install chromium`.

## Pendientes para el cierre técnico de Etapa 3

Este incremento no declara cerrada toda la etapa. Quedan para revisión de alcance
los flujos web aún no conectados: expreso/división voluntaria según contrato,
condiciones declaradas y aceptación del responsable, correcciones/recuperaciones
especiales, revisión simulada de menores, responsables presenciales y cancelación administrativa, paginación de manifiestos
y reservas más allá de la proyección actual de 50, configuración/provisión de cuentas y
superficies administrativas que requieran un flujo específico. El backend existente
no equivale por sí solo a una interfaz funcional completa ni a validación de campo.

Una unidad retirada tras traslado de terminal no recibe una carrera administrativa
ficticia para poder volver a fila. Grupos o manifiestos incompatibles y falta de
alternativas permanecen a revisión humana. No se inventan políticas de ausencia,
retención, verificación legal, reembolsos o tiempos de rescate.

Sigue siendo laboratorio ficticio en loopback, con base nueva por arranque. Sin
publicación, pagos, GPS/OAuth real, comunicaciones externas o servicios contratados.
PR #3 abierto hacia `desarrollo/etapa-2`; no se fusiona ni se inicia incremento 6.

## Evaluación del incremento

Se completó la consolidación descrita, sin rehacer los recorridos de los incrementos
1–4 ni alterar sus contratos. La migración 026 se aplica sobre la base ficticia
poblada conservando las filas previas, importes, miembros, historial y registro de
migraciones; los checksums 001–025 permanecen intactos. **Incremento 5 verificado en
su alcance de laboratorio**, con 329 casos locales y la matriz final 4/4 aprobados,
sin omitir los fallos intermedios descritos. El commit posterior contiene únicamente
README, este informe, la evidencia y las capturas; los resultados anteriores identifican
explícitamente el commit funcional probado. No se declara cerrada toda la Etapa 3
ni se inicia su incremento 6.
