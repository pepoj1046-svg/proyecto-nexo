# Etapa 3 — Incremento 8B: responsables, menores y revisión humana

Fecha: 01/11/2026, America/La_Paz. Solo laboratorio ficticio. Repositorio `pepoj1046-svg/proyecto-nexo`, rama
`desarrollo/etapa-3`, desde `6a9784a2872ad5a897c011f675acb701544d1bb9`.
Se comprobó el checkout correcto y limpio antes de editar. PR #3 abierto hacia
`desarrollo/etapa-2`, sin fusionar. La Etapa 3 requiere otra auditoría final separada.

## Funcionalidades implementadas y reutilizadas

- **Presenciales sin cuenta:** persona técnica ficticia separada de identidad
  digital, operador y actuación trazables. Vinculación mediante código aleatorio de
  un uso del titular en sesión activa y comprobación humana ficticia del operador.
  Corrección/desvinculación versionada y auditada; referencia sola nunca reclama
  reserva. Corregir persona no borra historia ni crea roles o cuentas.
- **Autoridad vigente:** revisión monotónica del responsable invalida consentimientos
  y solicitudes antiguos, incluso A → sin cuenta → A. Recuperación tardía nativa
  conserva persona/cuenta con evento separado. Consentimiento de ruta que no pueda
  renovarse bajo unicidad anterior queda bajo revisión humana, sin falso éxito.
- **Menores:** panel técnico del administrador usa casos/revisiones y controles de
  acompañante existentes. El responsable consulta su grupo. No se recopilan edades,
  nombres ni documentos. Sin acompañante no se ofrece aprobación web. Cambiar clase
  o acompañante ya registrado exige revisión humana porque falta contrato seguro.
- **Ausencias:** observación individual o de pendientes, parcial y posterior a
  salida/punto de recogida, por chofer actual o administración autorizada. Conserva
  actor, momento, episodio, motivo e inventario. Abordaje posterior conserva la nota
  histórica. BOARD previo, incluso rectificado, impide inventar ausencia; expreso
  queda bajo revisión porque seis plazas técnicas no prueban seis personas.
- **Discrepancias:** se reutiliza «Reportar un problema» 8A y se agrega traslado seguro
  incorrecto. Administración consulta evidencia e historial y registra resultado y
  motivo con versión esperada. El responsable ve el resultado. Rectificación física
  solo mediante corrector nativo admitido, en punto/episodio permitido, manteniendo
  original y compensación separados. Custodia segura y viaje finalizado no se
  revierten desde esta revisión.
- **Casos especiales:** formularios de solicitud de alternativa/cancelación y
  resolución tardía conectados a operaciones nativas. Grupos divididos, movimientos
  incompatibles, falta de vehículo o consentimiento vigente quedan para revisión
  humana, sin cambio parcial ni consecuencias económicas inventadas.
- **Cuentas:** consulta de permisos DRIVER ya existentes; revocación/restauración
  nativa únicamente por administrador con alcance global de su asociación. Un
  administrador limitado a ruta/terminal consulta sin ampliar acceso. No hay
  aprovisionamiento web, nuevos administradores ni asociación automática.
- **Web:** paneles existentes de pasajero/responsable, chofer y administración;
  confirmaciones independientes por actuación, errores comprensibles, carga,
  controles móviles y accesibles. Reservas WALK_IN autorizadas con cursor, sin
  modificar el listado APP anterior.

Se reutilizan inventario, seis plazas por segmento, fila, tarifas/versiones,
episodios, integrantes, contratos de menores/consentimiento, corrector de movimientos,
recuperación tardía y gestión de membresías. No hay segundo inventario, salida,
cancelación, aviso ni custodia automática.

## Migraciones, contratos y archivos

**001–030 intactas.** Se agregan:

- `031_care_responsibilities.sql`: personas sin cuenta, revisión de vínculo,
  capacidad de vinculación de un uso y autoridad efectiva del grupo.
- `032_care_reviews_and_attendance.sql`: ausencia observada, revisión de reportes,
  guardas de custodia, autoridad de decisiones/solicitudes, recuperación de vínculo,
  lectura y comandos seguros, protección de WALK_IN frente a creador revocado.

Las tablas nuevas son privadas, RLS habilitada, historia inmutable y sin acceso
SELECT/DML directo de aplicación. Funciones privilegiadas fijan search_path y
revocan PUBLIC; helpers y aliases no son RPC públicas. Sesión y membresía se
revalidan después del lock de ruta. Escrituras, auditoría y recibos son atómicos.

Contrato detallado: [Cuidados y revisiones](../ETAPA_3_CUIDADOS_Y_REVISIONES.md).
Archivos de aplicación: `src/db/web-care-service.mjs`, servicios de operaciones,
recuperación/seguridad y gateway; componentes `Care`, `Responsibles`,
`DiscrepancyReview`, `Safety`, `Operations`, `Functional`, `Conditions`, errores y
estilos. Pruebas unitarias, integración, E2E y testigo SQL; selección de suites del
runner, README, AGENTS y referencia de skill. Sin cambios a `.codex`, dependencias
ni políticas comerciales. CI conserva la matriz y amplía solo el presupuesto
del job de 20 a 25 minutos: el último Windows/22 de 8A necesitó 18m59s y
8B agrega seis laboratorios frescos (38 frente a 32). No se amplían deadlines
existentes de pruebas, HTTP, SQL, launcher ni reintentos.

## Auditorías de los dos subagentes

Dos agentes **genéricos con instrucciones manuales**, exclusivamente lectura:
`seguridad_auditoria_8b` y `pruebas_auditoria_8b`. Ambos terminaron; no editaron,
crearon commits, levantaron servicios ni ejecutaron matrices. No se afirma carga
automática de perfiles TOML. El principal programó, integró y ejecutó las pruebas.

Seguridad señaló ausencia de contrato de corrección para responsable y compañero,
permiso propio en cada RPC, caducidad/revocación, snapshot de consentimientos,
reutilización A → otro → A y pérdida de vínculo en recuperación tardía. Se agregó
revisión monotónica, trazabilidad, autoridad por decisión/solicitud, bloqueo explícito
de consentimiento obsoleto y herencia auditada. Se dejó la corrección de compañía y
custodia sin contrato bajo revisión humana.

Pruebas identificó cobertura nativa útil Q17/Q18/Q28, L03/L05/L08/L09, J07, K801,
K805/K810/K812, y lagunas web/rollback/actualización 030 poblada. Se conservaron los
casos anteriores y se añadieron pruebas T8B01–T8B21 y recorridos de tres roles,
responsables, ausencia posterior a salida y grupo dividido. No se ejecutaron matrices
por los subagentes ni se contó su auditoría como prueba aprobada.

## Problemas demostrados y corregidos

1. Un operador revocado conservaba SELECT de WALK_IN por `created_by`; la regresión
   T8B09 falló realmente (una fila visible). RLS restrictiva y límites en RPC antiguas
   retiran esa autoridad histórica sin eliminar autoría ni acceso legítimo.
2. Vincular otra vez la misma cuenta podía revivir decisiones/solicitudes anteriores.
   Se registra revisión de autoridad y no se interpreta un recibo viejo como permiso
   nuevo. La restricción histórica que impide renovar consentimiento se comunica
   para revisión, sin omitir INSERT silenciosamente.
3. El corrector antiguo podía afectar evidencia que sostiene recepción segura 8A.
   Una guarda impide VOID de esos hechos incluso al invocar la operación antigua.
4. La recuperación nativa podía perder la separación persona/cuenta. Ahora hereda
   el vínculo efectivo con evento y auditoría, conservando importe y revisión de menor
   PENDING. Grupos incompatibles siguen rechazándose atómicamente.
5. En desarrollo, retener lock de sesión antes de esperar ruta impedía revocar con
   seguridad. Se separó lectura inicial de revalidación/estabilización tras ruta;
   J717 y casos de revocación volvieron a pasar.
6. Renombrar una función con parámetros autocualificados rompió J712/J713. Se
   preservan OIDs y se adapta explícitamente el alias privado, conservando contratos.
7. Escenarios E2E consecutivos agotaron el presupuesto global de 120 solicitudes.
   Se aislaron recorridos en laboratorios frescos sin elevar límite, esperar ventanas,
   reintentar fallos ni debilitar aserciones. Se corrigieron dos errores del propio
   montaje nuevo (nombre del comando de menor y confirmación faltante).
8. Una compilación simultánea a un navegador activo reemplazó recursos hash y dejó
   su recarga en blanco. Se corrigió la secuencia de validación: no reconstruir
   `dist` durante E2E. La repetición dirigida estable pasó en ambos dispositivos.
   Otra aserción de ausencia leía el ledger antes del commit porque coincidía con
   el título del panel; ahora espera la respuesta real de la operación, sin sleeps.

## Pruebas y resultados

Entorno local: Debian GNU/Linux 13 (trixie), Node 24.19.0, PostgreSQL real 18.4, Chromium 154 y
Playwright 1.64.1. Node 22 y Windows se verifican en CI, no en el shell local.

- `npm run test:all`: 62 unitarias y 273 PostgreSQL aprobadas, sin fallos/omitidas;
  propagación de error del runner y smokes HTTP/negocio aprobados, con cierre real.
- Tras la revisión final de los auditores se agregaron T8B20–21. Se ejecutó completa
  nuevamente la integración PostgreSQL mediante `node scripts/test-postgres.mjs`,
  usando la compilación estable existente: **275/275**, cero fallos/omitidas.
  Se evitó reconstruir `dist` mientras E2E estaba activo.
- `npm run web:build`: TypeScript y compilación web aprobados.
- Batería E2E completa estabilizada: `npm run test:web`, **80/80** (40 escritorio,
  40 móvil), 36 laboratorios cerrados correctamente, SIGINT y reinicio aprobados.
- Al completar la recomendación del auditor se añadió `care-accounts.spec.mjs` con
  fixture independiente. `npm run test:web -- --suite=care-accounts.spec.mjs`:
  **2/2** adicionales, uno por dispositivo, dos cierres más, SIGINT y reinicio.
  Se comprueba revocación/restauración web, sesión abierta y auditoría SQL. La
  primera expectativa del test asumía listado vacío 200; el contrato vigente
  devuelve 403 y limpia el panel, rechazo más estricto que se comprueba explícitamente.
- Total local: **419 casos distintos** (62 + 275 + 82), cero fallos/omitidos finales.
  Las E2E se ejecutaron como batería de 80 más la nueva suite de 2, sin afirmar una
  ejecución local unificada de 82. CI ejecuta las 19 suites en una sola batería,
  con 38 laboratorios. Los fallos intermedios de desarrollo están descritos arriba.

No atribuir a 8B los 389 casos históricos de 8A.

Comandos reproducibles:

```text
npm run test:all
npm run test:web
npm run web:build
```

Dirigidas nuevas: T8B01–T8B21 (vínculos, épocas, menores, ausencia, custodia,
rectificación, carreras, rollback, roles, CSRF/sesión/RLS, paginación >50, upgrade
030 poblado y grupo dividido). H08 conserva comprobación global de privilegios y
search_path. Upgrade 030 compara todas sus tablas antes/después, incluidos menor,
reserva presencial sin vínculo, recepción pendiente y reporte, y re-aplica sin cambios;
las actualizaciones anteriores también permanecen en la batería.

El **commit final**, CI exacta Ubuntu/Windows × Node 22/24, enlaces a jobs/logs y
CodeQL sobre ese SHA se consignan en el
[registro final de verificación 8B](https://github.com/pepoj1046-svg/proyecto-nexo/pull/3#issuecomment-6558579460).
Se actualiza ese registro después de CI sin crear commits de solo resultados que
invaliden lo verificado. CodeQL sin nuevas alertas no certifica ausencia de alertas
históricas ni readiness de producción.

Las [capturas ficticias y hashes](evidencias/etapa-3-incremento-8b.json) documentan
responsables, menor/ausencia, revisión visible y permisos, en escritorio y móvil.
No publicar archivos `.local`, contraseñas, sesiones, códigos de vinculación, cookies
ni trazas de autenticación. Las capturas del vínculo se toman después de ocultar o
consumir el código.

## Procedimiento en Windows

1. Usar Node 22 o 24, Git y una copia de `desarrollo/etapa-3`. En PowerShell:

   ```powershell
   npm ci --no-fund
   npx --no-install playwright install chromium
   npm run test:all
   npm run test:web
   npm run dev:web
   ```

2. Abrir solo la URL `http://127.0.0.1:...` indicada. Usar exclusivamente los accesos
   ficticios temporales generados por el comando. Tres perfiles/contextos distintos,
   nunca tres pestañas compartiendo cookies.
3. Administración `adminH`, FICTICIO-WEB-0-0: preparar presencial de dos plazas,
   revisar importe y confirmar. Actualizar manifiesto, abrir «Consultar responsables,
   menores y ausencias» y registrar responsable presencial sin cuenta. No se pide
   nombre ni documento. Un pasajero con su referencia todavía no puede consultarla.
4. `terminal0` en pasajero: generar código de un uso en «Reservas presenciales a mi
   cargo» y entregarlo solo al operador de esta prueba. Ocultarlo antes de capturas.
   Administrador comprueba supuesto ficticio y vincula; pasajero consulta su listado.
   Revocar vínculo equivocado y corregir responsable desde administración conserva
   historia y retira consulta futura. `adminH` solo consulta permisos globales.
5. `operativo0`, `adminH` y `driver5`, FICTICIO-OPERATIVO: revisar integrante 1 con
   acompañante 2; estado PENDING bloquea, comprobación técnica ficticia no es permiso
   legal. Registrar BOARD del acompañante antes del menor. Ausencia de integrante
   pendiente conserva todas las plazas. Un BOARD previo no puede marcarse ausente.
6. Para probar cambios globales de acceso en un laboratorio separado, ejecutar
   `npm run test:web -- --suite=care-accounts.spec.mjs`. Solo esa fixture habilita
   el acceso digital ficticio `admin` de un administrador ya existente; no crea
   membresías nuevas ni habilita aprovisionamiento web. Para explorarlo manualmente:

   ```powershell
   $env:NEXO_WEB_CARE_ACCOUNTS_FIXTURE='1'
   npm run dev:web
   Remove-Item Env:NEXO_WEB_CARE_ACCOUNTS_FIXTURE
   ```

   Con el administrador ficticio sin restricción, consultar accesos, confirmar
   revocación y comprobar que el chofer abierto pierde manifiesto/operaciones.
   Restaurar permiso existente y comprobar auditoría. No crear roles ni ampliar
   asociación desde la web.
7. Pasajero abre «Reportar un problema». Administración consulta discrepancias,
   evidencia y registra resultado con confirmación. Rectificar solo un hecho admitido
   en parada actual; si afecta compañero/custodia/finalizado debe rechazarse sin
   cambios. El responsable actual ve estado e historial; otro pasajero no.
8. El recorrido completo anterior de cuatro en terminal y dos en Palmar permanece
   probado. En Palmar, después de salida, registrar ausencia observada de un pendiente
   conserva seis plazas; su posterior BOARD real conserva la nota como historia.
   Ausencia no habilita una salida incompatible ni libera inventario.
9. Detener con Ctrl+C. El runner verifica listener/PG cerrados y reinicio limpio.

Estos pasos son procedimiento reproducible; no se atribuye una prueba manual Windows
al shell Linux. La evidencia Windows procede de los jobs CI enlazados.

## Límites y pendientes para el propietario

- Identidad/responsabilidad y normas de viaje de menores requieren decisión jurídica
  competente. No se afirma verificación real ni se inventan edades/documentación.
- Faltan contratos de corrección de acompañante, reversión de custodia/traslado
  finalizado y renovación de ciertas decisiones de ruta tras corregir responsable.
- Ausencias: definir plazos, tolerancias, comunicaciones, salida con faltantes y
  cualquier consecuencia comercial. 10+5 y TTL dos minutos siguen provisionales.
- Definir recuperación parcial de grupos divididos, reservas futuras tras revocar
  permisos, reversión de decisiones, casos sin responsable comprobado y soporte.
- Aprobar políticas de retención/borrado de evidencia, códigos, consentimientos e
  historial, además del acceso histórico tras cambio de responsable. No se fijan plazos.
- Revisar funcionalmente y realizar auditoría final separada antes de cerrar Etapa 3.
  Sin producción, merge, pagos/reembolsos, GPS, servicios externos ni Etapa 4.

8B no debe interpretarse como cobertura de resoluciones comerciales/legales que
permanecen bloqueadas; el criterio de entrega es laboratorio verificable y rechazo
seguro. La implementación queda preparada para revisión funcional y auditoría final de
Etapa 3. El registro enlazado identifica el commit y la CI final: su aprobación es
condición de entrega; este informe no declara cierre de Etapa 3 ni producción.
