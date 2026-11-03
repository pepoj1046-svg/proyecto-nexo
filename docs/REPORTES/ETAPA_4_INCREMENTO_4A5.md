# Etapa 4A.5 — rutas dirigidas y tarifas versionadas

Base aprobada `d2bc50bc5222549fc8f6325279c4725e2117f2f8`. Repositorio `pepoj1046-svg/proyecto-nexo`, rama `desarrollo/etapa-4`, [PR #5](https://github.com/pepoj1046-svg/proyecto-nexo/pull/5) abierto en borrador hacia `planificacion/etapa-4a`. Exclusivamente laboratorio ficticio. No habilita producción ni acredita licencias de transporte.

El SHA publicado y los resultados/URLs de GitHub Actions y CodeQL se ratifican en el cuerpo del PR **después** de leer las ejecuciones del mismo SHA. El manifiesto de evidencias fija hashes de las fuentes probadas y de001–038. Evita un commit documental posterior con un SHA distinto del verificado; un archivo no puede contener el hash de su propio commit.

## Funciones y contratos

- Administración dentro del directorio existente: borradores, versiones, detalle, validación, publicación, retiro e historia paginada de rutas y tarifas. Motivo, confirmación por actuación, teclado, cargas, errores y controles móviles.
- OUT e IN explícitos e independientes. Puntos ordenados, localidades de catálogo activo, perfiles TERMINAL/URBAN/ROAD/UNCLASSIFIED y subida/bajada. No se infiere terminalidad ni se invierte automáticamente un recorrido. Validación estructural no equivale a verificación física de una carretera.
- Una publicación topológica inserta otro UUID nativo de ruta/puntos/perfiles y conserva su familia. No modifica viajes, reservas, grupos, custodia ni puntos históricos. No copia autorizaciones VERIFIED ni crea viajes/inventario. La ruta sigue sin ser vendible mientras no cumpla elegibilidad nativa.
- Tarifas por tramo/modalidad con dos decimales, ordinaria por plaza y expresa por vehículo completo. Vigencias UTC semiabiertas; importes >=0 conforme al contrato existente. Solapamiento exige predecesor compatible explícito; no se elige arbitrariamente entre tarifas ambiguas.
- Nueva publicación agrega tarifa nativa con versión creciente. `fare_selection_ends` acorta únicamente la selección para solicitudes nuevas; la vista `new_request_fares` conserva RLS. El ID, versión, importe y **fechas originales** del contrato anterior permanecen disponibles para reservas/recuperaciones existentes.
- Cotización obsoleta rechazada para clave nueva; replay autorizado conserva el recibo almacenado y el estado enriquecido que ya devolvía el adaptador. No se inventa una entidad «cotización confirmada» inexistente ni se modifica dinero.
- Retiro de ruta bloqueado con filas, reservas vivas, pasajeros físicos, recogidas, incidencias, rescate o recepción pendientes. No materializa expiraciones ni cancela pasajeros para permitir el retiro. Ante custodia ambigua se exige revisión conservadora por asociación.
- ADMIN completo configura topología. ADMIN limitado consulta solo rutas concedidas y gestiona sus tarifas; publicar otro UUID no amplía su alcance. GENERAL_ADMIN conserva4A.3, sin bypass operativo. REVIEWER/DRIVER/PASSENGER no obtienen configuración administrativa.
- Intención incierta conserva cuerpo y clave; padre no desmonta el formulario pendiente. Un conflicto definitivo retira la intención y exige contexto/confirmación nuevos. No se promete recuperación de una clave después de cerrar o recargar por completo el navegador.

Contrato y pasos de Windows: [ETAPA_4_RUTAS_Y_TARIFAS](../ETAPA_4_RUTAS_Y_TARIFAS.md).

## Archivos, migración y reutilización

001–038 preservadas byte por byte. Nueva `039_route_and_fare_administration.sql`: `config_drafts`, auditoría inmutable `config_events`, fin de selección y retiros. No existe otro inventario. RLS/grants mínimos, cuatro RPC públicas y helpers privados, `search_path=pg_catalog,nexo,pg_temp`.

Se reutilizan nativos `routes`, `stops`, `web_point_profiles`, `fares`, ámbito034/035, autoridad036/037, idempotencia y `useCommands`.039 adapta **selectores nuevos** a la vista mediante reemplazos cerrados con comprobación exacta; conserva OID/ACL y lookups históricos por ID. El cambio tarifario legado de condiciones delega en la misma publicación versionada y registra el UUID nuevo. Los dos accesos de elegibilidad nativos respetan retiro. No se reescribe el motor de capacidad ni custodia.

Otros archivos: servicio `web-route-config-service.mjs`, gateway, selector de cotizaciones en `business-service.mjs`, `RouteConfiguration.tsx`, integración `Directory.tsx`, mensajes/estilos y extensión compatible del callback de refresco de `use-command.ts`. Fixtures/runner, tres unitarias,32 casos PostgreSQL, cuatro suites Playwright con dos helpers; AGENTS actualizado al alcance autorizado y estos documentos/manifiesto.

## Seguridad y concurrencia

READ COMMITTED; intención antes de mutex/ámbito, mutex administrativo no bloqueante y rutas UUID en orden/NOWAIT. Después se estabilizan identidad/sesión/rol. Una espera revalida permisos y reloj real antes de recibo o publicación. Revisión ligada a actor/sesión y eventos de identidad/ámbito; protección ABA también tras deshabilitar/habilitar una identidad. Contenido/dependencias vuelven a validarse al publicar. Contexto, filtro, tamaño, permisos y sesión fijan los cursores.

Una denegación o fallo de auditoría revierte conjuntamente borrador, nativos, fin de selección, evento y recibo. Un impedimento operativo autorizado registra revisión sin cambiar servicios. Ningún owner/provisioner por HTTP; petición parametrizada, campos cerrados, CSRF y Origin, presupuesto32KiB solo para el comando nuevo; otros endpoints mantienen2KiB.

## Auditores y errores corregidos

Dos subagentes genéricos manuales, solo lectura; sin editar, probar ni publicar. Principal único editor/ejecutor. No se afirma carga automática TOML.

Seguridad detectó incompatibilidad de cerrar fechas históricas con recuperación014/015; se separó selección de contrato. Señaló revisión reutilizable tras ABA de identidad y replay legado sin reautorización después de espera: corregidos y cubiertos. La política restrictiva de rutas usa `id`, cubriendo el borde que el generador antiguo por `route_id` omitía. El límite HTTP Content-Length/stream ahora coincide. Revisión final acotada no encontró otro defecto nuevo demostrable; no equivale a una auditoría integral final de Etapa4.

Funcionalidad/pruebas detectó publicación de estado guardado mientras se mostraban ediciones locales, contexto ausente al consultar tarifa desde lista global y tratamiento inseguro de rutas históricas de más de64 puntos. Se bloquea publicación sucia, se carga contexto autorizado y se exige revisión técnica sin truncar topología. También corrigió dos errores de las nuevas pruebas E2E: mensaje de revisión obsoleta y selección accidental de una tarifa histórica/otro borrador dentro del mismo laboratorio compartido.

Fallos intermedios resueltos: variable SQL reservada; nombre real `_030` del getter legado; patrón SQL `LIKE 'config_%'` que incluía involuntariamente `configure_admin_scope` (ahora prefijo literal); aserciones de recibo enriquecido comparadas contra el estado previo a aceptación; preparación incompleta de solicitud de traslado/completed_at; orden de errores de validación; rechazo de vista no actualizable anterior a ACL. Los selectores nuevos reciben etiquetas accesibles explícitas. Las pruebas no aumentan tiempos ni retries.

## Pruebas

Primer pase integral del núcleo en `409fbc6`: `npm run test:all` completado con exit0 en Debian13 local, Node24.19.0/PostgreSQL18.4: **75/75 unitarias y395/395 PostgreSQL**, cero fallos/omitidas. TypeScript y build web incluidos; propagación de salida9 del runner y cierre de los dos lanzadores HTTP verificados. `npm run test:web` también terminó con exit0: **136/136 ejecuciones E2E** (68 definiciones × escritorio/móvil),62 laboratorios aislados cerrados correctamente, SIGINT/puertos y reinicio sin persistencia verificados. Chromium154.0.8037.57. Cero retries añadidos. Los resultados CI Ubuntu/Windows × Node22/24 y CodeQL se ratifican sobre el SHA publicado en el PR; no se sustituyen por estos resultados locales.

Cobertura añadida: topología/publicación sin permiso ni viaje, OUT/IN, puntos/perfiles/reglas ambiguas, inmutabilidad con reservas; ordinaria/expresa/cero, vigencias futuras y retiro sin resurrección; cotización nueva vs contrato/recibo anterior y traslado real con tarifa retirada de selección; dos ADMIN independientes, ABA, sesiones revocadas/caducadas tras espera, scope, idempotencia/doble envío, rollback de auditoría, SQL/RLS/grants, páginas >50, HTTP32KiB/CSRF/campos cerrados, actualización poblada038→039/OID/checksums, cuatro abordados+dos recogidas, retiro con recepción/rescate y grupo dividido consentido.

El informe anterior llamó555 «pruebas únicas» a72 unitarias+363 PostgreSQL+120 ejecuciones E2E: estas últimas son60 definiciones en dos dispositivos. La referencia correcta es **495 definiciones /555 ejecuciones**. Se conservan todas. Las repeticiones, Ubuntu/Windows y versiones Node no añaden casos únicos. Este informe distingue definiciones y ejecuciones por dispositivo.

Primer pase local: **538 definiciones lógicas** =75 unitarias+395 PostgreSQL+68 E2E. **606 ejecuciones** =75+395+136. Incremento:43 definiciones nuevas (3+32+8), conservando las495 anteriores. Las comprobaciones auxiliares de lanzadores/cierre no se suman como casos únicos.

Las ocho definiciones E2E nuevas se ejecutan en escritorio y móvil:

| Suite | Comprobaciones de interfaz y PostgreSQL |
|---|---|
| `route-config-topology` (2) | Publicación OUT sin viajes/permisos; IN explícito y cambios sin guardar; teclado/axe/anchura |
| `route-config-fares` (2) | Publicación ordinaria sin cambiar reservas; refresco403 con replay exacto; fechas UTC desde navegador La Paz y retiro futuro sin resurrección |
| `route-config-races` (2) | POST perdido tras commit, doble clic, bloqueo del padre y una sola publicación; intención obsoleta rechazada y clave nueva confirmada |
| `route-config-permissions` (2) | Listas nativas/borradores/historial >50 sin omisiones/duplicados; detalle tarifario desde lista global; cuatro roles independientes denegados, ámbito y CSRF |

Los testigos PostgreSQL de Playwright son conexiones de **solo lectura**, restringidas por el runner a una base efímera loopback. Durante los escenarios, las preparaciones administrativas adicionales pasan por las mismas cookies/CSRF y RPC del navegador. Los fixtures se crean antes de abrir HTTP; no hay owner de escritura dentro de la aplicación.

## Evidencias y límites

Capturas ficticias de escritorio/móvil y sus hashes se conservan en `.local/4a5-evidence`; manifiesto público sin credenciales en `EVIDENCIAS_4A5.json` (capturas iniciales conservadas desde el ZIP, antes del ajuste exclusivo del lanzador). La revisión automática de4A.4 ya rechazó publicar capturas de este laboratorio en el repositorio público: no se elude ni se vuelve a intentar subirlas por otra vía. El bloqueo previo no se presenta como una nueva denegación ocurrida en4A.5. El ZIP local conserva las capturas originales.

No se reconstruye una tarifa histórica anterior a039 si procedimientos antiguos ya la sobrescribieron. No se certifica seguridad física/legal de rutas, retención, tarifas oficiales, permisos reales, doble firma o política de custodia. Importación de topologías históricas >64 puntos y recorridos urbanos fuera del origen requieren revisión técnica/contractual. No hay pagos, GPS, notificaciones, despliegue ni servicios contratados.

4A.6 y etapas5–10 permanecen sin iniciar. El cierre general de Etapa4 no está autorizado por este incremento.

## Evaluación del incremento

El núcleo4A.5 está implementado y pasó la batería local y siete ejecuciones completas CI. La verificación final del lanzador Windows queda condicionada a la ratificación de pruebas locales, CI y CodeQL del SHA final en el PR. No quedan defectos críticos/altos demostrables conocidos dentro de este alcance acotado. Las restricciones y revisiones humanas descritas siguen vigentes; no se declara cerrado el conjunto de Etapa4 ni se autoriza4A.6.

## Corrección del laboratorio Windows tras CI

El commit inicial del núcleo, `409fbc6b0b20ecee1f342cf3c247548ce0a573a4`, pasó las cuatro combinaciones Ubuntu/Windows × Node22/24 en push, además de tres trabajos del PR. Se leyeron sus siete logs:75/395/136 aprobadas y62 cierres en cada uno. CodeQL aprobó, sin nuevas alertas. Sin embargo, el trabajo PR Windows/Node22 falló al navegar en la antigua prueba de permisos; una única comprobación controlada del mismo SHA volvió a fallar al consultar sesión en la antigua venta presencial móvil. Ambos mostraron `net::ERR_NO_BUFFER_SPACE`, en puntos distintos y sin respuesta HTTP de la aplicación; los laboratorios cerraron correctamente. No se ocultaron ni se siguió repitiendo hasta obtener verde.

Los errores quedan conservados en los trabajos [125697586469](https://github.com/pepoj1046-svg/proyecto-nexo/actions/runs/41569104994/job/125697586469) y [125705601281](https://github.com/pepoj1046-svg/proyecto-nexo/actions/runs/41569104994/job/125705601281). El segundo auditor confirmó que los contextos/pools se cierran y encontró el mismo síntoma documentado en3.5,4A.2 y4A.3. No se demostró una fuga propia del núcleo4A.5.

La investigación encontró la reproducción Windows/Chromium publicada en [Playwright43545](https://github.com/microsoft/playwright/issues/43545): `SO_RANDOMIZE_PORT` puede producir Winsock10055/ERR_NO_BUFFER_SPACE aun con poca ocupación TCP. [Playwright43557](https://github.com/microsoft/playwright/issues/43557) advierte que añadir un `--disable-features` aislado descarta la lista original. Es evidencia para una mitigación específica, no una prueba de que toda falla futura de red tenga esa causa.

`scripts/chromium-lab-launch.mjs` ajusta **solo Chromium automatizado en Windows**. Descubre los flags reales de la instalación mediante CDP y un navegador vacío, cierra ese probe en `finally` y conserva la lista completa al añadir `TcpPortRandomizationWin`. Rechaza listas ausentes/ambiguas en vez de quitar protecciones silenciosamente. La opción de automatización necesaria para consultar los argumentos aplica exclusivamente al probe vacío. Linux/macOS no lanzan probe ni reciben ese ajuste. No se copian listas internas de Playwright ni se parchean dependencias.

Dos pruebas unitarias comprueban preservación de defaults, entradas ambiguas, cierre ante éxito/error y ausencia de cambios en otras plataformas. Una comprobación adicional con Chromium real verificó un solo flag fusionado y los18 defaults originales conservados; esa comprobación valida la composición, no reproduce Windows desde Linux. El auditor de seguridad revisó el helper sin encontrar un defecto nuevo demostrable. No se cambió el gateway, límites, timeouts, reintentos, aserciones de negocio ni migraciones para esta mitigación.

Las definiciones finales son **77 unitarias +395 PostgreSQL +68 E2E =540 casos distintos**; con ambos dispositivos son **608 ejecuciones** (77+395+136). Incremento total:45 definiciones nuevas respecto de495 anteriores. La repetición integral local y la matriz CI del SHA con el lanzador corregido se ratifican en el cuerpo del PR después de leer resultados reales. Los conteos del primer pase se conservan como tales, sin presentarlos como verificación de la corrección posterior.

## Distribución final de CI sin ampliar límites

El lanzador corregido en `a720abe4d5c507002f1b902469807358eae878e1` pasó localmente77/395/136,62 cierres y las comprobaciones de reinicio. Siete trabajos CI de ese SHA también aprobaron completos, incluidos ambos Windows/Node24 y Windows/Node22 en push. Sus logs Windows registran124 descubrimientos/cierres del probe y no muestran `ERR_NO_BUFFER_SPACE`.

El último trabajo PR Windows/Node22 [125715483993](https://github.com/pepoj1046-svg/proyecto-nexo/actions/runs/41574731246/job/125715483993) fue cancelado entre03:52:12 y04:22:18UTC: al llegar al presupuesto30min había aprobado116 E2E y49 laboratorios, sin fallos de aserción ni `ERR_NO_BUFFER_SPACE`. No completó la batería y no se declara aprobado.

El workflow conserva **30 minutos por job**, los timeouts de cada prueba/HTTP/SQL y `retries:0`. La carga se distribuye en trabajos independientes: dominio/PostgreSQL; web desktop; web mobile. Cada combinación Ubuntu/Windows×Node22/24 ejecuta una vez77 unitarias+395 PostgreSQL,68 E2E desktop y68 E2E mobile. Son12 jobs por evento (4 de dominio y8 web), con los mismos540 casos distintos/608 ejecuciones agregadas por combinación; las fases, plataformas y eventos no son casos nuevos. Los dos proyectos web completos siguen usando todas las suites y verifican cierre/reinicio por separado.

La sintaxis YAML y el producto de matrices fueron comprobados; no hay dependencia de datos entre trabajos, cada uno crea su laboratorio efímero. CodeQL también se dispara con cambios del workflow de pruebas para verificar el SHA final. Los182 archivos de aplicación/pruebas/migraciones son idénticos a los del pase local completo en `a720abe`; se agregan fingerprints de ambos workflows (184 en total). Por este cambio exclusivo de CI no se repite otra batería local de aplicación sin cambios: la matriz final ejecuta toda la cobertura en el SHA final y su resultado real se ratifica en el PR. No se aumentó un límite para ocultar el cierre incompleto.
