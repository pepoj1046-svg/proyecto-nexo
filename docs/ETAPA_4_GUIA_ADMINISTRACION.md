# Etapa 4 — guía de administración del laboratorio

Esta guía corresponde a 4A.1–4A.6 en `desarrollo/etapa-4`, PR #5 hacia
`planificacion/etapa-4a`. Solo datos ficticios y conexiones locales. No constituye
un instalador comercial, habilitación de transporte ni preparación para producción.
El [informe de auditoría](REPORTES/ETAPA_4_AUDITORIA_Y_CIERRE.md) identifica las
pruebas, límites y ratificación del commit publicado.

## Instalación y comprobación reproducible en Windows

Usar Node **22 o24** y las dependencias fijadas del repositorio. PostgreSQL18.4
se ejecuta de forma aislada mediante embedded-postgres; no configurar una base real.
Desde PowerShell, dentro del repositorio y la rama autorizada:

```powershell
git status --short --branch
git log -1 --oneline
npm ci --no-fund
npx --no-install playwright install chromium
npm run test:all
npm run test:web
```

Los scripts comprueban TypeScript, compilan la web y crean clústeres nuevos bajo
`.local`. No consumen DATABASE_URL externo. `test:web` ejecuta escritorio y móvil,
31 suites por proyecto; su cierre comprueba también SIGINT y reinicio sin accesos
ni reservas de la ejecución anterior. No incrementar timeouts/retries si falla.
Conservar el diagnóstico y comunicar el caso concreto. Ubuntu usa los mismos
comandos; Chromium puede proceder del ejecutable local autorizado por el harness.

Para repetir solo el recorrido nuevo y la actualización de base poblada:

```powershell
node scripts/test-postgres.mjs "--test-name-pattern=4A6-(A|U)"
node scripts/test-postgres.mjs "--test-name-pattern=4A6-(R|B|F|C)"
node scripts/test-web.mjs --suite=driver-admin-races.spec.mjs,platform-admin-races.spec.mjs
```

`4A6-A` crea una asociación nueva sin recursos heredados y ejecuta el recorrido
administrativo y la reserva nativa. Las conexiones privilegiadas de su fase de
preparación pertenecen **al harness**, nunca a HTTP. `4A6-U` instala001–039, copia
una base ficticia poblada, aplica040–041 y compara todas las tablas, recibos, OID, ACL
y registro de migraciones; una segunda aplicación no hace nada.

## Demostración interactiva

```powershell
$env:NEXO_WEB_PLATFORM_FIXTURE='1'
$env:NEXO_WEB_ADMIN_DIRECTORY_FIXTURE='1'
npm run dev:web
# Abrir exclusivamente http://127.0.0.1:<puerto> indicado por el terminal.
# Ctrl+C cierra HTTP/PostgreSQL y elimina el archivo de accesos de esta ejecución.
Remove-Item Env:NEXO_WEB_PLATFORM_FIXTURE, Env:NEXO_WEB_ADMIN_DIRECTORY_FIXTURE
```

Leer los accesos ficticios del archivo privado `.local/accesos-*.json` cuya ruta
indica el terminal. No copiar contraseñas, cookies o conexiones al PR, capturas ni
logs públicos. Los perfiles del fixture son demostraciones, sin identidad legal.
En Windows proteger el directorio mediante ACL del operador. Cada arranque es nuevo;
no sirve como persistencia, backup ni continuidad de una instalación comercial.

1. En **Plataforma**, iniciar sesión con el perfil local `platform`. Registrar una
   asociación con código/nombre LAB únicos, motivo y confirmación explícita. Sus
   estados iniciales son SUSPENDED/PENDING/SUSPENDED: no puede vender viajes.
2. El fixture atesta offline `LAB-ADMIN-UNO` y `LAB-ADMIN-DOS`. Delegar el primer
   ADMIN usando el primer código y el contexto actual. Esta preparación no es un
   procedimiento de comprobación oficial. GENERAL_ADMIN no recibe acceso operativo
   a pasajeros ni permiso para administrar todas las flotas.
3. Cerrar sesión e iniciar como `candidate1` en **Administración**. Abrir el
   directorio y la asociación nueva. No es necesario seleccionar un viaje.
4. En **Gestionar altas y asignaciones**, solicitar DRIVER para `LAB-ADMIN-DOS`,
   revisar y aprobar la solicitud con motivo/confirmación. Solicitar y aprobar un
   vehículo LAB de tipo VAGONETA_6 y seis plazas. Copiar sus referencias técnicas
   desde los listados autorizados y guardar una asignación base al nuevo DRIVER.
   **Esto no crea un viaje ni una posición de fila.**
5. En **Gestionar rutas y tarifas**, preparar una ruta OUT: localidades ficticias,
   extremos TERMINAL y puntos intermedios explícitos URBAN/ROAD cuando proceda.
   Ordenar los puntos según el sentido; no simular desvíos ni regresos. Guardar,
   validar y publicar. Para IN crear otro recorrido explícito: no se invierte OUT
   automáticamente. Un punto UNCLASSIFIED habilitado requiere revisión.
6. Para la ruta publicada, crear tarifas ordinaria y expresa por segmento/vigencia.
   Guardar, validar y publicar cada borrador. Ordinaria es importe por plaza;
   expresa reserva las seis plazas técnicas. Un solapamiento necesita predecesor
   compatible explícito. No hay cobro ni regla jurídica de precio añadida.
7. Consultar elegibilidad: publicar ruta/tarifas **no crea permiso ni primera fila**.
   La asociación nueva sigue inerte. Detener aquí la demostración web si faltan
   esas precondiciones; no conceder permisos ficticios desde el navegador.
8. Ejecutar `4A6-A` para demostrar la fase LAB completa: activación comercial
   explícita por owner del harness, REVIEWER independiente provisionado offline,
   revisión simulada de asociación, solicitud/revisión nativas de permiso y creación
   inicial de fila por setup. Solo entonces se cotiza y confirma una reserva por
   el núcleo existente. Esta fase es automatizada PostgreSQL, no una pantalla nueva.
9. La prueba publica otra tarifa y otra versión de ruta: conserva importe pactado,
   ID/versión/fechas originales de tarifa, reserva, integrantes, recibo y fila.
   Intentar retirar la ruta o desasignar un vehículo comprometido exige revisión
   humana y conserva el inventario; no cancelar pasajeros para permitir el cambio.
10. Consultar historial autorizado. Repetir como ADMIN limitado, otro ADMIN,
    DRIVER, pasajero o REVIEWER debe denegar acciones fuera de su ámbito. Proteger
    el último ADMIN completo recuperable; no forzar una restricción que lo elimine.

## Operación cotidiana y errores

El directorio pagina más de50 registros con cursores ligados a sesión/filtro y
revisión. Tras cambios concurrentes, actualizar desde la primera página; no reutilizar
un cursor obsoleto ni afirmar que una lectura es una reserva.

DRIVER existente puede revocarse/restaurarse con motivo, confirmación y contexto
actual. Servicio, fila, rescate o custodia pendientes bloquean la revocación; restaurar
no reinserta en fila ni recupera sesiones. El contacto acepta solo códigos LAB,
no teléfonos ni documentos. Altas/asignaciones y configuración tienen auditoría
inmutable, rechazo de revisiones antiguas y reintentos con clave original.

Si se perdió una respuesta o falló el refresco después del POST, consultar el estado
y usar **Reintentar la misma actuación**. Mientras esté pendiente, navegación SPA,
cambio de asociación, refresco padre y cierre de sesión no desmontan el formulario.
Si caduca la sesión, el reintento abre acceso de recuperación: autenticar **la misma
cuenta**, con el formulario oculto pero conservado. Otra cuenta no puede recuperar
su actuación. Si el servidor revocó permisos, su rechazo sigue siendo definitivo.

Las claves/cuerpos están solo en memoria. El navegador recibe un aviso al recargar
con un intento pendiente; cerrar forzosamente, fallar el proceso o recargar después
de aceptar el aviso **puede perder la clave**. Consultar el estado con el operador;
no registrar de nuevo a ciegas. No se almacena este material en localStorage.

## Preparación confiable y límites de transferencia

El instalador prepara migraciones y logins separados de aplicación, identidad y
provisión. El owner nunca es runtime. Bootstrap y atestación usan
[platform-access.mjs](../scripts/platform-access.mjs), `nexo_provisioner`, conexión
127.0.0.1 y base `nexo_test_<hex>`. Instrucciones exactas y protección del archivo
único en [el contrato4A.3](ETAPA_4_ADMINISTRACION_ASOCIACIONES.md#primer-acceso-transferible).
El launcher cierra su conexión owner antes de escuchar HTTP; no añadirla al gateway.

No hay autonomía completa de activación inicial: catálogo geográfico, habilitación
comercial, provisión de REVIEWER, consola de permisos y primera fila requieren
procedimientos LAB descritos arriba. La asignación base sigue siendo metadato
administrativo, separado de la asignación operativa. Recuperación por pérdida total
de GENERAL_ADMIN, verificación legal/profesional, custodia, retención/exportación,
delegación global adicional y doble aprobación requieren contrato del comprador.
No crear accesos universales o sanciones para cubrir esos pendientes.

Mantener el máximo simultáneo de seis por segmento, FIFO, grupos/consentimientos,
precio pactado, abordaje físico y recepción segura. Seis plazas confirmadas no
inician la salida: el chofer registra el hecho autorizado. Sin GPS, pagos, avisos
externos, despliegues ni Etapa5. La infraestructura productiva queda para Etapa8
previa autorización independiente.
