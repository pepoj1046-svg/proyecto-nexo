# Trufis Bolivia — diagnóstico y planificación de Etapa 4A

Fecha: 01/11/2026. **Solo lectura de producto y documentación de planificación.**

## Preparación y evidencia comprobada

Repositorio/remoto: `pepoj1046-svg/proyecto-nexo`. Checkout inicial limpio en
`desarrollo/etapa-3`, HEAD exacto `1f07fd9cb69676258bf277a561d9e8aa711bacb2`.
Rama documental `planificacion/etapa-4a`, desde exactamente ese cierre; no desde main.

Lecturas: AGENTS, skill `trufis-dev`, requisitos, arquitectura/modelo, seguridad,
pruebas y cierres de 1–3, contratos de operación/cuidados e informes pertinentes.
Se inventariaron definiciones de 001–033 y se inspeccionaron contratos administrativos
en SQL, adaptadores, HTTP, React, fixtures y pruebas. No es una nueva auditoría
integral de seguridad ni una certificación productiva.

Comprobado en GitHub: [PR #3](https://github.com/pepoj1046-svg/proyecto-nexo/pull/3)
abierto y sin fusionar, `desarrollo/etapa-3` → `desarrollo/etapa-2`, HEAD `1f07fd9`.
El [registro ratificado](https://github.com/pepoj1046-svg/proyecto-nexo/pull/3#issuecomment-6561718192)
confirma 422 casos y workflows de ese SHA: PR `41336851417` aprobado, intento 1;
push `41336846624` aprobado, intento 2; CodeQL `41336846641` aprobado. Conserva el
fallo inicial de red Windows y su repetición diagnóstica. No es CI nueva de esta rama.

Las tres etapas están cerradas **en su alcance de laboratorio**, conforme a sus
entregas y al encargo actual. Cifras históricas: Etapa 1, 23+66; Etapa 2, 33+177;
Etapa 3, 62+278+82. Véanse [plan maestro](../PLAN_MAESTRO_10_ETAPAS.md) y cierres enlazados.

## Conclusión y objetivo comercial

El producto permite operar el laboratorio, pero la configuración aún no es autónoma
para una empresa compradora. Altas de catálogo dependen del setup propietario,
provisión sensible es offline y varios controles web requieren seleccionar viaje.
No hay consola general completa ni rol `GENERAL_ADMIN`.

El objetivo actual es **venta integral**, no SaaS operado por el desarrollador.
Permanece RLS multi-asociación. La hoja de diez etapas es propuesta: se encontró
referencia a «Etapa 2 de 10», pero el desglose inicial enumera seis pasos. Etapas
4–10 propuestas requieren aceptación; los informes históricos no se renumeran.

## Inventario administrativo exacto

SQL significa contrato ejecutable, no solo tabla. API business es HTTP/Bearer local;
método JS en proceso no equivale a endpoint HTTP. Web significa gateway de navegador
y control React. Las pruebas citadas se inspeccionaron, **no se ejecutaron ahora**.

| Área | PostgreSQL actual | Adaptador / HTTP actual | Web actual | Pruebas existentes, faltante y riesgo |
|---|---|---|---|---|
| A. Asociaciones | Tablas 001/005; `review_association` 020 modifica adhesión/operación, no `status` comercial; `set_association_contact` admite LAB-* | POST `/business/closure/association-review` y `/association-contact` | Sin alta/listado administrativo/revisión/contacto editable | Q15/Q16/G. Alta, edición de identidad y baja sin RPC. No confundir estados con licencia pagada o habilitación legal. |
| B. Cuentas y permisos | 009–011: registro pasajero/sesiones/recuperación; `provision_role`, `configure_admin_scope`, `set_identity_active`, `provision_recovery` solo provisionador | `/v1/register`, login/recover/logout; provisión sin HTTP | Login/logout; CareAccounts administra DRIVER mínimo | H01–11/S01–09/T8B13–14. Faltan directorio, delegación y primer/último ADMIN. No exponer provisión ni credenciales. |
| C. Choferes | `set_driver_membership` crea/activa/desactiva DRIVER propio; wrapper 020 exige ámbito completo de asociación | `createService().setDriverMembership`, sin endpoint HTTP dedicado | `/api/care/accounts`, `/api/care/command` kind ACCOUNT: membresía preexistente, consulta anclada a viaje | H05/care-accounts/T8B13. Sin solicitud/documentación/aprobación inicial. Baja de rol no es bloqueo de identidad o vehículo. |
| D. Vehículos y asignación | Capacidad CHECK=6, FKs, servicio activo único; bloqueos/sustitución y `restore_vehicle` 017–019 | `/business/fleet-command`, `/restore-vehicle`, historial y reasignación | Directorio de viajes con vehículo; Recovery sustituye/restaura bajo contrato | Z01/Z06/F/Q/K y recovery E2E. Sin padrón CRUD/asignación inicial independiente. No editar unidad ocupada ni generalizar capacidad con un input. |
| E. Rutas y sentidos | OUT/IN, versión/localidades, guardas 005 y permisos 006–009 | `submitAuthorization`/`reviewAuthorization`: métodos JS sin endpoint HTTP propio | Catálogo y selectores habilitados, condiciones y retorno a fila | G08–11/Q15. Falta CRUD y consola de permisos. Otra versión de topología usada, sin invertir índices o reasignar históricos. |
| E. Terminales y puntos | `stops`, perfiles TERMINAL/URBAN/ROAD; `configure_terminal` cambia duración técnica por asociación | `/business/terminal-config` y lecturas de puntos | Puntos habilitados y operación/presencia | G/O/terminal. Sin entidad de terminal física con CRUD ni editor de perfiles. Configurar segundos no crea terminal. |
| F. Tarifas | `fares` por segmento/modalidad/vigencia; `set_route_condition` cambia monto de fila existente y versión; reserva congela precio/versión | `/business/closure/route-condition`, cotizaciones transaccionales | Edición parcial real: Conditions → `/api/conditions/declare` → `web_declare_condition`; tarifa normal/expresa existente | B01/Q13/J711/conditions. Falta alta de tramos/modalidades/vigencias, solapes y publicación. Sin archivo universal de versiones tarifarias. |
| G. Aislamiento | Sesión, RLS, scopes/FKs y ACL; runtime sin DML/provisión | Identidad/negocio separados; IDs no acreditan rol | Cookies/CSRF/Origin, handlers fijos y autorización SQL | H/S/Q15/T8B14/AU301–302. Cada página/recibo nuevo debe conservar ámbito; catálogo de búsqueda no es directorio global. |
| H. Historia/auditoría | Eventos de negocio, identidad, permisos, condiciones y hechos inmutables; `operating_history` por ruta | `/business/closure/operating-history`, fleet-history y movimientos | Historias específicas de reserva, condiciones, incidencia y cuidados | Q22/A601–609/E2E. Sin consola transversal de configuración; faltan antes/después y política de exportación/retención. |
| I. Cambios e historia | Precio/versión, contratos, topología usada y eventos de configuración preservados | RPC operativas transaccionales y auditadas | Condiciones/cancelación/revisión revalidan servidor | Upgrades/B/Q/J/K/AU303. No editor universal versionado; varios nombres usan JOIN actual. No prometer snapshot histórico universal. |
| J. General frente a asociación | REVIEWER revisa contratos específicos; ADMIN y ámbitos distintos | Provisión offline; runtime rechaza mezclar grupos técnicos | Sin vista GENERAL_ADMIN ni consola de plataforma | H05/H08/S08/Q15–16. Definir facultades de plataforma; REVIEWER no implica lectura universal ni provisión. |

Fuentes: [service](../../src/db/service.mjs), [identity](../../src/auth/identity.mjs),
[runtime](../../src/db/runtime.mjs), [HTTP business](../../src/http/business-api.mjs),
[HTTP identidad](../../src/http/local-api.mjs), [gateway](../../src/http/web-gateway.mjs),
[Care](../../apps/web/src/Care.tsx), [Conditions](../../apps/web/src/Conditions.tsx),
[Terminal](../../apps/web/src/Terminal.tsx), [Recovery](../../apps/web/src/Recovery.tsx).

La consulta CareAccounts lista el DRIVER del viaje; el comando exige membresía DRIVER
preexistente en esa asociación. No es un directorio general ni alta inicial. Restaurar
membresía puede devolver facultades a una sesión aún válida, sin recuperar contraseña.

## Recorrido de las migraciones conservadas

| Versiones | Contrato relevante |
|---|---|
| 001–004 | Entidades, membresías, capacidad, FKs/RLS, inventario, recibos, cola y aislamiento. |
| 005–008 | Geografía/versiones, topología, permisos, revisión y búsqueda. |
| 009–011 | Identidad, provisión offline, DRIVER, revocación, abuso y mantenimiento. |
| 012–016 | Negocio, integrantes, presencia/configuración/episodios, responsables y correcciones. |
| 017–019 | Bloqueos/restauración, condiciones/tarifas, menores, sustitución y rescate. |
| 020–022 | Ámbitos, revisión/contacto, historia y lectura/manifiesto restringidos. |
| 023–027 | Proyecciones web, puntos, operación/recuperación, retorno y paginación administrativa. |
| 028–030 | Condiciones, turno directo terminal, recepción segura y discrepancias. |
| 031–033 | Responsables/códigos, revisiones/ausencias, DRIVER mínimo y alcance del listado. |

Altas iniciales provienen de [seed-web-demo](../../scripts/seed-web-demo.mjs);
[web-demo](../../scripts/web-demo.mjs) cierra setup antes de servir. Es fixture
ficticio efímero, no administración de empresa ni bootstrap comercial terminado.
No hay script `scripts/provision*`; existen RPC offline, cuya invocación requiere
proceso confiable. [El plan](../PLAN_ETAPA_4.md) distingue ese camino parcial de
la futura creación de asociación y primer administrador.

## Riesgos y decisiones que no se inventan

| Tema | Frontera actual / tratamiento propuesto |
|---|---|
| Bootstrap/escalamiento | No hay contrato de GENERAL_ADMIN, delegación o último ADMIN. Mantener provisión offline y acordar recuperación; primer registro nunca obtiene privilegio por defecto. |
| Baja durante servicio | DRIVER revocado deja de satisfacer drives/guardas. Nuevo flujo debe bloquear o remitir a contrato humano aprobado; sin inventar finalización, custodia o sustitución automática. |
| Alcances/membresías | admin_limits restringe conservadoramente la cuenta; otra membresía no concede acceso irrestricto. Autorizar tras esperar locks y entre páginas. |
| Precio/topología | No reescribir reservas; publicar tarifa revalida quote y topología usada exige otra versión compatible. |
| Etiquetas históricas | JOIN de catálogo actual puede cambiar presentación del pasado. Definir versionado/snapshot antes de editar libremente nombres o perfiles. |
| Suspensiones | Estado comercial, adhesión, operación, permiso, identidad y avería son distintos. No botón universal ni cancelación por impago/ausencia. |
| Concurrencia | Locks compatibles, versión esperada, transacción y auditoría. RPC offline no tienen todos un contrato de recibo adecuado para navegador. |
| Datos y venta | Minimizar consultas; sin documentos reales ni exportación global no aprobada. Transferir producto sin cuentas personales del desarrollador. |

No se fijan normas jurídicas, edades, documentos obligatorios, retención, sanciones,
reembolsos, licencias ni integraciones. Estos bloqueos no impiden el directorio de
lectura con permisos existentes.

## Hallazgos de los dos subagentes

`e4_seguridad_contratos`: inventario de las 33 migraciones y lecturas de privilegios,
RPC y fixtures. Precisó REVIEWER frente a GENERAL_ADMIN/provisionador; señaló
bootstrap/último ADMIN incompletos, baja durante servicio y metadatos sin snapshot universal.

`e4_funcionalidad_pruebas`: contrastó SQL, método JS, HTTP, UI y casos. Evitó dos
falsos faltantes: edición parcial tarifaria web y gestión de DRIVER preexistente.
Detectó directorios anclados a viaje y falta de hoja original completa de diez etapas.

Ambos fueron genéricos con instrucciones manuales, exclusivamente de lectura. No
se atribuye carga automática de TOML. No editaron, ejecutaron servicios/pruebas,
hicieron commits ni consultas remotas. El principal integra y documenta.

## Diseño y primer encargo recomendado

[El plan de Etapa 4](../PLAN_ETAPA_4.md) propone seis cortes, sus capas y pruebas.
Primero, **autorizar únicamente 4A.1**: directorio administrativo de lectura por
asociación/ámbito, paginado, DRIVER existentes, vehículos incluso sin viaje,
rutas/puntos y tarifas actuales. Sin nuevo rol global ni escrituras. Complejidad
media; pruebas dirigidas de A/B, ámbitos, >50 filas, entidades sin viaje, sesiones,
CSRF, errores/móvil/escritorio y no mutación de inventario/historia.

Después: controles existentes fuera del viaje; plataforma/asociaciones; choferes/
vehículos; rutas/tarifas versionadas; auditoría y aceptación. Sus mutaciones exigen
contratos y autorización posterior. No se programa nada para simular autonomía completa.

## Validación y entrega documental

Validaciones de esta entrega: enlaces relativos, contenido Markdown, hashes de las
33 migraciones, parentesco exacto del cierre y diff limitado a tres documentos nuevos.
AGENTS, skill, workflows, código, dependencias y reglas operativas permanecen intactos.

**No se ejecutan unitarias, PostgreSQL, Playwright, builds ni nuevas matrices CI**:
no hay cambios ejecutables. Los 422 casos y CI/CodeQL se verificaron como antecedente,
sin declararlos prueba nueva del commit de planificación. Los filtros actuales no
ejecutan esa matriz en esta rama documental; no se alteran ni se fuerza una ejecución.
El plan incluye ajustar cobertura CI al autorizar la futura rama/base de código.

Rama de entrega: `planificacion/etapa-4a`, primer commit hijo directo de `1f07fd9`.
Se publican allí los documentos, con main, Etapas 1–3 y PR #3 intactos. No se abre
ni fusiona un PR de código. La implementación y su validación son trabajo posterior.

**4A no está implementada.** El diagnóstico termina aquí y espera autorización
para programar; no inicia Etapa 5, servicios, GPS, dinero, comunicaciones reales ni gastos.
