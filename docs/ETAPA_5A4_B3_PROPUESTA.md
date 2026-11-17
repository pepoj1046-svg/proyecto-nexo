# 5A.4-B3 — Propuesta: restaurar la consulta de una reserva APP tras recargar

Estado: **propuesta para revisión del propietario; nada implementado ni autorizado**.
Fecha: 16 de noviembre de 2026. Base: `desarrollo/etapa-5a4-b2` en `b6b8da2`
(B2 ratificada solo para laboratorio, con la corrección 042 del PR #13).

Esta propuesta no repite el diseño 5A.4-A. Toma su máquina de estados (§7), sus
mensajes y su matriz de pruebas (§8) en [ETAPA_5_RECUPERACION_TRAS_RECARGA.md](ETAPA_5_RECUPERACION_TRAS_RECARGA.md),
y concreta lo que falta después de B1 y B2.

## 1. Punto de partida comprobado en `b6b8da2`

| Pieza | Estado |
| --- | --- |
| Gate por documento, `pagehide`/`pageshow`, reautenticación (B1) | Implementado: `main.tsx`, `private-api.ts`. |
| Ticket firmado de 30 min, emitido y guardado antes del POST (B2) | Implementado: `recovery-ticket.ts`, `reservation-attempt.ts`, `recovery-tickets.mjs`. |
| `POST /api/recovery/receipt` y RPC `web_app_reservation_receipt` (B2) | Implementado y probado por HTTP y SQL. |
| Leer los tickets de `sessionStorage` tras recargar | **No existe.** B2 solo escribe y retira tickets. |
| Interfaz que consulte el recibo de una referencia restaurada | **No existe.** Ningún componente llama a `/api/recovery/receipt`. |
| Salida del bloqueo cuando se invalida la época de tickets | **No existe.** Pendiente aceptado en la ratificación de B2. |

## 2. Alcance propuesto

Solo reservas APP (QUEUE y ENROUTE, incluidas las de expreso y las divididas), en
lectura. **B3 no reenvía, no reconstruye el cuerpo ni crea reservas.**

1. **Lectura tras el gate.** Una función nueva en `recovery-ticket.ts` lee el
   namespace `nexo.lab.recovery.v1` solo después de que el documento se
   autentique con la cuenta del ticket y en el mismo `environmentId`. Antes de
   eso no se muestra nada: ni la cuenta, ni el número de referencias, ni la ruta.
   Los tickets de otra cuenta o de otro entorno se descartan localmente sin
   consultar (la limpieza ya existe en `cleanRecoveryStorage`).
2. **Panel "Operación anterior"** en `/pasajero` y en `/reservar`. Se monta con
   cada ticket vigente de la cuenta autenticada. Los estados y los textos son los
   del §7 del diseño (Lista, Consultando, Incierta, Recibo, LecturaPendiente,
   Actualizada, Revisión, Inválida y Cerrada), sin estados nuevos de reserva.
3. **Consulta manual.** El botón "Consultar resultado" hace
   `POST /api/recovery/receipt` con el ticket. No hay consultas automáticas por
   `online`, `pageshow`, temporizador ni cambio de pestaña. Las consultas van una
   a la vez por ticket.
4. **Respuestas:**
   - `RECORDED`: muestra el recibo histórico (grupo, referencias, estado original)
     y consulta el estado actual con `/api/reservations/page`, que ya existe.
     Cuando la consulta autorizada termina, retira el ticket.
   - `NOT_OBSERVED`: pasa a Incierta y permite volver a consultar. No equivale a
     rollback, y no aparece ningún botón de "reservar otra vez".
   - 401: vuelve al gate. 403 (`RECOVERY_UNAVAILABLE`): Revisión.
     410 (`RECOVERY_TICKET_EXPIRED` / `ENVIRONMENT_CHANGED`): Inválida, con limpieza local.
5. **Descarte explícito**, con la confirmación del §7: borra solo la ayuda local,
   y ni cancela ni libera plazas.
6. **Época de tickets:** ver §3.

No se prevé ninguna migración. Si durante la implementación hiciera falta SQL
nuevo, se detiene esa parte y se consulta al propietario; la siguiente sería la 043.

## 3. Decisión pendiente aceptada en B2: época de tickets bloqueada

Hoy, un error de pool o conexión, un fallo del marcador de base o un salto de
reloj de más de un segundo invalidan la época **hasta reiniciar el gateway**, y
`/api/reservations` exige ticket válido. Durante ese intervalo no se pueden
registrar reservas APP.

| Opción | Efecto | Recomendación |
| --- | --- | --- |
| A. Mantener | B3 solo muestra «Inválida» con claridad. Las reservas APP siguen bloqueadas hasta reiniciar. | Aceptable en laboratorio, pero la pantalla de B3 acabaría pidiendo reiniciar a menudo. |
| B. Regenerar la época de forma controlada | Tras invalidar, el gateway crea una época **nueva** (secreto y `environmentId` nuevos, reloj monotónico reanclado) solo si el marcador de base vuelve a verificarse. Los tickets de la época anterior **nunca** se vuelven a aceptar: quedan en Inválida. | **Recomendada.** Desbloquea las reservas nuevas sin debilitar la garantía: un ticket viejo no puede volver a valer. |

Con B, el cambio queda dentro de `recovery-tickets.mjs` y `web-gateway.mjs`, sin
SQL. La regeneración no se hace en bucle: ocurre a lo sumo al llegar la siguiente
petición, tras volver a comprobar la base, y en ningún caso por temporizador.

## 4. Archivos previstos

- `apps/web/src/recovery-ticket.ts`: lectura validada tras el gate.
- `apps/web/src/RecoveryPanel.tsx` (nuevo): panel y máquina de estados, separado
  de `Functional.tsx`, que ya es largo.
- `apps/web/src/main.tsx` y `Functional.tsx`: montar el panel.
- `src/http/recovery-tickets.mjs` y `src/http/web-gateway.mjs`: solo si se elige la opción B.
- Pruebas: `tests/recovery-*.test.mjs`, `tests/web/recovery-*.spec.mjs` y
  `tests/integration/postgres.test.mjs` (B3-xx).
- `docs/REPORTES/ETAPA_5A4_B3.md` y los filtros de CI para la rama nueva.

## 5. Pruebas exigidas

Se toman del §8 del diseño las que B3 cubre por primera vez. Las de B2 se
conservan y no se duplican.

| Diseño | Caso en B3 |
| --- | --- |
| T12 | COMMIT con respuesta perdida, recarga real y login original: recibo recuperado, **cero POST de reserva tras recargar**. |
| T13 | Recarga después de emitir el ticket y antes del envío: Incierta o `NOT_OBSERVED`, sin reconstruir el comando. |
| T14 | `RECORDED` con fallo de la consulta actual: LecturaPendiente y ticket conservado. |
| T15 / T16 | A → B → A y respuestas tardías: ningún dato antes del gate ni de otra cuenta. |
| T17 / T18 | bfcache y pestaña duplicada: pantalla bloqueada sin parpadeo privado; los lectores no mutan. |
| T19 | Reinicio del gateway, y con la opción B, regeneración: los tickets viejos pasan a Inválida y la reserva nueva funciona. |
| T20 / T21 | Logout o descarte con petición en vuelo; almacenamiento corrupto o bloqueado. |
| T23 | Doble clic y consultas repetidas: una a la vez y sin tormentas. |
| T24 / T25 | Inspección de Web Storage; E2E de escritorio y móvil con teclado, 320 px y zoom al 200 %. |
| T28 | Matriz completa y CodeQL del SHA final, sin subir timeouts ni retries. |

Unitarias nuevas: transiciones de la máquina de estados y lectura de tickets
(versión, tamaño, cuenta, entorno y vencimiento).

## 6. Fuera de alcance

Otras familias de operación (comandos D/X, administración, cuidados), pagos,
notificaciones, modo offline, restauración entre dispositivos y protección frente
a XSS activo (el ticket no sustituye a la autenticación). Tampoco la integración
de la cadena de PR en `main`, que se propone para después de cerrar B3.

## 7. Decisiones del propietario

| # | Decisión | Recomendación |
| --- | --- | --- |
| D1 | Aprobar el alcance del §2 (solo APP, solo lectura). | Aprobar. |
| D2 | Época de tickets: opción A o B (§3). | **B.** |
| D3 | ¿Se puede iniciar una reserva APP nueva mientras hay una referencia Incierta vigente en la misma cuenta? | No sin antes consultarla al menos una vez o descartarla de forma explícita. Evita reservas dobles por desconocer el resultado anterior. |
| D4 | Dónde se implementa. | Claude Code o una sesión con instalación de paquetes, para correr `test:all` y `test:web` localmente antes del CI. |

Hasta que se apruebe, este documento no autoriza implementar B3.
