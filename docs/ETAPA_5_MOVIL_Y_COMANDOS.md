# 5A.3 — Diagnóstico y contrato de recuperación por comando

Base exacta: `1119ae55c48d96b865e15734867aee4153675bec`, rama nueva
`desarrollo/etapa-5a3`. Solo laboratorio ficticio. No cambia el núcleo ni 001–041.
La autorización posterior del propietario prevalece sobre el alcance histórico
4A.6 de AGENTS.md. Se siguen sus restricciones de aislamiento y seguridad.

## 5A.3-A: diagnóstico ejecutado

- Tres recorridos reales (pasajero operativo0, chofer driver5, administrador adminH)
  con PostgreSQL y Chromium móvil: sin violaciones axe WCAG 2 A/AA y 2.1 AA ni
  overflow horizontal a 320 px y en emulación de zoom de layout al 200 %.
  Esto no certifica todos los estados, lectores de pantalla o dispositivos físicos.
- El cuarto caso falla: Escape no cierra la navegación móvil ni devuelve el foco
  al botón. Hay captura y traza privadas bajo `.local/web-test-results`.
- Tres regresiones unitarias sobre el manejador real useCommands fallan en la base:
  el cuerpo anidado se puede modificar mientras espera sesión; un recibo recibido
  seguido de refresh rechazado vuelve a emitir POST; una respuesta tardía puede
  devolver el resultado y ejecutar refresh después de cambiar de cuenta.
- La reserva APP usa ReservationAttempt y ya conserva cuerpo/clave/recibo; no se
  reconstruye. Las cuatro sondas adicionales de la auditoría 5A.2 se reutilizan como
  evidencia histórica, no se atribuyen a una ejecución nueva de 5A.3.

Comandos ejecutados durante diagnóstico (fallos esperados antes de corrección):

```text
node scripts/test-web.mjs --suite=client-accessibility.spec.mjs --project=mobile
node --test tests/use-command.test.mjs
```

Resultado inicial: web 3 aprobadas / 1 fallida; unitarias 0 / 3. No es una batería
final aprobada. Se conservaron logs privados `5a3-accessibility-before.log` y
`5a3-command-before.log`.

## Inventario de contratos, sin generalización de hechos físicos

| Panel / endpoint existente | Contrato conservado | Tratamiento |
| --- | --- | --- |
| Checkout / reservations | QUEUE/ENROUTE, cotización y partes congeladas | Reutilizar 5A.2 sin sustituir su máquina |
| Presencia y chofer / operations/command | ARRIVED, PICKUP_REQUEST, VERIFY, BOARD, ALIGHT, ACCEPT, salida, progreso e incidencias; actor/episodio/versión/punto nativos | Reintento manual idéntico, no inferir movimiento de una lectura o reconexión; recibo recibido no necesita otro POST |
| Responsables / care/code | Capacidad de vinculación de un uso ligada a sesión, nunca autoridad por referencia | Conservar intención en incertidumbre; un recibo ya recibido no vuelve a emitir código; nueva generación exige nueva acción explícita |
| Cuidados / care/command | Responsables versionados, observación de ausencia, revisión de menores/casos/accesos | Misma clave/cuerpo para recuperar; una ausencia no libera plazas; no ampliar identidad legal ni consentimiento |
| Seguridad / safety/command y safety/report | Recepción y traslado seguro / reporte de hechos cuestionados | No ejecutar rectificación, custodia ni recepción automáticamente; mantener consentimiento y revisión nativa |
| Condiciones / conditions/command y conditions/declare | Decisión sobre revisión explícita / declaración administrativa | No renovar versiones o consentimiento para hacer pasar un reintento |
| Administración / management/command | Cancelación con motivo y confirmación | No reinferir cancelación, devolución ni sanción; recuperar el recibo original |
| Incidencias / recovery/command | Sustitución, rescate, traslado, recepción y alternativas nativas | No autodesignar rescate ni inventar movimiento físico; conservar versión/cuerpo |
| Terminal / terminal/walk-in y terminal/command | Inventario compartido, tarifa, retorno voluntario, rechazo permitido y rehabilitación | No generar otra venta o regreso por una respuesta incierta |
| Directorios / driver-admin, fleet-admin, platform, route-config | Intenciones, versiones y rechazos definitivos documentados en 4A.6 | Reutilizar controles existentes; conservar sus excepciones de retiro de intentos rechazados, sin extenderlas automáticamente a operaciones físicas |

Fuentes: ETAPA_2_CONTRATOS.md; ETAPA_3_CUIDADOS_Y_REVISIONES.md;
ETAPA_4_ADMINISTRACION_CHOFERES.md; ETAPA_4_CHOFERES_Y_VEHICULOS.md;
ETAPA_4_ADMINISTRACION_ASOCIACIONES.md; ETAPA_4_RUTAS_Y_TARIFAS.md;
ETAPA_5_RECUPERACION_RESERVAS.md; servicios web-*-service existentes.

## Cambios mínimos previstos para 5A.3-B

1. Corregir Escape y retorno de foco sin convertir navegación en diálogo modal.
2. Congelar el cuerpo de comandos antes de esperar red; retener cuenta, clave y
   respuesta recibida. Impedir otra intención incompatible mientras quede una
   pendiente. Nunca reenviar automáticamente.
3. Revalidar cuenta después de respuestas y antes de refrescar/devolver recibos.
   Separar recibo conocido de fallo de actualización. Mantener comprobación de
   permisos por servidor y CSRF; no presentar guards de navegador como autoridad.
4. Ofrecer recuperación manual visible para los paneles operativos revisados,
   conservando el formulario mientras está pendiente. Auditar cada refresh que
   pueda desmontar el formulario o capturar una cuenta distinta.
5. Añadir regresiones de red/sesiones/recibos, teclado, foco y layout. Mantener
   módulos que ya superan 320 px/200 % sin cambios meramente estéticos.

## Validación y límites

Pruebas dirigidas durante B; test:all y test:web completos una vez estabilizado,
CI Ubuntu/Windows Node 22/24 y CodeQL del SHA final durante C. Los avances de
diagnóstico no son un dictamen de cierre ni una aprobación de CI final.

Solo RAM: recarga forzada/cierre puede perder intención. No persistencia, polling,
service workers, colas offline, reenvíos por evento online ni API nueva. Un error
HTTP no demuestra rollback. Una sesión revocada no aborta retrospectivamente una
sentencia ya autorizada, según contrato anterior. Si se necesita política nueva,
la operación queda en revisión humana. No se inicia 5A.4.
