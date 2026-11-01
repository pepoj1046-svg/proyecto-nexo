# Trufis Bolivia — Auditoría integral y cierre técnico de Etapa 3

Fecha: 01/11/2026, America/La_Paz. Solo laboratorio con datos ficticios.
Repositorio `pepoj1046-svg/proyecto-nexo`, rama `desarrollo/etapa-3`, referencia
`0fcc8958dd14d5c502f9cbefa3d9f847378d0050`. Remoto, HEAD exacto y árbol limpio
comprobados antes de editar. [PR #3](https://github.com/pepoj1046-svg/proyecto-nexo/pull/3)
abierto hacia `desarrollo/etapa-2`; sin merge ni cierre.

## Resumen ejecutivo y validez del dictamen

**«Etapa 3 cerrada técnicamente en laboratorio. No autorizada para producción».**

Este dictamen se refiere exclusivamente al commit final y a las validaciones
aprobadas que identifica el [registro final de esta auditoría](https://github.com/pepoj1046-svg/proyecto-nexo/pull/3#issuecomment-6561718192).
El documento se publica junto con el código: mientras el registro indique CI
pendiente, el dictamen no está ratificado. La entrega exige matriz Ubuntu/Windows
con Node 22/24 y CodeQL aprobados sobre ese mismo commit, además de la batería local.
No se usa la CI del incremento anterior como aprobación del cierre actual.

Se contrastó el alcance funcional, no solo la cantidad de pruebas. Los flujos web
principales comprometidos están conectados al núcleo PostgreSQL; las operaciones
sin contrato comercial/jurídico conservan bloqueo y revisión humana. No quedan
hallazgos críticos o altos conocidos sin resolver dentro de este alcance una vez
cumplidas las validaciones enlazadas. No es una certificación independiente ni una
afirmación de ausencia de vulnerabilidades desconocidas.

La auditoría encontró un defecto alto en revisiones sucesivas de menor, uno medio
en generación sucesiva de códigos y una diferencia baja entre alcance del listado
de responsables y RLS. Se reprodujeron antes de corregir, se aplicaron cambios mínimos
y se añadieron regresiones. También se corrigieron instrucciones y cifras vigentes.

## Alcance y metodología

- Se revisaron requisitos originales y decisiones posteriores, cierres de Etapas
  1–2, contratos vigentes y los incrementos 1–8B de Etapa 3, especialmente 7A/7B/8A/8B.
  No existe `docs/PROPUESTA_ETAPA_3.md`: no se inventa una propuesta ausente; el alcance
  se reconstruye desde autorizaciones registradas, AGENTS, contratos e informes.
- Se inspeccionaron migraciones 001–032 y sus contratos resultantes, identidad,
  runtime, gateway, servicios, React/TypeScript, pruebas, evidencias y límites.
  Los modelos conceptuales iniciales no se contaron como funcionalidades construidas.
- Dos subagentes genéricos con instrucciones manuales trabajaron solo en lectura;
  el principal reprodujo, corrigió, ejecutó pruebas, integró y publicó. Sin carga
  automática de perfiles TOML, otros editores ni matrices ejecutadas por auditores.
- La referencia 8B se comprobó en GitHub: 419 casos documentados, ocho jobs aprobados
  en runs 41314545557/41314551411 y CodeQL 41314545499. Es antecedente, no sustituto
  de las ejecuciones nuevas ni evidencia suficiente por sí sola para el cierre.
- Se priorizó reproducción dirigida, después estabilidad y una batería integral
  final. No se ampliaron límites de pruebas ni se activaron reintentos automáticos.

## Matriz de requisitos

Categorías: **IV** implementado y verificado; **IL** implementado con limitaciones;
**PT** pendiente técnico; **PE** pospuesto expresamente; **BP** bloqueado por política
comercial, jurídica o administrativa. La verificación ejecutada queda condicionada
al registro final; las referencias siguientes identifican código y casos concretos.

| ID | Requisito | Categoría | Implementación, evidencia y límite |
|---|---|---|---|
| R01 | Búsqueda solo origen/destino; homónimos y jerarquía | IV | 005–009, search/localities y `app.spec`; sin selector geográfico comercial. Catálogo ficticio/versionado. |
| R02 | Asociación, ruta, permiso y puntos habilitados | IV | RLS, autorizaciones/topología; G/C/W/O/J/K y E2E de puntos. No domicilio arbitrario, retorno o desvío inventado. |
| R03 | APP 1–6 y tarifa/versionado aceptados | IV | Inventario `bookings`, quote/reserve, J701/J702; importe/versiones inmutables al cambiar tarifa. Sin cobro. |
| R04 | Seis plazas simultáneas por segmento | IV | `live`/`fits`, locks y restricciones; carreras SQL, sobreventa web, Q31 y testigo SQL. No confundir con seis reservas acumuladas. |
| R05 | Asignación por turno en terminal | IV | 029, K801/K802/K815; nuevas terminales/expreso CONFIRMED sin aceptación ficticia, BOARD ni salida. |
| R06 | Aceptación de recogidas fuera de terminal | IL | HELD URBAN/ROAD/UNCLASSIFIED, chofer legítimo y expiración técnica de dos minutos; contrato comercial pendiente. |
| R07 | Presenciales sin cuenta, mismo inventario | IV | WALK_IN y APP delegan al mismo núcleo; Z02/Z03/T8B01, terminal-sales/care-responsible. |
| R08 | Expreso | IL | Tarifa expresa configurada y seis plazas técnicas por segmento; J701/K801, journey-modes. No afirma seis personas físicas. |
| R09 | Grupos juntos y división voluntaria | IL | Retenciones/confirmación grupal atómicas; J702/K802/K811; declaraciones de adultos y consentimiento, no separación de menores. Puntos distintos dentro de una petición no admitidos. |
| R10 | Sobreventa, duplicados, rollback e idempotencia | IV | Carreras y errores inyectados de reservas/movimientos/recepción; AU301–303 y E2E de actuación nueva frente a respuesta incierta. |
| R11 | Filas independientes y completos adelantados | IV | Ruta dirigida/asociación, posición estable, salida de lleno sin reordenar incompletos; pruebas T/B/Q/K y terminal-return. |
| R12 | Salida explícita y cuatro terminal + dos recogidas | IV | `operations.spec`: seis confirmadas no provocan salida; chofer inicia recogidas, Palmar, trayecto principal, llegada y descensos. |
| R13 | Abordajes/descensos individuales o grupales | IV | 012–016, historial/episodios; modos no se mezclan, capacidad física ≤6; I/L/Q/O y E2E. |
| R14 | Ya llegué, verificación y progreso propios | IL | Pasajero declara; administrador observa; chofer registra hechos. Consultas manuales sin GPS/ETA ni confirmaciones repetidas del pasajero. |
| R15 | Ausencia individual, parcial y posterior a salida | IV | T8B05/06/19/21 y operations/care; actor/motivo/episodio, sin liberar plazas; BOARD posterior conserva nota histórica. |
| R16 | Condiciones/versiones y rechazo del responsable | IL | 028, J711–717, conditions; tarifa original conservada, REJECT bloquea BOARD. No certifica transitabilidad ni permite reversión sin contrato. |
| R17 | Cancelación propia y administrativa | IV | 027/A601–609, administración paginada y terminal-sales; motivo/confirmación/alcance, no pasajeros a bordo ni grupo iniciado. |
| R18 | Solicitudes y recuperación tardía | IL | Decisión del responsable vigente, aprobación nativa, reserva única sin movimientos; J714/T8B11/12/18. Grupos incompatibles siguen revisión humana. |
| R19 | Avería, bloqueo, sustitución terminal | IL | Incidencias/fleet, candidatos válidos y consentimiento; recovery-terminal, K807–811; no vehículo apto implica revisión, sin promesa de solución. |
| R20 | Recepción y custodia del sustituto | IV | 030, K803/804/808/810/814; solo integrantes realmente abordados, receptor activo y confirmación separada. No BOARD/ALIGHT sintéticos. |
| R21 | Rescate urbano/carretera | IL | Unidad totalmente libre de misma asociación y terminal autorizada, receptor legítimo; Q/R/K y suites recovery. Sin GPS, tiempos o rescate automático. |
| R22 | Retorno voluntario y rehabilitación | IL | request-queue/web_request_queue y terminal-return; sin duplicar filas ni reincorporar automáticamente unidad retirada. |
| R23 | Responsable offline y vínculo de cuenta | IL | 031/T8B01–03/11–12/20, care-responsible: revisión monotónica, código de un uso, corrección auditada. Excepción CLI heredada explicada abajo. |
| R24 | Menores y acompañantes | IL | 018/032, Q17/Q18/Q28/T8B04 y care; revisión técnica/mismo grupo, compañía real y bloqueos. No validación legal de edad/parentesco. Defecto de revisiones sucesivas corregido. |
| R25 | Discrepancias, revisiones y rectificaciones | IL | Evidencia del servidor, revisión versionada y corrector nativo; T8B07/08/10. Últimos 50 reportes, custodia/finalizados sin reversión automática. |
| R26 | Paginación de reservas/manifiestos >50 | IV | 027, administration y T8B16/AU301; cursores, permisos y conteos globales sin limitar inventario a filas visibles. |
| R27 | Historia y auditoría | IL | Registros originales y compensaciones separados e inmutables. Consultas operativas tienen cotas; no se afirma acceso web histórico ilimitado. |
| R28 | Roles, asociaciones, terminales y vehículo | IV | H/S/Q/R/A/T8B y AU301–302, operation-permissions/care-accounts; admin limitado no eleva alcance, chofer ajeno no opera. |
| R29 | Sesiones, CSRF, SQL/RLS y datos mínimos | IV | Identidad/runtime/gateway, H01–11/S01–09/W/K812/T8B14/H08; pools separados y RPC privada. Límites locales detallados abajo. |
| R30 | Paneles pasajero, chofer y operador/admin | IL | `Functional`, `Operations`, `Terminal`, `Management`, `Recovery`, `Safety`, `Care`; operador representado por alcance administrativo, no quinto rol. |
| R31 | Administración general y configuración completa | PE | Provisión/revisor y catálogo offline; web solo permisos DRIVER existentes. Licencias, autoservicio de altas y panel general completo no comprometidos en este laboratorio. |
| R32 | Móvil, escritorio, accesibilidad y errores | IL | Chromium 1440×1000/390×844, axe/teclado/ancho, carga y errores. No Safari/Firefox, dispositivos físicos o evaluación manual integral. |
| R33 | Windows y reproducción local | IL | CI Ubuntu/Windows × Node22/24 y PowerShell; IPC Windows/SIGINT Linux. No afirmar prueba manual Windows ni persistencia de producción. |
| R34 | Custodia/compañía, grupos especiales y política económica | BP | Contratos ausentes se rechazan/documentan, sin modificación parcial, consentimiento o consecuencia económica inventados. |
| R35 | Identidad legal, retención, ausencias/tolerancias | BP | Requiere decisión competente; sin plazos legales, sanciones o documentos inventados. |
| R36 | GPS/mapas/avisos, OAuth, pagos/bancos, producción y Etapa4 | PE | Fuera del alcance autorizado. No se cuentan como errores ni se implementan para simular completitud. |

Tras las correcciones no quedan **PT** obligatorios conocidos que bloqueen el
laboratorio. IL/BP/PE no se convierten en IV para aparentar cierre; antes de piloto
varios pasan a ser requisitos obligatorios y requieren autorización independiente.

## Hallazgos y correcciones comprobadas

| ID / gravedad | Reproducción antes de corregir | Cambio mínimo / regresión |
|---|---|---|
| AU-H1 **Alto** | Mismo formulario de menor: PENDING → VERIFIED_SIMULATED → PENDING recibió 200, pero PostgreSQL conservó VERIFIED_SIMULATED. Afectaba la intención administrativa de volver a bloquear BOARD. | `use-command.ts` retira solo la clave del intento tras POST y recarga resueltos. E2E care exige cuatro revisiones reales PENDING/VERIFIED/PENDING/VERIFIED y rechazo BOARD tras la tercera. |
| AU-M1 **Medio** | Generar código, consumirlo, desvincular y generar otro desde la misma pantalla devolvió el código consumido. Existía alternativa segura de recargar. | Misma corrección de ciclo del intento. E2E exige código nuevo, vínculo efectivo e historial de seis actuaciones; pérdida deliberada de respuesta del nuevo POST conserva clave en el reintento. |
| AU-L1 **Bajo** | Responsable de dos WALK_IN quedó limitado administrativamente a otra ruta: RLS/contexto negaron acceso, pero care_responsible_list devolvió total 2 y filas propias ocultadas por el ámbito. Sin evidencia de terceros. | 033 filtra total/filas/nextCursor por scope_allows, comparte lock de alcance y revalida sesión tras esperar. AU301/AU302 y paginación anterior. |
| AU-L2 **Bajo** | README prescribía aceptar una terminal nueva y decía suite actual 57/239. Algunas secciones iniciales presentaban como pendientes funciones locales ya construidas. | Guía/contadores/precedencia actualizados, sin alterar informes históricos ni convertir funciones futuras en implementadas. |
| AU-P1 **Pendiente de política/contrato** | Primera asignación nativa de responsable todavía admite UUID y comprobación presencial ficticia por ADMIN autorizado, sin código del titular. Es compatibilidad explícita 016/031, no autoservicio ni una regresión nueva. | Se delimita la excepción y su confianza; unificar/deprecar antes de piloto requiere decisión de contrato. No se rompe la RPC heredada ni se presenta como equivalente a la web. |

Las reproducciones fallaron realmente en `.local/cierre-minor-before.log`,
`.local/cierre-code-before.log` y `.local/cierre-scope-before.log`. Los logs son
privados; no publicar códigos ni trazas. Las salidas fallidas no se cuentan como
aprobadas. No se usaron reintentos de test, sleeps de estabilización ni aserciones
relajadas; se mantuvieron y ampliaron las verificaciones anteriores.

La corrección del intento no vacía todo el Map, no elimina en finally ni borra
recibos SQL: POST incierto o recarga cuya promesa falla conservan la clave. Tras
éxito completo, otra confirmación del usuario es una actuación nueva. Se revisó
la venta presencial: conserva formulario congelado, recibo y acción explícita para
otro grupo; no se introduce una segunda venta accidental por repetir un envío incierto.

## Hallazgos de los subagentes

`seguridad_cierre_etapa3` examinó SQL, sesiones, RPC/ACL/search_path, RLS, permisos,
filas/capacidad, grupos, custodia y fronteras 031–032. Señaló AU-L1 y AU-P1. No
identificó otro crítico/alto demostrable; las hipótesis no se contaron como pruebas.

`funcionalidad_cierre_etapa3` contrastó compromiso/UI/casos y documentación. Señaló
AU-H1/AU-M1/AU-L2 y límites de catálogo/provisión, informes y dispositivos. Descartó
la hipótesis de fallo revocar/restaurar/revocar en CareAccounts: el padre desmonta
el componente y limpia ese contexto. No se presenta como vulnerabilidad encontrada.
Revisó después la corrección mínima del ciclo de claves, conservando reintentos inciertos.

Ambos fueron genéricos/manuales y de solo lectura; ninguna ejecución, mutación,
commit ni consulta remota de sus auditorías se contó como validación ejecutada.

## Migraciones y compatibilidad histórica

**001–032 conservadas sin modificar.** Nueva `033_responsible_list_scope.sql`:
CREATE OR REPLACE del listado, misma firma/OID/contrato, search_path fijado, PUBLIC
revocado y EXECUTE solo de aplicación. No tablas, DML, backfill, inventario paralelo,
reescritura de hechos ni cambio de tarifas/grupos/custodia.

AU303 crea PostgreSQL con 001–032, copia fixture poblada con vínculo, código usado
y pendiente, menor, ausencia y reporte/revisión. Compara todas las tablas nexo antes
y después de 033, registro previo de migraciones, identidad de función y reaplicación.
Las actualizaciones históricas y errores DDL/checksum anteriores siguen en la batería.
AU302 verifica revocación real mientras el listado espera el bloqueo de alcance.

## Revisión de seguridad y riesgos residuales

- No autoridad derivada de IDs/roles/asociaciones del navegador. ADMIN/DRIVER y
  terminal/ruta se comprueban en SQL; RLS/ACL niegan DML, helpers, credenciales y
  acceso entre asociaciones. H08 inspecciona todas las funciones privilegiadas.
- `nexo_identity` es autoridad confiable de emisión; propietario/provisión y SO
  no están contenidos por RLS. Nunca son conexiones de aplicación ni roles de la web.
- Sesiones opacas revocables, actor revalidado y serialización donde corresponde.
  No se afirma abortar una sentencia ya autorizada al revocar. Un Bearer válido es
  reutilizable hasta caducidad/revocación; no es un mecanismo de un solo uso.
- Cookie HttpOnly/SameSite, Origin/Host exactos y CSRF en POST privados. HTTP sin
  Secure solo en 127.0.0.1; no protege frente a otro proceso hostil del mismo SO.
- Límites locales: 120 API/minuto y seis simultáneas globales, no perímetro
  distribuido ni protección suficiente para Internet. La UI no es frontera de permisos.
- Código de vinculación no es comprobación legal. El registro CLI inicial anterior
  exige operador confiable; cliente/pasajero con referencia sola no se apropia reservas.
  Su unificación con el protocolo de código queda expresamente pendiente de contrato.
- No se promete cierre de alertas históricas CodeQL. El conector disponible rechazó
  enumerar `/code-scanning/alerts` por endpoint no admitido (400); se verifican el
  analizador y el check separado del commit, sin inventar una enumeración de alertas.
  Auditoría estática y riesgos históricos de los informes sí se contrastaron.
- `npm audit` y `npm audit --omit=dev` se ejecutaron sin instalar ni actualizar
  paquetes: cero vulnerabilidades reportadas en la consulta de advisories, incluidas
  dependencias de desarrollo en la primera. No certifica ausencia de defectos ni
  reemplaza la auditoría de código o la revisión de alertas CodeQL.
- No pruebas de carga nacional, seguridad externa certificada, backups/restauración
  de producción, operación offline real o continuidad ante caída del servidor/SO.

No se detectaron otros críticos/altos conocidos pendientes en lo revisado. La
superficie de confianza y las limitaciones anteriores permanecen explícitas;
producción exige controles y decisiones adicionales.

## Pruebas finales y evidencias

Batería final ejecutada sobre el código estabilizado: **422/422 aprobadas**:
62 unitarias, 278 de integración PostgreSQL real y 82 E2E Chromium
(41 escritorio y 41 móvil). Cero fallos y cero omisiones. Se conservan los
419 casos anteriores y se agregan AU301–303, además de ampliar dos E2E existentes.
No se usa solo el total para decidir cierre.

`test:all` completó también propagación de errores del runner, compilación
TypeScript/web y smokes HTTP de identidad y negocio, con cierre de procesos.
`test:web` ejecutó una única batería final completa: 38 laboratorios independientes,
cierre verificado de listeners/PostgreSQL, SIGINT real y reinicio sin reutilizar
sesión, contraseña ni reserva anterior. Las pruebas dirigidas precedentes no se
suman de nuevo al total. No se aumentaron tiempos ni reintentaron casos para ocultar
fallos.

Entorno local real: Debian 13, Node 24.19.0, PostgreSQL 18.4,
Playwright 1.64.1 y Chromium 154. Ubuntu/Windows y Node 22/24 se verifican
separadamente en GitHub Actions sobre el SHA final del registro enlazado.

Comandos reproducibles:

```text
npm run test:all
npm run test:web
npm run web:build
```

El [registro final](https://github.com/pepoj1046-svg/proyecto-nexo/pull/3#issuecomment-6561718192)
contiene SHA final, runs/jobs, resultados exactos Ubuntu/Windows × Node22/24 y
CodeQL sobre ese commit. Se actualiza ese registro tras CI para evitar commits
de solo resultados que cambien el SHA que se acaba de verificar.

Las [evidencias históricas 8B](evidencias/etapa-3-incremento-8b.json) conservan sus
capturas y hashes, sin presentarlas como capturas del commit de cierre. Las nuevas
regresiones contrastan SQL independiente READ ONLY y tres sesiones reales de
Chromium. El [paquete de cierre](evidencias/etapa-3-cierre.json) contiene resultados,
hashes de logs privados y de las 32 migraciones preservadas, y cuatro capturas nuevas
(escritorio/móvil). No contiene accesos, cookies, códigos de vinculación, contraseñas
ni datos personales reales. Las capturas de cuidados muestran el estado final tras
cuatro revisiones; la vuelta intermedia a PENDING y su bloqueo de BOARD se prueban
con aserciones SQL/UI, no se infieren de esa imagen final.

## Procedimiento sencillo Windows

En una copia limpia de la rama autorizada, con Node 22 o 24:

```powershell
npm ci --no-fund
npx --no-install playwright install chromium
npm run test:all
npm run test:web
npm run dev:web
```

Abrir solo `http://127.0.0.1:<puerto>` indicado. Leer el archivo privado de accesos
ficticios que imprime el comando; no compartirlo ni publicarlo. Usar perfiles de
navegador independientes para pasajero, administración y chofer.

1. `operativo0` consulta reserva y declara «Ya llegué». `adminH`, FICTICIO-OPERATIVO,
   verifica y observa cuatro en terminal. `driver5` ve seis confirmadas/cuatro
   abordadas sin salida automática; registra recogidas, llega a Palmar, observa dos,
   inicia principal y avanza hasta Villa Montes, registrando descensos por separado.
2. Administración consulta incidencias y candidatos; chofer reporta avería, receptor
   observa recepción y confirma traslado seguro. Ausencia de unidad o contrato
   implica revisión, sin GPS, asistencia automática ni tiempos inventados.
3. En un laboratorio fresco, revisión técnica del integrante 1/acompañante 2:
   PENDING → VERIFIED_SIMULATED → PENDING debe mostrar realmente PENDING; BOARD
   queda bloqueado. Solo una revisión técnica posterior admite continuar según el
   contrato, sin declarar autorización legal. No inventar personas/edades/documentos.
4. Registrar presencial de dos plazas en FICTICIO-WEB-0-0. Crear responsable offline;
   titular genera un código y operador lo consume. Desvincular; sin recargar, generar
   otro debe dar un código nuevo. Solo el operador autorizado comprueba y vincula;
   conocer referencia no autoriza. No tomar capturas con el código visible.
5. Para permisos globales ficticios usar el procedimiento `NEXO_WEB_CARE_ACCOUNTS_FIXTURE`
   de [8B](ETAPA_3_INCREMENTO_8B.md). Revocar y restaurar solo membresía DRIVER
   existente; el chofer abierto pierde operaciones durante revocación. No hay
   aprovisionamiento web ni ampliación automática de asociación.
6. Ejecutar dirigidas si se quiere revisar solo los cambios de cierre:

   ```powershell
   npm run test:web -- --suite=care.spec.mjs,care-responsible.spec.mjs
   npm run test:integration -- --test-name-pattern=AU30
   ```

Ctrl+C detiene el laboratorio; el runner comprueba puertos, IPC Windows y reinicio
sin recuperar accesos/reservas previos. No se afirma prueba manual Windows realizada
por el agente: la evidencia de Windows procede de Actions. No ejecutar builds de
`dist` simultáneamente con un navegador de laboratorio ya abierto.

## Decisiones previas a un piloto real y preparación para Etapa 4

1. Revisar/aceptar el alcance de laboratorio y autorizar por separado el siguiente
   trabajo. Este informe no inicia Etapa 4 ni fusiona el PR #3.
2. Aprobar identidad legal, responsable/consentimiento, menores y correcciones de
   compañía/custodia; resolver compatibilidad CLI y acceso histórico tras cambios.
3. Definir retención/borrado de identidad, intentos, evidencias, recibos y auditoría;
   términos, atención humana, contacto/recuperación y requisitos locales aplicables.
4. Acordar ausencias/tolerancias, TTL definitivo de ofertas, salida con faltantes,
   grupos tardíos, cambios rechazados y reservas futuras tras revocar permisos.
   10+5 histórico permanece inactivo; 0/5/8 y recogida5 son referencias simuladas,
   no plazos comerciales aprobados. Sin sanciones, cancelaciones o avisos automáticos.
5. Antes de GPS/mapas/notificaciones, definir finalidad, permisos, datos reales,
   minimización, caducidad, privacidad, geografía autorizada y comportamiento offline.
   Evaluar proveedores/costos solo con autorización; aquí no se elige ni contrata uno.
6. Diseñar y aprobar infraestructura, TLS/MFA, protección distribuida, monitorización,
   restauración, carga y auditoría independiente antes de un despliegue/piloto.
7. Pagos/licencias/bancos, cobros y reembolsos necesitan contratos y etapas propias;
   este cierre no mueve dinero ni promete resolverlos.

Se entrega únicamente el laboratorio auditado y la preparación documental. Las
condiciones para producción no quedan satisfechas por aprobar las pruebas locales.
