# Arquitectura — Etapa 1

**Estado:** núcleo PostgreSQL y adaptador de servidor implementados y probados localmente.
API HTTP solo de pruebas en loopback, sin aplicaciones ni base desplegada.
Fuente de reglas: [REQUISITOS_INICIALES](REQUISITOS_INICIALES.md).
El mapa de componentes siguiente sigue siendo el objetivo; el incremento ejecutable
está descrito en [IMPLEMENTACION_ETAPA_1](IMPLEMENTACION_ETAPA_1.md).

## Componentes propuestos

```text
APK Pasajero ─┐
APK Chofer ───┼──> API HTTPS (TypeScript) ──> PostgreSQL
Panel web ────┘          │
                  colas/eventos futuros
                  (notificaciones, GPS)
```

- Monorepo modular: `apps/passenger`, `apps/driver`, `apps/admin-web`, `apps/api`; `packages/domain`, `packages/db`; `docs`, `tests`. No depender del repositorio Ruta 35.
- Aplicaciones previstas: React Native/Expo para pasajero y chofer; Next.js para paneles; API Node/TypeScript; PostgreSQL como fuente única de verdad.
- No contratar ni activar hosting, mapas, bases remotas o pagos en etapa 1. Evitar claves privadas en GitHub.
- Autenticación con contraseñas con hash seguro, sesiones revocables y control de roles en API, nunca confiando solo en pantallas.
- Administrador general puede gestionar licencias y asociaciones; administrador de asociación solo su asociación; chofer solo turnos y viajes propios; pasajero solo sus reservas.
- **Aislamiento obligatorio:** cada tabla operativa incluye association_id cuando corresponde. Toda consulta/mutación valida asociación del actor en el servidor; una fila de asociación distinta no debe participar en asignaciones.
- Prohibir consultas indiscriminadas y exponer lo mínimo necesario de identidad o GPS.

## Módulos de dominio

1. Catálogo: asociaciones, usuarios/roles, conductores, vehículos, ciudades, rutas, paradas, tramos y tablas de tarifas con vigencia.
2. Despacho: turnos, colas por asociación+ruta+sentido, posiciones y eventos inmutables.
3. Inventario: reservas digitales y presenciales, plazas retenidas/confirmadas y ocupación por segmento.
4. Viajes: vehículo, conductor, estado operacional, embarques/desembarques por reserva y eventos.
5. Tesorería: obligaciones por reserva, pagos efectivo/QR/mixto, referencias bancarias, conciliación, devoluciones y disputas.
6. SaaS: licencias, vencimientos, revisión de comprobantes, congelamiento, suspensión y reactivación.

## Decisiones de consistencia

- **Capacidad:** al aceptar reserva bloquear transaccionalmente la operación/inventario del vehículo para el segmento; no confirmar si cualquier segmento supera seis plazas. Conteos calculados desde reservas de estado válido, no solo de números editables.
- **Grupo:** viajar juntos por defecto. Si se divide voluntariamente, reservar ambos bloques atómicamente: todos o ninguno.
- **Despacho mixto:** ofrecer al primer vehículo elegible; aceptación con caducidad. Liberar plazas retenidas ante rechazo o timeout; preservar auditoría.
- **Cola:** adelantamiento por vehículo lleno es salida permitida, no reordenamiento arbitrario del resto. Un vehículo no puede estar en dos filas activas ni realizar dos viajes activos simultáneos.
- **Presenciales:** el administrador registra antes de que el asiento pueda venderse por app. Cambios de conteo no pueden omitir validación de cupos.
- **Pagos:** jamás marcar QR como abonado solo por imagen de comprobante; la verificación la dicta el proveedor o un proceso conciliado.
- **Idempotencia:** todas las operaciones sensibles reciben clave de acción única; doble clic o reintento no duplica cobro, asiento, salida ni devolución.
- **Licencia suspendida:** ocultar del catálogo público de nuevas reservas, pero permitir consultas y terminación de viajes ya iniciados, atención y devoluciones.
- **No usar un cron simple que cancele indiscriminadamente:** prevalidar zona horaria, fecha local, transiciones, salidas activas y comprobantes pendientes; registrar resultados.

## Seguridad y privacidad

Registro de eventos de auditoría con actor, hora, asociación y motivo. GPS solamente durante servicio autorizado, con permisos e información transparentes, acceso mínimo y retención configurable. Prohibido rastreo personal oculto.

## Entorno

Desarrollo local y pruebas con datos completamente ficticios; `.env.example` sin secretos. CI sobre runners estándar si se habilita, sin credenciales reales. Antes del primer despliegue acordar costos, seguridad y autorizaciones.

## Incremento de cobertura nacional

Implementado mediante migraciones 005–007: jerarquía geográfica versionada, localidades
en rutas/paradas, autorizaciones por ruta y búsqueda exclusivamente por origen/destino.
Las categorías se derivan de la jerarquía administrativa. El lanzamiento comercial
sigue el orden intermunicipal, interprovincial e interdepartamental; la configuración
y los permisos habilitan cada servicio, sin expansión automática.
El estado comercial existente se conserva separado de adhesión, operación y permiso.
[Contrato, RLS y actualización](GEOGRAFIA_Y_AUTORIZACIONES.md). No hay frontend ni GPS.

## Incremento de localidades e identidad local

008–009 añaden sugerencias por nombre y jerarquía, registro/login local con scrypt,
sesiones revocables y recuperación de un uso. Conexiones separadas: nexo_app para
negocio con RLS, nexo_identity para el módulo confiable y nexo_provisioner para
altas/bajas privilegiadas. Sin proveedor externo ni interfaz pública desplegada.
[Contrato, protocolo y fronteras](LOCALIDADES_Y_AUTENTICACION.md).

## Incremento 010–011

HTTP local ejecutable con PostgreSQL efímero, sin credenciales externas ni interfaz
de administración. Roles de runtime separados y comprobados por autoridad efectiva;
mantenimiento offline acotado y con simulación por defecto; eventos de seguridad
privados sin secretos. La conexión propietaria solo instala el laboratorio y se
cierra antes de servir. [Uso y amenazas](HTTP_LOCAL_Y_MANTENIMIENTO.md) y
[auditoría/criterios de cierre](REPORTES/ETAPA_1_AUDITORIA_HTTP.md).

## Etapa 2 autorizada: negocio local

Nueva capa de contratos/adaptador de reservas, filas y despacho sobre las funciones
SQL existentes. Listener de negocio separado que recibe solo nexo_app; comparte
validación de transporte, sin pool de identidad/provisión ni nuevos endpoints públicos.
012 añade bitácora por reserva y precondición de precio atómica, sin reescribir
inventario ni despacho. [Contratos y fronteras](ETAPA_2_CONTRATOS.md).

## Backend Etapa 2, cierre propuesto

012–022 conservan el núcleo y añaden operaciones locales, miembros/compensaciones,
terminal/episodios, sustitución urbana y rescate interurbano, ventas en ruta,
condiciones declaradas y administración restringida. No servicios públicos ni apps.
[Contratos actuales](ETAPA_2_CONTRATOS.md) y [evidencia/fronteras de cierre](REPORTES/ETAPA_2_CIERRE_TECNICO.md).

## Etapa 3, incremento 1 autorizado: interfaz web local

React/TypeScript compilado estáticamente con esbuild. El gateway de mismo origen
sirve assets y una lista de consultas públicas sobre los servicios PostgreSQL
existentes, con nexo_app y sesión técnica de catálogo solo en servidor. La conexión
propietaria se cierra antes de escuchar. Sin base paralela, SQL desde navegador ni
escrituras web. Paneles privados pendientes, APIs 401. El runner existente inicia
y detiene el clúster efímero de 001–022 y el gateway. No Next.js/SSR ni proveedores.
[Informe, seguridad y ejecución](REPORTES/ETAPA_3_INCREMENTO_1.md).


## Etapa 3: incrementos 2–3 de laboratorio

El gateway de mismo origen conserva sesiones web opacas con cookie protegida y CSRF,
identidad SQL separada del pool nexo_app y setup cerrado antes de escuchar. No se
promueve a Internet el listener CLI previo. Las operaciones web se limitan a comandos
expresamente admitidos; cada RPC vuelve a autorizar con la sesión y el ámbito SQL.

023 proyecta puntos/segmentos y reservas propias. 024 añade tipos de puntos declarados
offline, un snapshot operativo por rol y una envoltura de observación vinculada a
viaje/episodio. Esta envoltura reclama idempotencia antes de bloquear ruta y delega
el hecho al RPC existente; no mantiene otro inventario. Presencia, verificación,
abordaje, salida, fin de recogidas y llegada siguen separados y auditados.
[Operaciones web, límites y procedimiento](REPORTES/ETAPA_3_INCREMENTO_3.md).
