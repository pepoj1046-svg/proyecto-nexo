# Etapa 3, incremento 6 — Administración y consultas paginadas

30/10/2026, America/La_Paz. Base `697cf3d8923440e75bdefeed948b0111ba4dcd12`,
repositorio `pepoj1046-svg/proyecto-nexo`, rama `desarrollo/etapa-3` y PR #3 hacia
`desarrollo/etapa-2`. Árbol inicialmente limpio y cabeza remota/base comprobadas.
Se utiliza la skill local `.agents/skills/trufis-dev/SKILL.md`, AGENTS, requisitos,
arquitectura/modelo, seguridad/pruebas y contratos/informes anteriores. La autorización
actual permite exclusivamente el incremento 6 y sustituye la prohibición histórica
de comenzarlo. No autoriza incremento 7, despliegue ni uso comercial.

## Auditoría y alcance implementado

| Área | Contrato previo | Resultado del incremento |
| --- | --- | --- |
| Cancelación administrativa | `cancel` cancela todo el grupo antes de iniciar sus partes y sin BOARD efectivo; devuelve contacto y `moneyProcessed=false` | Formulario de revisión del grupo, motivo obligatorio, confirmación expresa y envoltura mínima con auditoría del motivo |
| Manifiesto | El núcleo tenía consulta paginada; la proyección web 024 devolvía solamente los primeros 50 registros | Paginación por cursor para administrador y chofer, incluidos históricos, sin alterar inventario ni movimientos |
| Reservas propias | 023 admitía limit/offset; la web solo solicitaba su primera página | Navegación real por reservas APP propias y consulta de presencia/viaje de una reserva situada fuera de las primeras 50 |
| Revisión administrativa | `condition_decision(ADMIN_REVIEW)` ya estaba definido, separado de ACCEPT del responsable | Revisión de la versión vigente, confirmación y registro idempotente; no acepta cambios por el pasajero |
| Estados de vehículos | Directorio, incidencias, sustituciones/rescate y rehabilitación nativa ya conectados en incrementos 4–5 | Se conservan; el nuevo panel consulta partes, estados, personas observadas e importes antes de permitir acciones |

Se revisaron los contratos vigentes de Etapa 2 y las evidencias de Etapa 3. No se
reconstruyó el inventario, las filas, las tarifas, los grupos, las sustituciones o
los RPCs de despacho. Los flujos anteriores siguen usando el mismo backend.

## Cancelación y auditoría

La nueva `web_admin_cancel` requiere administrador real de todas las rutas del grupo,
asignación/episodio mostrados, motivo y confirmación. Los motivos son códigos técnicos
ya utilizados en correcciones: `OPERATOR_ERROR`, `WRONG_RESERVATION` y
`PASSENGER_CORRECTION`. Se muestran en español, sin un campo libre para datos personales.
Son declaraciones del operador, no prueba de una solicitud ni política comercial.

El recibo exterior incluye motivo/asignación. Las claves exterior e interior se
reclaman antes de bloquear rutas y se delega la cancelación a `nexo.cancel`. Los
bloqueos conservan el orden de rutas. No se replica su transición de inventario.
Si hay personas abordadas, una parte ya salió o cambió la asignación, se conserva
el grupo sin cambios parciales. No se simula un descenso para cancelar.

El núcleo conserva `GROUP_CANCELLED`; una cancelación administrativa efectiva añade
**un** evento inmutable `ADMIN_CANCELLED:<motivo>`, con actor, grupo, asociación y hora.
Reintentos de la misma acción conservan su recibo. Una clave nueva sobre un grupo ya
cancelado no añade otro motivo efectivo: `reasonRecorded=false`. El contrato CLI
heredado se conserva; es la nueva superficie web administrativa la que exige motivo.
Permisos y sesión se comprueban antes de devolver un recibo previo.

El precio pactado, miembros y referencias permanecen. Contacto de la asociación no
equivale a reembolso: no hay cobro, sanción, transferencia, cancelación por ausencia
ni notificación real. Tiempos y consecuencias comerciales no se modifican.

## Paginación e interacción

- Cada página contiene hasta 50 filas en la interfaz, con máximo técnico 100 en el
  adaptador. Se puede continuar más allá de 50 y del antiguo offset máximo 10.000;
  el cursor no impone ese límite total. No se usa un inventario paralelo.
- Orden estable por fecha e ID; manifiesto ascendente y reservas propias descendentes,
  con desempate por ID. La huella incluye IDs, fechas, viaje y estado persistido.
- Un cursor está vinculado al actor, vista, viaje/reserva enfocada y tamaño. No concede
  autoridad ni sustituye las comprobaciones de RLS y permisos. Es contexto de consulta,
  no credencial de identidad. No incluye nombres, documentos ni token de sesión.
- Si cambia el conjunto entre páginas, `PAGE_CHANGED` exige actualizar. La interfaz
  no concatena filas antiguas con un conjunto nuevo. Una mutación inicia una primera
  página nueva; siguiente/anterior permiten recorrer el conjunto estable sin duplicados.
- Son consultas vivas, no un snapshot histórico congelado: los hechos observados pueden
  avanzar. Las acciones revalidan capacidad, parada, sesión y asignación en PostgreSQL.
- La presencia de una reserva propia se enfoca por `bookingId` autorizado, incluso
  cuando queda fuera de la primera página del manifiesto privado del pasajero.
- La navegación muestra carga, posición, cantidad y errores. Las respuestas tardías
  se invalidan al abandonar el componente/cambiar sesión; se conservan las regresiones
  de privacidad previas. Controles móviles, etiquetas y confirmaciones accesibles.

La proyección nueva conserva los campos de 023–024 y consulta las mismas funciones
de operación, presencia y episodios. Las pruebas comparan los campos de las primeras
50 filas con las proyecciones anteriores, además de recorrer el conjunto completo.
Los endpoints nuevos son POST privados de mismo origen, protegidos por el wrapper
CSRF existente. GET de reservas conserva el acceso autenticado anterior.

## Archivos y migraciones

| Capa | Archivos |
| --- | --- |
| SQL | `database/migrations/027_web_administration.sql` |
| Adaptadores | `src/db/web-management-service.mjs`, `web-operations-service.mjs`, `web-reservation-service.mjs` |
| Transporte | `src/http/web-gateway.mjs` |
| Interfaz | `apps/web/src/Management.tsx`, `Functional.tsx`, `Operations.tsx`, `Login.tsx`, `operation-model.ts`, `private-api.ts`, `styles.css` |
| Pruebas | `tests/web-management.test.mjs`, `tests/web-auth-order.test.mjs`, `tests/integration/postgres.test.mjs`, `tests/web/administration.spec.mjs`, `functional.spec.mjs` y ayuda de diagnóstico |
| Laboratorio | `scripts/seed-web-demo.mjs`, `scripts/test-web.mjs` |
| Documentación | `AGENTS.md`, `README.md`, arquitectura, seguridad y este informe/evidencias |

**001–026 intactas.** 027 añade cuatro puntos de entrada restringidos y un helper
privado de proyección. No añade tablas ni modifica filas históricas. Fija `search_path`
en `pg_catalog,nexo,pg_temp`, revoca PUBLIC y no concede al runtime el helper privado,
DML, aprovisionamiento ni acceso al módulo de identidad. La actualización desde una
base ficticia 026 poblada compara todas sus tablas antes/después y continúa una
reserva anterior. Continúan los upgrades históricos y los checksums anteriores.

## Pruebas y resultados

Versión funcional final **`c57d59d566354d815cb7c21e46dac45312ef1b67`**, posterior
a la corrección de orden de sesiones. La actualización documental posterior conserva
exactamente ese código.

| Verificación | Resultado local |
| --- | --- |
| Validadores nuevos | 2/2 aprobados |
| PostgreSQL dirigido, A601–A609 + G12/R08/Z07 | 12/12 aprobados |
| Regresión web dirigida | 16/16 aprobados, 8 por dispositivo |
| Escenario administrativo ampliado final | 4/4 aprobados, 2 por dispositivo; cierres/reinicio aprobados |
| `npm run test:all` | **53/53 unitarias + 229/229 integraciones PostgreSQL**, salida 0; sin casos omitidos |
| `npm run test:web` completo | **66/66 Chromium**, 33 escritorio + 33 móvil, salida 0; 26 laboratorios cerrados, SIGINT/puertos y reinicio aprobados |
| Compilación TypeScript/esbuild | Aprobada en los comandos anteriores |
| Runner/listeners | Salida intencional 9 propagada; HTTP/negocio y PostgreSQL detenidos; sin conexión externa |

Se conservan los 329 casos anteriores. Nuevos: dos validadores, dos regresiones de orden de sesiones, nueve integraciones
PostgreSQL y seis casos Chromium en total. La batería definida suma 348 casos. No se cuentan aserciones, smokes o
repeticiones como casos nuevos. Linux local, Node 24.19.0, PostgreSQL real 18.4,
Playwright 1.64.1 y Chromium 154.0.8037.57; escritorio 1440×1000 y móvil emulado
390×844. No se atribuye una prueba manual en Windows o una validación de campo.

Los E2E consultan **69 entradas de manifiesto** y **67 reservas APP propias** por
rol/dispositivo, contrastadas con un testigo PostgreSQL externo a la API en transacciones
READ ONLY. Pasajero, administrador y chofer usan contextos independientes. Se cancela
la reserva de una plaza al final del manifiesto; el compromiso pasa de cinco a cuatro
por segmento, sin BOARD ni salida automática y conservando Bs 35/miembros. La otra
reserva de cuatro mantiene sus plazas. La revisión administrativa no crea ACCEPT.

Se comprueban empate de fechas, unicidad/completitud de páginas, foco posterior a 50,
cursores ajenos/falsificados, cambios del conjunto, roles/terminales/asociaciones,
CSRF, sesiones revocadas, precio/miembros, doble pulsación, cancelaciones concurrentes,
abordaje concurrente, grupo dividido, viaje iniciado y reserva contra cancelación.
Axe WCAG 2 A/AA y 2.1 AA no detectó violaciones en la pantalla administrativa examinada;
esto no certifica accesibilidad completa del producto.

[CodeQL de la versión funcional final](https://github.com/pepoj1046-svg/proyecto-nexo/actions/runs/41133913042):
analizador `124331498935` aprobado. El check separado de resultados **CodeQL**
`124332005998` aprobó con «No new alerts in code changed by this pull request»,
cero anotaciones. No se equipara el job del analizador a ausencia de hallazgos,
ni se afirma que no exista ninguna vulnerabilidad en todo el sistema.

CI del código corregido: **4/4 aprobados** en
[la matriz del PR](https://github.com/pepoj1046-svg/proyecto-nexo/actions/runs/41133921078).
Se contrastaron sus cuatro logs: 53 unitarias, 229 PostgreSQL y 66 Chromium por entorno,
cero fallidos/omitidos y smokes de cierre/reinicio aprobados. La
[matriz push adicional](https://github.com/pepoj1046-svg/proyecto-nexo/actions/runs/41133913080)
también terminó 4/4 aprobada.

| Entorno del PR | Job | Unitarias | PostgreSQL | E2E | Resultado |
| --- | --- | --- | --- | --- | --- |
| Ubuntu / Node 22 | 124331525707 | 53 | 229 | 66 | Aprobado |
| Ubuntu / Node 24 | 124331525211 | 53 | 229 | 66 | Aprobado |
| Windows / Node 22 | 124331525586 | 53 | 229 | 66 | Aprobado |
| Windows / Node 24 | 124331525589 | 53 | 229 | 66 | Aprobado |

No se multiplican esos entornos o repeticiones para contar casos únicos. [La primera matriz del PR](https://github.com/pepoj1046-svg/proyecto-nexo/actions/runs/41130103475) tuvo 3/4 aprobados:
Windows/24 falló al esperar el cierre del formulario de login en el segundo caso
administrativo, tras aprobar dominio/PostgreSQL. La ejecución push del mismo código
aprobó 4/4. No se solicitó re-run de esos jobs.

Se añadieron dos regresiones de orden de respuestas que fallaron **2/2 antes** y
aprobaron **2/2 después**: una respuesta anónima pendiente podía reemplazar la cookie
de un login posterior; una lectura concurrente podía observar el contexto anterior
durante logout. La fachada ahora comparte únicamente lecturas de sesión en vuelo y
ordena login/logout tras las respuestas previas; las lecturas posteriores esperan
la mutación. No conserva una caché duradera de credenciales, no reintenta solicitudes
ni altera sus timeouts. El formulario indica preparación y espera el contexto inicial.

El E2E retarda una respuesta real de sesión, comprueba que no se puedan enviar las
credenciales antes de completar el arranque y verifica login/logout. Los **14 E2E
dirigidos afectados** aprobaron después. La ayuda de pruebas conserva sus límites y
añade solo diagnóstico seguro de status/ruta/código de error, sin cuerpos de login,
CSRF, cookies o contraseñas. El job original no registró la respuesta HTTP concreta;
no se atribuye su causa exclusivamente a la carrera reproducida sin esa evidencia.
La batería completa corregida aprobó **53 + 229 + 66 = 348** casos localmente,
con salidas 0, cierres y reinicio. La nueva CI aprobó sobre ese código, incluido Windows/24. Se conservaron sus
resultados y los del intento anterior para revisión. No se ocultaron ni se contaron como aprobados los fallos previos.
La CI mantiene Ubuntu/Windows y Node 22/24. No se cambiaron workflows, reintentos o
timeouts de pruebas existentes. El ejecutor permite seleccionar suites/proyecto para
trabajo local dirigido; sin argumentos ejecuta todas las suites y ambos dispositivos.

Logs privados finales: `.local/i6-release-all.log`, `.local/i6-release-web.log`.
Se conservan las pasadas anteriores `.local/i6-final-all.log`, `.local/i6-final-web.log`,
`.local/i6-pg-directed-4.log`, `.local/i6-web-directed-2.log` y
`.local/i6-web-directed-final.log`. Configuración SQL, accesos y trazas permanecen
fuera de Git. Las capturas/evidencia públicas seleccionadas solo contienen datos ficticios.

## Evidencias ficticias

[Evidencia SQL mínima y hashes de capturas](evidencias/etapa-3-incremento-6.json).
Los originales privados se conservan en `.local/e2e-incremento-6/`.

- [Paginación del manifiesto, escritorio](capturas/etapa-3-incremento-6-navegacion-desktop.png).
- [Paginación del manifiesto, móvil](capturas/etapa-3-incremento-6-navegacion-mobile.png).
- [Cancelación auditada, escritorio](capturas/etapa-3-incremento-6-cancelacion-desktop.png).
- [Cancelación auditada, móvil](capturas/etapa-3-incremento-6-cancelacion-mobile.png).

La disponibilidad del entorno se comprobó nuevamente tras el aviso de inicio del
workspace. Los archivos permanecieron intactos y los logs de npm confirman salida 0
de ambos comandos completos. Ese aviso no obligó a repetir las baterías; la pasada posterior respondió a la
corrección demostrada de sesiones.

## Errores encontrados y corregidos

1. Truncamiento web en 50 sin navegación y ausencia de acceso a una reserva enfocada
   posterior a ese corte: corregidos mediante las proyecciones paginadas.
2. La cancelación administrativa no tenía en la web revisión/confirmación de grupo
   ni motivo trazable: nueva envoltura auditada y formulario, sin cambiar `cancel`.
3. El primer ensayo de 027 falló al declarar como PL/pgSQL una envoltura con cuerpo
   SQL. Se corrigió el tipo de función; las ejecuciones dirigidas y posteriores
   aprobaron. El intento inicial no se contabiliza como aprobado.
4. Se corrigió la selección de fixture del nuevo test antes de la batería final:
   usa DEFAULT + historia adicional, sin activar por accidente el escenario ROAD.
   Se verificó de nuevo el escenario afectado, sin reducir aserciones.
5. Carrera de arranque/lecturas frente a login y logout: reproducida con respuestas
   controladas y corregida con orden de operaciones en la misma página. No sustituye
   la autorización SQL ni sincroniza sesiones entre pestañas.

## Reproducción en Windows

En PowerShell, Node 22 o 24, dentro del repositorio/rama indicada:

```powershell
npm ci --no-fund
$env:NEXO_WEB_RECOVERY_SCENARIO = "DEFAULT"
$env:NEXO_WEB_ADMIN_FIXTURE = "1"
npm run dev:web
```

El launcher crea una base PostgreSQL ficticia nueva. Abrir el loopback que imprime y
consultar los accesos con `Get-Content -Raw "<archivo indicado>"`. Son credenciales
efímeras: no publicarlas ni utilizarlas en otro sistema. Tres perfiles de navegador:

1. **adminH**, `/administracion`: elegir FICTICIO-WEB-0-0. Comprobar cinco plazas
   confirmadas, cero personas observadas y ninguna salida. «Siguiente página de
   manifiesto» muestra registros que exceden los primeros 50; anterior permite volver.
2. **terminal0**, `/pasajero`: hay 67 reservas propias, muchas canceladas de prueba.
   Consultar presencia de la nueva reserva de una plaza; también recorrer hasta la
   reserva de cuatro. Las demás cuentas no reciben estas reservas.
3. Administrador, última página: elegir la reserva confirmada de **una plaza/Bs 35**,
   «Revisar reserva y grupo». Revisar su versión de condiciones y confirmarla. Esa
   acción no acepta condiciones por el responsable ni cambia importes. Una mutación
   devuelve el manifiesto a su primera página; volver a la última para continuar.
4. Elegir «Reserva equivocada», marcar confirmación del grupo y cancelar. Sin motivo
   o casilla el botón está deshabilitado. Reabrir revisión: Cancelada y motivo registrado.
5. Pasajero actualiza sus reservas: Cancelada, Bs 35 y referencia conservados.
   **driver0**, `/chofer`, actualiza: cuatro plazas confirmadas, cero abordadas y sin
   salida. El chofer no dispone de cancelación administrativa.
6. Si otra sesión modifica reservas mientras se navega, se pide actualizar el listado.
   No se mezclan páginas ni se presume capacidad a partir de la pantalla anterior.

Ctrl+C detiene el laboratorio. Para volver a la fixture corta, quitar la variable:
`Remove-Item Env:NEXO_WEB_ADMIN_FIXTURE`. El flag solo prepara datos offline antes de
escuchar; no crea un endpoint para fabricar historial desde la web.

```powershell
npm test
npm run test:integration -- --test-name-pattern="A60|G12|R08|Z07"
npm run test:web -- --suite=administration.spec.mjs
npm run test:all
npm run test:web
```

La selección dirigida es opcional y rechaza suites/proyectos desconocidos; la CI no
la usa. Los comandos finales ejecutan la batería completa. La detención Windows se
comprueba mediante IPC; Linux prueba además SIGINT real y cierre de puertos.

## Riesgos y pendientes para cerrar Etapa 3

La paginación permite recorrer colecciones grandes; la huella actual recorre los IDs
del conjunto. Pruebas de carga y optimización con volúmenes productivos siguen pendientes.
Los listados son consultas manuales y no sustituyen la revalidación transaccional.
Las proyecciones limitadas de opciones/consentimientos de recuperación conservan las
cotas técnicas de su contrato; no se presentan como una resolución masiva ilimitada.

Persisten flujos web de expreso/división voluntaria, declaración/aceptación de cambios
por el responsable, correcciones y recuperación especial, revisión simulada de menores,
responsables presenciales y configuración/provisión de cuentas. No se habilita desde
HTTP el aprovisionamiento privilegiado ni se inventa verificación de identidad/legal.
Las acciones existentes de vehículos se conservan: una unidad retirada por traslado
de terminal no vuelve a fila mediante una carrera administrativa ficticia. Hace falta
un procedimiento autorizado para ese estado.

Decisiones comerciales/legales de cancelación tardía, reembolso, ausencias, retención,
menores y uso real permanecen separadas. No se automatizan consecuencias ni se introducen
políticas nuevas. **Este incremento no cierra toda la Etapa 3 ni habilita producción.**
Sin main/otras ramas modificadas, fusiones, incremento 7, GPS, OAuth/pagos reales,
comunicaciones externas, servicios contratados o gastos nuevos.

## Evaluación de entrega

**Incremento 6 implementado y verificado en su alcance de laboratorio**: cancelación
administrativa con motivo, consulta paginada completa, revisión administrativa y
controles de sesión/permisos. 348 casos locales y matriz final del código 4/4, sin
ocultar el fallo previo. La Etapa 3 completa conserva los pendientes anteriores y
no se declara cerrada ni preparada para producción.

El commit documental posterior solo actualiza este informe y la referencia de código
en la evidencia JSON. Conserva exactamente el ejecutable probado de `c57d59d`;
sus checks se registran en la entrega del PR #3, sin una cadena de commits adicionales
para documentar cada ejecución idéntica. El filtro de paths de CodeQL no dispara
análisis nuevos por esos dos archivos documentales.
