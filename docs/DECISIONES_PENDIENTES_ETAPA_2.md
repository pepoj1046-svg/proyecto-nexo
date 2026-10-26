# Decisiones reservadas — Etapa 2

Estas cuestiones se documentan sin inventar reglas comerciales o legales. La
autorización actual permite avanzar con contratos, inventario, permisos, adaptador
local y pruebas independientes usando datos ficticios. No autoriza un piloto real.

| Decisión | Comportamiento conservado | Falta acordar antes de completar la política |
|---|---|---|
| Plazo de aceptar propuestas | TTL técnico previo de dos minutos; vencimiento libera retenciones | Plazo definitivo, avisos, reintentos y criterios tras rechazo/no respuesta |
| Ausencias/tolerancias | Borradores manuales inactivos, referencia 10+5 minutos; sin envío/cron/efectos de ausencia | Evidencia de ausencia, avisos, tolerancias, recursos económicos y revisión |
| Menores | División solo con declaración explícita containsMinors=false; no se recopilan edades/personas | Verificar edad/vínculos, quién autoriza, casos de grupo y privacidad |
| Manifiesto y recogidas posteriores | Salida con seis plazas confirmadas según núcleo previo, incluso en paradas posteriores; bitácora de movimientos no altera esa regla | Interpretación definitiva de ocupación/manifiesto, abordaje previo y qué hacer con observaciones incompletas |
| Reservas futuras tras revocación | Nuevas reservas/confirmaciones revalidan; no cancelación masiva ni interrupción de viajes iniciados | Aviso, revisión de reservas futuras, alternativas y consecuencias económicas |
| Recorrido completo intramunicipal | Clasificación NULL no crea un servicio completo; los tramos locales de rutas habilitadas continúan | Si soportarlo, categoría/condiciones y permisos correspondientes |

No se atribuye carácter definitivo a los plazos de laboratorio ni a los supuestos
de salida. Las observaciones BOARD/ALIGHT pueden ser grupales heredadas o individuales mediante
UUIDs ficticios, sin mezclar modos en una reserva. No acreditan identidad, edad ni ausencia. No se sustituye una observación faltante por un
evento ficticio para poder cerrar un viaje.

También requieren aprobación para uso real: fuente geográfica y permisos oficiales,
altas documentales, proveedor de identidad, TLS/MFA/canal de recuperación,
retención/backups y operación. Cobros/QR/GPS/comunicaciones y gastos no se activan.
Etapa 3 no está autorizada. PR #1 permanece abierto y main no se modifica.


## Condiciones operativas pendientes del incremento 2

- **Ausencias 10+5**: aprobar o cambiar los valores, el hecho que inicia el reloj,
  si el vehículo debe haber llegado/esperado, quién certifica, casos de menores y
  accesibilidad, canales/consentimiento, excepciones y revisión. Decidir retención
  y efectos por separado. Los borradores actuales no habilitan efectos automáticos.
- **Salida/manifiesto**: alternativas para decisión: mantener seis plazas confirmadas
  incluidas recogidas posteriores (comportamiento actual), exigir abordaje observado
  en origen, o definir un manifiesto por tramo con mínimos propios. La última opción
  necesita definir cómo se autoriza la salida con recogidas posteriores; no se
  modifica la regla actual ni se crean excepciones automáticas.
- **Secuencia/correcciones**: decidir responsabilidad, evidencia y evento compensatorio
  inmutable si faltó/erró una observación y ya pasó la parada. Actualmente se rechaza
  el registro fuera de parada y no se permite reescribir historia ni sobreabordar.
- **Expreso e itinerarios individuales**: seis UUIDs representan capacidad reservada,
  no seis personas verificadas. Cada integrante hereda el segmento de su reserva.
  Diferentes destinos dentro de una misma reserva requieren acordar precio/inventario.
- **Ofertas/revocación**: 120 segundos siguen siendo provisionales; las aceptaciones
  parciales también revalidan permisos. Falta definir reasignación tras rechazo/no
  respuesta y tratamiento de reservas futuras ya confirmadas tras revocación.

Retención de las nuevas bitácoras y su acceso/depuración comercial requieren decisión;
no se fija un plazo legal ni se añade limpieza destructiva automática. No hay entrega
de avisos reales ni un modelo de identidad de personas. Etapa 2 sigue en revisión.

## Actualización autorizada en el incremento 3

La simulación de terminal usa ahora 0/5/8 desde READY verificable y la recogida
cinco minutos desde PICKUP_ARRIVED. Se mantienen desactivadas cancelaciones por
ausencia y notificaciones. 10+5 es historia de borradores, no la política nueva.
Pendientes: TTL comercial de declaración, excepciones/evidencia/retención, retirada
de verificación presencial, recomponer grupos previamente divididos, episodios de
traslado repetido y recuperación si el nuevo chofer rechaza o vence su oferta.
Ver límites en REPORTES/ETAPA_2_INCREMENTO_3.md. Ningún plazo técnico activa efectos
reales ni da por aprobados sanciones/cobros/cancelaciones definitivas.

## Actualización del incremento 4

015 añade recuperación supervisada tras rechazo/vencimiento, incidencia visible,
episodios repetidos y correcciones auditables de DECLARED/VERIFIED. Queda resuelto
el bloqueo técnico de pérdida silenciosa: si no hay plaza compatible, se muestra
RECOVERY_PENDING, sin prometer una asignación confirmada ni restaurar el origen.
No se garantiza recuperación comercial ni capacidad futura.

Los relojes y la presencia se reinician por nuevo episodio mediante evidencia nueva.
Ocho propuestas posteriores al episodio base es un límite técnico contra ciclos,
no una regla comercial: el tratamiento al agotarlo y las incidencias sin alternativa
requieren decisión. El TTL de declaración permanece configurable sin default y sus
cambios son auditables. Las correcciones previas al viaje requieren motivo, actor
y conservación del original; falta un procedimiento comercial de prueba/revisión.

Permanecen pendientes recomposición de grupos ya divididos, menores, correcciones
BOARD/ALIGHT, manifiesto/salida, revocaciones futuras, retención y recorridos
intramunicipales. No se activan cancelaciones por ausencia, notificaciones, pagos,
compensaciones ni sanciones. Etapa 2 permanece en revisión funcional.

## Reglas aprobadas e incremento 5

El nuevo contrato de terminal confirma administrativamente las reasignaciones con
consentimiento del responsable, sin otra aceptación discrecional del chofer ni
recargo. Las ofertas heredadas siguen por compatibilidad. Se documentan averías,
emergencias declaradas e impedimentos, en vez de rechazar arbitrariamente reservas.
BOARD presencial y compensaciones auditables se separan de llegada y pago. El pago
solo puede figurar verificado como simulación de la asociación; nunca se supone.
El nuevo flujo Ya llegué usa 120 segundos provisionales sin renovar READY; conserva
0/5/8 y recogida cinco minutos, sin automatización de ausencia.

La sustitución urbana completa reserva una unidad libre para la misma carrera,
retira su entrada de fila y conserva manifiesto/precios/historia. Sin sustituto no
hay promesa de rescate. A queda bloqueado hasta recuperación administrativa. Las
posiciones/custodia se declaran y auditan; sin GPS ni asistencias reales.

Pendientes: revisión del plazo provisional, fuentes/evidencia para operación real,
manifiestos urbanos fuera del protocolo inicial, sustitución fuera de ciudad,
recomposición con responsables diferentes o dentro de un viaje de origen, menores,
correcciones tardías/bloqueadas, retención y tratamiento comercial de incidencias.
No se activan sanciones, compensaciones, cobros ni cancelaciones por ausencia.
Estas reglas sustituyen las propuestas previas en los endpoints nuevos, sin
reescribir los informes históricos ni declarar cerrada la Etapa 2.
