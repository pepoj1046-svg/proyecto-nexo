# Trufis Bolivia — propuesta de plan maestro de diez etapas

> Vigencia posterior: autorizado únicamente el incremento de programación 4A.1.
> El resto conserva el estado histórico de la propuesta; resultados actuales en
> [el informe de 4A.1](REPORTES/ETAPA_4_INCREMENTO_4A1.md).

Fecha: 01/11/2026. Base técnica: `1f07fd9cb69676258bf277a561d9e8aa711bacb2`.
**Solo el diagnóstico documental de 4A está autorizado. La programación espera otro encargo.**

## Objetivo y procedencia

El propietario desea desarrollar el producto para venderlo íntegramente a una
empresa compradora, que asumirá operación, comercialización, mantenimiento y evolución.
No se presupone una suscripción operada por el desarrollador ni un piloto real actual.
La separación técnica entre asociaciones sigue siendo necesaria aunque cambie el
modelo comercial del propietario del software.

No se encontró un desglose original completo de diez etapas en los Markdown
versionados consultados. [La propuesta de Etapa 2](PROPUESTA_ETAPA_2.md) menciona
«Etapa 2 de 10»; [los requisitos iniciales, sección 8](REQUISITOS_INICIALES.md)
enumeran **seis pasos**. No se afirma haber recuperado una numeración original ausente
ni revisado documentos privados externos. Etapas 1–3 están respaldadas por sus
contratos e informes; la organización de 4–10 siguiente es **propuesta nueva para
aceptación del propietario**, no implementación autorizada.

La instrucción actual permite planificar administración autónoma como prioridad
de Etapa 4. Las prohibiciones históricas de AGENTS/README no se interpretan como
permiso de programación ni bloquean esta autorización documental posterior.
No se renombra ni modifica ningún informe histórico.

## Estado actual comprobado

| Etapa técnica | Evidencia histórica | Estado y límite |
|---|---|---|
| 1. Arquitectura, datos y seguridad | `9188139`; [cierre](CIERRE_TECNICO_ETAPA_1.md), 23 unitarias + 66 PostgreSQL | Cerrada en laboratorio; identidad, RLS, inventario y búsqueda. Sin infraestructura productiva. |
| 2. Reservas, asignación y filas | `820fd1f`; [cierre](REPORTES/ETAPA_2_CIERRE_TECNICO.md), 33 unitarias + 177 PostgreSQL | Cierre de laboratorio aceptado como antecedente; grupos, operación, incidencias y rescates con límites contractuales. |
| 3. Interfaz web y operación integrada | `1f07fd9`; [auditoría](REPORTES/ETAPA_3_AUDITORIA_Y_CIERRE.md), 62 unitarias + 278 PostgreSQL + 82 E2E = 422 | Cierre de laboratorio ratificado; web adaptable por roles. No equivale a apps nativas ni producción. |

Son cifras de sus entregas, **no pruebas reejecutadas en esta planificación**.
El [registro final de Etapa 3](https://github.com/pepoj1046-svg/proyecto-nexo/pull/3#issuecomment-6561718192)
identifica SHA, Ubuntu/Windows × Node22/24 y CodeQL; conserva el fallo inicial de
red de Windows y su única repetición diagnóstica aprobada.

**Estamos en Etapa 4: diagnóstico y planificación de 4A, sin programación de 4A.**
La administración parcial heredada de 1–3 no significa que 4A esté implementada.

## Hoja de ruta propuesta

| Etapa | Resultado de producto | Situación real | Condición propuesta de terminación |
|---|---|---|---|
| 1 | Arquitectura, PostgreSQL y seguridad básica | Cerrada en laboratorio | Conservar evidencia; revisar garantías al ampliar superficies. |
| 2 | Reservas, capacidad por segmentos, filas y operación | Cerrada en laboratorio | Preservar contratos e invariantes posteriores. |
| 3 | Web para pasajero, chofer y administración | Cerrada en laboratorio | Cierre ratificado sobre 1f07fd9, límites visibles y reproducción. |
| 4 | Administración autónoma y configuración del comprador | Parcial en el producto heredado; solo planificación actual autorizada | Altas, accesos, catálogos, cambios e historial con contratos aprobados, sin editar fixtures. Ver [plan](PLAN_ETAPA_4.md). |
| 5 | Experiencia integral y resiliencia de clientes | Web móvil existente; otras funciones pendientes/propuestas | Revisar perfiles, ayuda, valoraciones y conectividad intermitente; decidir si basta web adaptable. Nunca confirmar plazas offline sin servidor. |
| 6 | Seguimiento y comunicación por adaptadores simulados | Progreso discreto existente; GPS/mapas/avisos externos pospuestos | Contratos y simuladores con permisos, caducidad y fallos. Activación real exige nueva autorización, privacidad y proveedor aprobado. |
| 7 | Economía y conciliación en simulación | Precio histórico y marca de pago simulado parciales | Aprobar reglas y probar idempotencia, discrepancias y conciliación ficticia. Licencias a asociaciones solo si el comprador las requiere; sin dinero real implícito. |
| 8 | Operabilidad y seguridad ampliada transferibles | Pruebas y mantenimiento local parciales | Restauración reproducible, migraciones, carga, observabilidad sin secretos y amenazas revisadas. Infraestructura pública y presupuesto se deciden aparte. |
| 9 | Aceptación integral y candidato de entrega | Pendiente | Matriz contractual, escenarios de comprador, accesibilidad, regresiones y auditoría según acuerdo. Aceptación ficticia, sin inventar piloto real. |
| 10 | Venta y transferencia | Pendiente; documentación desde ahora | Fuentes, dependencias/derechos, instalación, bootstrap, capacitación y acta de aceptación; alcance jurídico y soporte acordados por las partes. |

No se fijan fechas, costos ni aprobación de servicios con esta tabla. Etapas 5–10
no se inician ahora. Cada etapa podrá dividirse en incrementos con encargo propio.

## Relación con el antecedente y los incrementos entregados

| Seis pasos iniciales | Relación propuesta, sin cambiar la historia |
|---|---|
| 1. Modelo, permisos y datos | Etapa 1; seguridad ampliada futura en 8. |
| 2. Filas, presenciales y reservas | Etapa 2; núcleo reutilizado en todo el producto. |
| 3. Panel y aplicaciones | Etapa 3 construyó web adaptable. APK/Expo/Next.js conceptuales no se cuentan como implementados; necesidad futura se decide en 5. |
| 4. GPS, mapas, tramos y avisos | Tarifas por segmentos ya funcionan en 1–3; administración se propone en 4 y seguimiento/comunicación en 6. La prioridad administrativa nueva no es el cuarto paso histórico. |
| 5. Pagos simulados, licencias y auditoría | Auditoría ya transversal; simulación económica completa propuesta en 7. Revisar licencias por el nuevo modelo de venta, sin activarlas. |
| 6. Bancos reales y piloto autorizado | Fuera de autorización. Propietario/comprador decidirán otra aceptación contractual o su operación posterior; no se declaran realizados por cerrar etapas de simulación. |

Etapa 3, incrementos 1–6: catálogo, reservas, operación, recuperación, terminal y
consultas paginadas. 7A/7B: modalidades y condiciones. 8A: turno directo de terminal,
recepción segura y reportes. 8B: responsables, menores, ausencias y revisiones.
Cierre: reintentos y alcances corregidos con 033. Sus nombres y evidencias se
conservan en [los informes](REPORTES/).

## Preparar la transferencia

- Mantener requisito → contrato → código → prueba → limitación y etiquetas claras
  de simulado/pendiente; una pantalla no acredita operación real.
- Entregar fuentes, lockfile, inventario de licencias/dependencias y preparar SBOM
  y procedencia de recursos. No presumir derechos jurídicos o condiciones de venta.
- Documentar instalación, actualización, restauración y primer acceso del comprador.
  Generar secretos en su entorno; no transferir credenciales personales del
  desarrollador ni `.local` o fixtures como datos comerciales.
- Separar configuración, identidad e integraciones del motor probado; evitar
  dependencia de cuentas o servicios pagados del desarrollador.
- Acordar aceptación, exclusiones, mantenimiento posterior, titularidad, privacidad
  y responsabilidades. Esta tarea no contrata ni contacta compradores.

La venta integral y la aptitud para producción son evaluaciones distintas. La
entrega deberá distinguir implementación, simulación y habilitaciones necesarias
antes de que el comprador opere con personas o dinero reales.

## Actualización de ejecución: 4A.1

El propietario autorizó posteriormente solo la programación de 4A.1, desde
`4223675` en `desarrollo/etapa-4`. El texto anterior conserva la planificación
original. [Contrato de lectura](ETAPA_4_DIRECTORIO_ADMINISTRATIVO.md) y
[informe de implementación](REPORTES/ETAPA_4_INCREMENTO_4A1.md) distinguen resultados
ejecutados y pendientes. No se autoriza 4A.2 ni se declara cerrada Etapa 4.
