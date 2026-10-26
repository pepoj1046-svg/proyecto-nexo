# Localidades, identidad y aprovisionamiento — Etapa 1

Implementación local mediante 008–009. No se ha elegido ni creado un proveedor
remoto. No hay HTTP, frontend, cuentas remotas ni datos reales. Las migraciones
001–007 se conservan byte por byte. [Encargo](ENCARGO_ETAPA_1_SIGUIENTE.md).

## Resolver nombres y buscar servicios

El contrato de pantalla para el futuro cliente empieza con **¿De dónde sales?**
y **¿A dónde vas?**. Para cada campo el servidor utiliza:

```js
const suggestions = await service.suggestLocalities(token, {
  query: 'San José', limit: 10
});
// [{localityId, catalogId, catalogVersion, name, municipality, province, department}]
```

Solo aparecen catálogos `VERIFIED` y `ACTIVE`. La respuesta no contiene permisos,
conductores, reservas ni información administrativa de asociaciones. `VERIFIED`
es un estado interno: su carga exige fuente autorizada y cotejo documental antes
de un piloto real. Ninguna migración instala un catálogo nacional ni datos de prueba.
Los fixtures marcados VERIFIED en tests siguen siendo explícitamente ficticios.

Prefijo del nombre completo; no hay aproximación por distancia, generación de
rutas ni búsqueda difusa. Se normaliza NFC, espacios y mayúsculas; á/é/í/ó/ú/ü
coinciden con a/e/i/o/u/u, conservando ñ distinta de n. SQL también trata las
mayúsculas acentuadas bajo el locale C usado por el ejecutor. Mínimo dos caracteres,
máximo 80; se rechazan comodines `%`, `_` y barra inversa. Límite predeterminado
10, máximo 20, validado también en SQL. Se devuelven las primeras sugerencias,
sin paginación; el pasajero refina el texto si hay más coincidencias.

Orden determinista: nombre normalizado, municipio, provincia, departamento,
versión e ID, con colación C. Los homónimos se muestran con su jerarquía completa;
la selección conserva `localityId`, `catalogId` y `catalogVersion`, nunca un texto
ambiguo. Dos localidades de versiones distintas no son intercambiables.

```js
await service.search(token, {
  originLocalityId: selectedOrigin.localityId,
  destinationLocalityId: selectedDestination.localityId
});
```

La búsqueda de servicios conserva su contrato y solo ofrece servicios existentes.
Los IDs pertenecen a versiones de catálogo inmutables cuando las usan rutas.
La versión recibida se conserva en el estado de selección del futuro cliente;
no se agrega un selector de categoría ni se cambia el payload de búsqueda existente.
Un catálogo retirado invalida la selección para nuevas búsquedas/reservas. Elegir
una sugerencia no asegura que haya servicio: se admite `NO_DIRECT_SERVICE`.
El contexto histórico de una reserva propia se conserva mediante las políticas
operativas existentes. La lectura directa del catálogo también exige VERIFIED/ACTIVE.
Por compatibilidad, los servicios sintéticos internos previos siguen siendo
ejercitables por IDs en pruebas; nunca se presentan como sugerencias verificadas.

Hay un índice de prefijo normalizado y nuevos índices de actor/membresías,
reservas y sesiones. El límite de respuesta no demuestra rendimiento nacional:
faltan EXPLAIN ANALYZE y carga con un catálogo autorizado de tamaño representativo,
incluyendo planes preparados, latencia, homónimos masivos y concurrencia sostenida.

## Fronteras de confianza

| Conexión del servidor | Autoridad |
|---|---|
| Login con pertenencia a `nexo_app` | Funciones de negocio y SELECT sujeto a RLS; sin DML ni secretos |
| Login con pertenencia a `nexo_identity` | Solo funciones de registro, intentos, emisión y consumo de recuperación |
| Login con pertenencia a `nexo_provisioner` | Solo altas/bajas de administrador/revisor, bloqueo de identidad y emisión de recuperación |
| Propietario de migraciones | DDL y mantenimiento confiable; nunca conexión de una aplicación |

Son roles de grupo NOLOGIN, sin superusuario, BYPASSRLS, CREATEDB ni CREATEROLE.
Los logins locales de prueba son aleatorios, separados y efímeros; producción no
está configurada. No entregar conexiones al cliente ni combinar esas membresías.
Ambos adaptadores rechazan conexiones elevadas y miembros del propietario del
esquema. RLS no contiene a quien puede modificar funciones/políticas.

`nexo_identity` es una frontera privilegiada: el módulo verifica contraseñas antes
de llamar al emisor SQL; quien controle esa conexión puede emitir sesiones de
identidades gestionadas. No equivale a dar esa autoridad a un pasajero. El
aprovisionador no recibe SELECT de hashes ni permiso para emitir sesiones.

## Registro, login y sesiones locales

```js
import { createIdentity } from '../src/auth/identity.mjs';
const identity = createIdentity(identityPool); // Pool separado y limitado.
await identity.register({login: 'pasajero.ficticio', password: testPassword});
const {token, expiresAt} = await identity.login({
  login: 'pasajero.ficticio', password: testPassword
});
await service.logout(token);    // Solo la sesión actual.
// O service.logoutAll(token), con una sesión todavía válida.
```

Registro acepta solo login/contraseña: no rol, userId, asociación ni membresía.
Crea un pasajero sin privilegios; no inicia sesión. Responde igual ante duplicados.
Login es un identificador local ASCII de 3–64 caracteres: letras, números, puntos
y guiones; se convierte a minúsculas. No se recopila email, teléfono ni nombre real.
No se afirma verificación de identidad ni del vínculo chofer/asociación.

Contraseñas: mínimo 12 caracteres, máximo 128 bytes UTF-8, sin recortar ni
normalizar; scrypt N=32768, r=8, p=3, sal aleatoria de 16 bytes, resultado de 64
bytes, comparación de tiempo constante. Los parámetros del verificador son fijos;
un hash malformado no puede solicitar costes de cálculo arbitrarios.

Sesiones: 32 bytes aleatorios, base64url, una hora de vigencia; solo SHA-256 del
token se almacena. Sin refresh token, JWT ni renovación implícita. Nueva sesión
requiere login. Las sesiones anteriores a 009 conservan su vencimiento existente;
no se extienden ni se convierten automáticamente en nuevas cuentas.
Identidad deshabilitada, token vencido o revocado deja de autorizar. Cerrar todas
las sesiones incrementa una versión: un login ya verificado que esperaba el lock
no puede crear una sesión con la versión anterior. Reactivar la identidad no
reactiva tokens ni códigos antiguos.

Límites compartidos en PostgreSQL: 5 intentos por identificador y 1000 globales
por ventana fija de 15 minutos. Registro y login comparten presupuesto; también
cuentan accesos correctos. Recuperación usa un presupuesto compartido separado
de cinco consumos por 15 minutos y el global. Se guardan hashes de identificadores,
no textos ni contraseñas, y los intentos se confirman antes de verificar hashes:
un login fallido no revierte sus contadores. Los errores de login son genéricos.
Son límites conservadores para el módulo local; antes de exponerlo hay que diseñar
protección por origen/dispositivo, registro y enumeración, capacidad de scrypt,
mitigación de bloqueo deliberado y limpieza acotada de buckets. No son defensa
completa contra abuso distribuido ni un servicio público listo para operar.

## Recuperación y roles

Recuperación no se entrega por un canal inventado. Un proceso confiable debe
verificar al solicitante fuera de este módulo, generar 32 bytes aleatorios con
base64url, entregar el código por un canal autorizado y enviar **solo su SHA-256**
a `nexo.provision_recovery(userId,digest,reason)` mediante el aprovisionador.
No registrar el código ni incluirlo en motivos de auditoría. El módulo consume:

```js
await identity.recover({code: oneTimeCode, password: newTestPassword});
```

Vigencia 15 minutos, un solo uso; emitir otro código invalida los anteriores.
El consumo serializa por cuenta, cambia el hash y versión y revoca todas las
sesiones/códigos. Dos consumos concurrentes producen un único éxito. Un código
vencido o reemplazado no cambia la contraseña. Falta el canal y procedimiento
real autorizado; este incremento solo demuestra el protocolo local.

Administrador de asociación: `service.setDriverMembership(token,associationId,
userId,enabled,reason)` exige un administrador **de esa asociación**, obtenido
de la sesión. El associationId del payload no acredita autoridad. Registra motivo,
actor y estado; no crea usuarios, vehículos ni un rol administrativo. Habilitar
un chofer exige un procedimiento documental confiable antes del piloto.

Solo el aprovisionador puede llamar a `nexo.provision_role(userId,associationId,
'ASSOCIATION_ADMIN',enabled,reason)` o a la variante con asociación NULL y
`'REVIEWER'`. No hay registro público de administradores/revisores ni administrador
general de negocio implementado. `set_identity_active` bloquea/desbloquea cuentas
gestionadas e invalida sesiones y recuperación. El revisor tampoco puede revisar
su propia solicitud aunque acumule ambos roles.

La auditoría es inmutable, sin hashes/tokens/contraseñas. Registra actor de usuario
cuando existe, sujeto, asociación, acción, razón, fecha y principal SQL real
(`session_user`). Un administrador A no lee altas/bajas de B ni eventos de login
privados de otros usuarios. Un usuario ve sus propios eventos. La auditoría de
aprovisionamiento global se consulta por el proceso privilegiado de revisión.

## Seguridad y decisiones pendientes

Todas las funciones SECURITY DEFINER fijan `search_path`. Se revoca EXECUTE a
PUBLIC en todo el esquema; las funciones nuevas parten de un default global
restrictivo para el creador. RLS usa un helper autenticado para elegibilidad;
el helper interno y la implementación antigua de revisión quedan sin permiso
de ejecución para la aplicación.

Revocación de sesión/rol rige para sentencias posteriores; una operación ya
autorizada en curso puede finalizar. No se promete cancelación retroactiva de
transacciones. La actualización de catálogo/permisos de ruta sí se serializa con
reservas y confirmaciones por los bloqueos existentes; ninguna carrera nueva
altera el inventario ni cancela automáticamente reservas anteriores.

Mantener pendientes: proveedor y despliegue del piloto, HTTP/TLS, cookies seguras,
CSRF/CORS, MFA para roles privilegiados, verificación documental, recuperación
operativa, retención/borrado con plazos aprobados y revisión independiente. Las
identidades de pruebas no validan identidad civil ni habilitación de transporte.

Sin decisión de producto, un recorrido completo intramunicipal sigue sin categoría
y no se ofrece como servicio completo. Los tramos locales de una ruta habilitada
continúan admitidos. Revocar una autorización no decide por sí solo qué hacer con
reservas futuras ni interrumpe viajes iniciados; quedan pendientes aviso, revisión
y tratamiento operativo/económico. No se implementan sanciones o devoluciones.
