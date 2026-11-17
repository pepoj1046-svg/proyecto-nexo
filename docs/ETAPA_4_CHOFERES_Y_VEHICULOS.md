# Choferes y vehículos — contrato de laboratorio 4A.4

Una identidad técnica, una membresía DRIVER y una solicitud aprobada son conceptos diferentes. Ninguna aprobación acredita identidad oficial, licencia, inspección o habilitación legal. Solo datos ficticios.

El administrador con alcance completo de una asociación puede solicitar DRIVER sobre un código LAB previamente atestado por el instalador local. La solicitud fija identidad y atestación; una modificación posterior exige rechazo/revisión, nunca redirige el alta. No hay listado global de cuentas ni altas de identidad por HTTP. Una membresía ya existente, incluso revocada, se gestiona mediante 4A.2.

Los vehículos se solicitan con código LAB normalizado, tipo técnico VAGONETA_6 y capacidad exactamente 6. Pendiente/rechazado no forma parte del inventario. Aprobar inserta solamente el vehículo nativo: no crea viajes, filas, permisos ni capacidad disponible. Los identificadores quedan reservados incluso tras rechazo; una nueva postulación/reutilización necesita un contrato futuro, no ocurre implícitamente.

Solicitudes PENDING → APPROVED o REJECTED, motivo y confirmación obligatorios, historial separado e inmutable. El mismo administrador puede solicitar y revisar: el laboratorio no tiene una política de doble firma aprobada. GENERAL_ADMIN, REVIEWER, DRIVER y PASSENGER no reciben estas facultades por su rol. ADMIN limitado tampoco.

La asignación base es metadato administrativo, con un vehículo y un chofer como máximo por vínculo. No sustituye trips.driver_id ni es otro inventario. Crear, cambiar o retirar exige ambos recursos de la asociación, membresía e identidad activas y sin restricciones. Se bloquea actividad o custodia pendiente de recursos entrantes y salientes, también de un chofer en otra asociación (sin revelar detalles). Las incidencias ambiguas de asociación bloquean conservadoramente. No inicia ni modifica ningún servicio.

Escrituras READ COMMITTED: comprobación preliminar sin locks de ámbito → acción/idempotencia → intento no bloqueante del mutex administrativo existente → ámbito compartido → rutas globales UUID ordenadas sin espera (NOWAIT) → estabilizar identidad/sesión/ADMIN → recursos. Reautorización después de esperas, revisión que incorpora historia para ABA, recibo anterior solo tras autorización y antes de comparar versión. Auditoría, transición, recurso y recibo son una transacción. Conflicto de mutex/ruta devuelve 503 sin recibo ni cambios y conserva la misma intención; evita inversiones de locks con contratos anteriores. Helpers privados; runtime nexo_app únicamente RPC explícitas; RLS y sin DML directo.

Listados e historial usan cursor de 50 (máximo 100), ligado a sesión, asociación, filtro, tamaño, permisos y contenido. Cambios invalidan páginas anteriores; no se entrega un resultado parcial silencioso. La interfaz conserva cuerpo y clave ante respuesta incierta o COMMIT confirmado con refresco fallido.

Pendiente del comprador: verificación profesional/legal real, datos/documentos necesarios, retención, criterios para repetir solicitudes rechazadas, doble firma y futura integración de asignaciones base en planificación. No se implementan políticas de dinero, sanciones o cancelaciones. 4A.5 y producción requieren autorización separada.

Un impedimento operativo válido produce recibo `applied=false, reviewRequired=true`, actor/motivo e historial inmutable; conserva recursos, solicitud e inventario. Las denegaciones de permisos, validaciones y revisiones obsoletas revierten sin crear un caso autorizado ficticio. Revisar no desbloquea automáticamente el recurso.

## Prueba reproducible en Windows

Node 22 o 24, PowerShell, repositorio local; sin PostgreSQL externo:

```powershell
npm ci --no-fund
$env:NEXO_WEB_ADMIN_DIRECTORY_FIXTURE='1'
$env:NEXO_WEB_PLATFORM_FIXTURE='1'
npm run dev:web
```

Abrir únicamente la URL `http://127.0.0.1:PUERTO` mostrada. Leer localmente el archivo privado de accesos indicado por el launcher; nunca subirlo a Git ni al PR. Usar `admin` en Administración, sin seleccionar un viaje: Directorio → asociación Horizonte del Chaco → Gestionar altas y asignaciones → Consultar.

1. Solicitudes de choferes: código ficticio atestado `LAB-ADMIN-UNO`; motivo y confirmación, registrar solicitud. Consultar y volver a confirmar antes de aprobar. Comprobar la membresía en el directorio y los controles existentes de 4A.2.
2. Solicitudes de vehículos: código nuevo `LAB-PRUEBA-VEHICULO`; tipo/capacidad fijos VAGONETA_6/6. Registrar y aprobar por separado. Comprobar que aparece en el directorio sin viaje o fila.
3. Asignaciones base: copiar las referencias UUID del chofer incorporado y del vehículo aprobado. Motivo/confirmación para guardar, cambiar o retirar. La tabla muestra el vínculo administrativo y los impedimentos; no habilita un servicio.
4. Probar un vehículo que ya está en fila: resultado de revisión operativa auditada, sin cambios; consultar historial. Probar un código duplicado: rechazo seguro.
5. Cambiar asociación limpia los datos. Una respuesta incierta bloquea navegación del directorio: usar «Reintentar la misma actuación» para conservar cuerpo y clave. No editar una intención incierta.

Cerrar con Ctrl+C: se detienen HTTP/PostgreSQL y se retira el archivo de accesos. Cada ejecución es ficticia y efímera. No exponer el puerto ni copiar credenciales. Los flags anteriores pertenecen al fixture local, no a una vía de provisión productiva.

Verificación automatizada:

```powershell
node --test tests/fleet-admin.test.mjs
node scripts/test-postgres.mjs --test-name-pattern=4A4
node scripts/test-web.mjs --suite=fleet-administration.spec.mjs,fleet-admin-races.spec.mjs,fleet-permissions.spec.mjs
npm run test:all
npm run test:web
```

Las pruebas crean PostgreSQL real aislado, ejecutan Chromium en escritorio/móvil y cierran sus laboratorios. El instalador offline de 4A.3 sigue siendo el único punto para atestar identidades adicionales; no hay credenciales provisionadoras en HTTP. Véase también el contrato de administración de asociaciones para ese procedimiento.
