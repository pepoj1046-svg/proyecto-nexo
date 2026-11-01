# Etapa 3, incremento 4 — Incidencias, sustituciones y rescates web

27/10/2026, America/La_Paz. Laboratorio ficticio de
`pepoj1046-svg/proyecto-nexo`, exclusivamente `desarrollo/etapa-3`, desde
`3acc92a67283dafa6f6f8e1b39714f5ac78a311f`. Se verificaron repositorio, rama,
árbol inicialmente limpio y coincidencia con GitHub antes de modificar archivos.
Se leyeron AGENTS, requisitos, arquitectura/modelo, seguridad, contratos vigentes,
informes de Etapa 2 y evidencias de los incrementos 1–3 de Etapa 3, incluida la
[revisión del PR #3](https://github.com/pepoj1046-svg/proyecto-nexo/pull/3#issuecomment-6453565325).
PR #3 permanece abierto hacia `desarrollo/etapa-2`, sin fusión. No se modifica
`main` ni se inicia el incremento 5.

## Funcionalidad implementada

| Procedimiento | Interfaz y contrato utilizado |
| --- | --- |
| Consulta administrativa | Panel «Incidencias y resoluciones autorizadas»: asociación/ruta/terminal autorizadas, reservas afectadas, vehículo y primeras opciones compatibles calculadas por PostgreSQL. |
| Traslado previo a salir | Administración consulta las alternativas; el responsable APP consiente todo su grupo y un vehículo concreto; administración aprueba mediante `consentGroup` / `approveTerminalTransfer`. El consentimiento no retiene plazas. |
| Avería en terminal | Reporte/confirmación existentes del panel operativo; candidato nativo `terminal_replacement_candidate`; consentimientos de todos los grupos y declaración de traslado seguro cuando hay personas abordadas; `terminal-reassign` conserva reservas, miembros, tarifas e historial. La unidad retirada no vuelve automáticamente a la fila. |
| Avería durante recogidas urbanas | Reporte/confirmación existentes; `free_replacement` y `fleetCommand` asignan una unidad completamente libre. El nuevo chofer o administrador autorizado registra `SAFE_TRANSFER` con el número observado antes de continuar las recogidas. |
| Rescate en carretera | `road_candidates` respeta terminal prioritaria y permisos; `road-command` asigna una unidad completamente libre de la misma asociación. El chofer sustituto declara traslado seguro antes de progresar. Sin unidad se permite registrar revisión humana urgente, sin prometer rescate. |
| Pasajero | En «Mis reservas», consulta manual de incidencia, vehículo autorizado y estado de su propia reserva. Consentimiento e historial propios, sin manifiestos ni datos de otros grupos. |
| Chofer | Consulta de sus incidencias y cambios de asignación. El anterior conserva una vista histórica limitada; el actual recibe las operaciones que el backend autoriza. No existe autoasignación de rescate. |

Las candidaturas son consultas instantáneas: al ejecutar se vuelven a comprobar
capacidad por segmento, grupo, consentimiento, estado, autorización y versión.
Un rechazo no modifica parcialmente reservas ni inventario. Se mantienen las seis
plazas simultáneas, los precios acordados, las recogidas posteriores y la salida
explícita del chofer. Una unidad completa sigue sin salir automáticamente.

## Cambios y seguridad

- `apps/web/src/Recovery.tsx`: paneles de los tres roles, confirmaciones explícitas,
  consultas manuales y estados seguros. `use-command.ts` reutiliza la gestión de
  claves de idempotencia existente. Integración en `Functional.tsx` y `Operations.tsx`.
- `src/db/web-recovery-service.mjs` y `src/http/web-gateway.mjs`: superficie local
  cerrada `/api/recovery/{overview,detail,passenger,transfer,command}`. Ocho comandos
  específicos delegan exclusivamente en el servicio de negocio existente; no hay
  RPC arbitrario ni acceso SQL desde el navegador.
- `025_web_recovery_reads.sql`: dos proyecciones mínimas `SECURITY DEFINER`, con
  `search_path` fijado, actor/scope/pertenencia comprobados y ejecución PUBLIC
  revocada. Solo lecturas; ninguna tabla, regla de negocio ni mutación nueva.
  Migraciones **001–024 intactas**, verificadas por checksum y actualización poblada.
- Las consultas normales usan `nexo_app` y RLS. Se conservan sesiones revocables,
  cookie HttpOnly, CSRF/Origin/Host, loopback, límite de cuerpo 2048 bytes y límites
  existentes de 120 solicitudes/minuto y seis simultáneas por sesión.
- Listados acotados: 50 incidencias, 10 candidatos mostrados, 50 consentimientos
  administrativos, 10 consentimientos propios y 20 incidencias históricas propias.
  No son un inventario nacional, una reserva de vehículo ni una garantía operativa.
- Fixtures locales añaden unidades libres de origen/destino, conductor sustituto,
  responsable ficticio y administrador con ambos alcances. La asociación ajena
  conserva sus permisos separados. No cambia el catálogo público de la ruta inicial.

## Problemas encontrados y corregidos

1. Invocar el comprobador privado `check_scope` desde `nexo_app` daba denegación de
   permiso. El adaptador utiliza las operaciones públicas existentes que ya validan
   ese alcance; no se amplían privilegios SQL para resolverlo.
2. El antiguo chofer podía recibir la proyección operativa actual del mismo viaje
   después de otra avería. Ahora ve solo su incidencia histórica, el sustituto
   registrado en ella y una fase histórica, sin el estado de rescates posteriores.
   El pasajero trasladado tampoco recibe incidencias posteriores del vehículo anterior.
3. Tras retirar la unidad en terminal, su manifiesto actual queda vacío. El panel
   administrativo reconstruye las reservas afectadas mediante los episodios existentes,
   conservando precisión temporal SQL y mostrando su vehículo autorizado actual.
4. El texto heredado atribuía toda confirmación a una aceptación del chofer. Una
   reasignación aprobada muestra «Confirmada por administración»; solo la aceptación
   personal registrada muestra «Confirmada por el chofer». El historial genérico
   dice «Reserva confirmada», sin inventar acciones del sustituto.
5. Un cierre real del laboratorio falló con SQLSTATE `57P01`: `pg-pool.end()` podía
   resolverse antes de terminar físicamente sus sockets y PostgreSQL se detenía antes.
   `drain-local-pool.mjs` espera el evento `end` de cada cliente antes de detener la
   base. Dos pruebas reproducen ese orden y comprueban que un error inesperado sigue
   provocando fallo, sin imprimir el objeto de conexión ni ocultarlo como éxito.
6. Se actualizaron expectativas del registro de migraciones a 25. Un selector E2E
   ambiguo distinguía mal reservas canceladas históricas y confirmadas; se acotó a
   la reserva confirmada sin eliminar datos ni pruebas anteriores.

Durante el desarrollo hubo ejecuciones fallidas por estos motivos y una ejecución
con bundle anterior a la corrección del texto de confirmación. No se contabilizan
como aprobadas. Los resultados de entrega corresponden a una compilación posterior
con fuentes estables, sin reutilizar respuestas HTTP simuladas.

## Verificación y evidencias

La comprobación utiliza PostgreSQL **18.4 real**, Node **24.19.0**, Chromium
**154.0.8037.57** y Playwright **1.64.1**. Cada archivo/proyecto E2E inicia un clúster
aislado; los nuevos recorridos emplean sesiones independientes para los tres roles,
también con la emulación móvil heredada.
Las fixtures URBAN/ROAD/ROAD_NO_FREE adelantan solo el estado inicial mediante RPCs
nativos offline; reporte, confirmación, asignación y traslado se accionan después
por la web. El recorrido completo original del incremento 3 también se conserva.

Resultados finales locales: **315/315 aprobadas, sin omitidas**: 47 unitarias,
212 integraciones PostgreSQL y 56 casos Chromium (28 escritorio + 28 móvil).
Se conservan los 293 casos anteriores y se añaden 22. `npm run test:all` y
`npm run test:web` terminaron con código **0**. TypeScript/compilación, probe de
propagación de fallo del runner, smokes HTTP/negocio, cierre real SIGINT con puertos
verificados y reinicio sin reutilizar sesión/contraseña/reserva aprobaron también.
El mensaje `--nexo-invalid-test-option` del probe es intencional: comprueba que el
código de error 9 del hijo se conserva y PostgreSQL se detiene. Logs locales de
esta entrega: `.local/i4-entrega-all.log` y `.local/i4-entrega-web.log`.
CI del commit funcional [`62bb09d`](https://github.com/pepoj1046-svg/proyecto-nexo/commit/62bb09db8edf3244d326e5cd188b898ca20eacc5):
[ejecución 40611160076](https://github.com/pepoj1046-svg/proyecto-nexo/actions/runs/40611160076),
**completed/success, 4/4 trabajos aprobados**. Se inspeccionaron los logs de los
cuatro jobs, incluyendo recuentos, cierre de listeners/PostgreSQL y reinicio.

| Entorno | Node realmente ejecutado | Unitarias | PostgreSQL | Chromium | Resultado |
| --- | --- | --- | --- | --- | --- |
| [Ubuntu, Node 22](https://github.com/pepoj1046-svg/proyecto-nexo/actions/runs/40611160076/job/122562741298) | 22.23.4 | 47 | 212 | 56 | Aprobado |
| [Ubuntu, Node 24](https://github.com/pepoj1046-svg/proyecto-nexo/actions/runs/40611160076/job/122562741092) | 24.21.0 | 47 | 212 | 56 | Aprobado |
| [Windows, Node 22](https://github.com/pepoj1046-svg/proyecto-nexo/actions/runs/40611160076/job/122562741225) | 22.23.4 | 47 | 212 | 56 | Aprobado |
| [Windows, Node 24](https://github.com/pepoj1046-svg/proyecto-nexo/actions/runs/40611160076/job/122562741378) | 24.22.1 | 47 | 212 | 56 | Aprobado |

PostgreSQL real **18.4** en los cuatro jobs. No se suman las repeticiones locales o
las cuatro plataformas como nuevos casos: la batería contiene **315 casos**.
El presupuesto de cada job pasa de 10 a 15 minutos para los laboratorios adicionales;
no se incorporan proveedores ni servicios de pago. El registro posterior de estos
resultados es exclusivamente documental.

Se añaden ocho integraciones PostgreSQL (R01–R08), dos regresiones del cierre de
pools, validadores unitarios y cinco recorridos E2E, cada uno en escritorio/móvil:

| Escenario | Comprobaciones persistidas y negativas |
| --- | --- |
| Traslado normal | Consentimiento del responsable, aprobación administrativa, mismos identificadores/miembros/importes; reintentos simultáneos con la misma clave crean un solo hecho; clave nueva no reutiliza el consentimiento. |
| Avería terminal | Cuatro abordados, capacidad conjunta, candidato incompatible rechazado, consentimiento y traslado seguro obligatorios, unidad original retirada, reservas afectadas visibles después. |
| Sustitución urbana | Cuatro abordados y dos futuras recogidas; unidad libre y nuevo chofer; traslado seguro de cuatro antes de continuar; Palmar y viaje principal conservan seis comprometidas. |
| Rescate carretera | Seis abordados, prioridad destino, unidad completamente libre; rechazo de unidad ocupada/asociación ajena/autoasignación; dos claves concurrentes producen un único ganador y `STALE_OPERATION`; traslado seguro exacto, llegada y descensos. |
| Sin unidad libre | Revisión humana urgente explícita e idempotente, sin rescate inventado, cancelaciones, movimientos ni cambio de tarifas o plazas. |

Los testigos SQL externos a la API son `REPEATABLE READ READ ONLY`: contrastan
reservas, miembros, episodios, ocupación, segmentos, movimientos y auditoría.
El navegador utiliza cookies y CSRF reales; los rechazos se prueban también mediante
solicitudes HTTP directas para no depender de botones ocultos. La carrera de rescate
envía dos solicitudes reales con claves distintas y conserva la respuesta original
del servidor. No hay simulación de éxito. Se comprueban además sesiones/permisos
revocados, aislamiento de asociación y migración poblada 024→025 sin cambios en
las tablas antiguas; reaplicar no ejecuta nada. Se mantiene axe WCAG 2 A/AA y 2.1 AA.

[Resumen SQL de los 14 estados de escritorio/móvil y hashes de capturas](evidencias/etapa-3-incremento-4.json).
Se revisaron visualmente las seis capturas originales de la ejecución final:

- [Pasajero: traslado aprobado y Bs 140 conservados](capturas/etapa-3-incremento-4-traslado-confirmado-desktop.png).
- [Administración: terminal sustituido y reservas afectadas](capturas/etapa-3-incremento-4-terminal-sustituido-desktop.png).
- [Chofer: sustitución urbana, cuatro abordados y seis confirmados](capturas/etapa-3-incremento-4-urbano-traslado-seguro-desktop.png).
- [Administración: rescate asignado desde destino, traslado pendiente](capturas/etapa-3-incremento-4-carretera-asignado-desktop.png).
- [Chofer móvil: llegada final y cero personas a bordo](capturas/etapa-3-incremento-4-carretera-finalizado-mobile.png).
- [Pasajero: revisión humana urgente sin unidad](capturas/etapa-3-incremento-4-urgente-sin-unidad-desktop.png).

Son capturas de consultas manuales; actualizar cada panel para consultar cambios
realizados desde otra sesión u otro panel, sin inferir seguimiento en tiempo real.
Los logs privados permanecen en `.local/`, excluidos de Git; no se publican archivos
de accesos, cadenas de conexión ni trazas con credenciales.

## Prueba manual en Windows

Requisitos: Node 22.x o 24.x, npm y este repositorio en `desarrollo/etapa-3`.
No hace falta instalar PostgreSQL ni Docker. En PowerShell:

```powershell
npm ci --no-fund
npm run dev:web
```

Abrir la URL `http://127.0.0.1:<puerto>` impresa. En otra consola leer
`Get-Content -Raw "<ruta de accesos impresa>"`. Las contraseñas se generan por
arranque y solo son ficticias. Usar perfiles separados de navegador para pasajero,
administrador y chofer. Los alias siguientes son de laboratorio, no cuentas reales.
Actualizar cada panel después de que otro rol opere. Ctrl+C termina el laboratorio;
cada nuevo arranque genera una base y accesos diferentes.

### Traslado normal y avería en terminal: arranques independientes

1. Pasajero `terminal0` en `/pasajero`, administración `adminH` en
   `/administracion` y chofer `driver0` en `/chofer`. Elegir `FICTICIO-WEB-0-0`.
2. Para traslado normal, administración consulta «Traslados del grupo» de la reserva
   confirmada de cuatro. El pasajero abre «Consultar incidencia y traslado», elige
   la propuesta indicada `FICTICIO-RESCATE-ORIGEN` y autoriza todo su grupo.
   Administración actualiza, selecciona el consentimiento, confirma y aprueba.
   Verificar el mismo grupo, referencia e importe y la confirmación administrativa.
   El conductor sustituto `driver6` ve cuatro confirmadas, sin salida automática.
3. Para avería, reiniciar desde DEFAULT. Administración registra el abordaje del
   grupo **confirmado** de cuatro; las reservas canceladas históricas permanecen.
   `driver0` reporta la avería y `adminH` actualiza y confirma en el panel del vehículo.
4. Administración abre «Consultar incidencias» y selecciona la incidencia. El primer
   candidato es `FICTICIO-RESCATE-ORIGEN`; el pasajero consiente ese vehículo.
   Administración actualiza, marca el consentimiento, declara el traslado seguro
   ficticio de cuatro y confirma «Reasignar reservas de la incidencia».
5. Verificar reserva/grupo/importe conservados, unidad original retirada y reserva
   afectada visible con su nuevo vehículo. `driver0` solo conserva la incidencia
   histórica; `driver6` recibe la operación autorizada.

### Escenarios urbanos y de carretera

Para empezar cada escenario avanzado en su estado ficticio inicial, detener el
laboratorio y elegir **uno** antes del nuevo arranque:

```powershell
$env:NEXO_WEB_RECOVERY_SCENARIO = "URBAN" # alternativas: ROAD, ROAD_NO_FREE
npm run dev:web
# Para volver al estado habitual en otro arranque:
# $env:NEXO_WEB_RECOVERY_SCENARIO = "DEFAULT"
```

- **URBAN:** `operativo0`, `adminH`, `driver5`, vehículo `FICTICIO-OPERATIVO`.
  Hay cuatro abordados y dos recogidas futuras, sin iniciar el viaje principal.
  Chofer reporta; administración confirma en operación y asigna desde Incidencias
  la unidad libre de origen. `driver6` abre su operación/incidencia y declara
  traslado seguro de cuatro. Después avanza a Palmar, aborda al grupo de dos y
  registra explícitamente el inicio del viaje principal. No hay seis presencias
  físicas exigidas antes de las recogidas ni movimientos automáticos.
- **ROAD:** `operativo0`, **`adminR`** y `driver5`. `adminR` tiene alcance sobre
  ambos sentidos; `adminH` mantiene únicamente su permiso original.
  La fixture ya recorrió Palmar y llegó al Paso del Chaco con seis abordados.
  Chofer reporta y administración confirma, consulta la incidencia, elige terminal
  DESTINATION y asigna `FICTICIO-RESCATE-DESTINO`. El nuevo chofer **`driver7`**
  consulta su servicio, declara traslado seguro de **seis**, avanza a Villa Montes
  y registra los descensos de ambos grupos. Verificar viaje finalizado y cero a bordo.
  El pasajero consulta únicamente su grupo de cuatro y Bs 140; el otro grupo conserva
  dos plazas y Bs 50, sin mostrarse en su panel. El antiguo chofer no puede progresar.
- **ROAD_NO_FREE:** mismas tres sesiones de ROAD, pero las dos unidades de rescate
  están impedidas mediante reportes nativos de terminal. Tras reportar/confirmar la
  incidencia principal no aparece unidad libre. Administración registra revisión
  humana urgente. Las seis reservas/plazas comprometidas permanecen y el pasajero
  ve revisión pendiente, sin ETA, cancelación ni asistencia prometida.

Para automatizar: `npm run test:all`, `npx --no-install playwright install chromium`
y `npm run test:web`. En Linux se prueba cierre real por SIGINT; en Windows el
runner usa cierre IPC y comprueba los puertos/procesos. No se atribuye a CI una
prueba física de teclado Ctrl+C en Windows.

## Límites y decisiones pendientes

El incremento conecta procedimientos definidos. Casos que el núcleo devuelve como
`ADMIN_REVIEW_REQUIRED`, grupos/consentimientos incompatibles, manifiestos complejos,
capacidad insuficiente, permisos revocados o ausencia de unidad autorizada se
rechazan o quedan a revisión humana. No se sustituyen por reglas inventadas.
Reparación y reinserción de unidades, cuando corresponden al backend, no reciben una
interfaz nueva en este incremento. La interfaz no determina seguridad vial real.

Siguen pendientes decisiones del propietario sobre protocolo humano de emergencia,
verificación real del traslado/punto seguro, roles de terminal en explotación,
manifiestos excepcionales, ausencias/menores, retención y uso comercial. No se fijan
plazos legales, llegada del rescate, indemnizaciones ni políticas nuevas.
No hay GPS, mensajes externos, cobros, sanciones o cancelaciones automáticas.

Es un prototipo local de laboratorio, sin disponibilidad ni endurecimiento para
Internet. La base no se reutiliza entre arranques; los directorios de pruebas pueden
quedar retenidos en `.local/` y no constituyen borrado seguro. Para recuperar espacio
se eliminaron únicamente 150 clústeres antiguos ficticios, detenidos y verificados
con `pg_ctl status`, preservando logs y evidencias. No se tocó ninguna base externa.

Evaluación: **incremento 4 completado y verificado en su alcance de laboratorio**,
con batería local y CI aprobadas. Los casos operativos no definidos o incompatibles
permanecen a revisión humana según los contratos documentados, sin reglas nuevas.
No se declara cerrada toda la Etapa 3 ni se autoriza producción.
