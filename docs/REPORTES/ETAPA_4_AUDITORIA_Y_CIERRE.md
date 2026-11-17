# Etapa 4 — auditoría integral y cierre técnico de laboratorio

Fecha:03/11/2026. Repositorio exclusivo `pepoj1046-svg/proyecto-nexo`, rama
`desarrollo/etapa-4`, [PR #5](https://github.com/pepoj1046-svg/proyecto-nexo/pull/5)
abierto en borrador hacia `planificacion/etapa-4a`. Base comprobada:
`61b126d6d6698819ef3817c2ead1f4880cf1bb23`, árbol inicialmente limpio y remoto
coincidente. El encargo4A.6 del propietario sustituye la prohibición histórica de
iniciarlo en AGENTS.md. No se modifica main, etapas anteriores ni PR #3.

## Dictamen y trazabilidad del commit

**Dictamen propuesto: CERRADA técnicamente en laboratorio**, exclusivamente para
los contratos4A.1–4A.5 y las correcciones4A.6 descritas aquí, sujeto a la ratificación
de Actions y CodeQL del commit publicado. La cabecera del PR #5 registra el **SHA
final exacto**, enlaces/IDs de runs y lectura de sus logs después de publicarlos;
no se atribuyen resultados de61b126d a fuentes nuevas. Si un check final no aprueba,
el dictamen queda NO CERRADA hasta resolverlo y repetir la validación afectada.
El informe se publica con el código antes de esos runs; su ratificación se registra
en el PR, sin fabricar una autorreferencia SHA dentro del propio commit.

No se encontraron críticos/altos nuevos demostrados en el alcance auditado. Se
corrigieron defectos medios y se documentan las dependencias restantes. Esto no
certifica seguridad externa, habilitación legal, autonomía total, preparación
comercial completa ni producción. El propietario conserva la revisión del PR;
no se fusiona, cierra ni inicia Etapa5.

## Revisión inicial y fuentes

Se contrastaron requisitos, arquitectura/modelo, seguridad y pruebas de Etapa1,
cierres de Etapas1–3, skill local `trufis-dev`, AGENTS, plan maestro, plan Etapa4,
ADR y contratos/informes4A.1–5; inventario001–039 y cuerpos relacionados con
privilegios, administración, conservación y operaciones. El trabajo fue repartido
en dos auditorías de lectura acotadas; el principal fue el único editor, ejecutor
y publicador. Se leyeron estado y comentarios del PR #5, incluida la revisión
independiente de4A.5 que ratifica61b126d y conserva riesgos offline/Windows/evidencia.

Referencia inicial verificada: **540 definiciones** =77 unitarias+395 PostgreSQL+68
E2E; **608 ejecuciones** con ambos dispositivos. Los24 jobs de4A.5 y CodeQL
corresponden a61b126d, no al commit de esta auditoría. Su evidencia histórica sigue
en el PR y en [4A.5](ETAPA_4_INCREMENTO_4A5.md).

## Funcionalidades existentes e integración

| Incremento | Disponible y verificado | Frontera conservada |
|---|---|---|
| 4A.1,034 | Directorio de asociaciones, DRIVER, vehículos, rutas, puntos, tarifas; sin seleccionar viaje; páginas y ámbito de ruta/asociación | Lectura no equivale a disponibilidad contractual ni reserva |
| 4A.2,035 | Revocar/restaurar DRIVER existente, contacto LAB y motivos/historial | No crea membresías por esa puerta; fila, servicio, rescate/custodia bloquean retirada |
| 4A.3,036–037 | GENERAL_ADMIN explícito, bootstrap único offline, atestación, asociación inerte, primer ADMIN/delegaciones y revisión simulada | No owner, acceso operativo global ni habilitación comercial/legal; protege último ADMIN completo recuperable |
| 4A.4,038 | Solicitud/revisión DRIVER y VAGONETA_6, asignación/desasignación base e historial | Capacidad seis; no crea viaje/fila ni mueve pasajeros; ocupación pendiente exige revisión |
| 4A.5,039 | Borrador, validación/publicación/retiro, OUT/IN explícitos, perfiles y tarifas nativas versionadas | No permiso/primera fila automáticos, edición histórica o topología habilitada ambigua |
| 4A.6,040–041 | Reautorización de revisiones nativas tras esperas y recuperación de intención web, incluso al caducar sesión | Sin inventario nuevo ni ampliación comercial |

Se reutilizan servicios SQL parametrizados con transacciones READ COMMITTED,
listas cerradas de campos, RPC fijas y límites; el gateway no admite SQL/RPC genérica.
La web React/TypeScript se sirve compilada y local, sin recursos/proveedores nuevos.
PostgreSQL conserva inventario, recibos, ámbitos y auditoría como fuentes de verdad.

## Matriz de autoridad comprobada

| Actor | Permisos reales | Denegaciones relevantes |
|---|---|---|
| GENERAL_ADMIN | Registro inerte, delegación/revocación ADMIN y revisión técnica de estados de plataforma | No flota, reservas, pasajeros o configuración operativa global por ese solo perfil |
| ADMIN completo | Directorio propio; DRIVER existente, contacto, altas/base y rutas/tarifas propias | Asociación ajena, vehículo comprometido, último ADMIN irrecuperable, revisión obsoleta/ABA |
| ADMIN limitado | Consultas y tarifas de rutas concedidas conforme a contrato | Padrones completos, altas/asignaciones, topología nueva y rutas ajenas |
| DRIVER | Manifiesto/operación de su asignación legítima | Alta/aprobación, administración de flota y configuración |
| Pasajero/responsable | Reservas y revisiones autorizadas por núcleo previo | Apropiación por referencia, datos de terceros o facultades administrativas |
| REVIEWER | RPC nativas confiables de revisión simulada de permiso/asociación | Autorrevisión de permiso, administración4A o acceso operativo universal |
| nexo_app / nexo_identity | Pools separados de negocio/emisión de identidad | DML directo, helpers privados y combinación con owner/provisioner |
| nexo_provisioner / owner | Preparación offline confiable y migraciones del laboratorio | Nunca conexiones HTTP ni perfiles elegibles en formularios |

RLS, grants, search_path y SECURITY DEFINER se inspeccionan y prueban (H08 y
regresiones de módulos). Las RPC modificadas por040–041 conservan firma/OID/ACL: helper privado
sin EXECUTE de runtime; revisión de asociación mantiene su puerta nativa existente.
El owner y el SO son autoridades confiables, fuera de la protección de RLS.

CSRF, Origin/Host exactos, cookies HttpOnly/SameSite, sesiones opacas revocables,
campos permitidos y separación de asociación siguen en la batería completa.
Bloquear botones es ayuda operativa: SQL vuelve a comprobar permisos. Un cambio ya
autorizado y serializado puede terminar antes de una revocación que deba esperarlo;
no se promete interrumpir retrospectivamente todo trabajo autorizado.

## Recorrido integral desde asociación nueva

`4A6-A` se ejecuta en PostgreSQL real, recién instalado, con geografía sintética
como preparación común. La **asociación objetivo es nueva y no hereda** recursos,
permisos, miembros o viajes de las asociaciones del fixture. Las otras asociaciones
ficticias permanecen como testigos de aislamiento, no como recursos prestados.

1. `initializePlatform` con conexión nexo_provisioner genera archivo exclusivo y
   secreto aleatorio; login real del GENERAL_ADMIN mediante identidad existente.
2. REGISTER deja asociación SUSPENDED/PENDING/SUSPENDED. Candidato registrado,
   atestación offline y DELEGATE de primer ADMIN; login real del nuevo ADMIN.
3. Directorio solo muestra su asociación. Solicitud/aprobación DRIVER atestado,
   vehículo VAGONETA_6 y asignación base; sin crear viajes.
4. Publicación de OUT e IN independientes con puntos/perfiles explícitos; tarifas
   ordinaria12 y expresa65 BOB ficticios. No permiso ni primera fila. Elegibilidad
   falsa y cotización bloqueada: la publicación administrativa no habilita ventas.
5. **Fase privilegiada LAB explícita:** owner cambia status comercial a ACTIVE;
   nexo_provisioner incorpora REVIEWER independiente; review_association simulado
   actualiza adhesión/operación. ADMIN solicita permiso y otro actor lo revisa por
   RPC nativa. Owner del harness crea primer viaje/fila. No existe consola web que
   complete esas cuatro dependencias ni se acredita autorización legal.
6. Núcleo cotiza24 por dos plazas y65 por expreso; confirma reserva terminal de
   dos plazas con el inventario único. No se inventa abordaje ni salida.
7. Otra tarifa produce36 para dos plazas nuevas; una nueva versión de ruta obtiene
   otro UUID. Reserva original conserva importe, tarifa/fechas/versiones, integrantes,
   recibo y viaje. Retiro incompatible y desasignación quedan bajo revisión, sin
   cambios operativos; máximo seis por segmento.
8. Se comprueban denegaciones de ADMIN ajeno/limitado, DRIVER, pasajero, REVIEWER y
   GENERAL_ADMIN sin autoridad operativa. Protección del último ADMIN, historial
   y reaplicación vacía se verifican al finalizar.

La prueba integral nueva es de servicio/PostgreSQL; las31 suites Playwright por
proyecto comprueban pantallas reales, roles y recuperación. Móvil es emulación
Chromium, no un dispositivo físico ni certificación de Safari/iOS. No se presenta una
secuencia enteramente automatizada en navegador como si existiera, ni el setup
owner como función comercial implementada. Procedimiento reproducible y demostración
web en [la guía](../ETAPA_4_GUIA_ADMINISTRACION.md).

## Hallazgos, reproducción y correcciones

| Hallazgo | Severidad/impacto | Corrección y regresión |
|---|---|---|
| DRIVER pendiente no propagaba bloqueo al directorio | Media, pérdida de cuerpo/clave al desmontar tras POST confirmado+refresco403 | onBusy incluye permiso/contacto pendiente; paginación padre/interna protegida; driver-admin-races |
| Navegación global o logout/refresh podían desmontar formularios administrativos inciertos | Media, repetición sin recibo original y recuperación confusa; no bypass de capacidad demostrado | Guardia en memoria por intento4A, navegación SPA/popstate y aviso beforeunload; directorio deshabilitado durante cambio de sesión; pruebas móvil/escritorio |
| Sesión caducada durante recuperación dejaba bloqueo sin acceso a la cuenta original | Media, pérdida de clave al forzar recarga | Login de recuperación sin desmontar; otra cuenta no desbloquea; mismo cuerpo/clave y un acto tras autenticación correcta |
| REVIEWER revocado durante espera de ruta aún podía verificar permiso | Media, decisión posterior a retirada de autoridad en RPC nativa heredada | 040 revalida después de ruta/acción; locks compartidos de ámbito e identidad/sesión/rol; R-role y R-replay |
| Replay de review_association atravesaba revocación de rol/sesión | Media, devolvía recibo después de esperar con autoridad inválida | 040 devuelve caché solo tras estabilizar y revalidar; B-role/B-session |
| Caducidad natural durante espera del registro de asociación | Media, statement_timestamp anterior permitía decisión posterior al vencimiento | Asociación bloqueada antes de comprobación final con clock_timestamp; B-expiry y R-expiry |
| Recibo confirmado de flota/configuración rechazado por mutex de otra actuación | Media, reintento legítimo recibe BUSY pese a existir recibo | 041 separa lectura autorizada de recibo y escritor; F/C reproducen con mutex retenido, nuevos cambios siguen rechazados |
| Planes/README todavía afirmaban autorización4A.2 y ausencia de GENERAL_ADMIN | Baja, documentación contradictoria | Cabecera vigente y separación explícita del antecedente histórico; guía y alcance actual |

Las regresiones fallaron realmente antes de sus correcciones: directorio habilitado,
UNEXPECTED_SUCCESS para revocación REVIEWER, ambos replays de asociación y espera
hasta caducidad natural. No se atribuye a las sesiones un defecto que ya rechazaban
por action_finish: la regresión inicial de expiración hacia el pasado se sustituyó
por caducidad real posterior al inicio. Los primeros ensayos tuvieron errores de
harness (columna action_key, historia móvil oculta y espera de expiración bajo lock)
que se corrigieron; un runner dirigido bloqueado se terminó y su clúster cerró.
No se aumentaron límites ni ocultaron fallos con reintentos.

AuditorA confirmó permiso/replay, recomendó lock de ámbito compartido para evitar
inversión con ADMIN+REVIEWER y señaló el último lock de asociación antes del reloj.
AuditorB confirmó desmontajes e identificó logout ya iniciado y recuperación tras
caducidad. Sus revisiones finales fueron solo lectura; el principal reprodujo,
programó y ejecutó. Se descartó la sospecha de contacto duplicado: ambos eventos
usan now y la regresión existente ya demuestra deduplicación. No se creó un cambio
innecesario para ese falso positivo.

## Archivos de esta auditoría

- Web: `main.tsx`, `Operations.tsx`, `DriverAdministration.tsx`, `use-command.ts`,
  `styles.css` y nuevo `admin-intent.ts` dentro de apps/web/src.
- PostgreSQL: nuevas040/041 y `tests/integration/postgres.test.mjs`; solo se
  amplían expectativas incrementales y cobertura, sin cambiar001–039.
- E2E: `driver-admin-races.spec.mjs`, `platform-admin-races.spec.mjs` y nuevo
  helper `tests/web/support/navigation.mjs`.
- Documentación: AGENTS, README, contrato de asociaciones, planes maestro/Etapa4,
  seguridad pendiente, este informe, nueva guía e índice de hashes EVIDENCIAS_4A6.
  No se modifican informes históricos de cierre ni workflows.

## Migraciones y conservación de operaciones

**001–039 intactas,39/39 SHA-256 comparados con preflight.**040 reemplaza dos funciones;041 añade un helper privado de lectura autorizada
y cambia únicamente la rama de recibo de dos RPC administrativas; no añade tablas, DML de backfill, otra fila/inventario, corrección de
hechos físicos ni cambios de precios. Conserva autorrevisión prohibida, recibos
nativos, contratos, OID y ACL; el runtime no puede llamar el helper interno.

U instala001–039 y copia datos ficticios de todas las tablas: reserva confirmada,
integrantes, recibos, configuración y contratos.040–041 conservan todas esas tablas y
registro anterior, firmas/OID/ACL de las cinco funciones involucradas (wrapper,
helper anterior, review_association y RPC de flota/configuración), y una segunda aplicación es vacía. La actualización
038→039→040→041 también permanece probada en4A5-24. Instalación limpia y upgrades
históricos se ejecutan en la batería completa; se actualizó la expectativa explícita
a41 migraciones sin debilitar checksums ni aserciones de conservación.

Pruebas previas conservan FIFO/asignación directa, seis plazas simultáneas por
segmento, inventario APP/presencial compartido, expreso/grupos, recogidas intermedias,
tarifas pactadas, viajes iniciados, movimientos individuales, sustituciones,
rescates, menores, discrepancias y recepción/custodia segura. Seis confirmadas no
autorizan inventar salida. No se introduce cancelación ni aviso externo automático.

## Pruebas y evidencia

Ejecución final sobre188 fingerprints idénticos a las fuentes publicadas, Node
**24.19.0**, PostgreSQL **18.4** real, Linux. Ambos comandos terminaron con exit0:

| Validación local | Resultado ejecutado |
|---|---|
| npm run test:all — unitarias | 77/77,0 fallos,0 omitidas |
| npm run test:all — PostgreSQL | 406/406,0 fallos,0 omitidas |
| TypeScript y compilación web | Aprobados por ambos scripts |
| Runner/lanzadores locales | Exit9 propagado; HTTP/negocio/PG detenidos |
| npm run test:web | 69 escritorio+69 móvil=138 aprobadas,0 fallos |
| Cierre E2E | 62/62 laboratorios; SIGINT real/puertos y reinicio aprobados |
| Pruebas dirigidas finales | 14/14 PostgreSQL; recuperación web en ambos proyectos aprobada |

**552 casos distintos** =77+406+69. **621 ejecuciones** =77+406+138 al contar los
dos dispositivos. Son11 PostgreSQL y1 E2E nuevos respecto de540/608; los casos
anteriores se conservaron y algunas regresiones E2E se ampliaron. No contar
plataformas, fases, reintentos o dispositivos como nuevas definiciones.

El primer pase completo de desarrollo obtuvo77/77 unitarias y402/403 PostgreSQL;
falló solo la expectativa de39 migraciones tras añadir040. Se corrigió a40 y se
repitió al estabilizar. La última espera de asociación añadió otro caso PostgreSQL.
Otra ejecución obtuvo77/77 y403/404 PostgreSQL:4A4-23 detectó FLEET_ADMIN_BUSY
con cuatro llamadas idénticas. Se reprodujo reteniendo el mutex después de confirmar
el recibo, también para configuración, y se corrigió en041. La liberación sucesiva
de locks explica plausiblemente el fallo simultáneo, pero no se afirma haber medido
esa secuencia interna. Se interrumpió de forma controlada la E2E intermedia al
confirmar el defecto SQL; listener/PG cerraron. Se repitió la batería tras041.
Los resultados finales prevalecen sobre esos ensayos intermedios.

Los resultados locales están ejecutados; los runs del SHA final comienzan después
de publicarlo. Ver la **ratificación4A.6 en el PR #5**, actualizada con SHA completo,
IDs de push/PR,24 jobs y CodeQL tras leerlos. Este informe no presenta CI de una
versión anterior como si fuera CI nueva; si no existe esa ratificación aprobada,
Actions/CodeQL permanecen pendientes y el cierre está condicionado.

Se conserva la matriz distribuida: núcleo/PG, web escritorio y web móvil, cada uno
Ubuntu/Windows × Node22/24 =12 jobs por evento (24 entre push y PR). Ningún cambio
4A.6 amplía timeouts, retries, límites o ratelimit. CodeQL security-extended JS/TS
verifica el mismo SHA publicado; no certifica SQL/RLS ni enumera/cierra por sí solo
alertas históricas no accesibles mediante el conector.

La mitigación Chromium4A.5 permanece: solo Windows automatizado, probe cerrado,
un único --disable-features con todos los valores originales más
TcpPortRandomization; otras plataformas sin probe. Sus pruebas puras y ejecución
real permanecen en la batería. Se conservan ERR_NO_BUFFER_SPACE de409fbc6 y la
cancelación de30min de a720abe; el éxito posterior no demuestra corregir universalmente
Windows. No se restaura la ejecución monolítica ni se amplían presupuestos.

Índice público de evidencia: [EVIDENCIAS_4A6.json](EVIDENCIAS_4A6.json),188
fingerprints de fuentes,39 hashes preservados y10 PNG de escritorio/móvil de esta
ejecución (ruta, tarifa, retiro, historial e intento protegido). ZIP privado
`.local/4a6-evidence-final.zip`, SHA-256
`a498c2c17ef85d8c75371d50bb7c2f8acc8299aa64fc87c9b75d3033aae0f23b`.
Logs finales privados: `.local/4a6-full-all-041.log` y
`.local/4a6-full-web-041.log`; repros/ensayos anteriores permanecen separados.

Las capturas/ZIP/trazas permanecen privadas bajo `.local`; se respeta el bloqueo de
publicación previa de evidencias incluso ficticias. No se intentó eludirlo por otro
canal ni se afirma una nueva denegación4A.6 inexistente. Los hashes públicos permiten
identificar los archivos; no sustituyen una publicación visual. Logs conservados;
solo se eliminan datos de clústeres temporales propios, detenidos y verificados.

## Riesgos y decisiones pendientes

| Punto | Clasificación y tratamiento |
|---|---|
| Defectos de reintento y reautorización descritos | Técnicos de este alcance: corregidos y con regresión; si falla CI, cierre suspendido |
| Recuperación tras pérdida total GENERAL_ADMIN | Decisión contractual del comprador; sin backdoor o acceso por registro público |
| Verificación profesional/legal de choferes y vehículos | Decisión contractual/jurídica; LAB no verifica licencias, documentos ni seguridad mecánica |
| Activación comercial/legal de asociaciones | Decisión contractual; estado inerte por defecto y procedimiento owner solo LAB explícito |
| Custodia, menores y revisión humana | Decisión contractual; se conserva revisión conservadora, sin reinterpretar hechos físicos |
| Retención, borrado y exportación | Decisión contractual; sin plazos legales inventados ni borrado de historial legítimo |
| Delegación global adicional y doble aprobación | Contrato pendiente; GENERAL_ADMIN actual tiene facultades cerradas |
| Topologías históricas de más de64 puntos | Riesgo LAB aceptable: nueva edición acotada; revisar casos legacy sin truncar obligaciones |
| Asignación base frente a primera fila/viaje | Dependencia LAB y trabajo operativo futuro pendiente de contrato; no autonomía completa |
| Catálogo, REVIEWER y revisión nativa de permisos | Preparación offline LAB explícita; no convierte verificación ficticia en permiso oficial |
| Recarga forzada/caída con POST incierto | Riesgo LAB: claves solo memoria; aviso nativo y consulta humana, sin promesa de recuperación persistente |
| Capturas bloqueadas | Riesgo de transferencia/evidencia: conservación privada y hashes, sin publicación alternativa |
| Host/SO confiable, HTTP loopback, límites gruesos | Riesgo solo LAB; sin protección frente a proceso hostil del mismo SO o escala nacional |
| TLS/MFA, protección distribuida, backups/restauración, despliegue | Trabajo reservado a infraestructura/Etapa8, con autorización y requisitos previos |

## Aceptación y siguiente etapa

Cerrar laboratorio exige integración contractual, defectos críticos/altos del
alcance corregidos o bloqueados, recorrido reproducible, permisos/aislamiento,
migraciones y hechos históricos conservados, batería completa, CI/CodeQL del SHA
final y documentación publicada. La ratificación del PR identifica esos resultados
sin cambiar el código para añadir su propia referencia SHA.

La administración entregada es **parcialmente autónoma**: gestiona recursos y
configuración autorizada; no sustituye los procedimientos de activación inicial,
identidad jurídica, primera fila o infraestructura comercial. El cierre técnico
no elimina esas condiciones de transferencia al comprador.

Recomendación: revisar este cierre y sus límites con el propietario/comprador antes
de autorizar cualquier Etapa5. Su alcance se definirá mediante el plan maestro y
un encargo separado. Como primer corte propuesto, auditar experiencia integral y
recuperación de conectividad del cliente, sin confirmar plazas offline y sin añadir
GPS, identidad externa o pagos. No se programa, despliega ni contrata esa etapa aquí;
no se fusiona PR #5/#3 ni se modifica main.
