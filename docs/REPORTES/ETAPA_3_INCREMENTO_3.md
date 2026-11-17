# Etapa 3 — Incremento 3: terminal, recogidas y viaje en la web

27/10/2026, America/La_Paz. Repositorio `pepoj1046-svg/proyecto-nexo`, exclusivamente
`desarrollo/etapa-3`, desde `e86bb1f59636b04eb693692a16c552af99a5436e`, árbol limpio
comprobado contra GitHub antes de editar. La autorización del propietario habilita
este incremento y mantiene el incremento 4 fuera del alcance.
[PR #3](https://github.com/pepoj1046-svg/proyecto-nexo/pull/3) hacia Etapa 2,
abierto y sin fusionar. Leídos AGENTS, requisitos, arquitectura/modelo, seguridad,
pruebas de Etapa 1, contratos/decisiones vigentes e informes anteriores.

Revisada la [evaluación independiente del incremento 2](https://github.com/pepoj1046-svg/proyecto-nexo/pull/3#issuecomment-6433461327).
Su observación de cotizaciones tardías se corrige aquí con regresiones específicas.

## Funcionalidades conectadas

| Superficie | Implementación real de laboratorio | Contrato reutilizado |
|---|---|---|
| Reserva | Subida en terminal, ciudad o carretera; solo puntos habilitados del recorrido, nombres y tarifa por segmento | Proyecciones 023, perfiles declarados 024, reserva existente |
| Pasajero | «Consultar presencia y viaje», «Ya llegué», declaración vigente/vencida, verificación, abordaje y último punto declarado | terminal_arrival, terminal_evaluation, operational_status |
| Pasajero en recogida | «Esperaré en mi punto autorizado», sin afirmar que ya abordó ni que se verificó su presencia | terminal_assignment_command(PICKUP) |
| Administración | Vehículos y reservas accesibles por asociación/ruta dirigida/terminal, verificación presencial, pasajeros esperados, movimientos de grupo/integrante, confirmación de incidencias | manage_route/check_scope, VERIFIED, terminal_observation, impedimento/fleet/road existentes |
| Chofer | Solo vehículos propios; acepta solicitudes, registra hechos observados, salida, avance por paradas y llegada final | respond_offer, terminal_observation, depart, begin_urban, progress, MAIN_START |
| Incidencias básicas | Reporte y confirmación autorizados de avería ficticia en terminal/recogida/carretera, bloqueo y revisión humana visibles | terminal_impediment, fleet_command y road_command |

No hay inventario alternativo, estados confirmados en memoria del navegador ni
movimientos deducidos de reservas/presencia. Seis plazas confirmadas no invocan
salida automáticamente. El chofer registra su salida; la verificación administrativa
es independiente y no es una aprobación obligatoria por carrera.

### Estados e inventario

- En fila: plazas confirmadas todavía incompletas, salvo impedimento informado.
- Completo, listo para salir: seis confirmadas por tramo y salida elegible; sigue
  QUEUED hasta la acción explícita del chofer.
- Recogiendo pasajeros: salida urbana registrada con begin_urban y manifiesto compatible.
  **Cuatro abordados en terminal y dos recogidas confirmadas** conservan seis plazas
  comprometidas: no se exigen seis físicamente presentes para salir.
- En viaje hacia el destino: MAIN_START explícito, en el punto principal declarado,
  después de observar las recogidas exigidas por ese contrato. No se deduce de 6/6.
- En recorrido: salida general heredada, sin inventar una fase urbana no registrada.
- Viaje finalizado: progress a la última parada. Los descensos se registran aparte;
  llegar no fabrica ALIGHT ni pone el contador observado en cero por sí solo.
- Incidencia operativa: prevalece el bloqueo vigente; no se promete rescate ni se
  cancelan reservas por el mero reporte.

En manifiestos de segmentos disjuntos se informa el máximo simultáneo por tramo,
separado de los compromisos totales. La elegibilidad de salida conserva el criterio
existente del núcleo. Un manifiesto incompatible con begin_urban utiliza salida
general; no se amplía la regla urbana ni se exige llenar de nuevo el vehículo.

### Presencia y privacidad

«Ya llegué» solo declara presencia para el episodio de terminal válido y tiene
120 segundos provisionales, sin renovar el reloj con reintentos. Una declaración
vencida/retirada sigue visible y puede requerir verificación presencial; no equivale
a ausencia acreditada, cancelación, pago ni abordaje. El administrador puede verificar
presencialmente sin exigir la declaración previa del pasajero.

El pasajero ve exclusivamente reservas/integrantes propios. No recibe identidad,
precio o códigos de otros grupos en la nueva proyección. Ve el estado del vehículo
y el último punto declarado, con actualización manual y sin GPS ni tiempo prometido.
Los administradores conservan el alcance de las rutas dirigidas/terminales otorgadas
offline. Ningún selector de rol, asociación, usuario o ruta concede permisos.

## Archivos y migración

**001–023 intactas**. Solo se agrega `024_web_operations.sql`:

- `web_point_profiles`: tipo TERMINAL/URBAN/ROAD y fin de recogidas declarado offline,
  ligado por FK al punto real de la ruta. RLS y sin DML para runtime. No se clasifican
  puntos antiguos por su nombre o por supuestas coordenadas: permanecen UNCLASSIFIED.
- Extensión compatible de public_route_points con esos tipos; los puntos afectados
  o suspendidos no se ofrecen habilitados para nuevas subidas/bajadas.
- `web_trip_snapshot`: proyección mínima por rol, puntos, presencia, integrantes,
  compromisos/ocupación por segmentos y estado efectivo. Hasta 50 reservas por consulta;
  los contadores del vehículo consideran todo el inventario.
- `web_observation`: envoltura de viaje/episodio e idempotencia que delega el movimiento
  al RPC existente. Reclama claves antes de bloquear ruta, conserva orden de locks,
  rechaza asignaciones obsoletas y no altera capacidad/tarifas ni inventa hechos.

Las funciones SECURITY DEFINER fijan search_path y no conceden EXECUTE a PUBLIC.
No se amplían permisos de identidad, aprovisionamiento o escritura directa.

Adaptación: `src/db/web-operations-service.mjs`, `src/http/web-gateway.mjs`.
Interfaz: `Operations.tsx`, `operation-model.ts`, `Functional.tsx`, `Login.tsx`,
`main.tsx`, `styles.css`. Login se extrae para reutilizarlo, conservando el módulo de
identidad. Arranque: `seed-web-demo.mjs`; pruebas/runner: `test-web.mjs`,
`web-operations.test.mjs`, O01–O12 en PostgreSQL, `operations.spec.mjs` y
`checkout-races.spec.mjs`. Actualizados AGENTS, README, arquitectura y seguridad.

Los únicos endpoints nuevos son POST JSON de mismo origen `/api/operations/overview`,
`/snapshot` y `/command`, todos con sesión y CSRF; command exige confirmación explícita
e Idempotency-Key. Su lista cerrada de comandos no expone SQL, provisión, pagos,
cancelación por ausencia ni operaciones arbitrarias del backend.

## Correcciones y pruebas

Corregida la observación de ChatGPT: una cotización tardía se descarta si cambiaron
plazas o paradas. Al elegir una nueva parada se invalida inmediatamente el servicio
anterior mientras se consulta el tramo; no reaparece un importe antiguo durante
esa espera. Las pruebas retrasan por separado ambas respuestas para comprobarlo.
La revisión demostrativa también compara los puntos exactos del servicio, además
del vehículo, al reconsultar disponibilidad.

Se probaron aislamiento de roles/asociaciones/terminales, privacidad de integrantes,
CSRF, revocación, doble observación concurrente, episodio desactualizado, destino
ajeno, mezcla de modos grupal/individual, parada incorrecta, carreras de avance y
abordaje, incidencia sin cancelación y migración poblada 023→024 conservando todas
las tablas históricas y precios. Las 268 pruebas anteriores se conservan.

Resultados ejecutados localmente en Node **24.19.0** y PostgreSQL real **18.4**:

- `npm run test:all`: **43/43 unitarias y 204/204 integraciones**, sin omitidas;
  propagación de fallo del runner y ambos listeners CLI aprobados.
- `npm run test:web`: **46/46 Chromium**, 23 escritorio y 23 móvil emulado,
  con las 36 web anteriores conservadas. Ciclo de terminal/recogidas/llegada,
  observación individual, aislamiento y regresiones de cotización tardía aprobados.
- Cierre SIGINT real: HTTP/PostgreSQL detenidos y puertos verificados. Reinicio:
  reserva de la primera ejecución, contraseña y sesión no disponibles en la segunda;
  archivos de acceso eliminados correctamente.
- Comprobación axe WCAG 2 A/AA y 2.1 AA sin incidencias en pantallas ejercitadas,
  incluidos los paneles operativos del flujo; no sustituye revisión manual integral.
- **293 casos** en total, incluidos los 268 anteriores. Smokes del runner/transporte,
  cierre y reinicio se contabilizan aparte. El diagnóstico de cierres fallidos se
  conserva solo en `.local`, sin volcar credenciales en logs públicos.
- CI del commit funcional **22b7ffb30076fc5f95ebb5f36075b31ea751b058**:
  [ejecución verificada del PR #3](https://github.com/pepoj1046-svg/proyecto-nexo/actions/runs/40524785360),
  **4/4 trabajos completed/success**, sin reintentos: Ubuntu Node 22, Ubuntu Node 24,
  Windows Node 22 y Windows Node 24. Cada combinación ejecutó test:all y test:web,
  incluidos cierre/reinicio. En Ubuntu se comprueba SIGINT real y en Windows IPC.
  No se atribuyen a este incremento los resultados de commits anteriores.

El commit posterior de documentación únicamente registra esta evidencia. El código
funcional probado es el hash anterior. Main se conserva en `cac056b`, Etapa 1 en
`9188139` y Etapa 2 en `820fd1f`; PR #1/#2/#3 continúan abiertos y sin fusionar.

Durante el desarrollo se corrigió un identificador de login de fixture con mayúscula
(rechazado correctamente por la restricción existente, sin relajarla). La copia de
fixtures incluye la nueva tabla en TRUNCATE y conserva los checksums anteriores.
Las pruebas web esperan el cierre de sesión antes de cambiar de cuenta y usan
vehículos independientes para la incidencia posterior al recorrido finalizado.

## Cómo probar el recorrido completo en Windows

Requisitos: Node 22.x o 24.x, npm; sin PostgreSQL instalado ni Docker.

```powershell
npm ci --no-fund
npm run dev:web
```

1. Mantener abierta esa terminal y abrir la URL `http://127.0.0.1:<puerto>` indicada.
   En otra terminal: `Get-Content -Raw "<ruta del archivo .local/accesos-....json>"`.
   Cada entrada de accounts contiene login y password generados para esta ejecución.
2. Abrir perfiles/contextos de navegador separados para pasajero, administrador y
   chofer. Todos usan la misma URL y base local. No compartir credenciales ni subir
   el archivo privado a GitHub.
3. Pasajero **operativo0**, `/pasajero`: hay una reserva ficticia ya confirmada de
   cuatro plazas desde Terminal de Yacuiba hasta Terminal Villa Montes. Las cuentas
   y sus reservas se preparan mediante RPCs existentes antes de escuchar; no son reales.
   Pulsar «Consultar presencia y viaje» y «Ya llegué». Aparece declaración vigente.
4. Administrador **adminH**, `/administracion`: seleccionar **FICTICIO-OPERATIVO**,
   pulsar «Verificar llegada presencial» para la reserva desde terminal y «Registrar
   abordaje del grupo» solo como observación de esas cuatro personas ficticias.
   La reserva **operativo1** de dos plazas desde Palmar sigue esperada y confirmada.
5. Chofer **driver5**, `/chofer`: seleccionar FICTICIO-OPERATIVO. Se muestran seis
   confirmadas por tramo y cuatro abordados. Sigue en fila: no salió automáticamente.
   Pulsar «Iniciar salida para recogidas». El estado cambia a Recogiendo pasajeros.
   El mismo chofer puede registrar los abordajes de terminal: no necesita solicitar
   al administrador una aprobación de salida ni una verificación por cada carrera.
6. Pulsar «Registrar llegada a Parada Palmar (ficticia)». En la reserva de dos plazas,
   registrar su abordaje (o desplegar integrantes y observar cada uno, sin mezclar modos).
   Se muestran seis abordados. Pulsar «Recogidas completadas: iniciar viaje al destino».
7. Volver al pasajero y «Actualizar presencia y viaje»: muestra viaje hacia el destino
   y último punto declarado. Para simular la petición de recogida de operativo1 puede
   iniciar sesión antes de salir y pulsar «Esperaré en mi punto autorizado»; el chofer
   puede registrar su llegada a ese punto sin inventar abordaje.
8. Chofer: registrar llegada a Paso del Chaco y después «Registrar llegada final
   Terminal Villa Montes». Muestra Viaje finalizado. Registrar después el descenso
   real simulado de ambos grupos/integrantes: el contador observado llega a cero.
9. «Cerrar sesión» en cada perfil. Esperar el formulario de acceso antes de usar otra
   cuenta. Para otro ensayo limpio, Ctrl+C en la terminal y volver a arrancar.

Para registrar una solicitud nueva siguen disponibles la búsqueda y los accesos
viajero0…viajero9; el procedimiento del incremento 2 se conserva. En la reserva,
«Opción de subida» filtra Terminal/Ciudad/Carretera sin pedir categoría administrativa.
Solo se seleccionan paradas autorizadas y ordenadas; el importe se recalcula en SQL.

**Prueba de permisos:** adminU solo ve el ámbito de Unión del Sur; no ve el vehículo
operativo de Horizonte. Un pasajero no obtiene manifiestos administrativos aunque
entre en la URL. driver0 conduce el primer vehículo de Horizonte; driver5 el del
recorrido completo anterior. No intercambiar cuentas como si fueran el mismo chofer.

**Incidencia básica:** usar un arranque nuevo, driver0 en FICTICIO-WEB-0-0, reportar
«avería ficticia observada». adminH la confirma. La salida queda bloqueada y las
reservas se conservan. Resolver/reasignar/rescatar no forma parte de estos controles
mínimos; no se desbloquea inventando reparación ni se cancela automáticamente.

## Capturas

[Operación del chofer — escritorio](capturas/etapa-3-incremento-3-operacion-escritorio.png) ·
[Operación del chofer — móvil](capturas/etapa-3-incremento-3-operacion-movil.png).
Solo datos ficticios e identificadores técnicos, sin contraseñas ni cookies.

## Límites y decisiones pendientes

- Solo laboratorio loopback. No pagos, GPS, OAuth, servicios externos, notificaciones,
  despliegues, datos personales o vehículos reales; sin gastos contratados.
- Cada arranque crea otra base. Cuentas, sesiones y reservas anteriores no se reutilizan
  en la nueva ejecución. El runner conserva archivos de clúster/logs bajo `.local`
  para diagnóstico: **no es borrado físico seguro** ni política de retención comercial.
  El archivo de accesos sí se elimina al detener normalmente el laboratorio.
- Tipos de puntos y fin urbano solo se declaran en la fixture offline. Validar catálogo,
  seguridad de puntos, límites urbanos y permisos reales requiere decisión/validación
  del propietario antes de cualquier piloto; no se deducen de distancias ni GPS.
- Se conserva el límite del protocolo urbano aprobado; no se amplía a manifiestos
  incompatibles ni se inventa MAIN_START para salidas generales heredadas.
- Las incidencias se reportan/confirman aquí; rescate, reparación, reasignación,
  compensaciones y correcciones tardías conservan sus contratos anteriores y no
  reciben un panel nuevo en este incremento. No se promete asistencia de emergencia.
- Declaraciones/presencia/abordaje/pago permanecen distintos. No hay scheduler,
  sanciones, liberación por ausencia ni envío. Políticas definitivas, retención y
  operación comercial siguen sujetas a las decisiones ya documentadas.
- Listados acotados y actualización manual. No manifiesto firmado, seguimiento en
  tiempo real, garantía de hora ni revisión independiente de seguridad de producción.

El incremento 3 prepara revisión funcional; no declara cerrada la Etapa 3 ni autoriza
el incremento 4, un despliegue o una fusión.
