# Implementación local de Etapa 1

Fecha de validación: 25 de octubre de 2026, hora de Bolivia. Todo dato es ficticio.
Fuente comercial: `REQUISITOS_INICIALES.md`; no se activan despliegues ni servicios.

## Migraciones

Se eligió un runner SQL pequeño sobre `pg`: `scripts/migrate.mjs`.
`public.nexo_migrations` registra nombre, SHA-256 y fecha. Un advisory lock de sesión
serializa migradores y cada archivo se aplica con su registro en una transacción.
Una segunda ejecución no repite DDL; modificar un archivo aplicado falla por checksum.
Una migración fallida no deja tabla parcial ni registro aplicado. Las correcciones
posteriores a esta entrega deberán agregarse como nuevas migraciones.

1. `001_core.sql`: esquema `nexo`, sesiones, membresías, catálogos, viajes/fila,
   tarifas, reservas, acciones, auditoría, claves compuestas y RLS.
2. `002_operations.sql`: reservas, aceptación/rechazo, cancelación, salida y progreso.
3. `003_queue.sql`: solicitud de ingreso a fila de destino y auditoría inmutable.

No hay migración automática desde una base con el DDL conceptual anterior ni `down`
destructivo. El alcance reproducible es una base local vacía de este repositorio.
PostgreSQL validado: 18.4. No se afirma compatibilidad probada con otras versiones.

## Modelo operativo implementado

`trips` representa una unidad de servicio en fila, con vehículo, chofer habilitado,
ruta versionada y posición. La dirección pertenece a la ruta. Índices parciales
impiden dos servicios activos por vehículo o por chofer, incluso entre asociaciones.
La pertenencia del conductor se vuelve a verificar en cada operación.

Las relaciones de viajes con vehículos/rutas/membresías, y de reservas con viajes,
paradas y tarifas, incluyen asociación en las claves foráneas. `bookings.source`
unifica presenciales y digitales en el mismo inventario; `WALK_IN` exige administrador
activo de esa asociación. El pasajero digital solo reserva para su propia identidad.

Una reserva se propone al primer vehículo compatible y mantiene plazas `HELD`.
La retención técnica del prototipo es de 120 segundos. El chofer correspondiente
acepta o rechaza. Las retenciones vencidas dejan de consumir inventario por el reloj
de PostgreSQL y pasan a `EXPIRED` con auditoría en la próxima operación de la ruta;
no existe un cron remoto. El plazo definitivo de ofertas requiere revisión funcional.

Una ruta se bloquea `FOR UPDATE` antes de leer inventario; todas las mutaciones de
reservas y despacho siguen el mismo protocolo. Aislamiento `READ COMMITTED` y funciones
volátiles permiten ver el resultado del escritor anterior después de esperar el lock.
Además se bloquea el viaje afectado. Se comprueba cada segmento `[from,to)` con
reservas confirmadas y retenciones vigentes. Nunca se cuenta solo un total editable.
Este bloqueo amplio favorece claridad en el piloto y limita el rendimiento por ruta;
optimizar por segmento queda para después de medir cargas.

La tarifa vigente debe ser **única** para ruta, segmentos y modalidad; si falta o hay
ambigüedad, no se reserva. Precio pactado y versión se copian a la reserva: tarifa
ordinaria por plaza, expreso como importe total del vehículo de seis plazas. No hay
cobro, conciliación ni estado de pago bancario en este esquema operativo.

## Grupos, idempotencia y despacho

Por defecto se conserva al grupo de 1–6 plazas en un solo vehículo. Una partición
requiere `splitConsent: true`, al menos tres pasajeros, declaración explícita
`containsMinors: false` y bloques de suma exacta. No se admite dividir expresos ni
solicitudes declaradas con menores. Falta el modelo verificado de vínculos entre
menores/responsables; **no habilitar particiones con menores** en un producto real.

Los bloques se retienen en una sola transacción: si falla el último, se revierten
todos, junto con auditoría y clave de acción. La confirmación de todo el grupo se
produce solo cuando todos los choferes aceptan. El rechazo/cancelación libera el
grupo completo. Incluso las propuestas explícitas de bloques deben respetar el
primer compatible de la fila, excluyendo los vehículos ya asignados a ese grupo.

`(actor_id, action_key)` protege cada acción con un advisory lock transaccional y
compara el payload normalizado JSONB. Mismo actor/clave/payload devuelve el resultado
original; payload distinto falla. Reservas, aceptaciones, salidas y retorno a fila
no duplican efectos ante reintentos concurrentes. Si un error revierte la transacción,
el mismo intento puede repetirse con la misma clave.

La salida la registra exclusivamente el chofer del servicio. Debe haber al menos
seis plazas confirmadas en el manifiesto, incluidas recogidas posteriores; ninguna
oferta sin aceptar. La capacidad sigue comprobada por segmento. Así se permite salir
hacia recogidas confirmadas sin exigir seis personas en el primer segmento.
Esta interpretación del manifiesto queda explícita para revisión funcional; no se
automatizan las ausencias de 10+5 minutos ni sanciones.

Un vehículo lleno puede salir antes que otro incompleto sin modificar las posiciones
restantes. Tras llegada, `requestQueue` exige al chofer solicitar el retorno, verifica
que el origen de la nueva ruta sea el destino anterior y la misma asociación, y lo
inserta al final bajo lock. No se incorpora automáticamente ni se cruza a otra
asociación aunque el chofer tenga dos membresías.

## Límites del incremento

No hay API HTTP, login público, recuperación de cuentas, interfaz, mapas/GPS, eventos
individuales de abordaje, política de no presentación, tesorería ni automatización de
licencias. El progreso del vehículo no acredita por sí solo que un pasajero abordó.
`COMPLETED` indica cierre operativo al llegar; no certifica pagos ni presencia.
Los catálogos/altas y sesiones se provisionan por adaptador confiable de pruebas;
falta su flujo administrativo autenticado. Ver `SEGURIDAD_PENDIENTE.md`.

Referencias técnicas usadas para el diseño:
[RLS](https://www.postgresql.org/docs/18/ddl-rowsecurity.html),
[aislamiento](https://www.postgresql.org/docs/18/transaction-iso.html),
[SECURITY DEFINER](https://www.postgresql.org/docs/18/sql-createfunction.html).
