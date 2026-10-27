# Trufis Bolivia — Cierre técnico propuesto del backend de Etapa 2

26/10/2026, America/La_Paz. Repositorio exclusivo `pepoj1046-svg/proyecto-nexo`,
rama `desarrollo/etapa-2`, base de este trabajo **`3f466916f6c79e82d3d6d9a05750c41fb6c9e871`**.
[PR #2](https://github.com/pepoj1046-svg/proyecto-nexo/pull/2), dirigido a
`desarrollo/etapa-1`, permanece abierto y sin fusionar. El cierre formal queda
reservado a revisión de ChatGPT/propietario. No es una declaración de producción.

## 1. Inspección, requisitos y matriz de diferencias

Antes de editar: repo, rama, árbol limpio y referencias remotas comprobados; leídos
AGENTS, requisitos, arquitectura, modelo, seguridad/pruebas de Etapa 1, contratos,
decisiones e informes de los cinco incrementos. Revisada la
[revisión independiente del incremento 5](https://github.com/pepoj1046-svg/proyecto-nexo/pull/2#issuecomment-6429522620).
Se conservan **001–017 byte por byte**. No se rehace el núcleo de reservas/filas.

| Requisito revisado | Base reutilizada | Diferencia implementada / frontera |
|---|---|---|
| Avería/suspensión antes de salir | Incidencia TERMINAL, consentimiento, episodios, inventario | Reasignación conjunta al primer B con plazas en todos los segmentos o C; sin desplazar otras reservas, sin dividir, sin recargo; A WITHDRAWN y bloqueado |
| Rescate interurbano | Unidad lógica estable, vehículo bloqueado, sustitución urbana y observaciones efectivas | Candidatos libres en ambos extremos autorizados; prioridad humana declarada, alternativa, exclusividad, SAFE_TRANSFER, continuación y urgencia si no hay unidad |
| Recogidas/descensos y ventas en ruta | Capacidad por segmentos y máximo físico seis, paradas ordenadas | Grupo junto 1–6 durante IN_TRANSIT, APP/presencial comparten inventario; recoger solo antes de pasar; ofertas pendientes no obligan a esperar/regresar |
| Retrasos/cancelación/devolución | READY, episodios, 0/5/8 y recogida cinco minutos | Consulta de alternativas; decisión del responsable; resolución admin atómica; reemplazo nuevo enlazado a CANCELLED, precio original y contacto LAB-*; sin dinero |
| Desvíos y suspensión | Autorizaciones y tarifa congelada | NORMAL/DESVIO/SUSPENDIDA, descripción/puntos/tarifa informados, historial; bloqueo de ventas y salidas nuevas suspendidas, consentimiento de condiciones existentes |
| Alcance geográfico | 005–009: jerarquía, clasificación interna y origen/destino | Decisión consolidada: no producto exclusivamente urbano; paradas locales de rutas entre localidades sí; sin selector al pasajero |
| Casos de menores | Miembros técnicos estables, grupo junto | Contratos mínimos de padre/acompañante autorizado/sin acompañante, revisión simulada y barrera de abordaje; sin edad/documento/foto real |
| Administración | Revisor general, membresías y provisioning separado | Revisión de asociaciones y alcances por ruta dirigida/terminal, RLS restrictiva, puertas en RPC antiguos y auditoría offline; paneles/cuentas públicas diferidos |
| Historial y consulta pública | Bitácoras y proyecciones existentes | Historia propia paginada; disponibilidad anónima local por origen/destino sin pasajeros, sin hora exacta ni retención legal inventada |
| Preparación de aplicaciones | Identidad/sesiones locales existentes | Contrato futuro Google/nombre/celular y notificaciones dentro de app documentado; sin OAuth, interfaces ni comunicaciones reales |
| Seguridad/compatibilidad | RLS, locks por ruta, idempotencia y sesiones revocables | Cobertura de nuevas operaciones, privados sin EXECUTE de aplicación, revocación de ámbitos serializada, actualización poblada 001–017 |

## 2. Funciones existentes reutilizadas

- PostgreSQL como autoridad central; APP y WALK_IN usan `bookings`, `live`, `fits`,
  claves de asociación compuestas y lock grueso de ruta antes de inventario.
- Tarifa/versión/importe aceptados en cada reserva; quote es precondición y no retención.
- Grupos, expreso, división voluntaria, respuesta de ofertas, filas independientes,
  adelanto por completo sin alterar el orden restante, salida del chofer, progreso
  discreto y retorno voluntario de viajes completados.
- Identidad local, sesiones revocables, pools separados, roles nexo_app/identity/
  provisioner/maintenance, transporte HTTP loopback y límites de abuso.
- Episodios de asignación y recuperación, consentimiento del responsable, llegadas
  verificadas, READY, movimientos grupales/individuales, compensaciones inmutables,
  límite observado seis y traslado seguro de la unidad lógica.
- Auditoría inmutable y runner PostgreSQL efímero del lockfile. No nuevas dependencias,
  servicios ni cambios de configuración del workflow existente.

## 3. Funciones nuevas y coherencia operativa

### Terminal: aprovechar plazas de B sin convertirlo en rescate de carretera

`terminal-replacement` calcula la primera unidad siguiente con capacidad conjunta
para todas las reservas confirmadas afectadas. No supone que B está vacío. Por
ejemplo A=4 y B=2 usa las cuatro plazas de B; A=4 y B=4 omite B y usa C compatible.
Se comprueban todos los segmentos y grupos completos; doce grupos en segmentos
sucesivos no se confunden con doce personas simultáneamente a bordo.

`terminal-reassign` requiere incidente confirmado, autorización administrativa,
consentimiento vigente de cada responsable y destino revalidado. Todas las partes
se actualizan en una sola transacción; precio, plazas, integrantes y bitácoras se
conservan. No crea una aceptación personal del chofer. El origen queda WITHDRAWN,
no COMPLETED, y fuera de servicio hasta rehabilitación expresa. Si había abordaje,
se exige declaración de traslado seguro y se conserva instantánea de custodia;
no se inventa BOARD/ALIGHT adicional. No se mueven reservas propias de B.

Grupos ligados a otros vehículos, consentimientos caducos, límite de ocho episodios
o incompatibilidad requieren revisión, sin separar personas ni asignar a ciegas.
Hasta 50 consentimientos por solicitud como cota técnica del adaptador local, no
regla comercial ni límite de seis reservas por viaje.

### Carretera: una unidad libre, terminal elegida y traslado efectivo declarado

`road-command`: REPORT del chofer → CONFIRM del administrador → ASSIGN → SAFE_TRANSFER.
REPORT se limita a un servicio IN_TRANSIT; un servicio begin-urban debe haber llegado
a MAIN_TRIP. Antes de asignar se bloquean ambas colas de extremos en orden UUID y se
revalidan viaje, membresías, permisos, ocupación y compromisos. Se reservan en exclusiva
la unidad física y su chofer retirando su entrada de fila; el trip_id afectado y sus
reservas permanecen. No se duplica inventario, precio ni movimientos de pasajeros.

`road-candidates` ofrece unidades completamente libres de la misma asociación,
en rutas autorizadas de origen/destino. No usa GPS ni distancias. El administrador
declara ORIGIN o DESTINATION como terminal conveniente; se prioriza esa y después
la alternativa según fila. Sin prioridad la lectura muestra opciones sin elegir
conveniencia. El administrador restringido debe tener alcance en ambas rutas usadas.

Hasta registrar SAFE_TRANSFER en punto seguro ficticio, no puede avanzar ni observar
nuevas subidas/bajadas. El conteo y la instantánea deben coincidir. Luego continúa
el mismo recorrido con sus recogidas/descensos restantes. La unidad original permanece
bloqueada hasta recuperación administrativa simulada. La interfaz de estado distingue
ROAD_REPORTED, ROAD_AWAITING_REPLACEMENT y ROAD_RESCUE de un viaje normal.

Sin unidad, ESCALATE registra URGENT_REVIEW; no promete rescate ni reasigna parcialmente.
Manifiestos incompatibles o evidencias incompletas devuelven ADMIN_REVIEW_REQUIRED.
Ante accidentes/emergencias corresponde asistencia humana prioritaria. No se envían
avisos ni se verifica una posición/seguridad real.

### Ventas durante el viaje y ausencias

`reserve-enroute` y `walk-in-enroute` crean ofertas de 1–6 plazas del grupo junto,
con tarifa congelada y TTL técnico de 120 segundos. Solo puntos autorizados del
recorrido, no sobrepasados y con cupo en todos los segmentos. Se reutilizan aceptación,
inventario, rollback y observaciones. El chofer no debe regresar, desviarse ni esperar
por una oferta nueva: si pasa el punto, la oferta HELD expira. Una recogida CONFIRMED
omitida produce MISSED_PICKUP_REVIEW, sin cancelar ni liberar automáticamente plazas.

Salida con cuatro presentes y dos recogidas futuras confirmadas conserva la regla
existente de seis plazas comprometidas. Descensos liberan el tramo futuro; no se
admite observar más de seis físicamente por falta de ALIGHT. El protocolo urbano
begin-urban conserva sus precondiciones propias; no se transforma en ruta urbana.

Se consolidó la regla de terminal **READY → 5 → 8** y recogida cinco minutos desde
PICKUP_ARRIVED. Ya llegué usa 120 segundos provisionales; no renueva READY por reintento.
Los borradores históricos **10+5 permanecen inactivos** y están identificados como
antecedentes sustituidos, sin borrar sus datos ni pruebas. No scheduler ni envío.

### Condiciones de ruta, decisiones y cancelaciones

`route-condition` declara NORMAL/DESVIO/SUSPENDIDA, motivo codificado, descripción
sintética, puntos afectados, actor/hora y opcionalmente nueva tarifa/versionado. Una
suspensión impide ventas y salidas nuevas imposibles; los servicios ya iniciados no
se detienen automáticamente. Reservas existentes se conservan para revisión. En la
consulta pública la ruta suspendida mantiene asociación/contacto y disponibilidad cero.

Un desvío no se declara transitable por la plataforma. Puntos afectados bloquean
ventas allí; para reservas anteriores afectadas se exige aceptación del responsable,
separada de revisión administrativa. Los precios aceptados no se actualizan por una
tarifa nueva. La revisión no reemplaza el consentimiento ni acredita seguridad real.

`resolution-options` muestra alternativas sin retención y contacto de asociación.
`passenger-decision` registra preferencia por alternativa, cancelación o solicitud
de contacto para devolución. `late-resolution` requiere esa decisión y aprobación
administrativa; nueva reserva con cupo revalidado y precio original, enlazada al
registro CANCELLED sin resucitarlo ni repetir cobro. Sin cupo todo revierte. Se limita
a grupo de una parte sin movimientos ni reemplazo previo; los otros casos son revisión.
Casos de menores copiados comienzan PENDING. `cancel` heredado también devuelve
contacto sintético o contactPending; moneyProcessed siempre false. No reembolso fingido,
porcentaje ni sanción inventados. La devolución corresponde a la asociación.

### Menores, administración e información pública

`minor-review` permite PARENT_ACCOMPANIED, AUTHORIZED_COMPANION o UNACCOMPANIED,
con PENDING/VERIFIED_SIMULATED/REJECTED, responsable y resultado de revisión. No se
recopilan nombres/documentos/edades/fotos ni se afirma verificar parentesco legal.
BOARD exige verificación simulada, mismo grupo/viaje y acompañante no marcado como
menor; en modo individual aborda primero el acompañante. Correcciones no pueden
retirar su evidencia mientras siga a bordo el menor, ni puede el progreso dejarlo
sin acompañante. Reasignaciones conservan el grupo. La regla no sustituye documentos
oficiales y no aprueba viajes reales de menores sin validación normativa.

El revisor general aprovisionado offline habilita asociaciones PENDING/ACTIVE/SUSPENDED;
el administrador interno no se autoverifica. Cuentas limitadas a rutas dirigidas
representan encargados de terminal/sentido; no se otorga administración implícita
sobre el otro extremo. nexo_provisioner configura los alcances offline y audita en
identity_events con performed_by; HTTP no posee ese rol. RLS restrictiva y wrappers
de firmas anteriores impiden bypass por RPC antiguos. Un lock compartido/exclusivo
por usuario serializa cambios de ámbito y operaciones/reintentos. No paneles nuevos.

`operating-history` pagina la historia de la asociación/ruta permitida. No se borra
historia ni se impone retención legal. `public-availability` es proyección anónima
**solo en el laboratorio local**: asociación/ruta/estado, contacto LAB-*, próximos
vehículos técnicos, confirmados/libres por segmento y faltantes para seis. No IDs de
pasajero/reserva, nombres, teléfonos ni choferes, y no promete hora de salida.
Es una instantánea; la transacción de reserva vuelve a validar capacidad.

## 4. Arquitectura, migraciones y archivos

| Archivo | Contenido |
|---|---|
| database/migrations/018_operating_contracts.sql | Condiciones/historial de ruta, decisiones, contacto ficticio, menores, alcances y disponibilidad pública; puertas de abordaje |
| database/migrations/019_journey_recovery.sql | Reasignación de terminal, rescate ROAD, exclusividad, incidentes/eventos, reserva durante viaje y progreso/aceptación seguros |
| database/migrations/020_scoped_administration.sql | Provisioning de alcances auditado, revisión de asociaciones, decisiones/resolución tardía, RLS restrictiva y RPC privados, historial, estado ROAD y suspensión de nuevas salidas |
| database/migrations/021_scope_read_boundaries.sql | Lectura restringida de eventos de permisos/identidad, avisos por viaje y consulta de propuestas de la propia ruta |
| src/domain/stage2-closure.mjs | Contratos estrictos, comandos/estados/UUIDs, sin información personal ni source impuesto por cliente |
| src/db/business-service.mjs | Adaptador parametrizado sobre funciones SQL; proyección anónima con nexo_app sin sesión, sin acceso privilegiado |
| src/http/business-api.mjs, local-transport.mjs | Rutas locales, única excepción anónima de disponibilidad, Bearer/resto y claves, conflictos seguros |
| tests/business.test.mjs, integration/postgres.test.mjs | Validación nueva, Q01–Q31; regresiones previas conservadas, registro/checksums y upgrade ampliados |
| AGENTS.md, README.md, requisitos/contratos/decisiones y este informe | Alcance vigente, ejecución, decisiones anteriores sustituidas y evidencia verificable |

Las tablas nuevas operativas están bajo RLS, sin DML de nexo_app. Historiales y
correcciones son inmutables. Funciones SECURITY DEFINER con search_path explícito
pg_catalog,nexo,pg_temp y sin EXECUTE para PUBLIC. Alias de implementación no son
invocables por aplicación; configure_admin_scope solo por provisioner. La única
ampliación de su lista cerrada de funciones es ese contrato, verificada por S08.
No cambios a dependencias, puertos públicos, workflow o APIs de identidad.

No backfill que invente estados, pagos, presencias o menores. Migraciones secuenciales
con registro/checksums y rollback. Q23 copia una fixture poblada 001–017, compara
todas sus tablas antes/después, reaplica vacío y continúa un viaje/reserva anteriores.
Las fixtures desactivan únicamente los generadores de IDs/episodios mientras copian
filas para no duplicarlas; las migraciones no hacen ese procedimiento en bases reales.

## 5. Pruebas ejecutadas, resultados y CI

Local: Linux x64, Node **24.19.0**, npm **11.9.0**, **PostgreSQL 18.4 real** del lockfile,
clúster efímero en 127.0.0.1 con datos ficticios. No conexión a producción ni datos reales.

Pasada final local completada con código de salida 0. La evidencia de CI se añadirá
tras publicar; mientras tanto las cuatro combinaciones remotas constan pendientes.

```text
npm run test:all
  unitarias:                 33/33
  integración PostgreSQL:   177/177
  fallos / omitidas / canceladas: 0
  runner: salida intencional 9 propagada, PostgreSQL detenido
  smoke: registro/login/logout y negocio, listeners separados detenidos
exit: 0
git diff --check
exit: 0
```

CI Ubuntu/Windows × Node22/24: pendiente del commit final con 021.
No se atribuye aprobación a ejecuciones no completadas.

Cobertura nueva Q01–Q31:

- Terminal A4/B2, B insuficiente/C, consentimiento, doce grupos en tramos sucesivos,
  8 reintentos con una transición, traslado seguro, rollback inyectado y A bloqueado.
- Rescate libre desde destino, alternativa desde origen, prioridad humana sin tiempo
  ficticio, ninguna unidad/urgencia, dos rescates por C, reserva contra rescate,
  permisos/sesión revocados, exclusividad, rollback y rehabilitación tras traslado.
- Cuatro abordados/dos futuros, venta por segmento durante viaje, 16 solicitudes
  mixtas por última plaza con un ganador, punto pasado, aceptación vs avance y
  vencimiento sin espera/regreso; recogida confirmada omitida queda en revisión.
- Desvíos/tarifa nueva frente a precio aceptado, aceptación de condiciones, suspensión
  de ventas/abordaje/salida, contacto visible y reservas históricas conservadas.
- Administradores por terminal/ruta, RLS/RPC antiguos, provisioning no disponible al
  runtime de negocio, revocación de alcance y recibo previo, asociación no aprobada.
- Menores en tres casos mínimos, revisión humana simulada, acompañantes juntos,
  correcciones seguras, alternativas y cancelación expresas antes/después de salida,
  sin resucitar reserva ni crear cobro/reembolso real.
- HTTP anónimo de disponibilidad sin campos personales, resto autenticado,
  rechazo de GPS/IDs de actor, paginación e inmutabilidad de historia.
- Base ficticia poblada 001–017 → 018–021 sin cambio de ninguna fila anterior.

Se conservan las **177 pruebas de los cinco incrementos anteriores** y se añaden
**33**: dos unitarias y 31 integraciones. Actualizar listas de migraciones, registro
a 21 y whitelist exacta de provisioner refleja el esquema nuevo; no se suprimen
aserciones de negocio, seguridad ni pruebas para obtener un resultado satisfactorio.
G12 fija SHA-256 de 001–017 y siguen las actualizaciones pobladas anteriores.

## 6. Problemas encontrados y corregidos

- Faltaban contratos separados para reubicar todas las reservas de una incidencia
  de terminal y rescatar en carretera. No se reutilizó la regla de unidad vacía para
  impedir aprovechar plazas de B; tampoco se permite usar un vehículo con reservas
  propias como unidad de rescate. Atomicidad/custodia/grupos verificadas por Q01–Q09.
- El núcleo de ofertas en fila no admitía nuevas reservas IN_TRANSIT. El contrato
  acotado nuevo reutiliza inventario/tarifa/aceptación; ofertas no atendidas expiran al
  pasar su punto. Una confirmada omitida conserva incidencia, sin ausencia automatizada.
- La suspensión nueva de ruta necesitaba bloquear también salidas/abordaje nuevos,
  conservando la continuación de servicios iniciados. Se añadió la puerta en depart
  y en el contrato de BOARD; no se reinterpretaron permisos/suspensiones históricos.
- Dar un ámbito a un administrador sin cubrir RPC y RLS heredados permitiría eludir
  la limitación. Se añadieron puertas a las firmas antiguas y políticas restrictivas,
  aliases privados y lock de revocación; Q15/Q24 prueban acceso y recibo denegados.
  La revisión posterior al primer commit detectó lecturas heredadas de eventos de
  identidad/permisos sin alcance y una denegación excesiva de propuestas de ruta
  propia. 021 conserva 018–020 publicadas y cierra esas fronteras, con Q15 ampliada.
- Las correcciones de observación podían dejar inconsistente un acompañamiento
  recién declarado: guardia compensatoria y progreso evitan dejar solo al menor.
- Durante desarrollo: política restrictiva duplicada para admin_route_grants,
  grant faltante tras renombrar restore_vehicle, nombres SQL ambiguos/etiquetas de
  función tras wrappers y expires_at obligatorio omitido en reemplazo. Las pasadas
  intermedias fallaron en esos puntos, se corrigieron y se repitió la batería. Un
  dato de fixture Q18 tenía plazas de verificación incorrectas; se corrigió el dato,
  manteniendo la aserción de rechazo de menores sin verificación.

Estos son resultados del laboratorio; no equivalen a auditoría externa, carga de
producción, prueba con operadores ni validación normativa.

## 7. Contratos inactivos y decisiones reservadas

No están activos: cancelación automática por ausencia, envío de avisos, GPS,
navegación, Google OAuth real, datos personales/documentales, bancos, QR, cobros,
reembolsos, licencias/facturación ni almacenamiento documental externo. No existe
API pública de Internet, despliegue, panel completo o aplicación móvil. Los eventos
operativos tienen delivery DISABLED; un código LAB-* no es un contacto real.

[Decisiones vigentes y pendientes](../DECISIONES_PENDIENTES_ETAPA_2.md): revisión
legal de menores/asociaciones/permisos/tarifas, plazos comerciales, excepciones de
ausencia y comunicación, asistencia/terminales reales, política de devolución,
correcciones tardías, reservas futuras tras revocar permisos, retención/minimización,
backups y operación. Sin períodos legales ni penalizaciones inventadas.

## 8. Riesgos conocidos y evaluación de cierre

El backend implementa el alcance técnico **de laboratorio**, con las fronteras
explícitas anteriores. La evaluación se basa también en coherencia de selección,
custodia, precio, inventario, grupos, ausencia manual y permisos, además de pruebas.
El cierre formal lo decide el propietario después de revisión independiente de este
PR. No se declara listo para producción ni se inicia Etapa 3.

Límites y riesgos que requieren procedimiento real:

1. Posiciones, presencia, verificación de menores y reparación son declaraciones
   ficticias: no prueban identidad, parentesco, seguridad mecánica o transitabilidad.
2. Sin sustituto, manifiesto incompatible o grupo ya ligado entre vehículos hay
   revisión explícita, no garantía de recuperación/compensación. Resolución tardía
   automática de múltiples partes está excluida; nunca se separa el grupo a escondidas.
3. TTL 120 s y ocho episodios son límites técnicos, no plazos comerciales definitivos.
   Las configuraciones/declaraciones históricas se conservan sin reescribir relojes.
4. No se corrigen observaciones después de pasar la parada ni se inventan descensos.
   El historial incompleto puede impedir nuevos BOARD/rehabilitación por capacidad.
5. Unidad retirada y reparada no se reinserta automáticamente en una fila, ni se
   marca COMPLETED falsamente. Procedimiento administrativo real de reincorporación
   y casos fuera de terminales/autorizaciones del modelo requieren revisión.
6. Consultas públicas y manifiestos son lecturas de capacidad, no garantía ni reserva;
   no prometen hora, rescate o tiempo de carretera. Bloqueos gruesos son apropiados
   para este laboratorio, sin prueba de escalabilidad nacional.
7. Cuentas/paneles públicos, fuentes oficiales, OAuth/TLS/MFA, retención, observabilidad,
   restauración y pruebas con operadores quedan para autorización/etapas posteriores.
   Que PostgreSQL18.4 pase no acredita otras versiones ni un piloto real.

Para aceptar este cierre: revisar contratos/casos extremos/CI, confirmar el alcance
de laboratorio y registrar observaciones del propietario. Cualquier inicio de
Etapa 3, merge, cierre de PR o piloto requiere nueva instrucción explícita. Main,
Etapa 1 y PR #1 se conservan; no gastos ni recursos externos.
