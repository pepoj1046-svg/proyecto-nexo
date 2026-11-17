# Etapa 3 — Incremento 2: reservas web de laboratorio

26/10/2026, America/La_Paz. Exclusivamente `pepoj1046-svg/proyecto-nexo`, rama
`desarrollo/etapa-3`, desde `0cf847e`. La autorización del propietario habilita este
incremento y sustituye la prohibición histórica de incremento 2 en AGENTS.
[PR #3](https://github.com/pepoj1046-svg/proyecto-nexo/pull/3), hacia
`desarrollo/etapa-2`, permanece abierto, sin fusionar.

## Funciones implementadas

- Consulta pública anónima por origen y destino, sin selector de categoría.
- Login con identidad existente, logout revocable en PostgreSQL, cookies opacas
  HttpOnly/SameSite=Strict, CSRF en login y operaciones autenticadas. Se validan
  actor y permisos reales en servidor, sin IDs de usuario/rol confiados al navegador.
- Selección por nombres de puntos habilitados de subida/bajada, ordenados dentro
  de la ruta. Reconsulta de precio y cupos de todos los segmentos seleccionados.
- Solicitud de 1–6 plazas juntas, según cupo, con confirmación del importe/versionado,
  sesión e Idempotency-Key. Se reutilizan reserve_business/reserve_enroute, sus
  bloqueos, fila y cotización. No se divide el grupo ni se cobra dinero.
- Estado pendiente HELD diferenciado de confirmado: solo el chofer asignado acepta
  con su RPC existente. `/operador` ofrece únicamente esa aceptación de laboratorio.
- «Mis reservas» lista solo reservas APP propias, incluidas anteriores, con referencia,
  puntos, plazas, importe pactado, versión, vehículo, estado efectivo e historial básico.
  Las reservas sobreviven recargas del navegador durante la misma ejecución.
- Ante respuesta perdida tras el commit, se conserva exactamente cuerpo+clave y se
  bloquean cambios al intento; reintentar consulta el resultado idempotente original,
  sin precomprobar capacidad que podría estar ocupada por la propia solicitud.
- El resumen demostrativo anterior sigue siendo una operación secundaria explícita
  de lectura. Elegir viaje o consultar el ejemplo no crea retenciones.
- Corregida la observación del [último comentario técnico de ChatGPT](https://github.com/pepoj1046-svg/proyecto-nexo/pull/3#issuecomment-6431981348):
  el encabezado de asociación contiene solo datos comunes. Estado, aviso, terminal y
  atención se presentan por ruta/recorrido; otra ruta suspendida de la misma asociación
  no hereda el estado de su primer servicio.

## Archivos y migración

001–022 se conservan sin cambios. La nueva **023_web_journeys.sql** añade solamente
`public_route_points`, `public_segment_availability` y `passenger_reservations`.
Es necesaria para identificar paradas concretas (incluso en la misma localidad),
mostrar nombres públicos sin consultar tablas privadas como invitado y obtener una
proyección estrictamente propia. No cambia tablas ni reconstruye inventario/identidad.
Todas usan SECURITY DEFINER con search_path fijado y EXECUTE restringido.

Código principal: `apps/web/src/Functional.tsx`, `private-api.ts`, `main.tsx`,
`styles.css`; `src/http/web-sessions.mjs`, `web-gateway.mjs`;
`src/db/web-reservation-service.mjs`, `web-catalog-service.mjs`.
Arranque/fixtures: `scripts/web-demo.mjs`, `seed-web-demo.mjs`, `test-postgres.mjs`.
Pruebas: `tests/web-sessions.test.mjs`, casos W01–W11 en la integración,
`tests/web/functional.spec.mjs`, `scripts/test-web.mjs`, `verify-web-restart.mjs`.
Actualizadas las expectativas de migraciones anteriores para incluir 023. El caso
web demostrativo admite además `/api/points`, consulta de lectura; conserva sus
aserciones de ausencia de escrituras, almacenamiento local y retenciones.

## Procedimiento sencillo en Windows

Requisitos: Node 22.x o 24.x y npm. No hace falta PostgreSQL instalado, Docker,
proveedor de identidad ni base remota. No ejecutar como root en Linux.

```powershell
npm ci --no-fund
npm run dev:web
```

1. Mantener esa terminal abierta. Copiar la dirección `http://127.0.0.1:<puerto>`.
   Ignora HOST/PORT/DATABASE_URL externos: el launcher crea su propio clúster local.
2. La terminal indica el archivo privado `.local/accesos-<identificador>.json`.
   En otra terminal ejecutar `Get-Content -Raw "<ruta exacta indicada>"`.
   En Ubuntu se puede leer con `cat`. No subir ni compartir ese archivo.
3. En la web: «Probar Yacuiba → Villa Montes», elegir primer viaje disponible de
   Horizonte, ajustar plazas y los desplegables **Subida/Bajada** si corresponde.
4. «Reservar con sesión», usar login/contraseña de `accounts.viajero0` del archivo,
   «Revisar solicitud», comprobar importe y recorrido, marcar confirmación,
   «Registrar solicitud». Aparece referencia y **pendiente de aceptación**.
5. Abrir «Mis reservas», recargar: la solicitud debe conservar referencia e importe.
6. En otro perfil/contexto de navegador, abrir la misma URL con `/operador` y entrar
   con `accounts.driver0` para el primer trufi de Horizonte (`driver1` para segundo,
   `driver2` para unidad en recorrido; `driver3` corresponde a Unión del Sur).
   Aceptar la oferta de esa referencia antes de su vencimiento técnico provisional
   de **dos minutos**. Ese plazo no es una nueva regla comercial definitiva.
7. Volver al pasajero y pulsar «Actualizar mis reservas»: **confirmada por el chofer**.
   Esto no anuncia una salida ni implica pago. Cerrar sesión para revocarla.
8. Ctrl+C detiene HTTP/PostgreSQL y elimina el archivo de accesos. Un nuevo arranque
   genera nuevas cuentas/contraseñas y una base vacía de reservas web anteriores.

**La persistencia es PostgreSQL dentro de esta ejecución, no persistencia entre
reinicios.** No se ha habilitado ninguna base remota. Los presupuestos de intentos
existentes siguen vigentes: no insistir repetidamente con cuentas/contraseñas erróneas.

## Pruebas y resultados reales

- `npm run test:all`: **40/40 unitarias y 192/192 integraciones PostgreSQL real**,
  sin omitidas, además de probes del runner y ambos listeners CLI aprobados localmente.
  Host local Node 24.19.0, PostgreSQL real fijado por el lockfile.
- W01–W11 comprueban puntos habilitados/orden, proyecciones sin identidades, historial
  propio y legado, HELD/aceptación legítima, revocación, CSRF y rotación, permisos,
  doble clic concurrente, carrera de dos cuentas por última plaza, conservación del
  precio/reintentos y migración 001–022 poblada a 023 sin reescrituras.
- `npm run test:web`: **36/36 casos** en Chromium local 154, escritorio 1440×1000
  y móvil emulado 390×844. Incluye los 28 anteriores, acceso/salida, privacidad,
  reserva HELD/aceptación real, recarga, cookie protegida, respuesta perdida tras
  commit con reintento sin duplicación y puntos/tarifas intermedias. Comprobaciones
  axe WCAG 2 A/AA y 2.1 AA sin incidencias en las pantallas ejercitadas.
- Parada con SIGINT real: HTTP/PostgreSQL detenidos y puertos cerrados verificados.
  Reinicio: reserva persistida en la primera ejecución, contraseña/sesión/reserva
  previas ausentes en la siguiente; archivo privado eliminado en ambos cierres.
- CI del commit funcional **f2b51ddd88d4c6e2b87a6b71f4d8f80c169c10d1**:
  [ejecución del PR #3](https://github.com/pepoj1046-svg/proyecto-nexo/actions/runs/40443264644),
  **4/4 trabajos aprobados**, sin reintentos: Ubuntu Node 22, Ubuntu Node 24,
  Windows Node 22 y Windows Node 24. Cada combinación ejecutó test:all y test:web,
  incluidos los smokes de cierre y reinicio (SIGINT en Ubuntu, IPC en Windows).
  No se atribuyen a este incremento los resultados históricos del incremento 1.

Main sigue en `cac056b`, Etapa 1 en `9188139` y Etapa 2 en `820fd1f`;
PR #1 y #2 continúan abiertos y sin fusionar. El commit posterior de documentación
registra únicamente esta evidencia; el código probado es el hash indicado arriba.

Se mantienen todos los **245 casos** del incremento 1; la batería ampliada contiene
**268**: 40 unitarias + 192 PostgreSQL + 36 navegador (18 escritorio, 18 móvil).
Los smokes de transporte, parada y reinicio se contabilizan por separado.
Cada archivo de navegador usa un clúster nuevo por dispositivo para no agotar el
presupuesto global de 120 solicitudes/minuto; el límite no se amplía ni se desactiva.

Durante el desarrollo se detectaron/corrigieron: uso indebido del helper privado
require_actor desde el rol runtime (se reutiliza actor y se exige resultado válido),
selectores de paradas sin nombre accesible explícito, presentación de rutas mezcladas,
contextos antiguos de otro puerto tras reinicio y mensajes de acceso desconectado
que se mantenían aun con sesión activa. La prueba de actualización desactiva únicamente
los triggers de captura durante la copia de fixtures, evitando duplicar contratos;
los reactiva antes de aplicar 023. No se debilitó ningún permiso SQL para corregirlos.

## Capturas del incremento

Capturas con datos exclusivamente ficticios, sin contraseñas ni cookies:

[Mis reservas — escritorio](capturas/etapa-3-incremento-2-reservas-escritorio.png) ·
[Mis reservas — móvil](capturas/etapa-3-incremento-2-reservas-movil.png).

## Límites y pendientes

- Solo laboratorio loopback con datos ficticios. Cookie sin Secure únicamente por
  HTTP local; no es configuración para Internet ni aislamiento frente a procesos
  hostiles del mismo equipo. Pools app/identity separados; setup se cierra antes de escuchar.
- Sin pagos ni gestión de dinero, GPS, OAuth, SMS/correo, notificaciones externas,
  base remota, despliegue, cuentas/personas/vehículos reales ni costos contratados.
- Recuperación de cuentas y registro público no se exponen en esta web; se mantienen
  los mecanismos locales previos. No hay panel administrativo ni de chofer completo.
  «Ya llegué» y las demás operaciones terminales siguen pendientes de conexión web.
- El historial es básico; no se fabrican eventos retrospectivos en reservas antiguas.
  El listado pagina como máximo 50 reservas web por consulta en esta primera interfaz
  (la RPC permite hasta 100 y offset). No se implementa paginación visual aún.
- Si se recarga/cierra la pantalla durante una respuesta ambigua, consultar Mis reservas
  antes de iniciar otra solicitud: no se guarda token ni clave en localStorage/sessionStorage.
- No activar sin decisión del propietario políticas comerciales/legales de ausencias,
  menores, manifiesto, tolerancias, plazos definitivos, retención o uso comercial.
- Revisar funcionalmente este incremento antes de autorizar el incremento 3. La Etapa 3
  sigue abierta: este informe no declara listo el sistema para producción.
