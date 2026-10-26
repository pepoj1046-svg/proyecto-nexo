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

1. Construir y revisar autenticación pública (hash de contraseñas seguro, emisión de
   tokens aleatorios, revocación, recuperación, rate limits, TLS y transporte HTTP).
   Las sesiones actuales solo las crea un adaptador confiable en pruebas.
2. Limitar retención/duración y limpiar sesiones, claves de idempotencia y auditoría;
   definir política de retención y protección de información personal.
3. Revisar particiones y vínculos verificados menores/responsables. En el prototipo
   solo se admiten solicitudes declaradas sin menores; no hay verificación de edades.
4. Altas administrativas autenticadas, turnos con horarios, validación de terminales,
   rutas/paradas geográficas reales, cambios de trazado versionados y GPS consentido.
5. Progreso individual de pasajeros, incidentes, recuperación ante fallos, notificaciones,
   política de ausencias, revisión funcional del plazo de ofertas y del manifiesto de salida.
6. QR, pagos/conciliación y reembolsos; licencias y reglas de 18:00/20:00. No existen
   funciones para verificar pagos ni un cron que suspenda/cancele reservas.
7. Revisión independiente de seguridad, carga, backups, operación y autorización de piloto.

No hay datos reales, credenciales productivas, servicios remotos, facturación ni despliegues.
Ningún recurso o archivo de Ruta 35, Meteo Chaco o ATLAS-AI-Lab forma parte del incremento.
