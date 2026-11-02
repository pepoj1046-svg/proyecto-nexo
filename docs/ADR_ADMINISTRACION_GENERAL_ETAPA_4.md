# ADR — Autoridad administrativa general, 4A.3

Estado: decisión técnica de laboratorio, autorizada por el encargo 4A.3 del propietario.
Base: 3a49f43. No habilita transporte ni producción.

## Autoridades y frontera

GENERAL_ADMIN es una concesión explícita a una identidad del módulo existente,
almacenada en una tabla privada. No deriva de REVIEWER, ADMIN, registro público,
una referencia del navegador ni el orden de registro. No cambia has_role, RLS,
capacidad, custodia, precios o las facultades operativas de los otros roles.

Sus facultades cerradas son listar asociaciones/datos técnicos y administradores,
crear asociaciones ficticias inertes, conceder/revocar ADMIN de asociación con
alcance completo y consultar auditoría administrativa. La concesión exige una
atestación técnica LAB emitida offline para una identidad activa existente.
El navegador selecciona el código atestado: no puede acreditar identidad por UUID.
No se exponen logins, secretos, pasajeros ni conexiones de provisión.

Delegación en este corte significa ADMIN de una asociación concreta. No incluye
crear otra autoridad global ni modificar alcances de rutas: se conservan los
alcances existentes, y se rechazan cuentas restringidas para revisión. No borrar
admin_limits para delegar: eso ampliaría facultades en otras asociaciones.

## Inicialización y recuperación

Un comando local explícito, con conexión nexo_provisioner separada, crea una cuenta
nueva con secreto aleatorio y hash scrypt, atestación y autoridad en una transacción.
Un marcador singleton irreversible cierra bootstrap incluso si se pierde acceso.
El secreto se entrega exclusivamente en archivo privado creado con exclusión;
no stdout, HTTP, Git ni contraseña predeterminada. El setup no queda en el gateway.

La atestación LAB es comprobación técnica por operador confiable, no verificación
oficial ni autorización jurídica. Un cambio de versión de identidad exige nueva
atestación para futuras delegaciones. La recuperación existente de identidad no
concede roles nuevos. Sustituir autoridad global por pérdida total, delegar
facultades globales y verificar personas reales quedan bloqueados: requieren una
política del comprador. No hay contraseña maestra ni reinicialización automática.

## Consistencia, último ADMIN y amenazas

Mutex transaccional común de administración, luego ámbito del sujeto, identidad
y membresías. Se preserva el orden operativo de rutas: los comandos de concesión
no bloquean rutas ni inventan operaciones. Sesión/autoridad se comprueban con hora
real tras esperas; también antes de entregar recibos. Revisiones incluyen eventos
para impedir ABA. action_start/finish mantienen cuerpo y clave de intención.

Las tres entradas offline de membresía, identidad y ámbito se envuelven para
impedir perder el último ADMIN efectivo. Efectivo significa membresía activa,
identidad gestionada activa y cuenta sin límites que
impidan alcance completo. Una membresía legacy sin login gestionado no cuenta como alternativa recuperable;
su regularización es independiente, sin backfill automático. Dos revocaciones se serializan.
El único GENERAL_ADMIN tampoco puede desactivarse por el contrato offline.

Listas e historial usan cursor ligado a sesión, consulta, permisos y snapshot.
Auditoría administrativa inmutable, mínima, privada, sin secretos. Rechazos por
excepción hacen rollback: no se afirma persistir un evento rechazado. Fallo de
auditoría revierte concesión y recibo. Helpers sin EXECUTE público y search_path fijo.

## Asociaciones y decisiones que permanecen bloqueadas

Crear exige código/nombre LAB únicos, motivo y confirmación. Escribe explícitamente
SUSPENDED/PENDING/SUSPENDED, sin rutas, vehículos, tarifas, permisos o ventas.
Se muestran por separado habilitación técnica/comercial, adhesión y operación.
La consola registra solicitudes auditadas de revisión de esos estados; no activa
transporte, modifica políticas comerciales ni concede habilitación legal. La
revisión técnica operativa existente de REVIEWER conserva su contrato separado.

Amenazas consideradas: primer registro hostil, rebootstrap, referencia robada,
ADMIN que se eleva, REVIEWER confundido, permisos cruzados, revocación durante
espera, recibo tras revocación, última autoridad perdida, doble concesión, intención
obsoleta, respuesta perdida, fallo de auditoría e historia filtrada. Pruebas reales
y limitaciones se ratificarán en el informe 4A.3; este ADR no las declara ejecutadas.
