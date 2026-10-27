# Trufis Bolivia — Etapa 3, incremento 1

26/10/2026, America/La_Paz. Repositorio exclusivo `pepoj1046-svg/proyecto-nexo`.
Rama `desarrollo/etapa-3`, creada desde **`820fd1f0ff5bce260cfaee7e5bfa1e8ccf4f2060`**
de `desarrollo/etapa-2`, comprobado contra GitHub antes de editar. Árbol inicial limpio.
La autorización de este incremento sustituye la prohibición histórica de iniciar
Etapa 3 en AGENTS; no autoriza el incremento 2 ni un despliegue.

## 1. Preparación y decisiones técnicas

Se leyeron AGENTS, requisitos, arquitectura/modelo, seguridad, pruebas de Etapa 1,
contratos actuales y cierre técnico de Etapa 2. Revisada la
[revisión favorable de ChatGPT](https://github.com/pepoj1046-svg/proyecto-nexo/pull/2#issuecomment-6431099568).
Migraciones **001–022 intactas**, sin necesidad de 023. Main y ramas/PR anteriores
se conservan. PR de este incremento hacia `desarrollo/etapa-2`, sin fusionar.

Interfaz **React 19.3.1 + TypeScript 5.9.3**, compilada con **esbuild 0.28.2**,
sin SSR ni Next.js: no hacen falta un segundo servidor de framework ni cambios en
los contratos para esta primera superficie local. Dependencias exactas y lockfile.
Se mantienen Node **22.x/24.x**, mínimo declarado **22.0.0**; Playwright necesita
>=20 y esbuild >=18. Se fijó axe-core/playwright **4.11.1** para conservar ese mínimo,
en lugar de introducir su versión nueva que exige Node >=22.12. No se afirma haber
probado cada versión menor de esas familias.

No hay CDN, fuentes descargadas al abrir la app, imágenes remotas, mapas, OAuth,
pagos, GPS ni proveedores externos. Iconos/ilustración son SVG locales. Diseño en
español, contraste ajustado, foco visible, enlace para saltar al contenido, navegación
por teclado, objetivos táctiles de 44px y movimiento reducido.

## 2. Pantallas y rutas

| Ruta | Implementado | Tipo de operación |
|---|---|---|
| `/` | Origen/destino, sugerencias por nombre con municipio/provincia/departamento, intercambio, recorrido de ejemplo, agrupación por asociación, estado de ruta, fila, tarifa y plazas por segmento | Consultas al backend PostgreSQL existente |
| `/reservar` | Viaje elegido, 1–6 plazas según cupo, importe total informativo, revisión de disponibilidad y resumen claramente demostrativo | Lectura actualizada; **no crea reserva, retención ni pago** |
| `/pasajero` | Estructura de Mis reservas, vehículo, historial y Ya llegué | Pendiente de conexión; no botones que ejecuten operaciones ficticias |
| `/administracion` | Estructura de asociaciones, filas/reservas, llegadas/abordajes e incidencias | Sesión requerida; datos/acciones privados no expuestos |
| `/chofer` | Estructura de asignados, recogidas, pasajeros esperados, progreso/salida | Sesión requerida; datos/acciones privados no expuestos |

La búsqueda no pide categoría administrativa ni ofrece productos exclusivamente
urbanos: se reutiliza elegibilidad del recorrido completo de Etapa 2. Se permiten
paradas locales de rutas habilitadas entre localidades. La agrupación visual coloca
primero asociaciones con plazas y ordena por nombre; **no altera la fila ni asigna
reservas**. Dentro de cada asociación se conserva el orden devuelto por el backend.

Los seis iconos representan capacidad, no asientos numerados. El resumen indica
confirmadas máximas **por tramo** y cupo mínimo para todo el recorrido. El detalle
muestra confirmadas, retenidas y libres de cada segmento; una retención también
consume inventario. Plazas sin habilitación se dibujan bloqueadas, no como libres
vendibles. No se suman plazas disjuntas como si estuvieran libres durante
todo el viaje ni se promete una hora exacta de salida.

NORMAL, DESVIO y SUSPENDIDA tienen texto propio, además de color. Suspensión mantiene
asociación/contacto de prueba visibles con selección deshabilitada. Un vehículo
IN_TRANSIT solo aparece si aún no pasó el punto solicitado y el backend permite
operaciones. Terminales vienen de las paradas consultables; cuando no hay nombre
visible se muestra «Punto autorizado N». El esquema no dispone de referencia de
ubicación: se indica no registrada, sin inventar direcciones, coordenadas o mapas.

Hay estados de consulta pendiente, falta de rutas, falta de coincidencias, fallo,
reintento y respuesta lenta. Cambiar localidad invalida resultados y selección de IDs
anteriores; se cancelan solicitudes obsoletas. El resumen demostrativo reconsulta
el cupo antes de mostrarse y se bloquea si dejó de alcanzar. Se pierde al recargar;
no se escribe una reserva o confirmación en localStorage/sessionStorage/cookies.

## 3. Integración, datos y seguridad

```text
Navegador React/TS
    → gateway web en 127.0.0.1 (HTML/JS/CSS + API de lectura del mismo origen)
    → createService / createBusinessService / pool nexo_app
    → las mismas migraciones, RLS y funciones PostgreSQL de Etapas 1–2
```

No base de negocio paralela ni inventario JSON. `scripts/test-postgres.mjs` reutiliza
su ciclo de clúster efímero, migración, `pg_ctl` y cierre. `--serve-web` llama a un
launcher separado del HTTP de línea de comandos. Los listeners originales conservan
sus contratos/restricciones y sus pruebas; no se les añadió CORS ni se publicaron.

Antes de escuchar se instalan fixtures en ese mismo esquema: asociaciones ficticias,
Yacuiba/Villa Montes y puntos de prueba, homónimos San José, tres estados, reservas
confirmadas por tramo y un vehículo en recorrido con recogida futura. Reservas,
aceptación, cancelación de relleno, salida/progreso, movimientos, venta en ruta y
condiciones se crean mediante el núcleo existente. Setup/propietario se cierra
**antes** de aceptar solicitudes web. El servidor web solo recibe `nexo_app`.

El catálogo de fixture usa el marcador técnico VERIFIED que exige el contrato de
sugerencias existente, con nombre/fuente explícitos **«LABORATORIO FICTICIO — no
oficial»**. No acredita una fuente ni permiso real. No se importaron personas,
licencias, pagos, GPS o asociaciones reales. Todos los roles, sesiones y permisos
son técnicos y efímeros. El lector de catálogo es un usuario sin membresías ni
reservas, con sesión sintética solo en servidor; no es una sesión de visitante ni
se puede usar para acceder a paneles/escrituras. Caduca en una hora; reiniciar el
laboratorio renueva la fixture. No se activa un proveedor de identidad público.

| API web | Contrato |
|---|---|
| POST `/api/localities` | `query`, `limit` opcional; reutiliza suggest_localities y su validación/jerarquía |
| POST `/api/availability` | origen/destino UUID; proyección pública de capacidad y nombres de paradas permitidos por RLS |
| GET `/api/session` | Declara interfaz sin autenticación conectada, modo laboratorio y escrituras deshabilitadas |
| `/api/admin/*`, `/api/passenger/*`, `/api/driver/*` | **401**: no interfaz privada conectada; un rol enviado por cliente no autoriza |
| Cualquier otro endpoint | No expuesto; no proxy SQL, login, token, provisión o escritura de negocio |

El HTML de los paneles es una estructura demostrativa pública sin datos. Las rutas
de API privadas están bloqueadas en el servidor, independientemente del navegador.
No es suficiente ocultar controles en React. La autenticación web de pasajero y
operadores se deja explícitamente pendiente, como permite el encargo; no se
inventan cuentas o confirmaciones desde el navegador.

Gateway: IP/Host exactos de loopback, POST JSON desde mismo origen, rechazo de
orígenes/forwarded-host externos y credenciales inesperadas; límites de cuerpo,
encabezados, conexiones, concurrencia y consultas. CSP sin scripts inline ni
conexiones externas, sin CORS, no-store, nosniff, política sin GPS/cámara/micrófono y
errores sanitizados. No se envían pools, conexiones PostgreSQL, tokens de catálogo,
credenciales privilegiadas ni campos privados al bundle o a consultas públicas.
La autoridad de negocio continúa en PostgreSQL; este incremento no añade escrituras
web ni interpreta el resumen local como reserva confirmada.

## 4. Archivos principales

| Archivos | Cambio |
|---|---|
| apps/web/index.html, tsconfig.json, src/main.tsx, LocalityField.tsx, icons.tsx, model.ts, api.ts, styles.css | Interfaz, navegación, sugerencias, selección demostrativa, componentes y estilos adaptables |
| src/db/web-catalog-service.mjs | Fachada de lectura sobre servicios existentes y nombres de paradas bajo RLS |
| src/http/web-gateway.mjs | HTML/assets y lista cerrada de API del mismo origen, loopback y seguridad |
| scripts/build-web.mjs, web-demo.mjs, seed-web-demo.mjs, test-web.mjs, verify-web-stop.mjs | Compilación, fixture, launcher y pruebas de navegador/cierre |
| scripts/test-postgres.mjs | Modo --serve-web dentro del ciclo local existente, sin cambiar modos anteriores |
| tests/web-model.test.mjs, integration/postgres.test.mjs, web/app.spec.mjs, playwright.config.mjs | Unitarias, PostgreSQL/HTTP y navegador en dos tamaños; checksums de 001–022 |
| package.json/lockfile, .gitignore, workflow, AGENTS, README/arquitectura e informe | Dependencias exactas, comandos, CI y alcance autorizado |
| docs/REPORTES/capturas/etapa-3-busqueda-*.png | Capturas reales de Chromium con datos ficticios, sin credenciales |

## 5. Ejecución y visualización local

Requisitos: Node 22.x o 24.x, npm y usuario no root en Linux. No hace falta instalar
PostgreSQL ni Docker. Desde el repositorio y la rama `desarrollo/etapa-3`:

```sh
npm ci --no-fund
npm run dev:web
```

El terminal muestra `Trufis Bolivia web local: http://127.0.0.1:<puerto>`.
Copiar esa dirección en el navegador **del mismo equipo**. Pulsar «Probar Yacuiba →
Villa Montes» o escribir localidades y elegir sugerencias. Usar el modo de dispositivo
del navegador para probar móvil; no se habilita acceso LAN desde un teléfono externo.
La UI y su API comparten ese puerto. Los puertos/credenciales de PostgreSQL no se
entregan al navegador. `HOST`, `PORT` y `DATABASE_URL` externos no se usan.

Ctrl+C cierra HTTP, pool y PostgreSQL. Cada arranque crea un laboratorio nuevo;
no es persistencia ni despliegue. Los diagnósticos/bundles se mantienen ignorados
por Git. Para cambios de interfaz volver a ejecutar dev:web; no HMR en este incremento.

```sh
npm test                 # unitarias, incluido modelo de interfaz
npm run test:all         # tipo/build, unitarias, PostgreSQL, runner y smoke anteriores
npx --no-install playwright install chromium  # navegador gratuito de pruebas, si hace falta
npm run test:web         # 14 casos × escritorio/móvil, cada proyecto con clúster fresco
```

En este Linux se utilizó Chromium instalado en `/usr/bin/chromium`; si no existe,
se usa el Chromium de Playwright. GitHub Actions lo instala explícitamente. No se
usan URLs remotas de pruebas. Las capturas/trazas de ejecución están en `.local/`.

## 6. Pruebas y resultados reales

Local: Linux x64, Node **24.19.0**, npm **11.9.0**, PostgreSQL **18.4 real**,
Chromium **154.0.8037.57**. TypeScript sin errores. Se mantienen las 210 pruebas
previas: **36 unitarias** (33+3) y **181 integraciones** (177+4), todas aprobadas.
Navegador: **14/14 escritorio y 14/14 móvil**, sin reintentos; total **245 pruebas**.
Los runners registran cierre de listeners y PostgreSQL en ambos proyectos.

```text
npm run test:all
  unitarias:                    36/36
  PostgreSQL real + HTTP:       181/181
  omitidas/canceladas/fallos:    0
  runner: salida intencional 9 propagada; PostgreSQL detenido
  smoke previo: identidad/negocio separados; HTTP/PostgreSQL detenidos
exit: 0
npm run test:web
  desktop:                     14/14
  mobile:                      14/14
  axe WCAG A/AA:                0 infracciones detectadas en resultados/panel
  listeners y PostgreSQL:       detenidos al terminar
  cierre adicional:             SIGINT real, puertos HTTP/PostgreSQL cerrados
exit: 0
git diff --check
exit: 0
```

- Unitarias: agrupación sin mezclar filas, mínimo de capacidad de todos los tramos,
  retenciones, prohibiciones del servidor e importes con céntimos enteros.
- V01–V04: API/SQL reales, disponibilidad/terminal, campos públicos sin token/ID de
  pasajero/reserva, estados suspendidos, origen pasado, RLS, roles privilegiados
  rechazados, origen/Host/credenciales/cuerpos/escrituras indebidos, límites/errores.
- Navegador: búsqueda y homónimos/teclado, tres estados, tramos disjuntos, vacío,
  selección/importe demostrativo, recarga sin persistencia, navegación/enlaces
  profundos y APIs privadas 401; móvil/escritorio/320px sin desbordamiento; fallos,
  reintento, respuesta lenta, cancelación de consultas obsoletas y cupo cambiado.
- Las respuestas lentas, fallos de red y cambio de cupo se simulan en el transporte
  del test de navegador; los resultados ordinarios y V01–V04 usan PostgreSQL real.
  No se presenta esa simulación como prueba de concurrencia SQL; las regresiones
  anteriores sí conservan sus carreras de reservas/filas/roles.
- Comprobación de recursos sin peticiones externas; análisis axe-core 4.11.1 en
  WCAG2A/AA/2.1AA y comprobación de foco/teclado. No certificación WCAG completa ni
  prueba con tecnologías asistivas/dispositivos físicos de usuarios.
- G12 amplía SHA-256 fijo de 001–017 a **001–022**. Siguen aprobando todas las
  actualizaciones pobladas previas y su registro de 22 migraciones, sin nueva DDL.

**CI Ubuntu/Windows × Node22/24 pendiente de publicar/verificar este commit.**
No se atribuye aprobación a una ejecución no completada.

## 7. Capturas y problemas corregidos

Capturas del navegador real, no diseños estáticos; representan una fixture de prueba,
no servicios ni disponibilidad vigentes:

- [Búsqueda en escritorio](capturas/etapa-3-busqueda-escritorio.png).
- [Búsqueda en móvil](capturas/etapa-3-busqueda-movil.png).

En las primeras verificaciones:

1. axe detectó contraste insuficiente en metadatos; se oscurecieron textos y se
   mejoraron tamaños/objetivos táctiles. La pasada final no detectó infracciones
   en las páginas analizadas. No se desactivaron reglas para pasar la prueba.
2. La selección por «primer botón» del test dependía del UUID aleatorio de asociación
   de la fixture y comprobaba el límite de otro vehículo. Se selecciona explícitamente
   Horizonte; se conserva la aserción del límite. El orden visual es estable por
   disponibilidad/nombre, sin cambiar el orden de la cola ni asignar un vehículo.
3. Se comprobó que editar una localidad elegida no borrara el texto nuevo al invalidar
   el ID, y que una respuesta tardía no repusiera el resultado antiguo.
4. La versión más reciente del analizador de accesibilidad exigía Node >=22.12;
   se fijó una versión compatible para conservar el mínimo existente de Node22.0.
5. Al cerrar la vista previa con SIGINT se reprodujo una carrera del hook de
   embedded-postgres: podía salir Node con 130 antes del finally y dejar el clúster
   de pg_ctl abierto. Se detuvo ese clúster ficticio y el runner asume SIGINT/SIGTERM
   en modos serve, también durante arranque. Se añadió smoke que verifica cierre
   del puerto HTTP y PostgreSQL: SIGINT real en Linux/Ubuntu, IPC en Windows.
6. El caché npm del entorno apuntaba a una ruta no disponible; se utilizó un caché
   dentro de `.local/` sin alterar la configuración global ni solicitar servicios.

## 8. Limitaciones y próximos pasos

**Incremento 1 ejecutable y verificable en laboratorio. No listo para producción.**
No se declara terminada la Etapa 3 ni se inicia el incremento 2.

Pendientes expresos para un incremento posterior autorizado:

- Autenticación del navegador y gestión segura de sesión/roles. Sin Google OAuth real,
  ni login improvisado, ni tokens privilegiados en navegador.
- Registro autenticado de reservas, Ya llegué, filas/abordajes/incidencias y progreso
  desde sus paneles, manteniendo los contratos y autorizaciones ya probados.
- Referencias oficiales de terminales y verificación humana de permisos, datos,
  menores y condiciones reales; no se inventan a partir de puntos/mapas ficticios.
- Evaluación manual de accesibilidad, navegadores Firefox/Safari/dispositivos físicos,
  carga, TLS, despliegue y privacidad/retención. Solo Chromium emulado está probado aquí.

Las consultas son instantáneas, sin garantía de cupo/salida; error de red elimina
resultados obsoletos en lugar de fingir disponibilidad. La sesión técnica de catálogo
caduca y se renueva reiniciando el laboratorio, no con credenciales públicas. Límites
de abuso son locales, no perímetro de producción. La UI privada es estructura segura
pendiente, no un panel operativo. Sin dinero, GPS, datos personales, proveedores,
mensajes reales, gastos, merge o cierre de PRs anteriores.
