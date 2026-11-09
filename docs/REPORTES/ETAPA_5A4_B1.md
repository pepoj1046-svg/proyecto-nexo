# 5A.4-B1 — Sesiones independientes por documento

Base funcional exacta: `3d16680f491ff2c516eb1796b0954a717b49a153`.
Rama: `desarrollo/etapa-5a4-b1`. Diseño incorporado sin merge desde
`076662c5490834b5e08bb5dd101caaad4866a360`, PR #10.

## Primer incremento verificable

- La cookie HttpOnly/SameSite identifica únicamente un contenedor del navegador.
  No contiene ni selecciona una cuenta. Iniciar/cerrar sesión no cambia su valor.
- Cada documento obtiene un selector UUID, generación y CSRF independiente;
  solo una autenticación real vincula el token SQL a ese contexto. El token SQL
  nunca sale del servidor. Las pruebas del cliente permanecen en memoria.
- Un GET `/api/session` sin selector crea un contexto **anónimo nuevo**; no puede
  descubrir secretos autenticados mediante la cookie o un selector conocido.
- Todos los POST privados de la tabla fija del gateway y los GET privados
  comprueban contexto y prueba. Las operaciones privadas revalidan sesión SQL
  antes/después de ejecutar el servicio. La generación se comprueba tras esperas.
- Login concurrente usa sustitución condicionada al contexto observado; el token
  no instalado se revoca. Logout elimina exclusivamente el contexto seleccionado.
- El cliente descarta continuaciones de una generación anterior. `pagehide`
  oculta el árbol privado antes de restauración, invalida pruebas RAM y conserva
  montados los controladores de intenciones. Para desbloquear exige contraseña
  de la cuenta original, sin reproducir comandos automáticamente.
- Recuperación 5A.2 adaptada al 401 explícito del nuevo contrato de sesión, sin
  cambiar claves, cuerpos, recibos ni las reglas de negocio.

## Validaciones ya ejecutadas en el primer avance

- TypeScript y compilación web aprobados.
- 104 pruebas unitarias aprobadas (incluidas nueve de contextos, concurrencia,
  límites, CSRF y revocación).
- Cinco pruebas dirigidas PostgreSQL 18.4 aprobadas: F09, W07, W08, O07, Z07.
- Dirigidas Chromium escritorio: dos de reservation-session, una de
  reservation-identity-read y una de private-account-read aprobadas.
- Batería completa `npm run test:all`: 104 unitarias y 409 integraciones
  PostgreSQL 18.4 aprobadas; runner de salida y listeners locales aprobados.
- 18 E2E dirigidas de escritorio aprobadas. Siete nuevos escenarios B1 incluyen
  pestañas del mismo BrowserContext, bootstrap simultáneo, cookie/selector sin
  prueba, pérdida de respuesta tras COMMIT, recibo conocido y restauración.
- La prueba determinista de pagehide/pageshow protege DOM y respuestas tardías.
  La navegación real atrás/adelante exigió contraseña, pero Chromium 154 recargó
  el documento: `response-cache-control-no-store` y
  `response-cache-control-no-store-with-js-network-request`. No se declara
  verificada una restauración real de bfcache en ese entorno.
- Las regresiones antiguas se adaptaron al rechazo 401 de selectores caducados
  y a la autenticación obligatoria tras recargas. Se mantienen los testigos SQL
  y las aserciones de grupos, capacidad, tarifas y cantidad de escrituras.
- Se separaron las familias E2E B1 en tres laboratorios aislados para respetar
  los límites existentes de tráfico y autenticación, sin alterarlos.

## Verificación final y dictamen

Los resultados anteriores corresponden a ejecuciones realizadas. La regresión
web completa y los checks remotos se ejecutan después de estabilizar el candidato.
El **informe final del PR #11**, publicado sobre el SHA exacto verificado, debe
confirmar sus resultados y enlazar los runs antes de proponer el cierre:
[PR #11](https://github.com/pepoj1046-svg/proyecto-nexo/pull/11),
[checks](https://github.com/pepoj1046-svg/proyecto-nexo/pull/11/checks).
No se certifica CI de un commit usando resultados de un commit anterior.

Propuesta condicionada: revisar el cierre exclusivamente de B1 si la regresión
completa y CI/CodeQL resultan satisfactorios, manteniendo la limitación explícita
de bfcache real cuando el navegador no lo restaura. Ni este documento ni los
checks autorizan producción, merge o el inicio de B2/B3.

No se añadieron migraciones, almacenamiento persistente, tickets, endpoints de
recuperación de recibos ni reglas de negocio. No se inició B2/B3.

## Contrato de transporte y endpoints protegidos

`X-Nexo-Document` selecciona un UUID opaco; `X-Nexo-Generation` selecciona su
versión y `X-CSRF-Token` demuestra la prueba propia del contexto. Ningún ID es
una credencial suficiente. El servidor liga el contexto al contenedor HttpOnly.
La comparación de CSRF usa longitud fija y `timingSafeEqual`.

| Superficie | Comportamiento |
| --- | --- |
| GET `/api/session` sin selector | Nuevo documento anónimo; no recupera secretos ni cuentas de documentos anteriores. |
| GET `/api/session` con selector | Prueba propia y contexto vigente; valida SQL si está autenticado. |
| POST `/api/login` | Prueba anónima o vigente más contraseña real; cambia generación y CSRF del documento, sin rotar la cookie común. |
| POST `/api/logout` | Prueba propia; revoca el token SQL seleccionado y retira ese documento, sin borrar la cookie común. |
| GET `/api/passenger/bookings`, `/api/operator/offers` | Autenticación, CSRF y validación posterior; sin degradación a acceso por cookie. |
| 49 POST de negocio | Tabla fija `authenticated(...)`: CSRF, contexto vivo, sesión SQL antes y después del servicio existente. |
| Catálogo público | Únicamente `/api/localities`, `/api/availability`, `/api/points`, `/api/segment`; contratos sin cambios. |

Familias de los POST privados: `platform/{context,page,command}`;
`route-config/{context,page,detail,command}`;
`fleet-admin/{context,page,command}`;
`driver-admin/{context,history,command,contact}`; `directory/page`;
`care/{context,list,code,review,accounts,command}`;
`safety/{handoffs,context,command,report}`;
`conditions/{context,route,declare,command}`;
`reservations/{page,quote}` y `/api/reservations`;
`management/{detail,command}`; `operator/accept`;
`operations/{overview,snapshot,command}`;
`recovery/{overview,detail,passenger,transfer,command}`;
`terminal/{directory,sale-context,quote,walk-in,return-options,command}`.

Selector desconocido/caducado, generación antigua o contenedor distinto: 401.
Contexto válido con CSRF omitido/incorrecto: 403. Un POST sin selector tampoco
puede autenticarse mediante la cookie: 403. Los endpoints heredados mantienen
sus controles de rol propios después de comprobar la nueva prueba.

## Implementación y conservación de contratos

- [web-sessions.mjs](../../src/http/web-sessions.mjs): dos mapas RAM acotados,
  contenedores sin actor y contextos independientes. Comparación de identidad
  de la entrada antes/después de esperas; una respuesta SQL antigua no instala
  una generación que ya perdió vigencia. Login concurrente instala un solo
  resultado y trata de revocar el token SQL no instalado.
- [web-gateway.mjs](../../src/http/web-gateway.mjs): guardias centrales en las
  tablas de handlers; validación anterior/posterior sin aceptar un token SQL
  suministrado por el navegador. Roles y RLS siguen en los servicios existentes.
- [private-api.ts](../../apps/web/src/private-api.ts): prueba por módulo/documento
  solo en RAM, cola local de autenticación, cabeceras en GET/POST privados,
  descarte de respuestas de revisiones anteriores. Nunca corrige silenciosamente
  un CSRF explícito inválido. Solo el formulario de contraseña puede solicitar
  un bootstrap nuevo tras 401/403; no se reenvía un comando de negocio.
- [main.tsx](../../apps/web/src/main.tsx): ocultación síncrona en pagehide y puerta
  de reautenticación en pageshow.persisted. Conserva montadas las intenciones
  protegidas; sin ellas, vuelve a montar una vista limpia para consultar de nuevo
  en lugar de publicar una caché privada antigua. La cuenta equivocada no abre
  la vista retenida. Login no ejecuta movimientos físicos.
- [reservation-attempt.ts](../../apps/web/src/reservation-attempt.ts): el 401
  explícito vuelve a la recuperación de la cuenta original sin perder clave,
  cuerpo o recibo. No se recalcula ni reconstruye la intención.
- [Functional.tsx](../../apps/web/src/Functional.tsx): una consulta propia que
  pierde autoridad limpia sus filas y permite autenticación explícita.
- Helpers E2E observan el intercambio HTTP real en un WeakMap por Page, solo en
  RAM del test. No exponen credenciales mediante globals, endpoints o hooks de
  producción. Cambiar la cuenta por API en una prueba ya no transfiere autoridad
  a la aplicación: necesita reautenticación explícita.

No hay cambios en servicios de negocio, SQL, migraciones, dependencias, permisos
ni modelos de capacidad. `git diff 3d16680 -- database/migrations` está vacío.
No se añadieron tickets, almacenamiento persistente, endpoints de recibos,
reintentos automáticos, service workers ni comunicaciones externas.

## Cobertura y límites del dictamen

- El caso post-COMMIT retiene/aborta únicamente la respuesta tras ejecutarla
  contra el gateway/SQL auténticos. Mientras tanto otra pestaña del mismo
  BrowserContext autentica, recarga y cierra sesión. El intento original conserva
  cuenta, cuerpo y clave y el replay manual obtiene el mismo estado SQL.
- El caso de recibo conocido falla la consulta posterior, conserva el recibo y
  recupera únicamente lecturas después de los cambios de la otra pestaña.
- Testigos SQL independientes y read-only comparan acciones, reservas completas,
  grupo, segmentos, importes/versiones, eventos, movimientos y estado del viaje.
  Una sola acción por clave; ninguna fila con ocupación superior a seis.
- PostgreSQL verifica tokens distintos de cuentas distintas en el mismo
  contenedor; logout de B revoca únicamente B, A conserva acceso y la caducidad
  nativa de A vuelve a rechazarlo. No se exportan esos tokens al navegador.
- Pruebas unitarias controlan logout durante una validación SQL demorada, login
  concurrente, expiración, límites, pruebas copiadas y respuestas tardías. Las
  regresiones anteriores mantienen concurrencia/rollback de inventario y roles.
- Dos aperturas iniciales sin cookie pueden generar contenedores distintos. La
  cookie final solo permite uno de esos contextos; el otro falla cerrado antes
  de autenticar. El acceso manual posterior establece contextos independientes.
  No se oculta esa carrera mediante un login automático.
- Los escenarios de tickets/30 minutos del diseño quedan fuera de B1. No se
  afirma que todos los escenarios del diseño completo estén implementados.

## Riesgos y límites conservados

1. Laboratorio local efímero. Sin habilitación productiva, almacenamiento de
   recibos tras recarga ni recuperación persistente. Una recarga real pierde
   el cuerpo RAM de un intento; no prueba cancelación ni libera inventario.
2. bfcache real depende del navegador. El gate determinista y la recarga por
   historial se verifican; el informe registra por separado si Chromium llegó
   efectivamente a restaurar un documento congelado. No se retira `no-store`
   para forzar ese resultado.
3. Un XSS activo del mismo origen, malware o robo de una capacidad completa
   supera este aislamiento. No se afirma atestación física de una pestaña.
4. Cambiar el contexto HTTP no revierte un COMMIT SQL autorizado previamente.
   Una respuesta descartada mantiene un resultado incierto o un recibo conocido
   según lo que realmente recibió la máquina RAM. No hay cancelación implícita.
5. Contextos abandonados caducan en RAM; no hay logout global por pagehide ni
   llamadas best-effort de negocio al abandonar la página. Los tokens SQL
   conservan su caducidad nativa máxima de una hora, sin renovación por lecturas.
   Bootstrap anónimo dura quince minutos; no expulsa documentos activos al llegar
   al límite. Las pruebas no cambian los límites de tráfico/autenticación.
6. Al borrar/expirar la cookie o reiniciar el laboratorio no se reutiliza un
   contexto antiguo. Se exige contraseña; no se apropia una reserva por referencia.

## Reproducción local (PowerShell o bash)

Con las dependencias fijadas ya instaladas y las herramientas locales existentes:

```text
npm run web:build
node --test tests/web-sessions.test.mjs tests/web-auth-order.test.mjs tests/reservation-attempt.test.mjs
node scripts/test-postgres.mjs --test-name-pattern=B1-01
node scripts/test-web.mjs --suite=document-sessions.spec.mjs,document-recovery.spec.mjs,document-restoration.spec.mjs --project=desktop
node scripts/test-web.mjs --suite=document-sessions.spec.mjs,document-recovery.spec.mjs,document-restoration.spec.mjs --project=mobile
npm run test:all
npm run test:web
```

Los runners generan PostgreSQL y cuentas ficticias nuevos y cierran sus procesos.
Para comprobar manualmente: `npm run dev:web`; abrir dos pestañas del URL local
indicado, autenticar cuentas ficticias diferentes y verificar que recargar/cerrar
sesión en la segunda no cambia la primera. Tras recargar hay que volver a iniciar
sesión. Ctrl+C detiene el gateway y PostgreSQL. No usar una base externa.

Evidencias locales: `.local/5a4-b1-evidence/` (PNG y JSON sin pruebas de sesión),
`.local/5a3-evidence/` y logs ignorados por Git. CI publica únicamente esos
subdirectorios de evidencia ficticia; no publica accesos, cookies o trazas completas.
Los filtros de ambos workflows incluyen el destino `desarrollo/etapa-5a3` para
este PR; matrices, timeouts, retries y límites siguen sin cambios.

## Incidencia de regresión detectada durante la batería completa

`conditions-request.spec.mjs` esperaba consultar la cancelación pendiente después
 de `p.reload()` mediante la cookie compartida. Reproducción: la nueva página
muestra correctamente el formulario anónimo y ninguna reserva; por eso falló la
aserción antigua. Se añadió autenticación manual de la misma cuenta y se mantuvo
la comprobación de solicitud pendiente, rechazo/CSRF, cancelación administrativa,
precio original de 140 BOB, auditoría y capacidad. La prueba dirigida real pasó.
No se cambió el comportamiento de las condiciones ni la política de cancelación.
La matriz del candidato anterior puede conservar ese fallo; únicamente los
checks del SHA final sirven para el dictamen.
