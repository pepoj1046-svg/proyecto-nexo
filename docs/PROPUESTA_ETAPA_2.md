# Propuesta de alcance y plan — Etapa 2 de 10

**Estado histórico:** propuesta entregada al cerrar Etapa 1. El propietario aceptó
ese cierre y autorizó iniciar Etapa 2 el 26/10/2026, exclusivamente con datos ficticios.
La implementación actual y sus límites están en [contratos de Etapa 2](ETAPA_2_CONTRATOS.md).
El texto siguiente conserva el plan propuesto original; no autoriza Etapa 3 ni despliegues.
Se entrega junto al [cierre técnico de Etapa 1](CIERRE_TECNICO_ETAPA_1.md).
No se crean módulos, migraciones, ramas, interfaces o infraestructura de Etapa 2.

## Objetivo propuesto

Completar el contrato funcional de reservas, presenciales, asignación y filas con
datos ficticios, apoyándose en el núcleo transaccional ya probado. No rehacer
inventario, RLS, identidad o despacho por haberse construido anticipadamente para
validar la seguridad de Etapa 1. Esta propuesta sigue la secuencia gradual de
REQUISITOS_INICIALES.md; cualquier ajuste de la división de diez etapas requiere
aceptación del propietario.

## Alcance propuesto

- Acordar estados, errores y permisos de las operaciones de reserva/grupo,
  presenciales, ofertas, cancelación, salida y retorno a fila ya existentes.
- Diseñar un adaptador de negocio para pruebas locales, separado del contrato
  de identidad/laboratorio. Probar sesión, rol, idempotencia y respuestas sin
  exponer SQL, provisión ni autoridad de identidad al pasajero.
- Completar casos funcionales faltantes aprobados para 1–6 plazas, expreso,
  división voluntaria, competencia APP/presencial y tarifas por tramo, preservando
  el precio pactado y el orden de los vehículos incompletos.
- Ampliar escenarios de fallos/reintentos y actualización poblada del núcleo;
  medir comportamiento del despacho con colas y datos sintéticos representativos.
- Mantener búsqueda por origen/destino y desambiguación de localidades por IDs y
  versión, sin selector de categoría ni generación de recorridos por similitud.

El adaptador futuro no sería una promoción de la API de laboratorio a Internet.
No se propone todavía una app móvil, panel de producción o proveedor público.

## Plan de trabajo sujeto a autorización

| Hito | Entregable | Criterio de revisión |
|---|---|---|
| 0. Aprobación | Cierre de Etapa 1 y encargo de Etapa 2 aceptados | Autorización expresa; sin inferir permiso de merge/despliegue |
| 1. Contratos | Matriz de actor/operación/estado, errores e idempotencia | Pasajero propio, administrador de su asociación, chofer propio; reglas ambiguas señaladas |
| 2. Adaptador local | Operaciones de negocio aprobadas sobre el núcleo existente | Validación estricta, sin IDs de actor como autenticación, sin privilegios de identidad/provisión |
| 3. Funcionalidad | Casos de reservas/presenciales/ofertas/filas y ajustes necesarios | Seis por segmento, grupos atómicos, tarifas preservadas y orden de fila correcto |
| 4. Robustez | Reintentos, concurrencia, fallos parciales y compatibilidad poblada | Sin sobreventa, duplicados ni mezcla A/B; rollback verificable |
| 5. Entrega | Código/documentación y PR de revisión según flujo aprobado | Suite PostgreSQL/Node en Ubuntu/Windows, riesgos y resultados reales |

No se fijan fechas ni costos sin un encargo aprobado. Se priorizarían incrementos
pequeños con evidencia y revisión, manteniendo las migraciones ya aplicadas intactas.

## Decisiones que condicionan partes del trabajo

El propietario debe confirmar el significado del manifiesto de salida con recogidas
posteriores y el plazo de ofertas; criterios de rechazos/no respuesta; tratamiento
de grupos con menores; abordaje/ausencias; rutas completamente intramunicipales;
y reservas futuras ante revocación de permisos. No se fijan sanciones, cancelaciones
o devoluciones por interpretación técnica. Si una decisión sigue abierta, esa parte
se documentaría como bloqueada sin impedir trabajo independiente autorizado.

Proveedor de identidad, canal real de recuperación, privacidad/retención, fuentes
oficiales de geografía/transporte y despliegue necesitan sus aprobaciones antes de
cualquier piloto. Su selección no obliga a crear recursos para desarrollar simulaciones.

## Fuera de alcance propuesto

Producción, datos personales reales, bancos/QR/cobros, GPS/mapas reales, comunicaciones
reales, contratos/licencias automáticas, proveedores de pago, compra de créditos y
modificaciones a otros proyectos. Tampoco se autoriza merge a main con este documento.

La Etapa 2 solo comienza después de la aprobación explícita del propietario.
