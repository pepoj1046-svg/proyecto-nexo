# Etapa 1 — Localidades e identidad local, 008–009

Fecha: **26/10/2026, America/La_Paz**. Repositorio exclusivo:
`pepoj1046-svg/proyecto-nexo`; rama `desarrollo/etapa-1`, PR #1 abierto.
Base inicial verificada: `13bd725603f7db0381b560ca6d29cdbaed74baca`.
Se leyeron AGENTS.md, encargo, resultados, requisitos, arquitectura, modelo,
seguridad, plan de pruebas y revisiones del PR antes de implementar.

## Cambios

- `database/migrations/008_locality_lookup.sql`: normalización española, índice
  de prefijo, sugerencias limitadas VERIFIED/ACTIVE, jerarquía y versiones,
  RLS geográfico, índices de actor/reservas/sesiones, helper autenticado y
  permisos por defecto seguros.
- `database/migrations/009_identity_and_provisioning.sql`: cuentas con hash,
  intentos compartidos, sesiones y recuperación revocables, roles de conexión
  separados, gestión de choferes por asociación y provisión de administradores/
  revisores, auditoría, prohibición de revisar solicitudes propias y cierre ACL.
- `src/auth/passwords.mjs`, `src/auth/identity.mjs`: scrypt y módulo local de
  registro/login/recuperación con pools sin privilegios de migración.
- `src/domain/localities.mjs`, `src/db/service.mjs`: contrato de sugerencias,
  logout/logout-all y gestión de choferes; validación de rol de runtime reforzada.
- `tests/localities.test.mjs`, `tests/identity.test.mjs`,
  `tests/integration/postgres.test.mjs`: cuatro unitarias y 16 integraciones
  nuevas, ampliación de G09/G12 y pruebas de compatibilidad y concurrencia.
- README y docs de arquitectura, modelo, seguridad, pruebas y resultados;
  nuevo `docs/LOCALIDADES_Y_AUTENTICACION.md` y este informe.

No se modifican 001–007, el algoritmo de inventario, precios por segmentos,
grupos, expresos, filas, salida ni progreso. El pasajero sigue buscando únicamente
por origen y destino. No se construye frontend ni se avanza a Etapa 2.

## Ejecución local real

Linux x64, Node **24.19.0**, npm **11.9.0**, PostgreSQL **18.4 real** del lockfile.
La suite usa un clúster nuevo solo en 127.0.0.1, sin DATABASE_URL externa;
se detiene al terminar, incluidos fallos. Todos los usuarios/datos son ficticios.

```text
npm ci --no-fund --cache /tmp/nexo-npm-cache
added 17 packages
exit: 0

npm run test:all
  npm test:              17 tests, 17 pass, 0 fail, 0 skipped/cancelled
  test:integration:      54 tests, 54 pass, 0 fail, 0 skipped/cancelled
  test:runner:           child exit 9 preserved; PostgreSQL stopped
exit: 0

git diff --check
exit: 0
```

También se ejecutó la base anterior `13bd725` en una copia aislada de archivos
extraída con `git archive`, compartiendo únicamente las dependencias locales:
**13/13 unitarias, 38/38 integraciones y probe del ejecutor aprobados**. Esto
establece la comparación con el avance anterior sin modificarlo.

## Evidencia de seguridad y compatibilidad

- **001–007 intactas**: SHA-256 comprobado en G12 y sin cambios en Git.
- **38 casos anteriores conservados**: carrera de 24 conexiones por última plaza,
  grupos atómicos, seis asientos por segmento, tarifas, filas y despacho.
- **L01–L03**: homónimos con jerarquía completa, NFC/tildes/mayúsculas/ñ, IDs y
  versión, límite 20 y orden estable, catálogo sintético/draft/retired oculto,
  SQL directo acotado y cero servicios sin inventar recorridos.
- **G09/C01/C02**: cambios de adhesión, retirada de catálogo y revocación de
  permiso esperan/serializan con reservas y aceptaciones; no quedan nuevas
  confirmaciones parciales. G11 conserva la terminación de viajes iniciados.
- **H01–H03**: registro sin roles ni membresías, credenciales inaccesibles al
  runtime, intentos concurrentes persistidos, sesiones aleatorias, expiración,
  cierre individual/todas y control de versión para no reemitir sesiones viejas.
- **H04–H09**: recuperación concurrente con un éxito, códigos reemplazados y
  vencidos rechazados, revocación total, A/B y auditoría, roles de confianza,
  baja/reactivación sin restaurar tokens, cierre vs emisión concurrente, ACL y
  search_path de todos los SECURITY DEFINER y defaults sin PUBLIC EXECUTE.
- **H10**: copia poblada con 001–007, sesiones/membresías/permisos/reservas
  confirmadas; aplicar solo 008–009 conserva cada fila, conserva actor antiguo,
  permite reservar otras cuatro plazas junto a dos confirmadas y rechaza la séptima.
- **H11**: usuario con administrador y revisor provisionados tampoco puede
  verificar su solicitud; implementación antigua de revisión no es invocable.

## Problemas encontrados y correcciones

1. El checkout inicial estaba en `work` sobre main y sin los avances. Se verificó
   el remoto y recuperó la rama mediante fetch/switch, con árbol limpio y sin
   sobrescribir archivos. El primer fetch carecía de acceso de red del sandbox;
   funcionó al habilitar el permiso de red para el comando.
2. npm intentaba escribir cache fuera de las rutas permitidas; se usó cache en
   `/tmp/nexo-npm-cache`. PostgreSQL requiere permiso de sockets loopback para
   el ejecutor: la suite se ejecutó con ese permiso en este entorno.
3. En las migraciones nuevas, las pruebas encontraron un nombre de índice
   reservado, un CASE sin paréntesis y un alias inválido bajo COLLATE. Corregidos
   antes de publicar. No se editó una migración anterior.
4. El locale C no convierte todas las mayúsculas españolas; se añadió mapeo
   explícito y regresiones para SAN JOSÉ/San José y Ñ/ñ.
5. Revocar EXECUTE de PUBLIC dejó visibles dependencias de RLS que usaban un
   helper sin grant explícito. Se introdujo un wrapper autenticado y mantuvo
   el helper interno cerrado. El REVOKE por esquema anterior no eliminaba el
   default global; ahora se revoca globalmente para el creador en esta base.
6. La revisión detectó que acumular administrador/revisor podía permitir revisión
   propia. El nuevo wrapper lo impide y mantiene la implementación previa interna.
7. El push del entorno fue rechazado por usar una identidad sin escritura. Se
   publicó con la conexión de GitHub del propietario, comprobando el árbol Git
   idéntico al probado y avanzando la rama con SHA esperado, sin force ni pérdidas.

Los fallos intermedios están corregidos; la evidencia final es la ejecución completa
con código 0. El probe produce intencionalmente código 9 en el hijo y su verificación
termina con 0; no es un error pendiente.

## CI

El workflow existente se conserva: Node 22, Ubuntu y Windows, `npm run test:all`.
Commit de implementación **`6be6195`**: Ubuntu y Windows aprobados en la
[ejecución del PR](https://github.com/pepoj1046-svg/proyecto-nexo/actions/runs/40358461490)
y en la [ejecución del push](https://github.com/pepoj1046-svg/proyecto-nexo/actions/runs/40358448440).
Se inspeccionaron los jobs y logs Ubuntu/Windows del PR: cada plataforma ejecutó
**17 unitarias y 54 integraciones**, PostgreSQL 18.4 y el probe del ejecutor, todos
aprobados. Este resultado corresponde a ese commit de implementación; cualquier
commit documental posterior tiene su propio estado en los checks del PR.
Otras versiones PostgreSQL no se han probado.

## Pendientes para cerrar Etapa 1

1. Revisión técnica independiente del incremento, ACL/RLS y fronteras del módulo.
2. Elegir/autorizar proveedor y despliegue del piloto antes de crear recursos;
   transporte HTTP/TLS, cookies/CSRF/CORS, MFA, verificación de identidades,
   canal real de recuperación y operación de altas/bajas privilegiadas.
3. Afinar abuso distribuido y recuperación: el presupuesto global/per-login local
   puede causar denegación deliberada. Definir mantenimiento/retención/borrado
   de intentos, sesiones, recuperación, idempotencia y auditoría, sin plazos inventados.
4. Fuente autorizada de catálogo, procedimiento documental de transporte y carga
   nacional con EXPLAIN ANALYZE; un índice y fixtures pequeños no acreditan escala.
5. Decisión sobre servicios completos intramunicipales y reservas futuras después
   de revocación. Se preservan tramos locales válidos y viajes iniciados.
6. Mantener pendientes anteriores: menores, abordaje individual, ausencias,
   notificaciones, recuperación operativa y revisión de manifiesto/timeout de ofertas.
   T12/T15/T16 no están construidos; pagos/GPS/licencias no se activan aquí.

Sin merge a main, despliegues, servicios de pago, gastos, personas/GPS/pagos reales
ni cambios a otros proyectos. [Contrato detallado](../LOCALIDADES_Y_AUTENTICACION.md).
