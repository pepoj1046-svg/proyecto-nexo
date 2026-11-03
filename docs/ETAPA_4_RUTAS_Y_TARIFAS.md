# Administración de rutas y tarifas — contrato 4A.5

Solo laboratorio ficticio. Base d2bc50b;001–038 inmutables. Publicación administrativa no acredita licencia, permiso de transporte ni seguridad física del recorrido.

## Autoridad y estados

ADMIN de asociación con alcance completo crea/edita/valida/publica topologías nuevas o nuevas versiones. Un ADMIN limitado consulta únicamente rutas concedidas y puede gestionar tarifas de esas rutas; no crea una ruta y se autoconcede el nuevo UUID. GENERAL_ADMIN conserva4A.3: sin membresía ADMIN propia no tiene estas facultades. REVIEWER, DRIVER y PASSENGER no publican configuración.

Borradores fuera del inventario: DRAFT → VALIDATED → PUBLISHED → RETIRED. Editar invalida validación. Publicar vuelve a validar contenido, dependencias y revisión esperada, bajo locks. Fallos estructurales e impedimentos operativos producen revisión auditada sin modificar el recurso nativo. No existe doble firma comercial aprobada; motivo y confirmación explícita son obligatorios para cada actuación.

## Topologías

Cada publicación crea un UUID nativo `routes` distinto, con puntos `stops` y perfiles `web_point_profiles` originales. La familia/parent es metadato; viajes, reservas, grupos y custodia conservan sus UUID anteriores. No se modifica la topología publicada, incluidos nombres, subida/bajada y perfiles. Nueva versión no retira automáticamente la anterior ni copia permisos VERIFIED.

OUT e IN se eligen explícitamente y son familias dirigidas independientes. No se invierten arrays para simular el regreso. Conectividad validada es estructural: índices consecutivos, mismo catálogo activo, extremos coincidentes, nombres técnicos no ambiguos, localidades sin regreso después de abandonarlas (sí admite varios puntos consecutivos de la misma ciudad). No promete distancia, transitabilidad o conexión vial verificada mediante GPS.

TERMINAL/URBAN/ROAD son explícitos. UNCLASSIFIED conserva la representación histórica, pero una nueva publicación con subida/bajada sin perfil queda bajo revisión. Puntos de paso sin subida/bajada pueden permanecer UNCLASSIFIED. Una ruta nueva con recogidas URBAN usa la localidad de origen y un único punto URBAN de inicio del trayecto principal después de las recogidas; otros casos requieren revisar el contrato operativo. No se infiere terminalidad de los extremos. Límites técnicos locales:64 puntos por versión y32KiB solo en el nuevo comando; no son reglas comerciales.

Retiro impide selección nueva por ambas puertas de elegibilidad nativas. Como esas puertas también protegen aceptación/recuperación, el retiro se bloquea mientras haya filas, servicios, reservas vivas, pasajeros físicos, incidencias, rescates o recepción pendientes. Se consulta `live` sin materializar expiraciones. Ante ambigüedad de custodia se bloquea conservadoramente por asociación. No se mueve, cancela o desembarca a nadie para retirar una ruta.

## Tres referencias de precio

1. Tarifa publicada para **solicitudes nuevas**: vista de selección sobre `fares`, con fin técnico de selección separado.
2. Cotización: precondición existente `{fareId,fareVersion,totalBOB}`; no es una reserva ni una entidad persistida de «cotización confirmada». Una clave nueva con cotización obsoleta recibe QUOTE_CHANGED; un replay autorizado conserva el recibo confirmado.
3. Precio pactado/histórico: `bookings.fare_id/fare_version/price_bob` y episodios existentes, sin modificación.

Publicar crea otra fila nativa `fares` con versión creciente por ruta/tramo/modalidad. No cambia importe, versión ni fechas originales de la fila anterior. Un reemplazo explícito acorta **solo la selección para nuevas solicitudes** mediante metadato monotónico; los lookups históricos por ID conservan las fechas originales y la recuperación no adquiere caducidad anticipada ni vigencia extra. La vista conserva las columnas/tipos del nativo, es `security_invoker` y respeta RLS; no es otro inventario.

Vigencias de selección `[inicio,fin)`. Solapamientos requieren predecesor explícito compatible y único; nunca se elige silenciosamente entre varias tarifas ambiguas. Retirar una tarifa futura puede dejar selección vacía, sin construir rangos invertidos ni reactivarla al expirar otra. Sin tarifa posterior no se inventa precio ni se restaura una tarifa retirada. Inicio nulo significa instante efectivo de publicación; fechas explícitas deben estar en futuro al publicar. Fin opcional posterior al inicio. Valores monetarios con dos decimales, sin redondeo implícito, >=0 conforme al contrato previo. Ordinaria por plaza; expresa por vehículo completo/seis plazas técnicas, sin multiplicar por seis la tarifa expresa.

El cambio tarifario heredado desde condiciones de ruta delega en la misma primitiva de nueva fila/selección; su auditoría debe guardar el UUID nuevo. No quedan dos caminos de precio que muten historia. El directorio diferencia la ventana de selección nueva de la validez original; el contexto del pasajero separa precio pactado del publicado actual.

## Consistencia y permisos

READ COMMITTED, intención idempotente antes de ámbito/mutex, adquisición administrativa no bloqueante y rutas UUID en orden/NOWAIT, autoridad estabilizada después de esperas, revisión con eventos inmutables para ABA y recibos reautorizados. DML de configuración, nativos, auditoría y recibo confirman o revierten juntos. Helpers privados, RLS y RPC cerradas, SQL parametrizado, ningún owner/provisioner por HTTP. El borde RLS histórico de `routes.id` recibe restricción explícita para ADMIN limitado.

Listados e historia paginados >50, cursor vinculado a sesión/asociación/filtro/tamaño/permisos/contenido. Se conservan cuerpo/clave ante POST incierto o refresco HTTP fallido tras commit; se bloquea la navegación que desmontaría la intención. No se promete persistencia de esa clave tras cerrar/recargar completamente el navegador.

## Límites y decisiones

Sin autorización comercial/legal automática, pagos, devoluciones, GPS, notificaciones o nuevos viajes. Verificación física de recorridos, permisos reales, documentos, retención, doble firma y reglas comerciales quedan al comprador. Las publicaciones técnicamente válidas sin autorización nativa seguirán fuera de búsquedas vendibles. No se reconstruye historia de precios anterior a039 que ya hubiera sido sobrescrita por procedimientos antiguos.

Los informes anteriores llaman555 «casos únicos» contando60 E2E en dos dispositivos. Se conservan esas555 ejecuciones de referencia; el informe nuevo separará definiciones lógicas (495 anteriores) de ejecuciones por dispositivo y no contará las plataformas como escenarios nuevos.

## Prueba sencilla en Windows

Requiere Node22 o24, Git y PowerShell. Trabaja en una copia de `desarrollo/etapa-4`; nunca apuntes `DATABASE_URL` a otra base. El lanzador crea su propio PostgreSQL temporal, roles, claves y usuarios ficticios, escucha en loopback y los cierra al terminar.

```powershell
npm ci --no-fund
npx --no-install playwright install chromium
npm run dev:web
```

Abre únicamente la URL `http://127.0.0.1:...` que imprime el lanzador. Lee las credenciales ficticias en el archivo privado que indica; no las copies al repositorio. Inicia sesión con ADMIN y entra en Administración → Directorio administrativo → Consultar asociación → Gestionar rutas y tarifas → Consultar configuración actual.

1. Prepara una ruta dirigida nueva. Elige OUT o IN explícitamente, localidades de origen/destino y perfil TERMINAL de cada extremo. Para puntos intermedios, configura localidad, orden, perfil y subida/bajada según el contrato. Una ruta intramunicipal o un perfil ambiguo permanece bajo revisión.
2. Introduce motivo y marca confirmación. Guarda el borrador, vuelve a confirmar para validar y vuelve a confirmar para publicar. Los cambios sin guardar bloquean validación/publicación. La publicación crea otro UUID: **no** crea un viaje ni concede permiso de transporte, por lo que puede permanecer fuera de la búsqueda.
3. Para una tarifa, consulta una ruta existente desde Rutas y sentidos → Configurar ruta. En tarifas publicadas elige el predecesor compatible; prepara el importe ordinario/expreso y tramo. Las fechas del formulario son **UTC**, aunque los resúmenes se muestran en America/La_Paz. Guarda, valida y publica con motivo/confirmación en cada paso.
4. Comprueba versión, nueva selección e historial. Una reserva anterior conserva UUID, importe y contrato de tarifa original; retirar una tarifa solo impide seleccionarla para nuevas solicitudes. No hay cobros ni devoluciones.
5. Repite en ventana estrecha. Un error de red después del envío conserva «Reintentar la misma configuración». Reintenta desde ese botón; no cierres ni recargues el navegador mientras la intención sea incierta. Una revisión obsoleta exige consultar y confirmar una intención nueva.

Para terminar usa Ctrl+C y espera el cierre de HTTP/PostgreSQL. Para repetir automáticamente los flujos nuevos en ambos dispositivos:

```powershell
node scripts/test-web.mjs --suite=route-config-topology.spec.mjs,route-config-fares.spec.mjs,route-config-races.spec.mjs,route-config-permissions.spec.mjs
```

Verificación completa: `npm run test:all` y después `npm run test:web`. No se requiere instalar un servidor PostgreSQL del sistema ni contratar servicios. En Windows el cierre automatizado utiliza IPC; en Ubuntu se verifica también SIGINT real.


### Chromium automatizado en Windows

El runner aplica una mitigación específica de [Playwright43545](https://github.com/microsoft/playwright/issues/43545) para el error intermitente Winsock10055/`ERR_NO_BUFFER_SPACE`. Desactiva `TcpPortRandomizationWin` solamente en el navegador automatizado Windows; conserva todos los flags predeterminados descubiertos por CDP y cierra el probe vacío antes de las pruebas. No requiere añadir flags manualmente, cambiar el navegador personal, ampliar límites ni activar retries. Otros sistemas y el gateway de la aplicación conservan su configuración. La validación de esa mitigación y sus límites se ratifican en el PR sobre el mismo SHA final.
