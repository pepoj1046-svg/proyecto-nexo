# Etapa 3 — Incremento 8A: turnos, fallas y recepción segura

Fecha: 31/10/2026, America/La_Paz. Solo laboratorio ficticio.
Repositorio `pepoj1046-svg/proyecto-nexo`, rama `desarrollo/etapa-3`, desde
`c0978af56b064c9818d79f5227f0c8658ee18e63`, verificado limpio antes de trabajar.
[PR #3](https://github.com/pepoj1046-svg/proyecto-nexo/pull/3), abierto hacia
`desarrollo/etapa-2`. Sin merge, producción ni autorización de 8B.

## Funcionalidades implementadas

- **Asignación por turno:** nuevas reservas APP/presencial de terminal, expresas y
  grupos terminales voluntariamente divididos quedan CONFIRMED en el commit de
  inventario. Se reutilizan fila, elegibilidad, tarifa/versiones, capacidad por
  segmentos e idempotencia. `driver_accepted=false`: no se atribuye aceptación humana.
  No hay rechazo discrecional, BOARD ni salida automática.
- **Recogidas:** URBAN/ROAD autorizadas y puntos sin clasificación conservan HELD,
  aceptación del chofer y TTL técnico provisional de dos minutos. Clasificación SQL
  mediante metadatos autorizados; no se infiere terminal del índice cero ni del texto.
  No se habilitan domicilios arbitrarios o desvíos.
- **Falla mecánica:** botón visible del chofer conectado al reporte nativo y bloqueo
  inmediato de unidad. Administración consulta y confirma la incidencia; conserva
  resoluciones, retiro y rehabilitación autorizados. Rehabilitar no vuelve a añadir
  automáticamente una unidad retirada a la fila.
- **Sustitución terminal con abordados:** la reasignación lógica conserva reservas,
  grupos e importes. Una instantánea fija quiénes realmente habían abordado. El
  chofer receptor registra recepción individual o de los integrantes observados de
  un grupo y confirma el traslado seguro por separado. Antes de esa confirmación
  el sustituto no puede continuar, incluso si ya recibió a todos. Las personas aún
  no abordadas conservan plaza, sin recepción ni BOARD inventados.
- **Custodia terminal y rescate:** en la sustitución terminal el conteo físico permanece en el origen hasta cada recepción
  efectiva, sin doble ocupación ni hechos de movimiento sintéticos. Urbano/carretera
  mantienen el rescate nativo y la unidad totalmente libre; la confirmación final
  exige al chofer receptor actual activo, con revalidación después de los locks.
  Administración supervisa, sin confirmar en nombre del receptor.
- **Pasajero:** observa los hechos del personal autorizado y tiene «Reportar un
  problema» con cuatro discrepancias. Se guarda evidencia del servidor y abre
  revisión; no cancela, corrige hechos, libera plazas, sanciona ni procesa dinero.
  Administración ve un aviso por reserva y puede consultar esos reportes.
- **Web:** estados, errores seguros, confirmación humana, reintentos con la misma
  clave, permisos y CSRF. Recepción se mantiene visible después de actualizar el
  manifiesto. Se corrigieron ajuste móvil, selectores accesibles y desbordamiento
  interno, además de comprobar escritorio/móvil con Chromium y axe.

## Migraciones, módulos y compatibilidad

**001–028 intactas.** Nuevas:

- `029_queue_assignment.sql`: regla inmutable de asignación por reserva, wrappers
  privados del inventario existente, confirmación directa y coordinación grupal.
- `030_safe_handoffs_and_reviews.sql`: instantáneas/recibos/confirmación de recepción,
  custodia física, bloqueo de continuidad, receptor legítimo y discrepancias privadas.

No se crea inventario paralelo. Se conservan episodios, miembros, consentimiento,
importes originales, capacidad simultánea máxima de seis por segmento y orden de fila.
Las HELD anteriores no se convierten: incluso los recibos, expiraciones y aceptaciones
parciales sobreviven al upgrade. La prueba K813 migra una base real 028 poblada y
contrasta todas sus tablas antes/después; luego completa una oferta antigua y crea
una nueva terminal directa. Los upgrades anteriores también permanecen en la batería.

`initialStatus` sigue describiendo el recibo original, mientras las proyecciones
muestran el estado actual. Las proyecciones antiguas sin discrepancias conservan su
forma exacta; no se relajó la comparación de A601 para hacerla pasar.

Se precisó una explicación histórica de 7A/7B: el núcleo 002 **ya confirmaba todas
las partes HELD en la transacción de la última aceptación**. 8A conserva esa lógica
probada y añade la nueva asignación directa, en lugar de reconstruir un coordinador.
El contrato actual usa el mismo origen/destino para todas las partes; no admite una
petición con puntos de subida distintos. No se inventó una interfaz para ese caso.

Archivos principales: ambas migraciones; `src/db/web-safety-service.mjs`, servicios
web de operaciones/recuperación y gateway; `apps/web/src/Safety.tsx`, Functional,
Operations, Recovery, Terminal, modelos, errores y estilos; fixture/runner de web;
pruebas unitarias, PostgreSQL y E2E/testigo SQL. Contratos, README, AGENTS, skill e
informes 7A/7B se actualizaron. `.codex/` no se modificó. Se añadió a la skill la
referencia y el invariante de búsqueda por origen/destino solicitado en la revisión.

## Auditorías y correcciones

Dos subagentes **genéricos con instrucciones manuales**, de solo lectura, terminaron
sus auditorías; no ejecutaron matrices, editaron archivos ni crearon commits. El
principal fue el único editor y ejecutor de pruebas. No se afirma carga de perfiles TOML.

Seguridad identificó clasificación fiable de terminal, preservación del legado,
coordinación grupal, falta de recepción física explícita en la sustitución anterior,
SAFE_TRANSFER administrativo incompatible con la nueva decisión, permisos/alcance
de RPC posteriores a 020, límites de sustitución y separación de discrepancias.
Se aplicaron los cambios mínimos: permisos privados, `search_path` fijado, RLS,
locks e idempotencia del núcleo, recepción por actor legítimo y reportes sin efectos.
La revisión estática posterior no encontró un defecto bloqueante demostrado; no
sustituye una auditoría formal ni las pruebas ejecutadas.

Pruebas identificó escenarios que debían conservar HELD, fixtures que todavía
aceptaban toda reserva, Q03 con BOARD insertado después de una incidencia y cobertura
faltante de recepción parcial, rollback, carreras, TTL e historial. Se corrigió Q03
para observar BOARD real antes de la falla; se añadieron K801–K815 y regresiones web.
Incluyen cuatro plazas reservadas con solo dos personas realmente abordadas, fallos
inyectados después de escribir y revocación mientras una operación espera un lock.

Fallos intermedios corregidos, sin contarlos como aprobados:

- Referencias SQL ambiguas entre variables y aliases en nuevas funciones.
- Fixture de autenticación que llamaba una función inexistente; usa identidad real
  del laboratorio y no un bypass de permisos.
- Fixtures que aún enviaban aceptación para una reserva ya asignada directamente.
- Pérdida de la vista de recepción al actualizar el manifiesto: ahora recibe su
  proyección autorizada actual, sin reiniciar el flujo de recepción.
- Selector del tipo de problema sin nombre explícito para `getByLabel` y recorte
  interno móvil de un fieldset. Se corrigieron accesibilidad y estilos y se añadió
  comparación de anchura interna, además del ancho total de página.
- Propiedad adicional vacía que rompía la comparación estricta del manifiesto
  legado; solo se extiende cuando existe información nueva que mostrar.
- Expectativas de error/estado antiguas para acciones que 8A prohíbe expresamente,
  manteniendo todas las aserciones de inventario, historial y autorizaciones.

No se aumentaron timeouts, ocultaron fallos con reintentos ni usaron clics forzados.

## Resultados ejecutados

Entorno local: Ubuntu, Node 24.19.0, PostgreSQL real 18.4 y Chromium 154 mediante
Playwright 1.64.1. Node 22 y Windows se comprueban en CI, no se atribuyen al shell local.

| Validación | Resultado local final |
| --- | --- |
| `npm run test:all` — unitarias | 59/59, salida 0 |
| `npm run test:all` — PostgreSQL real | 254/254, salida 0 |
| Propagación de fallo del runner | Exit 9 intencional preservado; PostgreSQL detenido |
| Smokes HTTP identidad/negocio | Aprobados; listeners y PostgreSQL detenidos |
| Compilación TypeScript/web | Aprobada |
| `npm run test:web` — escritorio/móvil | 76/76 (38 escritorio + 38 móvil), salida 0; 32 laboratorios cerrados |

Total final: **389 casos definidos** (59 + 254 + 76), sin fallos ni omitidos finales.
SIGINT, puertos, reinicio y eliminación de accesos efímeros aprobados.

Las pruebas dirigidas se ejecutaron antes de las baterías completas: asignación,
recepción, concurrencia, errores inyectados, upgrade poblado, compatibilidad legacy,
CSRF/sesión/roles y los E2E afectados. Los casos nuevos se suman a los anteriores;
las modificaciones de expectativas corresponden al contrato nuevo, no a omitir pruebas.

El **SHA final publicado**, resultados exactos de GitHub Actions Ubuntu/Windows ×
Node 22/24, enlaces a jobs/logs y comprobación separada de resultados CodeQL se
consignan en el [registro final de verificación de este incremento](https://github.com/pepoj1046-svg/proyecto-nexo/pull/3#issuecomment-6549354304).
Ese registro se actualiza sobre el commit entregado, sin generar commits de solo
resultado que invaliden la CI que documentan. No utilizar la CI de 7A/7B como evidencia
para 8A. CodeQL «sin nuevas alertas en cambios» no demuestra cierre de alertas históricas.

Las [capturas y hashes](evidencias/etapa-3-incremento-8a.json) muestran asignación
presencial, recepción segura y discrepancias en escritorio/móvil. Datos ficticios;
no se publican accesos, tokens, cookies, archivos `.local` ni trazas de autenticación.

## Procedimiento sencillo en Windows

Requiere Git, Node 22 o 24 y dependencias fijadas; no exige una base externa.

```powershell
git switch desarrollo/etapa-3
git pull --ff-only origin desarrollo/etapa-3
npm ci --no-fund
npx --no-install playwright install chromium
npm run dev:web
```

Solo sincronizar con árbol limpio; conservar cualquier cambio local. Abrir la URL
`127.0.0.1` impresa. El archivo privado `.local/accesos-*.json` indicado en consola
contiene usuarios ficticios de esa ejecución; no publicarlo ni reutilizarlo fuera del
laboratorio. Usar perfiles de navegador independientes: ventanas incógnitas del mismo
perfil pueden compartir sesión.

1. En `/reservar`, Yacuiba → Villa Montes, normal o expreso: revisar puntos, precio,
   grupo y consentimiento antes de confirmar. Una terminal explícita queda confirmada
   por turno; no aparece oferta discrecional al chofer. Una recogida autorizada fuera
   de terminal conserva su oferta. Buscar sigue usando origen/destino sin categoría
   geográfica; los metadatos y permisos internos deciden elegibilidad.
2. Para el caso de sustitución: `terminal0` en `/pasajero`; `adminH` en administración
   selecciona FICTICIO-WEB-0-0 y observa el abordaje real del grupo de cuatro. `driver0`
   en `/chofer` reporta la falla. Administrador actualiza y confirma la incidencia.
3. En la consola de incidencias se muestra la primera alternativa compatible.
   `terminal0` consiente el vehículo propuesto para todo el grupo. Administrador
   actualiza, selecciona el consentimiento y confirma la coordinación humana y la
   reasignación. El grupo conserva su importe e integrantes; la recepción sigue pendiente.
4. En otro perfil, `driver6` selecciona FICTICIO-RESCATE-ORIGEN. Observa recepción
   pendiente, registra únicamente personas realmente recibidas (individual/grupo) y
   finalmente confirma el traslado seguro completado. Administración solo supervisa.
   Cuatro plazas siguen siendo cuatro: terminar la recepción no completa a seis ni
   registra salida. Esta carrera continúa bajo las reglas normales de capacidad/salida.
5. El pasajero actualiza su reserva y ve el cambio. «Reportar un problema» permite
   abrir revisión de una discrepancia; el administrador actualiza y consulta el aviso
   de esa reserva. Verificar que importe, plazas y movimientos no cambian por reportar.

```powershell
npm run test:integration -- --test-name-pattern="K80|K81|Q03|A601"
npm run test:web -- --suite=recovery-terminal.spec.mjs,recovery-safety.spec.mjs
npm run test:all
npm run test:web
```

Ctrl+C detiene el laboratorio y elimina su archivo de accesos. La guía no representa
una prueba manual realizada en Windows; la evidencia Windows es la CI enlazada.

## Límites y pendientes para una revisión posterior

- Sustitución terminal a una unidad compatible y consentimiento vigente de cada grupo,
  según el contrato existente. Partes repartidas fuera del origen, falta de responsable
  de presencial o ausencia de una alternativa válida quedan en revisión humana;
  no se fabrican consentimientos ni reasignaciones parciales.
- Los reportes abren revisión y muestran los últimos 50 con conteo total e historial
  íntegro conservado. No se añadió resolución automática, política de respuesta,
  retención legal, corrección de hechos o consecuencias comerciales.
- Las ofertas históricas conservan su contrato; los puntos sin tipificar necesitan
  configuración autorizada antes de adoptar la asignación directa de terminal.
- Continúan pendientes políticas de menores/responsables, ausencias, plazos comerciales,
  operaciones especiales y cualquier pago/reembolso. No se implementa GPS o ETA.
- Revisar funcionalmente la nueva decisión y los riesgos históricos de CodeQL y de
  operación comercial antes de autorizar más alcance. No hay aprobación de producción.

Este incremento no cierra toda la Etapa 3 ni inicia 8B. El trabajo posterior requiere
su propia autorización; main y ramas de Etapas 1/2 se preservan.
