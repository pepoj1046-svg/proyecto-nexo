# Etapa 2 — Incremento 2: pasajeros, ofertas y despacho

26/10/2026, UTC. Repositorio `pepoj1046-svg/proyecto-nexo`, rama exclusiva
`desarrollo/etapa-2`. Punto inicial verificado: **2bb9c2eb598dcf1ace341fa5749139307a0839ab**.
Se leyeron AGENTS, contratos, decisiones pendientes, reporte del incremento 1 y
[última revisión de ChatGPT](https://github.com/pepoj1046-svg/proyecto-nexo/pull/2#issuecomment-6423573898).
[PR #2](https://github.com/pepoj1046-svg/proyecto-nexo/pull/2) conserva base
`desarrollo/etapa-1`. PR #1 y main no se modifican ni fusionan.

## Funcionalidades y archivos

| Archivos | Resultado |
|---|---|
| database/migrations/013_individual_operations.sql | Tres tablas con FK compuestas/RLS/ACL/inmutabilidad, backfill técnico, movimientos individuales, borradores, wrappers y refresh de ofertas |
| src/db/business-service.mjs | Roster e historial individual, manifiesto por segmentos y observados, ofertas/estado efectivo, borradores y vista previa |
| src/domain/business.mjs | Validación de comandos por UUID/tipo sin datos personales ni parada impuesta |
| src/http/business-api.mjs, local-transport.mjs | Seis rutas locales adicionales y conflictos seguros; mismas sesiones, límites y separación de privilegios |
| tests/business.test.mjs, integration/postgres.test.mjs | Una unitaria nueva e I01–I16, ampliación de regresiones de migración y checksums |
| AGENTS.md, README.md, docs/ETAPA_2_CONTRATOS.md, docs/DECISIONES_PENDIENTES_ETAPA_2.md, este reporte | Alcance, contratos, evidencia y decisiones pendientes |

Cada reserva/parte tiene 1–6 integrantes técnicos. Se observan BOARD/ALIGHT por UUID
en sus paradas habilitadas y en secuencia; los reintentos no duplican eventos ni
auditoría. Los datos anteriores generan solo identificadores, sin inventar abordajes.
Los movimientos grupales siguen funcionando como modo heredado; una reserva con
historia no puede mezclar ambos modos. Los nuevos BOARD no pueden superar seis
observados, contando ambos modos entre reservas diferentes del mismo viaje.

El manifiesto distingue capacidad reservada por segmento de abordajes observados
del viaje completo; conserva recogidas intermedias y la regla de despacho previa.
No interpreta las seis plazas de un expreso como seis personas reales verificadas.
Todos los integrantes de una reserva heredan su segmento/tarifa; no se define aquí
un precio/itinerario distinto por integrante dentro de esa reserva.

Las ofertas exponen vencimiento efectivo y permiten materializar el vencimiento
existente sin renovar plazos. TTL de **120 segundos provisional**. Ausencias:
WAITING/WARNING_DRAFT/GRACE_DRAFT/RESOLVED, referencia **10+5 minutos pendiente**,
creación explícita y envío siempre DISABLED. Sin notificaciones, sanciones, cobros,
liberación de plazas ni cancelaciones automáticas por ausencia.

## Problemas corregidos

1. **Aceptación parcial tras revocar un permiso**: la comprobación anterior en la
   transición final a CONFIRMED no cubría marcar `driver_accepted` en la primera
   parte de un grupo dividido todavía HELD. El wrapper nuevo revalida elegibilidad
   antes de cualquier aceptación vigente y vuelve a comprobar al chofer tras el
   lock. I09 reproduce revocación concurrente y exige que ninguna parte se acepte;
   I13 cubre revocación concurrente de membresía y reintento con sesión revocada.
   Se reutiliza la implementación interna, revocada para nexo_app.
2. **Ambigüedad/doble conteo entre observación grupal e individual**: se separan modos
   con exclusión bajo el mismo lock de ruta; no se distribuye historia heredada a
   personas ficticias. I05 compite entre ambos y solo uno puede registrar.
3. **Inventario por segmento frente a observaciones incompletas**: registrar una
   recogida posterior sin observar descensos podía representar más de seis a bordo.
   I04/I14 rechazan nuevas subidas hasta registrar descensos en su parada, preservando
   capacidad reservada y tarifas. No se inventa un descenso ni una corrección tardía.

No se han encontrado fallos pendientes en las ejecuciones locales descritas. Los
nuevos módulos no convierten estos controles de laboratorio en una certificación
operativa o legal ni cambian decisiones comerciales pendientes.

## Pruebas ejecutadas

Linux x64; Node **24.19.0**, npm **11.9.0**, PostgreSQL **18.4 real**, clúster nuevo
exclusivamente en 127.0.0.1. Datos ficticios y credenciales efímeras no publicadas.

```text
npm run test:all
  unitarias:               27/27
  integración PostgreSQL:  95/95
  fallos/omitidas/canceladas: 0
  runner: salida intencional 9 propagada y PostgreSQL detenido
  smoke: identidad/negocio separados; ambos listeners y PostgreSQL detenidos
exit: 0
```

Se conservan las **105 pruebas anteriores** y se añaden 17 (una unitaria +16 de
integración). I01–I16 verifican:

- Grupos 1–6, división, expreso, UUIDs/ordinales y ausencia de historia inventada.
- BOARD/ALIGHT individual, paradas/estados, doce reintentos concurrentes, conflictos
  de clave, auditoría única, inmutabilidad y precio/inventario conservados.
- RLS/ACL, integrantes de A/B, otros choferes/pasajeros, sesiones/membresías revocadas,
  helpers internos inaccesibles y FK compuestas contra mezcla de asociaciones.
- Segmentos contiguos con recogidas posteriores, manifiesto paginado con totales de
  todo el viaje, límite observado seis y mezcla grupal/individual entre reservas.
- Carrera de observación contra avance y contra revocación; pasado un punto no se
  registra como actual. Carrera ausencia/abordaje sin inventar aviso ni liberar plazas.
- Borradores manuales con referencia temporal del servidor, 10/15 minutos, grace
  exige warning explícito, vista previa sin escritura y delivery siempre DISABLED.
- Aceptación parcial con revocación concurrente, doce operaciones de vencimiento/
  aceptación/reintento sin resucitar un grupo ni renovar el plazo.
- HTTP real con contratos estrictos, claves obligatorias, conflictos y sesión revocada.
- **Actualización poblada 001–012 → 013**: todas las filas de tablas previas idénticas,
  seis identificadores nuevos sin eventos individuales, historia grupal conservada,
  precio y finalización posterior correctos; reaplicación vacía.

G12 verifica SHA-256 fijo de **001–012**. También siguen aprobando las actualizaciones
pobladas desde 001–004, 001–009 y 001–011, el inventario APP/presencial concurrente,
filas/retorno, búsqueda por origen/destino, tarifas y seguridad de Etapa 1.
La primera pasada de compatibilidad ejecutó 79/79 integraciones; una pasada ampliada
intermedia ejecutó 27/27 +91/91; la pasada final arriba ejecutó 27/27 +95/95.

CI Ubuntu/Windows × Node 22/24: pendiente de verificar tras publicar este incremento;
no se atribuyen a este código los checks del incremento 1. El workflow existente
continúa ejecutando npm run test:all en las cuatro combinaciones sin servicios pagos.

## Compatibilidad y límites

001–012 permanecen byte a byte intactas. 013 es aditiva: no modifica estados, precios,
segmentos ni sesiones existentes al migrar. Reutiliza inventario/reservas, cancelación,
filas, asignación, despacho, progreso e identidad. El listener de negocio conserva
únicamente nexo_app y loopback; sin identidad/provisión, SQL genérico o exposición pública.
No se modifica la configuración de CI ni se añaden dependencias/proveedores.

El historial es inmutable; no hay procedimiento de corrección tardía aprobado.
Un descenso faltante puede impedir observar nuevas subidas si excederían seis,
pero no bloquea automáticamente progreso ni cambia el inventario. El manifiesto
es una lectura operativa READ COMMITTED, no una instantánea firmada. El prototipo
no verifica personas, menores, presencia, llegada, dispositivos o ubicación real.

## Decisiones y trabajo restante

Ver [registro de decisiones](../DECISIONES_PENDIENTES_ETAPA_2.md) y
[contrato completo](../ETAPA_2_CONTRATOS.md). Pendientes del propietario:

1. Plazo comercial de ofertas/reintentos/reasignación; se mantiene 120 s provisional.
2. Inicio/evidencia del reloj y aprobación de 10+5, excepciones, revisión, comunicación,
   privacidad/retención y eventuales consecuencias; ninguna se activa con esta entrega.
3. Regla de salida: seis confirmados con recogidas posteriores (actual), abordaje
   observado en origen o manifiesto por tramo con mínimos autorizados.
4. Corrección mediante eventos compensatorios, tratamiento/verificación de menores,
   itinerarios distintos dentro de una reserva/ocupación efectiva de expreso.
5. Reservas futuras tras revocación y servicios completamente intramunicipales.
6. Revisión funcional del incremento y pruebas derivadas antes de declarar cierre
   de Etapa 2; no se inicia Etapa 3 ni se autoriza merge con este reporte.

**Evaluación:** incremento técnicamente verificable en laboratorio; Etapa 2 permanece
abierta a revisión funcional y decisiones operativas. No es un sistema listo para
producción. Sin despliegues, gastos, datos personales ni comunicaciones reales.
