# Etapa 2 — Decisiones vigentes y pendientes

Actualización del cierre técnico propuesto, 26/10/2026, America/La_Paz.
Las revisiones de los [incrementos 1–5](REPORTES/ETAPA_2_INCREMENTO_5.md) conservan
sus decisiones históricas. Este registro y los contratos actuales prevalecen sobre
propuestas anteriores. No se autoriza operación real ni Etapa 3.

## Reglas aprobadas e implementadas en laboratorio

- Búsqueda solo por origen y destino. Clasificación interna intermunicipal,
  interprovincial e interdepartamental según jerarquía y permisos. **Se excluyen
  servicios exclusivamente urbanos/intramunicipales como producto**. Se mantienen
  recogidas/descensos locales de rutas entre localidades autorizadas.
- Seis plazas simultáneas, inventario por segmentos; cuatro abordados y dos recogidas
  posteriores válidas pueden salir. El chofer registra salida/progreso, sin esperar
  a llenar otra vez ni regresar por nuevas solicitudes. Las ofertas en ruta pendientes
  vencen al sobrepasar su parada; una recogida confirmada omitida genera revisión,
  sin cancelación automática ni devolución inventada.
- Grupo junto por defecto, división voluntaria original con declaración sin menores.
  Los casos especiales declarados quedan pendientes de revisión administrativa
  simulada; nunca se separa un menor declarado de su acompañante al reasignar.
- Terminal: reasignación administrativa vinculante, consentimiento vigente de cada
  responsable, primer vehículo siguiente con capacidad conjunta suficiente. B puede
  tener reservas propias; se omite si no alcanza. A queda fuera de servicio. El
  traslado de quienes ya abordaron exige declaración explícita de traslado seguro.
- Rescate urbano o interurbano: una unidad completamente libre, sin compromisos,
  misma asociación, permisos de ruta vigentes, exclusividad y traslado seguro.
  En carretera el administrador declara terminal prioritaria; se ofrece alternativa
  si no hay unidad allí. Sin tiempos reales no se deduce conveniencia por distancia.
  Sin sustituto, incidencia urgente para gestión humana, sin promesa de rescate.
- Reserva, presencia, abordaje y pago siguen separados. Reasignar no inventa aceptación
  personal del chofer, un pago ni otro BOARD/ALIGHT; conserva importe e historial.
- Ausencia nueva: READY → 5 minutos aviso simulado → 8 elegibilidad para revisión.
  Ya llegué: 120 segundos provisionales. Recogida: cinco minutos desde llegada
  declarada a la parada. **10+5 es antecedente técnico inactivo**, conservado solo
  para compatibilidad histórica. Ninguno activa cron, envío o cancelación.
- NORMAL/DESVIO/SUSPENDIDA por ruta. Suspensión bloquea ventas nuevas y conserva
  reservas y contacto visible. Desvíos declaran condiciones y tarifa nueva; los
  importes aceptados no se recalculan. Aceptación del responsable separada de revisión
  administrativa; puntos declarados afectados bloquean nuevas reservas allí.
- Alternativas y cancelación a petición del responsable; devolución siempre de la
  asociación. El laboratorio solo muestra un código de contacto LAB-* y registra
  decisiones. No recibe, concilia ni devuelve dinero.

## Decisiones pendientes para cualquier uso real

| Tema | Contrato implementado / frontera | Decisión o validación necesaria |
|---|---|---|
| Ausencia y comunicación | 0/5/8 y recogida cinco minutos, solo evaluación; entrega DISABLED | Evidencia, excepciones, accesibilidad, consentimiento/comunicación dentro de app, revisión de errores; autorización separada para cualquier consecuencia |
| Plazos | Oferta y declaración 120 s provisionales; históricos conservados | Plazo comercial definitivo; condiciones offline; sin renovar relojes por reintento |
| Menores | PARENT_ACCOMPANIED, AUTHORIZED_COMPANION, UNACCOMPANIED y revisión PENDING/VERIFIED_SIMULATED/REJECTED | Normativa por recorrido/modalidad y documentación oficial, quién puede verificar y responsabilidad; la marca de laboratorio no acredita parentesco ni autorización legal |
| Terminales y rescate | Prioridad declarada, paradas discretas ficticias, permisos del modelo | Terminales oficiales, acceso al punto seguro, tiempos/vías reales, asistencia ante accidentes; no verificación de transitabilidad ni navegación |
| Revisión especial | Sin alternativa o grupo ligado entre varios vehículos: incidencia/revisión, sin separación automática | Solución operacional cuando no cabe una sola unidad, grupos con responsables diferentes, límite técnico de ocho episodios, reprogramación y compensaciones |
| Correcciones tardías | Compensaciones inmutables en parada actual; no se falsifica descenso para liberar capacidad | Procedimiento para errores detectados tras pasar una parada, prueba, revisión y custodia |
| Permisos revocados y suspensión | Nuevas operaciones revalidan; no se borran reservas ni se interrumpen automáticamente servicios iniciados | Gestión humana de reservas futuras y emergencias con permisos suspendidos, reprogramación y comunicación |
| Tarifas y devoluciones | Precio original, sin recargo; contacto ficticio y decisiones, sin dinero | Tarifas legales, política de asociación, reclamos, confirmación administrativa real; ningún porcentaje inventado |
| Datos y auditoría | Historial consultable, inmutable y paginado; sin borrado destructivo | Finalidades, minimización, bases jurídicas, acceso y retención por tipo de dato; sin períodos legales arbitrarios |
| Habilitación/identidad | Revisor general y administradores restringidos; aprovisionamiento offline separado | Documentación/fuentes oficiales, términos, altas de cuentas reales, Google OAuth, nombre/celular y recuperación/MFA; cuentas/paneles en etapa posterior autorizada |
| Infraestructura y producción | Loopback y datos ficticios; sin recursos externos | Presupuesto, TLS, monitoreo, backups/restauración, carga, revisión de seguridad/operadores y autorización expresa de piloto |

El protocolo urbano inicial begin-urban sigue acotado a su manifiesto declarado;
la salida general existente y la reserva en ruta cubren los recorridos con recogidas
posteriores sin convertir el transporte urbano en un servicio independiente.
La rehabilitación simulada no certifica mecánica ni reincorpora automáticamente una
unidad retirada a una fila. La asignación de una nueva entrada administrativa tras
reparación requiere procedimiento de operación; no se finge una carrera completada.

El cierre **formal** depende de revisión de ChatGPT/propietario. PR #1 y #2 abiertos,
main/Etapa 1 conservados. Sin despliegue, pagos, GPS, mensajes reales ni Etapa 3.
