# Trufis Bolivia — Especificación funcional inicial

**Estado:** borrador de requisitos acordados el 25 de octubre de 2026. Proyecto desde cero, independiente de Ruta 35, Meteo Chaco y ATLAS-AI-Lab. Nombre comercial: **Trufis Bolivia**; repositorio técnico: **proyecto-nexo**. **No hay despliegue ni pagos reales autorizados.**

## 1. Propósito y alcance
Plataforma SaaS multi-asociación para transporte **interprovincial** de trufis y vagonetas en Bolivia. Primera prueba: Yacuiba ↔ Villamontes, con asociaciones, cuentas y viajes ficticios. La integración con minibuses queda para después. Cuatro roles: pasajero, chofer, administrador de asociación y administrador general. Cada asociación controla sus datos, choferes, vehículos, filas, rutas, paradas y tarifas, separados de los de otras asociaciones.

## 2. Vehículos, filas, abordaje y reservas
- **Seis asientos de pasajeros por vagoneta** como referencia inicial (comprobar capacidad habilitada de cada vehículo).
- El administrador de cada asociación registra las personas que llegan presencialmente y sus destinos; los registros presenciales comparten inventario de plazas con reservas digitales. No permitir sobreventa, incluso con solicitudes simultáneas.
- Asignación **mixta**: la plataforma propone al primer chofer elegible según fila, sentido, capacidad y recorrido; él acepta. Gestionar rechazos, no respuesta y conflictos, con auditoría.
- Un trufi con seis plazas ocupadas o reservadas puede salir. **El chofer registra la salida**, sin autorización administrativa por viaje. Puede salir hacia recogidas confirmadas en ruta.
- Si un trufi detrás se llena antes, **puede salir primero**; los incompletos conservan su orden relativo en fila.
- Cuando el viaje termina y el chofer está disponible, puede **pedir incorporarse al final de la fila de destino** de su asociación.
- Reservas digitales de 1–6 asientos y modalidad **expreso** que reserva la vagoneta completa. Para solicitudes de **tres o más asientos** se puede sugerir división voluntaria; **viajar juntos por defecto**. No dividir expresos ni separar menores de sus responsables. Asegurar todas las reservas vinculadas antes de confirmar una división.
- Si un vehículo no puede alojar al grupo, proponer el siguiente compatible sin romper la fila de quienes permanecen esperando.
- Cada pasajero escoge **ir a parada/terminal** o **ser recogido en punto autorizado** de la ruta. Mostrar dirección de parada, referencia y enlace de navegación Google Maps. No ofrecer recogidas donde el vehículo ya pasó ni en puntos inseguros.
- Tramos intermedios: pasajero indica comunidad, cruce, referencia o un punto de mapa para subida/bajada. Asignar el punto al **tramo válido de la ruta** definido por la asociación; no simplemente al punto más próximo en línea recta. Mostrar el precio antes de confirmar. Verificar disponibilidad por segmento de ruta.
- Si un vehículo listo para salir espera a pasajero reservado en terminal, advertir a los **10 minutos** y liberar su plaza **5 minutos después** si la ausencia queda acreditada. Ofrecer contacto/recogida viable, registro de incidencias y revisión por errores de notificación. Políticas económicas de no presentación aún pendientes.
- Cancelación libera plazas sin quitar arbitrariamente el orden al vehículo.

## 3. Viajes, choferes y seguridad
Estados claros de viaje, separados de los estados de reserva, vehículo y fila: **asignado → yendo a recoger → recogido(s) → en ruta → llegada confirmada → disponible → solicitar entrada a fila**. Varios pasajeros pueden subir/bajar en distintos puntos; el progreso de cada reserva debe ser independiente del recorrido del vehículo.
- Conductor y pasajero ven vehículo, estado y notificaciones. El pasajero puede calificar viaje y aplicación.
- Pago efectivo: confirmación de conductor y pasajero; discrepancias se revisan.
- Permitir que el chofer **informe un viaje adicional** permitido (sin solicitud de aprobación individual), con destino aproximado; marcar vehículo como ocupado y seguir el viaje con GPS.
- Seguimiento GPS discreto durante **servicios activos**, pero conocido por las personas pertinentes, con permisos, control de accesos, caducidad y sin seguimiento de trayectos privados.
- Prever emergencias, contacto de confianza e internet intermitente; un teléfono sin conexión no debe crear plazas confirmadas sin validación central.

## 4. Tarifas, pagos y devoluciones
- Cada asociación configura tarifa ordinaria, tarifa de **expreso** y **tarifas por tramo**, sujetas a normas aplicables; se guarda el precio pactado y la versión de la tarifa al confirmar.
- Pasajero puede pagar **QR, efectivo o combinado**. El dinero de transporte llega **directamente a la cuenta de la asociación**; la plataforma no cobra porcentajes/comisiones por reserva.
- Objetivo: QR **individual para cada operación/reserva**, si proveedor bancario lo soporta; alternativa QR general por asociación con conciliación. Un comprobante aportado por el pasajero no equivale a pago bancario verificado.
- Ante cancelación de reserva QR, la **asociación receptora** gestiona el reembolso. Trufis Bolivia informa el contacto oficial y referencia de pago, registra reclamos y estado de devolución; no promete acceso a datos bancarios de origen ni reembolso automático sin integración autorizada.
- Nunca duplicar registros de cobro o devolución ante pulsaciones simultáneas.

## 5. Licencias comerciales por asociación
- Licencias de software por plazo y precio **fijos**, en principio contratos de **12 meses** y pagos flexibles. Sin comisión de pasajes.
- Período de gracia propuesto de **siete días**. Primera falta de pago tras gracia sin multa; incumplimientos posteriores dentro del contrato anual con recargo contractual fijo (importe y legalidad pendientes).
- **Día anterior a suspensión**, 18:00 hora de Bolivia: si no hay pago o comprobante admitido a revisión, **congelar reservas para el día siguiente** y avisar al administrador. 20:00: si continúa sin regularizarse, **cancelar únicamente reservas del día siguiente que aún no comenzaron**, avisando al pasajero y recomendando otra asociación.
- Un comprobante no equivale a pago acreditado: pasar a revisión acotada y evitar cancelación arbitraria; plazo preciso pendiente.
- Suspensión definitiva preferentemente durante madrugada operativamente segura: **ocultar asociación en búsquedas** y deshabilitar nuevas reservas, conservando todos sus datos. Viajes que ya iniciaron **no se interrumpen**. Permitir operaciones indispensables para llegada, atención, reclamos y devoluciones.
- Las notificaciones a pasajeros serán neutrales, sin revelar detalles de impago entre asociación y plataforma. Si pagaron con QR, mostrar contacto de la asociación para solicitar reembolso.
- Reactivar visibilidad al verificar pago. No reactivar reservas ya canceladas sin aceptación del pasajero.

## 6. Gestión administrativa
- El chofer puede solicitar alta; el administrador de asociación revisa documentación y habilita conductor/vehículo.
- El administrador administra presenciales, filas, tarifas, paradas, rutas, disponibilidad y reclamos. No aprueba manualmente cada salida.
- El administrador general gestiona asociaciones, licencias, suspensiones y auditoría sin intervenir innecesariamente en viajes cotidianos.
- Reglamentos de asociación solo se traducen a opciones configurables cuando afectan reservaciones, turnos, capacidad, filas o seguridad, sujetos a normativa aplicable.

## 7. Por decidir antes de producción
- Tarifas reales y zonas geográficas autorizadas; paradas, desvíos, capacidad y rutas reales.
- Política de rechazos/no respuesta del conductor y criterios de adelanto de fila.
- Ausencias, confirmación de abordaje, reclamación y devolución según momento de cancelación.
- Revisión de licencias, importe del recargo, plazo de comprobantes y horario para servicios nocturnos.
- Conexiones bancarias, identificación del pagador, costos del proveedor, pagos QR y reembolsos.
- Normativa de transporte aplicable, privacidad/GPS, contratos y términos revisados por asesoría local.
- Arquitectura de hosting, presupuestos, disponibilidad offline y estrategia de despliegue.

## 8. Construcción gradual
1. Modelo multi-asociación, permisos, seguridad y esquema de base de datos.
2. Filas, presenciales, reservas y capacidad transaccional con datos ficticios.
3. Panel de administradores y aplicaciones de pasajeros y choferes.
4. GPS y mapas, tramos de tarifa y notificaciones.
5. Pagos simulados, licencias y auditoría.
6. Integraciones bancarias reales y piloto autorizado **solo tras aprobación explícita**.

**Salvaguardas:** nunca importar código, bases o credenciales de proyectos anteriores; no usar dinero real, crear recursos de pago, activar despliegues ni recopilar GPS real sin autorización. Documentar decisiones y cambios de requisitos.