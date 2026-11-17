# 5A.4-B3 — consulta de una reserva APP tras recargar

Estado: implementación de laboratorio para revisión. La rama se sube sin PR; el revisor
abre el PR en borrador por API hacia `desarrollo/etapa-5a4-b2`. **No** autoriza
producción, despliegue, fusión ni el siguiente incremento.
Base exacta: `dd66b8f1eb81c199b1c7426a870e20894b667fad` (`desarrollo/etapa-5a4-b2`, B2
ratificada con la corrección 042). Rama: `desarrollo/etapa-5a4-b3`, hacia
`desarrollo/etapa-5a4-b2`. Contratos: [propuesta B3](../ETAPA_5A4_B3_PROPUESTA.md) y
[diseño 5A.4-A](../ETAPA_5_RECUPERACION_TRAS_RECARGA.md), §7 y §8.

Decisiones del propietario aplicadas (16-11-2026): **D1** alcance del §2 (solo APP, solo
lectura); **D2 opción B** (regeneración controlada de la época); **D3** no iniciar una
reserva APP nueva mientras una referencia restaurada de la misma cuenta no se haya
consultado al menos una vez ni descartado. D4: implementado en Claude Code con
instalación local de paquetes.

## Recorrido y reutilización

Panel «Operación anterior» → `recovery-store.ts` → `POST /api/recovery/receipt` (B2) →
`createWebAppReceiptService` → RPC `nexo.web_app_reservation_receipt` (042) y, para el
estado actual, `POST /api/reservations/page` → `nexo.web_bookings_page`. **No hay SQL,
migración, endpoint ni inventario nuevos**; 001–042 quedan intactas (`git diff dd66b8f --
database` vacío). B3 no reenvía, no reconstruye el cuerpo y no crea reservas: la máquina
de estados no tiene ninguna dependencia de escritura.

## Implementación

**Lectura tras el gate** (`apps/web/src/recovery-ticket.ts`). `readRecoveryTickets` no
lee `sessionStorage` mientras el documento sea anónimo o esté bloqueado: ni cuenta, ni
número de referencias. Tras autenticar devuelve solo los tickets de la cuenta y el
entorno actuales. Los de otra cuenta se borran sin mostrarse. Los de la misma cuenta y
otra ejecución se conservan únicamente como clave opaca en RAM para mostrar «Inválida».
Un ticket guardado por el propio documento pertenece a su intento vivo y nunca aparece
como restaurado. Almacenamiento corrupto o bloqueado: fallo cerrado y aviso tras el gate.
El reloj local solo oculta una referencia evidentemente vencida; la validez la decide el
servidor.

**Máquina de estados** (`apps/web/src/recovery-consult.ts`, nuevo). Estados del §7:
Lista, Consultando, Incierta, Recibo, LecturaPendiente, Actualizada, Revisión, Inválida
y Autenticar; Cerrada equivale a retirar la vista. Consulta manual, una a la vez por
referencia. `RECORDED` → recibo histórico y lectura paginada del estado actual (máximo
10 páginas de 50); con todas las reservas encontradas → Actualizada y retiro del ticket;
si falla o no aparecen todas → LecturaPendiente con ticket conservado. `NOT_OBSERVED`
→ Incierta, nunca rollback. 401 → gate B1 con la cuenta original; 403 → Revisión;
410 o ticket inválido → Inválida con limpieza local; 429/503/transporte → incertidumbre
sin contar como consultada. Toda respuesta tardía tras logout, cambio de cuenta, A→B→A
o descarte se descarta por generación. Se separó de `RecoveryPanel.tsx` para probarla
sin React (desviación menor respecto a la lista de archivos de la propuesta).

**Panel** (`apps/web/src/RecoveryPanel.tsx`, nuevo; montado en `/pasajero` y `/reservar`).
Textos del §7, `role=status`/`aria-live=polite` para el progreso, `role=alert` para los
errores, descarte con la confirmación del §7 y foco contenido en la referencia. Sin
consultas automáticas por `online`, `pageshow`, temporizador ni cambio de pestaña.

**D3** (`Functional.tsx`). «Registrar solicitud» queda deshabilitado, con explicación, si
la cuenta tiene una referencia restaurada en Lista/Consultando/Incierta/Autenticar que
nunca recibió una clasificación del servidor. Reintentar el mismo intento en RAM no se
bloquea. Es una salvaguarda de interfaz por pestaña, no una regla del servidor.

**D2-B** (`src/http/recovery-tickets.mjs`, `web-gateway.mjs`, `web-sessions.mjs`). Tras
un error de pool o conexión, un fallo del marcador o una anomalía de reloj, la época
queda inválida como en B2. La **siguiente** petición protegida vuelve a comprobar el
marcador de base (`pg_postmaster_start_time()` y OID) y solo si coincide con el original
crea una época nueva: secreto, `environmentId` y ancla monotónica nuevos. El secreto
anterior se pierde, así que un ticket viejo no vuelve a valer ni reetiquetándolo. Sin
temporizador ni bucle; las peticiones concurrentes comparten una sola comprobación; un
postmaster u OID distinto mantiene el bloqueo hasta reiniciar el gateway. Las sesiones
publican el `environmentId` vigente y el cliente, al detectar el cambio en
`/api/session`, bloquea el documento (`suspendDocument`) para que vuelva a autenticarse
con la cuenta original. Efecto operativo: tras una regeneración, cada pestaña abierta
pide iniciar sesión una vez antes de reservar.

**CI**: `desarrollo/etapa-5a4-b3` añadida a `pull_request.branches` de
`etapa-1-tests.yml` y `codeql.yml` (commit aparte).

## Pruebas

| Ámbito | Archivo | Casos nuevos |
| --- | --- | --- |
| Unitarias, lectura | `tests/recovery-restore.test.mjs` | 8: gate, cuenta/entorno, vencimiento exacto, versión/campos/tamaño/duplicados, bloqueo, intento vivo, RAM de otra ejecución, corrupción |
| Unitarias, máquina | `tests/recovery-panel.test.mjs` | 12: transiciones, T14, paginación acotada, errores, T23, T15/T20, cuenta/entorno, respuestas inválidas, descarte |
| Unitarias, época | `tests/recovery-tickets.test.mjs` | 3: no-op válida, regeneración sin resurrección, reanclaje de reloj, id distinto |
| PostgreSQL 18.4 | `tests/integration/postgres.test.mjs` | B3-01 regeneración y reserva nueva; B3-02 marcador distinto; B3-03 concurrencia |
| E2E | `tests/web/recovery-panel-{receipt,guard,sessions,late,storage,tabs}.spec.mjs` | 10 por proyecto: T12/T24 y T14 (receipt); D3 y T25 (guard); T13 y T23 (sessions); T15/T20 (late); T16/T19 y T21 (storage); T18 (tabs) |

En B3-01..03 solo la consulta del marcador puede alterarse mediante un proxy del pool;
el resto llega a PostgreSQL real. Las E2E usan un testigo SQL independiente de solo
lectura y como únicas intervenciones respuestas perdidas o retenidas y luego entregadas.
T19 en E2E reproduce la referencia de otra época en la misma pestaña reescribiendo su
`environmentId`; la regeneración real se prueba por HTTP en B3-01. T17 (bfcache nativo)
no tiene caso nuevo: el panel vive dentro del contenido que B1 ya oculta y su almacén se
vacía al suspender el documento; se cubre con las regresiones nativas existentes.

Las cifras finales, separadas por entorno, se registran en la sección siguiente, ligadas
al SHA verificado.

## Comportamientos confirmados a petición del revisor

**Lectura actual acotada sin resultado.** Si tras `MAX_CURRENT_PAGES` = 10 páginas de 50
(o al agotarse el cursor) no aparecen todas las reservas del recibo, la referencia queda
en **LecturaPendiente**: conserva el recibo histórico, **no retira el ticket**, puede
volver a consultarse manualmente con la misma referencia y deja de bloquear D3 (el
servidor ya la clasificó). Textos: «El servidor confirmó un registro anterior; falta
consultar su estado actual» y «La consulta actual no incluyó todas las reservas del
registro. Vuelve a consultar más tarde». No mencionan cancelación, anulación, rollback,
fallo ni liberación. Prueba: `tests/recovery-panel.test.mjs`, caso «bounded walk»: 10
lecturas exactas, `retire` sin llamadas, recibo conservado, expresión regular negativa
sobre esas palabras y segunda consulta manual con el mismo ticket.

**Una consulta a la vez (T23).** Durante la consulta el botón queda deshabilitado
mediante `aria-disabled="true"` (anunciado y atenuado) y no con el atributo nativo
`disabled`, porque este expulsa el foco de teclado (defecto detectado por T25). El clic
se ignora en dos niveles: el `onClick` del botón y `RecoveryStore.consult`, que vuelve
sin hacer nada si la referencia está ocupada o en Consultando. Pruebas: unitaria T23
(seis llamadas seguidas → una petición de recibo) y E2E T23 (doble clic real → una
petición de recibo y una de sesión; `aria-disabled="true"` durante la espera).

**Sin consultas automáticas ni polling.** Revisión del código: el único llamante de
`recoveryStore.consult` es el `onClick` de «Consultar resultado»; `recovery-consult.ts`,
`recovery-store.ts`, `RecoveryPanel.tsx` y `recovery-ticket.ts` no contienen
`setInterval`, `setTimeout`, `requestAnimationFrame` ni oyentes de `online`, `pageshow`,
`visibilitychange`, `focus` o `storage`; la sincronización al cambiar la sesión solo lee
`sessionStorage`, sin red. Medición: T23 exige **cero** peticiones `/api/` durante cinco
segundos de inactividad con la referencia en Incierta, después de disparar `online`,
`focus`, `pageshow` y `visibilitychange`; T12 comprueba cero consultas de recibo tras
`online` y `visibilitychange`.

## Peticiones por recorrido y límite global de 120/min

El gateway cuenta **todas** las peticiones `/api/` (incluido `GET /api/session`) en una
ventana fija de 60 s, global para todo el listener, más seis simultáneas. El límite no
se modificó. Coste del panel por pulsación, por construcción y confirmado por la medición:

| Resultado de la consulta | Peticiones |
| --- | --- |
| `NOT_OBSERVED`, 401/403/410, 429/503 | 2: `/api/session` + `/api/recovery/receipt` |
| `RECORDED`, reservas en la primera página | 5: sesión, recibo, sesión, `/api/reservations/page`, sesión |
| `RECORDED`, primera lectura actual fallida (T14) | 4 |
| Peor caso acotado (10 páginas sin encontrar el grupo) | 23, una sola vez por pulsación manual |

Medición local por E2E (contador de cada petición `/api/` emitida por cualquier página
del contexto de la prueba, incluidas las abortadas: cota superior de lo que llega al
gateway). Cifras idénticas en escritorio y móvil salvo ±1 por el orden de carga de «Mis
reservas»; «preparación» es búsqueda, login, cotización y el envío perdido; «gate» es
recarga, apertura anónima y login con la cuenta original.

| E2E | Total | Preparación | Gate | Panel y resto | Recibo | Duración |
| --- | --- | --- | --- | --- | --- | --- |
| T12/T24 | 26 | 16 | 4 | 6 (5 de la consulta `RECORDED` + 1 de «Mis reservas») | 1 | 2,5–2,8 s |
| T14 | 29–30 | 16 | 4 | 9–10 (4 + 5 de dos pulsaciones) | 2 | 2,1–2,2 s |
| D3 | 36 | 36 (dos flujos de reserva, uno incierto y uno registrado) | — | — | 1 | 2,6 s |
| T25 | 23 | 16 | 5 | 2 | 1 | 3,4–4,7 s |
| T13 | 25 | 16 | 5 | 4 (2 pulsaciones × 2) | 2 | 2,3–2,6 s |
| **T23** | **23** | 16 | 5 | **2** (doble clic = una consulta) y **0** en 5 s inactivos | **1** | 1,6–1,7 s |
| T15/T20 | 52 | 16 | 9 | 27 (incluye el flujo completo de la segunda pestaña de T20) | 2 | 4,6–4,8 s |
| T16/T19 | 52 | 16 | 26 (dos pestañas, tres logins) | 10 | 0 | 4,7–4,9 s |
| T21 | 21 | 16 | 5 | 0 | 0 | 1,6 s |
| T18 | 26 | 26 (incluye la pestaña duplicada) | — | — | 1 | 2,2–2,4 s |

Ningún recorrido individual se acerca al límite: el máximo es 52 (43 %) y corresponde a
pruebas con dos flujos completos en dos pestañas; el panel aporta de 0 a 10 peticiones
por prueba. Lo que sí se acercaba era la **suma de una suite**, porque cada suite comparte
un único gateway y su ventana de 60 s: con cuatro pruebas, `receipt` sumó 114 en ~13 s y
`sessions` 100. La suite original de seis pruebas superó 120 y recibió 429 «Muchas
consultas seguidas» en búsqueda y login, no en el panel. Se repartieron en seis suites,
medidas por proyecto: receipt 51–56, guard 59, sessions 48, late 52, storage 73 y tabs
26 peticiones. Los registros por prueba quedan en `.local/5a4-b3-evidence/requests/`
(no se publica `.local`).

## Resultados

Todo lo siguiente se ejecutó **en local** (Windows 11, Node 24.21.0, npm 11.19.0,
PostgreSQL 18.4 embebido, Chromium de Playwright 1.64.1), sin subir timeouts ni retries
(`retries:0`, `workers:1`). **CI no se ha ejecutado para esta rama**: la rama se sube sin
PR y el revisor abre el PR por API; la matriz CI (Ubuntu/Windows, Node 22/24) y CodeQL
del SHA final quedan pendientes y no se dan por aprobadas.

| Batería | SHA | Resultado local |
| --- | --- | --- |
| `npm run test:all` completo | `a72e8a3` | código 0: unitarias 137/137; `test:integration` (web:check, build y PostgreSQL) 424/424; `test:runner` correcto (propaga el código 9 del hijo); `test:local-api` correcto |
| `npm test` repetido tras reforzar una unitaria | `1232502` | 137/137 |
| PostgreSQL dirigidas B2-01..11 y B3-01..03 | `0973953` | 15/15 |
| E2E B3 dirigidas, seis suites | `0947f1e` | escritorio 10/10, móvil 10/10; receipt además 3 ejecuciones seguidas por proyecto, 2/2 cada una |
| `npm run test:web` completo | `0947f1e` | código 0 en ~49 min: 57 suites por proyecto, cada una con su gateway y PostgreSQL detenidos correctamente; escritorio 111/111 y móvil 111/111 (101 de B2 + 10 de B3), sin `skipped` ni `flaky`; cierre (IPC Windows, puertos verificados) y reinicio real correctos |

Entre `a72e8a3` y `0947f1e` el código de la aplicación (`src/`, `apps/`, `database/`) no
cambia: solo pruebas E2E, una unitaria y la lista de suites de `scripts/test-web.mjs`.
Las 424 PostgreSQL son las 421 de B2 (CI del PR #13) más B3-01..03.

## Incidencias de desarrollo

- La primera versión del panel deshabilitaba y desmontaba el botón durante la consulta,
  y el foco saltaba al título. Lo detectó la E2E de teclado (T25); se usa `aria-disabled`
  y el botón permanece montado. Defecto corregido, no ocultado.
- Una suite E2E con seis casos superó el límite global de 120 solicitudes por minuto del
  gateway (429 «Muchas consultas seguidas» en búsqueda y login). No se modificó el
  límite: se midió cada recorrido (sección anterior) y se repartieron las pruebas en seis
  suites, cada una con su propio gateway y base.
- T12 comprobaba la ausencia del id de reserva en toda la página antes de consultar; tras
  el login, «Mis reservas» de la cuenta original puede listarla (vista B1 existente) y la
  aserción solo pasaba si esa lista aún no había cargado. Falló una vez en móvil. Es un
  defecto de la prueba, no del panel: la comprobación se acotó al panel (sin id ni
  «Registro histórico» antes de la consulta) y la suite aprobó tres veces seguidas en
  ambos proyectos.
- Las pruebas PostgreSQL dirigidas necesitan `apps/web/dist`; `test:integration` ya lo
  construye.

## Riesgos y límites

- D3 es local a la pestaña: otra pestaña o dispositivo sin la referencia no la ve. El
  servidor no impide una reserva nueva; la idempotencia sigue siendo por clave.
- Un reloj local adelantado puede mostrar como «Inválida» una referencia aún válida: el
  usuario pierde la ayuda local, nunca una reserva; «Mis reservas» sigue disponible.
- Una referencia «Inválida» por cambio de época pudo haberse registrado: el texto lo
  dice («No se canceló ninguna operación») y remite a «Mis reservas».
- Un intento en RAM con ticket de la época anterior recibe 410 al reintentar y queda
  incierto, como en B2 tras un reinicio; no se reemite ticket automáticamente.
- La regeneración no cubre una restauración en caliente bajo el mismo postmaster y OID
  (fuera de soporte desde B2). `sessionStorage` copiado y XSS siguen siendo límites del
  diseño: el ticket no sustituye a la autenticación.
- Laboratorio únicamente: sin producción, pagos, GPS, comunicaciones ni datos reales.

## Reproducción Windows

```powershell
npm ci --no-fund
npm approve-scripts esbuild@0.28.2 @embedded-postgres/windows-x64@18.4.0-beta.17
npm rebuild esbuild @embedded-postgres/windows-x64
npm run test:all
npx --no-install playwright install chromium
node scripts/test-web.mjs --suite=recovery-panel-receipt.spec.mjs,recovery-panel-guard.spec.mjs,recovery-panel-sessions.spec.mjs,recovery-panel-late.spec.mjs,recovery-panel-storage.spec.mjs,recovery-panel-tabs.spec.mjs
npm run test:web
```

`npm approve-scripts` escribe `allowScripts` en `package.json`; ese cambio local no se
sube. `npm run dev:web` crea una base ficticia: tras reservar con la respuesta perdida
y recargar, «Mis reservas» muestra «Operación anterior» solo después de iniciar sesión
con la cuenta original.

## Pendientes del propietario

- Revisión y ratificación de B3; integración de la cadena de PR en `main` (fuera de
  alcance, §6 de la propuesta).
- `AGENTS.md` sigue indicando B2 como último incremento ratificado; actualizarlo tras
  la ratificación de B3.

## Ratificación del propietario (17-11-2026)

El propietario ratifica B3 **solo para laboratorio**, tras la auditoría del PR #16
(dictamen: aprobado con pendientes). El CI de `b5ebf13` dio 14/14 en verde: 137 unitarias
y 424 de PostgreSQL por combinación, 111 E2E por trabajo web y CodeQL. No autoriza
producción, despliegue ni el incremento 5A.5.

Pendientes aceptados (decisión del propietario, no defectos):
1. D3 se desbloquea con una sola consulta, aunque devuelva `NOT_OBSERVED`.
2. D3 es una salvaguarda de interfaz por pestaña; el servidor no la impone.
3. Regenerar la época obliga a reautenticar todos los documentos abiertos.
4. Un reinicio de PostgreSQL (postmaster u OID distinto) sigue bloqueando las reservas APP
   hasta reiniciar el gateway. Debe resolverse antes de cualquier piloto.
5. Un ticket en `sessionStorage` no protege frente a XSS (heredado de B2).
