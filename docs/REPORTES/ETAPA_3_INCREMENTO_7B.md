# Etapa 3, incremento 7B — Condiciones de ruta y decisiones del responsable

31/10/2026, America/La_Paz. Trabajo conjunto con 7A desde `91dad4d`, exclusivamente
`pepoj1046-svg/proyecto-nexo`, rama `desarrollo/etapa-3`. Skill `trufis-dev`, AGENTS,
contratos vigentes de Etapa 2 e informes anteriores revisados en una auditoría común.
El PR #3 se mantiene abierto hacia `desarrollo/etapa-2`; sin fusión ni incremento 8.

## Auditoría y extensión mínima

El núcleo ya tenía `route-condition`, `condition-decision`, `passenger-decision`,
`resolution-options` y `late-resolution`. Admitía ACCEPT/ADMIN_REVIEW y solicitud de
cancelación sin ejecución automática; no tenía estimación adicional versionada ni
un rechazo explícito. La migración nueva **028_web_route_decisions.sql** añade:

- Tabla privada, RLS habilitada y registro inmutable de estimaciones por ruta/versión,
  enlazada a `condition_history`; actor y hora. Sin SELECT/DML para nexo_app ni PUBLIC.
  Una declaración antigua sin estimación sigue mostrando «Tiempo adicional no informado».
- Cuatro RPC web restringidos: declaración, contexto de reserva, contexto de ruta
  administrativa y decisión. `SECURITY DEFINER`, search_path fijo, PUBLIC revocado,
  validaciones SQL y de transporte, permisos revalidados al adquirir bloqueos.
- REJECT en el registro existente `condition_decisions`. Un trigger serializado por
  ruta impide ACCEPT y REJECT contradictorios para una misma reserva/versión, incluso
  desde el RPC anterior. No añade un estado ficticio al inventario de reservas.
- Una comprobación de rechazo en la función existente de contrato de abordaje,
  conservando su identidad SQL y todas las comprobaciones anteriores de condiciones,
  menores y acompañantes. No se permite abordaje con rechazo vigente.
- Índice de solicitudes/cancelaciones por reserva para las consultas nuevas.

**001–027 no se modifican.** No se reescriben datos históricos ni importes. La prueba
J715 actualiza una base ficticia 027 poblada, compara todas sus tablas anteriores
antes/después, conserva la reserva y comprueba la idempotencia de migraciones.

## Administración y pasajero

El administrador consulta la ruta del vehículo autorizado y su versión. Puede declarar
estado NORMAL/DESVIO/SUSPENDIDA, motivo admitido, descripción, puntos/extremos de
segmentos, estimación adicional opcional y cambio de una tarifa configurada. La
confirmación es explícita; una versión desactualizada se rechaza sin sobrescribir
la declaración concurrente. Solo se muestran puntos y tarifas de esa ruta.

Los minutos admiten enteros 0–10080 como **límite técnico del laboratorio**, sin
establecer tolerancias o plazos comerciales. Vacío/null significa no informado;
cero es una estimación explícita de cero. No se calcula una ETA, no se conecta GPS
ni se certifica transitabilidad o seguridad. Desvío es un estado; sus motivos siguen
los códigos existentes, incluido «Otro motivo declarado».

La revisión propia de reserva muestra condiciones al reservar, declaración anterior
si existe, condiciones actuales, puntos por nombre y duración declarada. Distingue
importe total original/versionado de la información tarifaria actual por plaza o
por vehículo completo. **Ninguna aceptación, rechazo o declaración cambia el precio
pactado de esa reserva.** Una tarifa nueva solo afecta las solicitudes donde el
contrato vigente la aplica; cualquier recargo sobre lo pactado requiere un
procedimiento separado y autorizado, no implementado aquí.

Solo el responsable legítimo puede aceptar o rechazar, confirmando la versión exacta.
La revisión administrativa no acepta por él. Las decisiones quedan auditadas y se
pueden consultar tras recargar. No se editan retrospectivamente ni se inventa una
revocación de consentimiento; otra versión se decide separadamente.

Tras REJECT, se ofrece «Solicitar cancelación» con una segunda confirmación. Se
reutiliza `passenger_decision(CANCEL_REQUEST)`. Se muestra exactamente:

**Cancelación solicitada — pendiente de revisión.**

La solicitud conserva estado CONFIRMED/HELD, referencia, importe y plazas. Se ve en
el listado propio y, tras actualizar, en el manifiesto administrativo autorizado,
además de su consulta detallada. No se envían mensajes ni se automatizan sanciones,
cancelaciones, liberaciones o devoluciones. Reintentos conservan su recibo; una
solicitud repetida no añade otro evento efectivo.

La resolución administrativa conecta `approve_late_resolution(cancelOnly=true)`:
requiere solicitud previa del responsable, reserva confirmada única en el grupo,
ausencia de movimientos y permisos actuales. Otras combinaciones quedan en revisión
manual; no se resuelve parcialmente un grupo dividido ni se simula un descenso.
Las operaciones de cancelación explícita del incremento 6 conservan su contrato
propio, sin convertirse en cancelaciones automáticas por esta solicitud.

## Seguridad y compatibilidad

- Identidad de sesión SQL, cookies opacas, CSRF de mismo origen y claves de acción.
  No se aceptan actorId/role/source como autoridad. Respuestas de error cerradas.
- Alcance real de asociación/ruta/terminal y vehículo; no hay autoasignaciones nuevas.
  El chofer no declara cambios de asociación ni decide por el responsable.
- Dos declaraciones sobre la misma versión tienen un ganador. ACCEPT/REJECT
  concurrentes tienen un ganador; no quedan dos decisiones contradictorias.
- Una sesión revocada mientras espera el bloqueo de ruta no puede registrar REJECT.
- La solicitud no altera inventario; la resolución nativa lo modifica transaccionalmente.
  Continúan seis plazas simultáneas por segmento, grupos, filas, aceptación de choferes,
  salida explícita, recogidas, incidencias, rescates e idempotencia anteriores.

## Archivos

| Capa | Archivos |
| --- | --- |
| Migración | `database/migrations/028_web_route_decisions.sql` |
| Adaptadores/transporte | `src/db/web-condition-service.mjs`, `web-reservation-service.mjs`, `web-operations-service.mjs`, `src/http/web-gateway.mjs` |
| Web | `apps/web/src/Conditions.tsx`, `Functional.tsx`, `Operations.tsx`, `Management.tsx`, `operation-model.ts`, `private-api.ts`, `styles.css` |
| Regresiones | `tests/web-conditions.test.mjs`, `tests/web/conditions.spec.mjs`, `tests/integration/postgres.test.mjs` |
| Infraestructura local/documentación | runner web y fixture compartidos con 7A, AGENTS, arquitectura/seguridad y este informe |

## Pruebas, fallos y resultados

- Dos unitarias nuevas: duraciones/versiones/motivos/autoridad y decisión/confirmación.
- J711–J717: declaración/replay/estimación nula; precio conservado; REJECT y solicitud
  sin cambios de cupo; resolución legítima; aceptación/rechazo concurrentes; decisiones
  antiguas; permisos revocados; grupos incompatibles sin cambios parciales; upgrade
  027 poblado; declaraciones concurrentes y revocación durante espera de bloqueo.
- Cuatro E2E: aceptación, y rechazo → solicitud → revisión administrativa, por dispositivo,
  con sesiones independientes y PostgreSQL READ ONLY como testigo. Comprueban tarifas,
  versiones, historial, CSRF, accesos cruzados, no sobreventa, rechazo de duplicados,
  ausencia de cancelación automática y estado después de recargar.
- Accesibilidad axe del flujo de consulta; el formulario administrativo comprueba
  ausencia de desbordamiento y envío real desde escritorio y móvil.

La batería final conjunta aprobó **57/57 unitarias + 239/239 integraciones PostgreSQL real + 74/74 E2E Chromium** (37 escritorio / 37 móvil): **370 casos definidos**, conservando los 348 anteriores. Salidas 0, sin omitidos; compilación, 30 laboratorios cerrados, SIGINT/puertos y reinicio aprobados. Logs privados finales: `.local/i7-final-all-2.log` y `.local/i7-final-web.log`. Los fallos previos no se contabilizan como aprobados.

CI/CodeQL por commit/run/job: [registro final de verificación del PR](https://github.com/pepoj1046-svg/proyecto-nexo/pull/3#issuecomment-6546058579). Se registran los resultados
reales al terminar; un estado pendiente no se cuenta como aprobado. Windows se
comprueba automáticamente en Actions, no mediante una prueba manual declarada.

| Dispositivo | accept | request |
| --- | --- | --- |
| desktop | [accept](capturas/etapa-3-incremento-7b-accept-desktop.png) | [request](capturas/etapa-3-incremento-7b-request-desktop.png) |
| mobile | [accept](capturas/etapa-3-incremento-7b-accept-mobile.png) | [request](capturas/etapa-3-incremento-7b-request-mobile.png) |

Fallos intermedios conservados y corregidos:

1. La nueva tabla enlazada al historial exigía incluirla en el TRUNCATE exclusivo de
   las fixtures; el primer intento dirigido falló por FK, sin cambiar datos reales.
2. Un selector de tarifa no resolvía el control esperado. Se usa su rol accesible;
   el escenario de rechazo prepara su antecedente y no depende del éxito de otro test.
3. La solicitud debe añadir auditoría aunque conserve inventario. Se corrigió la
   comparación del testigo: compara todo lo demás y exige el nuevo evento nativo.
   Una primera corrección usó el nombre incorrecto de la colección; se corrigió a
   `audits`. No se eliminó la comprobación de conservación de datos.
4. Un formulario sin límites de ancho desbordaba el móvil e impedía alcanzar el
   envío: la traza mostró paneles interceptando el clic. Se corrigieron anchos,
   min-width de fieldsets, controles y distribución. Se mantiene la prueba del clic
   real, sin force-click, reintentos automáticos ni aumento de timeouts.
5. La primera batería amplia encontró un contador de registro aún en 27 y dos
   indicadores falsos añadidos innecesariamente a los manifiestos normales. El contador
   refleja ahora 28; los indicadores se devuelven solo si son relevantes. La comparación
   estricta con la proyección anterior se conserva sin relajar sus aserciones.
6. La compatibilidad de quote/reinicio se corrigió en la fase conjunta; véase 7A.

No se solicitan re-runs para ocultar fallos. Logs privados `.local/i7b-*.log` y
`.local/i7-final-*.log`, trazas y accesos quedan fuera de Git; solo se seleccionan
capturas ficticias sin tokens, contraseñas ni configuración SQL.

## Recorrido de prueba en Windows

Usar la instalación y flag ficticio indicados en el informe 7A. Reiniciar el
laboratorio antes de este recorrido si se ejecutó previamente otro escenario.

1. Perfil `adminH`, `/administracion`, FICTICIO-WEB-0-0. «Consultar declaración de
   ruta». DESVIO, Bloqueo, descripción ficticia, +30 minutos. Elegir tarifa normal
   Terminal de Yacuiba → Terminal Villa Montes y configurar 45.00, o conservarla.
   Marcar confirmación y registrar. No se cambia el importe de la reserva anterior.
2. Otro perfil `terminal0`, `/pasajero`, reserva de cuatro plazas. Consultar condiciones
   y decisiones: original Bs 140, tarifa versión 1; configuración actual y +30 si
   se declaró. Marcar confirmación y «Aceptar cambio». Consultar historial.
3. Administrador declara otra versión DESVIO, con otra descripción y minutos vacíos.
   Pasajero actualiza la consulta: aparece declaración anterior y «Tiempo adicional
   no informado» para la nueva. Confirmar y «Rechazar cambio».
4. Marcar la nueva confirmación y «Solicitar cancelación». Debe aparecer «Cancelación
   solicitada — pendiente de revisión». Actualizar/recargar conserva la solicitud;
   reserva y plazas siguen confirmadas, con el mismo importe.
5. Administrador actualiza operación, ve la solicitud, abre «Revisar reserva y grupo»
   y consulta condiciones. Si cumple el contrato nativo, confirma y ejecuta «Resolver
   solicitud: cancelar reserva». Solo entonces se cancela/libera inventario. Pasajero
   actualiza: Cancelada, importe histórico conservado y sin devolución simulada.
6. `driver0` solo conserva sus operaciones autorizadas; `adminU` no puede consultar
   esta reserva ni declarar condiciones de esta ruta. No se requiere GPS o mensajes.

```powershell
npm run test:web -- --suite=conditions.spec.mjs
npm run test:all
npm run test:web
```

Ctrl+C detiene HTTP y PostgreSQL. No utilizar accesos ni información reales.

## Pendientes y evaluación

Implementado el flujo respaldado por contratos y la ampliación mínima autorizada de
estimación/rechazo. Siguen pendientes resolución especial de grupos divididos o con
movimientos fuera del contrato de resolución tardía, reversión de una decisión ya
registrada y cualquier cobro distinto, reembolso o consecuencia comercial/legal.
Se conserva la limitación de confirmación coordinada descrita en 7A. Permanecen los
procedimientos de menores/responsables, configuración de cuentas y correcciones/
recuperación especial de los informes anteriores. No se cierra toda la Etapa 3 ni se
declara el sistema listo para producción; sin incremento 8, despliegues o gastos nuevos.
