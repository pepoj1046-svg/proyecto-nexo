# Seguridad y límites del prototipo

## Implementado y probado localmente

- RLS de lectura en tablas operativas; sin token válido no se obtienen datos privados.
- Identidad derivada de sesión opaca, hash SHA-256, vencimiento y revocación. Cambiar
  GUCs de usuario/asociación no autoriza nada. Tokens no se registran en auditoría.
- Administradores A/B solo consultan vehículos y operaciones de su asociación;
  choferes solo sus servicios; pasajeros solo sus reservas. El catálogo de
  asociaciones activas/rutas/paradas/tarifas es consultable para búsquedas autenticadas.
- Rol de aplicación sin propiedad, superusuario ni BYPASSRLS. Solo SELECT filtrado
  y funciones autorizadas: sin DML directo, emisión de sesiones, edición de membresías,
  lectura del registro de sesiones ni acceso a helpers internos.
- Funciones con `SECURITY DEFINER`, `search_path` fijo, nombres de tablas cualificados,
  permisos de ejecución revocados a PUBLIC y comprobación explícita del actor/rol.
- Referencias compuestas de asociación, conductor activo, único servicio activo por
  vehículo/chofer, inventario bloqueado y grupos atómicos; auditoría sin UPDATE/DELETE.
- Caducidad, rechazo y cancelación liberan plazas; salida idempotente exclusiva del chofer.
- Escrituras SQL directas exigen READ COMMITTED, además de la configuración del adaptador.

El propietario de migraciones sigue siendo una identidad de alta confianza: puede
alterar esquemas/funciones. RLS no contiene a un superusuario ni al propietario que
modifica políticas. Nunca usarlo como conexión de aplicación. La suite usa una conexión
real no propietaria para comprobar permisos, además de una conexión de setup aislada.

## Pendiente antes de cualquier uso real

1. Revisar y autorizar la autenticación pública/proveedor y el transporte HTTP/TLS.
   008–009 añaden módulo local con scrypt, sesiones opacas, revocación, recuperación
   de un uso, contadores compartidos y aprovisionamiento separado. 010–011 añaden
   HTTP solo de laboratorio, límites y mantenimiento. Faltan canal real de
   recuperación, MFA, protección distribuida de abuso y el transporte público autorizado.
2. Aprobar retención/borrado y acceso a sesiones, intentos, recuperación, idempotencia,
   auditoría y backups. Existe mantenimiento local de filas inválidas con cutoff
   obligatorio y simulación por defecto; no hay cron ni política legal automática.
3. Revisar particiones y vínculos verificados menores/responsables. En el prototipo
   solo se admiten solicitudes declaradas sin menores; no hay verificación de edades.
4. Procedimiento real de altas/documentación (roles y bajas locales ya modelados), turnos con horarios, validación de terminales,
   rutas/paradas geográficas reales, cambios de trazado versionados y GPS consentido.
5. Progreso individual de pasajeros, incidentes, recuperación ante fallos, notificaciones,
   política de ausencias, revisión funcional del plazo de ofertas y del manifiesto de salida.
6. QR, pagos/conciliación y reembolsos; licencias y reglas de 18:00/20:00. No existen
   funciones para verificar pagos ni un cron que suspenda/cancele reservas.
7. Revisión independiente de seguridad, carga, backups, operación y autorización de piloto.

No hay datos reales, credenciales productivas, servicios remotos, facturación ni despliegues.
Ningún recurso o archivo de Ruta 35, Meteo Chaco o ATLAS-AI-Lab forma parte del incremento.

## Actualización de RLS y permisos de operación

Las migraciones 005–007 restringen el catálogo público a rutas elegibles y tarifas
vigentes; operadores y reservas propias conservan su contexto histórico. Permisos,
referencias y motivos son privados de asociación, salvo el revisor operativo autorizado.
Un administrador no puede autoverificar ni editar el registro de revisores.
Búsqueda, nuevas reservas y confirmaciones revalidan habilitación, vigencia y estados.
Se probaron suspensiones/revocaciones bajo locks y actualización con datos existentes.
El propietario/provisionador permanece privilegiado. Falta revisión independiente,
gestión pública de identidades, retención de motivos, documentos y permisos reales.
[Detalle de fronteras](GEOGRAFIA_Y_AUTORIZACIONES.md) y
[evidencia](REPORTES/ETAPA_1_GEOGRAFIA.md).

## Endurecimiento 008–009

RLS geográfico solo permite catálogo VERIFIED/ACTIVE; autocompletado limitado sin
datos operativos privados. EXECUTE de todas las funciones se revoca a PUBLIC y
los defaults globales del creador se cierran: un REVOKE por esquema no quita el
default global de PostgreSQL. Las políticas llaman a un helper autenticado con
grant explícito, no al helper interno de elegibilidad. Todos los SECURITY DEFINER
fijan search_path; se verifica su ACL por catálogo en la suite.

Roles de aplicación, identidad y aprovisionamiento separados sin DML directo.
Registro solo de pasajero; administrador A solo concede/revoca chofer de A.
Administrador/revisor exigen el aprovisionador offline; ni con ambos roles se
permite revisar una solicitud propia. Auditoría inmutable y filtrada por sujeto
o asociación; sin contraseñas/tokens/hashes en eventos.

Fronteras: el módulo de identidad y su conexión son confiables, capaces de emitir
sesiones tras verificar la contraseña. Los roles de migración/provisión siguen
siendo privilegiados. Revocar sesión no aborta una sentencia ya autorizada en curso;
las sentencias posteriores sí revalidan. Los límites locales pueden causar bloqueo
deliberado y requieren diseño de perímetro antes de exponer registro/login.
No hay un nuevo estado de cancelación de reservas tras revocar permisos.
[Contrato y pendientes](LOCALIDADES_Y_AUTENTICACION.md) y
[evidencia actual](REPORTES/ETAPA_1_LOCALIDADES_IDENTIDAD.md).

## Auditoría técnica 010–011

Corregidos presupuestos de registro/login y recuperación compartida, asignación
de buckets pese a global agotado, caducidad antes del lock y doble evento de logout.
Guardas de runtime verifican autoridad efectiva, mezcla de grupos, roles elevados,
CREATE/propiedad de objetos y SET ROLE. Identidad tiene timeout por llamada, scrypt
con trabajo acotado y registro privado de fallos sin solicitudes/secretos.

Se prueban RLS/ACL, pg_temp al final, shadowing temporal, cierres concurrentes,
recuperación por código, filas bloqueadas y limpieza acotada. HTTP local rechaza
Host/Origin no admitidos, cuerpos grandes y tokens inválidos, sin SQL ni provisión.
La conexión `nexo_identity` conserva autoridad confiable de emisión; RLS no contiene
una conexión comprometida con esa autoridad ni al propietario/administrador del SO.
Las decisiones operativas y de piloto anteriores siguen pendientes del propietario.
[Límites y mantenimiento](HTTP_LOCAL_Y_MANTENIMIENTO.md) ·
[Auditoría y evaluación de cierre](REPORTES/ETAPA_1_AUDITORIA_HTTP.md).

## Revisión final del laboratorio

Migraciones 001–011 conservadas. Se revisaron de nuevo 010–011, transporte local,
emisión/revocación, mantenimiento y privilegios efectivos. No se identificaron
otros defectos demostrables bloqueantes dentro del alcance local revisado.
Se corrigió un detalle HTTP: encabezados Origin/Sec-Fetch-Site presentes pero
vacíos ya no se interpretan como ausentes. La regresión falló antes del arreglo
y la batería completa aprobó después. No se modifica la frontera de confianza
de nexo_identity ni se convierte la API local en pública.

[Cierre técnico y límites](CIERRE_TECNICO_ETAPA_1.md). Permanecen las decisiones
comerciales, legales, de identidad pública y de piloto enumeradas arriba.

## Actualización del cierre propuesto de Etapa 2

018–021 añaden alcances por ruta dirigida/terminal, puertas en RPC anteriores,
RLS restrictiva y revocación serializada. Los casos especiales de menores tienen
revisión mínima simulada y barrera de BOARD; no validación de edades/documentos
reales. La disponibilidad anónima es una proyección en loopback sin pasajeros.
No servicios de Internet, envíos, cobros, GPS ni cancelaciones automáticas.
Los pendientes operativos/legales anteriores se concretan en
[decisiones actuales](DECISIONES_PENDIENTES_ETAPA_2.md) y el
[informe de cierre](REPORTES/ETAPA_2_CIERRE_TECNICO.md); los informes previos conservan
sus resultados históricos y no constituyen habilitación de producción.
