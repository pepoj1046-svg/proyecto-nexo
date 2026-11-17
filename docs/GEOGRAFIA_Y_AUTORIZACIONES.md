# Geografía nacional, habilitaciones y búsqueda — Etapa 1

Backend local, sin pantallas, mapas, GPS, pagos ni despliegue. No se carga ni simula
como oficial un catálogo nacional: todos los fixtures se rotulan como **ficticios**.

## Jerarquía y versiones

geo_catalogs identifica versión, fuente, naturaleza SYNTHETIC/VERIFIED y estado
DRAFT/ACTIVE/RETIRED. departments → provinces → municipalities → localities.
Claves compuestas (catalog_id,id) impiden mezclar versiones o padres de otra versión.
Rutas y paradas enlazan localidades del mismo catálogo y asociación.
Los índices de paradas deben ser consecutivos desde cero y su total coincidir con
stop_count. Los extremos deben coincidir con las localidades de la ruta.
Un índice fuera de rango se rechaza al escribir.

Una topología usada o autorizada no se reescribe: se crea otra versión/ruta.
Hay una excepción controlada para completar una sola vez metadatos geográficos NULL
anteriores, sin cambiar dirección, versión, cantidad o índices de paradas y antes
de registrar permisos. No se adivinan ubicaciones. Cerrar puntos con boarding_allowed
o alighting_allowed no cambia la topología.
Las filas geográficas ya referenciadas no se actualizan ni eliminan: las correcciones
administrativas se registran en una nueva versión del catálogo.

Clasificación interna:
- Departamentos distintos: INTERDEPARTAMENTAL.
- Mismo departamento, provincias distintas: INTERPROVINCIAL.
- Misma provincia, municipios distintos: INTERMUNICIPAL.

Para localidades del mismo municipio no se inventa una cuarta categoría: la clasificación
del tramo es NULL. Puede encontrarse un tramo local con tarifa y paradas permitidas
dentro de una ruta de las tres categorías habilitadas; el resultado conserva la
categoría de esa ruta. Rutas completas intramunicipales requieren decisión posterior.

No se clasifica Yacuiba–Villa Montes por nombre o constante. La revisión del PR indica
que son municipios de Gran Chaco; una futura carga oficial deberá resolverlo mediante
referencias verificadas. Esta entrega solo contiene fixtures sintéticos.

## Cuatro comprobaciones independientes

1. associations.adherence_status=ADHERED: incorporación a la plataforma.
2. associations.operating_status=OPERATING: situación operativa.
3. associations.status=ACTIVE: interruptor comercial/de visibilidad existente,
   conservado por compatibilidad. No es un permiso de transporte ni un sistema
   de contratos, cobros, gracia o verificación bancaria.
4. route_authorizations: al menos un permiso VERIFIED, vigente, de esa asociación
   y de esa versión de ruta.

Un permiso no levanta una suspensión comercial u operativa. Una licencia comercial
activa no sustituye la autorización del transporte. Estados iniciales sin configuración
y ausencia de permiso deniegan nuevas reservas.

submitAuthorization permite al administrador de su asociación solicitar estado PENDING
con emisor, referencia y período de validez; no verifica documentos por sí sola.
reviewAuthorization exige una identidad incorporada por un provisionador confiable
en operation_reviewers. El rol de aplicación no puede editar esa tabla ni otorgarse
privilegios. Un administrador no puede aprobarse un permiso.

Transiciones: PENDING → VERIFIED/REJECTED; VERIFIED → REVOKED. Se exige motivo de revisión.
Los detalles no se editan: una renovación es otro registro. authorization_events
registra actor, estado anterior/nuevo, motivo y hora de forma inmutable.
Un reintento idempotente no duplica el evento.
La verificación documental administrativa real sigue pendiente.

## Contrato de búsqueda

El futuro selector de lugares resolverá nombres a IDs de localidades del catálogo
activo, desambiguando manualmente. No hay geocodificador ni selección por proximidad.

    service.search(token, { originLocalityId, destinationLocalityId })

Opciones posteriores: seats (1–6, por defecto 1) y express (false por defecto,
expreso exige 6). Este contrato rechaza categoría e ID de asociación como filtros.
Respuesta:
- status: FOUND o NO_DIRECT_SERVICE.
- coverage: clasificación del tramo solicitado; NULL para tramo local.
- results: asociación, ruta/versión, categoría de ruta, índices y nombres de subida/
  bajada, disponibilidad por segmentos, tarifa/versión, total y moneda BOB.

Solo se devuelven servicios existentes en fila, con chofer activo, plazas, tarifa
vigente única y puntos habilitados. No se fabrican viajes ni conexiones.
Una localidad repetida puede dar varios pares válidos de paradas: los índices y
nombres permiten elegir un embarque sin deduplicar ni inventar puntos.
No se devuelven chofer, vehículo, posición privada, tokens ni metadatos del permiso.
La búsqueda es informativa: la reserva vuelve a validar dentro de una transacción;
la consulta no retiene plazas ni garantiza un precio futuro.

## Consistencia y RLS

reserve agrega la puerta de elegibilidad y delega en reserve_inventory, el núcleo
previo renombrado cuyo permiso de ejecución se revoca al rol de aplicación.
Un trigger comprueba además altas y promociones HELD → CONFIRMED.
No se puede eludir la puerta llamando al antiguo inventario directamente.

Se conservan READ COMMITTED, bloqueo por ruta, seis plazas por segmento, grupos
atómicos, idempotencia y aceptación. Los permisos se modifican bajo el mismo lock de
ruta. La asociación y el catálogo se bloquean FOR SHARE. Una suspensión o revocación
confirmada antes de que la reserva obtenga los locks impide que ésta prospere.
Si la reserva obtiene los bloqueos primero, se ordena antes del cambio.
No se cancelan reservas previas automáticamente al revocar permisos; falta acordar
esa política. Los viajes iniciados pueden terminar y el historial se conserva.

Búsqueda y reservas comparten el predicado de elegibilidad.
La lectura de catálogos queda acotada:
- Geografía activa: compartida por usuarios autenticados.
- Rutas/paradas disponibles y tarifas vigentes: rutas elegibles.
- Administrador: sus operaciones/permisos; chofer: sus servicios.
- Pasajero: contexto de sus reservas históricas aun si la ruta deja de anunciarse.
- Permisos, referencias y motivos: administrador de esa asociación o revisor confiable.

Las funciones usan SECURITY DEFINER, nombres cualificados y search_path fijo.
Los helpers no se habilitan como RPC públicas. El propietario de migraciones sigue
siendo privilegiado y no debe emplearse como conexión de aplicación.

## Migración y alcance comercial

001–004 conservan bytes/checksums. 005 agrega entidades y relaciones; 006 implementa
clasificación, permisos y búsqueda; 007 instala puertas de reserva, RLS y retorno
a fila mediante localidades en lugar de códigos libres.
No hay backfill automático ni permisos otorgados automáticamente.
La prueba de actualización parte de 001–004 con dos plazas confirmadas: conserva
datos, completa metadatos bajo control confiable, registra un permiso ficticio,
vende las cuatro restantes y permite salida/llegada. Sin configuración, las rutas
antiguas quedan fuera de nuevas ofertas.

El lanzamiento intermunicipal → interprovincial → interdepartamental es progresivo.
Admitir las tres categorías no habilita automáticamente operadores ni rutas.
Antes de una demo comercial faltan catálogo verificable, permisos reales comprobados,
autenticación pública, procesos administrativos y decisiones funcionales pendientes.
No se ha avanzado a Etapa 2.
