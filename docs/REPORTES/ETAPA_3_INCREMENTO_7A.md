# Etapa 3, incremento 7A — Expresos y división voluntaria

31/10/2026, America/La_Paz. Repositorio `pepoj1046-svg/proyecto-nexo`, rama
`desarrollo/etapa-3`, base `91dad4d837b9ef9df60f8d7138670e64f3b7bb2b` comprobada
contra GitHub con árbol inicialmente limpio. El propietario autoriza 7A y 7B;
AGENTS se actualiza para reflejarlo y mantener el incremento 8 fuera del alcance.
Se utiliza `.agents/skills/trufis-dev/SKILL.md`, los contratos vigentes de Etapa 2
y los informes 1–6 de Etapa 3. PR #3 continúa hacia `desarrollo/etapa-2`, sin fusionar.

## Auditoría y funciones conectadas

- El núcleo ya tenía `quote(express)`, `reserve_business`, `parts`,
  `splitConsent` y `containsMinors`. Se reutilizan sin reemplazar inventario,
  retenciones, aceptación del chofer, tarifas, filas o despacho.
- Modalidad normal: 1–6 plazas. Grupo junto por defecto; cotización ordinaria del
  segmento, versión e importe total antes de confirmar.
- Modalidad expresa: seis **plazas técnicas del vehículo completo** durante el
  segmento contratado. No afirma que viajen seis personas. Usa exclusivamente
  la tarifa expresa configurada, nunca seis veces la ordinaria. Sin tarifa o unidad
  compatible se rechaza; no hay precio inventado, división ni salida automática.
- Para >=3 plazas normales, la consulta de propuesta prefiere una unidad donde el
  grupo cabe entero. Cuando no la encuentra, solo muestra una división si la suma
  de plazas de candidatos compatibles alcanza al grupo. Presenta vehículos por
  posición de fila, plazas por parte y total antes del consentimiento.
- Dividir requiere dos declaraciones separadas: grupo únicamente de adultos y
  consentimiento explícito del responsable autenticado. No se recogen nombres,
  edades ni documentos, ni se verifica una condición legal. Con menores o sin
  declaración no se ofrece una separación autorizada.
- Se envía una única operación nativa con todas las partes: se crean todas las
  retenciones o se revierte todo. SQL vuelve a comprobar fila, permisos, cupo,
  precio y versión; una propuesta no retiene inventario ni garantiza disponibilidad.
- Mis reservas conserva referencia/grupo, partes vinculadas, importe y estado.
  **La aceptación de una parte no se presenta como confirmación del grupo completo.**
  Solo se muestra confirmado en conjunto cuando todas sus partes están confirmadas.

## Contrato conservado y límites

`/api/reservations/quote` mantiene su respuesta anterior de cuatro campos cuando
no se solicita una propuesta. El parámetro opcional de lectura `proposal:true`
añade `parts` y `splitRequired`. La reserva recibe únicamente los tres campos
monetarios de quote, más las partes y consentimientos; no recibe identidad o rol
confiados al navegador. El flujo anterior ENROUTE se conserva sin división/expreso.

La propuesta usa la proyección nativa de hasta 20 vehículos de ese recorrido;
no es una consulta ilimitada de toda la flota ni promete horarios/espera. Los
escritos siempre pasan por el núcleo transaccional y pueden rechazar una selección
que dejó de ser compatible. Se conserva exactamente cuerpo y clave al reintentar
una solicitud cuya respuesta pudo perderse; cambiarla exige consultar su estado.

La atomicidad existente es la **creación conjunta de las retenciones**. Cada chofer
acepta su oferta según el contrato vigente. No se ha añadido un coordinador que
cambie todas las partes a CONFIRMED en un único commit tras decisiones de varios
choferes: ese contrato no existe. Si se exige esa confirmación final coordinada,
es un punto pendiente de definición y revisión; no se simula desde la interfaz.
Tampoco se automatiza una reasignación si un chofer rechaza una parte.

## Archivos y migraciones

| Capa | Archivos |
| --- | --- |
| Reserva/adaptador | `src/db/web-reservation-service.mjs` |
| Interfaz | `apps/web/src/main.tsx`, `Functional.tsx`, `Operations.tsx`, `operation-model.ts`, `private-api.ts` |
| Laboratorio | `scripts/seed-web-demo.mjs`, `scripts/test-web.mjs` |
| Regresiones | `tests/web-journey-modes.test.mjs`, `tests/web/journey-modes.spec.mjs`, `tests/integration/postgres.test.mjs` |
| Documentación | AGENTS, arquitectura, seguridad y los dos informes |

7A no modifica funciones de reserva SQL. La migración **028** del mismo incremento
conjunto corresponde a las condiciones de 7B. **001–027 permanecen intactas.**

## Pruebas y evidencia

- Dos unitarias nuevas: límites/forma del expreso y consentimiento/menores/suma de
  partes. Se conservan las validaciones y pruebas anteriores.
- J701: tarifa expresa, seis plazas, recibo repetido, privacidad y chofer legítimo.
- J702: división necesaria, dos partes en un grupo, precio y rechazo sin cambios
  parciales ante inventario distinto o consentimiento inválido.
- J703: una aceptación individual no confirma el grupo; identidad de grupo y partes
  enlazadas se mantienen hasta la aceptación de todos, sin sobreventa.
- Cuatro E2E nuevos: dos por dispositivo. PostgreSQL READ ONLY independiente contrasta
  plazas y ausencia de salida automática. Expreso completo, precio y accesibilidad.
- Regresión de compatibilidad: el consumidor de reinicio conserva el contrato original
  de quote; sesión, contraseña y reservas anteriores desaparecen al reiniciar.

La batería final conjunta aprobó **57/57 unitarias + 239/239 integraciones PostgreSQL real + 74/74 E2E Chromium** (37 escritorio / 37 móvil): **370 casos definidos**, conservando los 348 anteriores. Salidas 0, sin omitidos; compilación, 30 laboratorios cerrados, SIGINT/puertos y reinicio aprobados. Logs privados finales: `.local/i7-final-all-2.log` y `.local/i7-final-web.log`. Los fallos previos no se contabilizan como aprobados.

CI y CodeQL: el estado exacto por commit/run/job se conserva en
[registro final de verificación del PR](https://github.com/pepoj1046-svg/proyecto-nexo/pull/3#issuecomment-6546058579). No se consideran aprobados mientras estén pendientes.
Las pruebas Windows son automatizadas en Actions; no se declara una sesión manual
ni una validación en vehículos reales. Node 22/24, laboratorio PostgreSQL 18.4;
escritorio 1440×1000 y móvil Chromium emulado 390×844.

| Dispositivo | proposal | express |
| --- | --- | --- |
| desktop | [proposal](capturas/etapa-3-incremento-7a-proposal-desktop.png) | [express](capturas/etapa-3-incremento-7a-express-desktop.png) |
| mobile | [proposal](capturas/etapa-3-incremento-7a-proposal-mobile.png) | [express](capturas/etapa-3-incremento-7a-express-mobile.png) |

## Errores encontrados y corregidos

1. La primera fixture aún tenía una unidad donde el grupo cabía entero. El sistema
   eligió correctamente mantenerlo junto; el test asumía una división. Se preparó
   una fixture opcional mediante reservas nativas para que la división fuera útil,
   y una unidad libre para el expreso. La fixture por defecto no se alteró.
2. Añadir campos a todas las cotizaciones rompió el consumidor estricto del reinicio.
   Se conservó el contrato anterior y se hizo explícita la solicitud de propuesta.
   No se relajó su validación ni se eliminó la prueba de reinicio.

Los intentos fallidos se conservan en `.local/i7a-web.log` y los logs dirigidos;
no se cuentan como aprobados ni se ocultan mediante reintentos automáticos.

## Prueba sencilla en Windows

En PowerShell, Node 22 o 24, dentro del repositorio y rama indicada:

```powershell
npm ci --no-fund
$env:NEXO_WEB_RECOVERY_SCENARIO = "DEFAULT"
$env:NEXO_WEB_JOURNEY_FIXTURE = "1"
Remove-Item Env:NEXO_WEB_ADMIN_FIXTURE -ErrorAction SilentlyContinue
npm run dev:web
```

Abrir únicamente la URL 127.0.0.1 indicada. Consultar el archivo de accesos con
`Get-Content -Raw "<archivo indicado>"`; no publicar las contraseñas efímeras.

1. Probar Yacuiba → Villa Montes y elegir Horizonte del Chaco. Seleccionar tres
   plazas en el desplegable y «Reservar con sesión» con `viajero4`.
2. «Revisar solicitud»: aparecen Trufi 1/2, dos y una plazas, total Bs 105. Sin ambos
   consentimientos y confirmación de recorrido no se habilita registrar.
3. Registrar: dos referencias pendientes del chofer. Mis reservas muestra el mismo
   grupo y sus partes. En otros perfiles, `driver0` y `driver1`, `/operador`, aceptan
   sus propias ofertas; aceptar solo una no confirma todo el grupo.
4. En otro perfil `viajero5`, elegir Unión del Sur, modalidad Expreso. Revisar:
   vehículo completo, tarifa expresa ficticia Bs 150, sin opción de división.
5. Confirmar y consultar Mis reservas. No se cobra ni se registra una salida.

La ventana de oferta sigue siendo dos minutos técnicos provisionales. Si vence,
consultar el estado y comenzar un laboratorio nuevo para repetir; no ampliar tiempos
ni confundir una oferta vencida con una confirmación.

```powershell
npm run test:web -- --suite=journey-modes.spec.mjs
npm run test:all
npm run test:web
```

Ctrl+C detiene el laboratorio. Para volver a la fixture habitual:
`Remove-Item Env:NEXO_WEB_JOURNEY_FIXTURE`.

## Pendientes

La confirmación coordinada de varios choferes, si se exige como transición atómica
adicional, requiere un contrato separado. Permanecen verificación legal de menores,
responsables presenciales/configuración de cuentas, correcciones/recuperación especial
y los procedimientos comerciales/legales indicados anteriormente. Solo laboratorio;
no se cierra toda la Etapa 3 ni se inicia el incremento 8.
