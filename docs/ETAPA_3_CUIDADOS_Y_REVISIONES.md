# Contrato de laboratorio 8B: responsables, menores y revisión

Complementa Etapa 2 y 8A. No establece identidad legal, autorizaciones de viaje,
plazos, sanciones, reembolsos ni reglas comerciales. Solo datos ficticios y loopback.
Las migraciones 001–030 se conservan; 031–032 agregan evidencia y controles.

## Responsable presencial

Una reserva APP conserva a su pasajero. Una WALK_IN puede tener una persona técnica
sin cuenta, creada por administración autorizada de su ruta. No se crea identidad
digital, sesión ni membresía para esa persona. Se conservan `passenger_id=NULL`,
operador y grupo originales. La falta de comprobación mantiene revisión humana.

La cuenta titular genera un código aleatorio de un uso en su sesión SQL activa.
El operador comprueba presencialmente el supuesto ficticio y consume ese código
para vincular la cuenta. Referencia de reserva, UUID de usuario o código por sí
solos no conceden acceso. El código no sustituye la comprobación humana. Su validez
termina con la revocación/caducidad de la sesión emisora; no es un plazo comercial.
Los formularios no solicitan nombres, edades ni documentos.

Cada registro, vínculo, desvinculación o corrección agrega una revisión monotónica
inmutable con actor/motivo/momento. La corrección revoca acceso futuro de la cuenta
anterior; no borra sus actuaciones. Nueva cuenta requiere nuevo código. Volver a
la misma cuenta no renueva consentimiento antiguo. Los traslados comparan snapshot
con revisión del responsable; solicitudes y decisiones guardan su revisión.

Cuando la unicidad histórica de decisiones de ruta impide registrar consentimiento
nuevo sin reinterpretar el anterior, se bloquea con revisión humana. No se devuelve
éxito por `ON CONFLICT DO NOTHING`. La recuperación tardía nativa hereda la persona y
cuenta efectivas al nuevo grupo, con evento `INHERIT_NATIVE`, sin renovar revisión
legal ni técnica de menores.

La autoría histórica del operador no conserva permisos sobre WALK_IN después de
su revocación. RLS restrictiva y límites en RPC antiguas protegen lectura y escritura,
con revalidación después del bloqueo de ruta. La autoría APP anterior se conserva.

## Menores y acompañantes

Se reutilizan `minor_cases`, `minor_reviews` y el contrato nativo de abordaje. Solo
administración autorizada registra escenario técnico, compañero del mismo grupo y
resultado ficticio. BOARD exige revisión y compañía cuando el núcleo lo requiere.
No se puede eliminar el BOARD del acompañante dejando al menor abordado.

La web no habilita un menor sin acompañante mediante `VERIFIED_SIMULATED`. El núcleo
anterior conserva sus pruebas y clasificación técnica; esa clasificación nunca
certifica legalidad. No se cambian clase/acompañante ya registrados: falta contrato
seguro de rectificación de custodia y queda revisión humana. No se almacena edad,
fecha de nacimiento, identificación ni autorización documental ficticia.

## Ausencia observada

Chofer actual activo o administración de la ruta registra ausencia individual o de
los integrantes pendientes, en el punto de subida habilitado o después de pasarlo,
incluso con salida registrada. Se guarda reserva, integrante, episodio, actor,
momento, punto observado y motivo cerrado. Se serializa con BOARD y reasignación.

No es equivalente a no declarar «Ya llegué». Un BOARD original, incluso rectificado,
requiere revisión humana y no permite inventar ausencia. Un abordaje real posterior
conserva la observación anterior como historia. Expreso reserva seis plazas técnicas;
sin contrato de composición física no se deducen seis personas ausentes.

No cambia inventario, importe, estado de reserva, custodia ni movimientos. No cancela,
libera, sanciona, cobra o envía avisos. Los borradores 10+5 minutos anteriores siguen
siendo infraestructura provisional desactivada, no una política aprobada.

## Discrepancias y rectificaciones

Se reutiliza el reporte 8A con evidencia capturada en servidor. Se añade
`SAFE_TRANSFER_INCORRECT`. Administración puede consultar evidencia original e
historial de revisión y agregar resultado/motivo con versión esperada:

- `DOCUMENTED`: revisión documentada sin modificar hechos.
- `PENDING_POLICY`: falta política/contrato; intervención humana.
- `NO_CHANGE`: revisión sin rectificación.
- `NATIVE_CORRECTION`: operación nativa limitada `VOID` del hecho seleccionado.

La última opción solo admite BOARD cuestionado por `NOT_BOARDED` o ALIGHT cuestionado
por `ALIGHT_INCORRECT`, en evidencia de esa reserva, episodio vigente y parada que
admita el corrector nativo. No opera sobre viaje finalizado, custodia terminal o
traslado seguro, ni elimina compañía requerida. Conserva hecho original y agrega
rectificación separada, dentro de la misma transacción que revisión/auditoría/recibo.
Un trigger también impide eludir custodia mediante el corrector antiguo.

La declaración del pasajero jamás modifica hechos automáticamente. Pasajero o
responsable vigente consulta únicamente sus reportes/resultados; administración
legítima puede revisar. El chofer no resuelve reportes ni accede a los de terceros.
Se muestran los últimos 50 reportes y su total; los anteriores permanecen conservados.
Consulta paginada de WALK_IN a cargo usa cursor UUID y páginas de hasta 100 (web 50).

## Operaciones especiales y cuentas

Solicitar alternativa o cancelación usa `passenger_decision`; resolver usa
`approve_late_resolution`. Se requieren solicitud vigente, reserva única, capacidad,
ausencia de movimientos incompatibles y administrador autorizado. Grupos divididos,
consentimientos obsoletos, falta de vehículo y reversión de decisiones sin contrato
permanecen en revisión humana. No se añade inventario ni resolución económica.

La web solo administra membresías DRIVER ya existentes de la asociación inferida
del viaje autorizado. Administrador con alcance limitado puede consultar; modificar
membresía global requiere administrador sin restricción de ruta. No hay creación de
cuentas/administradores, aprovisionamiento web ni ampliación automática de asociación.
Se reutilizan revocación y auditoría nativas.

## Transporte y transacciones

POST autenticados `/api/care/context`, `/list`, `/code`, `/review`, `/accounts` y
`/command`; cookie HttpOnly/SameSite, Origin/CSRF, cuerpo cerrado, clave idempotente
para escrituras y errores permitidos. No se aceptan actor, rol, asociación, evidencia,
edad o efectos económicos enviados por el navegador. El gateway conserva límite de
120 solicitudes/minuto y seis operaciones concurrentes; no se eleva para las pruebas.

Tablas care privadas con RLS, sin SELECT/DML directo de `nexo_app`, historial inmutable,
`SECURITY DEFINER` con search_path fijo y sin EXECUTE PUBLIC. Helper privado no es RPC.
Primero se bloquea ruta y luego se revalida y estabiliza sesión/membresía; no se retiene
un lock de sesión mientras se espera ruta que impediría la revocación. Un fallo revierte
identidad offline, vínculos, observaciones, revisión, rectificación, auditoría y recibos.

## Decisiones pendientes

El propietario y asesoramiento competente deben definir comprobación de identidad y
responsabilidad, requisitos legales de menores, rectificación de compañía/custodia,
retención y eliminación de códigos/evidencia/revisiones, acceso histórico tras revocar
responsable, plazos/avisos de ausencia y condiciones de una salida con faltantes,
resolución de grupos divididos y renovación/reversión de consentimiento de ruta.
No se asignan plazos de conservación definitivos ni consecuencias automáticas.
