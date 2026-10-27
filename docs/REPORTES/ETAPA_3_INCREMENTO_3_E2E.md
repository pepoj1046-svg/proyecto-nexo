# Incremento 3 — Ensayo integral de terminal, recogidas y viaje

27/10/2026, America/La_Paz. Repositorio `pepoj1046-svg/proyecto-nexo`, rama
`desarrollo/etapa-3`, desde `85144035e23df6f88ac944acbda18c9a6bc3b852`.
Se comprobó el árbol limpio y su coincidencia con GitHub antes de editar.
Revisados AGENTS, requisitos, arquitectura/modelo, seguridad, contratos vigentes,
informes anteriores y la [última revisión de ChatGPT del PR #3](https://github.com/pepoj1046-svg/proyecto-nexo/pull/3#issuecomment-6446672860).
Este ensayo atiende su recomendación de recorrer el escenario de tres roles.

## Qué se comprobó y qué faltaba

La prueba existente ya accionaba la secuencia completa con tres sesiones, pero
dependía principalmente de lo mostrado en pantalla. Se amplió esa misma prueba
con **15 puntos de comprobación SQL por ejecución**, reintentos y rechazos durante
el recorrido. Se mantiene el caso anterior de permisos/incidencia, ahora en otro
archivo y laboratorio para conservar el presupuesto de solicitudes del gateway.
El número de casos sigue siendo 293; aumentan las comprobaciones dentro de ellos.

Se utilizan Chromium/Playwright y PostgreSQL **real**, iniciado por embedded-postgres
en 127.0.0.1, con base nueva y migraciones 001–024. Ningún dato, sesión, movimiento
o respuesta del recorrido se simula con interceptaciones del navegador. Las
reservas iniciales se crean mediante los RPCs del núcleo durante la fixture offline.
Solo se prueban personas, asociaciones, permisos y vehículos ficticios.

La prueba principal abre contextos independientes para `operativo0`, `adminH` y
`driver5`, con cookies/CSRF propios. En el proyecto móvil, también administrador
y chofer heredan explícitamente viewport, agente y emulación táctil del proyecto;
crear otro contexto de Playwright no heredaba automáticamente esa configuración.
Se comprueba que los tres viewports coincidan.

Un cliente Node de comprobación lee SQL en transacciones **REPEATABLE READ READ ONLY**,
independientes de la API. Contrasta hechos persistidos, precios, miembros, segmentos,
actores y auditoría; calcula la ocupación desde movimientos efectivos y la compara
con observed_onboard. La configuración privada de ese cliente solo viaja por IPC
del runner de pruebas al proceso de Playwright. No aparece en HTTP, archivos de
acceso, capturas ni evidencias. No hay un endpoint SQL ni un pool propietario nuevo
en el gateway. Esta lectura privilegiada comprueba consistencia; los permisos se
prueban a través de las sesiones HTTP reales y las integraciones RLS anteriores.

## Recorrido ejecutado

Vehículo `FICTICIO-OPERATIVO`, asociación Horizonte del Chaco, ruta ficticia
**Yacuiba → Palmar → Paso del Chaco → Villa Montes**. Dos grupos completos y estables:
cuatro plazas terminal→destino por **Bs 140,00**, dos plazas Palmar→destino por
**Bs 50,00**. Se conservan IDs de reserva/grupo/viaje, seis miembros técnicos,
segmentos, tarifa, versión e importe durante todo el recorrido.

| Paso observado | PostgreSQL | Punto | Personas a bordo observadas |
|---|---|---|---:|
| Consultar reserva y declarar «Ya llegué» | QUEUED; DECLARED por operativo0 | Yacuiba | 0 |
| Verificar presencia | QUEUED; VERIFIED por adminH | Yacuiba | 0 |
| Abordar grupo de cuatro | QUEUED; un BOARD por adminH | Yacuiba | 4 |
| Consultar como chofer; reintentar abordaje | Sigue QUEUED; departed_at NULL; sin DEPARTED ni urban_run | Yacuiba | 4 |
| Chofer pulsa salida para recogidas | IN_TRANSIT / URBAN_COLLECTION; un DEPARTED por driver5 | Yacuiba | 4 |
| Llegar a Palmar, sin abordar todavía | URBAN_COLLECTION; main_started_at NULL | Palmar | 4 |
| Abordar grupo de dos | URBAN_COLLECTION; segundo BOARD por driver5 | Palmar | 6 |
| Registrar inicio principal explícitamente | MAIN_TRIP; main_started_at presente | Palmar | 6 |
| Registrar progreso | IN_TRANSIT / MAIN_TRIP | Paso del Chaco | 6 |
| Registrar llegada final | COMPLETED en viaje y ambas reservas; sin ALIGHT automático | Villa Montes | 6 |
| Registrar descensos de ambos grupos | Dos ALIGHT por driver5, ambos en parada 3 | Villa Montes | 2 → 0 |

Antes de finalizar, el inventario confirmado por segmentos es **[4, 6, 6]**,
máximo seis. Dos plazas futuras siguen comprometidas al salir con cuatro abordadas.
Al completar el viaje, las reservas pasan a COMPLETED: la proyección de reservas
todavía CONFIRMED queda **[0, 0, 0]**; se conserva su historia e importe. La ocupación
observada sigue en seis hasta registrar los descensos, sin fabricar liberaciones.

El pasajero actualiza y ve el viaje principal y la finalización. Su snapshot solo
contiene su grupo, sin exponer la reserva de recogida de otra cuenta. Presencia,
reserva, abordaje, salida, MAIN_START y descenso siguen siendo hechos distintos.

## Pruebas negativas y reintentos

| Intento | Resultado exigido y comprobación |
|---|---|
| Salida automática por seis confirmadas, llegada, verificación, BOARD o lecturas | No ocurre: QUEUED, fecha de salida NULL y cero DEPARTED hasta la acción del chofer |
| Repetir BOARD con la clave original y con una clave nueva | HTTP 200 idempotente; sigue un solo hecho BOARD y cuatro abordados, sin duplicar plazas |
| Pasajero intenta BOARD o solicita snapshot ADMIN | HTTP 403 FORBIDDEN; hechos conservados; solo puede consultar su grupo |
| Administrador intenta iniciar recogidas en lugar del chofer | HTTP 403 FORBIDDEN; no aparece salida |
| Reservar una séptima plaza Palmar→destino tras salir con solo cuatro abordados | Cotización válida; reserva HTTP 409 NO_CAPACITY; no se crea reserva ni retención adicional |
| Forzar MAIN_START en Palmar antes de abordar a los dos esperados | Control deshabilitado; solicitud directa HTTP 409 PICKUPS_PENDING; permanece URBAN_COLLECTION |
| driver0 consulta o intenta sacar el vehículo de driver5 | HTTP 403 FORBIDDEN |
| adminU de otra asociación solicita el manifiesto o registra BOARD | HTTP 403 FORBIDDEN_SCOPE / FORBIDDEN según operación; snapshot SQL antes/después idéntico |

Los intentos adversarios usan las mismas cookies y CSRF del contexto correspondiente,
con solicitudes HTTP reales, incluso saltando los botones deshabilitados. Por tanto,
la protección comprobada no depende de ocultar controles en la interfaz.

## Resultados y reproducción

Ensayo dirigido inicial ya repetido satisfactoriamente: recorrido y permisos en
escritorio/móvil, **4/4**, además de los smokes de cierre y reinicio. Entorno local:
Node **24.19.0**, PostgreSQL **18.4**, Chromium **154.0.8037.57**, Playwright **1.64.1**.
Resoluciones: escritorio 1440×1000 y móvil emulado 390×844. La comprobación axe
WCAG 2 A/AA y 2.1 AA del panel de viaje también se conserva.

La batería completa se ejecuta con:

```sh
npm ci --no-fund
npm run test:all
npm run test:web
```

En este entorno se usó `npm --cache .local/npm-cache run ...` porque el caché npm
predeterminado no es escribible. Si falta Chromium: `npx --no-install playwright install chromium`.
No se necesita instalar PostgreSQL ni usar Docker o una base remota.

**Batería final local aprobada:** 43/43 unitarias, 204/204 integraciones PostgreSQL
y 46/46 casos Chromium (23 escritorio + 23 móvil), cero omitidos. Total **293**;
el ensayo dirigido previo repite cuatro de esos casos y no se suma al total.
También aprobados: propagación del fallo deliberado del runner, listeners de
identidad/negocio, SIGINT real y puertos cerrados, y reinicio sin reutilizar sesión,
contraseña ni reserva anterior. Ambas órdenes completas terminaron con código 0.
Logs locales: `.local/e2e-all-final.log` y `.local/e2e-web-final.log`.

**CI de este refuerzo: pendiente de ejecutar tras la publicación del commit.**
La CI anterior de `8514403` fue verificada de nuevo: [ejecución 40526196148](https://github.com/pepoj1046-svg/proyecto-nexo/actions/runs/40526196148),
cuatro trabajos aprobados Ubuntu/Windows × Node 22/24. Ese resultado histórico no
se atribuye a las comprobaciones nuevas.

Al terminar `test:web` quedan bajo `.local/e2e-incremento-3/` los estados SQL y seis
capturas por dispositivo. Los logs completos, trazas de fallo y clústeres permanecen
en `.local`, excluidos de Git; pueden contener accesos ficticios de la ejecución y
no se publican. Los listeners HTTP/PostgreSQL se detienen, se comprueba el cierre
de sus puertos y se elimina el archivo privado de accesos en el cierre normal.
Los clústeres se retienen para diagnóstico: no se promete borrado físico seguro.

Para repetir el ensayo manual de tres perfiles en Windows, usar los
[pasos del informe original](ETAPA_3_INCREMENTO_3.md#cómo-probar-el-recorrido-completo-en-windows).

## Fallos encontrados y correcciones

No se reprodujo un defecto funcional del producto en esta secuencia. Se corrigieron
problemas del ensayo al ampliar la cobertura:

1. La primera consulta nueva solo leía episode_terminal_events: el episodio cero
   escribe DECLARED/VERIFIED en terminal_events por compatibilidad. Se consulta
   terminal_timeline, que une ambos historiales; no se modificaron las tablas.
2. Una consulta SQL inmediatamente después del clic de progreso podía adelantarse
   al commit HTTP. La prueba espera que la interfaz confirme el nuevo punto antes
   de comprobar SQL, sin sleeps, reintentos de mutación ni lecturas optimistas.
3. El recorrido ampliado más los casos de permisos compartían el presupuesto de
   120 solicitudes/minuto y el segundo caso recibió RATE_LIMITED. Se separaron en
   archivos con base/listener nuevos por caso operativo y dispositivo, conservando
   el límite real, la concurrencia máxima y la protección de abusos.
4. Los contextos adicionales usaban el viewport predeterminado de Playwright en
   la variante móvil. Ahora los tres roles usan realmente la emulación del proyecto.

Los fallos intermedios no se cuentan como aprobados; se conservaron sus diagnósticos
privados y se repitieron las pruebas afectadas y la batería completa.

## Evidencias y archivos

Se publica una [síntesis de las lecturas SQL de escritorio/móvil](evidencias/etapa-3-incremento-3-e2e.json),
sin configuración de conexión ni credenciales.

- [Seis confirmadas y cuatro abordadas, sin salida](capturas/etapa-3-incremento-3-e2e-01-listo-sin-salida.png).
- [Salida explícita para recogidas, cuatro a bordo](capturas/etapa-3-incremento-3-e2e-02-salida-recogidas.png).
- [Palmar: seis abordadas, todavía en recogidas](capturas/etapa-3-incremento-3-e2e-03-palmar-seis-abordados.png).
- [Trayecto principal iniciado](capturas/etapa-3-incremento-3-e2e-04-viaje-principal.png).
- [Llegada final, antes de observar descensos](capturas/etapa-3-incremento-3-e2e-05-llegada-final.png).
- [Descensos finalizados y contador cero](capturas/etapa-3-incremento-3-e2e-06-descensos-finalizados.png).
- [Palmar en móvil con los tres contextos emulados](capturas/etapa-3-incremento-3-e2e-palmar-movil.png).

Cambios de código únicamente en el arnés de pruebas: scripts/test-postgres.mjs,
scripts/test-web.mjs, tests/web/operations.spec.mjs, operation-permissions.spec.mjs
y support/operation-browser.mjs / operation-evidence.mjs. Documentación/evidencias
en este informe, la síntesis JSON y las capturas. No se modifica código de producto,
dependencias, configuración de CI ni las migraciones 001–024.

Este resultado verifica el recorrido solicitado **en laboratorio**. No acredita
seguridad de una carretera o parada real, presencia física, verificación documental,
GPS, cobros ni habilitación comercial. No se activaron notificaciones, cancelaciones
por ausencia, servicios externos o despliegues. Se conservan los límites y decisiones
del informe original; no se inicia el incremento 4 ni se fusiona ningún PR.
